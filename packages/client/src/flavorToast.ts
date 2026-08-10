/**
 * 险峰/灵泉一次性风味 toast（M15 P3「山海经地形与地标」——owner feedback「地形太
 * 简单，不符合山海经的背景」）：玩家首次踏入山地区核心，或首次在灵泉旁饮水，各弹出
 * 一条简短的玻璃风味提示，读完自动淡出，此后永久不再出现。
 *
 * 持久化选择镜像 objectives.ts 的既有惯例（见该文件头部"持久化选择"一节）：
 * localStorage once-flag，**每个 id 各自一个 key**（不是一把全局总开关）——两条
 * flavor 各自独立触发/独立记忆，玩家可能先摸到灵泉再爬上险峰，也可能反过来，两条
 * 互不影响对方的展示状态。全局单一 flag（不分种子）的理由与 objectives.ts 相同：
 * 本工程目前没有存档系统，每次刷新＝全新世界。
 *
 * 纯逻辑（`checkFlavorToastTriggers`）与 DOM 工厂（`createFlavorToastTracker`）拆开
 * 导出，镜像 objectives.ts/hud.ts 的既有拆分惯例——本工程 vitest 没有配置 jsdom，
 * `document`/`window` 在测试环境里不存在，只有前者可以被单元测试直接覆盖。
 */

export type FlavorToastId = "mountain" | "spring";

interface FlavorToastDef {
  readonly id: FlavorToastId;
  readonly text: string;
}

/** 严格按 brief 给定的文案，逐字照抄，不做任何改写。 */
export const FLAVOR_TOASTS: readonly FlavorToastDef[] = [
  { id: "mountain", text: "险峰之地，古兽出没" },
  { id: "spring", text: "灵泉滋养" },
];

export interface FlavorToastContext {
  /** main.ts 每帧用 mountainMaskAt(player.pos, mountainCenter) > 阈值 判定——见该文件调用点注释。 */
  inMountainZone: boolean;
  /** main.ts 每帧用 "player.activity==='drinking' && 落在任一灵泉 springRadius 内" 判定——与 needs.ts 灵泉加成分支同一份几何判据（只读复刻，不改 sim 状态）。 */
  nearSpringDrinking: boolean;
}

export interface FlavorToastShownState {
  readonly mountainShown: boolean;
  readonly springShown: boolean;
}

/**
 * 纯状态转移：只读判断这一帧是否应该触发某条 flavor toast 的"首次显示"边沿——已经
 * 展示过的 id 永远不会被再次判定为"应该触发"（`shown` 只会单向由 false 变 true，
 * 调用方负责在触发后同步更新它，本函数本身不修改任何状态）。
 */
export function checkFlavorToastTriggers(
  shown: FlavorToastShownState,
  ctx: FlavorToastContext,
): { mountain: boolean; spring: boolean } {
  return {
    mountain: !shown.mountainShown && ctx.inMountainZone,
    spring: !shown.springShown && ctx.nearSpringDrinking,
  };
}

const STORAGE_PREFIX = "shiling.flavorToastShown.";

/** 隐私模式/无 localStorage 环境下静默回退到"未展示过"——同 objectives.ts 的既有惯例。 */
export function isFlavorToastShown(id: FlavorToastId): boolean {
  try {
    return localStorage.getItem(STORAGE_PREFIX + id) === "1";
  } catch {
    return false;
  }
}

/** 写入失败（隐私模式等）时静默吞掉——调用方在内存里维护的 shown 状态仍在本次会话内生效，只是不跨会话持久化，同 objectives.ts dismissObjectivesForever() 的既有惯例。 */
export function markFlavorToastShown(id: FlavorToastId): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + id, "1");
  } catch {
    /* 隐私模式等环境下写入失败——本次会话内仍不会重复触发，只是不跨会话持久化 */
  }
}

export interface FlavorToastTracker {
  /** 每渲染帧调用一次（main.ts 与 objectives.update 同一 `started && !paused` gate）。 */
  update(ctx: FlavorToastContext): void;
}

