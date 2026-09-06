import { applyMove, INITIAL_FEN, parseFen, uciToChinese } from "../../domain/xiangqi/xiangqi.js";

export const LEVELS = [
  { key: "easy", label: "入门" },
  { key: "medium", label: "进阶" },
  { key: "hard", label: "高手" },
];

export const SIDES = [
  { key: "w", label: "执红先手" },
  { key: "b", label: "执黑后手" },
];

export const PLAY_DEPTH = { easy: 6, medium: 10, hard: 14 };

export function terminalResult(status, winner) {
  if (status === "checkmate") return { game_over: true, winner };
  if (status === "stalemate") return { game_over: true, winner: "draw" };
  return { game_over: false, winner: null };
}

export function describeEval({ cp, mate }, humanSide) {
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
    if (abs < 60) label = "均势";
    else {
      const degree = abs < 150 ? "略优" : abs < 400 ? "占优" : abs < 900 ? "大优" : "胜势";
      label = `${side}${degree}（${humanCp > 0 ? "你" : "对方"}${degree}）`;
    }
  } else {
    value = "—";
    label = "暂无评分";
  }
  return { redPct, value, label };
}

export function moveLogItems(uciMoves) {
  let fen = INITIAL_FEN;
  const texts = uciMoves.map((uci) => {
    const text = uciToChinese(fen, uci);
    fen = applyMove(fen, uci);
    return text;
  });
  const pairs = [];
  for (let index = 0; index < texts.length; index += 2) pairs.push([texts[index], texts[index + 1] || ""]);
  return pairs;
}

export function isCapture(fen, move) {
  const board = parseFen(fen);
  const col = "abcdefghi".indexOf(move[2]);
  const row = 9 - Number(move[3]);
  return Boolean(board[row]?.[col]);
}

const CAPTURE_TYPES = ["R", "N", "C", "B", "A", "P"];
const CAPTURE_GLYPH = {
  R: "车", N: "马", C: "炮", B: "相", A: "仕", P: "兵",
  r: "车", n: "马", c: "炮", b: "象", a: "士", p: "卒",
};
const INITIAL_COUNT = { R: 2, N: 2, C: 2, B: 2, A: 2, P: 5 };
const PIECE_VALUE = { R: 9, N: 4, C: 4.5, B: 2, A: 2, P: 1 };

export function capturedPieces(fen) {
  const counts = {};
  for (const piece of fen.trim().split(/\s+/)[0]) {
    if (/[a-zA-Z]/.test(piece)) counts[piece] = (counts[piece] || 0) + 1;
  }
  const red = [];
  const black = [];
  let diff = 0;
  for (const type of CAPTURE_TYPES) {
    const blackType = type.toLowerCase();
    for (let index = counts[type] || 0; index < INITIAL_COUNT[type]; index++) {
      red.push(CAPTURE_GLYPH[type]);
      diff -= PIECE_VALUE[type];
    }
    for (let index = counts[blackType] || 0; index < INITIAL_COUNT[type]; index++) {
      black.push(CAPTURE_GLYPH[blackType]);
      diff += PIECE_VALUE[type];
    }
  }
  return { red, black, diff };
}

export function fmtMoveTime(ms) {
  if (ms == null) return "";
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m${Math.round(seconds % 60)}s`;
}

export function fmtDuration(ms) {
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}秒` : `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
}
