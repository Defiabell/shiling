import * as THREE from "three";
import { PALETTE } from "./palette.js";
import type { ModelLibrary, LibraryEntry } from "./modelLibrary.js";

/**
 * A creature's renderable model. Two families share the exact same
 * `CreatureModel` contract below: the original procedural graybox (a named-
 * mount hierarchy of MeshLambertMaterial primitives) for any species without
 * a loaded Meshy GLB, and — as of Postfix 7 (see modelLibrary.ts) — a real
 * Meshy-generated model for youshou/lingshu/tanshou, swapped in transparently
 * via `setModelLibrary()` below. `group`'s origin is the ground-contact point
 * (feet), not the geometric center, for both families — creatureView places
 * it directly at the sim's feet/terrain-surface position, no half-height
 * lift needed.
 *
 * Sim yaw convention: forward = (sin(yaw), cos(yaw)), and creatureView applies
 * `rotation.y = yaw` to `group`. So every model below is built facing +Z at
 * rotation.y = 0 — head/eyes toward +Z, tail toward -Z.
 */
/**
 * Per-frame procedural-animation input, recomputed fresh every call — see
 * `CreatureModel.animate`. `activity`/`locomotion` are deliberately plain
 * `string` rather than importing `@shiling/sim`'s `Activity`/`Locomotion`
 * unions: this module stays sim-agnostic on purpose (true of both the
 * procedural graybox and, since Postfix 7, the Meshy GLB variants above) —
 * creatureView, which already depends on `@shiling/sim` for other types, is
 * where those exact string literals get validated against
 * the real unions.
 */
export interface AnimateCtx {
  activity: string;
  locomotion: string;
  /** Horizontal speed estimate (m/s) from creatureView's interpolation data; ≈0 when stationary. */
  speedHint: number;
  /** Monotonic seconds (wall-clock derived) — the sole phase source for every sin/spring below. */
  tSec: number;
  /**
   * M2 A1（生物动效灵体化）：玩家 state.adrenalineTicks>0 直传，default false —
   * creatureView 只对玩家自己的 view 会写真值（见该文件 syncCreatures 的
   * organSignature 姊妹分支），NPC/carcass 视图恒为 false，与 isCarried 对
   * `creature:*` 视图恒为 false 同一惯例。目前唯一消费者是幼兽的肾上腺素速度线
   * （见 buildYoushouRig/wrapYoushouExtras）。
   */
  adrenaline?: boolean;
}

export interface CreatureModel {
  group: THREE.Group;
  /**
   * Named anchors — for the procedural graybox, the seam a Meshy GLB swap
   * hangs its own parts off of (see buildGlbCreatureModel), at the same
   * local transform this graybox model uses; for a GLB model itself,
   * bbox-derived M1 attachment points (not currently animated). Species
   * only create the subset of {head, back, tail, jaw} they actually use.
   */
  mounts: Record<string, THREE.Object3D>;
  /**
   * Animation handles for Task 4 (idle bob, attack lunge, tail wag, ...).
   * head/tail double as mounts.head/mounts.tail: the anchor an animation
   * drives *is* the seam a GLB swap replaces (a GLB model's `parts.head`/
   * `.tail` stay undefined — see buildGlbCreatureModel).
   */
  parts: { head?: THREE.Object3D; tail?: THREE.Object3D; body: THREE.Object3D };
  /**
   * Task 4: per-render-frame procedural animation, no skeleton — pure
   * sin/spring writes onto `group`/`parts`. creatureView.applyInterp calls
   * this *after* it has already lerped this frame's interpolated
   * position/yaw onto `group` (see that file's doc comment): the one `+=`
   * below (bob onto `group.position.y`) relies on that ordering to avoid
   * accumulating — every other write here is an absolute
   * baseline-plus-fresh-trig-term assignment, recomputed from `ctx.tSec`
   * each call, so calling this every frame is always safe regardless of
   * call order relative to that lerp.
   */
  animate(ctx: AnimateCtx): void;
  /** Frees every geometry/material in the model, outlines included — creatures die often. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// 生物动效灵体化（M2 A1）：粒子/音效侧的少量“效果请求”出口 —— 这个文件本身不持有
// scene/particles/AudioContext 引用（保持 sim-agnostic 之外，也保持渲染引擎无关的
// 既有边界），所以采用与下方 `modelLibrary` 完全同构的“模块级单例 + setter”模式：
// main.ts 在创建好 particles/audio 之后调用一次 `setCreatureFx()`，此后
// createLivingAnimate 的各物种分支直接调用 `creatureFx.xxx()`。默认的 NOOP 实现
// 保证任何在 main.ts 完成布线之前（含单测环境，从不调用 setCreatureFx）调用
// animate() 的路径都是安全的空操作，不会抛错。
// ---------------------------------------------------------------------------
export interface CreatureFx {
  /** 复用挖洞尘土配方在指定世界坐标喷 `count` 颗尘土粒子——苓鼠落地噗尘用 3、穴獾遁地颤抖用更大的数值。 */
  dust(x: number, y: number, z: number, count: number): void;
  /** 单颗深色、缓慢上升的墨烟粒子（潭狩尾迹）。 */
  inkSmoke(x: number, y: number, z: number): void;
  /** 单颗浅色、缓慢上浮的气泡粒子（溪鱼）。 */
  bubble(x: number, y: number, z: number): void;
  /** 极轻的落地“嗒”声（苓鼠跳跃落地）。 */
  hopTick(): void;
}

const NOOP_CREATURE_FX: CreatureFx = {
  dust: () => {},
  inkSmoke: () => {},
  bubble: () => {},
  hopTick: () => {},
};

let creatureFx: CreatureFx = NOOP_CREATURE_FX;

/** 由 main.ts 在创建好 particles/audio 控制器之后调用一次——见文件头注释，同 setModelLibrary 同一模式。 */
export function setCreatureFx(fx: CreatureFx): void {
  creatureFx = fx;
}

// ---- 苓鼠·跳跃 ----
const LINGSHU_HOP_PERIOD_SPEED_FACTOR = 0.9; // period = clamp(此值/speedHint, MIN, MAX)
const LINGSHU_HOP_PERIOD_MIN = 0.25;
const LINGSHU_HOP_PERIOD_MAX = 0.6;
const LINGSHU_HOP_HEIGHT = 0.25;
const LINGSHU_SQUASH_AT_LAND = 0.85; // scale.y 系数（乘 baseBodyScaleY），落地瞬间
const LINGSHU_STRETCH_AT_APEX = 1.1; // 顶点瞬间
const LINGSHU_HOP_DUST_COUNT = 3;
const LINGSHU_IDLE_SIT_LIFT = 0.02; // "sits taller"——静止时躯干略微抬高
const LINGSHU_EAR_BREATH_FREQ_HZ = 0.9;
const LINGSHU_EAR_BREATH_AMP = 0.04;

// ---- 潭狩·低伏潜行 ----
const TANSHOU_CROUCH_OFFSET = -0.04; // baseY −8%（CAPSULE_BODY.tanshou.radius=0.5 的 8%）——"灵体"半陷地面的刻意风格化，见 buildTanshouModel 头部注释
const TANSHOU_SWAY_FREQ_HZ = 0.8;
const TANSHOU_SWAY_AMP = 0.03;
const TANSHOU_INK_RATE_HZ = 2; // 2/s，狩猎中 ×2
// "狩猎"在客户端无法读到 aiState（sim-agnostic），用速度阈值当代理——tanshou.walkSpeed=5.2，
// 巡逻/绕后很少长时间跑到这么快，追猎才会持续贴着上限跑，见 brief 原话"use speedHint >
// walkSpeed threshold as proxy"。刻意写成本地字面量而不是 import @shiling/content 的
// SPECIES.tanshou.walkSpeed——这个模块的既有边界是不认识 sim/content 的具体数值契约，
// 只认识"某个速度阈值"这个抽象，与下方 buildTanshouModel 的眼睛脉冲共用同一个常量。
const TANSHOU_HUNT_SPEED_PROXY = 4.6;
const TANSHOU_INK_REAR_OFFSET_Z = 0.9; // 尾迹喷出点——躯干后方

