import type { GameState } from "@shiling/sim";
import { ORGANS, type OrganSlot } from "@shiling/content";
import { PALETTE } from "./palette.js";
import { SLOT_LABELS } from "./organVisuals.js";

/**
 * 蜕变演出（M1 B5，见 2026-08-10-m1-evolution-plan.md B5 一节）：V 触发蛰伏 → 缓黑 +
 * 「蛰伏中……」呼吸文字 + 漂浮星点 → 蛰伏结束若真的开了奖（lastEvolution.tick 变化）→
 * 持黑 0.5s → 揭示卡（器官名书法体大字 + 志怪词条 + 槎位 + 替换说明）→ E 关闭 → 带一次
 * 暖光脉冲淡回游戏。全程由 update(state, now) 内部的一个五态机驱动，纯读 GameState，
 * 从不 mutate 任何 sim 字段。
 *
 * **五态**：
 *   idle       —— 默认，遮罩完全透明，不拦截任何输入。
 *   dormant    —— state.dormancy 刚从 null 变为非 null 时进入：遮罩缓慢淡到近黑 +
 *                  「蛰伏中……」呼吸文字 + 星点漂移。此阶段 sim.step() 必须继续正常
 *                  推进（蛰伏的 45 秒真实时间就是靠它流逝的），main.ts 的渲染循环
 *                  *不* 在这个阶段冻结任何东西——isBlockingInput() 在这个阶段返回
 *                  false，就是为了让调用方知道"这一段不需要冻结"。
 *   holdBlack  —— state.dormancy 变回 null 的那一帧检测到 lastEvolution.tick 相比
 *                  进入 dormant 时确实变了（真的开奖了，不是储粮耗尽的中断路径）→
 *                  遮罩保持近黑，呼吸文字隐去，静置 HOLD_BLACK_MS，营造"黑屏片刻"的
 *                  仪式停顿。
 *   ceremony   —— 持黑计时结束 → 揭示卡淡入，等待 dismiss()（main.ts 里 E 键的独立
 *                  边沿检测调用，不经过 PlayerInput——见下方 isBlockingInput 的
 *                  头部注释，避免同一次 E 按键既关闭卡片又漏给 sim 一次 interact）。
 *   fadeOut    —— dismiss() 或（中断路径）dormant→null 但 tick 未变时进入：遮罩淡出
 *                  回到 idle，dismiss 触发的这一支额外叠一次暖光脉冲；中断路径没有
 *                  脉冲（没有蜕变发生，不该给"庆祝"的读法）。
 *
 * **holdBlack/ceremony 期间 main.ts 会冻结 sim.step()**（`isBlockingInput()`==true，
 * 与 `paused`/`hitstopped` 同一套 gate 写法）——理由：dormancy 阶段玩家仍在自己的洞里
 * （burrowId 从未被 dormancy 清空，只有专门的 E-出洞才会清），input.ts 的
 * isPlayerBurrowed() 早就把移动清零，唯一还可能"漏"进 sim 的是 E 本身（dismiss 用的
 * 同一个物理键，若不冻结、且这一 tick sim 仍在跑，会被 digging.ts 的出洞边沿检测读到，
 * 玩家会在关闭揭示卡的同一刻"顺手"出洞——不是设计好的联动，是两个独立边沿检测撞在
 * 同一物理键上的意外副作用）。冻结这两个阶段，副作用为零：dormancy 阶段本身不冻结
 * （ticksLeft 需要真实流逝），此后玩家已经"醒了"，世界继续跑不跑对玩法毫无影响，唯一
 * 要挡的就是这个意外的 E 联动。
 */

export interface CeremonyContent {
  name: string;
  flavor: string;
  slotLabel: string;
  replacedName: string | null;
}

/**
 * 揭示卡内容的纯函数核心——不依赖 DOM，直接查 ORGANS/SLOT_LABELS 表。防御性 fallback
 * （organId 不在 ORGANS 里）理论上不会发生（lastEvolution.organId 只可能来自
 * rollOrgan() 的候选池，候选池即 ORGAN_LIST，逐一对应 ORGANS 的键），仍然给一个不炸的
 * 兜底而不是假设表里一定查得到——与本工程其它"防御性 fallback，理论上不会命中"的既有
 * 注释同一惯例（如 sim/src/organs.ts 的 getModifiers）。导出供 evolutionFx.test.ts
 * 直接断言。
 */
