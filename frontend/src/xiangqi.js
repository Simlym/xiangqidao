// 象棋 FEN 解析与坐标工具。
// FEN 第一段从 rank9（黑方底线）写到 rank0（红方底线），列 a-i 从左到右。
// UCI 坐标：file=a..i，rank=0..9（红方在下）。

const FILES = "abcdefghi";

// 棋子字符 -> {char, red}
const GLYPH = {
  K: "帅", A: "仕", B: "相", N: "马", R: "车", C: "炮", P: "兵",
  k: "将", a: "士", b: "象", n: "马", r: "车", c: "炮", p: "卒",
};

// 解析 FEN -> 10x9 棋盘，board[row][col]，row0=rank9（顶部）。
export function parseFen(fen) {
  const placement = fen.trim().split(/\s+/)[0];
  const rows = placement.split("/");
  const board = [];
  for (const row of rows) {
    const cells = [];
    for (const ch of row) {
      if (/\d/.test(ch)) {
        for (let i = 0; i < Number(ch); i++) cells.push(null);
      } else {
        cells.push({ piece: ch, glyph: GLYPH[ch] || ch, red: ch === ch.toUpperCase() });
      }
    }
    while (cells.length < 9) cells.push(null);
    board.push(cells);
  }
  return board; // board[0] 是 rank9
}

// 棋盘行列 -> UCI 方格名，如 (row=0,col=8) -> "i9"
export function toSquare(row, col) {
  return FILES[col] + String(9 - row);
}

// 两个方格名拼成 UCI 着法
export function toMove(from, to) {
  return from + to;
}
