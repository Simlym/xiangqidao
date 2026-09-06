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

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}
