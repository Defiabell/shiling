import { getPlayer, type Creature, type GameState } from "@shiling/sim";
import { PALETTE } from "./render/palette.js";
import { DEATH_SPREAD_MS } from "./render/screenFx.js";

/**
 * Per-frame proximity/target flags the sim knows about but the HUD itself
 * must not compute (this module only ever reads GameState.creatures[].needs/
 * activity/locomotion/burrowId — it has no business touching Terrain or
 * TUNING). main.ts derives these every render frame from live sim state,
 * mirroring the same priority chain tickDigging → tickEating → tickNeeds
 * uses internally (dig > attack > eat > drink; see sim/src/eating.ts's
 * top-of-file comment for the canonical ordering this HUD prompt follows).
 */
export interface HudContext {
  nearWater: boolean;
  nearCarcass: boolean;
  nearDigSpot: boolean;
  nearPrey: boolean;
  /** M1 postfix N1（叼运/筑巢/储粮）：player.carryingCarcassId !== null。 */
  carrying: boolean;
  /** interactRange 内是否有玩家的巢穴（state.homeNest 存在且距离达标）——叼着时驱动
   *  "存粮" vs "放下"，不叼着时驱动"储粮进食"提示是否可能出现。 */
  nearNest: boolean;
  /** state.homeNest?.stash ?? 0——储粮进食提示要显示的数值。 */
  stash: number;
  /** 玩家当前是否"身处"自己已建成的巢穴内（burrowId 命中 homeNest.spotId）——区分
   *  "在洞里但还不是家"（提示筑巢）与"在自己家里"（提示出洞）。 */
  inOwnBurrow: boolean;
  /**
   * 筑巢进度百分比（Part 2，postfix-9），0..100，未在筑巢时为 0——main.ts 算好
   * （`player.nestProgress / TUNING.nestBuildSec * 100`）直接传进来，而不是让本模块
   * 自己 import TUNING：见本文件头部注释，hud.ts 刻意不碰 TUNING/Terrain，所有需要
   * sim 内部常量参与的换算都由 main.ts 完成，这里只管展示。0 同时也是"不在筑巢"的
   * 隐藏信号——nestProgress 一旦真的在累积（哪怕只过了一个 tick）就必然 >0（见
   * digging.ts 的筑巢分支），不会有"正在筑巢但传进来的百分比恰好是 0"这种歧义。
   */
  nestBuildPct: number;
  /**
   * M1 B3（蛰伏蜕变）：state.dormancy!==null——玩家正处于蛰伏中（见 sim/src/dormancy.ts）。
   * 蛰伏中锁死所有其它情境提示（out-burrow/筑巢等都不再显示，见 contextPrompt），状态行
   * 改显示「蛰伏中……」（见 statusLabel）。
   */
  dormant: boolean;
  /**
   * M1 B3：触发条件——在自己家巢内 ＋ 任一精气达标 ＋ stash 达标——是否满足（不含 V 边沿
   * 本身，纯粹是"这一刻按下 V 会不会真的触发"的只读复述）。main.ts 直接调用 sim 导出的
   * `isDormancyEligible(state)` 算出，不在 client 侧重复精气/stash 阈值判断。
   */
  dormancyEligible: boolean;
}

export interface Hud {
  update(state: GameState, ctx: HudContext): void;
}

const STYLE_ID = "shiling-hud-style";

function hexToCssColor(hex: number): string {
  return `#${hex.toString(16).padStart(6, "0")}`;
}

/**
 * 弱光玻璃皮肤 token（variant C — owner 选定方向，取代宝可梦系亮卡片皮肤）。
 * 数值直接抄自比稿 mockup 的 `.C` 分区（scratchpad/shiling-ui-mockups.html）：
 * 半透明深色玻璃底 + backdrop-filter 模糊 + 1px hairline 内描边，克制、不抢
 * 3D 场景。三组各管一件事：GLASS 是玻璃底/描边/模糊的共用语言，TEXT 是两档
 * 文字灰度，ACCENT 是三条需求环＋情境词强调色。
 *
 * amberHex 是唯一一个字面值恰好与 PALETTE 重合的例外——PALETTE.lampWarm
 * (#e8b45f，注释原文"UI 朱砂/灯火"）与 mockup 给的饥饿环 amber 强调色数值
 * 完全相同，两者语义也一致（"暖光"），直接从 PALETTE 取而不是另开一份字面量；
 * 青/灰/红三色 mockup 没有对应的世界色可复用，就地字面量声明（沿用本工程
 * "每个模块自成一体，不跨模块 import UI-only 常量"的既有惯例）。
 */