/**
 * 潭狩"是否在狩猎"的唯一判据入口——createLivingAnimate 的尾迹 ×2 分支与
 * buildTanshouModel 的眼睛脉冲各自要用同一个布尔量，抽成一个函数而不是各自重复
 * `ctx.speedHint > TANSHOU_HUNT_SPEED_PROXY` 字面表达式，未来调阈值只需改这一处。
 */
function isTanshouHunting(ctx: AnimateCtx): boolean {
  return ctx.activity === "moving" && ctx.speedHint > TANSHOU_HUNT_SPEED_PROXY;
}
const TANSHOU_EYE_PULSE_FREQ_HZ = 3;

// ---- 幼兽·小跑 ----
const YOUSHOU_LEAN_MAX_RAD = 0.06; // 冲刺时的最大前倾
const YOUSHOU_SPRINT_SPEED_PROXY = 6; // m/s——walkSpeed(4.5)×sprintMultiplier(1.85)≈8.3 的保守下界代理，AnimateCtx 不携带真实 sprint 布尔量（同 tanshou 狩猎 proxy 同一惯例）
const YOUSHOU_SPRINT_DUST_COUNT = 3;

// ---- 溪鱼·游曳 ----
const XIYU_ROLL_AMP = 0.15;
const XIYU_ROLL_BASE_FREQ_HZ = 1.2;
const XIYU_DART_STRETCH = 1.15;
const XIYU_DART_DURATION_SEC = 0.25;
const XIYU_DART_PERIOD_SEC = 5; // 平均每 ~5s 一次冲刺
const XIYU_BUBBLE_RATE_HZ = 2;

// ---- 穴獾·拱地/遁地 ----
const XUEHUAN_WADDLE_AMP = 0.08;
const XUEHUAN_WADDLE_FREQ_HZ = 3;
const XUEHUAN_CHANNEL_SHAKE_AMP = 0.05;
const XUEHUAN_CHANNEL_SHAKE_FREQ_HZ = 18;
const XUEHUAN_CHANNEL_DUST_RATE_HZ = 3.5; // "heavy dust burst"——比苓鼠落地噗尘密得多的持续喷发
const XUEHUAN_CHANNEL_DUST_COUNT = 10;

