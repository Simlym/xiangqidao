import React from "react";
import { parseFen, toSquare } from "./xiangqi";

// 点击式走子：先点起点，再点终点，回调 onMove(uciMove)。
export default function Board({ fen, onMove, lastMove, disabled }) {
  const board = parseFen(fen);
  const [from, setFrom] = React.useState(null); // {row,col}

  function handleClick(row, col) {
    if (disabled) return;
    const cell = board[row][col];
    if (!from) {
      if (cell) setFrom({ row, col }); // 必须先点有子的格
      return;
    }
    if (from.row === row && from.col === col) {
      setFrom(null); // 再点一次取消
      return;
    }
    const move = toSquare(from.row, from.col) + toSquare(row, col);
    setFrom(null);
    onMove(move);
  }

  // 高亮：选中起点 & 上一步
  const lastFrom = lastMove ? lastMove.slice(0, 2) : null;
  const lastTo = lastMove ? lastMove.slice(2, 4) : null;

  return (
    <div className="board">
      {board.map((rowCells, row) => (
        <div className="board-row" key={row}>
          {rowCells.map((cell, col) => {
            const sq = toSquare(row, col);
            const selected = from && from.row === row && from.col === col;
            const highlight = sq === lastFrom || sq === lastTo;
            return (
              <div
                key={col}
                className={
                  "cell" +
                  (selected ? " selected" : "") +
                  (highlight ? " highlight" : "")
                }
                onClick={() => handleClick(row, col)}
              >
                {cell && (
                  <span className={"piece " + (cell.red ? "red" : "black")}>
                    {cell.glyph}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
