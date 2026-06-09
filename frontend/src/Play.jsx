import React from "react";
import Board from "./Board";
import { applyMove } from "./xiangqi";
import { newPlayGame, playMove, importGame, analyzeGame, evalPosition, getPlayEngine } from "./api";

const LEVELS = [
  { key: "easy", label: "入门" },
  { key: "medium", label: "进阶" },
  { key: "hard", label: "高手" },
];

const SIDES = [
  { key: "w", label: "执红先手" },
  { key: "b", label: "执黑后手" },
];

// 把红方视角的评分（cp/mate）转成评估条所需的展示信息。
// humanSide: "w"/"b"，用于给出「你/对方」相对优劣的措辞。
function describeEval({ cp, mate }, humanSide) {
  // 红方占比：评估条左红右黑，50% 为均势
  let redPct = 50;
  let value;
  let label;

  if (mate != null) {
    redPct = mate > 0 ? 100 : 0;
    value = `${mate > 0 ? "+" : "-"}M${Math.abs(mate)}`;
    const humanMate = humanSide === "w" ? mate : -mate;
    label = humanMate > 0 ? `你 ${Math.abs(mate)} 步可杀` : `对方 ${Math.abs(mate)} 步可杀`;
  } else if (cp != null) {
    redPct = 50 + (Math.max(-1000, Math.min(1000, cp)) / 1000) * 50;
    value = `${cp >= 0 ? "+" : ""}${(cp / 100).toFixed(1)}`;
    const abs = Math.abs(cp);
    const side = cp > 0 ? "红方" : "黑方";
    const humanCp = humanSide === "w" ? cp : -cp;
    if (abs < 60) {
      label = "均势";
    } else {
      const deg = abs < 150 ? "略优" : abs < 400 ? "占优" : abs < 900 ? "大优" : "胜势";
      const who = humanCp > 0 ? "你" : "对方";
      label = `${side}${deg}（${who}${deg}）`;
    }
  } else {
    value = "—";
    label = "暂无评分";
  }

  return { redPct, value, label };
}