/** 通用 clamp——多个物种的速度→周期/振幅换算都要用。 */
function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * Shared `animate` implementation for every living species (youshou/lingshu/
 * tanshou/xiyu/xuehuan): the attack-lunge spring / eating head-nod / tail-wag
 * formulas below are identical across every species that has the relevant
 * part, so they stay unconditional; the *locomotion* block (bob/roll/scale,
 * M2 A1's per-species profiles) is the one part that now branches on
 * `species` — see the per-species case bodies below for each profile's own
 * reasoning (mirrors the constants block immediately above this function).
 *
 * Baseline `body` rotation/scale are captured once here — called as the last
 * step of each builder, after that builder has finished orienting `body`
 * (e.g. `rotation.x = Math.PI/2` to swing the capsule's long axis onto +Z) —
 * so every per-frame write is `baseline + offset`, never a bare overwrite:
 * overwriting absolutely would erase that baked orientation the instant
 * locomotion isn't "swim" (rotation.x) or activity isn't idle/eating
 * (scale.y).
 *
 * Attack-spring state (`attackPitch`), `lastTSec` (for frameDt), and every
 * species-specific phase/throttle accumulator (hop phase, ink-trail/bubble
 * emission accumulators, dart timers, ...) live in this closure, one instance
 * per model — creatureView no longer writes `group.rotation.x` itself (Task 4
 * moved 100% ownership here), so there is nothing to read back off the
 * object; each spring/phase's "current value" has to be remembered somewhere,
 * and a closure variable scoped to this one model instance is the simplest
 * place (consistent with the original attackPitch/lastTSec precedent).
 */
function createLivingAnimate(
  group: THREE.Group,
  parts: { head?: THREE.Object3D; tail?: THREE.Object3D; body: THREE.Object3D },
  species: string,
): CreatureModel["animate"] {
  const { body, head, tail } = parts;
  const baseBodyRotX = body.rotation.x;
  const baseBodyRotZ = body.rotation.z;
  const baseBodyScaleY = body.scale.y;

  let attackPitch = 0;
  let lastTSec: number | null = null;

  // 每个物种分支只会用到下面这批闭包状态里的一部分，其余物种恒不触碰——与
  // fleeTime/hiddenTicks 等"通用字段，只有部分角色真正用到"的 sim 侧既有惯例同构。
  let lingshuPrevPhase = 0;
  let inkAccumSec = 0;
  let bubbleAccumSec = 0;
  let xiyuDartRemainingSec = 0;
  let xiyuDartTimerSec = Math.random() * XIYU_DART_PERIOD_SEC; // 随机初始相位，避免全体溪鱼同步冲刺
  let channelDustAccumSec = 0;

  return (ctx: AnimateCtx) => {
    // First call has no prior sample to diff against — 0 keeps every spring/
    // accumulator below from jumping on the very first frame instead of
    // racing/over-accumulating using a bogus (huge, or negative on a clock
    // hiccup) dt.
    const frameDt = lastTSec === null ? 0 : Math.max(0, ctx.tSec - lastTSec);
    lastTSec = ctx.tSec;

    const swimming = ctx.locomotion === "swim";
    const moving = ctx.activity === "moving";
    let forwardLean = 0; // 只有幼兽冲刺时非零——见下方 youshou 分支；与 attackPitch 相加而非互斥覆盖。

    switch (species) {
      case "lingshu": {
        body.rotation.z = baseBodyRotZ; // 苓鼠不用同频微滚（跳跃本身已经是垂直方向的强读法）——显式重置，不依赖"反正没人写它"，同 tanshou 分支同一惯例。
        if (moving && ctx.speedHint > 0.01) {
          const period = clamp(LINGSHU_HOP_PERIOD_SPEED_FACTOR / ctx.speedHint, LINGSHU_HOP_PERIOD_MIN, LINGSHU_HOP_PERIOD_MAX);
          const phase = (((ctx.tSec / period) % 1) + 1) % 1; // 0..1，落地=0/1，顶点=0.5
          const arc = Math.sin(phase * Math.PI); // 0 落地 → 1 顶点 → 0 落地
          // += ：与 CreatureModel.animate 文档同一前提——这一帧刚被 applyInterp 写过一次 position.y。
          group.position.y += arc * LINGSHU_HOP_HEIGHT;
          body.scale.y = baseBodyScaleY * (LINGSHU_SQUASH_AT_LAND + (LINGSHU_STRETCH_AT_APEX - LINGSHU_SQUASH_AT_LAND) * arc);
          if (phase < lingshuPrevPhase) {
            // phase 从接近 1 绕回接近 0——这一帧刚发生了一次落地。
            creatureFx.dust(group.position.x, group.position.y, group.position.z, LINGSHU_HOP_DUST_COUNT);
            creatureFx.hopTick();
          }
          lingshuPrevPhase = phase;
        } else {
          lingshuPrevPhase = 0; // 停止移动后清零相位，下次起跳从落地姿态重新开始，不残留上次的跳跃相位
          group.position.y += LINGSHU_IDLE_SIT_LIFT; // "sits taller"
          body.scale.y = baseBodyScaleY + Math.sin(ctx.tSec * 2.2) * 0.02; // 保留原有的静止呼吸
          if (head) head.scale.setScalar(1 + Math.sin(ctx.tSec * LINGSHU_EAR_BREATH_FREQ_HZ * Math.PI * 2) * LINGSHU_EAR_BREATH_AMP);
        }
        break;
      }
      case "tanshou": {
        group.position.y += TANSHOU_CROUCH_OFFSET; // 低伏——"灵体"半陷地面的刻意风格化
        body.rotation.y = Math.sin(ctx.tSec * TANSHOU_SWAY_FREQ_HZ * Math.PI * 2) * TANSHOU_SWAY_AMP; // 叠在 yaw 之上的蛇行摆荡（body 是 group 的子节点，不影响真实行进方向）
        body.rotation.z = baseBodyRotZ; // 潭狩不用同频微滚（低伏体型本就贴地，滚动读法不适用）
        if (moving) {
          inkAccumSec += frameDt * (isTanshouHunting(ctx) ? 2 : 1);
          const inkInterval = 1 / TANSHOU_INK_RATE_HZ;
          while (inkAccumSec >= inkInterval) {
            inkAccumSec -= inkInterval;
            const yaw = group.rotation.y;
            creatureFx.inkSmoke(
              group.position.x - Math.sin(yaw) * TANSHOU_INK_REAR_OFFSET_Z,
              group.position.y + 0.15,
              group.position.z - Math.cos(yaw) * TANSHOU_INK_REAR_OFFSET_Z,
            );
          }
        } else {
          inkAccumSec = 0;
        }
        break;
      }
      case "youshou": {
        const bobFreq = 4 + ctx.speedHint * 2;
        // 游泳时振幅减半——沿用 M0.5 Task 4 的原始行为（水中不该有陆地小跑那么大的起伏）。
        const bobAmp = Math.min(0.08, ctx.speedHint * 0.02) * (swimming ? 0.5 : 1);
        group.position.y += Math.abs(Math.sin(ctx.tSec * bobFreq)) * bobAmp;
        body.rotation.z = baseBodyRotZ + Math.sin(ctx.tSec * bobFreq) * 0.04;
        const sprinting = ctx.speedHint > YOUSHOU_SPRINT_SPEED_PROXY;
        forwardLean = clamp(ctx.speedHint / YOUSHOU_SPRINT_SPEED_PROXY, 0, 1) * YOUSHOU_LEAN_MAX_RAD;
        if (sprinting) {
          // 落地尘：复用同一个 bob 相位，在其谷底（sin≈0，且刚从正值转过来）触发一次——
          // 与苓鼠跳跃的"phase 绕回"判据同一手法，只是这里判的是 |sin| 的谷底穿越。
          const bobPhase = Math.abs(Math.sin(ctx.tSec * bobFreq));
          const prevBobPhase = Math.abs(Math.sin((ctx.tSec - Math.max(frameDt, 1e-4)) * bobFreq));
          if (bobPhase < 0.05 && prevBobPhase >= 0.05) {
            creatureFx.dust(group.position.x, group.position.y, group.position.z, YOUSHOU_SPRINT_DUST_COUNT);
          }
        }
        break;
      }
      case "xiyu": {
        body.rotation.z = baseBodyRotZ + Math.sin(ctx.tSec * (XIYU_ROLL_BASE_FREQ_HZ + ctx.speedHint * 0.3)) * XIYU_ROLL_AMP;
        if (xiyuDartRemainingSec > 0) {
          xiyuDartRemainingSec = Math.max(0, xiyuDartRemainingSec - frameDt);
          const t = xiyuDartRemainingSec / XIYU_DART_DURATION_SEC; // 1→0
          body.scale.z = 1 + (XIYU_DART_STRETCH - 1) * Math.sin(t * Math.PI); // 冲入/冲出都平滑，不是硬切
        } else {
          body.scale.z = 1;
          xiyuDartTimerSec -= frameDt;
          if (xiyuDartTimerSec <= 0) {
            xiyuDartTimerSec = XIYU_DART_PERIOD_SEC * (0.7 + Math.random() * 0.6); // 带随机抖动的周期，不是严格等间隔
            xiyuDartRemainingSec = XIYU_DART_DURATION_SEC;
          }
        }
        if (moving || swimming) {
          bubbleAccumSec += frameDt;
          const bubbleInterval = 1 / XIYU_BUBBLE_RATE_HZ;
          while (bubbleAccumSec >= bubbleInterval) {
            bubbleAccumSec -= bubbleInterval;
            creatureFx.bubble(group.position.x, group.position.y + 0.1, group.position.z);
          }
        } else {
          bubbleAccumSec = 0;
        }
        break;
      }
      case "xuehuan": {
        const channeling = ctx.activity === "digging"; // 遁地 channel——见 ai.ts tickBurrowEvader，非玩家专属的同一 activity 字面量
        if (channeling) {
          body.rotation.z = baseBodyRotZ + Math.sin(ctx.tSec * XUEHUAN_CHANNEL_SHAKE_FREQ_HZ) * XUEHUAN_CHANNEL_SHAKE_AMP;
          body.rotation.x = baseBodyRotX + Math.cos(ctx.tSec * XUEHUAN_CHANNEL_SHAKE_FREQ_HZ * 1.3) * XUEHUAN_CHANNEL_SHAKE_AMP * 0.6;
          channelDustAccumSec += frameDt;
          const dustInterval = 1 / XUEHUAN_CHANNEL_DUST_RATE_HZ;
          while (channelDustAccumSec >= dustInterval) {
            channelDustAccumSec -= dustInterval;
            creatureFx.dust(group.position.x, group.position.y, group.position.z, XUEHUAN_CHANNEL_DUST_COUNT);
          }
        } else {
          channelDustAccumSec = 0;
          body.rotation.x = baseBodyRotX;
          body.rotation.z = baseBodyRotZ + Math.sin(ctx.tSec * (XUEHUAN_WADDLE_FREQ_HZ + ctx.speedHint * 0.5)) * XUEHUAN_WADDLE_AMP;
        }
        break;
      }
      default: {
        // 防御性兜底（理论上不会命中——buildCreatureModel 的 5 个 case 已经穷尽当前
        // 全部物种）：保留 M0.5 Task 4 原始的通用 bob/roll 公式，不静默地什么都不画。
        const bobFreq = 4 + ctx.speedHint * 2;
        const bobAmp = Math.min(0.08, ctx.speedHint * 0.02) * (swimming ? 0.5 : 1);
        group.position.y += Math.abs(Math.sin(ctx.tSec * bobFreq)) * bobAmp;
        body.rotation.z = baseBodyRotZ + Math.sin(ctx.tSec * bobFreq) * 0.04;
      }
    }

    body.scale.y =
      species === "lingshu"
        ? body.scale.y // 苓鼠已经在上面的分支里把 scale.y 设成了 squash-stretch/静止呼吸，这里不再覆盖
        : ctx.activity === "idle" || ctx.activity === "eating"
          ? baseBodyScaleY + Math.sin(ctx.tSec * 2.2) * 0.02
          : baseBodyScaleY;

    body.rotation.x = species === "xuehuan" ? body.rotation.x : baseBodyRotX + (swimming ? Math.sin(ctx.tSec * 3) * 0.08 : 0);

    // Spring always runs (target flips 0.35↔0 on the activity edge) so the
    // lunge eases back out on exit instead of snapping — not gated to only
    // execute "while attacking". forwardLean (幼兽冲刺前倾) adds on top rather
    // than replacing it — the two are independent cosmetic offsets on the same axis.
    const targetPitch = ctx.activity === "attacking" ? 0.35 : 0;
    attackPitch += (targetPitch - attackPitch) * Math.min(1, 10 * frameDt);
    group.rotation.x = attackPitch + forwardLean;

    if (head) {
      head.rotation.x = ctx.activity === "eating" ? 0.4 + Math.sin(ctx.tSec * 5) * 0.15 : 0;
    }
    if (tail) {
      // 尾摆频率随速度线性增长（原有行为不变）；幅度也随速度线性增长再封顶
      // （M2 A1 修正——原实现只让频率跟速度走，幅度是写死的常数，不满足"tail wag
      // amplitude scales with speed"这条要求）。
      const wagAmp = Math.min(0.45, 0.2 + ctx.speedHint * 0.04);
      tail.rotation.y = Math.sin(ctx.tSec * (2 + ctx.speedHint * 3)) * wagAmp;
    }
  };
}

const OUTLINE_SCALE = 1.06;

// ---------------------------------------------------------------------------
// Ground-contact blob shadow (Patch 3b, playtest feedback: 生物悬浮感)
// ---------------------------------------------------------------------------

const SHADOW_COLOR = 0x000000;
const SHADOW_OPACITY = 0.28;
const SHADOW_Y = 0.02;
const SHADOW_RADIUS_FACTOR = 0.55; // ≈0.55× body length, per spec
const SHADOW_SEGMENTS = 20;

/**
 * A flat CircleGeometry disc laid at `group`'s local y=0.02, added *directly*
 * to `group` (never through `attach()`) so it (a) moves with the creature
 * for free via the scene graph, (b) is excluded from ink-outline generation
 * (only `attach()` calls `addOutline`), and (c) — for carcasses — stays flat
 * on the ground undisturbed by the `tilt` child wrapper's rotation (see
 * buildCarcassModel: the shadow is added to `group`, not `tilt`).
 * `polygonOffset` guards against z-fighting with the terrain mesh directly
 * underneath (the disc sits only 0.02 above whatever height sim placed the
 * creature at, which is itself sampled from the same terrain).
 */
function buildGroundShadow(radius: number): THREE.Mesh {
  const geometry = new THREE.CircleGeometry(radius, SHADOW_SEGMENTS);
  geometry.rotateX(-Math.PI / 2); // native normal +Z → +Y, lies flat
  const material = new THREE.MeshBasicMaterial({
    color: SHADOW_COLOR,
    transparent: true,
    opacity: SHADOW_OPACITY,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = SHADOW_Y;
  return mesh;
}

/**
 * Nose-to-tail-tip torso length (full extent along the model's forward axis:
 * capsule length + both end-cap radii for youshou/tanshou, sphere diameter
 * scaled for lingshu) — the same "shared constant" shadowRadiusFor below
 * multiplies by SHADOW_RADIUS_FACTOR. Exported so modelLibrary.ts (Postfix 7,
 * Meshy GLB swap) has one source of truth for the target size each raw GLB
 * gets uniformly rescaled to, instead of a second hand-copied literal that
 * could silently drift from CAPSULE_BODY/LINGSHU_BODY.
 */
export function bodyFootprintLength(species: string): number {
  switch (species) {
    case "youshou":
      return CAPSULE_BODY.youshou.length + 2 * CAPSULE_BODY.youshou.radius;
    case "tanshou":
      return CAPSULE_BODY.tanshou.length + 2 * CAPSULE_BODY.tanshou.radius;
    case "xiyu":
      // M1 B4：plan 原话"鱼 ≈0.7"——XIYU_BODY 的 radius/scale.z 就是照这个目标反推的
      // （0.15 × 2 × 2.333 ≈ 0.7），后续调整体型时同步改那两个常量，不要在这里另开一个
      // 手写的重复数字。
      return 2 * XIYU_BODY.radius * XIYU_BODY.scale[2];
    case "xuehuan":
      // M1 B4：plan 原话"獾 ≈1.1"——XUEHUAN_BODY.length 就是这个目标本身（box 几何体
      // 天生沿 Z 轴的边长，不需要像胶囊/球那样再乘 2×radius 换算）。
      return XUEHUAN_BODY.length;
    default:
      // lingshu + defensive fallback, mirrors carcassShape's own default branch.
      return 2 * LINGSHU_BODY.radius * LINGSHU_BODY.scale[2];
  }
}

/**
 * Per-species shadow radius, derived from the same body-shape constants the
 * living models below build their capsule/sphere geometry from (never a
 * hardcoded duplicate) — so a future tweak to CAPSULE_BODY/LINGSHU_BODY can't
 * silently desync the shadow's size from the silhouette it's meant to ground.
 * Shared by both the living builders and buildCarcassModel (a carcass reuses
 * the same underlying body shape — see carcassShape above) — and, as of
 * Postfix 7, by the GLB variants too (bodyFootprintLength is species-shape
 * agnostic either way).
 */
function shadowRadiusFor(species: string): number {
  return SHADOW_RADIUS_FACTOR * bodyFootprintLength(species);
}

interface MeshOpts {
  /** MeshBasicMaterial instead of MeshLambertMaterial — unlit, self-illuminated look (tanshou's eyes). */
  basic?: boolean;
}

/** Builds a mesh with the given geometry/palette color. Set position/rotation/scale on the result before calling attach(). */
function makeMesh(geometry: THREE.BufferGeometry, color: number, opts: MeshOpts = {}): THREE.Mesh {
  const material = opts.basic
    ? new THREE.MeshBasicMaterial({ color })
    : new THREE.MeshLambertMaterial({ color });
  return new THREE.Mesh(geometry, material);
}

/**
 * Clones `mesh`'s geometry into an inverted-hull ink outline (BackSide,
 * 1.06x) and parents it as a *child* of `mesh` (local identity transform,
 * scale 1.06) rather than a value-copied sibling: a child inherits `mesh`'s
 * transform through the scene graph every frame for free, so Task 4's
 * planned per-part animation (rotating/scaling `parts.body` etc. directly)
 * drags the outline along automatically instead of leaving it behind.
 */
function addOutline(mesh: THREE.Mesh): void {
  const outline = new THREE.Mesh(
    mesh.geometry.clone(),
    new THREE.MeshBasicMaterial({ color: PALETTE.outlineInk, side: THREE.BackSide }),
  );
  outline.scale.setScalar(OUTLINE_SCALE);
  mesh.add(outline);
}

/** Adds `mesh` to `parent` plus (unless suppressed) its ink outline child. */
function attach(parent: THREE.Object3D, mesh: THREE.Mesh, withOutline = true): THREE.Mesh {
  parent.add(mesh);
  if (withOutline) addOutline(mesh);
  return mesh;
}

/** A positioned, empty anchor — used both as a GLB-swap mount and as the parent for the part's own meshes. */
function makeMount(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Group {
  const anchor = new THREE.Group();
  anchor.position.set(x, y, z);
  parent.add(anchor);
  return anchor;
}

/** Frees one mesh's own geometry/material (array-aware, matching Mesh.material's union type) — the single-mesh building block disposeTree below traverses with, and the GLB builders' dispose() (Postfix 7) call directly on just their per-instance blob shadow. */
function disposeMesh(mesh: THREE.Mesh): void {
  mesh.geometry.dispose();
  const material = mesh.material;
  if (Array.isArray(material)) material.forEach((m) => m.dispose());
  else material.dispose();
}

/** Frees every geometry/material under `root` (outlines included — traverse() walks the whole subtree regardless of nesting depth). */
function disposeTree(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) disposeMesh(obj);
  });
}

// ---------------------------------------------------------------------------
// Living models
// ---------------------------------------------------------------------------

/**
 * Capsule-body proportions, shared between each species' living model and
 * its carcass (buildCarcassModel deliberately reuses these dimensions in
 * their native, un-rotated orientation — see its doc comment for why).
 * Keeping them here instead of duplicated literals means a future tweak to
 * one living body's size can't silently desync its corpse's silhouette.
 */
const CAPSULE_BODY = {
  youshou: { radius: 0.42, length: 0.7 },
  tanshou: { radius: 0.5, length: 1.4 },
} as const;

function capsuleBodyGeometry(shape: (typeof CAPSULE_BODY)[keyof typeof CAPSULE_BODY]): THREE.BufferGeometry {
  return new THREE.CapsuleGeometry(shape.radius, shape.length, 6, 12);
}

/** 幼兽 youshou (also the player creature — species "youshou" already implies this look, no by-id branch needed). */
function buildYoushouModel(): CreatureModel {
  const group = new THREE.Group();
  const BODY_Y = CAPSULE_BODY.youshou.radius; // underside rests on the ground

  const body = makeMesh(capsuleBodyGeometry(CAPSULE_BODY.youshou), PALETTE.playerBody);
  // Capsule's native long axis is Y (vertical). Rotating +90° about X swings
  // it onto Z (forward) — not the brief's literal rotation.z, which would
  // instead swing it onto X (sideways) and violate the +Z-forward contract above.
  body.rotation.x = Math.PI / 2;
  body.position.set(0, BODY_Y, 0);
  attach(group, body);

  const BELLY_RADIUS = 0.3;
  const belly = makeMesh(new THREE.CapsuleGeometry(BELLY_RADIUS, 0.45, 6, 12), PALETTE.playerBelly);
  belly.rotation.x = Math.PI / 2;
  // Widened sideways (scale.x only — rotation.x=90° leaves the local X axis
  // untouched, so this is a pure world-X stretch, not a vertical one) so it
  // still peeks out past the main body's circular cross-section at this
  // height instead of being fully swallowed by it. position.y = BELLY_RADIUS
  // (not BODY_Y - 0.22, which sank its underside 0.1 below the shared ground
  // plane) so its own underside rests exactly on the ground like the main body.
  belly.scale.x = 1.3;
  belly.position.set(0, BELLY_RADIUS, 0.1);
  attach(group, belly);

  const headMount = makeMount(group, 0, BODY_Y + 0.18, 0.85);
  const head = makeMesh(new THREE.SphereGeometry(0.3, 16, 12), PALETTE.playerBody);
  attach(headMount, head);

  const earL = makeMesh(new THREE.ConeGeometry(0.1, 0.22, 10), PALETTE.playerBody);
  earL.position.set(-0.16, 0.24, -0.05);
  earL.rotation.z = 0.35;
  attach(headMount, earL);
  const earR = makeMesh(new THREE.ConeGeometry(0.1, 0.22, 10), PALETTE.playerBody);
  earR.position.set(0.16, 0.24, -0.05);
  earR.rotation.z = -0.35;
  attach(headMount, earR);

  const tailMount = makeMount(group, 0, BODY_Y + 0.05, -0.85);
  const tail = makeMesh(new THREE.CylinderGeometry(0.05, 0.02, 0.5, 8), PALETTE.playerBody);
  tail.rotation.x = -1.3; // rear-and-up flick ("微翘")
  tail.position.set(0, 0.1, -0.14);
  attach(tailMount, tail);

  // M2 A1：颌部挂点——撕咬墨斩弧的锚点（见 wrapYoushouExtras），略靠前于头部中心。
  // 只是一个空 anchor（不建任何几何体），与 head/tail 两个既有 mount 同一惯例。
  const jawMount = makeMount(group, 0, BODY_Y + 0.05, 1.05);

  group.add(buildGroundShadow(shadowRadiusFor("youshou")));

  const parts = { head: headMount, tail: tailMount, body };
  return {
    group,
    mounts: { head: headMount, tail: tailMount, jaw: jawMount },
    parts,
    animate: createLivingAnimate(group, parts, "youshou"),
    dispose: () => disposeTree(group),
  };
}

/**
 * A near-flat "puck": reads as a big ear disc but, unlike CircleGeometry
 * (brief's literal spec), is a genuine closed volume with front/back faces
 * and a thin rim. CircleGeometry is a single-sided infinitely-thin plane —
 * its inverted-hull outline clone would be exactly coincident with it (scale
 * only grows the in-plane radius, never the zero depth), so the two z-fight
 * across the whole disc instead of producing a rim. rotateX swings the
 * puck's native cap-normal from local Y onto Z, so it drops into the same
 * rotation.y-swings-the-normal-sideways placement code a CircleGeometry
 * would have used.
 */
function earPuckGeometry(radius: number): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(radius, radius, radius * 0.25, 16);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

/** Sphere-body proportions for lingshu, shared with its carcass shape for the same desync-proofing reason as CAPSULE_BODY above. */
const LINGSHU_BODY = { radius: 0.32, scale: [1, 0.8, 1.2] as const };

function lingshuBodyGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(LINGSHU_BODY.radius, 16, 12);
  geometry.scale(...LINGSHU_BODY.scale);
  return geometry;
}

/** 苓鼠 lingshu — small flattened prey, big ear discs. */
function buildLingshuModel(): CreatureModel {
  const group = new THREE.Group();
  const BODY_Y = LINGSHU_BODY.radius * LINGSHU_BODY.scale[1]; // underside rests on the ground

  const body = makeMesh(lingshuBodyGeometry(), PALETTE.lingshuBody);
  body.position.set(0, BODY_Y, 0);
  attach(group, body);

  const headMount = makeMount(group, 0, BODY_Y + 0.06, 0.42);
  const head = makeMesh(new THREE.SphereGeometry(0.16, 12, 10), PALETTE.lingshuBody);
  attach(headMount, head);

  // Puck's face normal is local +Z; rotation.y swings that normal out to ±X
  // so the disc reads edge-on as a big ear sticking out sideways, not as a
  // flat coin glued to the front of the head.
  const earL = makeMesh(earPuckGeometry(0.12), PALETTE.lingshuEar);
  earL.position.set(-0.16, 0.16, 0.02);
  earL.rotation.y = Math.PI / 2.4;
  attach(headMount, earL);
  const earR = makeMesh(earPuckGeometry(0.12), PALETTE.lingshuEar);
  earR.position.set(0.16, 0.16, 0.02);
  earR.rotation.y = -Math.PI / 2.4;
  attach(headMount, earR);

  const tailMount = makeMount(group, 0, BODY_Y, -0.36);
  const tail = makeMesh(new THREE.CylinderGeometry(0.025, 0.015, 0.22, 8), PALETTE.lingshuBody);
  tail.rotation.x = -Math.PI / 2 + 0.2;
  tail.position.set(0, 0, -0.08);
  attach(tailMount, tail);

  group.add(buildGroundShadow(shadowRadiusFor("lingshu")));

  const parts = { head: headMount, tail: tailMount, body };
  return {
    group,
    mounts: { head: headMount, tail: tailMount },
    parts,
    animate: createLivingAnimate(group, parts, "lingshu"),
    dispose: () => disposeTree(group),
  };
}

/** 潭狩 tanshou — long low predator, box head, glowing threat-read eyes, back spikes. */
function buildTanshouModel(): CreatureModel {
  const group = new THREE.Group();
  // Underside rests on the ground (not sunk below it — the "低伏"/crouched
  // read comes from the capsule's large radius and long, low silhouette,
  // not from embedding the body in the terrain, which the model has no
  // legs to visually bridge).
  const BODY_Y = CAPSULE_BODY.tanshou.radius;

  const body = makeMesh(capsuleBodyGeometry(CAPSULE_BODY.tanshou), PALETTE.tanshouBody);
  body.rotation.x = Math.PI / 2; // see youshou's body comment for why X (not the brief's literal Z)
  body.position.set(0, BODY_Y, 0);
  attach(group, body);

  const headMount = makeMount(group, 0, BODY_Y + 0.05, 1.35);
  const head = makeMesh(new THREE.BoxGeometry(0.55, 0.4, 0.7), PALETTE.tanshouHead);
  attach(headMount, head);

  // Eyes: unlit MeshBasicMaterial reads as a glow regardless of scene
  // lighting, the "threat you can spot in the dark" cue from the brief.
  const eyeL = makeMesh(new THREE.SphereGeometry(0.05, 8, 6), PALETTE.tanshouEye, { basic: true });
  eyeL.position.set(-0.15, 0.08, 0.3);
  attach(headMount, eyeL);
  const eyeR = makeMesh(new THREE.SphereGeometry(0.05, 8, 6), PALETTE.tanshouEye, { basic: true });
  eyeR.position.set(0.15, 0.08, 0.3);
  attach(headMount, eyeR);

  const backMount = makeMount(group, 0, BODY_Y + 0.5, 0);
  for (const z of [0.35, 0, -0.35]) {
    const spike = makeMesh(new THREE.ConeGeometry(0.08, 0.2, 10), PALETTE.tanshouBody);
    spike.position.set(0, 0.1, z);
    attach(backMount, spike);
  }

  const tailMount = makeMount(group, 0, BODY_Y + 0.05, -1.2);
  const tail = makeMesh(new THREE.CylinderGeometry(0.07, 0.03, 0.9, 10), PALETTE.tanshouBody);
  tail.rotation.x = -Math.PI / 2 + 0.1; // trails low and mostly straight back
  tail.position.set(0, 0, -0.4);
  attach(tailMount, tail);

  group.add(buildGroundShadow(shadowRadiusFor("tanshou")));

  const parts = { head: headMount, tail: tailMount, body };
  const baseAnimate = createLivingAnimate(group, parts, "tanshou");

  // M2 A1：狩猎中眼睛脉冲更亮——直接引用 eyeL/eyeR 材质本身的 THREE.Color 实例，
  // 逐帧 lerp 回基色再往白色推一截，从不新建 Color/克隆材质（零分配）。只有 GLB
  // 变体没有这两枚独立网格可以调（见 buildGlbCreatureModel 头部注释同一类"降级但
  // 不崩"取舍），procedural fallback 专属加成。
  const eyeLMat = eyeL.material as THREE.MeshBasicMaterial;
  const eyeRMat = eyeR.material as THREE.MeshBasicMaterial;
  const eyeBaseColor = eyeLMat.color.clone(); // eyeL/eyeR 用同一个 PALETTE 常量建材质，基色相同
  const eyeBrightColor = new THREE.Color(0xffffff);
  function animate(ctx: AnimateCtx): void {
    baseAnimate(ctx);
    const pulse = isTanshouHunting(ctx) ? 0.4 + 0.3 * Math.sin(ctx.tSec * TANSHOU_EYE_PULSE_FREQ_HZ * Math.PI * 2) : 0;
    eyeLMat.color.copy(eyeBaseColor).lerp(eyeBrightColor, pulse);
    eyeRMat.color.copy(eyeBaseColor).lerp(eyeBrightColor, pulse);
  }

  return {
    group,
    mounts: { head: headMount, tail: tailMount, back: backMount },
    parts,
    animate,
    dispose: () => disposeTree(group),
  };
}

/**
 * 溪鱼 xiyu 的拉长椭球体形——SphereGeometry 沿 Z 轴（前进方向）拉长、Y 轴压扁，与
 * lingshuBodyGeometry 同一"球体 scale 出椭球"手法，不需要像胶囊那样额外 rotation.x
 * （球体本身各向同性，scale 直接作用在世界轴上，不存在"原生长轴在哪个方向"的问题）。
 * radius/scale.z 是照 plan 原话"鱼 ≈0.7"反推的常量——见 bodyFootprintLength 的引用注释。
 */
const XIYU_BODY = { radius: 0.15, scale: [1, 0.7, 2.333] as const };

function xiyuBodyGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(XIYU_BODY.radius, 14, 10);
  geometry.scale(...XIYU_BODY.scale);
  return geometry;
}

