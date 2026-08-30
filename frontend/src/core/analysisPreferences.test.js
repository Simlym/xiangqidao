import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ANALYSIS_PREFERENCES, normalizeAnalysisPreferences } from "../analysisPreferences.js";

test("分析设置会保留有效值", () => {
  assert.deepEqual(normalizeAnalysisPreferences({ mode: "depth", time: 3000, depth: 24, multiPv: 3 }), {
    mode: "depth", time: 3000, depth: 24, multiPv: 3,
  });
});

test("分析设置会修正损坏或越界的本地数据", () => {
  assert.deepEqual(normalizeAnalysisPreferences({ mode: "bad", time: 42, depth: 99, multiPv: 2 }), {
    ...DEFAULT_ANALYSIS_PREFERENCES,
    depth: 30,
  });
});
