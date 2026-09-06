import { defaultApiBase, runtime } from "../../platform/runtime.js";
import { getGuestId, getToken } from "./session.js";

function normalizeApiBase(value) {
  const trimmed = value?.trim();
  if (!trimmed) return defaultApiBase(runtime);
  return trimmed.replace(/\/+$/, "");
}

// Web 默认访问同源 /api；PC 与 Android 发布包通过各自环境文件指向 HTTPS 服务。
export const API_BASE_URL = normalizeApiBase(import.meta.env?.VITE_API_BASE_URL);

export function authHeaders(extra = {}) {
  const token = getToken();
  return {
    ...extra,
    "X-Guest-ID": getGuestId(),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function readableErrorDetail(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        const message = item?.msg || item?.message;
        const location = Array.isArray(item?.loc)
          ? item.loc.map((part) => part === "body" ? "请求体" : part).join(".")
          : "";
        if (message && location) return `${location}：${message}`;
        return message || JSON.stringify(item);
      })
      .filter(Boolean)
      .join("；");
  }
  if (value && typeof value === "object") return value.msg || value.message || JSON.stringify(value);
  return "请求失败";
}

export async function request(path, { method = "GET", body, signal } = {}) {
  const options = { method, headers: authHeaders(), signal };
  if (body !== undefined) {
    options.headers = authHeaders({ "Content-Type": "application/json" });
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${API_BASE_URL}${path}`, options);
  if (!response.ok) {
    let detail = "请求失败";
    try { detail = readableErrorDetail((await response.json()).detail); } catch { /* 非 JSON 响应 */ }
    const error = new Error(detail);
    error.status = response.status;
    throw error;
  }
  return response.json();
}