const amberHex = hexToCssColor(PALETTE.lampWarm);

const GLASS = {
  ring: "rgba(14, 16, 22, 0.5)", // 环形仪表玻璃底（mockup .ring）
  pill: "rgba(14, 16, 22, 0.55)", // 情境提示 pill 玻璃底，比环深一档（mockup .cpill）
  hairlineRing: "rgba(255, 255, 255, 0.1)", // 环描边（mockup .ring 的 inset box-shadow）
  hairlinePill: "rgba(255, 255, 255, 0.12)", // pill/键帽描边（mockup .cpill 的 inset box-shadow）
  blurRing: "4px",
  blurPill: "6px",
  track: "rgba(255, 255, 255, 0.09)", // conic-gradient 未填充部分
} as const;

const TEXT = {
  primary: "#e8ecf2", // 环内数字/pill 动作词主色
  dim: "#c8d2dc", // 状态字 + 疲劳环色（两处刻意同值——mockup 原话疲劳用同一档灰）
} as const;

const ACCENT = {
  hunger: amberHex, // #e8b45f
  thirst: "#7fd4e8",
  low: "#e0452b",
  lowGlow: "rgba(224, 69, 43, 0.55)",
} as const;

/** 情境 pill 切换/淡入动画时长（brief：opacity+translateY 4px，160ms，不要弹跳）。 */
const PROMPT_FADE_MS = 160;

