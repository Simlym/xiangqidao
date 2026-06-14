import React from "react";
import Board from "./Board";
import { applyMove, uciToChinese } from "./xiangqi";
import { getNext, getTrainingPuzzle, checkMove, submitRating, explainPuzzle, getRating, getOverview } from "./api";
import { useBoardMaxHeight } from "./useBoardMaxHeight";

// 今日训练目标：本会话已做 + 到期题数，撑起左栏进度环
const DAILY_GOAL = 15;

// 训练状态机
// phase: 'loading' | 'thinking' | 'step_ok' | 'wrong' | 'rating' | 'done' | 'empty'

const RATINGS = [
  { key: "again", label: "再来", desc: "完全不会，明天再练", color: "#c0392b" },
  { key: "hard",  label: "困难", desc: "做出来了但很吃力",   color: "#e67e22" },
  { key: "good",  label: "良好", desc: "想了一会，做出来了",  color: "#27ae60" },
  { key: "easy",  label: "容易", desc: "一眼看出，毫不费力",  color: "#2980b9" },
];

export default function Trainer({ target = null, onTargetConsumed, user, onCreditsChanged, onRequireLogin }) {
  const [puzzle, setPuzzle]       = React.useState(null);
  const [dueCount, setDueCount]   = React.useState(0);
  const [phase, setPhase]         = React.useState("loading");
  const [newCapped, setNewCapped] = React.useState(false);
  // 弱点专项：非空时「下一题」继续在该类目内取题
  const [activeCategory, setActiveCategory] = React.useState(null);
  const didInit                   = React.useRef(false);

  // 多步追踪
  const [step, setStep]           = React.useState(0);
  const [currentFen, setCurrentFen] = React.useState("");
  const [lastMove, setLastMove]   = React.useState(null);
  const [hadRetry, setHadRetry]   = React.useState(false);
  const [wrongCount, setWrongCount] = React.useState(0);     // 本步已错次数，驱动分级提示
  const [hint, setHint]           = React.useState(null);    // 分级提示文案
  const [stepMsg, setStepMsg]     = React.useState("");      // 中间步骤反馈

  // 最终结果
  const [solution, setSolution]   = React.useState([]);
  const [nextReview, setNextReview] = React.useState(null);
  const [ratingChange, setRatingChange] = React.useState(null); // 首次遇题的 ELO 变化
  const startedAt                 = React.useRef(0);

  // AI 讲解（完成后按需请求，后端缓存同题结果）
  const [aiText, setAiText]         = React.useState("");
  const [aiLoading, setAiLoading]   = React.useState(false);
  const [aiDisabled, setAiDisabled] = React.useState(false); // 后端未配置 AI

  // 计时训练
  const [timed, setTimed]   = React.useState(true);
  const [elapsed, setElapsed] = React.useState(0);  // 秒
  const solveMs               = React.useRef(0);     // 完成时定格的用时

  // 左栏成长面板：ELO 档案 + 今日进度（本会话已做 / 连续打卡）
  const [ratingInfo, setRatingInfo] = React.useState(null); // {rating, peak, solved, title}
  const [streakDays, setStreakDays] = React.useState(0);
  const [solvedToday, setSolvedToday] = React.useState(0);   // 本会话已完成题数

  // 棋盘区可用高度：防止上方数字坐标被挤出、下方最后一行被截断。
  const [boardAreaRef, boardMaxHeight] = useBoardMaxHeight();

  // 拉取 ELO 档案与连续打卡（挂载一次；每题完成后刷新）
  const refreshGrowth = React.useCallback(async () => {
    try {
      const [r, ov] = await Promise.all([getRating(), getOverview()]);
      setRatingInfo(r);
      setStreakDays(ov.streak_days || 0);
    } catch {
      /* 未登录或离线时静默：左栏退化为初始值，不打断解题 */
    }
  }, []);

  React.useEffect(() => { refreshGrowth(); }, [refreshGrowth]);

  // 解题进行中实时计时；完成/答错面板出现后停表
  React.useEffect(() => {
    if (!timed || !["thinking", "step_ok"].includes(phase)) return;
    const id = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)),
      250,
    );
    return () => clearInterval(id);
  }, [timed, phase]);

  const resetState = React.useCallback(() => {
    setPhase("loading");
    setStep(0);
    setLastMove(null);
    setHadRetry(false);
    setWrongCount(0);
    setHint(null);
    setStepMsg("");
    setSolution([]);
    setRatingChange(null);
    setElapsed(0);
    setAiText("");
    setAiLoading(false);
  }, []);

  const beginPuzzle = React.useCallback((p) => {
    setPuzzle(p);
    setCurrentFen(p.fen);
    startedAt.current = Date.now();
    setPhase("thinking");
  }, []);

  // 常规取题（可带类目做弱点专项）
  const load = React.useCallback(async (category = null) => {
    resetState();
    const d = await getNext(category);
    setDueCount(d.due_count);
    if (!d.puzzle) { setNewCapped(!!d.new_limit_reached); setPhase("empty"); return; }
    beginPuzzle(d.puzzle);
  }, [resetState, beginPuzzle]);

  // 按 id 取指定题（来自复盘报告/实战漏着推荐）
  const loadById = React.useCallback(async (id) => {
    resetState();
    try {
      const p = await getTrainingPuzzle(id);
      beginPuzzle(p);
    } catch {
      setPhase("empty");
    }
  }, [resetState, beginPuzzle]);

  // 响应外部跳转目标：指定题 / 弱点类目；无目标时仅在首次挂载取常规题
  React.useEffect(() => {
    if (target?.puzzleId) {
      setActiveCategory(null);
      loadById(target.puzzleId);
      onTargetConsumed?.();
    } else if (target?.category) {
      setActiveCategory(target.category);
      load(target.category);
      onTargetConsumed?.();
    } else if (!didInit.current) {
      didInit.current = true;
      load();
    }
  }, [target, load, loadById, onTargetConsumed]);

  async function onMove(move) {
    if (!puzzle || !["thinking"].includes(phase)) return;
    const prevFen = currentFen;  // 走子前局面，供答错时回滚乐观更新
    const fenAfterMine = applyMove(currentFen, move);  // 我方落子后局面，也用于翻译对方应着
    setLastMove(move);
    setHint(null);
    // 乐观更新：玩家这一手立刻落到棋盘上，不必等校验/对方应着返回。
    setCurrentFen(fenAfterMine);

    const res = await checkMove({ puzzle_id: puzzle.id, step, move, attempt: wrongCount });

    if (!res.correct) {
      setCurrentFen(prevFen);  // 走错：把棋子还原回走子前
      setHadRetry(true);
      setWrongCount((n) => n + 1);
      setHint(res.hint);   // 分级提示
      setPhase("wrong");
      return;
    }

    if (res.done) {
      setCurrentFen(res.fen_after);
      setPhase("rating");
    } else {
      // 中间步骤正确：展示对方应着后继续
      const nextStep = step + 1;
      setStep(nextStep);
      setWrongCount(0);    // 进入下一步，重置该步错误计数
      setCurrentFen(res.fen_after);
      // fen_after 已含对方应着，高亮其落子让玩家看清对方回应
      if (res.opponent_move) setLastMove(res.opponent_move);
      setStepMsg(
        res.opponent_move
          ? `第 ${step + 1} 步正确！对方应：${uciToChinese(fenAfterMine, res.opponent_move)}`
          : `第 ${step + 1} 步正确，继续！`
      );
      setPhase("step_ok");
      setTimeout(() => {
        setStepMsg("");
        setLastMove(null);
        setPhase("thinking");
      }, 1100);
    }
  }

  async function onRetry() {
    setLastMove(null);
    setHint(null);
    setPhase("thinking");
  }

  async function onGiveUp() {
    // 放弃：直接提交 again，拿到正解
    solveMs.current = Date.now() - startedAt.current;
    const res = await submitRating({
      puzzle_id: puzzle.id,
      self_rating: "again",
      had_retry: true,
      correct: false,
      time_spent_ms: solveMs.current,
    });
    setSolution(res.solution);
    setNextReview(res.next_review);
    setRatingChange(res.rating || null);
    setPhase("done");
    setSolvedToday((n) => n + 1);
    refreshGrowth();
  }

  async function onRate(rating) {
    solveMs.current = Date.now() - startedAt.current;
    const res = await submitRating({
      puzzle_id: puzzle.id,
      self_rating: rating,
      had_retry: hadRetry,
      correct: true,
      time_spent_ms: solveMs.current,
    });
    setSolution(res.solution);
    setNextReview(res.next_review);
    setRatingChange(res.rating || null);
    setPhase("done");
    setSolvedToday((n) => n + 1);
    refreshGrowth();
    onCreditsChanged?.(); // 首次做对可能奖励积分
  }

  async function onAiExplain() {
    if (aiLoading || !puzzle) return;
    if (!user) {
      onRequireLogin?.();
      return;
    }
    setAiLoading(true);
    try {
      const res = await explainPuzzle(puzzle.id);
      if (!res.enabled) {
        setAiDisabled(true);
      } else {
        setAiText(res.explanation || "（AI 暂时没有返回讲解，稍后再试）");
        if (!res.cached) onCreditsChanged?.(); // 新生成才扣分
      }
    } catch (e) {
      if (e.status === 401) onRequireLogin?.();
      setAiText(e.message || "AI 讲解失败");
      onCreditsChanged?.();
    } finally {
      setAiLoading(false);
    }
  }

  const fmtSec = (ms) => `${(ms / 1000).toFixed(1)} 秒`;

  // 正解从题目初始局面逐步重放，把 UCI 翻译成中文棋谱（如 炮二平五）
  const solutionText = React.useMemo(() => {
    if (!puzzle || !solution.length) return "";
    let fen = puzzle.fen;
    return solution
      .map((m) => {
        const cn = uciToChinese(fen, m);
        fen = applyMove(fen, m);
        return cn;
      })
      .join(" → ");
  }, [puzzle, solution]);

  // ── 渲染 ──────────────────────────────────────────────────────

  if (phase === "loading") return <div className="panel">加载中…</div>;
  if (phase === "empty")
    return (
      <div className="panel">
        {activeCategory ? (
          <>
            <h2>「{activeCategory}」专项已练完 🎉</h2>
            <p>该类目暂无更多可练题目。</p>
            <button onClick={() => { setActiveCategory(null); load(); }}>
              返回常规训练 →
            </button>
          </>
        ) : (
          <>
            <h2>今日训练已完成 🎉</h2>
            {newCapped ? (
              <p>已达今日新题上限，明天再来学新题；也可随时复习到期题，劳逸结合更高效。</p>
            ) : (
              <p>没有到期或新题了。导入更多题库后再来，或明天复习。</p>
            )}
          </>
        )}
      </div>
    );

  const totalSteps = puzzle?.total_steps ?? 1;
  const sideText = puzzle?.side_to_move === "w" ? "红方" : "黑方";
  const boardDisabled = phase !== "thinking";

  const solvedGoal = solvedToday + dueCount; // 进度环分母：本会话已做 + 到期堆积，至少 DAILY_GOAL
  const ringGoal = Math.max(DAILY_GOAL, solvedGoal);

  return (
    <div className="trainer trainer-3col">
      {/* ── 左栏：成长面板（今日进度环 + ELO 卡）────────────────── */}
      <aside className="trainer-side growth">
        <ProgressRing solved={solvedToday} goal={ringGoal} due={dueCount} streak={streakDays} />
        <EloCard info={ratingInfo} change={phase === "done" ? ratingChange : null} />
      </aside>

      {/* ── 中栏：棋盘 ─────────────────────────────────────────── */}
      <div className="trainer-main">
        <div className="trainer-board-area" ref={boardAreaRef}>
          <Board
            fen={currentFen}
            onMove={onMove}
            lastMove={lastMove}
            disabled={boardDisabled}
            maxHeight={boardMaxHeight}
          />
        </div>
        {/* 轮到谁走 + 多步进度，压在棋盘正下方一行 */}
        <div className="turn-bar">
          <span className={"turn-chip " + (puzzle.side_to_move === "w" ? "red" : "black")}>
            轮到 <b>{sideText}</b> 走子
          </span>
          {totalSteps > 1 && (
            <span className="turn-step">
              <span className="step-bar">
                {Array.from({ length: totalSteps }, (_, i) => (
                  <span
                    key={i}
                    className={"step-dot" + (i < step ? " done" : i === step ? " current" : "")}
                  />
                ))}
              </span>
              第 {step + 1} / {totalSteps} 步
            </span>
          )}
          {timed && <span className="tag timer">⏱ {elapsed}s</span>}
        </div>
      </div>

      {/* ── 右栏：解题工作区（题目卡 + 随 phase 切换的反馈/自评/结果）── */}
      <aside className="trainer-side solve">
        {/* 题目信息卡 */}
        <div className="panel solve-card">
          <div className="info-top">
            {activeCategory && (
              <span className="tag" style={{ background: "#fff3e0", color: "#e67e22" }}>
                弱点专项
              </span>
            )}
            {puzzle.kind && puzzle.kind !== puzzle.category && (
              <span className="tag" style={{ background: "#e8f0fe", color: "#2980b9" }}>
                {puzzle.kind}
              </span>
            )}
            <span className="tag">{puzzle.category}</span>
            <span className="tag">难度 {"★".repeat(puzzle.difficulty)}</span>
            {totalSteps > 1 && <span className="tag">共 {totalSteps} 步</span>}
            <span
              className="tag clickable"
              onClick={() => setTimed((v) => !v)}
              title="切换计时模式"
            >
              计时{timed ? "开" : "关"}
            </span>
          </div>

          {/* 解题进行中：目标说明 + 反馈槽 + 放弃 */}
          {(phase === "thinking" || phase === "step_ok") && (
            <>
              <p className="solve-prompt">
                请走出制胜着法
                {totalSteps > 1 ? `（第 ${step + 1} / ${totalSteps} 步）` : ""}。
              </p>
              <div className="feedback-slot">
                {hint && <span className="hint">提示：{hint}</span>}
                {stepMsg && <span className="step-msg">{stepMsg}</span>}
              </div>
              <button className="btn-giveup wide" onClick={onGiveUp}>看不出？查看答案</button>
            </>
          )}

          {/* 答错 */}
          {phase === "wrong" && (
            <div className="result bad">
              <h3>✗ 不对</h3>
              {hint && <span className="hint">提示：{hint}</span>}
              <div className="btn-row">
                <button className="btn-retry" onClick={onRetry}>再试一次</button>
                <button className="btn-giveup" onClick={onGiveUp}>查看答案</button>
              </div>
            </div>
          )}

          {/* 答对自评 */}
          {phase === "rating" && (
            <div className="result ok">
              <h3>✓ 全部走出！</h3>
              <p className="muted">
                {hadRetry ? "中途重试过，自评最高计入「困难」。" : "你觉得这题对你来说……"}
              </p>
              <div className="rating-btns">
                {RATINGS.map((r) => (
                  <button
                    key={r.key}
                    className="btn-rate"
                    style={{ "--rate-color": r.color }}
                    onClick={() => onRate(r.key)}
                  >
                    <span className="rate-label">{r.label}</span>
                    <span className="rate-desc">{r.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 完成：正解 + ELO 变化 + AI 讲解 + 下一题 */}
          {phase === "done" && (
            <div className="result ok">
              <h3>{ratingChange?.delta >= 0 ? "✓ 完成！" : "已查看答案"}</h3>
              <p>正解：<code>{solutionText}</code></p>
              {ratingChange && (
                <p>评分 {ratingChange.old} →{" "}
                  <b>{ratingChange.new}</b>{" "}
                  <span className={ratingChange.delta >= 0 ? "delta-up" : "delta-down"}>
                    ({ratingChange.delta >= 0 ? "+" : ""}{ratingChange.delta})
                  </span>
                </p>
              )}
              {timed && <p className="muted">本题用时：{fmtSec(solveMs.current)}</p>}
              <p className="muted">下次复习：{nextReview}</p>
              {aiText && (
                <div className="analysis-explanation ai-explain">{aiText}</div>
              )}
              {!aiDisabled && !aiText && (
                <button className="btn-ai" onClick={onAiExplain} disabled={aiLoading}>
                  {aiLoading ? "AI 思考中…" : "🤖 AI 讲解这道题"}
                </button>
              )}
              <button onClick={() => load(activeCategory)}>
                {activeCategory ? `下一题（${activeCategory}）→` : "下一题 →"}
              </button>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

// ── 左栏：今日进度环 ────────────────────────────────────────────
function ProgressRing({ solved, goal, due, streak }) {
  const R = 34, C = 2 * Math.PI * R;
  const pct = goal > 0 ? Math.min(1, solved / goal) : 0;
  return (
    <div className="panel growth-card">
      <div className="growth-title">今日训练</div>
      <div className="ring-wrap">
        <svg viewBox="0 0 80 80" className="ring-svg" aria-hidden>
          <circle cx="40" cy="40" r={R} className="ring-bg" />
          <circle
            cx="40" cy="40" r={R} className="ring-fg"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - pct)}
          />
        </svg>
        <div className="ring-center">
          <span className="ring-num">{solved}</span>
          <span className="ring-den">/ {goal}</span>
        </div>
      </div>
      <div className="growth-rows">
        <div className="growth-row"><span>到期复习</span><b>{due} 题</b></div>
        <div className="growth-row"><span>连续打卡</span><b>🔥 {streak} 天</b></div>
      </div>
    </div>
  );
}

// ── 左栏：ELO 评分卡 ───────────────────────────────────────────
function EloCard({ info, change }) {
  const rating = info?.rating ?? 1200;
  const peak = info?.peak ?? rating;
  const title = info?.title ?? "";
  return (
    <div className="panel growth-card elo-card">
      <div className="growth-title">战术评分</div>
      <div className="elo-main">
        <span className="elo-num">{rating}</span>
        {change && (
          <span className={"elo-delta " + (change.delta >= 0 ? "delta-up" : "delta-down")}>
            {change.delta >= 0 ? "▲" : "▼"}{Math.abs(change.delta)}
          </span>
        )}
      </div>
      {title && <div className="elo-title">{title}</div>}
      <div className="growth-rows">
        <div className="growth-row"><span>历史最高</span><b>{peak}</b></div>
        {info?.solved != null && (
          <div className="growth-row"><span>累计解题</span><b>{info.solved}</b></div>
        )}
      </div>
    </div>
  );
}
