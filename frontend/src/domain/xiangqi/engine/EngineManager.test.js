import test from "node:test";
import assert from "node:assert/strict";
import { EngineManager } from "./EngineManager.js";

test("引擎就绪期间停止请求不会启动孤立的无限搜索", async () => {
  let finishReady;
  let analyzeCalls = 0;
  const adapter = {
    kind: "native",
    ready: () => new Promise((resolve) => { finishReady = resolve; }),
    analyze: () => {
      analyzeCalls += 1;
      return { result: new Promise(() => {}), stop() {} };
    },
  };
  const manager = new EngineManager([adapter]);
  const session = manager.startAnalysis("position", { mode: "infinite" });

  await Promise.resolve();
  session.stop();
  finishReady(true);

  await assert.rejects(session.result, (error) => error?.name === "AbortError");
  assert.equal(analyzeCalls, 0);
});
