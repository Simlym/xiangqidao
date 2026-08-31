export const RUNTIME = Object.freeze({
  WEB: "web",
  TAURI: "tauri",
});

export function detectRuntime() {
  if (typeof window !== "undefined" && window.__TAURI_INTERNALS__) {
    return RUNTIME.TAURI;
  }
  return RUNTIME.WEB;
}

export const runtime = detectRuntime();

