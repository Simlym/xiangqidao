import React from "react";

const WIDTH = 640;
const HEIGHT = 150;
const PAD = 20;
const LIMIT = 1200;

function redScore(item) {
  if (item.score_mate != null) {
    const sideSign = (item.fen_before?.split(/\s+/)[1] || "w") === "w" ? 1 : -1;
    return Math.sign(item.score_mate || 1) * sideSign * LIMIT;
  }
  if (item.score_cp == null) return null;
  const sideSign = (item.fen_before?.split(/\s+/)[1] || "w") === "w" ? 1 : -1;
  return Math.max(-LIMIT, Math.min(LIMIT, sideSign * item.score_cp));
}

function label(item) {
  const score = redScore(item);
  if (item.score_mate != null) return `${score >= 0 ? "红方" : "黑方"} M${Math.abs(item.score_mate)}`;
  if (score == null) return "暂无评分";
  return `红方视角 ${score >= 0 ? "+" : ""}${score}`;
}

export default function EvaluationChart({ moves = [], activeStep = 0, onSelect }) {
  const points = moves.map((item, index) => ({ item, index, score: redScore(item) })).filter((point) => point.score != null);
  if (points.length < 2) return null;
  const x = (index) => PAD + (index / Math.max(1, moves.length - 1)) * (WIDTH - PAD * 2);
  const y = (score) => PAD + ((LIMIT - score) / (LIMIT * 2)) * (HEIGHT - PAD * 2);
  const path = points.map((point, index) => `${index ? "L" : "M"}${x(point.index).toFixed(1)},${y(point.score).toFixed(1)}`).join(" ");

  return (
    <section className="evaluation-chart" aria-label="局势走势图">
      <div className="evaluation-chart-head"><strong>局势走势</strong><small>红方优势向上 · 点击跳转</small></div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img">
        <rect x={PAD} y={PAD} width={WIDTH - PAD * 2} height={(HEIGHT - PAD * 2) / 2} className="chart-red-zone" />
        <rect x={PAD} y={HEIGHT / 2} width={WIDTH - PAD * 2} height={(HEIGHT - PAD * 2) / 2} className="chart-black-zone" />
        <line x1={PAD} y1={HEIGHT / 2} x2={WIDTH - PAD} y2={HEIGHT / 2} className="chart-zero" />
        <path d={path} className="chart-line" />
        {points.map(({ item, index, score }) => (
          <circle
            key={item.move_index ?? index}
            cx={x(index)} cy={y(score)}
            r={activeStep === index + 1 ? 5 : item.is_blunder ? 4.5 : item.is_mistake ? 4 : 3}
            className={`chart-point${item.is_blunder ? " blunder" : item.is_mistake ? " mistake" : ""}${activeStep === index + 1 ? " active" : ""}`}
            onClick={() => onSelect?.(index + 1)}
          >
            <title>第 {index + 1} 步 · {label(item)}{item.is_blunder ? " · 严重失误" : item.is_mistake ? " · 失误" : ""}</title>
          </circle>
        ))}
      </svg>
    </section>
  );
}