/**
 * 溪鱼 xiyu 程序化 fallback：拉长椭球身 + 尾鳍片（GLB 到位前后都能玩，见 modelLibrary.ts
 * 头部注释）。尾鳍用极薄 BoxGeometry 而不是零厚度的 PlaneGeometry——同 earPuckGeometry
 * 头部注释指出的坑：单面薄片的描边克隆与本体完全重合，会 z-fight 而不是形成一圈轮廓线，
 * BoxGeometry 给一点真实厚度就能规避（读起来仍然是"一片鱼鳍"，只是不是数学意义上的零厚度平面）。
 */
function buildXiyuModel(): CreatureModel {
  const group = new THREE.Group();
  const BODY_Y = XIYU_BODY.radius * XIYU_BODY.scale[1]; // 沿用统一约定：group 原点在"脚下"（水生生物这里读作"腹部贴水面高度"）

  const body = makeMesh(xiyuBodyGeometry(), PALETTE.xiyuBody);
  body.position.set(0, BODY_Y, 0);
  attach(group, body);

  const halfLength = XIYU_BODY.radius * XIYU_BODY.scale[2];
  const headMount = makeMount(group, 0, BODY_Y, halfLength * 0.85);
  const head = makeMesh(new THREE.SphereGeometry(XIYU_BODY.radius * 0.55, 10, 8), PALETTE.xiyuBody);
  attach(headMount, head);

  const tailMount = makeMount(group, 0, BODY_Y, -halfLength);
  const tailFin = makeMesh(new THREE.BoxGeometry(0.02, 0.22, 0.26), PALETTE.xiyuFin);
  tailFin.position.set(0, 0, -0.1);
  attach(tailMount, tailFin);

  group.add(buildGroundShadow(shadowRadiusFor("xiyu")));

  const parts = { head: headMount, tail: tailMount, body };
  return {
    group,
    mounts: { head: headMount, tail: tailMount },
    parts,
    animate: createLivingAnimate(group, parts, "xiyu"),
    dispose: () => disposeTree(group),
  };
}

