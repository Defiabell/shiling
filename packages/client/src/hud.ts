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
}

export interface Hud {
  update(state: GameState, ctx: HudContext): void;
}

const STYLE_ID = "shiling-hud-style";

/**
 * hex → "#rrggbb" / "r, g, b" — same convert-at-the-call-site approach
 * screenFx.ts's hexToRgbTriplet uses (see that file's header comment): a
 * hand-written ShaderMaterial has no shared sRGB pipeline to piggyback on
 * for a plain CSS string either, and there's no shared conversion helper in
 * palette.ts to import — every consumer does its own trivial bit-shift.
 */
function hexToCssColor(hex: number): string {
  return `#${hex.toString(16).padStart(6, "0")}`;
}
function hexToRgbTriplet(hex: number): string {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return `${r}, ${g}, ${b}`;
}

// PALETTE-derived: kept for the two spots that still want to key off the
// world's own ink/cinnabar tones rather than a bespoke UI literal (see each
// use site below for why) — "可与 PALETTE 引用混用" per the restyle brief.
const inkRgb = hexToRgbTriplet(PALETTE.outlineInk); // 世界墨色，仅用于死亡遮罩底
const cinnabarHex = hexToCssColor(PALETTE.cinnabar); // #c23b22 — 与本次亮卡设计的朱砂强调色数值完全重合

/**
 * 亮色游戏 UI 分组常量（宝可梦系明快风格 restyle，取代此前的水墨 fashion 皮肤）。
 * 三组各管一件事：CARD 是所有卡片/pill/徽章共用的底/描边/投影语言，BAR 是数值
 * 条专属的渐变端点，ACCENT 是目前只有一处用到的强调色（备用位留给未来徽章类型）。
 * TEXT.ink 与 CARD.border 刻意同值——brief 原话是同一个 #2b2b33 同时充当"文字
 * 主色"和"卡片描边"，起别名只是为了让调用点表达各自的语义,不是两份独立数据。
 */
const CARD = {
  bg: "#f7f1e3", // 暖纸白
  border: "#2b2b33", // 3px 墨黑描边
  radius: "14px",
  shadow: "0 3px 0 rgba(43, 43, 51, 0.35)", // 实心 offset 阴影，不用 blur——卡通感
} as const;

const BAR = {
  trackBg: "#e3dcc9",
  hungerFrom: "#f5a623", hungerTo: "#e07b1f",
  thirstFrom: "#35b6d9", thirstTo: "#1f7fa8",
  fatigueFrom: "#b8c0c8", fatigueTo: "#8a949e",
  low: "#e0452b",
} as const;

const ACCENT = {
  successGreen: "#4caf6d", // 目前仅状态徽章呼吸灯用到
} as const;

const TEXT = {
  ink: CARD.border,
  onAccent: "#fff", // 朱砂/深色 pill 上的白字
} as const;

/** 情境 pill 弹入动画时长（brief：scale 0.6→1.05→1，180ms）。 */
const PROMPT_POP_MS = 180;

