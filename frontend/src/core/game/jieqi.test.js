import test from "node:test";
import assert from "node:assert/strict";
import {
  JIEQI_INITIAL_FEN,
  applyJieqiMove,
  jieqiStatus,
  legalJieqiMoves,
  parseJieqiFen,
} from "./jieqi.js";

test("揭棋初始局面有完整合法着法", () => {
  const moves = legalJieqiMoves(JIEQI_INITIAL_FEN);
  assert.equal(jieqiStatus(JIEQI_INITIAL_FEN), "ongoing");
  assert.equal(moves.length, 44);
  assert.ok(moves.includes("a3a4"));
});

test("暗子首次移动后翻开并从暗子池扣除", () => {
  const next = applyJieqiMove(JIEQI_INITIAL_FEN, "a3a4", () => 0);
  const state = parseJieqiFen(next);
  assert.equal(state.side, "b");
  assert.equal(state.board[5][0].hidden, false);
  assert.equal(state.board[5][0].piece, "A");
  assert.equal(state.hidden.A, 1);
});

test("非法着法不会污染局面", () => {
  assert.throws(() => applyJieqiMove(JIEQI_INITIAL_FEN, "a3a9", () => 0));
  assert.equal(parseJieqiFen(JIEQI_INITIAL_FEN).side, "w");
});

