import test from "node:test";
import assert from "node:assert/strict";
import { analysisResult, goCommand, parseUciInfo, redPerspective } from "./uci.js";

test("解析完整 UCI info 与揭棋扩展着法", () => {
  const value = parseUciInfo("info depth 18 seldepth 27 multipv 2 score cp -35 wdl 120 500 380 nodes 1234 nps 45678 time 27 pv a3a4R a6a5p");
  assert.deepEqual(value.score, { type: "cp", value: -35, bound: null });
  assert.deepEqual(value.wdl, { win: 120, draw: 500, loss: 380 });
  assert.deepEqual(value.pv, ["a3a4R", "a6a5p"]);
  assert.equal(value.multipv, 2);
  assert.equal(value.nps, 45678);
});

test("黑方行棋时统一为红方视角", () => {
  const value = redPerspective(parseUciInfo("info depth 8 score mate 3 wdl 600 300 100 pv a6a5"), "9/9/9/9/9/9/9/9/9/9 b");
  assert.equal(value.score.value, -3);
  assert.deepEqual(value.wdl, { win: 100, draw: 300, loss: 600 });
});

test("生成多种搜索命令", () => {
  assert.equal(goCommand({ mode: "movetime", value: 1500 }), "go movetime 1500");
  assert.equal(goCommand({ mode: "infinite", searchMoves: ["h2e2"] }), "go infinite searchmoves h2e2");
  assert.equal(goCommand({ depth: 20 }), "go depth 20");
});

test("将 MultiPV 聚合为兼容旧界面的结果", () => {
  const result = analysisResult(new Map([[1, { score: { type: "cp", value: 25 }, pv: ["h2e2"] }], [2, { score: { type: "cp", value: 10 }, pv: ["b0c2"] }]]));
  assert.equal(result.bestMove, "h2e2");
  assert.equal(result.cp, 25);
  assert.equal(result.lines.length, 2);
});