// Injected once into <head>; #hud itself stays pointer-events:none so the
// bars/prompt/status never steal the canvas's drag-to-look mouse input —
// the death overlay is the sole exception (see .hud-death below), since once
// the player is dead there is nothing left in the 3D view worth dragging.
//
// Font split (restyle decision): the base #hud font-family is now the system
// bold-rounded stack — brief's "清晰第一" directive for all regular UI copy.
// Ma Shan Zheng (still vendored at public/fonts/mashanzheng.woff2, subset
// unchanged — see Task 8/9 history for how that 41-glyph subset was built)
// is now opted into by exactly two elements: `.hud-death-title` here (身死)
// and title.ts's `.title-main` (食灵). Every other string this HUD renders
// (labels, prompt words, status text, the death hint, the new "R 重来" key
// hint) uses copy that was already vendored under the old scheme OR never
// touches the custom font at all under the new one, so no font-subset
// regeneration is needed — see brief's own note confirming this.
const HUD_CSS = `
@font-face {
  font-family: "Ma Shan Zheng";
  src: url("/fonts/mashanzheng.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
#hud {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 10;
  font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  color: ${TEXT.ink};
  user-select: none;
}

/* ---- 右上：状态徽章（亮卡片 + 呼吸灯，横排） ---- */
.hud-status-badge {
  position: absolute;
  top: 16px;
  right: 16px;
  display: none;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: ${CARD.bg};
  border: 3px solid ${CARD.border};
  border-radius: ${CARD.radius};
  box-shadow: ${CARD.shadow};
}
.hud-status-badge.hud-visible { display: flex; }
.hud-status-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: ${ACCENT.successGreen};
  animation: hud-dot-breathe 1.6s ease-in-out infinite;
}
@keyframes hud-dot-breathe {
  0%, 100% { opacity: 0.4; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1.15); }
}
.hud-status-text {
  font-size: 14px;
  font-weight: 700;
  color: ${TEXT.ink};
  white-space: nowrap;
}

/* ---- 中下：情境提示胶囊（朱砂方印点缀 + 键帽 + 动作词） ---- */
.hud-prompt-pill {
  position: absolute;
  bottom: 100px;
  left: 50%;
  transform: translateX(-50%) scale(1);
  display: none;
  align-items: center;
  gap: 10px;
  padding: 6px 18px 6px 6px;
  background: ${CARD.bg};
  border: 3px solid ${CARD.border};
  border-radius: 999px; /* 唯一明确要求"胶囊"形的元素——其余卡片/徽章都是 14px 圆角矩形 */
  box-shadow: ${CARD.shadow};
}
.hud-prompt-pill.hud-visible { display: flex; }
.hud-prompt-pill.hud-pill-pop {
  animation: hud-pill-pop ${PROMPT_POP_MS}ms ease-out;
}
@keyframes hud-pill-pop {
  0% { transform: translateX(-50%) scale(0.6); }
  60% { transform: translateX(-50%) scale(1.05); }
  100% { transform: translateX(-50%) scale(1); }
}
.hud-prompt-seal {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: ${cinnabarHex};
  color: ${TEXT.onAccent};
  font-size: 15px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.hud-prompt-key {
  /* min-width（而非固定 width）：键位拆分（W2）后撕咬提示要显示"左键"（2 字）而不是
     "E"（1 字），min-width+左右 padding 让两种长度的文案都能不裁切地居中显示。 */
  min-width: 28px;
  height: 28px;
  padding: 0 6px;
  border-radius: 6px;
  background: #fff;
  color: ${CARD.border};
  border: 3px solid ${CARD.border};
  box-shadow: 0 3px 0 ${CARD.border}; /* 键帽"按下感"——实心 offset，不是真的按下状态 */
  font-size: 13px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  white-space: nowrap;
}
.hud-prompt-word {
  font-size: 16px;
  font-weight: 700;
  color: ${TEXT.ink};
  white-space: nowrap;
}

/* ---- 左下：三条数值卡片 ---- */
.hud-card {
  position: absolute;
  left: 20px;
  bottom: 20px;
  width: 220px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: ${CARD.bg};
  border: 3px solid ${CARD.border};
  border-radius: ${CARD.radius};
  box-shadow: ${CARD.shadow};
}
.hud-bar-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.hud-bar-label {
  width: 26px;
  height: 26px;
  border-radius: 999px; /* 深色 pill 标签，brief 字面要求 */
  background: ${CARD.border};
  color: ${TEXT.onAccent};
  font-size: 13px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.hud-bar-track {
  flex: 1;
  height: 16px;
  border-radius: 999px;
  background: ${BAR.trackBg};
  border: 2px solid ${CARD.border};
  overflow: hidden; /* 见 .hud-bar-shine 注释——务必内缩，不能外探 */
  position: relative;
}
.hud-bar-fill {
  height: 100%;
  border-radius: 999px;
  position: relative;
  transition: width 0.15s linear;
}
.hud-bar-fill.hud-hunger {
  background: linear-gradient(to right, ${BAR.hungerFrom}, ${BAR.hungerTo});
}
.hud-bar-fill.hud-thirst {
  background: linear-gradient(to right, ${BAR.thirstFrom}, ${BAR.thirstTo});
}
.hud-bar-fill.hud-fatigue {
  background: linear-gradient(to right, ${BAR.fatigueFrom}, ${BAR.fatigueTo});
}
.hud-bar-shine {
  /* right:3px（内缩，不外探）——Task 8 的血泪教训:.hud-bar-track 的
     overflow:hidden 是必要的（防止方角填充戳出圆角轨道），而疲劳条初始
     就是满量 100%（见 sim.ts 的初始状态），right:-3px 会在每局游戏刚开始
     就被裁掉半个圆。inset 在 fill 的 100% 宽度内则永远落在裁剪区内。 */
  position: absolute;
  right: 3px;
  top: 50%;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.85);
  box-shadow: 0 0 3px rgba(255, 255, 255, 0.6);
  transform: translateY(-50%);
}
.hud-bar-track.hud-low {
  animation: hud-bar-bounce 0.6s ease-in-out infinite;
}
.hud-bar-track.hud-low .hud-bar-fill {
  background: ${BAR.low};
  animation: hud-bar-flicker 0.8s ease-in-out infinite;
}
@keyframes hud-bar-bounce {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.06); }
}
@keyframes hud-bar-flicker {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

/* ---- 死亡界面：暗色半透明 scrim 上一张大亮卡 ---- */
.hud-death {
  position: fixed;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  background: rgba(${inkRgb}, 0.72); /* 世界墨色半透明 scrim，不是纯黑——身下的亮卡才是视觉主体 */
  pointer-events: auto;
  z-index: 20;
}
.hud-death.hud-visible { display: flex; }
.hud-death-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  padding: 44px 64px;
  background: ${CARD.bg};
  border: 4px solid ${CARD.border}; /* 比常规卡片更粗——"粗描边"的大卡 */
  border-radius: 20px;
  box-shadow: 0 6px 0 rgba(43, 43, 51, 0.35);
}
.hud-death-title {
  font-family: "Ma Shan Zheng", "STKaiti", "KaiTi", serif; /* 唯二书法字体用点之一 */
  font-size: 52px;
  font-weight: 700;
  color: ${TEXT.ink};
  letter-spacing: 0.1em;
}
.hud-death-hint {
  font-size: 18px;
  font-weight: 600;
  color: ${TEXT.ink};
  opacity: 0.82;
  letter-spacing: 0.05em;
}
.hud-death-keyhint {
  /* 按钮外观提示——仍然只是文字装饰，真正的转世触发还是走下面 window
     keydown 的 KeyR 监听，这里不挂 click handler。 */
  padding: 10px 28px;
  background: ${cinnabarHex};
  color: ${TEXT.onAccent};
  font-size: 16px;
  font-weight: 700;
  border-radius: 999px;
  border: 3px solid ${CARD.border};
  box-shadow: 0 3px 0 rgba(43, 43, 51, 0.35);
  letter-spacing: 0.1em;
}
.hud-death-seal {
  position: absolute;
  top: -18px;
  right: -18px;
  width: 44px;
  height: 44px;
  border-radius: 8px;
  background: ${cinnabarHex};
  color: ${TEXT.onAccent};
  writing-mode: vertical-rl;
  font-size: 16px;
  letter-spacing: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 3px solid ${CARD.border};
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

interface BarHandle {
  track: HTMLDivElement;
  fill: HTMLDivElement;
  lastPct: number;
  lastLow: boolean;
}

/**
 * Builds one bar row: pill label + thick gradient bar. The shine dot is a
 * child of `fill`, inset 3px from its right edge (see the clipping rationale
 * on `.hud-bar-shine` above), so it rides along with the fill's width purely
 * through CSS layout — no extra per-frame JS beyond the existing width write
 * below. The low-state class toggles on `track` (not `fill`): bounce needs
 * to scale the whole box (border included), and the fill-only flicker is
 * reached via a descendant selector off that same class.
 */
function buildBar(label: string, modifierClass: string): { row: HTMLDivElement; handle: BarHandle } {
  const row = document.createElement("div");
  row.className = "hud-bar-row";

  const labelEl = document.createElement("div");
  labelEl.className = "hud-bar-label";
  labelEl.textContent = label;

  const track = document.createElement("div");
  track.className = "hud-bar-track";

  const fill = document.createElement("div");
  fill.className = `hud-bar-fill ${modifierClass}`;
  fill.style.width = "0%";

  const shine = document.createElement("div");
  shine.className = "hud-bar-shine";
  fill.appendChild(shine);

  track.appendChild(fill);
  row.appendChild(labelEl);
  row.appendChild(track);

  return { row, handle: { track, fill, lastPct: -1, lastLow: false } };
}

/** Writes width%/low-class only when the rounded percent or low-state actually changed since the last call. */
function updateBar(handle: BarHandle, value: number): void {
  const p = pct(value);
  if (p !== handle.lastPct) {
    handle.fill.style.width = `${p}%`;
    handle.lastPct = p;
  }
  const low = p < LOW_THRESHOLD;
  if (low !== handle.lastLow) {
    handle.track.classList.toggle("hud-low", low);
    handle.lastLow = low;
  }
}

/** Single seal glyph + full action word + keycap label for one context-prompt state. */
interface ContextPrompt {
  glyph: string;
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
 * only (seal glyph + separate action word + keycap inside a bright pill
 * instead of the old ink-wash seal+tag) — the ordering and the underlying
 * words (挖掘/撕咬/进食/饮水/出洞) are unchanged; only the keycap shown for
 * 撕咬 changed from "E" to "左键" (W2 key split).
 */
function contextPrompt(ctx: HudContext, player: Creature): ContextPrompt | null {
  if (player.burrowId !== null) return { glyph: "出", word: "出洞", key: "E" };
  if (ctx.nearDigSpot) return { glyph: "挖", word: "挖掘", key: "E" };
  if (ctx.nearPrey) return { glyph: "咬", word: "撕咬", key: "左键" };
  if (ctx.nearCarcass) return { glyph: "食", word: "进食", key: "E" };
  if (ctx.nearWater) return { glyph: "饮", word: "饮水", key: "E" };
  return null;
}

/**
 * Status badge label. burrowId !== null takes precedence over everything
 * (activity is pinned to "idle" and locomotion to "burrow" while burrowed —
 * see digging.ts's enterBurrow/exitBurrow). digging and eating are mutually
 * exclusive by construction (`activity` is a single field), but either can
 * still co-occur with locomotion === "swim" (e.g. digging/eating right at a
 * shoreline) — in that case the deliberate action takes precedence over the
 * ambient "潜泳" descriptor.
 */
function statusLabel(player: Creature): string {
  if (player.burrowId !== null) return "洞中休息";
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

  const statusBadgeEl = document.createElement("div");
  statusBadgeEl.className = "hud-status-badge";
  const statusDotEl = document.createElement("div");
  statusDotEl.className = "hud-status-dot";
  const statusTextEl = document.createElement("div");
  statusTextEl.className = "hud-status-text";
  statusBadgeEl.appendChild(statusDotEl);
  statusBadgeEl.appendChild(statusTextEl);
  root.appendChild(statusBadgeEl);

  const promptPillEl = document.createElement("div");
  promptPillEl.className = "hud-prompt-pill";
  const promptSealEl = document.createElement("div");
  promptSealEl.className = "hud-prompt-seal";
  const promptKeyEl = document.createElement("div");
  promptKeyEl.className = "hud-prompt-key";
  // 初始文案任意——nextGlyph !== lastGlyph 的分支会在第一次 update() 时写入真实值，
  // 这里不需要提前确定是 "E" 还是 "左键"（键位拆分后不再总是 "E"）。
  promptKeyEl.textContent = "E";
  const promptWordEl = document.createElement("div");
  promptWordEl.className = "hud-prompt-word";
  promptPillEl.appendChild(promptSealEl);
  promptPillEl.appendChild(promptKeyEl);
  promptPillEl.appendChild(promptWordEl);
  root.appendChild(promptPillEl);

  const cardEl = document.createElement("div");
  cardEl.className = "hud-card";
  const hunger = buildBar("饥", "hud-hunger");
  const thirst = buildBar("渴", "hud-thirst");
  const fatigue = buildBar("疲", "hud-fatigue");
  cardEl.appendChild(hunger.row);
  cardEl.appendChild(thirst.row);
  cardEl.appendChild(fatigue.row);
  root.appendChild(cardEl);

  const deathEl = document.createElement("div");
  deathEl.className = "hud-death";
  const deathCard = document.createElement("div");
  deathCard.className = "hud-death-card";
  const deathTitle = document.createElement("div");
  deathTitle.className = "hud-death-title";
  deathTitle.textContent = "身死";
  const deathHint = document.createElement("div");
  deathHint.className = "hud-death-hint";
  deathHint.textContent = "魂归青丘——按 R 转世";
  const deathKeyhint = document.createElement("div");
  deathKeyhint.className = "hud-death-keyhint";
  deathKeyhint.textContent = "R 重来";
  const deathSeal = document.createElement("div");
  deathSeal.className = "hud-death-seal";
  deathSeal.textContent = "食灵";
  deathCard.appendChild(deathTitle);
  deathCard.appendChild(deathHint);
  deathCard.appendChild(deathKeyhint);
  deathCard.appendChild(deathSeal);
  deathEl.appendChild(deathCard);
  root.appendChild(deathEl);

  let dead = false;
  let lastDeathVisible = false;
  let lastGlyph = ""; // "" = prompt hidden — mirrors lastStatus's empty-string-as-hidden convention
  let lastStatus = "";

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
          // solid black first, so the death card docks onto an already-black
          // screen instead of instantly stomping the animation.
          window.setTimeout(() => deathEl.classList.add("hud-visible"), DEATH_SPREAD_MS);
        } else {
          deathEl.classList.remove("hud-visible");
        }
        lastDeathVisible = dead;
      }
      if (dead) return; // frozen on last-rendered bars/prompt/status underneath the overlay; nothing else to update.

      const player = getPlayer(state);

      updateBar(hunger.handle, player.needs.hunger);
      updateBar(thirst.handle, player.needs.thirst);
      updateBar(fatigue.handle, player.needs.fatigue);

      const nextPrompt = contextPrompt(ctx, player);
      const nextGlyph = nextPrompt?.glyph ?? "";
      if (nextGlyph !== lastGlyph) {
        if (nextPrompt === null) {
          promptPillEl.classList.remove("hud-visible");
        } else {
          promptSealEl.textContent = nextPrompt.glyph;
          promptWordEl.textContent = nextPrompt.word;
          promptKeyEl.textContent = nextPrompt.key;
          promptPillEl.classList.add("hud-visible");
          // Re-trigger the 180ms spring pop-in even when already visible and
          // switching to a different glyph — same remove/reflow/re-add
          // pattern screenFx.ts's triggerHurt() uses to replay a CSS
          // animation on repeat triggers (simply re-adding an already-
          // present class is a no-op to the class list and won't replay).
          promptPillEl.classList.remove("hud-pill-pop");
          void promptPillEl.offsetWidth;
          promptPillEl.classList.add("hud-pill-pop");
        }
        lastGlyph = nextGlyph;
      }

      const nextStatus = statusLabel(player);
      if (nextStatus !== lastStatus) {
        // Explicit show/hide (unlike the old vertical tag, this badge has a
        // permanent dot child so `:empty` no longer reads as "no status").
        if (nextStatus === "") {
          statusBadgeEl.classList.remove("hud-visible");
        } else {
          statusTextEl.textContent = nextStatus;
          statusBadgeEl.classList.add("hud-visible");
        }
        lastStatus = nextStatus;
      }
    },
  };
}
