/**
 * 开局目标链（M15 P2「引导链＋巢穴存在感」——owner feedback「还是没有巢穴概念」）：
 * 巢穴系统本身早就存在（挖洞→钻入按住 E 12 秒→home nest，附带存粮/蛰伏），owner 玩了
 * 一局却完全没发现——问题不是系统缺失，是可发现性（discoverability）。本模块是纯客户端
 * 的顺序引导：五个目标依次亮出文案，each 通过只读观察 sim 状态判定是否完成，不改任何
 * sim 逻辑（本文件不 import @shiling/sim 的任何写操作，只把 main.ts 已经在读的字段
 * 打包成一份 ObjectiveSnapshot 传进来——见 ObjectiveSnapshot 的字段注释）。
 *
 * 纯逻辑（advanceObjective/OBJECTIVES）与 DOM 工厂（createObjectivesTracker）拆开导出，
 * 镜像 hud.ts 的 contextPrompt/statusLabel 与 createHud() 的拆分惯例——本工程的 vitest
 * 没有配置 jsdom（见 audio.test.ts 头部注释），`document`/`window` 在测试环境里不存在，
 * 所以只有前者可以被单元测试直接覆盖，DOM 工厂函数天然测不到（与 createHud/createMinimap/
 * createPauseOverlay 同样处境，全项目一致，不是本模块的特例）。
 *
 * 持久化选择（brief 明确的设计取舍，非遗漏）：跳过/完成状态用**全局单一** localStorage
 * flag（不区分种子/存档）。含义：同一个浏览器里开一局新种子的世界，只要此前任意一局已经
 * 跳过或走完过这条引导链，这张卡片就不会再出现——"老玩家不需要每局重新看教程"是刻意的
 * 产品判断，不是"应该按存档区分却漏做了"。code review 2026-08-10 确认过这一点：本工程
 * 目前没有存档系统（每次刷新＝全新世界），这个 flag 是当前唯一合理的粒度；未来如果引入
 * 存档/多角色，需要重新评估要不要按存档 id 拆分这个 key。
 */

/**
 * 引导链完成判定所需的只读快照——main.ts 每帧从 sim.state/sim.terrain 派生（与
 * computeHudContext 同一惯例：涉及 sim 内部字段的换算集中在 main.ts，本模块不 import
 * @shiling/sim/@shiling/content 的任何东西，保持零耦合）。
 */
export interface ObjectiveSnapshot {
  /** state.behaviorStats.kills——玩家亲手击杀数（任意物种，见 objective 1 判据）。 */
  kills: number;
  /** state.essence 四类精气总和。只有洞外吃鲜尸（essence.ts 的 gainEssence，仅"洞外吃真实
   *  尸体"这一条路径调用）才会 >0——吃巢穴 stash 储粮不加精气（见 sim/src/eating.ts 头部
   *  "家巢自动进食"一节的设计权衡）。这是"吃过猎物"这件事在只读快照里唯一可靠的信号，
   *  比反查 state.carcasses 数组长度变化更精确（尸体也会因为腐烂/NPC 抢食而减少，跟玩家
   *  有没有吃过它无关）。 */
  essenceTotal: number;
  /** terrain.digSpots.some(spot => spot.dug)——只关心"曾经挖开过至少一个"，不关心具体哪个。 */
  anyDug: boolean;
  /** state.homeNest !== null。 */
  hasHomeNest: boolean;
  /** state.homeNest?.stash ?? 0。 */
  stash: number;
  /** state.lastEvolution !== null——蛰伏蜕变至少成功开奖过一次（含"从未开奖过"的初始 null）。 */
  hasEvolved: boolean;
}

interface ObjectiveDef {
  readonly id: string;
  readonly text: string;
  readonly isDone: (snap: ObjectiveSnapshot) => boolean;
}

