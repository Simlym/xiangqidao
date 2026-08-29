// 揭棋纯规则核心。
// FEN 与暗子规则参考 MIT 项目 JieqiBox（Copyright 2025 Velithia），
// 在此重写为无框架依赖的 JavaScript，供 Web、PC 和 Android 共用。

const FILES = "abcdefghi";
const ROLES = {
  K: "king", A: "advisor", B: "elephant", N: "horse",
  R: "chariot", C: "cannon", P: "pawn",
};
const GLYPHS = {
  K: "帅", A: "仕", B: "相", N: "马", R: "车", C: "炮", P: "兵",
  k: "将", a: "士", b: "象", n: "马", r: "车", c: "炮", p: "卒",
  X: "暗", x: "暗",
};
const ROLE_PIECES = {
  king: "K", advisor: "A", elephant: "B", horse: "N",
  chariot: "R", cannon: "C", pawn: "P",
};

export const JIEQI_INITIAL_FEN =
  "xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w A2B2N2R2C2P5a2b2n2r2c2p5 - 0 1";

const INITIAL_ROLES = new Map([
  ["a9", "chariot"], ["i9", "chariot"], ["a0", "chariot"], ["i0", "chariot"],
  ["b9", "horse"], ["h9", "horse"], ["b0", "horse"], ["h0", "horse"],
  ["c9", "elephant"], ["g9", "elephant"], ["c0", "elephant"], ["g0", "elephant"],
  ["d9", "advisor"], ["f9", "advisor"], ["d0", "advisor"], ["f0", "advisor"],
  ["e9", "king"], ["e0", "king"],
  ["b7", "cannon"], ["h7", "cannon"], ["b2", "cannon"], ["h2", "cannon"],
  ...["a", "c", "e", "g", "i"].flatMap((file) => [
    [`${file}6`, "pawn"], [`${file}3`, "pawn"],
  ]),
]);

function sideOf(piece) {
  return piece === piece.toUpperCase() ? "w" : "b";
}

function square(row, col) {
  return `${FILES[col]}${9 - row}`;
}

function parseCounts(text) {
  const counts = {};
  if (!text || text === "-") return counts;
  for (const match of text.matchAll(/([a-zA-Z])(\d+)/g)) counts[match[1]] = Number(match[2]);
  return counts;
}

function formatCounts(counts) {
  const order = "RNBAKCP";
  let result = "";
  for (const upper of order) {
    for (const piece of [upper, upper.toLowerCase()]) {
      if (counts[piece] > 0) result += `${piece}${counts[piece]}`;
    }
  }
  return result || "-";
}

export function parseJieqiFen(fen) {
  const parts = fen.trim().split(/\s+/);
  const rows = parts[0].split("/");
  const board = rows.map((rowText, row) => {
    const cells = [];
    for (const char of rowText) {
      if (/\d/.test(char)) {
        for (let i = 0; i < Number(char); i++) cells.push(null);
      } else {
        cells.push({
          piece: char,
          glyph: GLYPHS[char] || char,
          red: sideOf(char) === "w",
          hidden: char.toLowerCase() === "x",
          initialRole: INITIAL_ROLES.get(square(row, cells.length)) || null,
        });
      }
    }
    while (cells.length < 9) cells.push(null);
    return cells;
  });
  return {
    board,
    side: parts[1] === "b" ? "b" : "w",
    hidden: parseCounts(parts[2]),
    capturedHidden: parseCounts(parts[3]),
    halfmove: Number(parts[4]) || 0,
    fullmove: Number(parts[5]) || 1,
  };
}

export function parseJieqiBoard(fen) {
  return parseJieqiFen(fen).board;
}

function roleAt(state, row, col) {
  const cell = state.board[row]?.[col];
  if (!cell) return null;
  return cell.hidden ? cell.initialRole : ROLES[cell.piece.toUpperCase()];
}

function piecesBetween(board, fromRow, fromCol, toRow, toCol) {
  let count = 0;
  if (fromRow === toRow) {
    for (let col = Math.min(fromCol, toCol) + 1; col < Math.max(fromCol, toCol); col++) {
      if (board[fromRow][col]) count++;
    }
  } else if (fromCol === toCol) {
    for (let row = Math.min(fromRow, toRow) + 1; row < Math.max(fromRow, toRow); row++) {
      if (board[row][fromCol]) count++;
    }
  }
  return count;
}