// Injected once into <head>; #hud itself stays pointer-events:none so the
// bars/prompt/status never steal the canvas's drag-to-look mouse input —
// the death overlay is the sole exception (see .hud-death below), since once
// the player is dead there is nothing left in the 3D view worth dragging.
//
// Font split (unchanged rule, carried over from the previous restyle): the
// base #hud font-family is the system thin/regular stack — variant C's own
// "克制" directive doubles down on this (font-weight 300 default). Ma Shan
// Zheng (still vendored at public/fonts/mashanzheng.woff2, subset unchanged
// — see Task 8/9 history for how that 41-glyph subset was built) stays
// opted into by exactly the same two elements as before: `.hud-death-title`
// here (身死) and title.ts's `.title-main` (食灵). No other string this HUD
// renders touches the custom font, so no font-subset regeneration is needed.
const HUD_CSS = `
@font-face {
  font-family: "Ma Shan Zheng";
  src: url("/fonts/mashanzheng.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
/* 注册后才能让下面 .hud-ring-fill 的 "transition: --pct 150ms linear" 平滑过渡
   （浏览器要知道 --pct 是个 <percentage> 才能在两个值之间插值,不是直接跳变）。
   不支持 @property 的浏览器（老版本 Safari/Firefox）不会报错——只是退化成
   conic-gradient 百分比直接跳变、没有过渡动画，环的填充比例本身仍然完全正确，
   不是功能性缺口，个人项目单浏览器场景不特别兜底。 */
@property --pct {
  syntax: '<percentage>';
  inherits: true;
  initial-value: 0%;
}
#hud {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 10;
  font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  font-weight: 300;
  color: ${TEXT.primary};
  user-select: none;
}

/* ---- 左下：三个环形需求仪表（无卡片底，每环自带玻璃圆底） ---- */
.hud-rings {
  position: absolute;
  left: 20px;
  bottom: 20px;
  display: flex;
  align-items: flex-end;
  gap: 14px;
}
.hud-ring {
  position: relative;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  flex-shrink: 0;
  background: ${GLASS.ring};
  backdrop-filter: blur(${GLASS.blurRing});
  -webkit-backdrop-filter: blur(${GLASS.blurRing});
  box-shadow: 0 0 0 1px ${GLASS.hairlineRing} inset;
}
.hud-ring-fill {
  position: absolute;
  inset: 4px;
  border-radius: 50%;
  transition: --pct 150ms linear;
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 4px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 4px));
  background: conic-gradient(var(--ring-color) 0% var(--pct), ${GLASS.track} var(--pct) 100%);
}
.hud-ring-hunger .hud-ring-fill { --ring-color: ${ACCENT.hunger}; }
.hud-ring-thirst .hud-ring-fill { --ring-color: ${ACCENT.thirst}; }
.hud-ring-fatigue .hud-ring-fill { --ring-color: ${TEXT.dim}; }
/* 低量态：环色整体切红（"环色变" ${ACCENT.low}），三档 selector 都要盖过——
   .hud-ring.hud-low 比任何单一 .hud-ring-<need> 多一层 class，specificity
   天然更高，不需要 !important。 */
.hud-ring.hud-low .hud-ring-fill { --ring-color: ${ACCENT.low}; }
.hud-ring-label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 300;
  color: ${TEXT.primary};
  letter-spacing: 0.06em;
}
/* 柔和脉冲：只呼吸环外发光（box-shadow），不碰 fill 的透明度——brief 明确要求
   "不要突兀闪烁"，旧亮色皮肤 hud-bar-flicker 那种 opacity 硬闪是要避免的反例。 */
.hud-ring.hud-low {
  animation: hud-ring-glow-pulse 1.6s ease-in-out infinite;
}
@keyframes hud-ring-glow-pulse {
  0%, 100% { box-shadow: 0 0 0 1px ${GLASS.hairlineRing} inset, 0 0 0 0 rgba(224, 69, 43, 0); }
  50% { box-shadow: 0 0 0 1px ${GLASS.hairlineRing} inset, 0 0 16px 4px ${ACCENT.lowGlow}; }
}

/* ---- 中下：情境提示玻璃胶囊（键帽 + 动作词，末字 amber 强调） ---- */
.hud-prompt-pill {
  position: absolute;
  bottom: 100px;
  left: 50%;
  transform: translateX(-50%);
  opacity: 1;
  display: none;
  align-items: center;
  gap: 12px;
  padding: 8px 20px 8px 8px;
  background: ${GLASS.pill};
  backdrop-filter: blur(${GLASS.blurPill});
  -webkit-backdrop-filter: blur(${GLASS.blurPill});
  border-radius: 999px;
  box-shadow: 0 0 0 1px ${GLASS.hairlinePill} inset;
}
.hud-prompt-pill.hud-visible { display: flex; }
.hud-prompt-pill.hud-fade-in {
  animation: hud-prompt-fade-in ${PROMPT_FADE_MS}ms ease-out;
}
@keyframes hud-prompt-fade-in {
  from { opacity: 0; transform: translateX(-50%) translateY(4px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}
.hud-prompt-key {
  /* min-width（而非固定 width）：历史上撕咬提示显示过"左键"（2 字，W2 键位拆分），
     Post-fix-6 起改回单字符"J"，但仍留 min-width+左右 padding——万一将来又出现更长的
     键帽文案，不必再改这条规则，两种长度的文案都能不裁切地居中显示。 */
  min-width: 26px;
  height: 24px;
  padding: 0 6px;
  border-radius: 6px;
  background: ${TEXT.primary};
  color: #0e1016;
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  white-space: nowrap;
}
.hud-prompt-word {
  font-size: 15px;
  font-weight: 300;
  letter-spacing: 0.2em;
  color: ${TEXT.primary};
  white-space: nowrap;
}
.hud-prompt-word-accent {
  color: ${ACCENT.hunger};
  font-weight: 300;
}

/* ---- 筑巢进度：情境提示胶囊正上方一条细玻璃条（Part 2，postfix-9） ---- */
.hud-build-bar {
  position: absolute;
  bottom: 132px; /* 100(pill 的 bottom) + 24(键帽高度，约等于 pill 视觉高度) + 8 间隙 */
  left: 50%;
  transform: translateX(-50%);
  width: 140px;
  height: 4px;
  border-radius: 999px;
  background: ${GLASS.track};
  box-shadow: 0 0 0 1px ${GLASS.hairlinePill} inset;
  display: none;
  overflow: hidden;
}
.hud-build-bar.hud-visible { display: block; }
.hud-build-bar-fill {
  height: 100%;
  width: 0%;
  border-radius: inherit;
  background: ${ACCENT.hunger};
  transition: width 150ms linear; /* 与环形仪表的 --pct 过渡同一时长，读起来是同一套语言 */
}

/* ---- 叼运中提示：靠近三环的小玻璃胶囊（Part 2，postfix-9） ---- */
.hud-carry-chip {
  position: absolute;
  left: 20px;
  bottom: 94px; /* 20(rings 的 bottom) + 64(单个环的高度) + 10 间隙——紧贴三环上方 */
  display: none;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  background: ${GLASS.pill};
  backdrop-filter: blur(${GLASS.blurPill});
  -webkit-backdrop-filter: blur(${GLASS.blurPill});
  border-radius: 999px;
  box-shadow: 0 0 0 1px ${GLASS.hairlinePill} inset;
  font-size: 13px;
  font-weight: 300;
  letter-spacing: 0.1em;
  color: ${TEXT.primary};
  white-space: nowrap;
}
.hud-carry-chip.hud-visible { display: flex; }
.hud-carry-chip-penalty {
  color: ${TEXT.dim};
  font-size: 12px;
}

/* ---- 右上：状态字（小地图正下方，无底框细体宽字距） ---- */
.hud-status-text {
  /* top 174px = minimap.ts SKIN.top(16) + SKIN.cssSize(148) + 10px 间隙——
     两个文件各自声明一份坐标常量，改任一侧都要同步核对（模块自成一体的既有
     惯例，见 title.ts 头部注释），这里只留一句可搜索的数字关系作提示。 */
  position: fixed;
  top: 174px;
  right: 16px;
  width: 148px;
  display: none;
  text-align: right;
  font-size: 12px;
  font-weight: 300;
  letter-spacing: 0.5em;
  color: ${TEXT.dim};
}
.hud-status-text.hud-visible { display: block; }

/* ---- 死亡界面：全黑底极简排版，无卡片 ---- */
.hud-death {
  position: fixed;
  inset: 0;
  display: none;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 22px;
  background: #0e1016; /* 全黑底，与玻璃底色同一色相（rgba(14,16,22,*)）系全不透明版 */
  pointer-events: auto;
  z-index: 20;
}
.hud-death.hud-visible { display: flex; }
.hud-death-title {
  font-family: "Ma Shan Zheng", "STKaiti", "KaiTi", serif; /* 唯二书法字体用点之一 */
  font-size: 48px;
  font-weight: 400;
  color: #ffffff;
  letter-spacing: 0.15em;
}
.hud-death-divider {
  width: 64px;
  height: 1px;
  /* rgba(127,212,232,*) = #7fd4e8 = ACCENT.thirst 的青色发光——与小地图外发光
     （minimap.ts 的 cmap box-shadow）同一色相，串起弱光玻璃皮肤的统一微光基调。 */
  background: rgba(127, 212, 232, 0.6);
  box-shadow: 0 0 8px rgba(127, 212, 232, 0.6);
}
.hud-death-hint {
  font-size: 15px;
  font-weight: 300;
  letter-spacing: 0.15em;
  color: ${TEXT.dim};
}
.hud-death-keycap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  margin: 0 4px;
  vertical-align: middle;
  border-radius: 6px;
  background: ${GLASS.ring};
  backdrop-filter: blur(${GLASS.blurRing});
  -webkit-backdrop-filter: blur(${GLASS.blurRing});
  box-shadow: 0 0 0 1px ${GLASS.hairlinePill} inset;
  color: ${TEXT.primary};
  font-size: 12px;
  font-weight: 400;
  letter-spacing: 0; /* 键帽内单字符不继承父级的宽字距 */
}
`;

