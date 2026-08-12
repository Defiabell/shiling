/// <reference types="vite/client" />

/**
 * 入口：挂载 `TaleApp`，并在 dev 下开一个只读调试出口给 E2E 用。
 *
 * `?seed=<数字>` 固定随机种子（可复现的手测／截图）；`?reset=1` 清掉血统存档从头开始。
 */

import { TaleApp } from "./app.js";
import { BLOODLINE_KEY, browserStorage } from "./persist/bloodline.js";

const params = new URLSearchParams(globalThis.location.search);
const rawSeed = params.get("seed");
const seed = rawSeed !== null && /^\d+$/.test(rawSeed) ? Number.parseInt(rawSeed, 10) >>> 0 : undefined;

if (params.get("reset") === "1") {
  try {
    browserStorage()?.removeItem(BLOODLINE_KEY);
  } catch {
    /* 存档清不掉也不该挡住开局 */
  }
}

/**
 * `?organs=ye-tong,ji-zu` —— **仅 dev**：出生时多给几枚器官，用于对照实验
 * （P1 要证明「带夜瞳与不带」的信息差，而器官靠真玩要攒好几年）。
 * 生产构建里这一段直接不生效，`import.meta.env.DEV` 为假时连读都不读。
 */
const grantOrganIds = import.meta.env.DEV
  ? (params.get("organs") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => /^[a-z0-9-]+$/.test(id))
  : [];

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("main: 找不到 #app 挂载点");

const app = new TaleApp(root, {
  ...(seed === undefined ? {} : { seed }),
  ...(grantOrganIds.length > 0 ? { grantOrganIds } : {}),
});
app.start();

if (import.meta.env.DEV) {
  // 只读快照 —— E2E 靠它判断当前该点哪个按钮，不提供任何改状态的入口
  // （能从外面改 TaleState 就等于把游戏逻辑漏到了界面之外）。
  (globalThis as unknown as Record<string, unknown>).__tale = {
    snapshot: () => app.debugSnapshot(),
  };
}
