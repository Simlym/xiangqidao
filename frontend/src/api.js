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