/**
 * 穴獾 xuehuan 的矮胖箱体形——plan 原话"squat box"，length 是照"獾 ≈1.1"反推的常量，
 * 见 bodyFootprintLength 的引用注释。
 */
const XUEHUAN_BODY = { width: 0.55, height: 0.42, length: 1.1 };

function xuehuanBodyGeometry(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(XUEHUAN_BODY.width, XUEHUAN_BODY.height, XUEHUAN_BODY.length);
}

/**
 * 穴獾 xuehuan 程序化 fallback：矮胖箱身 + 前爪掘爪锥×2（plan 原话"squat box + claw
 * cones"）。刻意不建 tail 挂点——真实獾类尾巴本就短到几乎看不出来，"矮胖"的读法里
 * 没有尾巴反而更贴切；createLivingAnimate 对 `parts.tail` 是可选链读取（tail?:），
 * 缺省时优雅 no-op，不需要专门传一个空占位对象。
 */
function buildXuehuanModel(): CreatureModel {
  const group = new THREE.Group();
  const BODY_Y = XUEHUAN_BODY.height / 2;

  const body = makeMesh(xuehuanBodyGeometry(), PALETTE.xuehuanBody);
  body.position.set(0, BODY_Y, 0);
  attach(group, body);

  const headMount = makeMount(group, 0, BODY_Y + 0.02, XUEHUAN_BODY.length / 2 + 0.15);
  const head = makeMesh(new THREE.BoxGeometry(0.4, 0.32, 0.32), PALETTE.xuehuanBody);
  attach(headMount, head);

  // 前爪掘爪：两个朝前下方的爪锥，颜色更深（xuehuanClaw）读出"爪"与"皮毛"的材质区分
  // ——同 tanshou 背棘那三枚 spike 用独立 PALETTE 色的既有惯例。
  for (const x of [-0.16, 0.16]) {
    const claw = makeMesh(new THREE.ConeGeometry(0.07, 0.22, 8), PALETTE.xuehuanClaw);
    claw.position.set(x, BODY_Y - 0.14, XUEHUAN_BODY.length / 2 + 0.05);
    claw.rotation.x = Math.PI / 2.3; // 朝前下方，挖地姿态
    attach(group, claw);
  }

  group.add(buildGroundShadow(shadowRadiusFor("xuehuan")));

  const parts = { head: headMount, body };
  return {
    group,
    mounts: { head: headMount },
    parts,
    animate: createLivingAnimate(group, parts, "xuehuan"),
    dispose: () => disposeTree(group),
  };
}

