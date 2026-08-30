import React from "react";
import Board from "../Board";
import { applyMove, uciToChinese } from "../xiangqi";
import { applyJieqiMove, jieqiMoveToChinese, parseJieqiBoard } from "../core/game/jieqi";
import { jieqiPieceImage } from "../jieqiPieceImages";

function formatCount(value) {
  if (value == null) return "—";
  return new Intl.NumberFormat("zh-CN", { notation: value >= 100000 ? "compact" : "standard" }).format(value);
}

function pct(value, total) {
  return total ? Math.round((value / total) * 100) : 0;
}

function lineLabel(line) {
  if (line.score?.type === "mate") return `${line.score.value > 0 ? "+" : "-"}M${Math.abs(line.score.value)}`;
  if (line.score?.value == null) return "—";
  return `${line.score.value >= 0 ? "+" : ""}${line.score.value}`;
}

function buildPreview(initialFen, pv, variant) {
  const items = [{ fen: initialFen, move: null, text: "初始局面" }];
  let fen = initialFen;
  for (const move of pv || []) {
    try {
      const text = variant === "jieqi" ? jieqiMoveToChinese(fen, move) : uciToChinese(fen, move);
      fen = variant === "jieqi" ? applyJieqiMove(fen, move) : applyMove(fen, move);
      items.push({ fen, move, text });
    } catch {
      break;
    }
  }
  return items;
}

export default function EngineAnalysisView({ fen, data, loading = false, variant = "xiangqi", onAnalyzeMove, log = [], showWdl = true }) {
  const [preview, setPreview] = React.useState(null);
  const [previewStep, setPreviewStep] = React.useState(0);
  const lines = data?.lines?.length ? data.lines : data?.pv?.length
    ? [{ multipv: 1, pv: data.pv, score: data.mate != null ? { type: "mate", value: data.mate } : { type: "cp", value: data.cp } }]
    : [];
  const previewPositions = React.useMemo(
    () => preview ? buildPreview(fen, preview.pv, variant) : [],
    [fen, preview, variant],
  );
  const wdl = data?.wdl;
  const wdlTotal = wdl ? wdl.win + wdl.draw + wdl.loss : 0;

  function openPreview(line, step) {
    setPreview(line);
    setPreviewStep(step + 1);
  }

  return <>
    {(loading || data) && (
      <div className="engine-search-stats">
        <span>深度 <b>{data?.depth ?? "—"}{data?.seldepth ? `/${data.seldepth}` : ""}</b></span>
        <span>NPS <b>{formatCount(data?.nps)}</b></span>
        <span>节点 <b>{formatCount(data?.nodes)}</b></span>
        <span>用时 <b>{data?.timeMs != null ? `${(data.timeMs / 1000).toFixed(1)}s` : "—"}</b></span>
      </div>
    )}
    {showWdl && wdl && wdlTotal > 0 && (
      <div className="wdl-wrap" title="红方视角的引擎胜和负估计">
        <div className="wdl-bar">
          <span className="win" style={{ width: `${pct(wdl.win, wdlTotal)}%` }} />
          <span className="draw" style={{ width: `${pct(wdl.draw, wdlTotal)}%` }} />
          <span className="loss" style={{ width: `${pct(wdl.loss, wdlTotal)}%` }} />
        </div>
        <small>红胜 {pct(wdl.win, wdlTotal)}% · 和 {pct(wdl.draw, wdlTotal)}% · 黑胜 {pct(wdl.loss, wdlTotal)}%</small>
      </div>
    )}
    {lines.length > 0 && (
      <div className="engine-pv-lines">
        {lines.map((line) => {
          let lineFen = fen;
          return (
            <div className="engine-pv-line" key={line.multipv || 1}>
              <b>#{line.multipv || 1}</b>
              <strong>{lineLabel(line)}</strong>
              <div>
                {(line.pv || []).map((move, index) => {
                  let text = move;
                  try {
                    text = variant === "jieqi" ? jieqiMoveToChinese(lineFen, move) : uciToChinese(lineFen, move);
                    lineFen = variant === "jieqi" ? applyJieqiMove(lineFen, move) : applyMove(lineFen, move);
                  } catch { /* 保留原始着法 */ }
                  return <button type="button" key={`${move}-${index}`} onClick={() => openPreview(line, index)} title={move}>{text}</button>;
                })}
              </div>
              {line.pv?.[0] && onAnalyzeMove && <button className="engine-searchmove" type="button" onClick={() => onAnalyzeMove(line.pv[0])}>仅分析首着</button>}
            </div>
          );
        })}
      </div>
    )}
    {log.length > 0 && (
      <details className="engine-log">
        <summary>引擎日志（最近 {Math.min(200, log.length)} 条，最新在前）</summary>
        <div>{log.slice(-200).reverse().map((item, index) => <code key={`${item.at}-${index}`} className={item.direction}>{item.direction === "sent" ? "→" : item.direction === "recv" ? "←" : "!"} {item.line}</code>)}</div>
      </details>
    )}
    {preview && previewPositions.length > 0 && (
      <div className="pv-preview-overlay" role="dialog" aria-modal="true" aria-label="主变预览">
        <div className="panel pv-preview-dialog">
          <div className="pv-preview-head">
            <strong>主变 #{preview.multipv || 1} · 第 {previewStep}/{previewPositions.length - 1} 步</strong>
            <button onClick={() => setPreview(null)} aria-label="关闭">×</button>
          </div>
          <Board
            fen={previewPositions[previewStep]?.fen || fen}
            onMove={() => {}}
            disabled
            lastMove={previewPositions[previewStep]?.move || null}
            parsePosition={variant === "jieqi" ? parseJieqiBoard : undefined}
            pieceImage={variant === "jieqi" ? jieqiPieceImage : undefined}
          />
          <div className="pv-preview-caption">{previewPositions[previewStep]?.text}</div>
          <div className="btn-row">
            <button onClick={() => setPreviewStep((value) => Math.max(0, value - 1))} disabled={previewStep === 0}>◀ 上一步</button>
            <button onClick={() => setPreviewStep((value) => Math.min(previewPositions.length - 1, value + 1))} disabled={previewStep >= previewPositions.length - 1}>下一步 ▶</button>
          </div>
        </div>
      </div>
    )}
  </>;
}
