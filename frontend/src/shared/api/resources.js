import { request } from "./client.js";

// 鉴权与账户
export const register = (username, password) => request("/auth/register", { method: "POST", body: { username, password } });
export const login = (username, password) => request("/auth/login", { method: "POST", body: { username, password } });
export const fetchMe = () => request("/auth/me");
export const getEntitlements = () => request("/account/entitlements");

// 训练
export const getNext = (category, kind) => {
  const query = new URLSearchParams();
  if (category) query.set("category", category);
  if (kind) query.set("kind", kind);
  const suffix = query.toString();
  return request(`/training/next${suffix ? `?${suffix}` : ""}`);
};
export const getTrainingPuzzle = (id, context = "training") => request(`/training/puzzle/${id}?context=${encodeURIComponent(context)}`);
export const checkMove = (payload) => request("/training/check_move", { method: "POST", body: payload });
export const submitRating = (payload) => request("/training/submit", { method: "POST", body: payload });
export const explainPuzzle = (puzzleId) => request("/training/explain", { method: "POST", body: { puzzle_id: puzzleId } });

// 统计、学习与今日计划
export const getOverview = () => request("/stats/overview");
export const getByCategory = () => request("/stats/by_category");
export const getCatalog = () => request("/stats/catalog");
export const getWeekly = () => request("/stats/weekly");
export const getForecast = (days = 14) => request(`/stats/forecast?days=${days}`);
export const getRating = () => request("/stats/rating");
export const getLeaderboard = (limit = 20) => request(`/stats/leaderboard?limit=${limit}`);
export const getToday = () => request("/today");
export const getCurriculum = () => request("/learning/curriculum");
export const getMastery = () => request("/learning/mastery");
export const getLearningProgress = (days = 28) => request(`/learning/progress?days=${days}`);
export const startAssessment = () => request("/learning/assessment/start", { method: "POST", body: {} });
export const completeLearningPack = (id) => request(`/learning/packs/${id}/complete`, { method: "POST", body: {} });
export const createGameTrainingPack = (gameId) => request(`/learning/games/${gameId}/pack`, { method: "POST", body: {} });

// 教练、积分与外观
export const getCoachPlan = () => request("/coach/plan");
export const refreshCoachPlan = () => request("/coach/plan", { method: "POST", body: {} });
export const getCredits = () => request("/credits/me");
export const checkinCredits = () => request("/credits/checkin", { method: "POST", body: {} });
export const getCosmetics = () => request("/cosmetics/catalog");
export const purchaseCosmetic = (assetKey) => request("/cosmetics/purchase", { method: "POST", body: { asset_key: assetKey } });

// 闯关与棋谱
export const getLevels = () => request("/challenge/levels");
export const getLevel = (index) => request(`/challenge/level/${index}`);
export const submitChallenge = (payload) => request("/challenge/submit", { method: "POST", body: payload });
export const getGames = (limit = 20, offset = 0) => request(`/games?limit=${limit}&offset=${offset}`);
export const importGame = (payload) => request("/games/import", { method: "POST", body: payload });
export const getGamePositions = (gameId) => request(`/games/${gameId}`);
export const deleteGame = (gameId) => request(`/games/${gameId}`, { method: "DELETE" });
export const analyzeGame = (gameId) => request(`/games/${gameId}/analyze`, { method: "POST", body: {} });
export const getAnalysis = (gameId) => request(`/games/${gameId}/analysis`);

// 后台
export const adminOverview = () => request("/admin/overview");
export const adminUsers = () => request("/admin/users");
export const adminDeleteUser = (id) => request(`/admin/users/${id}`, { method: "DELETE" });
export const adminUpdateMembership = (id, days) => request(`/admin/users/${id}/membership`, { method: "PUT", body: { days } });
export const adminAdjustCredits = (username, delta, reason = "") => request(`/admin/credits/${encodeURIComponent(username)}/adjust`, { method: "POST", body: { delta, reason } });
export const adminPuzzles = ({ limit = 20, offset = 0, category = "", difficulty = 0, q = "" } = {}) => request(`/admin/puzzles?limit=${limit}&offset=${offset}&difficulty=${difficulty}&category=${encodeURIComponent(category)}&q=${encodeURIComponent(q)}`);
export const adminCreatePuzzle = (payload) => request("/admin/puzzles", { method: "POST", body: payload });
export const adminDeletePuzzle = (id) => request(`/admin/puzzles/${id}`, { method: "DELETE" });
export const adminGetEngine = () => request("/admin/engine");
export const adminInstallEngine = (variant) => request("/admin/engine/install", { method: "POST", body: { variant: variant || null } });
export const adminRemoveEngine = () => request("/admin/engine", { method: "DELETE" });
export const adminGetJieqiEngine = () => request("/admin/engine/jieqi");
export const adminUpdateJieqiEngine = (path) => request("/admin/engine/jieqi", { method: "PUT", body: { path } });
export const adminGetLlmSettings = () => request("/admin/settings/llm");
export const adminUpdateLlmSettings = (payload) => request("/admin/settings/llm", { method: "PUT", body: payload });
export const adminTestLlmSettings = () => request("/admin/settings/llm/test", { method: "POST", body: {} });
export const adminLogs = (limit = 100, offset = 0, event = "") => request(`/admin/logs?limit=${limit}&offset=${offset}${event ? `&event=${encodeURIComponent(event)}` : ""}`);