// ---------------------------------------------------------------------------
// Meshy GLB swap (Postfix 7) — module-level library injection
// ---------------------------------------------------------------------------

/**
 * Set once by main.ts after `loadModelLibrary()` (modelLibrary.ts) resolves
 * during the title-screen preload. Module-level rather than a parameter
 * threaded through creatureView.ts/syncCreatures: keeps every existing
 * `buildCreatureModel(species)` / `buildCarcassModel(species)` call site
 * unchanged — this file is the only one that needs to know a library exists.
 * Starts `{}` (every species reads as "no GLB yet") so a build that runs
 * before the preload resolves — or a species whose GLB failed to load — just
 * falls through to the procedural builders below, no null-checks needed at
 * the call sites.
 */
let modelLibrary: ModelLibrary = {};

/** Called once by main.ts once loadModelLibrary() resolves (or a species entry is null — see that file's per-species try/catch). */
export function setModelLibrary(library: ModelLibrary): void {
  modelLibrary = library;
}

/**
 * GLB swap for a species with a loaded Meshy model: same CreatureModel
 * contract as the procedural builders above, but `parts.body` is a torso-
 * height pivot wrapping the whole single-mesh GLB (see the pivot comment
 * below) and head/tail stay undefined — createLivingAnimate's optional-
 * chaining on those two already no-ops (see its doc comment), so bob/breath/
 * attack-lean still apply to the whole model via `group`/`parts.body`, just
 * without the separate head-nod/tail-wag sub-animation the procedural models
 * drive on their own separate head/tail mounts.
 *
 * No ink outline (deliberate style call, unlike every procedural model
 * above): these are PBR-textured ~20k-tri imports, and an inverted-hull
 * outline would double the triangle count *and* visually fight the baked
 * texture read that a flat-color procedural mesh doesn't have to contend
 * with — procedural fallbacks (GLB load failure) keep their outline as
 * normal, only the GLB path skips it.
 */