function ensureStyleInjected(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = HUD_CSS;
  document.head.appendChild(style);
}

const LOW_THRESHOLD = 25;

/** Clamps to [0,100] then rounds to a whole percent: dirty-check granularity — needs decay continuously, but the fill only needs to repaint once its rounded percent actually changes. */
function pct(value: number): number {
  const clamped = value < 0 ? 0 : value > 100 ? 100 : value;
  return Math.round(clamped);
}

interface RingHandle {
  ringEl: HTMLDivElement;
  fillEl: HTMLDivElement;
  lastPct: number;
  lastLow: boolean;
}

/**
 * Builds one ring gauge: glass circle + masked conic-gradient fill + centered
 * glyph. The fill's `--pct` custom property drives the conic-gradient split
 * point (see `@property --pct` above for the transition-eligible declaration)
 * — updateRing() only ever calls `style.setProperty`, never rewrites the
 * whole `background` string, so the CSS `transition: --pct 150ms linear`
 * on `.hud-ring-fill` animates the sweep smoothly per the existing dirty-check
 * discipline (mirrors the old bright-UI bar's `transition: width 0.15s`).
 */
function buildRing(label: string, modifierClass: string): { el: HTMLDivElement; handle: RingHandle } {
  const ringEl = document.createElement("div");
  ringEl.className = `hud-ring ${modifierClass}`;

  const fillEl = document.createElement("div");
  fillEl.className = "hud-ring-fill";
  fillEl.style.setProperty("--pct", "0%");

  const labelEl = document.createElement("div");
  labelEl.className = "hud-ring-label";
  labelEl.textContent = label;

  ringEl.appendChild(fillEl);
  ringEl.appendChild(labelEl);

  return { el: ringEl, handle: { ringEl, fillEl, lastPct: -1, lastLow: false } };
}

