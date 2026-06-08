import React from "react";
import Board from "./Board";
import { getLevels, getLevel, checkMove, submitChallenge } from "./api";

// 闯关：关卡网格 → 选关进入解题器，依次解完本关全部题目。

export default function Challenge() {
  const [levels, setLevels] = React.useState(null);
  const [active, setActive] = React.useState(null); // 当前关卡详情
  const [loading, setLoading] = React.useState(false);

  const loadLevels = React.useCallback(() => {
    getLevels().then(setLevels);
  }, []);

  React.useEffect(() => { loadLevels(); }, [loadLevels]);

  async function openLevel(idx) {
    setLoading(true);
    try {
      const detail = await getLevel(idx);
      setActive(detail);
    } catch (e) {
      alert(e.message || "无法进入该关卡");
    } finally {
      setLoading(false);
    }
  }

  function exitLevel() {
    setActive(null);
    loadLevels(); // 回到网格时刷新通关/星级状态
  }

  if (active) return <LevelSolver level={active} onExit={exitLevel} />;

  if (!levels) return <div className="panel">加载中…</div>;
  if (levels.length === 0)
    return (
      <div className="panel">
        <h2>闯关</h2>
        <p className="muted">题库还太少，凑不满一关。导入更多题库后再来挑战。</p>
      </div>
    );

  const cleared = levels.filter((l) => l.cleared).length;

  return (
    <div className="challenge">
      <div className="panel">
        <h2>闯关模式</h2>
        <p className="muted">
          按难度循序解锁：通关一关解锁下一关，一次做对全关拿三星 ★★★。
          已通关 <b>{cleared}</b> / {levels.length} 关。
        </p>
      </div>
      <div className="level-grid">
        {levels.map((lv) => (
          <LevelCard key={lv.index} lv={lv} onOpen={() => openLevel(lv.index)} disabled={loading} />
        ))}
      </div>
    </div>
  );
}

function LevelCard({ lv, onOpen, disabled }) {
  const locked = !lv.unlocked;
  const cls = "level-card" + (locked ? " locked" : "") + (lv.cleared ? " cleared" : "");
  return (
    <button className={cls} onClick={locked ? undefined : onOpen} disabled={locked || disabled}>
      <div className="level-no">{locked ? "🔒" : `第 ${lv.index + 1} 关`}</div>
      <div className="level-diff">{"★".repeat(lv.difficulty)}</div>
      <div className="level-stars">
        {[0, 1, 2].map((i) => (
          <span key={i} className={i < lv.stars ? "star on" : "star"}>★</span>
        ))}
      </div>
      <div className="level-prog">{lv.solved}/{lv.total}</div>
    </button>
  );
}

// ── 解题器：依次解完本关 puzzles ──────────────────────────────────

