export const RUNTIME = Object.freeze({
  WEB: "web",
  DESKTOP: "desktop",
  ANDROID: "android",
});

export function detectRuntime({
  tauri = typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__),
  targetPlatform = import.meta.env?.VITE_TARGET_PLATFORM,
  userAgent = globalThis.navigator?.userAgent || "",
} = {}) {
  if (!tauri) return RUNTIME.WEB;
  if (targetPlatform === "android" || /Android/i.test(userAgent)) return RUNTIME.ANDROID;
  return RUNTIME.DESKTOP;
}

export function isTauriRuntime(value = runtime) {
  return value === RUNTIME.DESKTOP || value === RUNTIME.ANDROID;
}

export function supportsNativeEngine(value = runtime) {
  return value === RUNTIME.DESKTOP;
}

export function usesMobileLayout(value = runtime) {
  return value === RUNTIME.ANDROID;
}

export function usesDesktopLayout(value = runtime) {
  return value === RUNTIME.DESKTOP;
}

export function defaultApiBase(value = runtime) {
  if (value === RUNTIME.DESKTOP) return "http://localhost:8000/api";
  return "/api";
}

export const runtime = detectRuntime();