/** Writes --pct / low-class only when the rounded percent or low-state actually changed since the last call. */
function updateRing(handle: RingHandle, value: number): void {
  const p = pct(value);
  if (p !== handle.lastPct) {
    handle.fillEl.style.setProperty("--pct", `${p}%`);
    handle.lastPct = p;
  }
  const low = p < LOW_THRESHOLD;
  if (low !== handle.lastLow) {
    handle.ringEl.classList.toggle("hud-low", low);
    handle.lastLow = low;
  }
}

/** Action word + keycap label for one context-prompt state. */
export interface ContextPrompt {
  word: string;
  /**
   * 键位拆分（W2）：撕咬现在绑左键，不再是 E——其余四种提示（出洞/挖掘/进食/饮水）
   * 仍然都是 E。这一份 ContextPrompt 只是"该显示哪个键帽"的展示层信息，不影响判定：
   * 真正决定按哪个键有效的是 sim 的 input.attack/input.interact 分别独立判定（见
   * eating.ts/needs.ts 顶部注释）——单一 E 键"重叠时无法选择"的问题已经在输入层解开，
   * 这里的优先级链只是决定"同一时刻多个情境重叠时，先提示哪一个"，纯展示，不阻塞。
   */
  key: string;
}

/**
 * Context prompt priority mirrors sim's own tick order (tickDigging runs
 * before tickEating's attack/eat before tickNeeds' drink): dig > attack >
 * eat > drink. Burrowed always wins outright since none of the other three
 * interactions are even reachable while burrowId !== null (movement/dig/eat
 * all early-return in that state; see digging.ts/eating.ts). Presentation
 * only (key badge + action word inside a glass pill, no separate seal glyph
 * — variant C's mockup drops the seal badge the previous bright-UI skin had)
 * — the ordering and the underlying words (挖掘/撕咬/进食/饮水/出洞) are
 * unchanged; the keycap shown for 撕咬 went "E" to "左键" (W2 key split) to
 * "J" (Post-fix-6, owner feedback "no comfortable trackpad mouse buttons" —
 * keyboard is now the primary attack input; input.ts ORs KeyJ into the same
 * PlayerInput.attack field left-click already drove, so this is purely a
 * display-string change, not a behavior change).
 *
 * M1 postfix N1（叼运/筑巢/储粮）extends this same single-pill priority chain
 * with two new tiers, both inserted above their nearest sim-side counterpart:
 *   - Burrowed tier now splits in two: "筑巢"（in a dug burrow that ISN'T yet
 *     home — see ctx.inOwnBurrow) vs "出洞"（already home, or any burrow once
 *     筑巢 no longer applies). Tapping E still exits either way (digging.ts's
 *     rising-edge toggle is unchanged) — this just decides which single word
 *     to advertise, mirroring "holding E accumulates progress while a fresh
 *     press exits" from digging.ts's own doc comment.
 *   - Carrying tier sits right below burrowed, above everything else: while
 *     ctx.carrying is true, C是唯一相关的键——附近的挖点/猎物/尸体提示全部让位
 *     （attack is sim-disabled while carrying anyway, digging is guarded off
 *     entirely; see digging.ts/eating.ts's "叼运联动"/"叼运互斥" notes）. E 进食
 *     叼着的尸体仍然完全可用（eating.ts 不需要特判），只是没有专门的第三个
 *     pill 状态来同时展示 C 和 E 两个键——批次二的 UI 打磨再考虑要不要拆出来。
 *   - 尸体本身（not carrying）现在优先展示"叼起"而不是"进食"——这批的主打机制，
 *     E 进食同一具尸体依旧完全可用（HUD 只是没把它挑出来当第一提示）。
 *
 * postfix-9 Part 0（controller ruling）：洞外"储粮进食"这一档提示词已经整体移除——
 * 储粮进食不再是洞外的按键交互（旧版"interactRange 内没有真实尸体、站在巢穴附近、
 * stash>0"这一条已随 eating.ts 的 stash fallback 分支一起删掉），改成"人在自己家
 * 的洞里就自动吃"，不需要任何提示（HUD 改用 Part 2 新增的"储粮 N"状态行展示，见
 * statusLabel）。ctx.nearNest/ctx.stash 两个字段仍然保留在 HudContext 上——叼着时
 * 的"存粮"/"放下"判断（上面那一档）依旧要用到它们，只是不再喂给这个已删除的提示词。
 *
 * M1 B3（蛰伏蜕变）在"burrowed"这一档内部再插一层优先级，仍然整体排在最前面（蛰伏的
 * 前提本就是"在自己家巢洞内"，与其它三档天然互斥）：
 *   - ctx.dormant 为真（已经在蛰伏中）：整段返回 null——蛰伏期间所有输入系统都已锁死
 *     （见 dormancy.ts），此刻按任何键都没有效果，不应该显示"出洞"这种实际按不动的
 *     假提示；唯一还在更新的可见信息是 statusLabel 的「蛰伏中……」状态行。
 *   - 未在蛰伏但 ctx.dormancyEligible 为真（在自己家、精气与储粮都达标）：显示「V 蛰伏」，
 *     取代原本会显示的「出洞」——这一档只可能出现在 ctx.inOwnBurrow 为真时（未成家的
 *     洞穴不满足 isDormancyEligible 的前提），所以不需要再叠一层 inOwnBurrow 判断。
 */
