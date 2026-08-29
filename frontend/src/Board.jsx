import React from "react";
import { parseFen, toSquare } from "./xiangqi";

// 棋盘几何：棋子落在 9 路 × 10 线的交叉点上。
const COLS = 9; // 路（a-i）
const ROWS = 10; // 线（0-9）
const CELL = 46; // 相邻交叉点间距
const PAD = 24; // 边距（给边线棋子留出空间）
const COORD = 22; // 上下坐标条高度
const W = (COLS - 1) * CELL; // 棋盘线区域宽
const H = (ROWS - 1) * CELL; // 棋盘线区域高
const SW = W + 2 * PAD; // SVG 总宽
const SH = H + 2 * PAD; // SVG 总高
const TOTAL_H = SH + 2 * COORD; // 含坐标条的整体高
const DEFAULT_MAX_SCALE = 1.4; // 标准棋盘最大放大倍数；揭棋可按页面空间单独提高。

// 列坐标：上方黑方用阿拉伯数字 1-9（黑视角从右到左→屏幕从左到右）；
// 下方红方用汉字（红视角从右到左→屏幕从左到右为 九…一）。
const TOP_LABELS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
const BOTTOM_LABELS = ["九", "八", "七", "六", "五", "四", "三", "二", "一"];

const px = (col) => PAD + col * CELL;
const py = (row) => PAD + row * CELL;

const LINE = "#5a3d22";