function mechanical(state, fromRow, fromCol, toRow, toCol) {
  if (toRow < 0 || toRow > 9 || toCol < 0 || toCol > 8) return false;
  const cell = state.board[fromRow]?.[fromCol];
  if (!cell || sideOf(cell.piece) !== state.side) return false;
  const target = state.board[toRow][toCol];
  if (target && sideOf(target.piece) === state.side) return false;
  const role = roleAt(state, fromRow, fromCol);
  const dr = Math.abs(toRow - fromRow);
  const dc = Math.abs(toCol - fromCol);

  if (role === "king") {
    const palaceRows = state.side === "w" ? [7, 9] : [0, 2];
    return dr + dc === 1 && toCol >= 3 && toCol <= 5 && toRow >= palaceRows[0] && toRow <= palaceRows[1];
  }
  if (role === "advisor") {
    if (cell.hidden) {
      const forbidden = new Set(["d9c8", "f9g8", "d0c1", "f0g1"]);
      if (forbidden.has(square(fromRow, fromCol) + square(toRow, toCol))) return false;
    }
    return dr === 1 && dc === 1;
  }
  if (role === "elephant") {
    return dr === 2 && dc === 2 && !state.board[(fromRow + toRow) / 2][(fromCol + toCol) / 2];
  }
  if (role === "horse") {
    if (!((dr === 2 && dc === 1) || (dr === 1 && dc === 2))) return false;
    const legRow = fromRow + (dr === 2 ? (toRow - fromRow) / 2 : 0);
    const legCol = fromCol + (dc === 2 ? (toCol - fromCol) / 2 : 0);
    return !state.board[legRow][legCol];
  }
  if (role === "chariot") return (dr === 0 || dc === 0) && piecesBetween(state.board, fromRow, fromCol, toRow, toCol) === 0;
  if (role === "cannon") {
    if (dr && dc) return false;
    const count = piecesBetween(state.board, fromRow, fromCol, toRow, toCol);
    return target ? count === 1 : count === 0;
  }
  if (role === "pawn") {
    const forward = state.side === "w" ? -1 : 1;
    const crossed = state.side === "w" ? fromRow <= 4 : fromRow >= 5;
    return (toRow - fromRow === forward && dc === 0) || (crossed && dr === 0 && dc === 1);
  }
  return false;
}

function cloneState(state) {
  return { ...state, board: state.board.map((row) => row.map((cell) => cell && { ...cell })) };
}

function kingInCheck(state, side) {
  let king;
  for (let row = 0; row < 10; row++) for (let col = 0; col < 9; col++) {
    const cell = state.board[row][col];
    if (cell && !cell.hidden && cell.piece.toUpperCase() === "K" && sideOf(cell.piece) === side) king = { row, col };
  }
  if (!king) return false;
  const opponent = side === "w" ? "b" : "w";
  const attackState = { ...state, side: opponent };
  for (let row = 0; row < 10; row++) for (let col = 0; col < 9; col++) {
    const cell = state.board[row][col];
    if (!cell || cell.hidden || sideOf(cell.piece) !== opponent) continue;
    if (cell.piece.toUpperCase() === "K" && col === king.col && piecesBetween(state.board, row, col, king.row, king.col) === 0) return true;
    if (cell.piece.toUpperCase() !== "K" && mechanical(attackState, row, col, king.row, king.col)) return true;
  }
  return false;
}

function baseApply(state, move) {
  const fromCol = FILES.indexOf(move[0]);
  const fromRow = 9 - Number(move[1]);
  const toCol = FILES.indexOf(move[2]);
  const toRow = 9 - Number(move[3]);
  const next = cloneState(state);
  next.board[toRow][toCol] = next.board[fromRow][fromCol];
  next.board[fromRow][fromCol] = null;
  return next;
}

export function legalJieqiMoves(fen) {
  const state = parseJieqiFen(fen);
  const moves = [];
  for (let row = 0; row < 10; row++) for (let col = 0; col < 9; col++) {
    const cell = state.board[row][col];
    if (!cell || sideOf(cell.piece) !== state.side) continue;
    for (let toRow = 0; toRow < 10; toRow++) for (let toCol = 0; toCol < 9; toCol++) {
      if (!mechanical(state, row, col, toRow, toCol)) continue;
      const next = baseApply(state, square(row, col) + square(toRow, toCol));
      if (!kingInCheck(next, state.side)) moves.push(square(row, col) + square(toRow, toCol));
    }
  }
  return moves;
}

