import React from "react";

import { uciToChinese } from "../../domain/xiangqi/xiangqi";

function moveQuality(moveData) {
  if (!moveData) return null;
  if (moveData.is_blunder) return "blunder";
  if (moveData.is_mistake) return "mistake";
  if (moveData.move_played !== moveData.best_move) return "inaccuracy";
  return "best";
}

export function MoveItem({ moveText, isActive, analysisEntry, onClick }) {
  const quality = moveQuality(analysisEntry);
  const qualityClass = quality && quality !== "best" ? ` move-${quality}` : "";
  return (
    <span className={`move-item${isActive ? " active" : ""}${qualityClass}`} onClick={onClick}>
      {moveText}
    </span>
  );
}

export function AnalysisPanel({ summary, moveAnalysis, stepIndex, preFen, onNavigateToTrain }) {
  const badgeInfo = moveAnalysis
    ? moveAnalysis.is_blunder
      ? { text: "严重失误", color: "#c0392b", bg: "#ffebee" }
      : moveAnalysis.is_mistake
        ? { text: "失误", color: "#e67e22", bg: "#fff3e0" }
        : moveAnalysis.move_played !== moveAnalysis.best_move
          ? { text: "可改进", color: "#b8860b", bg: "#fffde7" }
          : null
    : null;
  const evalDrop = moveAnalysis?.eval_drop != null ? (moveAnalysis.eval_drop / 100).toFixed(1) : null;

  return (
    <div className="analysis-panel">
      <div className="analysis-summary">
        <span style={{ color: "#c0392b", fontWeight: 600 }}>{summary.blunder_count} 处严重失误</span>
        <span style={{ color: "#888", margin: "0 6px" }}>，</span>
        <span style={{ color: "#e67e22", fontWeight: 600 }}>{summary.mistake_count} 处失误</span>
      </div>
      {moveAnalysis && stepIndex > 0 ? (
        <div className="analysis-detail">
          <div className="analysis-detail-header">
            <span className="analysis-move-label">第 {stepIndex} 步</span>
            {badgeInfo && <span className="analysis-badge" style={{ color: badgeInfo.color, background: badgeInfo.bg }}>{badgeInfo.text}</span>}
          </div>
          <div className="analysis-moves-row">
            <span>实际走法：<strong>{preFen ? uciToChinese(preFen, moveAnalysis.move_played) : moveAnalysis.move_played}</strong></span>
            <span className="analysis-arrow">→</span>
            <span>最优走法：<strong>{preFen ? uciToChinese(preFen, moveAnalysis.best_move) : moveAnalysis.best_move}</strong></span>
          </div>
          {evalDrop !== null && <div className="analysis-eval-drop muted">失分：约 {evalDrop} 个子</div>}
          {moveAnalysis.explanation && <div className="analysis-explanation">{moveAnalysis.explanation}</div>}
          {moveAnalysis.puzzle_id && (
            <button className="btn-analyze" style={{ marginTop: 8 }} onClick={() => onNavigateToTrain?.(moveAnalysis.puzzle_id)}>
              去练习这道题
            </button>
          )}
        </div>
      ) : <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>点击某步棋查看分析详情</div>}
    </div>
  );
}
