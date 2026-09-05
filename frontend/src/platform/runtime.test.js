import test from "node:test";
import assert from "node:assert/strict";

import {
  RUNTIME,
  defaultApiBase,
  detectRuntime,
  supportsNativeEngine,
  usesDesktopLayout,
  usesMobileLayout,
} from "./runtime.js";

test("Web 环境保持 Web 布局", () => {
  assert.equal(detectRuntime({ tauri: false, targetPlatform: "android" }), RUNTIME.WEB);
});

test("Android 构建使用移动布局并禁用原生进程引擎", () => {
  const value = detectRuntime({ tauri: true, targetPlatform: "android" });
  assert.equal(value, RUNTIME.ANDROID);
  assert.equal(usesMobileLayout(value), true);
  assert.equal(usesDesktopLayout(value), false);
  assert.equal(supportsNativeEngine(value), false);
});

test("Android WebView 可在未注入构建标记时被识别", () => {
  assert.equal(detectRuntime({ tauri: true, userAgent: "Mozilla/5.0 (Linux; Android 15) wv" }), RUNTIME.ANDROID);
});

test("桌面 Tauri 保留 PC 布局和本地引擎", () => {
  const value = detectRuntime({ tauri: true, targetPlatform: "desktop", userAgent: "Windows" });
  assert.equal(value, RUNTIME.DESKTOP);
  assert.equal(usesDesktopLayout(value), true);
  assert.equal(supportsNativeEngine(value), true);
  assert.equal(defaultApiBase(value), "http://localhost:8000/api");
});