function chooseFromPool(counts, side, random) {
  const candidates = Object.entries(counts).filter(([piece, count]) => count > 0 && sideOf(piece) === side);
  const total = candidates.reduce((sum, [, count]) => sum + count, 0);
  if (!total) return null;
  let pick = Math.floor(random() * total);
  for (const [piece, count] of candidates) {
    if (pick < count) return piece;
    pick -= count;
  }
  return candidates[0][0];
}

export function availableJieqiReveals(fen, requestedSide = null) {
  const state = parseJieqiFen(fen);
  const side = requestedSide || state.side;
  const order = side === "w" ? "KARBNCP" : "karbncp";
  return order.split("").flatMap((piece) => {
    const count = state.hidden[piece] || 0;
    return count > 0 ? [{ piece, glyph: GLYPHS[piece], count }] : [];
  });
}

function boardPlacement(board) {
  return board.map((row) => {
    let text = "";
    let empty = 0;
    for (const cell of row) {
      if (!cell) empty++;
      else {
        if (empty) text += empty;
        empty = 0;
        text += cell.piece;
      }
    }
    return text + (empty || "");
  }).join("/");
}

export function applyJieqiMove(fen, move, randomOrOptions = Math.random) {
  if (!legalJieqiMoves(fen).includes(move.slice(0, 4))) throw new Error("不合法的揭棋着法");
  const options = typeof randomOrOptions === "function"
    ? { random: randomOrOptions }
    : (randomOrOptions || {});
  const random = options.random || Math.random;
  const identifyCapturedHidden = options.identifyCapturedHidden !== false;
  const state = parseJieqiFen(fen);
  const fromCol = FILES.indexOf(move[0]);
  const fromRow = 9 - Number(move[1]);
  const toCol = FILES.indexOf(move[2]);
  const toRow = 9 - Number(move[3]);
  const moving = state.board[fromRow][fromCol];
  const captured = state.board[toRow][toCol];
  const extras = move.slice(4).split("");
  let reveal = extras.find((piece) => sideOf(piece) === state.side) || null;
  let capturedIdentity = extras.find((piece) => sideOf(piece) !== state.side) || null;

  if (moving.hidden) reveal ||= chooseFromPool(state.hidden, state.side, random);
  if (captured?.hidden && identifyCapturedHidden) {
    capturedIdentity ||= chooseFromPool(state.hidden, state.side === "w" ? "b" : "w", random);
  }
  if (moving.hidden && !reveal) throw new Error("暗子池为空，无法翻子");
  if (captured?.hidden && identifyCapturedHidden && !capturedIdentity) throw new Error("暗子池为空，无法确定被吃暗子");

  if (reveal) state.hidden[reveal] = Math.max(0, (state.hidden[reveal] || 0) - 1);
  if (capturedIdentity) {
    state.hidden[capturedIdentity] = Math.max(0, (state.hidden[capturedIdentity] || 0) - 1);
    state.capturedHidden[capturedIdentity] = (state.capturedHidden[capturedIdentity] || 0) + 1;
  }
  state.board[toRow][toCol] = { ...moving, piece: reveal || moving.piece, hidden: false, glyph: GLYPHS[reveal || moving.piece] };
  state.board[fromRow][fromCol] = null;
  state.side = state.side === "w" ? "b" : "w";
  state.halfmove = captured ? 0 : state.halfmove + 1;
  if (state.side === "w") state.fullmove++;
  return `${boardPlacement(state.board)} ${state.side} ${formatCounts(state.hidden)} ${formatCounts(state.capturedHidden)} ${state.halfmove} ${state.fullmove}`;
}

