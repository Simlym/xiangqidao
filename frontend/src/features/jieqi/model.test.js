import assert from "node:assert/strict";
import test from "node:test";

import { describeJieqiEval, winnerFor } from "./model.js";

test("揭棋终局结果保持走子方视角", () => {
  assert.equal(winnerFor("checkmate", "w"), "w");
  assert.equal(winnerFor("stalemate", "b"), "draw");
  assert.equal(winnerFor("playing", "w"), null);
});

test("揭棋评分转换为红方视角并限制胜率范围", () => {
  assert.deepEqual(describeJieqiEval(null), { value: "—", label: "暂无评分", redPct: 50 });
  assert.equal(describeJieqiEval({ cp: 220 }).label, "红方占优");
  assert.equal(describeJieqiEval({ cp: -5000 }).redPct, 0);
  assert.equal(describeJieqiEval({ mate: -3 }).label, "黑方3步可杀");
});
