import React from "react";
import { parseFen, toSquare } from "./xiangqi";

// 棋盘几何：棋子落在 9 路 × 10 线的交叉点上。
const COLS = 9; // 路（a-i）
const ROWS = 10; // 线（0-9）
const CELL = 46; // 相邻交叉点间距
const PAD = 24; // 边距（给边线棋子留出空间）
const W = (COLS - 1) * CELL; // 棋盘线区域宽
const H = (ROWS - 1) * CELL; // 棋盘线区域高
const SW = W + 2 * PAD; // SVG 总宽
const SH = H + 2 * PAD; // SVG 总高

const px = (col) => PAD + col * CELL;
const py = (row) => PAD + row * CELL;

const LINE = "#5a3d22";

// 炮位、兵位的「╬」定位标记。
function positionMarks() {
  const pts = [
    [2, 1], [2, 7], [7, 1], [7, 7], // 炮位
    [3, 0], [3, 2], [3, 4], [3, 6], [3, 8], // 黑兵位
    [6, 0], [6, 2], [6, 4], [6, 6], [6, 8], // 红兵位
  ];
  const segs = [];
  const d = 4; // 离交叉点的间隙
  const L = 6; // 短线长度
  for (const [row, col] of pts) {
    const cx = px(col);
    const cy = py(row);
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      if (sx < 0 && col === 0) continue; // 左边线无左标记
      if (sx > 0 && col === COLS - 1) continue; // 右边线无右标记
      const x0 = cx + sx * d;
      const y0 = cy + sy * d;
      segs.push([x0, y0, x0 + sx * L, y0]); // 横
      segs.push([x0, y0, x0, y0 + sy * L]); // 竖
    }
  }
  return segs;
}

const MARKS = positionMarks();

// 点击式走子：先点起点，再点终点，回调 onMove(uciMove)。
// 传入 legalMoves（UCI 数组）时，限制只能走合法着法并提示落点。
export default function Board({ fen, onMove, lastMove, disabled, legalMoves }) {
  const board = parseFen(fen);
  const [from, setFrom] = React.useState(null); // {row,col}

  // 移动端自适应：按容器宽度等比缩放整块棋盘（保留内部固定像素坐标）
  const wrapRef = React.useRef(null);
  const [scale, setScale] = React.useState(1);
  React.useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setScale(Math.min(1, el.clientWidth / SW));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const restrict = Array.isArray(legalMoves);
  // 当前选中起点的合法落点集合
  const targets = React.useMemo(() => {
    if (!restrict || !from) return null;
    const fromSq = toSquare(from.row, from.col);
    const set = new Set();
    for (const mv of legalMoves) {
      if (mv.slice(0, 2) === fromSq) set.add(mv.slice(2, 4));
    }
    return set;
  }, [restrict, legalMoves, from]);

  function handleClick(row, col) {
    if (disabled) return;
    const cell = board[row][col];
    const sq = toSquare(row, col);
    if (!from) {
      if (!cell) return; // 必须先点有子的格
      if (restrict && !legalMoves.some((m) => m.slice(0, 2) === sq)) return; // 该子无合法着法
      setFrom({ row, col });
      return;
    }
    if (from.row === row && from.col === col) {
      setFrom(null); // 再点一次取消
      return;
    }
    // 改选己方另一子
    if (cell && restrict && legalMoves.some((m) => m.slice(0, 2) === sq)) {
      setFrom({ row, col });
      return;
    }
    const move = toSquare(from.row, from.col) + sq;
    if (restrict && !legalMoves.includes(move)) {
      setFrom(null); // 非法着法，取消选择
      return;
    }
    setFrom(null);
    onMove(move);
  }

  // 高亮：选中起点 & 上一步
  const lastFrom = lastMove ? lastMove.slice(0, 2) : null;
  const lastTo = lastMove ? lastMove.slice(2, 4) : null;

  // 走子动画：落点棋子从起点滑入。计算起点相对终点的像素偏移。
  const sqToRC = (sq) => ({ col: "abcdefghi".indexOf(sq[0]), row: 9 - Number(sq[1]) });
  let slide = null;
  if (lastFrom && lastTo) {
    const f = sqToRC(lastFrom);
    const t = sqToRC(lastTo);
    slide = { dx: px(f.col) - px(t.col), dy: py(f.row) - py(t.row) };
  }

  return (
    <div className="xq-board-measure" ref={wrapRef}>
    <div className="xq-board-wrap" style={{ width: SW * scale, height: SH * scale }}>
    <div
      className="xq-board"
      style={{ width: SW, height: SH, transform: `scale(${scale})`, transformOrigin: "top left" }}
    >
      <svg className="xq-lines" width={SW} height={SH} viewBox={`0 0 ${SW} ${SH}`}>
        {/* 横线 */}
        {Array.from({ length: ROWS }, (_, r) => (
          <line key={`h${r}`} x1={px(0)} y1={py(r)} x2={px(COLS - 1)} y2={py(r)} />
        ))}
        {/* 竖线：河界处中间 7 路断开，两条边线贯通 */}
        {Array.from({ length: COLS }, (_, c) => {
          if (c === 0 || c === COLS - 1) {
            return <line key={`v${c}`} x1={px(c)} y1={py(0)} x2={px(c)} y2={py(ROWS - 1)} />;
          }
          return (
            <React.Fragment key={`v${c}`}>
              <line x1={px(c)} y1={py(0)} x2={px(c)} y2={py(4)} />
              <line x1={px(c)} y1={py(5)} x2={px(c)} y2={py(ROWS - 1)} />
            </React.Fragment>
          );
        })}
        {/* 九宫斜线 */}
        <line x1={px(3)} y1={py(0)} x2={px(5)} y2={py(2)} />
        <line x1={px(5)} y1={py(0)} x2={px(3)} y2={py(2)} />
        <line x1={px(3)} y1={py(7)} x2={px(5)} y2={py(9)} />
        <line x1={px(5)} y1={py(7)} x2={px(3)} y2={py(9)} />
        {/* 炮兵定位标记 */}
        {MARKS.map(([x1, y1, x2, y2], i) => (
          <line key={`m${i}`} x1={x1} y1={y1} x2={x2} y2={y2} />
        ))}
        {/* 楚河汉界 */}
        <text className="xq-river" x={px(1.5)} y={py(4.5)}>楚 河</text>
        <text className="xq-river" x={px(6.5)} y={py(4.5)}>漢 界</text>
      </svg>

      {/* 交叉点 + 棋子 */}
      <div className="xq-points">
        {board.map((rowCells, row) =>
          rowCells.map((cell, col) => {
            const sq = toSquare(row, col);
            const selected = from && from.row === row && from.col === col;
            const highlight = sq === lastFrom || sq === lastTo;
            const isTarget = targets && targets.has(sq);
            return (
              <div
                key={`${row}-${col}`}
                className="xq-point"
                style={{ left: px(col), top: py(row) }}
                onClick={() => handleClick(row, col)}
              >
                {highlight && <span className="xq-mark-last" />}
                {isTarget && <span className={"xq-dot" + (cell ? " capture" : "")} />}
                {cell && (
                  <span
                    key={sq === lastTo && slide ? `mv-${lastMove}` : sq}
                    className={
                      "xq-piece " +
                      (cell.red ? "red" : "black") +
                      (selected ? " selected" : "") +
                      (sq === lastTo && slide ? " moving" : "")
                    }
                    style={
                      sq === lastTo && slide
                        ? { "--dx": `${slide.dx}px`, "--dy": `${slide.dy}px` }
                        : undefined
                    }
                  >
                    {cell.glyph}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
    </div>
    </div>
  );
}
