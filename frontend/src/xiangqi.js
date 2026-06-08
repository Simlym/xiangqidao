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

// 红方数字：file/步数用中文一~九；黑方用阿拉伯 1~9
const RED_NUMS = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];
function numStr(n, red) {
  return red ? RED_NUMS[n - 1] : String(n);
}

// 把 UCI 着法转成中文棋谱表示（如 "炮二平五"、"马8进7"）。
// fen 必须是该步走子之前的局面，用于确定棋子种类、红黑及同列同子的前后关系。
// 无法解析时回退返回原始 UCI。
export function uciToChinese(fen, uci) {
  if (!fen || !uci || uci.length < 4) return uci;
  const placement = fen.trim().split(/\s+/)[0];
  const rows = placement.split("/"); // rows[0] = rank9（顶部）

  // board[rank][col]，rank 0..9（红方在下），col 0..8（a..i）
  const board = Array.from({ length: 10 }, () => Array(9).fill(null));
  for (let r = 0; r < rows.length && r < 10; r++) {
    const rank = 9 - r;
    let col = 0;
    for (const ch of rows[r]) {
      if (/\d/.test(ch)) col += Number(ch);
      else { if (col < 9) board[rank][col] = ch; col++; }
    }
  }

  const fromCol = FILES.indexOf(uci[0]);
  const fromRank = Number(uci[1]);
  const toCol = FILES.indexOf(uci[2]);
  const toRank = Number(uci[3]);
  if (fromCol < 0 || toCol < 0 || Number.isNaN(fromRank) || Number.isNaN(toRank)) return uci;

  const piece = board[fromRank]?.[fromCol];
  if (!piece) return uci;
  const red = piece === piece.toUpperCase();
  const name = GLYPH[piece] || piece;

  // 列号：红方从右到左数（col8→一），黑方从左到右数（col0→1）
  const fileNum = (col) => (red ? 9 - col : col + 1);

  // 同列同种棋子用「前/后」标识，否则用列号
  const sameCol = [];
  for (let rk = 0; rk < 10; rk++) {
    if (board[rk][fromCol] === piece) sameCol.push(rk);
  }
  let head;
  if (sameCol.length >= 2) {
    // 越靠近对方越「前」：红方 rank 大者在前，黑方 rank 小者在前
    sameCol.sort((a, b) => (red ? b - a : a - b));
    const pos = sameCol.indexOf(fromRank);
    let posWord;
    if (sameCol.length === 2) posWord = pos === 0 ? "前" : "后";
    else if (sameCol.length === 3) posWord = ["前", "中", "后"][pos];
    else posWord = numStr(pos + 1, red); // 罕见：多兵同列
    head = posWord + name;
  } else {
    head = name + numStr(fileNum(fromCol), red);
  }

  let action, target;
  if (fromRank === toRank) {
    action = "平";
    target = numStr(fileNum(toCol), red);
  } else {
    const forward = red ? toRank > fromRank : toRank < fromRank;
    action = forward ? "进" : "退";
    // 车炮兵帅走直线，进退用「步数」；马相仕走斜/拐，进退用「目标列号」
    const straight = "RCPK".includes(piece.toUpperCase());
    target = straight
      ? numStr(Math.abs(toRank - fromRank), red)
      : numStr(fileNum(toCol), red);
  }

  return head + action + target;
}

// 把 UCI 着法应用到 FEN，返回新 FEN（与后端 xiangqi_utils.apply_move 对齐，不做合法性校验）。
// 用于前端乐观更新：玩家落子后立即在棋盘上呈现，无需等待引擎应着。
export function applyMove(fen, uci) {
  const parts = fen.trim().split(/\s+/);
  const side = parts[1] || "w";
  const rest = parts.slice(2).length ? parts.slice(2) : ["-", "-", "0", "1"];

  // placement -> 10x9 原始棋子字符棋盘
  const board = parts[0].split("/").map((rowStr) => {
    const row = [];
    for (const ch of rowStr) {
      if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) row.push(null);
      else row.push(ch);
    }
    while (row.length < 9) row.push(null);
    return row;
  });

  const fromRow = 9 - Number(uci[1]);
  const fromCol = FILES.indexOf(uci[0]);
  const toRow = 9 - Number(uci[3]);
  const toCol = FILES.indexOf(uci[2]);
  board[toRow][toCol] = board[fromRow][fromCol];
  board[fromRow][fromCol] = null;

  const placement = board
    .map((row) => {
      let seg = "";
      let empty = 0;
      for (const cell of row) {
        if (cell === null) empty++;
        else {
          if (empty) { seg += empty; empty = 0; }
          seg += cell;
        }
      }
      if (empty) seg += empty;
      return seg;
    })
    .join("/");

  const newSide = side === "w" ? "b" : "w";
  return [placement, newSide, ...rest].join(" ");
}