export function buildCeremonyContent(evo: { organId: string; slot: OrganSlot; replacedId: string | null }): CeremonyContent {
  const def = ORGANS[evo.organId];
  const replacedDef = evo.replacedId ? ORGANS[evo.replacedId] : undefined;
  return {
    name: def?.name ?? evo.organId,
    flavor: def?.flavor ?? "",
    slotLabel: SLOT_LABELS[evo.slot],
    replacedName: replacedDef?.name ?? null,
  };
}

type Phase = "idle" | "dormant" | "holdBlack" | "ceremony" | "fadeOut";

const HOLD_BLACK_MS = 500;
const FADE_OUT_MS = 700;
const FADE_OPACITY = 0.97; // "近黑"而非纯黑（plan 原话），也顺带让 HUD 在这层遮罩下彻底不可读

const OVERLAY_ID = "shiling-evofx-overlay";
const STYLE_ID = "shiling-evofx-style";
const STAR_COUNT = 16;

const SYSTEM_FONT = `-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;

function hexToCssColor(hex: number): string {
  return `#${hex.toString(16).padStart(6, "0")}`;
}

const CARD_BG = "rgba(14, 16, 22, 0.72)";
const CARD_HAIRLINE = "rgba(255, 255, 255, 0.16)";
const TEXT_PRIMARY = "#e8ecf2";
const TEXT_DIM = "#c8d2dc";
const WARM_GLOW = hexToCssColor(PALETTE.lampWarm);

