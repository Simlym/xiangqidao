import React from "react";
import Board from "./Board";
import { createEngineManager } from "./core/engine/createEngineManager";
import {
  JIEQI_INITIAL_FEN,
  applyJieqiMove,
  availableJieqiReveals,
  completeJieqiMove,
  generateLimitedKnowledgeFen,
  jieqiMoveToChinese,
  jieqiStatus,
  legalJieqiMoves,
  parseJieqiBoard,
  parseJieqiFen,
} from "./core/game/jieqi";
import { evalJieqiPosition, importGame, streamJieqiPosition } from "./api";
import { RUNTIME, runtime } from "./platform/runtime";
import { jieqiPieceImage } from "./jieqiPieceImages";
import EngineAnalysisView from "./components/EngineAnalysisView";

const LEVELS = [
  { key: "easy", label: "入门", depth: 6 },
  { key: "medium", label: "进阶", depth: 10 },
  { key: "hard", label: "高手", depth: 14 },
];
const jieqiEngine = createEngineManager({ variant: "jieqi", remoteEvaluate: evalJieqiPosition, remoteStream: streamJieqiPosition });

function winnerFor(status, mover) {
  if (status === "checkmate") return mover;
  if (status === "stalemate") return "draw";
  return null;
}

function describeJieqiEval(data) {
  const { cp, mate } = data || {};
  if (mate != null) {
    return {
      value: `${mate > 0 ? "+" : "-"}M${Math.abs(mate)}`,
      label: `${mate > 0 ? "红方" : "黑方"}${Math.abs(mate)}步可杀`,
      redPct: mate > 0 ? 100 : 0,
    };
  }
  if (cp == null) return { value: "—", label: "暂无评分", redPct: 50 };
  const absolute = Math.abs(cp);
  const advantage = absolute < 60 ? "均势" : absolute < 150 ? "略优" : absolute < 400 ? "占优" : absolute < 900 ? "大优" : "胜势";
  return {
    // 揭棋引擎直接使用其 UCI 原始评分，和 JieqiBox / PikaJieQi 的显示口径一致。
    // 这里不是标准象棋界面中的“兵值”，不要再按 centipawn 除以 100。
    value: `${cp >= 0 ? "+" : ""}${Math.round(cp)}`,
    label: absolute < 60 ? advantage : `${cp > 0 ? "红方" : "黑方"}${advantage}`,
    redPct: 50 + (Math.max(-1000, Math.min(1000, cp)) / 1000) * 50,
  };
}

const HIDDEN_POOL_PIECES = [
  ["R", "车"], ["N", "马"], ["B", "相"],
  ["A", "仕"], ["C", "炮"], ["P", "兵"],
];

function HiddenPool({ fen, side, label }) {
  const state = parseJieqiFen(fen);
  const red = side === "w";
  const items = HIDDEN_POOL_PIECES.map(([upper, redGlyph]) => {
    const piece = red ? upper : upper.toLowerCase();
    const glyph = red ? redGlyph : ({ R: "车", N: "马", B: "象", A: "士", C: "炮", P: "卒" })[upper];
    return {
      piece,
      glyph,
      remaining: state.hidden[piece] || 0,
      captured: state.capturedHidden[piece] || 0,
    };
  });
  const total = items.reduce((sum, item) => sum + item.remaining, 0);
  return (
    <section className={`jieqi-pool-strip ${red ? "red" : "black"}`} aria-label={`${label}暗子池，剩余 ${total} 枚`}>
      <div className="jieqi-pool-strip-side">
        <strong>{label}暗子池</strong>
        <small>待揭 {total}</small>
      </div>
      <div className="jieqi-pool-strip-pieces">
        {items.map((item) => (
          <span
            className={`jieqi-pool-piece${item.remaining === 0 ? " depleted" : ""}`}
            key={item.piece}
            title={`${item.glyph}：待揭 ${item.remaining} 枚${item.captured ? `，暗子被吃 ${item.captured} 枚` : ""}`}
          >
            <b>{item.glyph}</b>
            <em>{item.remaining}</em>
            {item.captured > 0 && <small>吃{item.captured}</small>}
          </span>
        ))}
      </div>
    </section>
  );
}