export default function Play({ onGoReview }) {
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
  const [savedGameId, setSavedGameId] = React.useState(null); // 存盘后的棋局 id
  const [canUndo, setCanUndo] = React.useState(false);
  const [showEval, setShowEval] = React.useState(false); // 是否显示优劣势评估条
  const [evalData, setEvalData] = React.useState(null);  // 红方视角 {cp, mate}
  const [evalLoading, setEvalLoading] = React.useState(false);
  const [engineInfo, setEngineInfo] = React.useState(null); // {engine,label,available}
  const moves = React.useRef([]);                     // 累计着法（红黑交替）
  const history = React.useRef([]);                   // 悔棋快照栈
  const evalReqId = React.useRef(0);                  // 评分请求序号，丢弃过期响应

  // 启动时探测当前实际使用的引擎（Pikafish / 内置搜索），用于界面提示
  React.useEffect(() => {
    getPlayEngine().then(setEngineInfo).catch(() => {});
  }, []);

  // 开启评分后，每当局面稳定（轮到你/对局结束、引擎不在思考）就拉取一次评估。
  // 用序号防止旧请求覆盖新局面的评分。
  React.useEffect(() => {
    if (!showEval || !fen || thinking) return;
    const id = ++evalReqId.current;
    setEvalLoading(true);
    evalPosition(fen)
      .then((d) => { if (id === evalReqId.current) setEvalData(d); })
      .catch(() => { if (id === evalReqId.current) setEvalData(null); })
      .finally(() => { if (id === evalReqId.current) setEvalLoading(false); });
  }, [showEval, fen, thinking]);

  async function start(side, lvl) {
    setThinking(true);
    setOver(null);
    setLastMove(null);
    setSaved(false);
    setSavedGameId(null);
    setCanUndo(false);
    setEvalData(null);
    moves.current = [];
    history.current = [];
    const d = await newPlayGame({ human_side: side, level: lvl });
    setFen(d.fen);
    setLegalMoves(d.legal_moves || []);
    setLastMove(d.engine_move || null);
    if (d.engine_move) moves.current.push(d.engine_move);  // 人执黑时引擎先手
    setStatus(d.status);
    setYourTurn(true);
    setThinking(false);
  }

  // 对局结束：存入复盘棋谱并自动触发分析，形成「对弈→复盘→分析」闭环
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
      const res = await importGame({
        moves: moves.current.join(" "),
        result,
        source: "人机对弈",
        [me]: "我",
        [foe]: `引擎·${lvlLabel}`,
        played_on: new Date().toISOString().slice(0, 10),
      });
      setSaved(true);
      setSavedGameId(res.id);
      // 自动触发后台分析，去复盘时分析多半已就绪
      analyzeGame(res.id).catch(() => {});
    } catch {
      /* 存盘失败不影响对弈本身 */
    }
  }

  async function onMove(move) {
    if (!yourTurn || thinking || over) return;
    // 走子前快照当前“轮到你”的局面，供悔棋 / 出错还原（连人带机回退一个回合）
    const snap = {
      fen, legalMoves, lastMove, status, movesLen: moves.current.length,
    };
    history.current.push(snap);
    setYourTurn(false);
    setThinking(true);
    // 乐观更新：玩家这一手立刻落到棋盘上，不必等引擎思考完才有反馈。
    // 注意：传给后端的仍是走子前的 fen（闭包捕获的旧值），由后端校验并应着。
    setFen(applyMove(fen, move));
    setLastMove(move);
    setLegalMoves([]); // 轮到引擎，先清空己方落点提示
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
      setCanUndo(true);
    } catch {
      // 理论上前端已限制为合法着法，兜底回滚乐观更新
      history.current.pop();
      setFen(snap.fen);
      setLegalMoves(snap.legalMoves);
      setLastMove(snap.lastMove);
      setStatus(snap.status);
      setYourTurn(true);
    } finally {
      setThinking(false);
    }
  }

  function undo() {
    if (thinking || history.current.length === 0) return;
    const snap = history.current.pop();
    moves.current = moves.current.slice(0, snap.movesLen);
    setFen(snap.fen);
    setLegalMoves(snap.legalMoves);
    setLastMove(snap.lastMove);
    setStatus(snap.status);
    setOver(null);
    setSaved(false);
    setYourTurn(true);
    setCanUndo(history.current.length > 0);
  }

  // 初始进入选择界面
  if (!fen) {
    return (
      <div className="panel play-setup">
        <h2>人机对弈</h2>
        <p className="muted">
          和引擎下一盘完整对局。
          {engineInfo && (
            <>
              当前引擎：
              <strong>{engineInfo.label}</strong>
              {engineInfo.available ? "（评分较准）" : "（未装 Pikafish，评分仅供参考）"}
            </>
          )}
        </p>
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
      {/* 状态与操作分两行：状态文案变化（引擎思考中 ↔ 轮到你走）不再挤动按钮换行，棋盘不跳动 */}
      <div className="panel play-status-bar">
        <div className="play-status-line">
          <span className="tag">{LEVELS.find((l) => l.key === level)?.label}</span>
          <span className="tag">{humanSide === "w" ? "你执红" : "你执黑"}</span>
          {engineInfo && (
            <span className="tag" title={engineInfo.available ? "Pikafish 强力引擎" : "未装 Pikafish，使用内置搜索"}>
              {engineInfo.available ? "♟ Pikafish" : "♟ 内置引擎"}
            </span>
          )}
          <span className="play-turn">
            {over
              ? winnerText
              : thinking
              ? "引擎思考中…"
              : status === "check"
              ? "将军！轮到你"
              : "轮到你走"}
          </span>
        </div>
        <div className="play-actions">
          <button
            className={"btn-newgame" + (showEval ? " active" : "")}
            onClick={() => setShowEval((v) => !v)}
          >
            {showEval ? "评分 开" : "评分 关"}
          </button>
          <button
            className="btn-newgame"
            onClick={undo}
            disabled={!canUndo || thinking}
            style={{ opacity: !canUndo || thinking ? 0.5 : 1 }}
          >
            悔棋
          </button>
          <button className="btn-newgame" onClick={() => setFen(null)}>
            重开
          </button>
        </div>
      </div>

      {showEval && (() => {
        const info = describeEval(evalData || {}, humanSide);
        return (
          <div className="panel eval-bar-wrap">
            <div className="eval-bar">
              <div className="eval-bar-red" style={{ width: `${info.redPct}%` }} />
              <span className="eval-bar-value">{evalLoading && !evalData ? "…" : info.value}</span>
            </div>
            <div className="eval-bar-label">
              <span className="muted">{evalLoading ? "评估中…" : info.label}</span>
            </div>
          </div>
        );
      })()}

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
          <p className="muted">
            {saved ? "已存入「复盘」，正在自动分析本局得失。" : "本局未保存。"}
          </p>
          <div className="btn-row" style={{ justifyContent: "center" }}>
            {saved && savedGameId && onGoReview && (
              <button onClick={() => onGoReview(savedGameId)}>📋 去复盘本局</button>
            )}
            <button onClick={() => start(humanSide, level)}>再来一盘</button>
          </div>
        </div>
      )}
    </div>
  );
}
