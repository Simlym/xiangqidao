// 象棋道 PWA service worker（极简）：提供安装能力与离线壳缓存。
const CACHE = "xq-shell-v1";

self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});

// 网络优先、失败回退缓存的简单策略，只缓存同源 GET。
self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(request)
      .then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        return resp;
      })
      .catch(() => caches.match(request))
  );
});

// 点击通知聚焦/打开应用。
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window" }).then((cs) => {
      for (const c of cs) if ("focus" in c) return c.focus();
      return self.clients.openWindow("/");
    })
  );
});
