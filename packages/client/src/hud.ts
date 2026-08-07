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

const inkHex = hexToCssColor(PALETTE.outlineInk); // #14161a — 墨
const inkRgb = hexToRgbTriplet(PALETTE.outlineInk);
const cinnabarHex = hexToCssColor(PALETTE.cinnabar); // #c23b22 — 朱砂
const playerBodyHex = hexToCssColor(PALETTE.playerBody); // #d98a3d — 饥灯浅端（呼应玩家自身毛色）
const waterSurfaceHex = hexToCssColor(PALETTE.waterSurface); // #2e5266 — 渴灯深端（呼应水面色）

/**
 * HUD-only neutrals that have no counterpart in the shared world PALETTE
 * (render/palette.ts) — paper/ink accent tokens specific to this fashion-HUD
 * skin, grouped together here per the Task 8 brief rather than scattered as
 * bare hex literals through the CSS below.
 */
const UI = {
  paper: "#e8e2d3", // 字签底色／死亡界面"纸白"大字
  hungerDark: "#8a5220", // 饥灯渐变深端（浅端见 playerBodyHex）
  thirstLight: "#9fc4d4", // 渴灯渐变浅端（深端见 waterSurfaceHex）
  fatigueLight: "#cfd2d6", // 疲灯渐变浅端
  fatigueDark: "#6f757c", // 疲灯渐变深端
  sealText: "#fff", // 印章／键帽／死亡印白字
} as const;

const SEAL_POP_MS = 120;

// Injected once into <head>; #hud itself stays pointer-events:none so the
// bars/prompt/status never steal the canvas's drag-to-look mouse input —
// the death overlay is the sole exception (see .hud-death below), since once
// the player is dead there is nothing left in the 3D view worth dragging.
//
// Font vendoring (Task 8): Ma Shan Zheng (Google Fonts, OFL) subset to
// exactly the ~28 Chinese glyphs this HUD's copy uses, downloaded via
// fonts.googleapis.com's `text=` param (returns one small unsubsetted-by-
// unicode-range file instead of the dozen-plus per-range files the default
// request splits into) and vendored to public/fonts/mashanzheng.woff2 —
// served at the absolute path below by Vite in both dev and build without
// any bundler import. If that file is ever missing (git-lfs not pulled,
// fresh clone before this task, etc.) the browser 404s the @font-face src
// silently and the stack falls through to the system 楷体 fonts — no code
// path depends on the vendor file existing.
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
  font-family: "Ma Shan Zheng", "STKaiti", "KaiTi", serif;
  color: ${UI.paper};
  user-select: none;
}

/* ---- 竖排状态字签（右上角，纸色小签，下缘撕纸感） ---- */
.hud-tag {
  position: absolute;
  top: 16px;
  right: 16px;
  writing-mode: vertical-rl;
  padding: 10px 6px 18px;
  background: ${UI.paper};
  color: ${inkHex};
  font-size: 16px;
  letter-spacing: 3px;
  clip-path: polygon(
    0 0, 100% 0,
    100% 88%, 88% 100%,
    76% 88%, 64% 100%,
    52% 88%, 40% 100%,
    28% 88%, 16% 100%,
    4% 88%, 0 100%
  );
}
.hud-tag:empty { display: none; }

