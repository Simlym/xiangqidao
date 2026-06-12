import React from "react";
import Board from "./Board";
import { applyMove, uciToChinese, parseFen, INITIAL_FEN } from "./xiangqi";
import {
  newPlayGame, playMove, importGame, analyzeGame, evalPosition,
  getPlayEngine, getBookMoves, getHint, coachHintMove,
} from "./api";
import { localEval, localEngineReady } from "./localEngine";
import {
  playSound, soundMuted, setSoundMuted,
  soundTheme, setSoundTheme, SOUND_THEMES,
} from "./sounds";

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

// 把 UCI 着法序列转成中文棋谱并按回合配对：[["炮二平五","马8进7"], ...]。
// 对局总是从标准初始局面开始，逐步重放即可得到每步走子前的局面。
function moveLogItems(uciMoves) {
  let f = INITIAL_FEN;
  const texts = uciMoves.map((uci) => {
    const t = uciToChinese(f, uci);
    f = applyMove(f, uci);
    return t;
  });
  const pairs = [];
  for (let i = 0; i < texts.length; i += 2) {
    pairs.push([texts[i], texts[i + 1] || ""]);
  }
  return pairs;
}

// 目标格上有子即为吃子（fen 为走子前的局面），用于区分走子/吃子音效
function isCapture(fen, move) {
  const board = parseFen(fen);
  const col = "abcdefghi".indexOf(move[2]);
  const row = 9 - Number(move[3]);
  return Boolean(board[row]?.[col]);
}

// 被吃子统计：初始子力减去当前局面存量。展示顺序按子力价值：车马炮相仕兵。
const CAPT_TYPES = ["R", "N", "C", "B", "A", "P"];
const CAPT_GLYPH = {
  R: "车", N: "马", C: "炮", B: "相", A: "仕", P: "兵",
  r: "车", n: "马", c: "炮", b: "象", a: "士", p: "卒",
};
const INIT_NUM = { R: 2, N: 2, C: 2, B: 2, A: 2, P: 5 };
const PIECE_VAL = { R: 9, N: 4, C: 4.5, B: 2, A: 2, P: 1 };
function capturedPieces(fen) {
  const cnt = {};
  for (const ch of fen.trim().split(/\s+/)[0]) {
    if (/[a-zA-Z]/.test(ch)) cnt[ch] = (cnt[ch] || 0) + 1;
  }
  const red = [];   // 红方被吃的子
  const black = []; // 黑方被吃的子
  let diff = 0;     // 子力差（>0 红方占优）
  for (const t of CAPT_TYPES) {
    const lt = t.toLowerCase();
    for (let i = cnt[t] || 0; i < INIT_NUM[t]; i++) {
      red.push(CAPT_GLYPH[t]);
      diff -= PIECE_VAL[t];
    }
    for (let i = cnt[lt] || 0; i < INIT_NUM[t]; i++) {
      black.push(CAPT_GLYPH[lt]);
      diff += PIECE_VAL[t];
    }
  }
  return { red, black, diff };
}

// 每步用时：10 秒内保留一位小数，整分钟以上转 分'秒"
function fmtMoveTime(ms) {
  if (ms == null) return "";
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)}s`;
  if (s < 60) return `${Math.round(s)}s`;
  return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
}

// 全局总用时：X分Y秒
function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}秒` : `${Math.floor(s / 60)}分${s % 60}秒`;
}

