import { defineConfig } from "vite";

// 5174：3D 版 packages/client 占着 5173，两者可同时开着比对。
// strictPort：端口被占时直接失败，别静默漂到 5175 —— E2E 脚本按固定端口连。
export default defineConfig({ server: { port: 5174, strictPort: true } });