// exported for hud.test.ts — pure, DOM-free priority-chain logic worth pinning
// down directly (code review 2026-08-09: this is exactly the class of function
// that would have caught the stash-prompt accent-slice bug with one assertion).
export function contextPrompt(ctx: HudContext, player: Creature): ContextPrompt | null {
  if (player.burrowId !== null) {
    if (ctx.dormant) return null;
    if (ctx.dormancyEligible) return { word: "蛰伏", key: "V" };
    return ctx.inOwnBurrow ? { word: "出洞", key: "E" } : { word: "筑巢", key: "E" };
  }
  if (ctx.carrying) return ctx.nearNest ? { word: "存粮", key: "C" } : { word: "放下", key: "C" };
  if (ctx.nearDigSpot) return { word: "挖掘", key: "E" };
  if (ctx.nearPrey) return { word: "撕咬", key: "J" };
  if (ctx.nearCarcass) return { word: "叼起", key: "C" };
  if (ctx.nearWater) return { word: "饮水", key: "E" };
  return null;
}

/**
 * Status text label. burrowId !== null takes precedence over everything
 * (activity is pinned to "idle" and locomotion to "burrow" while burrowed —
 * see digging.ts's enterBurrow/exitBurrow). digging and eating are mutually
 * exclusive by construction (`activity` is a single field), but either can
 * still co-occur with locomotion === "swim" (e.g. digging/eating right at a
 * shoreline) — in that case the deliberate action takes precedence over the
 * ambient "潜泳" descriptor.
 *
 * postfix-9 Part 2：burrowed-at-home now shows the live stash count instead
 * of the generic "洞中休息" — this is the visible trace of Part 0's silent
 * auto-eat (no button, no prompt; see eating.ts's burrow branch), and the
 * only place a player can see the number tick down. `Math.floor` mirrors
 * hud.ts's own dirty-check convention elsewhere (rings round to whole
 * percent) — the caller (createHud().update()) already only rewrites this
 * string when it actually differs from the last one written, so flooring
 * here is what makes that comparison naturally throttle to "once per whole
 * unit consumed" instead of firing every single tick's fractional decrement.
 *
 * M1 B3：ctx.dormant 优先于其它任何 burrowed 分支——蛰伏中不再显示储粮数字（stash 仍在
 * 变化，但玩家此刻是"睡着"的，不是"清醒地看着粮仓余量"，展示上统一收敛成一句「蛰伏
 * 中……」），也不需要区分 inOwnBurrow（蛰伏的前提本就是在自己家）。
 */
// exported for hud.test.ts — same "pure, DOM-free, worth pinning down directly"
// rationale as contextPrompt above.
export function statusLabel(player: Creature, ctx: HudContext): string {
  if (player.burrowId !== null) {
    if (ctx.dormant) return "蛰伏中……";
    if (ctx.inOwnBurrow) return `巢中休息——储粮 ${Math.floor(ctx.stash)}`;
    return "洞中休息";
  }
  if (player.activity === "digging") return "挖掘中";
  if (player.activity === "eating") return "进食中";
  if (player.locomotion === "swim") return "潜泳";
  return "";
}

