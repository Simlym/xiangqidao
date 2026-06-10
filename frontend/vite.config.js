import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
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
});
