import React from "react";
import Board from "./Board";
import { getNext, checkMove, submitRating } from "./api";

// 训练状态机
// phase: 'loading' | 'thinking' | 'step_ok' | 'wrong' | 'rating' | 'done' | 'empty'

const RATINGS = [
  { key: "again", label: "再来", desc: "完全不会，明天再练", color: "#c0392b" },
  { key: "hard",  label: "困难", desc: "做出来了但很吃力",   color: "#e67e22" },
  { key: "good",  label: "良好", desc: "想了一会，做出来了",  color: "#27ae60" },
  { key: "easy",  label: "容易", desc: "一眼看出，毫不费力",  color: "#2980b9" },
];

export default function Trainer() {
  const [puzzle, setPuzzle]       = React.useState(null);
  const [dueCount, setDueCount]   = React.useState(0);
  const [phase, setPhase]         = React.useState("loading");

  // 多步追踪
  const [step, setStep]           = React.useState(0);
  const [currentFen, setCurrentFen] = React.useState("");
  const [lastMove, setLastMove]   = React.useState(null);
  const [hadRetry, setHadRetry]   = React.useState(false);
  const [hint, setHint]           = React.useState(null);    // 起点提示
  const [stepMsg, setStepMsg]     = React.useState("");      // 中间步骤反馈

  // 最终结果
  const [solution, setSolution]   = React.useState([]);
  const [nextReview, setNextReview] = React.useState(null);
  const startedAt                 = React.useRef(0);

  const load = React.useCallback(async () => {
    setPhase("loading");
    setStep(0);
    setLastMove(null);
    setHadRetry(false);
    setHint(null);
    setStepMsg("");
    setSolution([]);

    const d = await getNext();
    setDueCount(d.due_count);
    if (!d.puzzle) { setPhase("empty"); return; }

    setPuzzle(d.puzzle);
    setCurrentFen(d.puzzle.fen);
    startedAt.current = Date.now();
    setPhase("thinking");
  }, []);

  React.useEffect(() => { load(); }, [load]);

  async function onMove(move) {
    if (!puzzle || !["thinking"].includes(phase)) return;
    setLastMove(move);
    setHint(null);

    const res = await checkMove({ puzzle_id: puzzle.id, step, move });

    if (!res.correct) {
      setHadRetry(true);
      setHint(res.hint);   // 起点提示
      setPhase("wrong");
      return;
    }

    if (res.done) {
      setCurrentFen(res.fen_after);
      setPhase("rating");
    } else {
      // 中间步骤正确：短暂提示后继续
      const nextStep = step + 1;
      setStep(nextStep);
      setCurrentFen(res.fen_after);
      setStepMsg(`第 ${step + 1} 步正确，继续！`);
      setPhase("step_ok");
      setTimeout(() => {
        setStepMsg("");
        setLastMove(null);
        setPhase("thinking");
      }, 900);
    }
  }

  async function onRetry() {
    setLastMove(null);
    setHint(null);
    setPhase("thinking");
  }

  async function onGiveUp() {
    // 放弃：直接提交 again，拿到正解
    const res = await submitRating({
      puzzle_id: puzzle.id,
      self_rating: "again",
      had_retry: true,
      correct: false,
      time_spent_ms: Date.now() - startedAt.current,
    });
    setSolution(res.solution);
    setNextReview(res.next_review);
    setPhase("done");
  }

  async function onRate(rating) {
    const res = await submitRating({
      puzzle_id: puzzle.id,
      self_rating: rating,
      had_retry: hadRetry,
      correct: true,
      time_spent_ms: Date.now() - startedAt.current,
    });
    setSolution(res.solution);
    setNextReview(res.next_review);
    setPhase("done");
  }

  // ── 渲染 ──────────────────────────────────────────────────────

  if (phase === "loading") return <div className="panel">加载中…</div>;
  if (phase === "empty")
    return (
      <div className="panel">
        <h2>今日到期题已清空</h2>
        <p>没有新题可练了。导入更多题库后再来，或明天复习。</p>
      </div>
    );

  const totalSteps = puzzle?.total_steps ?? 1;
  const sideText = puzzle?.side_to_move === "w" ? "红方" : "黑方";
  const boardDisabled = phase !== "thinking";

  return (
    <div className="trainer">
      {/* 题目信息栏 */}
      <div className="panel info">
        <div className="info-top">
          <span className="tag">{puzzle.category}</span>
          <span className="tag">难度 {"★".repeat(puzzle.difficulty)}</span>
          {totalSteps > 1 && (
            <span className="tag">共 {totalSteps} 步</span>
          )}
          <span className="due-badge">到期 {dueCount} 题</span>
        </div>
        {/* 多步进度条 */}
        {totalSteps > 1 && (
          <div className="step-bar">
            {Array.from({ length: totalSteps }, (_, i) => (
              <div
                key={i}
                className={"step-dot" + (i < step ? " done" : i === step ? " current" : "")}
              />
            ))}
          </div>
        )}
        <p>
          轮到 <b>{sideText}</b> 走子，请走出制胜着法
          {totalSteps > 1 ? `（第 ${step + 1} / ${totalSteps} 步）` : ""}。
        </p>
        {hint && (
          <p className="hint">提示：从 <code>{hint}</code> 开始的棋子</p>
        )}
        {stepMsg && <p className="step-msg">{stepMsg}</p>}
      </div>

      {/* 棋盘 */}
      <Board
        fen={currentFen}
        onMove={onMove}
        lastMove={lastMove}
        disabled={boardDisabled}
      />

      {/* 答错面板 */}
      {phase === "wrong" && (
        <div className="panel result bad">
          <h3>✗ 不对</h3>
          <div className="btn-row">
            <button className="btn-retry" onClick={onRetry}>再试一次</button>
            <button className="btn-giveup" onClick={onGiveUp}>查看答案</button>
          </div>
        </div>
      )}

      {/* 答对自评面板 */}
      {phase === "rating" && (
        <div className="panel result ok">
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

      {/* 完成面板 */}
      {phase === "done" && (
        <div className="panel result ok">
          <p>正解：<code>{solution.join(" → ")}</code></p>
          <p className="muted">下次复习：{nextReview}</p>
          <button onClick={load}>下一题 →</button>
        </div>
      )}
    </div>
  );
}