/**
 * 五个目标，严格按 brief 给定的顺序与文案（全角标点，逐字照抄，不做任何改写）。判据全部
 * 是"存在性/计数"判断，没有一条依赖 essenceTotal 之外任何需要额外换算的字段——essence 是
 * `Record<EssenceType, number>` 之和，main.ts 侧算好（Object.values 求和）再传进来，本模块
 * 不 import @shiling/content，不需要认识 EssenceType 具体有哪几种。
 */
export const OBJECTIVES: readonly ObjectiveDef[] = [
  { id: "hunt", text: "猎食一只苓鼠", isDone: (s) => s.kills >= 1 || s.essenceTotal > 0 },
  { id: "dig", text: "挖开一个洞穴", isDone: (s) => s.anyDug },
  { id: "nest", text: "在洞中筑巢——钻入洞穴按住 E", isDone: (s) => s.hasHomeNest },
  { id: "stash", text: "储备食物——叼运猎物回巢按 C", isDone: (s) => s.stash > 0 },
  { id: "evolve", text: "积攒精气并饮足水——蛰伏进化（V）", isDone: (s) => s.hasEvolved },
];

/** 全链完成后展示的收尾文案，随后淡出并永久隐藏（见 createObjectivesTracker）。 */
export const OBJECTIVES_COMPLETE_TEXT = "青丘任你闯荡";

export interface ObjectiveTrackerState {
  /** 0..OBJECTIVES.length；等于 length 表示五个目标已全部完成（链路走完）。 */
  readonly index: number;
}

export const OBJECTIVES_INITIAL_STATE: ObjectiveTrackerState = { index: 0 };

/**
 * 纯状态转移：只读 snapshot，判定当前目标（state.index 指向的那一条）是否已满足，满足则
 * 前进一格；用 while 而不是单次 if，是为了覆盖 brief 明确点出的健壮性场景——"如果玩家一
 * 上来就已经满足好几个目标"（brief 原话：新种子理论上不可能出现，但判据仍然按状态而不是
 * 按事件写，确保哪怕真的出现也不会卡在中间某一格不动）：一次调用内连续吃掉所有已经满足的
 * 前缀目标，而不是每帧只前进一格、要好几帧才追上真实状态。index 未变时返回同一个引用
 * （而不是新建一个 `{index}`对象）——与 terrainMesh.ts 的 updateHomeNest dirty-check 同一
 * 惯例，调用方可以直接用 `!==` 判断"这一帧有没有真的前进"，不需要额外比较字段。
 */
export function advanceObjective(state: ObjectiveTrackerState, snap: ObjectiveSnapshot): ObjectiveTrackerState {
  let index = state.index;
  while (index < OBJECTIVES.length && OBJECTIVES[index]!.isDone(snap)) index += 1;
  return index === state.index ? state : { index };
}

const DISMISS_STORAGE_KEY = "shiling.objectivesDismissed";

/**
 * 是否已经跳过/完成过引导链——见文件头"持久化选择"一节：全局单一 flag，不区分种子。
 * 隐私模式/无 localStorage 环境下静默回退到"未跳过"（与 audio.ts 的 readMutedFromStorage
 * 同一惯例：宁可多显示一次教程，也不因为读取失败而报错崩溃）。
 */
export function isObjectivesDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * 写入跳过/完成标记。写入失败（隐私模式等）时静默吞掉——调用方（createObjectivesTracker）
 * 自己在内存里维护的 `dismissed` 标志仍会在本次会话内生效，只是不跨会话持久化，与
 * audio.ts toggleMute() 的失败处理同一惯例。
 */
export function dismissObjectivesForever(): void {
  try {
    localStorage.setItem(DISMISS_STORAGE_KEY, "1");
  } catch {
    /* 隐私模式等环境下写入失败——本次会话内仍生效，只是不跨会话持久化 */
  }
}

export interface ObjectivesTracker {
  /** 每渲染帧调用一次（main.ts 与 hud.update/minimap.update 同一 `started && !paused` gate）。 */
  update(snap: ObjectiveSnapshot): void;
  /** Dev/Playwright 探针：当前应该显示的文案。""＝尚未 update() 过，或已跳过/完成而永久隐藏
   *  ——两种情况都不代表出错，调用方按需自行区分（探针只读，不影响任何行为）。 */
  getCurrentText(): string;
}

