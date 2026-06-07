import React from "react";
import Board from "./Board";
import { getNext, submit } from "./api";

export default function Trainer() {
  const [data, setData] = React.useState(null);   // {puzzle, due_count}
  const [result, setResult] = React.useState(null); // 后端返回的判定
  const [lastMove, setLastMove] = React.useState(null);
  const [startedAt, setStartedAt] = React.useState(0);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    setResult(null);
    setLastMove(null);
    const d = await getNext();
    setData(d);
    setStartedAt(Date.now());
    setLoading(false);
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  async function onMove(move) {
    if (!data?.puzzle || result) return;
    setLastMove(move);
    const res = await submit({
      puzzle_id: data.puzzle.id,
      move,
      time_spent_ms: Date.now() - startedAt,
      // 默认 good；答对后用户可在结果区改评分（此处简化，先固定 good）
      self_rating: "good",
    });
    setResult(res);
  }

  if (loading) return <div className="panel">加载中…</div>;
  if (!data?.puzzle)
    return (
      <div className="panel">
        <h2>🎉 今日到期题已清空</h2>
        <p>没有新题可练了。导入更多题库后再来，或明天复习到期题。</p>
      </div>
    );

  const p = data.puzzle;
  const sideText = p.side_to_move === "w" ? "红方" : "黑方";

  return (
    <div className="trainer">
      <div className="panel info">
        <div>
          <span className="tag">{p.category}</span>
          <span className="tag">难度 {"★".repeat(p.difficulty)}</span>
        </div>
        <p>
          轮到 <b>{sideText}</b> 走子，请走出制胜的一手（点起点再点落点）。
        </p>
        <p className="muted">今日到期：{data.due_count} 题</p>
      </div>

      <Board fen={p.fen} onMove={onMove} lastMove={lastMove} disabled={!!result} />

      {result && (
        <div className={"panel result " + (result.correct ? "ok" : "bad")}>
          <h3>{result.correct ? "✓ 正确！" : "✗ 不对"}</h3>
          <p>
            正解：<code>{result.solution.join(" → ")}</code>
          </p>
          <p className="muted">下次复习：{result.next_review}</p>
          <button onClick={load}>下一题</button>
        </div>
      )}
    </div>
  );
}
