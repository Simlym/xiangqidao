import React from "react";

import { parseJieqiFen } from "../../domain/xiangqi/jieqi/rules";

const HIDDEN_POOL_PIECES = [
  ["R", "车"], ["N", "马"], ["B", "相"], ["A", "仕"], ["C", "炮"], ["P", "兵"],
];

export function HiddenPool({ fen, side, label }) {
  const state = parseJieqiFen(fen);
  const red = side === "w";
  const items = HIDDEN_POOL_PIECES.map(([upper, redGlyph]) => {
    const piece = red ? upper : upper.toLowerCase();
    const glyph = red ? redGlyph : ({ R: "车", N: "马", B: "象", A: "士", C: "炮", P: "卒" })[upper];
    return { piece, glyph, remaining: state.hidden[piece] || 0, captured: state.capturedHidden[piece] || 0 };
  });
  const total = items.reduce((sum, item) => sum + item.remaining, 0);
  return (
    <section className={`jieqi-pool-strip ${red ? "red" : "black"}`} aria-label={`${label}暗子池，剩余 ${total} 枚`}>
      <div className="jieqi-pool-strip-side"><strong>{label}暗子池</strong><small>待揭 {total}</small></div>
      <div className="jieqi-pool-strip-pieces">
        {items.map((item) => (
          <span className={`jieqi-pool-piece${item.remaining === 0 ? " depleted" : ""}`} key={item.piece} title={`${item.glyph}：待揭 ${item.remaining} 枚${item.captured ? `，暗子被吃 ${item.captured} 枚` : ""}`}>
            <b>{item.glyph}</b><em>{item.remaining}</em>{item.captured > 0 && <small>吃{item.captured}</small>}
          </span>
        ))}
      </div>
    </section>
  );
}

export function ChineseMoveList({ pairs, desktop = false }) {
  return (
    <ol className={`jieqi-notation-list${desktop ? " desktop-jieqi-moves" : ""}`}>
      {pairs.map(([red, black], index) => (
        <li key={`${index}-${red}-${black}`}>
          <span className="jieqi-move-no">{index + 1}.</span>
          <span className="jieqi-move-red">{red}</span>
          <span className="jieqi-move-black">{black}</span>
        </li>
      ))}
    </ol>
  );
}

export function JieqiWinChances({ wdl }) {
  const total = wdl ? wdl.win + wdl.draw + wdl.loss : 0;
  if (!total) return null;
  const items = [
    ["red", "红胜", Math.round((wdl.win / total) * 100)],
    ["draw", "和棋", Math.round((wdl.draw / total) * 100)],
    ["black", "黑胜", Math.round((wdl.loss / total) * 100)],
  ];
  return (
    <section className="jieqi-win-chances" aria-label="引擎估算的胜和负概率">
      <div className="jieqi-analysis-title"><span aria-hidden="true">🏁</span><strong>胜负概率</strong></div>
      <div className="jieqi-win-chance-grid">
        {items.map(([kind, label, value]) => (
          <div className={`jieqi-win-chance ${kind}`} key={kind}>
            <strong>{value}%</strong><span>{label}</span><i style={{ "--chance": `${value}%` }} aria-hidden="true" />
          </div>
        ))}
      </div>
    </section>
  );
}
