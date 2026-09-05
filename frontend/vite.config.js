import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const tauriDevHost = process.env.TAURI_DEV_HOST;
  const androidApiBase = env.VITE_API_BASE_URL?.replace(/\/+$/, "") || "";
  if (mode === "android" && command === "build" && !/^https:\/\/[^/]+(?:\/.*)?\/api$/i.test(androidApiBase)) {
    throw new Error("Android 构建前请在 frontend/.env.android.local 中配置 HTTPS 的 VITE_API_BASE_URL（必须以 /api 结尾）");
  }
  if (mode === "android" && command === "serve" && !/^https?:\/\/[^/]+(?:\/.*)?\/api$/i.test(androidApiBase)) {
    throw new Error("Android 调试请配置设备可访问的 VITE_API_BASE_URL（完整 HTTP/HTTPS 地址，以 /api 结尾）");
  }

  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      host: tauriDevHost || undefined,
      // Tauri 移动端从模拟器/真机连回开发电脑，HMR 不能使用设备自身的 localhost。
      hmr: tauriDevHost
        ? { protocol: "ws", host: tauriDevHost, port: 5173 }
        : undefined,
      // 多线程 WASM 引擎依赖 SharedArrayBuffer，需要跨源隔离响应头；
      // 单线程引擎构建不受影响。生产部署时需在 Web 服务器上配置同样的头。
      headers: {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      },
      // 开发时把 /api 代理到后端，免去跨域配置
      proxy: {
        "/api": "http://localhost:8000",
      },
    },
  };
});
