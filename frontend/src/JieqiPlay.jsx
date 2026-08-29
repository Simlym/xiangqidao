import React from "react";
import Board from "./Board";
import { createEngineManager } from "./core/engine/createEngineManager";
import {
  JIEQI_INITIAL_FEN,
  applyJieqiMove,
  jieqiStatus,
  legalJieqiMoves,
  parseJieqiBoard,
} from "./core/game/jieqi";
import { evalJieqiPosition, importGame } from "./api";

const LEVELS = [
  { key: "easy", label: "入门", depth: 6 },
  { key: "medium", label: "进阶", depth: 10 },
  { key: "hard", label: "高手", depth: 14 },
];
const jieqiEngine = createEngineManager({ variant: "jieqi", remoteEvaluate: evalJieqiPosition });

function winnerFor(status, mover) {
  if (status === "checkmate") return mover;
  if (status === "stalemate") return "draw";
  return null;
}

export default function JieqiPlay({ onOpenSettings }) {
  const [fen, setFen] = React.useState(null);
  const [humanSide, setHumanSide] = React.useState("w");
  const [level, setLevel] = React.useState("medium");
  const [legalMoves, setLegalMoves] = React.useState([]);
  const [lastMove, setLastMove] = React.useState(null);
  const [thinking, setThinking] = React.useState(false);
  const [winner, setWinner] = React.useState(null);
  const [runtimeKind, setRuntimeKind] = React.useState(null);
  const [error, setError] = React.useState("");
  const [moves, setMoves] = React.useState([]);
  const [saved, setSaved] = React.useState(false);
  const positionsRef = React.useRef([]);
  const movesRef = React.useRef([]);

  React.useEffect(() => {
    jieqiEngine.availableKinds().then((kinds) => {
      setRuntimeKind(kinds.includes("native") ? "native" : kinds.includes("wasm") ? "wasm" : "remote");
    });
  }, []);

  const depth = LEVELS.find((item) => item.key === level)?.depth || 10;

  async function engineTurn(position, side) {
    const result = await jieqiEngine.evaluate(position, { depth });
    const legal = legalJieqiMoves(position);
    const baseMove = result.bestMove?.slice(0, 4);
    if (!baseMove || !legal.includes(baseMove)) throw new Error("揭棋引擎返回了不合法着法");
    const next = applyJieqiMove(position, result.bestMove);
    return { fen: next, move: result.bestMove, winner: winnerFor(jieqiStatus(next), side) };
  }

  async function start() {
    setThinking(true);
    setError("");
    setWinner(null);
    setMoves([]);
    setSaved(false);
    movesRef.current = [];
    positionsRef.current = [JIEQI_INITIAL_FEN];
    try {
      let position = JIEQI_INITIAL_FEN;
      if (humanSide === "b") {
        const reply = await engineTurn(position, "engine");
        position = reply.fen;
        setLastMove(reply.move);
        movesRef.current = [reply.move];
        positionsRef.current.push(position);
        setMoves([...movesRef.current]);
      } else {
        setLastMove(null);
      }
      setFen(position);
      setLegalMoves(legalJieqiMoves(position));
    } catch (reason) {
      setError(reason.message || "揭棋引擎不可用");
      setFen(null);
    } finally {
      setThinking(false);
    }
  }

  async function saveGame(finalWinner) {
    if (!movesRef.current.length) return;
    const redWon = finalWinner === "human" ? humanSide === "w" : humanSide === "b";
    const result = finalWinner === "draw" ? "和棋" : redWon ? "红胜" : "黑胜";
    try {
      await importGame({
        variant: "jieqi",
        initial_fen: JIEQI_INITIAL_FEN,
        moves: movesRef.current.join(" "),
        positions: positionsRef.current,
        result,
        source: "揭棋人机对弈",
        red_player: humanSide === "w" ? "我" : "揭棋引擎",
        black_player: humanSide === "b" ? "我" : "揭棋引擎",
        played_on: new Date().toISOString().slice(0, 10),
      });
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }

  async function onMove(move) {
    if (thinking || winner || !legalMoves.includes(move)) return;
    const previous = fen;
    setThinking(true);
    setError("");
    try {
      const afterHuman = applyJieqiMove(previous, move);
      const humanWinner = winnerFor(jieqiStatus(afterHuman), "human");
      if (humanWinner) {
        movesRef.current.push(move);
        positionsRef.current.push(afterHuman);
        setFen(afterHuman);
        setLastMove(move);
        setMoves([...movesRef.current]);
        setLegalMoves([]);
        setWinner(humanWinner);
        saveGame(humanWinner);
        return;
      }
      const reply = await engineTurn(afterHuman, "engine");
      movesRef.current.push(move, reply.move);
      positionsRef.current.push(afterHuman, reply.fen);
      setFen(reply.fen);
      setLastMove(reply.move);
      setMoves([...movesRef.current]);
      setWinner(reply.winner);
      setLegalMoves(reply.winner ? [] : legalJieqiMoves(reply.fen));
      if (reply.winner) saveGame(reply.winner);
    } catch (reason) {
      setFen(previous);
      setError(`${reason.message || "引擎应着失败"}，本步已回退`);
    } finally {
      setThinking(false);
    }
  }

  if (!fen) {
    return (
      <div className="panel play-setup">
        <h2>揭棋人机对弈</h2>
        <p className="muted">暗子按初始位置规则移动，首次移动时随机翻开真实棋子。</p>
        <div className="play-setup-row">
          <span className="play-setup-label">先后手</span>
          <div className="seg">
            {[["w", "执红先手"], ["b", "执黑后手"]].map(([key, label]) => (
              <button key={key} className={"seg-btn" + (humanSide === key ? " active" : "")} onClick={() => setHumanSide(key)}>{label}</button>
            ))}
          </div>
        </div>
        <div className="play-setup-row">
          <span className="play-setup-label">难度</span>
          <div className="seg">
            {LEVELS.map((item) => (
              <button key={item.key} className={"seg-btn" + (level === item.key ? " active" : "")} onClick={() => setLevel(item.key)}>{item.label}</button>
            ))}
          </div>
        </div>
        <div className="engine-setup-summary">
          <div>
            <strong>当前引擎</strong>
            <span>
              {runtimeKind === "native"
                ? "PC 原生揭棋引擎 · 已就绪"
                : runtimeKind === "wasm"
                ? "揭棋 WASM 引擎 · 已就绪"
                : runtimeKind === "remote"
                ? "云端揭棋引擎 · 自动降级可用"
                : "正在检测可用引擎…"}
            </span>
          </div>
          {onOpenSettings && (
            <button className="btn-newgame" onClick={onOpenSettings}>引擎设置</button>
          )}
        </div>
        {error && <div className="import-error">{error}</div>}
        <button className="btn-start" onClick={start} disabled={thinking}>{thinking ? "引擎启动中…" : "开始揭棋"}</button>
      </div>
    );
  }

  return (
    <div className="play">
      <div className="panel play-status-bar">
        <div className="play-status-line">
          <span className="tag">揭棋</span>
          <span className="tag">{humanSide === "w" ? "你执红" : "你执黑"}</span>
          <span className="tag">{runtimeKind === "native" ? "⚡ PC 原生引擎" : runtimeKind === "wasm" ? "⚡ WASM 引擎" : "☁ 云端引擎"}</span>
          <span className="play-turn">{winner ? (winner === "human" ? "你赢了" : winner === "draw" ? "和棋" : "引擎获胜") : thinking ? "引擎思考中…" : "轮到你走"}</span>
          {winner && <span className="tag">{saved ? "已存入复盘" : "正在保存…"}</span>}
        </div>
        <div className="play-actions">
          <button className="btn-newgame" onClick={() => setFen(null)}>新对局</button>
        </div>
      </div>
      {error && <div className="panel import-error">{error}</div>}
      <div className="play-main">
        <div className="play-board-area">
          <Board
            fen={fen}
            onMove={onMove}
            lastMove={lastMove}
            disabled={thinking || Boolean(winner)}
            legalMoves={legalMoves}
            flipped={humanSide === "b"}
            parsePosition={parseJieqiBoard}
          />
        </div>
        <div className="panel move-log">
          <div className="move-log-head"><strong>揭棋着法</strong><span className="muted">{moves.length} 步</span></div>
          <ol className="jieqi-move-list">{moves.map((move, index) => <li key={`${index}-${move}`}>{index + 1}. {move}</li>)}</ol>
        </div>
      </div>
    </div>
  );
}
