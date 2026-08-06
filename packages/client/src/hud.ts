import { getPlayer, type Creature, type GameState } from "@shiling/sim";

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

// Injected once into <head>; #hud itself stays pointer-events:none so the
// bars/prompt/status never steal the canvas's drag-to-look mouse input —
// the death overlay is the sole exception (see .hud-death below), since once
// the player is dead there is nothing left in the 3D view worth dragging.
const HUD_CSS = `
#hud {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 10;
  font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
  color: #eee;
  user-select: none;
}
.hud-status {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  padding: 4px 14px;
  background: rgba(14, 15, 18, 0.55);
  border-radius: 4px;
  font-size: 14px;
  letter-spacing: 1px;
  white-space: nowrap;
}
.hud-status:empty {
  display: none;
}
.hud-context {
  position: absolute;
  bottom: 96px;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 16px;
  background: rgba(14, 15, 18, 0.6);
  border-radius: 4px;
  font-size: 16px;
  white-space: nowrap;
}
.hud-context:empty {
  display: none;
}
.hud-bars {
  position: absolute;
  left: 20px;
  bottom: 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 200px;
}
.hud-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.hud-bar-label {
  width: 1.4em;
  font-size: 13px;
  text-align: center;
  color: #ccc;
}
.hud-bar-track {
  flex: 1;
  height: 10px;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 5px;
  overflow: hidden;
}
.hud-bar-fill {
  height: 100%;
  border-radius: 5px;
  transition: width 0.15s linear;
}
.hud-bar-fill.hud-hunger {
  background: #d99a2b;
}
.hud-bar-fill.hud-thirst {
  background: #2bc4d9;
}
.hud-bar-fill.hud-fatigue {
  background: #cfd2d6;
}
.hud-bar-fill.hud-low {
  animation: hud-blink 0.8s ease-in-out infinite;
}
@keyframes hud-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.25; }
}
.hud-death {
  position: fixed;
  inset: 0;
  display: none;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: #000;
  pointer-events: auto;
  z-index: 20;
}
.hud-death.hud-visible {
  display: flex;
}
.hud-death-title {
  color: #d92b2b;
  font-size: 28px;
  letter-spacing: 2px;
}
.hud-death-hint {
  color: #d92b2b;
  font-size: 16px;
  opacity: 0.85;
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
  fill: HTMLDivElement;
  lastPct: number;
  lastLow: boolean;
}

function buildBar(label: string, modifierClass: string): { row: HTMLDivElement; handle: BarHandle } {
  const row = document.createElement("div");
  row.className = "hud-bar";

  const labelEl = document.createElement("div");
  labelEl.className = "hud-bar-label";
  labelEl.textContent = label;

  const track = document.createElement("div");
  track.className = "hud-bar-track";

  const fill = document.createElement("div");
  fill.className = `hud-bar-fill ${modifierClass}`;
  fill.style.width = "0%";

  track.appendChild(fill);
  row.appendChild(labelEl);
  row.appendChild(track);

  return { row, handle: { fill, lastPct: -1, lastLow: false } };
}

/** Writes width%/blink-class only when the rounded percent or low-state actually changed since the last call. */
function updateBar(handle: BarHandle, value: number): void {
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

/**
 * Context prompt priority mirrors sim's own interact priority chain
 * (tickDigging runs before tickEating's attack-then-eat before tickNeeds'
 * drink — see eating.ts's top-of-file comment): dig > attack > eat > drink.
 * Burrowed always wins outright since none of the other three interactions
 * are even reachable while burrowId !== null (movement/dig/eat all
 * early-return in that state; see digging.ts/eating.ts).
 */
function contextLabel(ctx: HudContext, player: Creature): string {
  if (player.burrowId !== null) return "E 出洞";
  if (ctx.nearDigSpot) return "E 挖掘";
  if (ctx.nearPrey) return "E 撕咬";
  if (ctx.nearCarcass) return "E 进食";
  if (ctx.nearWater) return "E 饮水";
  return "";
}

/**
 * Top status word. burrowId !== null takes precedence over everything
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

  const statusEl = document.createElement("div");
  statusEl.className = "hud-status";
  root.appendChild(statusEl);

  const contextEl = document.createElement("div");
  contextEl.className = "hud-context";
  root.appendChild(contextEl);

  const barsEl = document.createElement("div");
  barsEl.className = "hud-bars";
  const hunger = buildBar("饥", "hud-hunger");
  const thirst = buildBar("渴", "hud-thirst");
  const fatigue = buildBar("疲", "hud-fatigue");
  barsEl.appendChild(hunger.row);
  barsEl.appendChild(thirst.row);
  barsEl.appendChild(fatigue.row);
  root.appendChild(barsEl);

  const deathEl = document.createElement("div");
  deathEl.className = "hud-death";
  const deathTitle = document.createElement("div");
  deathTitle.className = "hud-death-title";
  deathTitle.textContent = "你死了——夜潮尚未为你落幕";
  const deathHint = document.createElement("div");
  deathHint.className = "hud-death-hint";
  deathHint.textContent = "按 R 重来";
  deathEl.appendChild(deathTitle);
  deathEl.appendChild(deathHint);
  root.appendChild(deathEl);

  let dead = false;
  let lastDeathVisible = false;
  let lastContext = "";
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
        deathEl.classList.toggle("hud-visible", dead);
        lastDeathVisible = dead;
      }
      if (dead) return; // frozen on last-rendered bars/prompt/status underneath the opaque overlay; nothing else to update.

      const player = getPlayer(state);

      updateBar(hunger.handle, player.needs.hunger);
      updateBar(thirst.handle, player.needs.thirst);
      updateBar(fatigue.handle, player.needs.fatigue);

      const nextContext = contextLabel(ctx, player);
      if (nextContext !== lastContext) {
        contextEl.textContent = nextContext;
        lastContext = nextContext;
      }

      const nextStatus = statusLabel(player);
      if (nextStatus !== lastStatus) {
        statusEl.textContent = nextStatus;
        lastStatus = nextStatus;
      }
    },
  };
}