function ChineseMoveList({ pairs, desktop = false }) {
  return (
    <ol className={`jieqi-notation-list${desktop ? " desktop-jieqi-moves" : ""}`}>
      {pairs.map(([red, black], index) => (
        <li key={`${index}-${red}-${black}`}>
          <span className="jieqi-move-no">{index + 1}.</span>
          <span className="jieqi-move-red">{red}</span>
          <span className="jieqi-move-black">{black}</span>
        </li>
      ))}
    </ol>
  );
}

export default function JieqiPlay({ onOpenSettings }) {
  const isDesktop = runtime === RUNTIME.TAURI;
  const [fen, setFen] = React.useState(null);
  const [gameMode, setGameMode] = React.useState("human-ai");
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
  const [inspectorTab, setInspectorTab] = React.useState("moves");
  const [pendingFlip, setPendingFlip] = React.useState(null);
  const [analysisEnabled, setAnalysisEnabled] = React.useState(true);
  const [analysisData, setAnalysisData] = React.useState(null);
  const [analysisPosition, setAnalysisPosition] = React.useState(null);
  const [analysisLoading, setAnalysisLoading] = React.useState(false);
  const [analysisError, setAnalysisError] = React.useState("");
  const [analysisMode, setAnalysisMode] = React.useState("movetime");
  const [analysisTime, setAnalysisTime] = React.useState(1000);
  const [analysisDepth, setAnalysisDepth] = React.useState(18);
  const [analysisMultiPv, setAnalysisMultiPv] = React.useState(1);
  const [analysisSearchMoves, setAnalysisSearchMoves] = React.useState([]);
  const [showHint, setShowHint] = React.useState(true);
  const [boardFlipped, setBoardFlipped] = React.useState(false);
  const [boardScale, setBoardScale] = React.useState(1);
  const positionsRef = React.useRef([]);
  const movesRef = React.useRef([]);
  const initialPlyRef = React.useRef(0);
  const analysisReqId = React.useRef(0);
  const analysisSession = React.useRef(null);
  const turnReqId = React.useRef(0);

  React.useEffect(() => {
    jieqiEngine.availableKinds().then((kinds) => {
      setRuntimeKind(kinds.includes("native") ? "native" : kinds.includes("wasm") ? "wasm" : "remote");
    });
  }, []);

  const depth = LEVELS.find((item) => item.key === level)?.depth || 10;

  async function analyzeFreePosition(position) {
    analysisSession.current?.stop();
    const requestId = ++analysisReqId.current;
    setAnalysisLoading(true);
    setAnalysisError("");
    const positionLegalMoves = new Set(legalJieqiMoves(position));
    const options = {
      mode: analysisMode,
      value: analysisMode === "depth" ? analysisDepth : analysisTime,
      depth: analysisDepth,
      multiPv: analysisMultiPv,
      showWdl: true,
      searchMoves: analysisSearchMoves,
      onUpdate(update) {
        if (requestId !== analysisReqId.current) return;
        const rawBestMove = update.bestMove;
        const baseMove = rawBestMove?.slice(0, 4);
        setAnalysisData({
          ...update,
          bestMove: positionLegalMoves.has(baseMove) ? baseMove : null,
          rawBestMove,
        });
        setAnalysisPosition(position);
      },
    };
    const session = jieqiEngine.startAnalysis(position, options);
    analysisSession.current = session;
    try {
      const result = await session.result;
      const baseMove = result.bestMove?.slice(0, 4);
      if (!baseMove || !legalJieqiMoves(position).includes(baseMove)) {
        throw new Error("揭棋引擎没有返回可用的推荐着法");
      }
      if (requestId === analysisReqId.current) {
        setAnalysisData({ ...result, bestMove: baseMove, rawBestMove: result.bestMove });
        setAnalysisPosition(position);
      }
    } catch (reason) {
      if (requestId === analysisReqId.current && reason?.name !== "AbortError") {
        setAnalysisData(null);
        setAnalysisPosition(null);
        setAnalysisError(reason.message || "揭棋分析引擎不可用");
      }
    } finally {
      if (requestId === analysisReqId.current) {
        setAnalysisLoading(false);
        if (analysisSession.current === session) analysisSession.current = null;
      }
    }
  }

  React.useEffect(() => {
    if (gameMode !== "free" || !fen || !analysisEnabled || pendingFlip || winner) return;
    analyzeFreePosition(fen);
    return () => analysisSession.current?.stop();
  }, [gameMode, fen, analysisEnabled, pendingFlip, winner, analysisMode, analysisTime, analysisDepth, analysisMultiPv, analysisSearchMoves]);

  React.useEffect(() => {
    setAnalysisSearchMoves((moves) => moves.length ? [] : moves);
  }, [fen]);

  function toggleAnalysis() {
    if (analysisEnabled) {
      analysisReqId.current++;
      analysisSession.current?.stop();
      analysisSession.current = null;
      setAnalysisEnabled(false);
      setAnalysisLoading(false);
      setAnalysisData(null);
      setAnalysisPosition(null);
      setAnalysisError("");
    } else {
      setAnalysisEnabled(true);
    }
  }

  async function engineTurn(position, side) {
    const engineSide = parseJieqiFen(position).side;
    const enginePosition = generateLimitedKnowledgeFen(position, engineSide);
    const result = await jieqiEngine.evaluate(enginePosition, { depth });
    const legal = legalJieqiMoves(position);
    const baseMove = result.bestMove?.slice(0, 4);
    if (!baseMove || !legal.includes(baseMove)) throw new Error("揭棋引擎返回了不合法着法");
    const next = applyJieqiMove(position, result.bestMove, { perspective: engineSide });
    return {
      fen: next,
      // 搜索 FEN 中的扩展身份只是有限知识样本；棋谱必须从真实前后局面补全。
      move: completeJieqiMove(position, baseMove, next),
      winner: winnerFor(jieqiStatus(next), side),
    };
  }

  async function start() {
    const requestId = ++turnReqId.current;
    setThinking(gameMode === "human-ai");
    setError("");
    setWinner(null);
    setMoves([]);
    setSaved(false);
    setPendingFlip(null);
    setAnalysisData(null);
    setAnalysisPosition(null);
    setAnalysisError("");
    setShowHint(true);
    setBoardFlipped(gameMode === "human-ai" && humanSide === "b");
    movesRef.current = [];
    positionsRef.current = [JIEQI_INITIAL_FEN];
    initialPlyRef.current = 0;
    try {
      let position = JIEQI_INITIAL_FEN;
      if (gameMode === "human-ai" && humanSide === "b") {
        const reply = await engineTurn(position, "engine");
        if (requestId !== turnReqId.current) return;
        position = reply.fen;
        setLastMove(reply.move);
        movesRef.current = [reply.move];
        positionsRef.current.push(position);
        initialPlyRef.current = 1;
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
    const redWon = gameMode === "free"
      ? finalWinner === "w"
      : finalWinner === "human" ? humanSide === "w" : humanSide === "b";
    const result = finalWinner === "draw" ? "和棋" : redWon ? "红胜" : "黑胜";
    try {
      await importGame({
        variant: "jieqi",
        initial_fen: JIEQI_INITIAL_FEN,
        moves: movesRef.current.join(" "),
        positions: positionsRef.current,
        result,
        source: gameMode === "free" ? "揭棋自由翻子" : "揭棋人机对弈",
        red_player: gameMode === "free" ? "红方" : humanSide === "w" ? "我" : "揭棋引擎",
        black_player: gameMode === "free" ? "黑方" : humanSide === "b" ? "我" : "揭棋引擎",
        played_on: new Date().toISOString().slice(0, 10),
      });
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }

  function commitFreeMove(move, reveal = "") {
    const previous = fen;
    const mover = parseJieqiFen(previous).side;
    const recordedMove = `${move}${reveal}`;
    try {
      setAnalysisError("");
      const next = applyJieqiMove(previous, recordedMove, { identifyCapturedHidden: false });
      const finalWinner = winnerFor(jieqiStatus(next), mover);
      movesRef.current.push(recordedMove);
      positionsRef.current.push(next);
      setFen(next);
      setLastMove(recordedMove);
      setMoves([...movesRef.current]);
      setLegalMoves(finalWinner ? [] : legalJieqiMoves(next));
      setWinner(finalWinner);
      setPendingFlip(null);
      if (finalWinner) saveGame(finalWinner);
    } catch (reason) {
      setPendingFlip(null);
      setError(reason.message || "自由翻子失败");
    }
  }

  function requestFreeMove(move) {
    const state = parseJieqiFen(fen);
    const fromCol = "abcdefghi".indexOf(move[0]);
    const fromRow = 9 - Number(move[1]);
    const moving = state.board[fromRow]?.[fromCol];
    if (!moving?.hidden) {
      commitFreeMove(move);
      return;
    }
    const choices = availableJieqiReveals(fen, state.side);
    if (choices.length === 1) {
      commitFreeMove(move, choices[0].piece);
      return;
    }
    setPendingFlip({ move, side: state.side, choices });
  }

  function randomPendingFlip() {
    if (!pendingFlip?.choices?.length) return;
    const pool = pendingFlip.choices.flatMap((item) => Array(item.count).fill(item.piece));
    commitFreeMove(pendingFlip.move, pool[Math.floor(Math.random() * pool.length)]);
  }

  async function onMove(move) {
    if (thinking || winner || !legalMoves.includes(move)) return;
    setError("");
    if (gameMode === "free") {
      requestFreeMove(move);
      return;
    }
    const previous = fen;
    let afterHuman;
    let recordedHumanMove;
    let humanWinner;
    try {
      afterHuman = applyJieqiMove(previous, move);
      recordedHumanMove = completeJieqiMove(previous, move, afterHuman);
      humanWinner = winnerFor(jieqiStatus(afterHuman), "human");
    } catch (reason) {
      setError(reason.message || "走子失败");
      return;
    }

    // 先提交用户着法，让棋盘和动画立即更新；引擎搜索只负责稍后追加应着。
    movesRef.current.push(recordedHumanMove);
    positionsRef.current.push(afterHuman);
    setFen(afterHuman);
    setLastMove(recordedHumanMove);
    setMoves([...movesRef.current]);
    setLegalMoves([]);

    if (humanWinner) {
      setWinner(humanWinner);
      saveGame(humanWinner);
      return;
    }

    const requestId = ++turnReqId.current;
    setThinking(true);
    // 给 React 和浏览器一次绘制机会，避免本地引擎启动挤占落子这一帧。
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      const reply = await engineTurn(afterHuman, "engine");
      if (requestId !== turnReqId.current) return;
      movesRef.current.push(reply.move);
      positionsRef.current.push(reply.fen);
      setFen(reply.fen);
      setLastMove(reply.move);
      setMoves([...movesRef.current]);
      setWinner(reply.winner);
      setLegalMoves(reply.winner ? [] : legalJieqiMoves(reply.fen));
      if (reply.winner) saveGame(reply.winner);
    } catch (reason) {
      if (requestId === turnReqId.current) {
        setError(`${reason.message || "引擎应着失败"}，你的走子已保留，可悔棋后重试`);
      }
    } finally {
      if (requestId === turnReqId.current) setThinking(false);
    }
  }

  if (!fen) {
    return (
      <div className="panel play-setup">
        <h2>揭棋对弈</h2>
        <p className="muted">
          {gameMode === "free"
            ? "双方面对面走棋；暗子首次移动时，可从本方剩余暗子池自由指定身份。"
            : "与揭棋引擎对弈；暗子首次移动时随机翻开真实棋子。"}
        </p>
        <div className="play-setup-row">
          <span className="play-setup-label">模式</span>
          <div className="seg">
            {[["human-ai", "人机对战"], ["free", "自由翻子"]].map(([key, label]) => (
              <button key={key} className={"seg-btn" + (gameMode === key ? " active" : "")} onClick={() => setGameMode(key)}>{label}</button>
            ))}
          </div>
        </div>
        {gameMode === "human-ai" && <>
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
        </>}
        {gameMode === "free" && <>
          <div className="play-setup-row">
            <span className="play-setup-label">分析</span>
            <div className="seg">
              {LEVELS.map((item) => (
                <button key={item.key} className={"seg-btn" + (level === item.key ? " active" : "")} onClick={() => setLevel(item.key)}>{item.label}</button>
              ))}
            </div>
          </div>
          <div className="engine-setup-summary">
            <div>
              <strong>局面分析</strong>
              <span>
                {runtimeKind === "native"
                  ? "PC 原生揭棋引擎 · 自动分析与走子提示"
                  : runtimeKind === "wasm"
                  ? "揭棋 WASM 引擎 · 自动分析与走子提示"
                  : runtimeKind === "remote"
                  ? "云端揭棋引擎 · 自动分析与走子提示"
                  : "正在检测可用引擎…"}
              </span>
            </div>
            {onOpenSettings && <button className="btn-newgame" onClick={onOpenSettings}>引擎设置</button>}
          </div>
        </>}
        {error && <div className="import-error">{error}</div>}
        <button className="btn-start" onClick={start} disabled={thinking}>
          {thinking ? "引擎启动中…" : gameMode === "free" ? "开始自由翻子" : "开始揭棋"}
        </button>
      </div>
    );
  }

  function undo() {
    if (thinking) return;
    if (pendingFlip) {
      setPendingFlip(null);
      return;
    }
    const minimum = initialPlyRef.current;
    if (movesRef.current.length <= minimum) return;

    let targetPly = movesRef.current.length - 1;
    if (gameMode === "human-ai") {
      while (
        targetPly > minimum &&
        parseJieqiFen(positionsRef.current[targetPly]).side !== humanSide
      ) targetPly--;
    }

    analysisReqId.current++;
    turnReqId.current++;
    const restoredFen = positionsRef.current[targetPly];
    movesRef.current = movesRef.current.slice(0, targetPly);
    positionsRef.current = positionsRef.current.slice(0, targetPly + 1);
    setFen(restoredFen);
    setMoves([...movesRef.current]);
    setLastMove(movesRef.current.at(-1) || null);
    setLegalMoves(legalJieqiMoves(restoredFen));
    setWinner(null);
    setSaved(false);
    setError("");
    setAnalysisError("");
    setShowHint(true);
  }

  const currentSide = parseJieqiFen(fen).side;
  const currentStatus = jieqiStatus(fen);
  const inCheck = currentStatus === "check";
  const currentTurnText = gameMode === "free"
    ? winner
      ? winner === "draw" ? "和棋" : winner === "w" ? "红方获胜" : "黑方获胜"
      : pendingFlip
        ? `请选择${pendingFlip.side === "w" ? "红方" : "黑方"}翻出的棋子`
        : `轮到${currentSide === "w" ? "红方" : "黑方"}走`
    : winner
      ? winner === "human" ? "你赢了" : winner === "draw" ? "和棋" : "引擎获胜"
      : thinking ? "引擎思考中…" : "轮到你走";
  const engineDisplay = runtimeKind === "native"
    ? "揭棋引擎 · 本地"
    : runtimeKind === "wasm"
    ? "揭棋 WASM 引擎"
    : "揭棋云端引擎";
  const levelLabel = LEVELS.find((item) => item.key === level)?.label;
  const evalInfo = describeJieqiEval(analysisData);
  const canUndo = moves.length > initialPlyRef.current || Boolean(pendingFlip);
  const notationTexts = moves.map((move, index) =>
    jieqiMoveToChinese(positionsRef.current[index] || JIEQI_INITIAL_FEN, move)
  );
  const notationPairs = [];
  for (let index = 0; index < notationTexts.length; index += 2) {
    notationPairs.push([notationTexts[index], notationTexts[index + 1] || ""]);
  }
  const analysisIsCurrent = analysisPosition === fen;
  const bestMoveText = analysisData?.bestMove
    ? jieqiMoveToChinese(analysisPosition || fen, analysisData.bestMove)
    : "";
  const analysisRuntime = analysisData?.runtime === "native"
    ? "PC 原生揭棋引擎"
    : analysisData?.runtime === "wasm"
    ? "揭棋 WASM 引擎"
    : "云端揭棋引擎";

  return (
    <div className="play">
      {pendingFlip && (
        <div className="jieqi-flip-overlay" role="dialog" aria-modal="true" aria-label="翻子提示">
          <div className="panel jieqi-flip-dialog">
            <strong>请选择要翻开的棋子</strong>
            <p>{pendingFlip.side === "w" ? "红方" : "黑方"}暗子池 · {pendingFlip.move.slice(0, 4)}</p>
            <div className="jieqi-flip-choices">
              {pendingFlip.choices.map((item) => (
                <button
                  key={item.piece}
                  className={pendingFlip.side === "w" ? "red" : "black"}
                  onClick={() => commitFreeMove(pendingFlip.move, item.piece)}
                  aria-label={`${item.glyph}，剩余 ${item.count} 枚`}
                >
                  <span>{item.glyph}</span>
                  <small>×{item.count}</small>
                </button>
              ))}
            </div>
            <button className="btn-newgame" onClick={randomPendingFlip}>随机翻开</button>
          </div>
        </div>
      )}
      {!isDesktop && <div className="panel play-status-bar">
        <div className="play-status-line">
          <span className="tag">揭棋</span>
          <span className="tag">{gameMode === "free" ? "自由翻子" : humanSide === "w" ? "你执红" : "你执黑"}</span>
          {gameMode === "human-ai" && <span className="tag">{runtimeKind === "native" ? "⚡ PC 原生引擎" : runtimeKind === "wasm" ? "⚡ WASM 引擎" : "☁ 云端引擎"}</span>}
          <span className="play-turn">{currentTurnText}</span>
          {winner && <span className="tag">{saved ? "已存入复盘" : "正在保存…"}</span>}
        </div>
        <div className="play-actions">
          {gameMode === "free" && <>
            <button className="btn-newgame" onClick={toggleAnalysis}>{analysisEnabled ? "停止分析" : "开始分析"}</button>
            <button
              className="btn-newgame"
              onClick={() => analysisData ? setShowHint((value) => !value) : analyzeFreePosition(fen)}
              disabled={analysisLoading}
            >
              {analysisLoading ? "分析中…" : analysisData ? showHint ? "隐藏提示" : "走子提示" : "走子提示"}
            </button>
          </>}
          <button className="btn-newgame" onClick={undo} disabled={!canUndo || thinking}>悔棋</button>
          <button className="btn-newgame" onClick={() => setBoardFlipped((value) => !value)}>翻转棋盘</button>
          <button className="btn-newgame" onClick={() => { turnReqId.current++; setThinking(false); setPendingFlip(null); setFen(null); }}>新对局</button>
        </div>
      </div>}
      {!isDesktop && error && <div className="panel import-error">{error}</div>}
      <div className="play-main">
        <div className="play-board-area">
          {inCheck && (
            <div className="jieqi-check-alert" role="status" aria-live="assertive">
              <strong>将军</strong>
              <span>{currentSide === "w" ? "红帅" : "黑将"}受到攻击</span>
            </div>
          )}
          {isDesktop && (
            <div className="desktop-board-playerbar">
              <span>{gameMode === "free" ? "自由翻子" : "电脑"}</span>
              <strong>{currentTurnText}</strong>
            </div>
          )}
          <HiddenPool
            fen={fen}
            side={boardFlipped ? "w" : "b"}
            label={boardFlipped ? "红方" : "黑方"}
          />
          <div className="jieqi-board-stage">
            {gameMode === "free" && (
              <div
                className={`jieqi-eval-rail${boardFlipped ? " flipped" : ""}`}
                style={{
                  height: `${462 * boardScale}px`,
                  marginTop: `${22 * boardScale}px`,
                  marginBottom: `${22 * boardScale}px`,
                  "--jieqi-eval-pct": `${evalInfo.redPct}%`,
                }}
                title={analysisLoading ? "局势评估中" : `${evalInfo.label} ${evalInfo.value}`}
                aria-label={`局势评估：${analysisLoading ? "分析中" : `${evalInfo.label} ${evalInfo.value}`}`}
              >
                <div className="jieqi-eval-rail-red" style={{ height: `${evalInfo.redPct}%` }} />
                <div className="jieqi-eval-rail-divider" aria-hidden="true" />
                <span>{analysisLoading && !analysisData ? "…" : evalInfo.value}</span>
              </div>
            )}
            <Board
              fen={fen}
              onMove={onMove}
              lastMove={lastMove}
              disabled={thinking || Boolean(winner) || Boolean(pendingFlip)}
              legalMoves={legalMoves}
              hintMove={gameMode === "free" && showHint && !pendingFlip && analysisIsCurrent ? analysisData?.bestMove || null : null}
              flipped={boardFlipped}
              checkedSide={inCheck ? currentSide : null}
              parsePosition={parseJieqiBoard}
              pieceImage={jieqiPieceImage}
              maxScale={1.75}
              onScaleChange={setBoardScale}
              fitContainerHeight={isDesktop}
              reservedBottomHeight={46}
            />
          </div>
          <HiddenPool
            fen={fen}
            side={boardFlipped ? "b" : "w"}
            label={boardFlipped ? "黑方" : "红方"}
          />
        </div>
        {isDesktop ? (
          <aside className="panel move-log desktop-play-inspector desktop-jieqi-inspector">
            <div className="desktop-game-summary">
              <strong>本局信息</strong>
              <span>{gameMode === "free" ? "双人手动走棋 · 自由指定翻子" : `${humanSide === "w" ? "你执红" : "你执黑"} · ${levelLabel}`}</span>
              <span>{gameMode === "free" ? `当前${currentSide === "w" ? "红方" : "黑方"}走` : engineDisplay}</span>
              {winner && <span>{saved ? "棋局已存入复盘" : "正在保存棋局…"}</span>}
            </div>

            <div className="desktop-inspector-tabs" role="tablist" aria-label="揭棋对局信息">
              <button
                className={inspectorTab === "moves" ? "active" : ""}
                onClick={() => setInspectorTab("moves")}
                role="tab"
                aria-selected={inspectorTab === "moves"}
              >
                棋谱
              </button>
              <button
                className={inspectorTab === "info" ? "active" : ""}
                onClick={() => setInspectorTab("info")}
                role="tab"
                aria-selected={inspectorTab === "info"}
              >
                {gameMode === "free" ? "分析" : "信息"}
              </button>
            </div>

            <div className="desktop-inspector-body">
              {inspectorTab === "moves" && (
                moves.length > 0 ? (
                  <ChineseMoveList pairs={notationPairs} desktop />
                ) : (
                  <div className="desktop-inspector-empty">揭棋对局刚刚开始<br />走子后将在这里记录棋谱</div>
                )
              )}
              {inspectorTab === "info" && (
                <div className="desktop-analysis-pane">
                  {gameMode === "free" && (
                    <div className="desktop-analysis-section jieqi-engine-analysis">
                      <div className="eval-bar">
                        <div className="eval-bar-red" style={{ width: `${evalInfo.redPct}%` }} />
                        <span className="eval-bar-value">{analysisLoading && !analysisData ? "…" : evalInfo.value}</span>
                      </div>
                      <p>{evalInfo.label}</p>
                      <div className="engine-analysis-controls">
                        <select value={analysisMode} onChange={(event) => setAnalysisMode(event.target.value)} aria-label="分析模式">
                          <option value="movetime">限时分析</option>
                          <option value="depth">深度分析</option>
                          {runtimeKind !== "remote" && <option value="infinite">无限分析</option>}
                        </select>
                        {analysisMode === "movetime" && <select value={analysisTime} onChange={(event) => setAnalysisTime(Number(event.target.value))} aria-label="分析时间">
                          <option value={500}>0.5 秒</option><option value={1000}>1 秒</option><option value={3000}>3 秒</option><option value={5000}>5 秒</option>
                        </select>}
                        {analysisMode === "depth" && <input type="number" min="1" max="30" value={analysisDepth} onChange={(event) => setAnalysisDepth(Math.max(1, Math.min(30, Number(event.target.value) || 1)))} aria-label="分析深度" />}
                        <select value={analysisMultiPv} onChange={(event) => setAnalysisMultiPv(Number(event.target.value))} aria-label="候选线路数">
                          <option value={1}>最佳 1 线</option><option value={3}>候选 3 线</option><option value={5}>候选 5 线</option>
                        </select>
                      </div>
                      {(analysisLoading || analysisData) && <>
                        <div className="jieqi-best-move">
                          <span>最佳着法</span>
                          <strong title={analysisData?.bestMove || ""}>{bestMoveText || "—"}</strong>
                        </div>
                        {analysisSearchMoves.length > 0 && <button className="engine-searchmove-clear" onClick={() => setAnalysisSearchMoves([])}>正在限定 {analysisSearchMoves[0]} · 取消限定</button>}
                      </>}
                      {(analysisLoading || analysisData) && (
                        <EngineAnalysisView
                          fen={analysisPosition || fen}
                          data={analysisData}
                          loading={analysisLoading}
                          variant="jieqi"
                          onAnalyzeMove={analysisIsCurrent ? (move) => setAnalysisSearchMoves([move]) : null}
                          log={jieqiEngine.getLog()}
                        />
                      )}
                      {(analysisLoading || analysisData) && <small>{analysisRuntime}{analysisMode === "infinite" ? " · 无限分析" : ""}</small>}
                      {analysisError && <div className="import-error">{analysisError}</div>}
                      {!analysisEnabled && !analysisData && !analysisError && <p>分析已停止，可从下方重新开启。</p>}
                    </div>
                  )}
                  <div className="desktop-analysis-section">
                    <strong>揭棋规则</strong>
                    <p>{gameMode === "free" ? "暗子首次移动时由走子方指定身份；吃掉未揭开的暗子不会改变对方暗子池。" : "暗子按初始位置规则移动，首次移动时随机翻开真实棋子。"}</p>
                  </div>
                  {gameMode === "human-ai" && <div className="desktop-analysis-section">
                    <strong>当前引擎</strong>
                    <p>{engineDisplay}</p>
                  </div>}
                  {error && <div className="import-error">{error}</div>}
                </div>
              )}
            </div>

            <div className="desktop-inspector-actions desktop-jieqi-actions">
              {gameMode === "free" && <>
                <button className="primary" onClick={toggleAnalysis}>{analysisEnabled ? "停止分析" : "开始分析"}</button>
                <button
                  onClick={() => analysisData ? setShowHint((value) => !value) : analyzeFreePosition(fen)}
                  disabled={analysisLoading}
                >
                  {analysisLoading ? "分析中…" : analysisData && showHint ? "隐藏提示" : "走子提示"}
                </button>
              </>}
              <button onClick={undo} disabled={!canUndo || thinking}>悔棋</button>
              <button onClick={() => setBoardFlipped((value) => !value)}>{boardFlipped ? "恢复方向" : "翻转棋盘"}</button>
              <button className="danger wide" onClick={() => { turnReqId.current++; setThinking(false); setPendingFlip(null); setFen(null); }}>新对局</button>
            </div>
          </aside>
        ) : (
          <div className="panel move-log">
            <div className="move-log-head"><strong>揭棋着法</strong><span className="muted">{moves.length} 步</span></div>
            {gameMode === "free" && (
              <div className="jieqi-mobile-analysis">
                <strong>{analysisLoading ? "分析中…" : evalInfo.value}</strong>
                <span>{analysisLoading ? "正在搜索最佳着法" : analysisData ? `${evalInfo.label} · 推荐 ${bestMoveText}` : analysisError || "分析已停止"}</span>
              </div>
            )}
            <ChineseMoveList pairs={notationPairs} />
          </div>
        )}
      </div>
    </div>
  );
}
