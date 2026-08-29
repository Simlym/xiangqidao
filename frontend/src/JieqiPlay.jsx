import React from "react";
import Board from "./Board";
import { createEngineManager } from "./core/engine/createEngineManager";
import {
  JIEQI_INITIAL_FEN,
  applyJieqiMove,
  availableJieqiReveals,
  jieqiStatus,
  legalJieqiMoves,
  parseJieqiBoard,
  parseJieqiFen,
} from "./core/game/jieqi";
import { evalJieqiPosition, importGame } from "./api";
import { RUNTIME, runtime } from "./platform/runtime";

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
    value: `${cp >= 0 ? "+" : ""}${(cp / 100).toFixed(2)}`,
    label: absolute < 60 ? advantage : `${cp > 0 ? "红方" : "黑方"}${advantage}`,
    redPct: 50 + (Math.max(-1000, Math.min(1000, cp)) / 1000) * 50,
  };
}

function HiddenPool({ fen }) {
  return (
    <div className="jieqi-hidden-pools" aria-label="剩余暗子池">
      {[["b", "黑方"], ["w", "红方"]].map(([side, label]) => (
        <div className={`jieqi-hidden-pool ${side === "w" ? "red" : "black"}`} key={side}>
          <strong>{label}</strong>
          <span>
            {availableJieqiReveals(fen, side).map((item) => `${item.glyph}×${item.count}`).join(" ") || "已空"}
          </span>
        </div>
      ))}
    </div>
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
  const [analysisLoading, setAnalysisLoading] = React.useState(false);
  const [analysisError, setAnalysisError] = React.useState("");
  const [showHint, setShowHint] = React.useState(true);
  const positionsRef = React.useRef([]);
  const movesRef = React.useRef([]);
  const analysisReqId = React.useRef(0);

  React.useEffect(() => {
    jieqiEngine.availableKinds().then((kinds) => {
      setRuntimeKind(kinds.includes("native") ? "native" : kinds.includes("wasm") ? "wasm" : "remote");
    });
  }, []);

  const depth = LEVELS.find((item) => item.key === level)?.depth || 10;

  async function analyzeFreePosition(position) {
    const requestId = ++analysisReqId.current;
    setAnalysisLoading(true);
    setAnalysisError("");
    try {
      const result = await jieqiEngine.evaluate(position, { depth });
      const baseMove = result.bestMove?.slice(0, 4);
      if (!baseMove || !legalJieqiMoves(position).includes(baseMove)) {
        throw new Error("揭棋引擎没有返回可用的推荐着法");
      }
      if (requestId === analysisReqId.current) {
        setAnalysisData({ ...result, bestMove: baseMove, rawBestMove: result.bestMove });
      }
    } catch (reason) {
      if (requestId === analysisReqId.current) {
        setAnalysisData(null);
        setAnalysisError(reason.message || "揭棋分析引擎不可用");
      }
    } finally {
      if (requestId === analysisReqId.current) setAnalysisLoading(false);
    }
  }

  React.useEffect(() => {
    if (gameMode !== "free" || !fen || !analysisEnabled || pendingFlip || winner) return;
    analyzeFreePosition(fen);
  }, [gameMode, fen, analysisEnabled, pendingFlip, winner, depth]);

  function toggleAnalysis() {
    if (analysisEnabled) {
      analysisReqId.current++;
      setAnalysisEnabled(false);
      setAnalysisLoading(false);
      setAnalysisData(null);
      setAnalysisError("");
    } else {
      setAnalysisEnabled(true);
    }
  }

  async function engineTurn(position, side) {
    const result = await jieqiEngine.evaluate(position, { depth });
    const legal = legalJieqiMoves(position);
    const baseMove = result.bestMove?.slice(0, 4);
    if (!baseMove || !legal.includes(baseMove)) throw new Error("揭棋引擎返回了不合法着法");
    const next = applyJieqiMove(position, result.bestMove);
    return { fen: next, move: result.bestMove, winner: winnerFor(jieqiStatus(next), side) };
  }

  async function start() {
    setThinking(gameMode === "human-ai");
    setError("");
    setWinner(null);
    setMoves([]);
    setSaved(false);
    setPendingFlip(null);
    setAnalysisData(null);
    setAnalysisError("");
    setShowHint(true);
    movesRef.current = [];
    positionsRef.current = [JIEQI_INITIAL_FEN];
    try {
      let position = JIEQI_INITIAL_FEN;
      if (gameMode === "human-ai" && humanSide === "b") {
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
      setAnalysisData(null);
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
    setThinking(true);
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

  const currentSide = parseJieqiFen(fen).side;
  const currentTurnText = gameMode === "free"
    ? winner
      ? winner === "draw" ? "和棋" : winner === "w" ? "红方获胜" : "黑方获胜"
      : pendingFlip ? `请选择${pendingFlip.side === "w" ? "红方" : "黑方"}翻出的棋子` : `轮到${currentSide === "w" ? "红方" : "黑方"}走`
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
          <button className="btn-newgame" onClick={() => { setPendingFlip(null); setFen(null); }}>新对局</button>
        </div>
      </div>}
      {!isDesktop && error && <div className="panel import-error">{error}</div>}
      <div className="play-main">
        <div className="play-board-area">
          {isDesktop && (
            <div className="desktop-board-playerbar">
              <span>{gameMode === "free" ? "自由翻子" : "电脑"}</span>
              <strong>{currentTurnText}</strong>
            </div>
          )}
          <Board
            fen={fen}
            onMove={onMove}
            lastMove={lastMove}
            disabled={thinking || Boolean(winner) || Boolean(pendingFlip)}
            legalMoves={legalMoves}
            hintMove={gameMode === "free" && showHint && !pendingFlip ? analysisData?.bestMove || null : null}
            flipped={gameMode === "human-ai" && humanSide === "b"}
            parsePosition={parseJieqiBoard}
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

            <HiddenPool fen={fen} />

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
                  <ol className="jieqi-move-list desktop-jieqi-moves">
                    {moves.map((move, index) => <li key={`${index}-${move}`}>{move}</li>)}
                  </ol>
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
                      <p>{analysisLoading ? "正在分析当前局面…" : evalInfo.label}</p>
                      {analysisData && <>
                        <div className="jieqi-best-move">
                          <span>最佳着法</span>
                          <strong>{analysisData.bestMove}</strong>
                        </div>
                        {analysisData.pv?.length > 0 && (
                          <div className="jieqi-pv"><span>完整推演</span><code>{analysisData.pv.join(" ")}</code></div>
                        )}
                        <small>{analysisRuntime} · 深度 {depth}</small>
                      </>}
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
              <button className="danger wide" onClick={() => { setPendingFlip(null); setFen(null); }}>新对局</button>
            </div>
          </aside>
        ) : (
          <div className="panel move-log">
            <div className="move-log-head"><strong>揭棋着法</strong><span className="muted">{moves.length} 步</span></div>
            {gameMode === "free" && <HiddenPool fen={fen} />}
            {gameMode === "free" && (
              <div className="jieqi-mobile-analysis">
                <strong>{analysisLoading ? "分析中…" : evalInfo.value}</strong>
                <span>{analysisLoading ? "正在搜索最佳着法" : analysisData ? `${evalInfo.label} · 推荐 ${analysisData.bestMove}` : analysisError || "分析已停止"}</span>
              </div>
            )}
            <ol className="jieqi-move-list">{moves.map((move, index) => <li key={`${index}-${move}`}>{move}</li>)}</ol>
          </div>
        )}
      </div>
    </div>
  );
}