/* ---- 情境提示——朱砂印章＋键帽＋动作全词（中下） ---- */
.hud-seal-group {
  position: absolute;
  bottom: 100px;
  left: 50%;
  transform: translateX(-50%);
  display: none;
  align-items: center;
  gap: 8px;
}
.hud-seal-group.hud-visible { display: flex; }
.hud-seal {
  width: 28px;
  height: 28px;
  border-radius: 3px;
  background: ${cinnabarHex};
  color: ${UI.sealText};
  font-size: 19px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.hud-seal-group.hud-seal-pop .hud-seal {
  animation: hud-seal-pop ${SEAL_POP_MS}ms ease-out;
}
@keyframes hud-seal-pop {
  from { transform: scale(0.8); }
  to { transform: scale(1); }
}
.hud-keycap {
  width: 22px;
  height: 22px;
  border-radius: 5px;
  background: ${inkHex};
  color: ${UI.sealText};
  font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}
.hud-seal-word {
  font-size: 16px;
  color: ${UI.paper};
  white-space: nowrap;
}

/* ---- 三盏灯需求条（左下） ---- */
.hud-lamps {
  position: absolute;
  left: 20px;
  bottom: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 200px;
}
.hud-lamp {
  display: flex;
  align-items: center;
  gap: 8px;
}
.hud-lamp-label {
  width: 1.4em;
  font-size: 14px;
  text-align: center;
  color: ${UI.paper};
}
.hud-lamp-track {
  flex: 1;
  height: 10px;
  background: rgba(${inkRgb}, 0.75);
  border-radius: 6px 10px 8px 4px;
  overflow: hidden;
  position: relative;
}
.hud-lamp-fill {
  height: 100%;
  border-radius: 6px 10px 8px 4px;
  position: relative;
  transition: width 0.15s linear;
}
.hud-lamp-fill.hud-hunger {
  background: linear-gradient(to right, ${playerBodyHex}, ${UI.hungerDark});
}
.hud-lamp-fill.hud-thirst {
  background: linear-gradient(to right, ${waterSurfaceHex}, ${UI.thirstLight});
}
.hud-lamp-fill.hud-fatigue {
  background: linear-gradient(to right, ${UI.fatigueLight}, ${UI.fatigueDark});
}
.hud-lamp-dot {
  /* right:3px (inset, not overhanging) — .hud-lamp-track has overflow:hidden
     (needed so a partial-width square-cornered fill never pokes past the
     track's own rounded corners), and the fill reaches exactly 100% width at
     full needs (fatigue starts there — see sim.ts's initial state), so a dot
     hanging past the fill's right edge would render half-clipped on frame
     one of every session. Tucking it fully inside the fill's box instead
     keeps it always inside the track's clip region. */
  position: absolute;
  right: 3px;
  top: 50%;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: ${inkHex};
  transform: translateY(-50%);
}
.hud-lamp-fill.hud-low {
  background: ${cinnabarHex};
  animation: hud-lamp-blink 0.8s ease-in-out infinite;
}
@keyframes hud-lamp-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

/* ---- 死亡界面 ---- */
.hud-death {
  position: fixed;
  inset: 0;
  display: none;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  background: #000;
  pointer-events: auto;
  z-index: 20;
}
.hud-death.hud-visible { display: flex; }
.hud-death-title {
  writing-mode: vertical-rl;
  color: ${UI.paper};
  font-size: 80px;
  letter-spacing: 0.2em;
}
.hud-death-hint {
  color: ${UI.paper};
  font-size: 18px;
  letter-spacing: 1px;
  opacity: 0.82;
}
.hud-death-seal {
  position: absolute;
  right: 24px;
  bottom: 24px;
  width: 44px;
  height: 44px;
  border-radius: 4px;
  background: ${cinnabarHex};
  color: ${UI.sealText};
  writing-mode: vertical-rl;
  font-size: 20px;
  letter-spacing: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
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

interface LampHandle {
  fill: HTMLDivElement;
  lastPct: number;
  lastLow: boolean;
}

/**
 * Builds one "灯盏" row: 汉字标 + 笔触条. The 墨点 dot is a child of `fill`,
 * inset 3px from its right edge (`right:3px` — see the detailed clipping
 * rationale on `.hud-lamp-dot` in HUD_CSS above), so it rides along with
 * the fill's width purely through CSS layout — no extra per-frame JS beyond
 * the existing width write below.
 */
function buildLamp(label: string, modifierClass: string): { row: HTMLDivElement; handle: LampHandle } {
  const row = document.createElement("div");
  row.className = "hud-lamp";

  const labelEl = document.createElement("div");
  labelEl.className = "hud-lamp-label";
  labelEl.textContent = label;

  const track = document.createElement("div");
  track.className = "hud-lamp-track";

  const fill = document.createElement("div");
  fill.className = `hud-lamp-fill ${modifierClass}`;
  fill.style.width = "0%";

  const dot = document.createElement("div");
  dot.className = "hud-lamp-dot";
  fill.appendChild(dot);

  track.appendChild(fill);
  row.appendChild(labelEl);
  row.appendChild(track);

  return { row, handle: { fill, lastPct: -1, lastLow: false } };
}

/** Writes width%/blink-class only when the rounded percent or low-state actually changed since the last call. */
function updateLamp(handle: LampHandle, value: number): void {
  const p = pct(value);
  if (p !== handle.lastPct) {
    handle.fill.style.width = `${p}%`;
    handle.lastPct = p;
  }
  const low = p < LOW_THRESHOLD;
  if (low !== handle.lastLow) {
    handle.fill.classList.toggle("hud-low", low);
    handle.lastLow = low;
  }
}

/** Single seal glyph + full action word for one context-prompt state. */
interface ContextPrompt {
  glyph: string;
  word: string;
}

/**
 * Context prompt priority mirrors sim's own interact priority chain
 * (tickDigging runs before tickEating's attack-then-eat before tickNeeds'
 * drink — see eating.ts's top-of-file comment): dig > attack > eat > drink.
 * Burrowed always wins outright since none of the other three interactions
 * are even reachable while burrowId !== null (movement/dig/eat all
 * early-return in that state; see digging.ts/eating.ts). Only the
 * presentation changed for Task 8 (seal glyph + separate action word instead
 * of one concatenated "E 挖掘" string) — the ordering and the underlying
 * words (挖掘/撕咬/进食/饮水/出洞) are identical to the pre-Task-8 copy.
 */
function contextPrompt(ctx: HudContext, player: Creature): ContextPrompt | null {
  if (player.burrowId !== null) return { glyph: "出", word: "出洞" };
  if (ctx.nearDigSpot) return { glyph: "挖", word: "挖掘" };
  if (ctx.nearPrey) return { glyph: "咬", word: "撕咬" };
  if (ctx.nearCarcass) return { glyph: "食", word: "进食" };
  if (ctx.nearWater) return { glyph: "饮", word: "饮水" };
  return null;
}

/**
 * Vertical status tag. burrowId !== null takes precedence over everything
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

  const tagEl = document.createElement("div");
  tagEl.className = "hud-tag";
  root.appendChild(tagEl);

  const sealGroupEl = document.createElement("div");
  sealGroupEl.className = "hud-seal-group";
  const sealEl = document.createElement("div");
  sealEl.className = "hud-seal";
  const keycapEl = document.createElement("div");
  keycapEl.className = "hud-keycap";
  keycapEl.textContent = "E";
  const sealWordEl = document.createElement("div");
  sealWordEl.className = "hud-seal-word";
  sealGroupEl.appendChild(sealEl);
  sealGroupEl.appendChild(keycapEl);
  sealGroupEl.appendChild(sealWordEl);
  root.appendChild(sealGroupEl);

  const lampsEl = document.createElement("div");
  lampsEl.className = "hud-lamps";
  const hunger = buildLamp("饥", "hud-hunger");
  const thirst = buildLamp("渴", "hud-thirst");
  const fatigue = buildLamp("疲", "hud-fatigue");
  lampsEl.appendChild(hunger.row);
  lampsEl.appendChild(thirst.row);
  lampsEl.appendChild(fatigue.row);
  root.appendChild(lampsEl);

  const deathEl = document.createElement("div");
  deathEl.className = "hud-death";
  const deathTitle = document.createElement("div");
  deathTitle.className = "hud-death-title";
  deathTitle.textContent = "身死";
  const deathHint = document.createElement("div");
  deathHint.className = "hud-death-hint";
  deathHint.textContent = "魂归青丘——按 R 转世";
  const deathSeal = document.createElement("div");
  deathSeal.className = "hud-death-seal";
  deathSeal.textContent = "食灵";
  deathEl.appendChild(deathTitle);
  deathEl.appendChild(deathHint);
  deathEl.appendChild(deathSeal);
  root.appendChild(deathEl);

  let dead = false;
  let lastDeathVisible = false;
  let lastGlyph = ""; // "" = seal hidden — mirrors lastContext's empty-string-as-hidden convention
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
          // solid black first, so the death text "docks onto" an already-
          // black screen instead of instantly stomping the animation.
          window.setTimeout(() => deathEl.classList.add("hud-visible"), DEATH_SPREAD_MS);
        } else {
          deathEl.classList.remove("hud-visible");
        }
        lastDeathVisible = dead;
      }
      if (dead) return; // frozen on last-rendered bars/prompt/status underneath the opaque overlay; nothing else to update.

      const player = getPlayer(state);

      updateLamp(hunger.handle, player.needs.hunger);
      updateLamp(thirst.handle, player.needs.thirst);
      updateLamp(fatigue.handle, player.needs.fatigue);

      const nextPrompt = contextPrompt(ctx, player);
      const nextGlyph = nextPrompt?.glyph ?? "";
      if (nextGlyph !== lastGlyph) {
        if (nextPrompt === null) {
          sealGroupEl.classList.remove("hud-visible");
        } else {
          sealEl.textContent = nextPrompt.glyph;
          sealWordEl.textContent = nextPrompt.word;
          sealGroupEl.classList.add("hud-visible");
          // Re-trigger the 120ms pop-in even when already visible and
          // switching to a different glyph — same remove/reflow/re-add
          // pattern screenFx.ts's triggerHurt() uses to replay a CSS
          // animation on repeat triggers (simply re-adding an already-
          // present class is a no-op to the class list and won't replay).
          sealGroupEl.classList.remove("hud-seal-pop");
          void sealGroupEl.offsetWidth;
          sealGroupEl.classList.add("hud-seal-pop");
        }
        lastGlyph = nextGlyph;
      }

      const nextStatus = statusLabel(player);
      if (nextStatus !== lastStatus) {
        tagEl.textContent = nextStatus;
        lastStatus = nextStatus;
      }
    },
  };
}
