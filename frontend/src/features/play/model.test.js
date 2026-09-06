import assert from "node:assert/strict";
import test from "node:test";

import { capturedPieces, describeEval, fmtDuration, terminalResult } from "./model.js";

test("终局结果统一映射胜负与和棋", () => {
  assert.deepEqual(terminalResult("checkmate", "human"), { game_over: true, winner: "human" });
  assert.deepEqual(terminalResult("stalemate", "human"), { game_over: true, winner: "draw" });
});

test("红方评分会转换为玩家视角文案", () => {
  assert.equal(describeEval({ cp: 220 }, "w").label, "红方占优（你占优）");
  assert.equal(describeEval({ cp: 220 }, "b").label, "红方占优（对方占优）");
});

test("初始局面没有被吃子", () => {
  const initial = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";
  assert.deepEqual(capturedPieces(initial), { red: [], black: [], diff: 0 });
  assert.equal(fmtDuration(65000), "1分5秒");
});