/**
 * Builds the HUD DOM once inside the existing #hud container and returns an
 * `update` closure the render loop calls once per frame. Every DOM write is
 * dirty-checked against the previously written value so a steady state
 * (nothing changed since last frame) costs zero style/text mutations.
 */
export function createHud(): Hud {
  ensureStyleInjected();

  const root = document.getElementById("hud");
  if (!root) throw new Error("createHud: #hud container not found in DOM");
  root.innerHTML = "";

  const statusTextEl = document.createElement("div");
  statusTextEl.className = "hud-status-text";
  root.appendChild(statusTextEl);

  const promptPillEl = document.createElement("div");
  promptPillEl.className = "hud-prompt-pill";
  const promptKeyEl = document.createElement("div");
  promptKeyEl.className = "hud-prompt-key";
  // 初始文案任意——nextWord !== lastWord 的分支会在第一次 update() 时写入真实值，
  // 这里不需要提前确定是 "E" 还是 "左键"（键位拆分后不再总是 "E"）。
  promptKeyEl.textContent = "E";
  const promptWordEl = document.createElement("div");
  promptWordEl.className = "hud-prompt-word";
  const promptWordMainEl = document.createElement("span");
  const promptWordAccentEl = document.createElement("span");
  promptWordAccentEl.className = "hud-prompt-word-accent";
  promptWordEl.appendChild(promptWordMainEl);
  promptWordEl.appendChild(promptWordAccentEl);
  promptPillEl.appendChild(promptKeyEl);
  promptPillEl.appendChild(promptWordEl);
  root.appendChild(promptPillEl);

  // 筑巢进度条（Part 2，postfix-9）：紧贴情境提示胶囊正上方，只在 ctx.nestBuildPct>0
  // 时可见——见 update() 里的 dirty-check。
  const buildBarEl = document.createElement("div");
  buildBarEl.className = "hud-build-bar";
  const buildBarFillEl = document.createElement("div");
  buildBarFillEl.className = "hud-build-bar-fill";
  buildBarEl.appendChild(buildBarFillEl);
  root.appendChild(buildBarEl);

  const ringsEl = document.createElement("div");
  ringsEl.className = "hud-rings";
  const hunger = buildRing("饥", "hud-ring-hunger");
  const thirst = buildRing("渴", "hud-ring-thirst");
  const fatigue = buildRing("疲", "hud-ring-fatigue");
  ringsEl.appendChild(hunger.el);
  ringsEl.appendChild(thirst.el);
  ringsEl.appendChild(fatigue.el);
  root.appendChild(ringsEl);

  // 叼运中提示胶囊（Part 2，postfix-9）：紧贴三环上方，随 ctx.carrying 切换可见性。
  // 「↓」是速度惩罚的纯字形图标——工程里没有任何图标字体/SVG 依赖，延续 HUD 全局
  // "只用字符/字距表达"的既有语言（环标签/键帽/箭头式提示同一惯例）。
  const carryChipEl = document.createElement("div");
  carryChipEl.className = "hud-carry-chip";
  const carryChipWordEl = document.createElement("span");
  carryChipWordEl.textContent = "叼运中";
  const carryChipPenaltyEl = document.createElement("span");
  carryChipPenaltyEl.className = "hud-carry-chip-penalty";
  carryChipPenaltyEl.textContent = "↓";
  carryChipEl.appendChild(carryChipWordEl);
  carryChipEl.appendChild(carryChipPenaltyEl);
  root.appendChild(carryChipEl);

  const deathEl = document.createElement("div");
  deathEl.className = "hud-death";
  const deathTitle = document.createElement("div");
  deathTitle.className = "hud-death-title";
  deathTitle.textContent = "身死";
  const deathDivider = document.createElement("div");
  deathDivider.className = "hud-death-divider";
  const deathHint = document.createElement("div");
  deathHint.className = "hud-death-hint";
  const deathKeycap = document.createElement("span");
  deathKeycap.className = "hud-death-keycap";
  deathKeycap.textContent = "R";
  // 按钮不再单独存在（variant C"克制、无卡片"——见 mockup 只画了键帽+文字，
  // 没有第二个"R 重来"胶囊），R 就地嵌进这一行提示文案里，文案本身不变。
  deathHint.append("魂归青丘——按 ", deathKeycap, " 转世");
  deathEl.appendChild(deathTitle);
  deathEl.appendChild(deathDivider);
  deathEl.appendChild(deathHint);
  root.appendChild(deathEl);

  let dead = false;
  let lastDeathVisible = false;
  let lastWord = ""; // "" = prompt hidden — mirrors lastStatus's empty-string-as-hidden convention
  let lastStatus = "";
  let lastCarrying = false;
  let lastBuildPct = -1; // -1：强制第一帧写入，0 是"筑巢条隐藏"这个合法值本身，不能拿来当哨兵

  // Reload is a full page reload (Task 16 brief), not a sim reset call, so a
  // fresh Date.now()-seeded world is created from scratch on the next load —
  // no client-side state to tear down here beyond the listener guard below.
  window.addEventListener("keydown", (e) => {
    if (dead && e.code === "KeyR") location.reload();
  });

  return {
    update(state: GameState, ctx: HudContext): void {
      dead = state.playerDead;
      if (dead !== lastDeathVisible) {
        if (dead) {
          // Task 7 coordination (CRITICAL — see screenFx.ts's file-header
          // comment for the full CSS-stacking-context writeup): `.hud-death`
          // is opaque and would otherwise appear instantly the very same
          // frame `state.playerDead` flips, completely hiding screenFx's
          // 1.2s ink-spread-to-black animation underneath it (that overlay
          // sits at a lower effective stacking order than #hud as a whole,
          // regardless of `.hud-death`'s own z-index, since #hud already
          // establishes its own stacking context). Delaying this reveal by
          // the exact same DEATH_SPREAD_MS lets the ink finish spreading to
          // solid black first, so the death screen docks onto an already-black
          // screen instead of instantly stomping the animation.
          window.setTimeout(() => deathEl.classList.add("hud-visible"), DEATH_SPREAD_MS);
        } else {
          deathEl.classList.remove("hud-visible");
        }
        lastDeathVisible = dead;
      }
      if (dead) return; // frozen on last-rendered rings/prompt/status underneath the overlay; nothing else to update.

      const player = getPlayer(state);

      updateRing(hunger.handle, player.needs.hunger);
      updateRing(thirst.handle, player.needs.thirst);
      updateRing(fatigue.handle, player.needs.fatigue);

      const nextPrompt = contextPrompt(ctx, player);
      const nextWord = nextPrompt?.word ?? "";
      if (nextWord !== lastWord) {
        if (nextPrompt === null) {
          promptPillEl.classList.remove("hud-visible");
        } else {
          promptKeyEl.textContent = nextPrompt.key;
          promptWordMainEl.textContent = nextPrompt.word.slice(0, -1);
          promptWordAccentEl.textContent = nextPrompt.word.slice(-1);
          promptPillEl.classList.add("hud-visible");
          // Re-trigger the 160ms fade-in even when already visible and
          // switching to a different word — same remove/reflow/re-add
          // pattern screenFx.ts's triggerHurt() uses to replay a CSS
          // animation on repeat triggers (simply re-adding an already-
          // present class is a no-op to the class list and won't replay).
          promptPillEl.classList.remove("hud-fade-in");
          void promptPillEl.offsetWidth;
          promptPillEl.classList.add("hud-fade-in");
        }
        lastWord = nextWord;
      }

      // 叼运中提示胶囊（Part 2，postfix-9）：纯布尔可见性切换，无需渐显动画——
      // 叼起/放下本身已经是明确的按键动作，不需要额外的过渡语言。
      if (ctx.carrying !== lastCarrying) {
        carryChipEl.classList.toggle("hud-visible", ctx.carrying);
        lastCarrying = ctx.carrying;
      }

      // 筑巢进度条（Part 2，postfix-9）：与环形仪表同一套"四舍五入到整数百分比才重写"
      // dirty-check（见 updateRing/pct 的注释），0 同时驱动隐藏。
      const nextBuildPct = pct(ctx.nestBuildPct);
      if (nextBuildPct !== lastBuildPct) {
        buildBarEl.classList.toggle("hud-visible", nextBuildPct > 0);
        buildBarFillEl.style.width = `${nextBuildPct}%`;
        lastBuildPct = nextBuildPct;
      }

      const nextStatus = statusLabel(player, ctx);
      if (nextStatus !== lastStatus) {
        if (nextStatus === "") {
          statusTextEl.classList.remove("hud-visible");
        } else {
          statusTextEl.textContent = nextStatus;
          statusTextEl.classList.add("hud-visible");
        }
        lastStatus = nextStatus;
      }
    },
  };
}