// JieqiBox 同款渐细多边形箭头：极细尾部、稳定箭身、紧凑箭头。
function buildArrowPoints(x1, y1, x2, y2) {
  const length = Math.hypot(x2 - x1, y2 - y1);
  if (length < 1) return "";
  const ux = (x2 - x1) / length;
  const uy = (y2 - y1) / length;
  const nx = -uy;
  const ny = ux;
  const headLength = Math.min(8.1, length * 0.42);
  const headBase = Math.max(0, length - headLength);
  const point = (distance, halfWidth, side) => [
    x1 + ux * distance + nx * halfWidth * side,
    y1 + uy * distance + ny * halfWidth * side,
  ];
  return [
    point(0, 0.18, 1),
    point(headBase, 1.3, 1),
    point(headBase, 5.2, 1),
    [x2, y2],
    point(headBase, 5.2, -1),
    point(headBase, 1.3, -1),
    point(0, 0.18, -1),
  ].map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
}

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
// 传入 hintMove（UCI）时，用虚线圈和箭头标出推荐着法。
// 传入 flipped 时翻转视角（黑方在下），只变换显示坐标，棋盘数据与方格名不变。
export default function Board({
  fen, onMove, lastMove, disabled, legalMoves, hintMove, flipped,
  parsePosition = parseFen, pieceImage = null, maxScale = DEFAULT_MAX_SCALE,
}) {
  const board = parsePosition(fen);
  const [from, setFrom] = React.useState(null); // {row,col}

  // 显示坐标变换：翻转时上下左右同时镜像（相当于把棋盘旋转 180°）
  const dCol = (col) => (flipped ? COLS - 1 - col : col);
  const dRow = (row) => (flipped ? ROWS - 1 - row : row);
  // 坐标条：红方用汉字、黑方用数字；谁在下方谁的标签放底部
  const topLabels = flipped ? [...BOTTOM_LABELS].reverse() : TOP_LABELS;
  const bottomLabels = flipped ? [...TOP_LABELS].reverse() : BOTTOM_LABELS;

  // 自适应缩放：按容器宽度等比缩放整块棋盘（保留内部固定像素坐标）。
  // 窄屏缩小、宽屏（PC）适当放大，最高 MAX_SCALE 倍。
  const wrapRef = React.useRef(null);
  const [scale, setScale] = React.useState(1);
  React.useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () =>
      setScale(Math.max(0.2, Math.min(maxScale, el.clientWidth / SW)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxScale]);

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
  // 推荐着法（提示）起点与落点
  const hintFrom = hintMove ? hintMove.slice(0, 2) : null;
  const hintTo = hintMove ? hintMove.slice(2, 4) : null;

  // 走子动画：落点棋子从起点滑入。计算起点相对终点的像素偏移。
  const sqToRC = (sq) => ({ col: "abcdefghi".indexOf(sq[0]), row: 9 - Number(sq[1]) });
  let hintArrow = null;
  if (hintFrom && hintTo) {
    const from = sqToRC(hintFrom);
    const to = sqToRC(hintTo);
    const start = { x: px(dCol(from.col)), y: py(dRow(from.row)) };
    const end = { x: px(dCol(to.col)), y: py(dRow(to.row)) };
    hintArrow = buildArrowPoints(start.x, start.y, end.x, end.y);
  }
  let slide = null;
  if (lastFrom && lastTo) {
    const f = sqToRC(lastFrom);
    const t = sqToRC(lastTo);
    slide = {
      dx: px(dCol(f.col)) - px(dCol(t.col)),
      dy: py(dRow(f.row)) - py(dRow(t.row)),
    };
  }
  // 上一步是谁走的：看终点格棋子颜色，红方/黑方用不同高亮色。
  const lastToRC = lastTo ? sqToRC(lastTo) : null;
  const lastMoverRed = lastToRC ? board[lastToRC.row]?.[lastToRC.col]?.red : null;
  const markSide = lastMoverRed ? "red" : "black";

  return (
    <div className="xq-board-measure" ref={wrapRef}>
    <div className="xq-board-wrap" style={{ width: SW * scale, height: TOTAL_H * scale }}>
    <div
      className="xq-board-scale"
      style={{ width: SW, height: TOTAL_H, transform: `scale(${scale})`, transformOrigin: "top left" }}
    >
      <div className="xq-coords">
        {topLabels.map((t, c) => (
          <span key={`tl${c}`} className={flipped ? "red" : ""} style={{ left: px(c) }}>{t}</span>
        ))}
      </div>
    <div className="xq-board" style={{ width: SW, height: SH }}>
      <svg className="xq-lines" width={SW} height={SH} viewBox={`0 0 ${SW} ${SH}`}>
        <defs>
          <linearGradient id="xq-board-wood" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f7dfad" />
            <stop offset="0.48" stopColor="#edc985" />
            <stop offset="1" stopColor="#dcae68" />
          </linearGradient>
          <radialGradient id="xq-board-glow" cx="48%" cy="38%" r="70%">
            <stop offset="0" stopColor="#fff5d8" stopOpacity=".42" />
            <stop offset="1" stopColor="#a96f2c" stopOpacity=".08" />
          </radialGradient>
          <linearGradient id="xq-board-rim" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#9a6a3b" />
            <stop offset="0.42" stopColor="#724721" />
            <stop offset="0.72" stopColor="#8b5b2d" />
            <stop offset="1" stopColor="#5f391b" />
          </linearGradient>
          <pattern id="xq-board-grain" width="32" height="32" patternUnits="userSpaceOnUse">
            <path d="M2 0V32M10 0V32M27 0V32" stroke="#8b541f" strokeOpacity=".045" strokeWidth="1" />
            <path d="M0 7C10 4 21 9 32 6M0 25C11 22 20 27 32 23" fill="none" stroke="#fff8e5" strokeOpacity=".12" strokeWidth=".8" />
          </pattern>
        </defs>
        <rect className="xq-board-rim" x="1" y="1" width={SW - 2} height={SH - 2} rx="8" />
        <rect className="xq-board-base" x="4" y="4" width={SW - 8} height={SH - 8} rx="6" />
        <rect x="4" y="4" width={SW - 8} height={SH - 8} rx="6" fill="url(#xq-board-glow)" />
        <rect x="4" y="4" width={SW - 8} height={SH - 8} rx="6" fill="url(#xq-board-grain)" />
        <rect className="xq-board-inner-frame" x="7" y="7" width={SW - 14} height={SH - 14} rx="4" />
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

      {hintArrow && (
        <svg className="xq-hint-arrow" width={SW} height={SH} viewBox={`0 0 ${SW} ${SH}`} aria-hidden="true">
          <polygon className="xq-hint-arrow-halo" points={hintArrow} />
          <polygon className="xq-hint-arrow-body" points={hintArrow} />
        </svg>
      )}

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
                style={{ left: px(dCol(col)), top: py(dRow(row)) }}
                onClick={() => handleClick(row, col)}
              >
                {highlight && (
                  <span className={"xq-mark-last " + markSide} />
                )}
                {isTarget && <span className={"xq-dot" + (cell ? " capture" : "")} />}
                {cell && (
                  <span
                    key={sq === lastTo && slide ? `mv-${lastMove}` : sq}
                    className={
                      "xq-piece " +
                      (cell.red ? "red" : "black") +
                      (pieceImage ? " image" : "") +
                      (selected ? " selected" : "") +
                      (sq === lastTo && slide ? " moving" : "")
                    }
                    style={
                      sq === lastTo && slide
                        ? { "--dx": `${slide.dx}px`, "--dy": `${slide.dy}px` }
                        : undefined
                    }
                  >
                    {pieceImage ? (
                      <img className="xq-piece-image" src={pieceImage(cell)} alt={cell.hidden ? "暗子" : cell.glyph} draggable="false" />
                    ) : cell.hidden ? <span className="xq-dark-piece">暗</span> : cell.glyph}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
      <div className="xq-coords">
        {bottomLabels.map((t, c) => (
          <span key={`bl${c}`} className={flipped ? "" : "red"} style={{ left: px(c) }}>{t}</span>
        ))}
      </div>
    </div>
    </div>
    </div>
  );
}
