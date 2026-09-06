const CACHE_NAME = "xiangqidao-user-engines-v1";
const PROFILE_PREFIX = "xq.browserEngine.";
const BASE_PREFIX = "/__user-engines__/";

const profileKey = (variant) => `${PROFILE_PREFIX}${variant}`;

export function getBrowserEngineProfile(variant = "xiangqi") {
  try {
    return JSON.parse(localStorage.getItem(profileKey(variant))) || null;
  } catch {
    return null;
  }
}

export function browserEngineCapabilities() {
  return {
    webAssembly: typeof WebAssembly !== "undefined",
    worker: typeof Worker !== "undefined",
    cacheStorage: typeof caches !== "undefined",
    threads: typeof SharedArrayBuffer !== "undefined" && globalThis.crossOriginIsolated === true,
    cpuCount: Number(globalThis.navigator?.hardwareConcurrency) || null,
    memoryGb: Number(globalThis.navigator?.deviceMemory) || null,
  };
}

function safeRelativePath(file) {
  const raw = file.webkitRelativePath || file.name;
  const parts = raw.replaceAll("\\", "/").split("/").filter(Boolean);
  if (parts.some((part) => part === "..")) throw new Error("引擎包包含不安全路径");
  return parts.length > 1 ? parts.slice(1).join("/") : parts[0];
}

export async function importBrowserEnginePackage(fileList, variant = "xiangqi") {
  const files = [...fileList];
  if (!files.length) throw new Error("请选择解压后的引擎包目录");
  if (files.length > 40) throw new Error("引擎包文件数量超过限制（40 个）");
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > 256 * 1024 * 1024) throw new Error("引擎包超过 256 MB 限制");

  const paths = new Map(files.map((file) => [safeRelativePath(file), file]));
  const manifestFile = paths.get("engine-manifest.json");
  if (!manifestFile) throw new Error("缺少 engine-manifest.json，请使用符合象棋道规范的 WASM 引擎包");
  let manifest;
  try {
    manifest = JSON.parse(await manifestFile.text());
  } catch {
    throw new Error("engine-manifest.json 格式错误");
  }
  if (manifest.schemaVersion !== 1 || manifest.runtime !== "wasm" || manifest.protocol !== "uci") {
    throw new Error("只支持 schemaVersion=1、runtime=wasm、protocol=uci 的引擎包");
  }
  if (manifest.variant !== variant) throw new Error(`该引擎包用于 ${manifest.variant || "未知棋种"}，与当前棋种不匹配`);
  if (!manifest.entrypoint || !paths.has(manifest.entrypoint)) throw new Error("清单中的 entrypoint 文件不存在");
  for (const asset of manifest.assets || []) {
    if (!asset?.path || !paths.has(asset.path)) throw new Error(`清单资源不存在：${asset?.path || "未知"}`);
  }

  const packageId = String(manifest.id || "user-engine").replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80);
  const base = `${BASE_PREFIX}${variant}/${packageId}/`;
  const cache = await caches.open(CACHE_NAME);
  const previous = getBrowserEngineProfile(variant);
  if (previous?.base) {
    for (const request of await cache.keys()) if (new URL(request.url).pathname.startsWith(previous.base)) await cache.delete(request);
  }
  for (const [path, file] of paths) {
    const extension = path.split(".").pop()?.toLowerCase();
    const fallbackType = extension === "js" ? "text/javascript"
      : extension === "wasm" ? "application/wasm"
        : extension === "json" ? "application/json" : "application/octet-stream";
    await cache.put(`${base}${path}`, new Response(file, { headers: { "Content-Type": file.type || fallbackType } }));
  }
  const profile = {
    id: packageId,
    name: String(manifest.name || packageId),
    version: String(manifest.version || "unknown"),
    variant,
    base,
    entrypoint: manifest.entrypoint,
    network: (manifest.assets || []).find((item) => item.role === "evaluation-network")?.path || null,
  };
  localStorage.setItem(profileKey(variant), JSON.stringify(profile));
  return profile;
}

export async function removeBrowserEnginePackage(variant = "xiangqi") {
  const profile = getBrowserEngineProfile(variant);
  if (profile?.base && typeof caches !== "undefined") {
    const cache = await caches.open(CACHE_NAME);
    for (const request of await cache.keys()) if (new URL(request.url).pathname.startsWith(profile.base)) await cache.delete(request);
  }
  localStorage.removeItem(profileKey(variant));
}
