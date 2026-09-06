import assert from "node:assert/strict";
import test from "node:test";

import { enginePayload, normalizeEngineResult } from "./engine.js";

test("引擎请求统一转换多端设置字段", () => {
  assert.deepEqual(enginePayload("fen", {
    mode: "movetime", value: 800, multiPv: 3, showWdl: true, searchMoves: ["h2e2"],
  }), {
    fen: "fen", depth: 12, mode: "movetime", value: 800,
    multipv: 3, show_wdl: true, search_moves: ["h2e2"],
  });
});

test("服务端引擎结果只在 API 边界转换一次", () => {
  const result = normalizeEngineResult({
    best_move: "h2e2", time_ms: 15, wdl: [600, 300, 100],
    lines: [{ multipv: 1, score_cp: 42, time_ms: 10, wdl: [550, 350, 100] }],
  });
  assert.equal(result.bestMove, "h2e2");
  assert.equal(result.timeMs, 15);
  assert.deepEqual(result.wdl, { win: 600, draw: 300, loss: 100 });
  assert.deepEqual(result.lines[0].score, { type: "cp", value: 42, pov: "red" });
});
