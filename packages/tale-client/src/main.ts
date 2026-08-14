/// <reference types="vite/client" />

/**
 * 入口：挂载 `TaleApp`，并在 dev 下开一个只读调试出口给 E2E 用。
 *
 * `?seed=<数字>` 固定随机种子（可复现的手测／截图）；`?reset=1` 清掉血统存档从头开始。
 */

import { TaleApp } from "./app.js";
import { CONTENT as CONTENT_FOR_E2E } from "./content.js";
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

/**
 * `?lore=xuan-mang,yan-yang` —— **仅 dev**：出生就带上这几头兽的「图鉴知识」。
 * S3 验收要拍「同一头猎物、已识与未识」的对照图，而那两张必须来自同一个种子同一场追猎。
 */
const grantLoreEnemyIds = import.meta.env.DEV
  ? (params.get("lore") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => /^[a-z0-9-]+$/.test(id))
  : [];

/**
 * `?essence=120` —— **仅 dev**：降世时四型精气各给这么多。
 *
 * B2 的验收要拍「两套风格完全不同的招式」的面板原文，而一副特定的拼法要攒好几年精气。
 * 与 `?organs=` 同一条纪律：它只在**降世那一刻**加一次，不是运行时后门。
 */
const grantEssence = import.meta.env.DEV
  ? Number.parseInt(params.get("essence") ?? "0", 10) || 0
  : 0;

/**
 * `?foe=jiu-wei-hu` —— **仅 dev**：降世那一刻直接摆一场与这头兽的遭遇。
 *
 * B3 的验收要「抽三头新兽贴屏幕全文」，而十三头新兽全部只从探索遇袭里来
 * （绝境也才三成二遇袭）—— 想在实机上见到指定的一头，期望要探十几季，
 * 而那一世多半先饿死。同另外三个 dev 入口：只在**降世那一刻**生效，不是运行时后门。
 */
const devFoeId = import.meta.env.DEV
  ? (params.get("foe") ?? "").trim().match(/^[a-z0-9-]+$/)?.[0] ?? ""
  : "";

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
  ...(grantLoreEnemyIds.length > 0 ? { grantLoreEnemyIds } : {}),
  ...(grantEssence > 0 ? { grantEssence } : {}),
  ...(devFoeId === "" ? {} : { devFoeId }),
  ai,
  scenario,
});
app.start();

if (import.meta.env.DEV) {
  // 只读快照 —— E2E 靠它判断当前该点哪个按钮，不提供任何改状态的入口
  // （能从外面改 TaleState 就等于把游戏逻辑漏到了界面之外）。
  (globalThis as unknown as Record<string, unknown>).__tale = {
    snapshot: () => app.debugSnapshot(),
    /*
     * [饥饿节奏批] 内容库的**基线**调参（只读，**不含天时／出身的加成** ——
     * 那一份要 `lifeTuning(state, content)`，而这个出口拿不到 state）。
     * E2E 的驱动脚本要按「还够几季」决定这一季干什么，
     * 而那个数 ＝ (饱食 ＋ 食余×每季那一份) ÷ 每季消耗 —— 三项全在 tuning 里。
     * 让脚本自己抄一份常数，就会在下一次调参之后**量一个已经不存在的世界**
     * （同实验台 import 客户端 `CHANCE_BANDS` 那条理由）。这些数本来就写在屏幕上，不是秘密。
     */
    tuning: () => CONTENT_FOR_E2E.tuning,
    /*
     * [S3] 内容库里**全部**名号（只读）。E2E 的「不泄露」那一问要它：判据是
     * 「未发现的东西，它的名字在整页 innerText 里搜不到」，而那要有一份完整的名单去搜。
     * 从屏幕上是拿不到这份名单的 —— 那正是它该拿不到的原因。dev 专用（生产构建里
     * `import.meta.env.DEV` 为假，这一整段不生效）。
     */
    names: () => ({
      synergies: Object.fromEntries(CONTENT_FOR_E2E.synergies.map((item) => [item.id, item.name])),
      enemies: Object.fromEntries(CONTENT_FOR_E2E.enemies.map((item) => [item.id, item.name])),
      treasures: Object.fromEntries(
        CONTENT_FOR_E2E.destinations.map((item) => [item.treasure.id, item.treasure.name]),
      ),
      sigils: Object.fromEntries(CONTENT_FOR_E2E.sigils.map((item) => [item.id, item.name])),
    }),
  };
}
