const base = "/api";

const TOKEN_KEY = "xq_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

function authHeaders(extra = {}) {
  const t = getToken();
  return t ? { ...extra, Authorization: `Bearer ${t}` } : extra;
}

async function req(path, { method = "GET", body } = {}) {
  const opts = { method, headers: authHeaders() };
  if (body !== undefined) {
    opts.headers = authHeaders({ "Content-Type": "application/json" });
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(`${base}${path}`, opts);
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

// ── 训练 ────────────────────────────────────────────────
export const getNext = (category) =>
  req(`/training/next${category ? `?category=${encodeURIComponent(category)}` : ""}`);
export const getTrainingPuzzle = (id) => req(`/training/puzzle/${id}`);
export const checkMove = (payload) => req("/training/check_move", { method: "POST", body: payload });
export const submitRating = (payload) => req("/training/submit", { method: "POST", body: payload });

// ── 统计 ────────────────────────────────────────────────
export const getOverview = () => req("/stats/overview");
export const getByCategory = () => req("/stats/by_category");
export const getWeekly = () => req("/stats/weekly");
export const getForecast = (days = 14) => req(`/stats/forecast?days=${days}`);
export const getRating = () => req("/stats/rating");
export const getLeaderboard = (limit = 20) => req(`/stats/leaderboard?limit=${limit}`);

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

// ── 后台 ────────────────────────────────────────────────
export const adminOverview = () => req("/admin/overview");
export const adminUsers = () => req("/admin/users");
export const adminDeleteUser = (id) => req(`/admin/users/${id}`, { method: "DELETE" });
export const adminPuzzles = (limit = 100, offset = 0) =>
  req(`/admin/puzzles?limit=${limit}&offset=${offset}`);
export const adminCreatePuzzle = (payload) => req("/admin/puzzles", { method: "POST", body: payload });
export const adminDeletePuzzle = (id) => req(`/admin/puzzles/${id}`, { method: "DELETE" });