function LevelSolver({ level, onExit }) {
  const puzzles = level.puzzles;
  const [idx, setIdx] = React.useState(0);
  const [phase, setPhase] = React.useState("thinking"); // thinking | wrong | solved | levelDone
  const [step, setStep] = React.useState(0);
  const [fen, setFen] = React.useState(puzzles[0].fen);
  const [lastMove, setLastMove] = React.useState(null);
  const [wrongCount, setWrongCount] = React.useState(0);
  const [hadRetry, setHadRetry] = React.useState(false);
  const [hint, setHint] = React.useState(null);
  const [solution, setSolution] = React.useState([]);
  const [solvedFlags, setSolvedFlags] = React.useState([]); // 每题是否做对
  const [totalDelta, setTotalDelta] = React.useState(0);
  const startedAt = React.useRef(Date.now());

  const puzzle = puzzles[idx];

  function startPuzzle(i) {
    setIdx(i);
    setStep(0);
    setFen(puzzles[i].fen);
    setLastMove(null);
    setWrongCount(0);
    setHadRetry(false);
    setHint(null);
    setSolution([]);
    setPhase("thinking");
    startedAt.current = Date.now();
  }

  async function record(correct) {
    const res = await submitChallenge({
      puzzle_id: puzzle.id,
      correct,
      had_retry: hadRetry,
      time_spent_ms: Date.now() - startedAt.current,
    });
    if (res.rating) setTotalDelta((d) => d + res.rating.delta);
    setSolution(res.solution);
    setSolvedFlags((f) => [...f, correct]);
  }

  async function onMove(move) {
    if (phase !== "thinking") return;
    setLastMove(move);
    setHint(null);
    const res = await checkMove({ puzzle_id: puzzle.id, step, move, attempt: wrongCount });
    if (!res.correct) {
      setHadRetry(true);
      setWrongCount((n) => n + 1);
      setHint(res.hint);
      setPhase("wrong");
      return;
    }
    if (res.done) {
      setFen(res.fen_after);
      await record(true);
      setPhase("solved");
    } else {
      setStep((s) => s + 1);
      setWrongCount(0);
      setFen(res.fen_after);
      if (res.opponent_move) setLastMove(res.opponent_move);
    }
  }

  async function onGiveUp() {
    await record(false);
    setPhase("solved");
  }

  function onNext() {
    if (idx + 1 < puzzles.length) startPuzzle(idx + 1);
    else setPhase("levelDone");
  }

  if (phase === "levelDone") {
    const solvedCount = solvedFlags.filter(Boolean).length;
    const allSolved = solvedCount === puzzles.length;
    return (
      <div className="panel result ok">
        <h2>{level.title} {allSolved ? "通关！🎉" : "结束"}</h2>
        <p>本关做对 <b>{solvedCount}</b> / {puzzles.length} 题。</p>
        {!allSolved && <p className="muted">未全部做对，本关暂未通关——回去补刷做错的题即可解锁下一关。</p>}
        {totalDelta !== 0 && (
          <p>评分变化：<b className={totalDelta >= 0 ? "delta-up" : "delta-down"}>
            {totalDelta >= 0 ? "+" : ""}{totalDelta}
          </b></p>
        )}
        <button onClick={onExit}>返回关卡列表 →</button>
      </div>
    );
  }

  const totalSteps = puzzle.total_steps;
  const sideText = puzzle.side_to_move === "w" ? "红方" : "黑方";

  return (
    <div className="trainer">
      <div className="panel info">
        <div className="info-top">
          <span className="tag" style={{ background: "#ede7f6", color: "#5e35b1" }}>
            {level.title}
          </span>
          <span className="tag">{puzzle.category}</span>
          <span className="tag">难度 {"★".repeat(puzzle.difficulty)}</span>
          {totalSteps > 1 && <span className="tag">共 {totalSteps} 步</span>}
          <span className="due-badge">第 {idx + 1} / {puzzles.length} 题</span>
          <button className="btn-link" onClick={onExit}>退出本关</button>
        </div>
        <div className="step-bar">
          {puzzles.map((_, i) => (
            <div
              key={i}
              className={"step-dot" + (i < idx ? " done" : i === idx ? " current" : "")}
            />
          ))}
        </div>
        <p>轮到 <b>{sideText}</b> 走子，请走出制胜着法
          {totalSteps > 1 ? `（第 ${step + 1} / ${totalSteps} 步）` : ""}。</p>
        {hint && <p className="hint">提示：{hint}</p>}
      </div>

      <Board fen={fen} onMove={onMove} lastMove={lastMove} disabled={phase !== "thinking"} />

      {phase === "wrong" && (
        <div className="panel result bad">
          <h3>✗ 不对</h3>
          <div className="btn-row">
            <button className="btn-retry" onClick={() => { setLastMove(null); setHint(null); setPhase("thinking"); }}>
              再试一次
            </button>
            <button className="btn-giveup" onClick={onGiveUp}>查看答案</button>
          </div>
        </div>
      )}

      {phase === "solved" && (
        <div className={"panel result " + (solvedFlags[idx] ? "ok" : "bad")}>
          <h3>{solvedFlags[idx] ? "✓ 正确" : "正解如下"}</h3>
          <p>正解：<code>{solution.join(" → ")}</code></p>
          <button onClick={onNext}>
            {idx + 1 < puzzles.length ? "下一题 →" : "完成本关 →"}
          </button>
        </div>
      )}
    </div>
  );
}