const STYLE_ID = "shiling-objectives-style";
const SYSTEM_FONT = `-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`; // 与 pause.ts/title.ts/hud.ts 同一系统字体栈——brief 明确要求本批不新增/复用书法子集字体
const CARD_BG = "rgba(14, 16, 22, 0.55)";
const CARD_HAIRLINE = "rgba(255, 255, 255, 0.12)";
const TEXT_PRIMARY = "#e8ecf2";
const TEXT_DIM = "#c8d2dc";
const CHECK_AMBER = "#e8b45f"; // 与 hud.ts 饥饿环/minimap 玩家色同一色相字面量（各模块自成一体，独立声明，不跨文件 import）

// 与 CSS @keyframes 的时长精确对应，供 update() 里的 setTimeout 链保持同步（不是各自拍的
// 魔法数字）：check 脉冲 500ms 由 CSS 自播完，不需要 JS 侧等它；下面两个才是 JS 侧真正要
// 等待的节奏——完成文案停留 2.2s 供玩家读完，随后 900ms 淡出（与 CSS transition 时长一致）。
const COMPLETE_HOLD_MS = 2200;
const COMPLETE_FADE_MS = 900;

const OBJECTIVES_CSS = `
.obj-card {
  position: fixed;
  top: 16px;
  left: 16px;
  z-index: 10;
  display: none;
  align-items: center;
  gap: 10px;
  max-width: 320px;
  padding: 9px 8px 9px 14px;
  background: ${CARD_BG};
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  border-radius: 12px;
  box-shadow: 0 0 0 1px ${CARD_HAIRLINE} inset;
  /* #hud 整体 pointer-events:none（见 hud.ts 头部注释）——这张小卡片自己需要接住×按钮
     的点击，与 hud.ts 的 .hud-death 同一"整块挖回 auto"手法，只是这里挖开的区域很小
     （卡片本身的边界），不影响画布其余区域的拖拽转镜头。 */
  pointer-events: auto;
  font-family: ${SYSTEM_FONT};
  opacity: 1;
  transition: opacity ${COMPLETE_FADE_MS}ms ease;
}
.obj-card.obj-visible { display: flex; }
.obj-card.obj-fade-out { opacity: 0; }

.obj-check {
  flex-shrink: 0;
  font-size: 14px;
  color: ${CHECK_AMBER};
  opacity: 0;
  transform: scale(0.6);
}
.obj-check.obj-check-flash {
  animation: obj-check-pulse 500ms ease-out;
}
@keyframes obj-check-pulse {
  0% { opacity: 0; transform: scale(0.6); }
  35% { opacity: 1; transform: scale(1.15); }
  100% { opacity: 0; transform: scale(1); }
}

.obj-text {
  font-size: 13px;
  font-weight: 300;
  letter-spacing: 0.05em;
  color: ${TEXT_PRIMARY};
  line-height: 1.4;
}
.obj-text.obj-text-slide {
  animation: obj-text-slide-in 220ms ease-out;
}
@keyframes obj-text-slide-in {
  from { opacity: 0; transform: translateX(-6px); }
  to { opacity: 1; transform: translateX(0); }
}

.obj-close {
  margin-left: auto;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: ${TEXT_DIM};
  font-size: 15px;
  line-height: 20px;
  cursor: pointer;
  opacity: 0.55;
}
.obj-close:hover { opacity: 1; }
`;

function ensureStyleInjected(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = OBJECTIVES_CSS;
  document.head.appendChild(style);
}

/**
 * 幂等挂载引导链卡片（与 pause.ts/title.ts 同一"重复调用不重复插入"惯例，虽然本工程
 * main.ts 只会调用一次）。已跳过/完成过（isObjectivesDismissed()）时整段不碰 DOM，直接
 * 返回一个零开销的 no-op tracker——老玩家的每一帧不会有任何额外成本，也不会在页面里留下
 * 一个永远隐藏的空卡片。
 */
