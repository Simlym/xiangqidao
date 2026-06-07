import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // 开发时把 /api 代理到后端，免去跨域配置
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
