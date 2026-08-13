/// <reference types="vite/client" />

/**
 * 入口：挂载 `TaleApp`，并在 dev 下开一个只读调试出口给 E2E 用。
 *
 * `?seed=<数字>` 固定随机种子（可复现的手测／截图）；`?reset=1` 清掉血统存档从头开始。
 */

import { TaleApp } from "./app.js";
import { historianConfig } from "./ai/historian.js";
import { scenarioConfig } from "./ai/scenario.js";
import { BLOODLINE_KEY, browserStorage } from "./persist/bloodline.js";
import { GUIDE_KEY } from "./persist/guide.js";

const params = new URLSearchParams(globalThis.location.search);
const rawSeed = params.get("seed");
const seed = rawSeed !== null && /^\d+$/.test(rawSeed) ? Number.parseInt(rawSeed, 10) >>> 0 : undefined;

if (params.get("reset") === "1") {
  try {
    const storage = browserStorage();
    storage?.removeItem(BLOODLINE_KEY);
    // 引导链的「看过了」标记一并清掉：`?reset=1` 的用处就是「当一个全新玩家」，
    // 留着它会让首世引导在验收与手测时永远不出现（E2E 首先要看的就是它）。
    storage?.removeItem(GUIDE_KEY);
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

/*
 * [P1 AI 史官] 开关在这里算一次：dev 才开（生产构建没有 `/ai/chat` 那个端点），
 * `?ai=0` 强制关（离线回落验收用），`?aimodel=litellm/<名>` 换模型（试模型用）。
 * app.ts 因此不必认识 vite 的 env，测试里默认就是关的。
 */
const ai = historianConfig(globalThis.location.search, import.meta.env.DEV);

/*
 * [P2 一世一剧本] 同样在这里算一次：dev 才开，`?scenario=0`（或 `?ai=0`）强制关，
 * `?scenariomodel=litellm/<名>` 换模型。生产构建没有 `/ai/chat`，开着也只会四次 404。
 */
const scenario = scenarioConfig(globalThis.location.search, import.meta.env.DEV);

const app = new TaleApp(root, {
  ...(seed === undefined ? {} : { seed }),
  ...(grantOrganIds.length > 0 ? { grantOrganIds } : {}),
  ai,
  scenario,
});
app.start();

if (import.meta.env.DEV) {
  // 只读快照 —— E2E 靠它判断当前该点哪个按钮，不提供任何改状态的入口
  // （能从外面改 TaleState 就等于把游戏逻辑漏到了界面之外）。
  (globalThis as unknown as Record<string, unknown>).__tale = {
    snapshot: () => app.debugSnapshot(),
  };
}
