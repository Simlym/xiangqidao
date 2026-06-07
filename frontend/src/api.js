const base = "/api";

export async function getNext() {
  const r = await fetch(`${base}/training/next`);
  return r.json();
}

export async function checkMove(payload) {
  const r = await fetch(`${base}/training/check_move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return r.json();
}

export async function submitRating(payload) {
  const r = await fetch(`${base}/training/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return r.json();
}

export async function getOverview() {
  return (await fetch(`${base}/stats/overview`)).json();
}

export async function getByCategory() {
  return (await fetch(`${base}/stats/by_category`)).json();
}

export async function getWeekly() {
  return (await fetch(`${base}/stats/weekly`)).json();
}

export async function getGames(limit = 20, offset = 0) {
  return (await fetch(`${base}/games?limit=${limit}&offset=${offset}`)).json();
}

export async function importGame(payload) {
  const r = await fetch(`${base}/games/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return r.json();
}

export async function getGamePositions(gameId) {
  return (await fetch(`${base}/games/${gameId}`)).json();
}

export async function deleteGame(gameId) {
  const r = await fetch(`${base}/games/${gameId}`, { method: "DELETE" });
  return r.json();
}

export async function analyzeGame(gameId) {
  const r = await fetch(`${base}/games/${gameId}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  return r.json();
}

export async function getAnalysis(gameId) {
  return (await fetch(`${base}/games/${gameId}/analysis`)).json();
}

export async function newPlayGame(payload) {
  const r = await fetch(`${base}/play/new`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return r.json();
}

export async function playMove(payload) {
  const r = await fetch(`${base}/play/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error("illegal");
  return r.json();
}