export default function Play({ onGoReview, user, onCreditsChanged, onRequireLogin }) {
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
  const [localReady, setLocalReady] = React.useState(false); // 浏览器本地引擎是否就绪
  const [showBook, setShowBook] = React.useState(false);  // 云库参考面板开关
  const [bookData, setBookData] = React.useState(null);   // {available, moves}
  const [bookLoading, setBookLoading] = React.useState(false);
  const [hint, setHint] = React.useState(null);           // {move, text, source}
  const [hintLoading, setHintLoading] = React.useState(false);
  const [coach, setCoach] = React.useState(null);          // AI 详解 {text} | {disabled: true}
  const [coachLoading, setCoachLoading] = React.useState(false);
  const [moveLog, setMoveLog] = React.useState([]);        // moves.current 的可渲染副本
  const [fenCopied, setFenCopied] = React.useState(false);
  const [muted, setMuted] = React.useState(soundMuted);     // 音效开关（持久化）
  const [soundKey, setSoundKey] = React.useState(soundTheme); // 音效主题（持久化）
  const [overDismissed, setOverDismissed] = React.useState(false); // 结果浮层被关闭，露出终局棋盘
  const [timesLog, setTimesLog] = React.useState([]);       // 每步用时（ms），与 moveLog 对齐
  const moves = React.useRef([]);                     // 累计着法（红黑交替）
  const moveTimes = React.useRef([]);                 // 每步用时（ms），与 moves 对齐
  const turnStart = React.useRef(0);                  // 本方思考开始时刻
  const history = React.useRef([]);                   // 悔棋快照栈
  const evalReqId = React.useRef(0);                  // 评分请求序号，丢弃过期响应
  const logRef = React.useRef(null);                  // 棋谱滚动容器
  const keysRef = React.useRef({});                   // 键盘快捷键的最新处理函数

  // 新着法出现时棋谱自动滚到最底部，最新一着始终可见
  React.useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [moveLog]);

  // 键盘快捷键：Ctrl/Cmd+Z 悔棋，H 提示。经 ref 转发，监听器只挂一次。
  React.useEffect(() => {
    const onKey = (e) => {
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target.isContentEditable) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        keysRef.current.undo?.();
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "h") {
        keysRef.current.hint?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 启动时探测当前实际使用的引擎（Pikafish / 内置搜索），用于界面提示；
  // 同时探测浏览器本地引擎（public/engine/ 下有产物即启用，评分不再占用服务器）
  React.useEffect(() => {
    getPlayEngine().then(setEngineInfo).catch(() => {});
    localEngineReady().then(setLocalReady).catch(() => {});
  }, []);

  // 开启评分后，每当局面稳定（轮到你/对局结束、引擎不在思考）就拉取一次评估。
  // 优先用浏览器本地引擎（失败自动降级到服务器）。用序号防止旧请求覆盖新局面。
  React.useEffect(() => {
    if (!showEval || !fen || thinking) return;
    const id = ++evalReqId.current;
    setEvalLoading(true);
    const request = localReady
      ? localEval(fen).catch(() => evalPosition(fen))
      : evalPosition(fen);
    request
      .then((d) => { if (id === evalReqId.current) setEvalData(d); })
      .catch(() => { if (id === evalReqId.current) setEvalData(null); })
      .finally(() => { if (id === evalReqId.current) setEvalLoading(false); });
  }, [showEval, fen, thinking, localReady]);

  // 云库参考：轮到自己时查询当前局面的库着法（含评分/胜率）
  React.useEffect(() => {
    if (!showBook || !fen || thinking || over) return;
    let alive = true;
    setBookLoading(true);
    getBookMoves(fen)
      .then((d) => { if (alive) setBookData(d); })
      .catch(() => { if (alive) setBookData(null); })
      .finally(() => { if (alive) setBookLoading(false); });
    return () => { alive = false; };
  }, [showBook, fen, thinking, over]);

  // 局面一变，旧提示与 AI 详解即作废
  React.useEffect(() => { setHint(null); setCoach(null); }, [fen]);

  // 提示：本地引擎 → 服务器（云库命中则秒回）
  async function requestHint() {
    if (!yourTurn || thinking || over || hintLoading || !fen) return;
    setHintLoading(true);
    try {
      let move = null;
      let source = "";
      if (localReady) {
        try {
          const r = await localEval(fen, { depth: 14 });
          move = r.bestMove;
          source = "本地引擎";
        } catch { /* 降级到服务器 */ }
      }
      if (!move) {
        const r = await getHint(fen);
        move = r.move;
        source = r.source === "book" ? "云库" : "服务器引擎";
      }
      setHint(move ? { move, text: uciToChinese(fen, move), source } : null);
    } catch {
      setHint(null);
    } finally {
      setHintLoading(false);
    }
  }

  // AI 教练详解推荐着法的意图（需登录并消耗积分；未配置 AI 时按钮隐藏）
  async function requestCoach() {
    if (!hint?.move || coachLoading || !fen) return;
    if (!user) {
      onRequireLogin?.();
      return;
    }
    setCoachLoading(true);
    try {
      const r = await coachHintMove(fen, hint.move);
      setCoach(r.enabled ? { text: r.text || "（AI 暂时没有返回点评）" } : { disabled: true });
    } catch (e) {
      if (e.status === 401) onRequireLogin?.();
      setCoach({ error: e.message || "AI 详解失败" });
    } finally {
      onCreditsChanged?.();
      setCoachLoading(false);
    }
  }

  async function copyFen() {
    if (!fen) return;
    try {
      await navigator.clipboard.writeText(fen);
      setFenCopied(true);
      setTimeout(() => setFenCopied(false), 1500);
    } catch { /* 剪贴板不可用时静默 */ }
  }

  async function start(side, lvl) {
    setThinking(true);
    setOver(null);
    setOverDismissed(false);
    setLastMove(null);
    setSaved(false);
    setSavedGameId(null);
    setCanUndo(false);
    setEvalData(null);
    moves.current = [];
    moveTimes.current = [];
    history.current = [];
    const t0 = Date.now();
    const d = await newPlayGame({ human_side: side, level: lvl });
    setFen(d.fen);
    setLegalMoves(d.legal_moves || []);
    setLastMove(d.engine_move || null);
    if (d.engine_move) {
      moves.current.push(d.engine_move);  // 人执黑时引擎先手
      moveTimes.current.push(Date.now() - t0);
      playSound("move");
    }
    setMoveLog([...moves.current]);
    setTimesLog([...moveTimes.current]);
    setStatus(d.status);
    setYourTurn(true);
    setThinking(false);
    turnStart.current = Date.now();
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
      onCreditsChanged?.(); // 对弈奖励可能已入账
      // 自动触发后台分析，去复盘时分析多半已就绪
      analyzeGame(res.id).catch(() => {});
    } catch {
      /* 存盘失败不影响对弈本身 */
    }
  }

  async function onMove(move) {
    if (!yourTurn || thinking || over) return;
    const humanMs = Date.now() - turnStart.current; // 本步思考用时
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
    playSound(isCapture(fen, move) ? "capture" : "move");
    try {
      const t0 = Date.now();
      const d = await playMove({ fen, move, level });
      moves.current.push(move);                          // 记录人走的着法
      moveTimes.current.push(humanMs);
      if (d.engine_move) {
        moves.current.push(d.engine_move); // 记录引擎应着
        moveTimes.current.push(Date.now() - t0);
        // 引擎应着是否吃子要看玩家走完后的中间局面
        playSound(isCapture(applyMove(fen, move), d.engine_move) ? "capture" : "move");
      }
      setMoveLog([...moves.current]);
      setTimesLog([...moveTimes.current]);
      setFen(d.fen);
      setLastMove(d.engine_move || move);
      setStatus(d.status);
      if (d.game_over) {
        setOver({ winner: d.winner, status: d.status });
        setOverDismissed(false);
        setLegalMoves([]);
        const verdict =
          d.winner === "human" ? "win" : d.winner === "draw" ? "draw" : "lose";
        setTimeout(() => playSound(verdict), 300); // 错开落子声
        recordGame(d.winner);
      } else {
        if (d.status === "check") setTimeout(() => playSound("check"), 250);
        setLegalMoves(d.legal_moves || []);
        setYourTurn(true);
        turnStart.current = Date.now();
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

  // 认输：按引擎获胜结束本局，正常走存盘/分析闭环
  function resign() {
    if (over || thinking) return;
    if (!window.confirm("确定认输本局吗？")) return;
    setOver({ winner: "engine", status: "resigned" });
    setOverDismissed(false);
    setLegalMoves([]);
    setYourTurn(false);
    playSound("lose");
    recordGame("engine");
  }

  function undo() {
    if (thinking || history.current.length === 0) return;
    const snap = history.current.pop();
    moves.current = moves.current.slice(0, snap.movesLen);
    moveTimes.current = moveTimes.current.slice(0, snap.movesLen);
    setMoveLog([...moves.current]);
    setTimesLog([...moveTimes.current]);
    setFen(snap.fen);
    setLegalMoves(snap.legalMoves);
    setLastMove(snap.lastMove);
    setStatus(snap.status);
    setOver(null);
    setSaved(false);
    setYourTurn(true);
    setCanUndo(history.current.length > 0);
    turnStart.current = Date.now();
  }

  // 快捷键经 ref 调用，始终拿到本次渲染的最新闭包
  keysRef.current.undo = undo;
  keysRef.current.hint = requestHint;

  // 音效切换：木质 → 清脆 → 电子 → 静音 循环，切到新音色立即试听一声
  function cycleSound() {
    const order = [...SOUND_THEMES.map((t) => t.key), "muted"];
    const cur = muted ? "muted" : soundKey;
    const next = order[(order.indexOf(cur) + 1) % order.length];
    if (next === "muted") {
      setMuted(true);
      setSoundMuted(true);
    } else {
      setMuted(false);
      setSoundMuted(false);
      setSoundKey(next);
      setSoundTheme(next);
      playSound("move");
    }
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
      : over.status === "resigned"
      ? "你认输了，下盘再战"
      : over.winner === "engine"
      ? "引擎获胜，再接再厉"
      : "和棋"
    : null;

  const capt = capturedPieces(fen);          // 双方被吃的子与子力差
  const totalMs = timesLog.reduce((a, b) => a + b, 0); // 全局累计用时

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
          {localReady && (
            <span className="tag" title="评估/提示在你的浏览器内计算，不占用服务器">
              ⚡ 本地分析
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
            className={"btn-newgame" + (showBook ? " active" : "")}
            onClick={() => setShowBook((v) => !v)}
            title="查看云库收录的本局面着法与评分"
          >
            云库
          </button>
          <button
            className="btn-newgame"
            onClick={requestHint}
            disabled={!yourTurn || thinking || !!over || hintLoading}
            style={{ opacity: !yourTurn || thinking || over || hintLoading ? 0.5 : 1 }}
            title="让引擎推荐一步（快捷键 H，本地引擎/云库优先）"
          >
            {hintLoading ? "思考中…" : "提示"}
          </button>
          <button
            className="btn-newgame"
            onClick={undo}
            disabled={!canUndo || thinking}
            style={{ opacity: !canUndo || thinking ? 0.5 : 1 }}
            title="悔棋（Ctrl+Z）"
          >
            悔棋
          </button>
          <button
            className="btn-newgame"
            onClick={cycleSound}
            title="点击切换音效：木质 → 清脆 → 电子 → 静音"
          >
            {muted
              ? "🔇 静音"
              : `🔊 ${SOUND_THEMES.find((t) => t.key === soundKey)?.label || ""}`}
          </button>
          <button
            className="btn-newgame"
            onClick={resign}
            disabled={!!over || thinking}
            style={{ opacity: over || thinking ? 0.5 : 1 }}
            title="放弃本局，判引擎获胜"
          >
            认输
          </button>
          {over && overDismissed && (
            <button className="btn-newgame" onClick={() => setOverDismissed(false)}>
              查看结果
            </button>
          )}
          <button
            className="btn-newgame"
            onClick={() => {
              if (
                !over &&
                moves.current.length > 0 &&
                !window.confirm("对局尚未结束，确定放弃本局重新开始吗？")
              )
                return;
              setFen(null);
            }}
          >
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

      {hint && (
        <div className="panel hint-strip">
          💡 推荐：<strong>{hint.text}</strong>
          <span className="muted">（{hint.source}）</span>
          {!coach && (
            <button
              className="btn-newgame hint-coach-btn"
              onClick={requestCoach}
              disabled={coachLoading}
            >
              {coachLoading ? "AI 思考中…" : "🤖 AI 详解"}
            </button>
          )}
          {coach?.text && (
            <div className="analysis-explanation ai-explain">{coach.text}</div>
          )}
          {coach?.disabled && (
            <div className="muted" style={{ marginTop: 6 }}>
              未启用 AI 点评（管理员可在后台配置大模型）
            </div>
          )}
          {coach?.error && (
            <div className="import-error" style={{ marginTop: 6 }}>{coach.error}</div>
          )}
        </div>
      )}

      {showBook && (
        <div className="panel book-panel">
          <div className="book-panel-head">
            <strong>云库着法</strong>
            <span className="muted">
              {bookLoading
                ? "查询中…"
                : !bookData || !bookData.available
                ? "云库暂不可用"
                : bookData.moves.length === 0
                ? "云库未收录此局面"
                : "点击着法直接走子（评分为走子方视角）"}
            </span>
          </div>
          {bookData?.available && bookData.moves.length > 0 && (
            <div className="book-moves">
              {bookData.moves.slice(0, 8).map((m) => {
                const playable = yourTurn && !thinking && !over && legalMoves.includes(m.uci);
                return (
                  <button
                    key={m.uci}
                    className="book-move"
                    disabled={!playable}
                    onClick={() => playable && onMove(m.uci)}
                    title={m.note || m.uci}
                  >
                    <span className="book-move-name">{uciToChinese(fen, m.uci)}</span>
                    {m.score != null && (
                      <span className={"book-move-score" + (m.score >= 0 ? " pos" : " neg")}>
                        {m.score > 0 ? "+" : ""}{m.score}
                      </span>
                    )}
                    {m.winrate != null && (
                      <span className="book-move-rate">{m.winrate.toFixed(0)}%</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* PC：棋盘居左、棋谱在右侧伴随显示；移动端自动堆叠回上下布局 */}
      <div className="play-main">
        <div className="play-board-area">
          <Board
            fen={fen}
            onMove={onMove}
            lastMove={lastMove}
            disabled={!yourTurn || thinking || !!over}
            legalMoves={over ? [] : legalMoves}
            hintMove={hint?.move || null}
            flipped={humanSide === "b"}
          />

          {/* 被吃子展示：有吃子后出现，直观看出物质差 */}
          {capt.red.length + capt.black.length > 0 && (
            <div className="panel captured-bar">
              <div className="captured-row">
                <span className="captured-label">红方失子</span>
                {capt.red.map((g, i) => (
                  <span key={i} className="captured-piece red">{g}</span>
                ))}
              </div>
              <div className="captured-row">
                <span className="captured-label">黑方失子</span>
                {capt.black.map((g, i) => (
                  <span key={i} className="captured-piece black">{g}</span>
                ))}
                {Math.abs(capt.diff) >= 1 && (
                  <span className={"captured-diff" + (capt.diff > 0 ? " red" : "")}>
                    {capt.diff > 0 ? "红方" : "黑方"}子力 +{Math.abs(capt.diff).toFixed(1).replace(/\.0$/, "")}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* 对局结束：结果面板直接覆盖在棋盘中央，可关闭查看终局 */}
          {over && !overDismissed && (
            <div className="play-over">
              <div className="panel result ok" style={{ textAlign: "center" }}>
                <button
                  className="play-over-close"
                  onClick={() => setOverDismissed(true)}
                  title="关闭，查看终局棋盘"
                >
                  ×
                </button>
                <h3>{winnerText}</h3>
                <p className="muted">
                  共 {Math.ceil(moveLog.length / 2)} 回合
                  {totalMs > 0 && ` · 用时 ${fmtDuration(totalMs)}`}
                  <br />
                  {saved ? "已存入「复盘」，正在自动分析本局得失。" : "本局未保存。"}
                </p>
                <div className="btn-row" style={{ justifyContent: "center" }}>
                  {saved && savedGameId && onGoReview && (
                    <button onClick={() => onGoReview(savedGameId)}>📋 去复盘本局</button>
                  )}
                  <button onClick={() => start(humanSide, level)}>再来一盘</button>
                </div>
              </div>
            </div>
          )}
        </div>

        {moveLog.length > 0 && (
          <div className="panel move-log">
            <div className="move-log-head">
              <strong>棋谱</strong>
              <button className="btn-newgame" onClick={copyFen}>
                {fenCopied ? "已复制" : "复制 FEN"}
              </button>
            </div>
            <ol className="move-log-list" ref={logRef}>
              {moveLogItems(moveLog).map((pair, i) => (
                <li key={i}>
                  <span className="move-log-no">{i + 1}.</span>
                  <span className={"move-log-cell" + (moveLog.length - 1 === i * 2 ? " latest" : "")}>
                    {pair[0] || "…"}
                    {timesLog[i * 2] != null && (
                      <i className="move-time">{fmtMoveTime(timesLog[i * 2])}</i>
                    )}
                  </span>
                  <span className={"move-log-cell" + (moveLog.length - 1 === i * 2 + 1 ? " latest" : "")}>
                    {pair[1] || ""}
                    {pair[1] && timesLog[i * 2 + 1] != null && (
                      <i className="move-time">{fmtMoveTime(timesLog[i * 2 + 1])}</i>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
