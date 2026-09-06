import test from "node:test";
import assert from "node:assert/strict";
import { getLocalEngine, localEval } from "./localEngine.js";

function mockWorker(t) {
  const instances = [];
  class WorkerMock extends EventTarget {
    constructor() { super(); instances.push(this); }
    postMessage(command) {
      if (command === "uci") queueMicrotask(() => this.onmessage({ data: "uciok" }));
      if (command === "isready") queueMicrotask(() => this.onmessage({ data: "readyok" }));
    }
    terminate() { this.terminated = true; }
  }
  t.mock.method(globalThis, "fetch", async () => new Response("", {
    headers: { "content-type": "application/javascript" },
  }));
  const previous = globalThis.Worker;
  const previousStorage = globalThis.localStorage;
  globalThis.Worker = WorkerMock;
  globalThis.localStorage = {
    getItem(key) {
      const variant = key.split(".").at(-1);
      return JSON.stringify({ base: `/__user-engines__/${variant}/test/`, entrypoint: "engine.worker.js", network: null });
    },
  };
  t.after(() => { globalThis.Worker = previous; globalThis.localStorage = previousStorage; });
  return instances;
}

test("用户引擎入口返回 HTML 时不启动引擎", async (t) => {
  const workers = mockWorker(t);
  t.mock.method(globalThis, "fetch", async (url) => new Response("", {
    headers: { "content-type": "text/html" },
  }));
  assert.equal(await getLocalEngine("missing-test"), null);
  assert.equal(workers.length, 0);
});

test("引擎思考期间崩溃会拒绝请求，允许上层降级", async (t) => {
  const workers = mockWorker(t);
  await getLocalEngine("crash-test");
  const result = localEval("position", { variant: "crash-test" });
  await new Promise((resolve) => setImmediate(resolve));
  const rejected = assert.rejects(result, /运行失败/);
  workers[0].dispatchEvent(new Event("error"));
  await rejected;
  assert.equal(workers[0].terminated, true);
  assert.equal(await getLocalEngine("crash-test"), null);
});

test("超时且不回复 bestmove 的引擎不会永久阻塞走棋", async (t) => {
  const workers = mockWorker(t);
  await getLocalEngine("timeout-test");
  let expire;
  t.mock.method(globalThis, "setTimeout", (fn) => { expire = fn; return 1; });
  t.mock.method(globalThis, "clearTimeout", () => {});
  const result = localEval("position", { variant: "timeout-test" });
  await new Promise((resolve) => setImmediate(resolve));
  const rejected = assert.rejects(result, /超时/);
  expire();
  await rejected;
  assert.equal(workers[0].terminated, true);
});
