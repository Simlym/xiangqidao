import test from "node:test";
import assert from "node:assert/strict";
import {
  JIEQI_INITIAL_FEN,
  applyJieqiMove,
  availableJieqiReveals,
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

test("自由翻子可以指定暗子的真实身份", () => {
  const choices = availableJieqiReveals(JIEQI_INITIAL_FEN, "w");
  assert.deepEqual(choices.map(({ piece, count }) => [piece, count]), [
    ["A", 2], ["R", 2], ["B", 2], ["N", 2], ["C", 2], ["P", 5],
  ]);

  const next = applyJieqiMove(JIEQI_INITIAL_FEN, "a3a4P", {
    identifyCapturedHidden: false,
  });
  const state = parseJieqiFen(next);
  assert.equal(state.board[5][0].piece, "P");
  assert.equal(state.hidden.P, 4);
});

test("自由翻子吃暗子时保留对方暗子池", () => {
  const fen = "4k4/9/9/9/4P4/x8/X8/9/9/4K4 w P1p1 - 0 1";
  const next = applyJieqiMove(fen, "a3a4P", { identifyCapturedHidden: false });
  const state = parseJieqiFen(next);
  assert.equal(state.hidden.P || 0, 0);
  assert.equal(state.hidden.p, 1);
  assert.deepEqual(state.capturedHidden, {});
});

test("随机翻子吃暗子时仍会识别并扣除暗子", () => {
  const fen = "4k4/9/9/9/4P4/x8/X8/9/9/4K4 w P1p1 - 0 1";
  const next = applyJieqiMove(fen, "a3a4P", () => 0);
  const state = parseJieqiFen(next);
  assert.equal(state.hidden.p || 0, 0);
  assert.equal(state.capturedHidden.p, 1);
});

test("非法着法不会污染局面", () => {
  assert.throws(() => applyJieqiMove(JIEQI_INITIAL_FEN, "a3a9", () => 0));
  assert.equal(parseJieqiFen(JIEQI_INITIAL_FEN).side, "w");
});

