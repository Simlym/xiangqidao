import React from "react";

// 外观偏好保存在本机；已购权益由服务端目录确认。
const STORAGE_KEY = "xq_cosmetic_preferences";
const EVENT_NAME = "xq-cosmetics-changed";

const DEFAULTS = { app: "classic", board: "classic", piece: "classic" };
const ALLOWED = {
  app: new Set(["classic", "ink", "jade", "night"]),
  board: new Set(["classic", "paper", "jade"]),
  piece: new Set(["classic", "ink", "jade"]),
};

export function cosmeticPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      app: ALLOWED.app.has(saved.app) ? saved.app : DEFAULTS.app,
      board: ALLOWED.board.has(saved.board) ? saved.board : DEFAULTS.board,
      piece: ALLOWED.piece.has(saved.piece) ? saved.piece : DEFAULTS.piece,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setCosmeticPreference(type, theme) {
  if (!ALLOWED[type]?.has(theme)) return;
  const next = { ...cosmeticPreferences(), [type]: theme };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: next }));
}

export function useCosmeticPreferences() {
  const [preferences, setPreferences] = React.useState(cosmeticPreferences);
  React.useEffect(() => {
    const update = (event) => setPreferences(event.detail || cosmeticPreferences());
    window.addEventListener(EVENT_NAME, update);
    return () => window.removeEventListener(EVENT_NAME, update);
  }, []);
  return preferences;
}
