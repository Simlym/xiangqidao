import React from "react";
import Board from "./Board";
import { newPlayGame, playMove, importGame } from "./api";

const LEVELS = [
  { key: "easy", label: "入门" },
  { key: "medium", label: "进阶" },
  { key: "hard", label: "高手" },
];

const SIDES = [
  { key: "w", label: "执红先手" },
  { key: "b", label: "执黑后手" },
];

export default function Play() {
  const [fen, setFen] = React.useState(null);
  const [legalMoves, setLegalMoves] = React.useState([]);
  const [lastMove, setLastMove] = React.useState(null);
  const [yourTurn, setYourTurn] = React.useState(true);
  const [thinking, setThinking] = React.useState(false);
  const [over, setOver] = React.useState(null); // null | {winner, status}
  const [level, setLevel] = React.useState("medium");
  const [humanSide, setHumanSide] = React.useState("w");
  const [status, setStatus] = React.useState("ongoing");
  const [saved, setSaved] = React.useState(false);   // 对局是否已存入复盘
  const moves = React.useRef([]);                     // 累计着法（红黑交替）

  async function start(side, lvl) {
    setThinking(true);
    setOver(null);
    setLastMove(null);
    setSaved(false);
    moves.current = [];
    const d = await newPlayGame({ human_side: side, level: lvl });
    setFen(d.fen);
    setLegalMoves(d.legal_moves || []);
    setLastMove(d.engine_move || null);
    if (d.engine_move) moves.current.push(d.engine_move);  // 人执黑时引擎先手
    setStatus(d.status);
    setYourTurn(true);
    setThinking(false);
  }

  // 对局结束：存入复盘棋谱，形成「对弈→复盘→分析」闭环
  async function recordGame(winner) {
    if (saved || moves.current.length === 0) return;
    const result =
      winner === "draw"
        ? "和棋"
        : (winner === "human") === (humanSide === "w")
        ? "红胜"
        : "黑胜";
    const me = humanSide === "w" ? "red_player" : "black_player";
    const foe = humanSide === "w" ? "black_player" : "red_player";
    const lvlLabel = LEVELS.find((l) => l.key === level)?.label || level;
    try {
      await importGame({
        moves: moves.current.join(" "),
        result,
        source: "人机对弈",
        [me]: "我",
        [foe]: `引擎·${lvlLabel}`,
        played_on: new Date().toISOString().slice(0, 10),
      });
      setSaved(true);
    } catch {
      /* 存盘失败不影响对弈本身 */
    }
  }

  async function onMove(move) {
    if (!yourTurn || thinking || over) return;
    setYourTurn(false);
    setThinking(true);
    setLastMove(move);
    try {
      const d = await playMove({ fen, move, level });
      moves.current.push(move);                          // 记录人走的着法
      if (d.engine_move) moves.current.push(d.engine_move); // 记录引擎应着
      setFen(d.fen);
      setLastMove(d.engine_move || move);
      setStatus(d.status);
      if (d.game_over) {
        setOver({ winner: d.winner, status: d.status });
        setLegalMoves([]);
        recordGame(d.winner);
      } else {
        setLegalMoves(d.legal_moves || []);
        setYourTurn(true);
      }
    } catch {
      // 理论上前端已限制为合法着法，兜底恢复
      setYourTurn(true);
    } finally {
      setThinking(false);
    }
  }

  // 初始进入选择界面
  if (!fen) {
    return (
      <div className="panel play-setup">
        <h2>人机对弈</h2>
        <p className="muted">和内置引擎下一盘完整对局（未装 Pikafish 时使用内置搜索引擎）。</p>
        <div className="play-setup-row">
          <span className="play-setup-label">先后手</span>
          <div className="seg">
            {SIDES.map((s) => (
              <button
                key={s.key}
                className={"seg-btn" + (humanSide === s.key ? " active" : "")}
                onClick={() => setHumanSide(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="play-setup-row">
          <span className="play-setup-label">难度</span>
          <div className="seg">
            {LEVELS.map((l) => (
              <button
                key={l.key}
                className={"seg-btn" + (level === l.key ? " active" : "")}
                onClick={() => setLevel(l.key)}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
        <button className="btn-start" onClick={() => start(humanSide, level)}>
          开始对弈
        </button>
      </div>
    );
  }

  const winnerText = over
    ? over.winner === "human"
      ? "🎉 你赢了！"
      : over.winner === "engine"
      ? "引擎获胜，再接再厉"
      : "和棋"
    : null;

  return (
    <div className="play">
      <div className="panel play-status-bar">
        <span className="tag">{LEVELS.find((l) => l.key === level)?.label}</span>
        <span className="tag">{humanSide === "w" ? "你执红" : "你执黑"}</span>
        <span className="play-turn">
          {over
            ? winnerText
            : thinking
            ? "引擎思考中…"
            : status === "check"
            ? "将军！轮到你"
            : "轮到你走"}
        </span>
        <button className="btn-newgame" onClick={() => setFen(null)}>
          重开
        </button>
      </div>

      <Board
        fen={fen}
        onMove={onMove}
        lastMove={lastMove}
        disabled={!yourTurn || thinking || !!over}
        legalMoves={over ? [] : legalMoves}
      />

      {over && (
        <div className="panel result ok" style={{ textAlign: "center" }}>
          <h3>{winnerText}</h3>
          <p className="muted">{saved ? "已存入「复盘」，可前往分析本局得失。" : "本局未保存。"}</p>
          <button onClick={() => start(humanSide, level)}>再来一盘</button>
        </div>
      )}
    </div>
  );
}
