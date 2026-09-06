const STORAGE_KEY_PREFIX = "xq_analysis_preferences";

export const DEFAULT_ANALYSIS_PREFERENCES = Object.freeze({
  mode: "movetime",
  time: 1000,
  depth: 18,
  multiPv: 1,
});

const MODES = new Set(["movetime", "depth", "infinite"]);
const TIMES = new Set([500, 1000, 3000, 5000]);
const MULTI_PV = new Set([1, 3, 5]);

function storageKey(variant) {
  return `${STORAGE_KEY_PREFIX}_${variant === "jieqi" ? "jieqi" : "xiangqi"}`;
}

export function normalizeAnalysisPreferences(value = {}) {
  const depth = Number(value.depth);
  return {
    mode: MODES.has(value.mode) ? value.mode : DEFAULT_ANALYSIS_PREFERENCES.mode,
    time: TIMES.has(Number(value.time)) ? Number(value.time) : DEFAULT_ANALYSIS_PREFERENCES.time,
    depth: Number.isFinite(depth) ? Math.max(1, Math.min(30, Math.round(depth))) : DEFAULT_ANALYSIS_PREFERENCES.depth,
    multiPv: MULTI_PV.has(Number(value.multiPv)) ? Number(value.multiPv) : DEFAULT_ANALYSIS_PREFERENCES.multiPv,
  };
}

export function analysisPreferences(variant = "xiangqi") {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(variant)) || "{}");
    return normalizeAnalysisPreferences(saved);
  } catch {
    return { ...DEFAULT_ANALYSIS_PREFERENCES };
  }
}

export function saveAnalysisPreferences(value, variant = "xiangqi") {
  const next = normalizeAnalysisPreferences(value);
  try { localStorage.setItem(storageKey(variant), JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}