function ensureStyleInjected(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
@font-face {
  font-family: "Ma Shan Zheng";
  src: url("/fonts/mashanzheng.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
#${OVERLAY_ID} {
  position: fixed;
  inset: 0;
  /* 22：高于 #hud(10)、低于暂停面板(25)——蛰伏演出是"世界内"的仪式性事件，暂停这个
     元层级操作理应盖在它上面（见 main.ts 的 Esc 守卫注释）。 */
  z-index: 22;
  pointer-events: none;
  font-family: ${SYSTEM_FONT};
}
.evofx-fade {
  position: absolute;
  inset: 0;
  background: #05060a;
  opacity: 0;
  transition: opacity 1400ms ease;
}
.evofx-fade.evofx-visible { opacity: ${FADE_OPACITY}; }
.evofx-fade.evofx-fading-out { opacity: 0; transition: opacity ${FADE_OUT_MS}ms ease; }

.evofx-stars { position: absolute; inset: 0; opacity: 0; transition: opacity 1200ms ease; }
.evofx-stars.evofx-visible { opacity: 1; }
.evofx-star {
  position: absolute;
  width: 3px; height: 3px;
  border-radius: 50%;
  background: rgba(232, 236, 242, 0.8);
  box-shadow: 0 0 4px 1px rgba(232, 236, 242, 0.5);
  animation: evofx-star-drift 12s ease-in-out infinite;
}
@keyframes evofx-star-drift {
  0%, 100% { transform: translate(0, 0); opacity: 0.25; }
  50% { transform: translate(6px, -10px); opacity: 0.9; }
}

.evofx-breathing {
  position: absolute;
  left: 50%; top: 50%;
  transform: translate(-50%, -50%);
  opacity: 0;
  font-size: 22px;
  font-weight: 300;
  letter-spacing: 0.3em;
  color: ${TEXT_PRIMARY};
}
.evofx-breathing.evofx-visible {
  animation: evofx-breathe 3.2s ease-in-out infinite;
}
@keyframes evofx-breathe { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }

.evofx-card {
  position: absolute;
  left: 50%; top: 50%;
  transform: translate(-50%, -50%) scale(0.94);
  min-width: 320px;
  padding: 40px 52px;
  background: ${CARD_BG};
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-radius: 18px;
  box-shadow: 0 0 0 1px ${CARD_HAIRLINE} inset, 0 0 40px -10px ${WARM_GLOW}88;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  opacity: 0;
  transition: opacity 500ms ease, transform 500ms ease;
}
.evofx-card.evofx-visible { opacity: 1; transform: translate(-50%, -50%) scale(1); }
.evofx-card-name {
  font-family: "Ma Shan Zheng", "STKaiti", "KaiTi", serif;
  font-size: 64px;
  font-weight: 400;
  letter-spacing: 0.1em;
  color: #ffffff;
  text-shadow: 0 0 16px rgba(255, 255, 255, 0.4), 0 0 36px ${WARM_GLOW}aa;
}
.evofx-card-flavor {
  font-size: 15px;
  font-weight: 300;
  letter-spacing: 0.1em;
  color: ${TEXT_DIM};
  text-align: center;
}
.evofx-card-slot, .evofx-card-replaced {
  font-size: 13px;
  font-weight: 300;
  letter-spacing: 0.12em;
  color: ${TEXT_DIM};
  opacity: 0.85;
}
.evofx-card-hint {
  margin-top: 8px;
  font-size: 14px;
  font-weight: 300;
  letter-spacing: 0.15em;
  color: ${TEXT_DIM};
}
.evofx-keycap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  margin-right: 6px;
  vertical-align: middle;
  border-radius: 6px;
  background: rgba(14, 16, 22, 0.5);
  box-shadow: 0 0 0 1px ${CARD_HAIRLINE} inset;
  color: ${TEXT_PRIMARY};
  font-size: 12px;
  font-weight: 400;
}

.evofx-glow {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle, ${WARM_GLOW}55 0%, transparent 65%);
  opacity: 0;
}
.evofx-glow.evofx-pulse {
  animation: evofx-glow-pulse 700ms ease-out;
}
@keyframes evofx-glow-pulse { 0% { opacity: 0.9; } 100% { opacity: 0; } }
`;
  document.head.appendChild(style);
}

export interface EvolutionFx {
  /** 每渲染帧调用一次（main.ts 与 hud.update 同一 `started && !paused` gate）——内部五态机的唯一驱动入口。 */
  update(state: GameState, now: number): void;
  /** E 键关闭揭示卡——main.ts 里独立的边沿检测调用（不经过 PlayerInput，见文件头注释），仅在 phase==="ceremony" 时生效。 */
  dismiss(): void;
  /** holdBlack/ceremony 期间为 true——main.ts 据此额外冻结 sim.step()（见文件头注释），且用它抑制 Tab/organ 面板这类会与全屏仪式叠在一起显得混乱的交互。 */
  isBlockingInput(): boolean;
}

export function createEvolutionFx(): EvolutionFx {
  ensureStyleInjected();

  let overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    document.body.appendChild(overlay);
  }

  const fadeEl = document.createElement("div");
  fadeEl.className = "evofx-fade";
  overlay.appendChild(fadeEl);

  const starsEl = document.createElement("div");
  starsEl.className = "evofx-stars";
  for (let i = 0; i < STAR_COUNT; i++) {
    const star = document.createElement("div");
    star.className = "evofx-star";
    star.style.left = `${Math.random() * 100}%`;
    star.style.top = `${Math.random() * 100}%`;
    star.style.animationDelay = `${Math.random() * 12}s`;
    starsEl.appendChild(star);
  }
  overlay.appendChild(starsEl);

  const breathingEl = document.createElement("div");
  breathingEl.className = "evofx-breathing";
  breathingEl.textContent = "蛰伏中……";
  overlay.appendChild(breathingEl);

  const cardEl = document.createElement("div");
  cardEl.className = "evofx-card";
  const cardNameEl = document.createElement("div");
  cardNameEl.className = "evofx-card-name";
  const cardFlavorEl = document.createElement("div");
  cardFlavorEl.className = "evofx-card-flavor";
  const cardSlotEl = document.createElement("div");
  cardSlotEl.className = "evofx-card-slot";
  const cardReplacedEl = document.createElement("div");
  cardReplacedEl.className = "evofx-card-replaced";
  const cardHintEl = document.createElement("div");
  cardHintEl.className = "evofx-card-hint";
  const hintKeycap = document.createElement("span");
  hintKeycap.className = "evofx-keycap";
  hintKeycap.textContent = "E";
  cardHintEl.append(hintKeycap, "继续");
  cardEl.append(cardNameEl, cardFlavorEl, cardSlotEl, cardReplacedEl, cardHintEl);
  overlay.appendChild(cardEl);

  const glowEl = document.createElement("div");
  glowEl.className = "evofx-glow";
  overlay.appendChild(glowEl);

  let phase: Phase = "idle";
  let lastDormancy = false;
  let dormancyTickAtStart = -1;
  let holdStartMs = 0;
  let fadeOutStartMs = 0;

  function showDormant(): void {
    fadeEl.classList.remove("evofx-fading-out");
    fadeEl.classList.add("evofx-visible");
    starsEl.classList.add("evofx-visible");
    breathingEl.classList.add("evofx-visible");
  }

  function hideBreathingForHold(): void {
    breathingEl.classList.remove("evofx-visible");
    starsEl.classList.remove("evofx-visible");
  }

  function showCeremony(content: CeremonyContent): void {
    cardNameEl.textContent = content.name;
    cardFlavorEl.textContent = content.flavor;
    cardSlotEl.textContent = `部位：${content.slotLabel}`;
    if (content.replacedName) {
      cardReplacedEl.textContent = `替换了「${content.replacedName}」`;
      cardReplacedEl.style.display = "block";
    } else {
      cardReplacedEl.style.display = "none";
    }
    cardEl.classList.add("evofx-visible");
  }

  function startFadeOut(withGlow: boolean): void {
    cardEl.classList.remove("evofx-visible");
    fadeEl.classList.add("evofx-fading-out");
    fadeEl.classList.remove("evofx-visible");
    if (withGlow) {
      // 重触发动画：既有 remove/reflow/add 惯例（screenFx.ts triggerHurt 同一手法）。
      glowEl.classList.remove("evofx-pulse");
      void glowEl.offsetWidth;
      glowEl.classList.add("evofx-pulse");
    }
  }

  function resetToIdle(): void {
    fadeEl.classList.remove("evofx-fading-out", "evofx-visible");
    starsEl.classList.remove("evofx-visible");
    breathingEl.classList.remove("evofx-visible");
    cardEl.classList.remove("evofx-visible");
  }

  return {
    update(state: GameState, now: number): void {
      const dormantNow = state.dormancy !== null;

      if (phase === "idle") {
        if (dormantNow && !lastDormancy) {
          phase = "dormant";
          dormancyTickAtStart = state.lastEvolution?.tick ?? -1;
          showDormant();
        }
      } else if (phase === "dormant") {
        if (!dormantNow) {
          const rolled = (state.lastEvolution?.tick ?? -1) !== dormancyTickAtStart && state.lastEvolution !== null;
          if (rolled) {
            phase = "holdBlack";
            holdStartMs = now;
            hideBreathingForHold();
          } else {
            // 中断路径（储粮耗尽/理论上不该发生的家巢丢失）：没有开奖，直接淡出，
            // 不叠暖光脉冲——那是留给"真的换了一件器官"这个值得庆祝的时刻的。
            phase = "fadeOut";
            fadeOutStartMs = now;
            startFadeOut(false);
          }
        }
      } else if (phase === "holdBlack") {
        if (now - holdStartMs >= HOLD_BLACK_MS && state.lastEvolution) {
          phase = "ceremony";
          showCeremony(buildCeremonyContent(state.lastEvolution));
        }
      } else if (phase === "fadeOut") {
        if (now - fadeOutStartMs >= FADE_OUT_MS) {
          phase = "idle";
          resetToIdle();
        }
      }
      // "ceremony" 阶段完全靠 dismiss() 推进，这里不做任何事。

      lastDormancy = dormantNow;
    },
    dismiss(): void {
      if (phase !== "ceremony") return;
      phase = "fadeOut";
      fadeOutStartMs = performance.now();
      startFadeOut(true);
    },
    isBlockingInput(): boolean {
      return phase === "holdBlack" || phase === "ceremony";
    },
  };
}
