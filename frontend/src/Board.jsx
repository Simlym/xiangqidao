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
const MAX_SCALE = 1.3; // PC 端最大放大倍数（基准棋盘约 416px；复盘页容器给定更大宽度时可放大到此）

// 列坐标：上方黑方用阿拉伯数字 1-9（黑视角从右到左→屏幕从左到右）；
// 下方红方用汉字（红视角从右到左→屏幕从左到右为 九…一）。
const TOP_LABELS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
const BOTTOM_LABELS = ["九", "八", "七", "六", "五", "四", "三", "二", "一"];

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
// 传入 hintMove（UCI）时，用虚线圈标出推荐着法的起点与落点。
// 传入 flipped 时翻转视角（黑方在下），只变换显示坐标，棋盘数据与方格名不变。
export default function Board({ fen, onMove, lastMove, disabled, legalMoves, hintMove, arrowMove, gradeBadge, flipped, maxHeight }) {
  const board = parseFen(fen);
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
    const update = () => {
      const widthScale = el.clientWidth / SW;
      const heightScale = maxHeight ? maxHeight / TOTAL_H : Infinity;
      setScale(Math.max(0.2, Math.min(MAX_SCALE, widthScale, heightScale)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxHeight]);

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

  // 推荐着法箭头：精准连接起点格中心 → 落点格中心（显示坐标已按 flipped 变换）
  const arrowSqToRC = (sq) => ({ col: "abcdefghi".indexOf(sq[0]), row: 9 - Number(sq[1]) });
  let arrow = null;
  if (arrowMove && arrowMove.length >= 4) {
    const af = arrowSqToRC(arrowMove.slice(0, 2));
    const at = arrowSqToRC(arrowMove.slice(2, 4));
    if (af.col >= 0 && at.col >= 0) {
      const x1 = px(dCol(af.col));
      const y1 = py(dRow(af.row));
      const x2 = px(dCol(at.col));
      const y2 = py(dRow(at.row));
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      const ux = (x2 - x1) / len; // 方向单位向量
      const uy = (y2 - y1) / len;
      const nx = -uy; // 法向单位向量
      const ny = ux;

      // 锥形箭身：起点细、向落点渐宽，末端接尖头
      const W_TAIL = 0.1;  // 起点半宽（细，不盖住棋子）
      const W_SHAFT = 1;   // 箭身末端（箭头根部）半宽
      const HEAD_W = 4;    // 箭头半宽
      const HEAD_LEN = Math.min(6, len * 0.42); // 箭头长度（短着法时按比例缩短）
      const baseD = Math.max(0, len - HEAD_LEN); // 箭头根部距起点的距离

      // 沿方向 t 距离、法向 ±半宽 的点
      const pt = (t, halfW, sign) => [
        x1 + ux * t + nx * halfW * sign,
        y1 + uy * t + ny * halfW * sign,
      ];
      const tail1 = pt(0, W_TAIL, 1);
      const tail2 = pt(0, W_TAIL, -1);
      const base1 = pt(baseD, W_SHAFT, 1);
      const base2 = pt(baseD, W_SHAFT, -1);
      const wing1 = pt(baseD, HEAD_W, 1);
      const wing2 = pt(baseD, HEAD_W, -1);
      const tip = [x2, y2];

      // 多边形：尾左 → 根左 → 翼左 → 尖 → 翼右 → 根右 → 尾右
      const poly = [tail1, base1, wing1, tip, wing2, base2, tail2]
        .map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`)
        .join(" ");
      arrow = { poly, x1, y1 };
    }
  }

  // 走子动画：落点棋子从起点滑入。计算起点相对终点的像素偏移。
  const sqToRC = (sq) => ({ col: "abcdefghi".indexOf(sq[0]), row: 9 - Number(sq[1]) });
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
                style={{ left: px(dCol(col)), top: py(dRow(row)) }}
                onClick={() => handleClick(row, col)}
              >
                {highlight && (
                  <span className={"xq-mark-last " + markSide} />
                )}
                {(sq === hintFrom || sq === hintTo) && <span className="xq-mark-hint" />}
                {isTarget && <span className={"xq-dot" + (cell ? " capture" : "")} />}
                {gradeBadge && gradeBadge.square === sq && (
                  <span
                    className={"xq-grade " + gradeBadge.key + (gradeBadge.symbol ? " symbol" : "")}
                    title={gradeBadge.title}
                  >
                    {gradeBadge.label}
                  </span>
                )}
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

      {/* 推荐着法箭头：锥形（起点细、向落点渐宽、尖头），覆盖在棋子之上 */}
      {arrow && (
        <svg
          className="xq-arrow-layer"
          width={SW}
          height={SH}
          viewBox={`0 0 ${SW} ${SH}`}
        >
          {/* 白 halo（描边加填充，略外扩）→ 彩色锥形箭身盖在上面 */}
          <polygon className="xq-arrow-halo" points={arrow.poly} />
          <polygon className="xq-arrow-body" points={arrow.poly} />
        </svg>
      )}
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
