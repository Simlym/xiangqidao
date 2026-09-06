import test from "node:test";
import assert from "node:assert/strict";
import { importBrowserEnginePackage } from "./browserEnginePackages.js";

function environment(t) {
  const values = new Map();
  const entries = new Map();
  const previousStorage = globalThis.localStorage;
  const previousCaches = globalThis.caches;
  globalThis.localStorage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  globalThis.caches = {
    async open() {
      return {
        async put(key, value) { entries.set(String(key), value); },
        async keys() { return [...entries.keys()].map((url) => new Request(`https://example.test${url}`)); },
        async delete(key) { entries.delete(new URL(key.url).pathname); },
      };
    },
  };
  t.after(() => { globalThis.localStorage = previousStorage; globalThis.caches = previousCaches; });
  return { values, entries };
}

test("浏览器引擎包必须包含清单", async (t) => {
  environment(t);
  await assert.rejects(importBrowserEnginePackage([new File(["worker"], "engine.worker.js")]), /engine-manifest/);
});

test("兼容的 WASM UCI 包只保存到设备缓存", async (t) => {
  const { values, entries } = environment(t);
  const manifest = {
    schemaVersion: 1, id: "demo", name: "Demo", version: "1", variant: "xiangqi",
    runtime: "wasm", protocol: "uci", entrypoint: "engine.worker.js",
    assets: [{ path: "engine.wasm", role: "wasm" }],
  };
  const profile = await importBrowserEnginePackage([
    new File([JSON.stringify(manifest)], "engine-manifest.json", { type: "application/json" }),
    new File(["worker"], "engine.worker.js", { type: "text/javascript" }),
    new File([new Uint8Array([0, 97, 115, 109])], "engine.wasm", { type: "application/wasm" }),
  ]);
  assert.equal(profile.name, "Demo");
  assert.equal(entries.size, 3);
  const workerResponse = entries.get("/__user-engines__/xiangqi/demo/engine.worker.js");
  assert.equal(workerResponse.headers.get("Cross-Origin-Embedder-Policy"), "require-corp");
  assert.equal(workerResponse.headers.get("Cross-Origin-Resource-Policy"), "same-origin");
  assert.match(values.get("xq.browserEngine.xiangqi"), /__user-engines__/);
});