export function createObjectivesTracker(): ObjectivesTracker {
  if (isObjectivesDismissed()) {
    return { update() {}, getCurrentText: () => "" };
  }

  ensureStyleInjected();
  const root = document.getElementById("hud");
  if (!root) throw new Error("createObjectivesTracker: #hud container not found in DOM");

  const cardEl = document.createElement("div");
  cardEl.className = "obj-card";

  const checkEl = document.createElement("span");
  checkEl.className = "obj-check";
  checkEl.textContent = "✓";

  const textEl = document.createElement("span");
  textEl.className = "obj-text";

  const closeEl = document.createElement("button");
  closeEl.type = "button";
  closeEl.className = "obj-close";
  closeEl.textContent = "×";
  closeEl.setAttribute("aria-label", "跳过引导");

  cardEl.append(checkEl, textEl, closeEl);
  root.appendChild(cardEl);

  let trackerState: ObjectiveTrackerState = OBJECTIVES_INITIAL_STATE;
  // ""＝尚未展示过任何文案——同 hud.ts lastWord 的"空串即隐藏/未初始化"惯例，与
  // OBJECTIVES_COMPLETE_TEXT/任意目标文案都不会撞车（五条目标文案与收尾文案均非空串）。
  let lastText = "";
  // 一旦为真：update() 整体 no-op，不再重新 advanceObjective/写 DOM——涵盖"点了×"与
  // "链路已完整播完收尾文案"两种终态,两者都已经调用过 dismissObjectivesForever()。
  let dismissed = false;

  function playTextTransition(text: string, isFirstReveal: boolean): void {
    lastText = text;
    textEl.textContent = text;
    // 复用 hud.ts contextPrompt 那套 remove/reflow/add 手法重放 CSS 动画（见该文件
    // .hud-prompt-pill.hud-fade-in 的同款写法）。
    textEl.classList.remove("obj-text-slide");
    void textEl.offsetWidth;
    textEl.classList.add("obj-text-slide");
    if (!isFirstReveal) {
      // 只有"从一个已展示的目标前进到下一个"才播 check 脉冲——第一次揭示（没有任何
      // 前置目标可以打勾）不放这个动画，避免读作"刚一进游戏就完成了什么"。
      checkEl.classList.remove("obj-check-flash");
      void checkEl.offsetWidth;
      checkEl.classList.add("obj-check-flash");
    }
    cardEl.classList.add("obj-visible");
  }

  function dismissForever(): void {
    if (dismissed) return;
    dismissed = true;
    dismissObjectivesForever();
    cardEl.classList.remove("obj-visible", "obj-fade-out");
  }

  closeEl.addEventListener("click", dismissForever);

  return {
    update(snap: ObjectiveSnapshot): void {
      if (dismissed) return;

      trackerState = advanceObjective(trackerState, snap);

      if (trackerState.index >= OBJECTIVES.length) {
        // 不需要"已经播过收尾就 return"的守卫：dismissed 在本分支末尾立刻置真，下一次
        // update() 会在函数最顶部的 `if (dismissed) return;` 挡住，本分支这一生只会真正
        // 跑一次（code review 2026-08-10：曾经在这里多写过一层等价的早退判断，纯冗余）。
        playTextTransition(OBJECTIVES_COMPLETE_TEXT, lastText === "");
        // 完成即持久化（不等 2.2s+900ms 的停留/淡出播完）——即使玩家在动画播完前刷新或
        // 关闭页面，重开也不会再看到引导链，见文件头"持久化选择"一节。
        dismissObjectivesForever();
        dismissed = true;
        window.setTimeout(() => {
          cardEl.classList.add("obj-fade-out");
          window.setTimeout(() => {
            cardEl.classList.remove("obj-visible", "obj-fade-out");
          }, COMPLETE_FADE_MS);
        }, COMPLETE_HOLD_MS);
        return;
      }

      const text = OBJECTIVES[trackerState.index]!.text;
      if (text !== lastText) playTextTransition(text, lastText === "");
    },
    getCurrentText: () => lastText,
  };
}