function buildGlbCreatureModel(species: string, entry: LibraryEntry): CreatureModel {
  const group = new THREE.Group();

  // entry.geometry/entry.livingMaterial are library-owned and shared across
  // every live instance of this species (e.g. 26 lingshu share one GPU
  // buffer) — only this Mesh wrapper is per-instance. See dispose() below.
  const body = new THREE.Mesh(entry.geometry, entry.livingMaterial);

  // createLivingAnimate's breathing scale / roll / swim-tilt writes go onto
  // whatever it's handed as `parts.body`, rotating/scaling around *that
  // object's own local origin* — every procedural body positions itself at
  // roughly torso-center height for exactly this reason (e.g.
  // buildYoushouModel's `body.position.set(0, BODY_Y, 0)`). entry.geometry's
  // own local origin, by contrast, sits at the model's FEET (modelLibrary.ts
  // bakes ground-alignment to y=0), so rotating `body` directly would swing
  // the whole model's silhouette around a much longer lever arm than the
  // procedural amplitudes were tuned against. `pivot` re-centers that origin
  // to roughly torso height and is what actually gets passed to `parts.body`
  // below — `body` itself is never touched again after this offset.
  const pivotY = entry.bbox.max.y * 0.5;
  body.position.y = -pivotY;
  const pivot = new THREE.Group();
  pivot.position.y = pivotY;
  pivot.add(body);
  group.add(pivot);

  // Mount anchors derived from the baked (ground-aligned, +Z-facing) bbox —
  // added straight to `group` (not `pivot`), so they stay put regardless of
  // the breathing/roll animation above; not wired into `parts` (so
  // createLivingAnimate never touches them either), kept for M1 (future
  // attachments/effects hanging off a specific body point).
  const headMount = makeMount(group, 0, entry.bbox.max.y * 0.8, entry.bbox.max.z);
  const backMount = makeMount(group, 0, entry.bbox.max.y, (entry.bbox.max.z + entry.bbox.min.z) / 2);
  const tailMount = makeMount(group, 0, entry.bbox.max.y * 0.3, entry.bbox.min.z);
  // M2 A1：颌部挂点，同 buildYoushouModel 的 jawMount 同一语义（略靠前于头部）——只有
  // youshou 用得到（wrapYoushouExtras 的撕咬墨斩弧锚点），其余物种的 GLB 模型不建这个
  // mount，与procedural builders"只建自己用得到的挂点"同一惯例。
  const jawMount = species === "youshou" ? makeMount(group, 0, entry.bbox.max.y * 0.6, entry.bbox.max.z) : undefined;

  const shadow = buildGroundShadow(shadowRadiusFor(species));
  group.add(shadow);

  const parts = { body: pivot };
  const mounts: Record<string, THREE.Object3D> = { head: headMount, back: backMount, tail: tailMount };
  if (jawMount) mounts.jaw = jawMount;
  return {
    group,
    mounts,
    parts,
    animate: createLivingAnimate(group, parts, species),
    dispose: () => {
      // entry.geometry/entry.livingMaterial are library-owned — never
      // disposed here, that would break every other living instance of this
      // species still sharing the same GPU buffers. Only the shadow disc
      // (built fresh per instance by buildGroundShadow) belongs to us alone.
      disposeMesh(shadow);
    },
  };
}

// ---------------------------------------------------------------------------
// 幼兽专属额外装饰（M2 A1）：撕咬墨斩弧 + 肾上腺素速度线——两者都需要直接持有
// 自建的 sprite 引用，且要覆盖到 GLB 与 procedural 两条路径（GLB 是实际最常见的
// 那条——三个 GLB 一旦加载成功就是默认外观），所以不放进任一具体 builder 内部，
// 而是在 buildCreatureModel 里对 youshou 统一后处理：两个 builder 都已各自建好
// 一个 `mounts.jaw`（见上方两处 jawMount），这里只需要这一个共同的锚点。
// ---------------------------------------------------------------------------
const SLASH_ARC_LIFE_SEC = 0.15;
const SPEED_LINE_COUNT = 3;

interface YoushouRig {
  slash: THREE.Mesh;
  slashMaterial: THREE.MeshBasicMaterial;
  speedLines: THREE.Mesh[];
  speedLineMaterials: THREE.MeshBasicMaterial[];
}

/** 预建（不可见，opacity=0）撕咬弧 sprite + 3 条速度线 streak——wrapYoushouExtras 逐帧只切换 opacity/position，零分配。 */
function buildYoushouRig(group: THREE.Group, jawMount: THREE.Object3D): YoushouRig {
  const slashMaterial = new THREE.MeshBasicMaterial({
    color: PALETTE.outlineInk,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const slash = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.22), slashMaterial);
  slash.rotation.x = -Math.PI / 2.6; // 略朝前下方的弧面读法，不追求真正弯曲几何体
  jawMount.add(slash); // 无 outline（attach() 不适用——这是纯特效 sprite，不是"生物身体部件"）

  const speedLines: THREE.Mesh[] = [];
  const speedLineMaterials: THREE.MeshBasicMaterial[] = [];
  for (let i = 0; i < SPEED_LINE_COUNT; i++) {
    const material = new THREE.MeshBasicMaterial({
      color: PALETTE.cinnabar,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const streak = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.5), material);
    // group-space 固定偏移（不挂在任何随呼吸/攻击摆动的 mount 下）——读作"身后拖出的
    // 几道红色速度线"，不需要跟着 body 的呼吸缩放一起抖。
    streak.position.set((i - (SPEED_LINE_COUNT - 1) / 2) * 0.18, 0.3, -0.5);
    group.add(streak);
    speedLines.push(streak);
    speedLineMaterials.push(material);
  }
  return { slash, slashMaterial, speedLines, speedLineMaterials };
}

/** 撞见 youshou 时统一后处理（procedural 与 GLB 两条路径都会调用，见上方段落头注释）：包一层 animate，读 mounts.jaw 建特效 rig。model.mounts.jaw 不存在时（防御性，理论不会发生）整体跳过，不抛错。 */
function wrapYoushouExtras(model: CreatureModel): void {
  const jaw = model.mounts.jaw;
  if (!jaw) return;
  const rig = buildYoushouRig(model.group, jaw);
  const baseAnimate = model.animate;
  let wasAttacking = false;
  let slashRemainingSec = 0;
  let lastTSec: number | null = null;

  model.animate = (ctx: AnimateCtx) => {
    baseAnimate(ctx);
    const frameDt = lastTSec === null ? 0 : Math.max(0, ctx.tSec - lastTSec);
    lastTSec = ctx.tSec;

    // 撕咬墨斩弧：idle→attacking 边沿触发一次，0.15s 线性淡出（一次攻击只闪一次，
    // 长按/持续 attacking 状态不会重复重触发——只在 false→true 的那一帧点火）。
    // 触发帧本身不参与衰减（else-if，不是紧跟着再减一次 frameDt）——否则点火那一帧就已经
    // 被扣掉将近一帧的时长，读起来永远到不了满亮，"刚咬中"这一拍的视觉分量会被削弱。
    const attacking = ctx.activity === "attacking";
    const justTriggered = attacking && !wasAttacking;
    if (justTriggered) {
      slashRemainingSec = SLASH_ARC_LIFE_SEC;
    } else if (slashRemainingSec > 0) {
      slashRemainingSec = Math.max(0, slashRemainingSec - frameDt);
    }
    wasAttacking = attacking;
    rig.slashMaterial.opacity = slashRemainingSec / SLASH_ARC_LIFE_SEC;

    // 肾上腺素速度线：冲刺 proxy（同 createLivingAnimate 的 YOUSHOU_SPRINT_SPEED_PROXY）
    // 且濒死爆发窗口内才显示——两个条件都要满足，不是"随便跑起来就有红色线"。
    const showSpeedLines = (ctx.adrenaline ?? false) && ctx.speedHint > YOUSHOU_SPRINT_SPEED_PROXY;
    for (let i = 0; i < rig.speedLineMaterials.length; i++) {
      rig.speedLineMaterials[i]!.opacity = showSpeedLines
        ? 0.25 + 0.25 * Math.abs(Math.sin(ctx.tSec * 8 + i * 1.3))
        : 0;
    }
  };
}