// 引擎或随机模式有时只返回 4 位坐标。根据走子前后局面补全实际翻子/暗子身份，
// 让保存的棋谱和中文记谱不会丢失“翻马”“吃卒”等信息。
export function completeJieqiMove(fen, move, nextFen) {
  if (!fen || !nextFen || !move || move.length < 4) return move;
  const before = parseJieqiFen(fen);
  const after = parseJieqiFen(nextFen);
  const fromCol = FILES.indexOf(move[0]);
  const fromRow = 9 - Number(move[1]);
  const toCol = FILES.indexOf(move[2]);
  const toRow = 9 - Number(move[3]);
  const moving = before.board[fromRow]?.[fromCol];
  const captured = before.board[toRow]?.[toCol];
  const extras = move.slice(4).split("");

  if (moving?.hidden && !extras.some((piece) => sideOf(piece) === before.side)) {
    const revealed = after.board[toRow]?.[toCol]?.piece;
    if (revealed && sideOf(revealed) === before.side) extras.push(revealed);
  }
  if (captured?.hidden && !extras.some((piece) => sideOf(piece) !== before.side)) {
    const capturedSide = before.side === "w" ? "b" : "w";
    const identity = Object.keys(before.hidden).find((piece) =>
      sideOf(piece) === capturedSide && (after.hidden[piece] || 0) < (before.hidden[piece] || 0)
    );
    if (identity) extras.push(identity);
  }
  return move.slice(0, 4) + extras.join("");
}

function notationPiece(cell) {
  if (!cell) return null;
  if (!cell.hidden) return cell.piece;
  const upper = ROLE_PIECES[cell.initialRole];
  return cell.red ? upper : upper?.toLowerCase();
}

function notationNumber(value, red) {
  return red ? "一二三四五六七八九"[value - 1] : String(value);
}

// 把一条揭棋 UCI 着法转换成中文记谱。暗子按初始位置记子名，
// 扩展字符会显示为“翻马”“吃卒”，例如：兵三进一 翻马。
export function jieqiMoveToChinese(fen, move) {
  if (!fen || !move || move.length < 4) return move;
  try {
    const state = parseJieqiFen(fen);
    const fromCol = FILES.indexOf(move[0]);
    const fromRank = Number(move[1]);
    const fromRow = 9 - fromRank;
    const toCol = FILES.indexOf(move[2]);
    const toRank = Number(move[3]);
    const cell = state.board[fromRow]?.[fromCol];
    const piece = notationPiece(cell);
    if (!cell || !piece || toCol < 0 || Number.isNaN(toRank)) return move;

    const red = sideOf(piece) === "w";
    const name = GLYPHS[piece] || piece;
    const fileNumber = (col) => red ? 9 - col : col + 1;
    const sameFileRanks = [];
    for (let row = 0; row < 10; row++) {
      if (notationPiece(state.board[row][fromCol]) === piece) sameFileRanks.push(9 - row);
    }
    sameFileRanks.sort((a, b) => red ? b - a : a - b);

    let head;
    if (sameFileRanks.length > 1) {
      const index = sameFileRanks.indexOf(fromRank);
      const count = sameFileRanks.length;
      let label;
      if (count === 2) label = index === 0 ? "前" : "后";
      else if (count === 3) label = ["前", "中", "后"][index];
      else if (piece.toUpperCase() === "P") {
        const labels = ["前", "二", "三", "四", "五", "后"];
        label = labels[index] || (index === count - 1 ? "后" : "中");
      } else label = index === 0 ? "前" : index === count - 1 ? "后" : "中";
      head = `${label}${name}`;
    } else {
      head = `${name}${notationNumber(fileNumber(fromCol), red)}`;
    }

    const action = fromRank === toRank
      ? "平"
      : (red ? toRank > fromRank : toRank < fromRank) ? "进" : "退";
    const straight = "RCPK".includes(piece.toUpperCase());
    const target = action === "平" || !straight
      ? notationNumber(fileNumber(toCol), red)
      : notationNumber(Math.abs(toRank - fromRank), red);

    let flip = null;
    let capture = null;
    for (const extra of move.slice(4)) {
      if (sideOf(extra) === state.side && !flip) flip = extra;
      else if (sideOf(extra) !== state.side && !capture) capture = extra;
    }
    const suffix = [
      flip && `翻${GLYPHS[flip] || flip}`,
      capture && `吃${GLYPHS[capture] || capture}`,
    ].filter(Boolean).join(" ");
    return `${head}${action}${target}${suffix ? ` ${suffix}` : ""}`;
  } catch {
    return move;
  }
}

export function jieqiStatus(fen) {
  const state = parseJieqiFen(fen);
  const legal = legalJieqiMoves(fen);
  if (!legal.length) return kingInCheck(state, state.side) ? "checkmate" : "stalemate";
  return kingInCheck(state, state.side) ? "check" : "ongoing";
}

