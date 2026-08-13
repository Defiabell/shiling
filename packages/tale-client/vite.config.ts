import { defineConfig } from "vite";
import { aigwPlugin } from "./vite-aigw.js";

// 5174：3D 版 packages/client 占着 5173，两者可同时开着比对。
// strictPort：端口被占时直接失败，别静默漂到 5175 —— E2E 脚本按固定端口连。
//
// aigwPlugin 只在 dev 下挂 /ai/chat 与 /ai/telemetry（密钥留在 Node 侧，见该文件头注）。
export default defineConfig({
  plugins: [aigwPlugin()],
  server: { port: 5174, strictPort: true },
});