const STYLE_ID = "shiling-flavor-toast-style";
const SYSTEM_FONT = `-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`; // 与 objectives.ts/pause.ts/title.ts/hud.ts 同一系统字体栈
const CARD_BG = "rgba(14, 16, 22, 0.55)";
const CARD_HAIRLINE = "rgba(255, 255, 255, 0.12)";
const TEXT_PRIMARY = "#e8ecf2";

// 停留/淡出时长（毫秒）——同 objectives.ts 的 COMPLETE_HOLD_MS/COMPLETE_FADE_MS 同一节奏，
// 与下面 CSS transition 的时长精确对应。
const HOLD_MS = 2600;
const FADE_MS = 900;

const FLAVOR_TOAST_CSS = `
.flavor-toast {
  position: fixed;
  top: 90px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  display: none;
  padding: 8px 18px;
  background: ${CARD_BG};
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  border-radius: 999px;
  box-shadow: 0 0 0 1px ${CARD_HAIRLINE} inset;
  pointer-events: none;
  font-family: ${SYSTEM_FONT};
  font-size: 14px;
  font-weight: 300;
  letter-spacing: 0.08em;
  color: ${TEXT_PRIMARY};
  opacity: 0;
  transition: opacity ${FADE_MS}ms ease;
}
.flavor-toast.flavor-toast-visible { display: block; opacity: 1; }
.flavor-toast.flavor-toast-fade-out { opacity: 0; }
`;

function ensureStyleInjected(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = FLAVOR_TOAST_CSS;
  document.head.appendChild(style);
}

/**
 * 幂等挂载一次性风味 toast（与 objectives.ts 同一"重复调用不重复插入"惯例）。两条
 * flavor 都已经展示过时（老玩家/已经摸过灵泉+爬过险峰）整段不碰 DOM，直接返回零
 * 开销的 no-op tracker——同 objectives.ts 的 isObjectivesDismissed() 早退惯例。
 */
export function createFlavorToastTracker(): FlavorToastTracker {
  const shown: { mountain: boolean; spring: boolean } = {
    mountain: isFlavorToastShown("mountain"),
    spring: isFlavorToastShown("spring"),
  };
  if (shown.mountain && shown.spring) {
    return { update() {} };
  }

  ensureStyleInjected();
  const root = document.getElementById("hud");
  if (!root) throw new Error("createFlavorToastTracker: #hud container not found in DOM");

  const cardEl = document.createElement("div");
  cardEl.className = "flavor-toast";
  root.appendChild(cardEl);

  // 单卡片 + 队列：两条 flavor 几乎同一帧触发（比如玩家一边贴着险峰边缘一边在山脚
  // 灵泉边饮水，理论上罕见但不是不可能）时，先播完第一条再播第二条，不会在同一张
  // 卡片上把两句文案同时糊在一起。
  const queue: string[] = [];
  let showing = false;

  function processQueue(): void {
    if (showing) return;
    const text = queue.shift();
    if (text === undefined) return;
    showing = true;
    cardEl.textContent = text;
    cardEl.classList.remove("flavor-toast-fade-out");
    cardEl.classList.add("flavor-toast-visible");
    window.setTimeout(() => {
      cardEl.classList.add("flavor-toast-fade-out");
      window.setTimeout(() => {
        cardEl.classList.remove("flavor-toast-visible", "flavor-toast-fade-out");
        showing = false;
        processQueue();
      }, FADE_MS);
    }, HOLD_MS);
  }

  function enqueue(text: string): void {
    queue.push(text);
    processQueue();
  }

  return {
    update(ctx: FlavorToastContext): void {
      const triggers = checkFlavorToastTriggers({ mountainShown: shown.mountain, springShown: shown.spring }, ctx);
      if (triggers.mountain) {
        shown.mountain = true;
        markFlavorToastShown("mountain");
        enqueue(FLAVOR_TOASTS[0]!.text);
      }
      if (triggers.spring) {
        shown.spring = true;
        markFlavorToastShown("spring");
        enqueue(FLAVOR_TOASTS[1]!.text);
      }
    },
  };
}