export function buildCreatureModel(species: string): CreatureModel {
  const entry = modelLibrary[species];
  const model = entry ? buildGlbCreatureModel(species, entry) : buildProceduralCreatureModel(species);
  if (species === "youshou") wrapYoushouExtras(model);
  return model;
}

function buildProceduralCreatureModel(species: string): CreatureModel {
  switch (species) {
    case "youshou":
      return buildYoushouModel();
    case "tanshou":
      return buildTanshouModel();
    case "xiyu": // M1 B4
      return buildXiyuModel();
    case "xuehuan": // M1 B4
      return buildXuehuanModel();
    default:
      // Defensive fallback, mirrors the previous graybox-mesh convention: M0
      // content only ever spawns lingshu/tanshou NPCs alongside the youshou
      // player, so any unrecognized species reads as lingshu.
      return buildLingshuModel();
  }
}

// ---------------------------------------------------------------------------
// Carcasses
// ---------------------------------------------------------------------------

interface CarcassShape {
  makeGeometry(): THREE.BufferGeometry;
}

/** Reuses each species' living-body silhouette proportions (CAPSULE_BODY/LINGSHU_BODY/XIYU_BODY/XUEHUAN_BODY above), in their native (un-rotated) orientation. */
function carcassShape(species: string): CarcassShape {
  switch (species) {
    case "youshou":
      return { makeGeometry: () => capsuleBodyGeometry(CAPSULE_BODY.youshou) };
    case "tanshou":
      return { makeGeometry: () => capsuleBodyGeometry(CAPSULE_BODY.tanshou) };
    case "xiyu": // M1 B4
      return { makeGeometry: () => xiyuBodyGeometry() };
    case "xuehuan": // M1 B4
      return { makeGeometry: () => xuehuanBodyGeometry() };
    default:
      // lingshu + defensive fallback for any unforeseen species.
      return { makeGeometry: () => lingshuBodyGeometry() };
  }
}

const CARCASS_SQUASH_Y = 0.35;
const CARCASS_TILT_Z = 0.6;

/**
 * How far to lift the `tilt` wrapper so the squashed+tipped carcass's lowest
 * vertex lands exactly on the ground (y=0), instead of a shared guessed
 * `position.y` (the M0.5 Task 3 bug this replaces: one magic offset applied
 * across three different species' radii/lengths, sinking each one a
 * different, wrong amount below ground once tipped).
 *
 * `tilt.rotation.z` sweeps everything inside `tilt` around *tilt's own*
 * origin. A fixed offset baked onto `body.position` (a child of `tilt`,
 * applied *before* that rotation) gets swept along by it too — how far its
 * lowest point ends up below tilt's origin then depends on the body's own
 * radius/length in a way a single shared constant can't capture. So instead
 * of guessing, this measures the actual squashed+rotated geometry (mirroring
 * exactly what `body`/`tilt` apply at render time — see the two calls below)
 * and lands the correction on `tilt.position.y`, which — unlike `body`'s
 * position — is translated *after* `tilt`'s own rotation in the composed
 * transform (Three.js composes an Object3D's local matrix as T·R·S), so it
 * is not itself swept by it.
 */
function carcassGroundLift(geometry: THREE.BufferGeometry): number {
  const probe = geometry.clone();
  probe.scale(1, CARCASS_SQUASH_Y, 1);
  probe.rotateZ(CARCASS_TILT_Z);
  probe.computeBoundingBox();
  const minY = probe.boundingBox?.min.y ?? 0;
  probe.dispose();
  return -minY;
}

/**
 * GLB carcass variant — reuses the exact same baked geometry as the living
 * GLB model (library-owned, never disposed here — see buildGlbCreatureModel's
 * dispose() comment, same ownership rule applies) with the OTHER shared
 * material clone (`entry.carcassMaterial`, tinted PALETTE.carcass once at
 * load time in modelLibrary.ts), squashed/tilted/ground-lifted exactly like
 * the procedural carcasses below. carcassGroundLift works on *any*
 * BufferGeometry — it was written against capsule/sphere shapes but only
 * ever does a generic clone→scale→rotateZ→bbox probe, so the already
 * ground-aligned, +Z-facing GLB geometry plugs in unchanged.
 */
function buildGlbCarcassModel(species: string, entry: LibraryEntry): CreatureModel {
  const group = new THREE.Group();

  const body = new THREE.Mesh(entry.geometry, entry.carcassMaterial);
  body.scale.y = CARCASS_SQUASH_Y;

  const tilt = new THREE.Group();
  tilt.rotation.z = CARCASS_TILT_Z;
  tilt.position.y = carcassGroundLift(entry.geometry);
  tilt.add(body);
  group.add(tilt); // no outline: GLB carcasses never had one to begin with (see buildGlbCreatureModel)

  const shadow = buildGroundShadow(shadowRadiusFor(species));
  group.add(shadow);

  return {
    group,
    mounts: {},
    parts: { body },
    // No-op per spec, same reasoning as the procedural carcass below (a
    // carcass never locomotes/breathes/attacks/eats).
    animate: () => {},
    dispose: () => {
      // entry.geometry/entry.carcassMaterial are library-owned — never
      // disposed here (see buildGlbCreatureModel's dispose() comment).
      disposeMesh(shadow);
    },
  };
}

/**
 * 尸体：flattened, uniformly carcass-tinted, tipped over, no outline ("消隐感").
 *
 * Reuses the *native* (un-rotated) body geometry rather than the living
 * model's already-forward-facing instance: squashing that instance's own Y
 * axis would shorten its length (rotation.x baked the long axis onto Z),
 * whereas squashing the native vertical capsule/sphere pancakes its standing
 * height instead — the "collapsed" look this spec wants.
 */
export function buildCarcassModel(species: string): CreatureModel {
  const entry = modelLibrary[species];
  if (entry) return buildGlbCarcassModel(species, entry);
  const group = new THREE.Group();
  const shape = carcassShape(species);
  const geometry = shape.makeGeometry();

  const body = makeMesh(geometry, PALETTE.carcass);
  body.scale.y = CARCASS_SQUASH_Y;

  // creatureView drives `group.rotation` every frame (yaw + attack-pitch), so
  // the sideways tip has to live on a child wrapper instead: setting it on
  // `group` directly would get overwritten by the very next applyInterp() call.
  const tilt = new THREE.Group();
  tilt.rotation.z = CARCASS_TILT_Z;
  tilt.position.y = carcassGroundLift(geometry);
  tilt.add(body);
  group.add(tilt); // no outline() call: carcass models are unlined per spec

  // Added to `group`, not `tilt`: the shadow must stay flat on the ground
  // regardless of the carcass's sideways tip-over (see buildGroundShadow's
  // doc comment).
  group.add(buildGroundShadow(shadowRadiusFor(species)));

  return {
    group,
    mounts: {},
    parts: { body },
    // No-op per spec: a carcass never locomotes/breathes/attacks/eats, and
    // critically must never touch `group.rotation.x` — the inner `tilt`
    // child (see comment above) already owns the tip-over, and creatureView
    // no longer writes a fixed attack-pitch onto `group` itself, so leaving
    // this empty is what keeps `group.rotation`/`.position.y` exactly what
    // applyInterp's lerp wrote, undisturbed.
    animate: () => {},
    dispose: () => disposeTree(group),
  };
}
