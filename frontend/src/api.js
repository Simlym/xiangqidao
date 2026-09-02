import { RUNTIME, runtime } from "./platform/runtime";

function normalizeApiBase(value) {
  const trimmed = value?.trim();
  if (!trimmed) return runtime === RUNTIME.TAURI ? "http://localhost:8000/api" : "/api";
  return trimmed.replace(/\/+$/, "");
}

// Web 版默认请求当前站点的 /api；PC 安装包没有 Web 反向代理，因此需要在
// frontend/.env.tauri.local 中用 VITE_API_BASE_URL 指向实际部署的 Web 服务。
export const API_BASE_URL = normalizeApiBase(import.meta.env?.VITE_API_BASE_URL);

const TOKEN_KEY = "xq_token";
const GUEST_KEY = "xq_guest_id";

function makeGuestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().replaceAll("-", "");
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

export function getGuestId() {
  let id = localStorage.getItem(GUEST_KEY);
  if (!/^[a-f0-9]{32}$/.test(id || "")) {
    id = makeGuestId();
    localStorage.setItem(GUEST_KEY, id);
  }
  return id;
}

export function resetGuestId() {
  localStorage.setItem(GUEST_KEY, makeGuestId());
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

function authHeaders(extra = {}) {
  const t = getToken();
  return {
    ...extra,
    "X-Guest-ID": getGuestId(),
    ...(t ? { Authorization: `Bearer ${t}` } : {}),
  };
}

async function req(path, { method = "GET", body, signal } = {}) {
  const opts = { method, headers: authHeaders(), signal };
  if (body !== undefined) {
    opts.headers = authHeaders({ "Content-Type": "application/json" });
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(`${API_BASE_URL}${path}`, opts);
  if (!r.ok) {
    let detail = "请求失败";
    try {
      detail = (await r.json()).detail || detail;
    } catch {
      /* ignore */
    }
    const err = new Error(detail);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

// ── 鉴权 ────────────────────────────────────────────────
export const register = (username, password) =>
  req("/auth/register", { method: "POST", body: { username, password } });
export const login = (username, password) =>
  req("/auth/login", { method: "POST", body: { username, password } });
export const fetchMe = () => req("/auth/me");
export const getEntitlements = () => req("/account/entitlements");

// ── 训练 ────────────────────────────────────────────────
export const getNext = (category, kind) => {
  const qs = new URLSearchParams();
  if (category) qs.set("category", category);
  if (kind) qs.set("kind", kind);
  const s = qs.toString();
  return req(`/training/next${s ? `?${s}` : ""}`);
};
export const getTrainingPuzzle = (id, context = "training") =>
  req(`/training/puzzle/${id}?context=${encodeURIComponent(context)}`);
export const checkMove = (payload) => req("/training/check_move", { method: "POST", body: payload });
export const submitRating = (payload) => req("/training/submit", { method: "POST", body: payload });
export const explainPuzzle = (puzzleId) =>
  req("/training/explain", { method: "POST", body: { puzzle_id: puzzleId } });

// ── 统计 ────────────────────────────────────────────────
export const getOverview = () => req("/stats/overview");
export const getByCategory = () => req("/stats/by_category");
export const getCatalog = () => req("/stats/catalog");
export const getWeekly = () => req("/stats/weekly");
export const getForecast = (days = 14) => req(`/stats/forecast?days=${days}`);
export const getRating = () => req("/stats/rating");
export const getLeaderboard = (limit = 20) => req(`/stats/leaderboard?limit=${limit}`);
export const getToday = () => req("/today");
export const getCurriculum = () => req("/learning/curriculum");
export const getMastery = () => req("/learning/mastery");
export const getLearningProgress = (days = 28) => req(`/learning/progress?days=${days}`);
export const startAssessment = () => req("/learning/assessment/start", { method: "POST", body: {} });
export const completeLearningPack = (id) => req(`/learning/packs/${id}/complete`, { method: "POST", body: {} });
export const createGameTrainingPack = (gameId) => req(`/learning/games/${gameId}/pack`, { method: "POST", body: {} });

// ── AI 教练 ─────────────────────────────────────────────
export const getCoachPlan = () => req("/coach/plan");
export const refreshCoachPlan = () => req("/coach/plan", { method: "POST", body: {} });

// ── 积分 ────────────────────────────────────────────────
export const getCredits = () => req("/credits/me");
export const checkinCredits = () => req("/credits/checkin", { method: "POST", body: {} });

// ── 外观商店 ──────────────────────────────
export const getCosmetics = () => req("/cosmetics/catalog");
export const purchaseCosmetic = (assetKey) =>
  req("/cosmetics/purchase", { method: "POST", body: { asset_key: assetKey } });

// ── 闯关 ────────────────────────────────────────────────
export const getLevels = () => req("/challenge/levels");
export const getLevel = (index) => req(`/challenge/level/${index}`);
export const submitChallenge = (payload) =>
  req("/challenge/submit", { method: "POST", body: payload });

// ── 复盘 ────────────────────────────────────────────────
export const getGames = (limit = 20, offset = 0) => req(`/games?limit=${limit}&offset=${offset}`);
export const importGame = (payload) => req("/games/import", { method: "POST", body: payload });
export const getGamePositions = (gameId) => req(`/games/${gameId}`);
export const deleteGame = (gameId) => req(`/games/${gameId}`, { method: "DELETE" });
export const analyzeGame = (gameId) => req(`/games/${gameId}/analyze`, { method: "POST", body: {} });
export const getAnalysis = (gameId) => req(`/games/${gameId}/analysis`);

// ── 对弈 ────────────────────────────────────────────────
export const newPlayGame = (payload) => req("/play/new", { method: "POST", body: payload });
export const playMove = (payload) => req("/play/move", { method: "POST", body: payload });
export const getPositionState = (fen) => req("/play/state", { method: "POST", body: { fen } });
function enginePayload(fen, options = {}) {
  return {
    fen,
    depth: options.depth || 12,
    mode: options.mode || "depth",
    value: options.value ?? null,
    multipv: options.multiPv || 1,
    show_wdl: Boolean(options.showWdl),
    search_moves: options.searchMoves || [],
  };
}

function normalizeEngineResult(result) {
  const normalizeWdl = (wdl) => Array.isArray(wdl) ? { win: wdl[0], draw: wdl[1], loss: wdl[2] } : wdl;
  const lines = (result.lines || []).map((line) => ({
    ...line,
    score: line.score_mate != null
      ? { type: "mate", value: line.score_mate, pov: "red" }
      : line.score_cp != null ? { type: "cp", value: line.score_cp, pov: "red" } : null,
    timeMs: line.time_ms,
    wdl: normalizeWdl(line.wdl),
  }));
  return {
    ...result,
    bestMove: result.best_move,
    timeMs: result.time_ms,
    wdl: normalizeWdl(result.wdl),
    lines,
  };
}

async function streamEngine(path, fen, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(enginePayload(fen, options)),
    signal: options.signal,
  });
  if (!response.ok) {
    let message = "流式分析启动失败";
    try { message = (await response.json()).detail || message; } catch { /* ignore */ }
    throw new Error(message);
  }
  if (!response.body) throw new Error("当前环境不支持流式响应");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const linesByPv = new Map();
  let buffer = "";
  let finalResult = null;

  const consume = (raw) => {
    if (!raw.trim()) return;
    const event = JSON.parse(raw);
    if (event.type === "error") throw new Error(event.data?.message || "引擎分析失败");
    const value = normalizeEngineResult(event.data || {});
    if (event.type === "info") {
      for (const line of value.lines || []) linesByPv.set(line.multipv || 1, line);
      const lines = [...linesByPv.values()].sort((a, b) => (a.multipv || 1) - (b.multipv || 1));
      const best = lines[0];
      options.onUpdate?.({
        ...value,
        cp: best?.score?.type === "cp" ? best.score.value : value.cp,
        mate: best?.score?.type === "mate" ? best.score.value : value.mate,
        bestMove: best?.pv?.[0] || value.bestMove,
        pv: best?.pv || value.pv,
        wdl: best?.wdl || value.wdl,
        lines,
      });
    } else if (event.type === "complete") finalResult = value;
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const rows = buffer.split("\n");
    buffer = rows.pop() || "";
    for (const row of rows) consume(row);
    if (done) break;
  }
  if (buffer) consume(buffer);
  if (!finalResult) throw new Error("流式分析未返回最终结果");
  return finalResult;
}

export const evalPosition = async (fen, options = {}) => normalizeEngineResult(await req("/play/eval", {
  method: "POST", body: enginePayload(fen, options), signal: options.signal,
}));
export const streamEvalPosition = (fen, options = {}) => streamEngine("/play/eval/stream", fen, options);
export const getPlayEngine = () => req("/play/engine");
export const getBookMoves = (fen) => req(`/play/book?fen=${encodeURIComponent(fen)}`);
export const getHint = (fen) => req("/play/hint", { method: "POST", body: { fen } });
export const coachHintMove = (fen, move) =>
  req("/play/coach", { method: "POST", body: { fen, move } });
export const evalJieqiPosition = async (fen, options = {}) => {
  const result = await req("/variants/jieqi/eval", {
    method: "POST", body: enginePayload(fen, options), signal: options.signal,
  });
  return normalizeEngineResult(result);
};
export const streamJieqiPosition = (fen, options = {}) => streamEngine("/variants/jieqi/eval/stream", fen, options);

// ── 后台 ────────────────────────────────────────────────
export const adminOverview = () => req("/admin/overview");
export const adminUsers = () => req("/admin/users");
export const adminDeleteUser = (id) => req(`/admin/users/${id}`, { method: "DELETE" });
export const adminUpdateMembership = (id, days) =>
  req(`/admin/users/${id}/membership`, { method: "PUT", body: { days } });
export const adminAdjustCredits = (username, delta, reason = "") =>
  req(`/admin/credits/${encodeURIComponent(username)}/adjust`, {
    method: "POST",
    body: { delta, reason },
  });
export const adminPuzzles = ({ limit = 20, offset = 0, category = "", difficulty = 0, q = "" } = {}) =>
  req(`/admin/puzzles?limit=${limit}&offset=${offset}&difficulty=${difficulty}` +
      `&category=${encodeURIComponent(category)}&q=${encodeURIComponent(q)}`);
export const adminCreatePuzzle = (payload) => req("/admin/puzzles", { method: "POST", body: payload });
export const adminDeletePuzzle = (id) => req(`/admin/puzzles/${id}`, { method: "DELETE" });
export const adminGetEngine = () => req("/admin/engine");
export const adminInstallEngine = (variant) =>
  req("/admin/engine/install", { method: "POST", body: { variant: variant || null } });
export const adminRemoveEngine = () => req("/admin/engine", { method: "DELETE" });
export const adminGetJieqiEngine = () => req("/admin/engine/jieqi");
export const adminUpdateJieqiEngine = (path) =>
  req("/admin/engine/jieqi", { method: "PUT", body: { path } });
export const adminGetLlmSettings = () => req("/admin/settings/llm");
export const adminUpdateLlmSettings = (payload) =>
  req("/admin/settings/llm", { method: "PUT", body: payload });
export const adminTestLlmSettings = () => req("/admin/settings/llm/test", { method: "POST", body: {} });
export const adminLogs = (limit = 100, offset = 0, event = "") =>
  req(`/admin/logs?limit=${limit}&offset=${offset}${event ? `&event=${event}` : ""}`);
