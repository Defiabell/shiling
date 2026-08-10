import * as THREE from "three";
import { dist2d, DT, type GameState, type Vec3 } from "@shiling/sim";
import { buildCarcassModel, buildCreatureModel, type CreatureModel } from "./creatureModels.js";
import { applyOrganVisuals, type OrganVisualHandle } from "./organVisuals.js";

export interface CreatureView {
  /** = model.group. Kept as a top-level field (existing call sites read .mesh.position for the follow camera). */
  mesh: THREE.Object3D;
  /** Frees model.group's geometries/materials, outlines included. */
  dispose: () => void;
  /** World position at the start of the current fixed step (interpolation source). */
  prevPos: THREE.Vector3;
  /** World position at the end of the current fixed step (interpolation target). */
  currPos: THREE.Vector3;
  prevYaw: number;
  currYaw: number;
  /**
   * Most recently synced activity/locomotion strings — feed model.animate's
   * ctx every frame (Task 4). Carcasses have neither field on the sim's
   * Carcass type, so their view keeps the constructor defaults below
   * forever; harmless, since buildCarcassModel's animate ignores ctx
   * entirely (no-op).
   */
  activity: string;
  locomotion: string;
  /** = model.animate, captured once at view construction (Task 4's per-frame procedural animation). */
  animate: CreatureModel["animate"];
  /**
   * Part 2（postfix-9）：true 恰好一帧一帧地跟着 `state.creatures`（玩家）的
   * `carryingCarcassId === 此尸体 id` 走——syncCreatures 每帧重写，never true for a
   * `creature:*` view（叼运是玩家专属机制，只有 carcass 视图会被标记）。applyInterp
   * 读它决定要不要叠加"叼运浮动同步"的 bob（见上方 CARRY_BOB_* 常量），carcass 自身
   * 的 `animate` 仍然是 creatureModels.ts 里那个硬 no-op（见 buildCarcassModel 的
   * doc comment）——bob 完全在这一层（creatureView）叠加，不碰那个 no-op 契约。
   */
  isCarried: boolean;
  /**
   * 原始 CreatureModel（M1 B5）：mesh/dispose/animate 都是从它身上摘出来的字段，但
   * organVisuals.ts 的挂件需要 mounts/parts 才能定位挂点——之前没有任何字段保留这份
   * 引用，只留了三个摘出来的子字段。只有玩家视图会真正用到（见 syncCreatures 的
   * organSignature 分支），NPC/carcass 视图持有它但从不读取，与 isCarried 对
   * `creature:*` 视图恒为 false 的既有惯例（"共享字段，只有部分角色真正用到"）同构。
   */
  model: CreatureModel;
  /** 器官挂件的当前实例（M1 B5，仅玩家视图非 null）——organs diff 时先 dispose 旧的再重建。 */
  organVisualHandle: OrganVisualHandle | null;
  /** 上一次用来构建 organVisualHandle 的签名（见下方 organSignature）——dirty-check 基准。 */
  organSignature: string;
}

/**
 * Keyed by `${kind}:${id}`, not by bare numeric id: killCreature keeps a dead
 * player in state.creatures (only non-player kills are filtered out) while
 * also pushing a carcass with the *same* numeric id, so a dead player and its
 * own carcass would collide under a plain id key.
 */
export type CreatureViews = Map<string, CreatureView>;

function creatureKey(id: number): string {
  return `creature:${id}`;
}

function carcassKey(id: number): string {
  return `carcass:${id}`;
}

/**
 * 叼运浮动同步（Part 2，postfix-9）：与 creatureModels.ts 里 createLivingAnimate 的
 * 呼吸/走动 bob 用同一套"频率随速度线性增长、幅度按速度线性增长再封顶"公式（tSec
 * 相位也共享同一个 wall-clock 源），只是幅度整体 ×0.6——尸体本身没有生命，"跟着
 * 叼它的玩家步频一起晃"才是这里要读出的"同步"效果，不需要自成一套独立的摆荡节奏，
 * 更不需要真的比玩家本体晃得夸张。被叼着的尸体的 speedHint（下方 applyInterp 里
 * 已经在算的 dist2d(prevPos,currPos)/DT）天然约等于玩家的行进速度——carrying.ts
 * 把它逐 tick 钉在玩家下巴前方的固定偏移，位移几乎与玩家本体同步——不需要额外从
 * 玩家自己的视图里读一份速度出来跨 view 传递。
 */
const CARRY_BOB_FREQ_BASE = 4;
const CARRY_BOB_FREQ_SPEED_SCALE = 2;
const CARRY_BOB_AMP_CAP = 0.08 * 0.6;
const CARRY_BOB_AMP_SPEED_SCALE = 0.02 * 0.6;

/** Creates a view whose prevPos/currPos both start at the model's spawn position, so a freshly-added model never pops from some default. */
function newView(model: CreatureModel, groundPos: Vec3, yaw: number): CreatureView {
  const pos = new THREE.Vector3(groundPos.x, groundPos.y, groundPos.z);
  model.group.position.copy(pos);
  // "YXZ": yaw (world Y) applied before pitch (local X), so the attack-spring
  // tilt animate() drives onto rotation.x always pitches the nose relative to
  // current facing, not a fixed world axis. Harmless for carcasses — their
  // yaw stays 0 and their animate() never touches rotation.x (no-op), and
  // their own tip-over lives on an inner wrapper this rotation.order never
  // touches.
  model.group.rotation.order = "YXZ";
  return {
    mesh: model.group,
    dispose: () => model.dispose(),
    prevPos: pos.clone(),
    currPos: pos.clone(),
    prevYaw: yaw,
    currYaw: yaw,
    activity: "idle",
    locomotion: "walk",
    animate: model.animate,
    isCarried: false,
    model,
    organVisualHandle: null,
    organSignature: "",
  };
}

/**
 * 玩家已装备器官的签名（M1 B5）：只反映"哪个槎位装了哪个 organId"这个*集合*，刻意不
 * 含 temper——temper 每秒都在缓慢变化（tickTemper 的被动/主动增长），若把它也编进签名，
 * 每次 temper 数值一变就会触发整套挂件 dispose+重建，浪费且毫无必要（挂件的外观只取决
 * 于装的是哪个器官，不取决于淬炼到几成）。键按槎位名排序，保证同一组装备无论
 * Object.entries 遍历顺序如何都产出同一个字符串。 */
export function organSignature(organs: GameState["organs"]): string {
  return (Object.keys(organs) as (keyof GameState["organs"])[])
    .sort()
    .map((slot) => `${slot}:${organs[slot]?.organId ?? ""}`)
    .join("|");
}

/**
 * Reconciles the view registry against live sim state: adds models for
 * newly-appeared creatures/carcasses, removes models for ones that vanished
 * (a kill removes the prey from state.creatures; a fully-eaten carcass is
 * removed from state.carcasses), and refreshes each surviving view's
 * currPos/currYaw/activity/locomotion. Pure state → view sync — no game logic.
 */
export function syncCreatures(scene: THREE.Scene, state: GameState, views: CreatureViews): void {
  const liveKeys = new Set<string>();

  for (const c of state.creatures) {
    const key = creatureKey(c.id);
    liveKeys.add(key);
    let view = views.get(key);
    if (!view) {
      // Species-keyed model already implies the right look here: the player
      // creature's species is always "youshou", so no separate by-id branch
      // is needed to pick its color/shape (unlike the old graybox mesh spec).
      const model = buildCreatureModel(c.species);
      scene.add(model.group);
      view = newView(model, c.pos, c.yaw);
      views.set(key, view);
    }
    // Model's group origin is the feet (ground-contact point), so sim's pos
    // (already terrain-surface height) maps straight across — no half-height lift.
    view.currPos.set(c.pos.x, c.pos.y, c.pos.z);
    view.currYaw = c.yaw;
    view.activity = c.activity;
    view.locomotion = c.locomotion;
    // Hidden while burrowed (underground, out of view), once dead (a dead
    // player's creature entry lingers — see key comment above, but the
    // carcass model at the same spot is the one that should be visible), or
    // — M1 B4 — while mid-vanish (xuehuan's hiddenTicks>0, see
    // Creature.hiddenTicks doc comment in @shiling/sim: same "gone from the
    // world" semantics as burrowId, just a separate field since it isn't
    // tied to a fixed Terrain.digSpots location).
    view.mesh.visible = c.burrowId === null && c.activity !== "dead" && c.hiddenTicks === 0;

    // M1 B5：只有玩家会装备器官——见 organSignature 的字段注释；NPC 分支这个 if 恒为
    // false，从不触碰 organVisualHandle（对它们始终留 null，与构造时的默认值一致）。
    if (c.id === state.playerId) {
      const sig = organSignature(state.organs);
      if (sig !== view.organSignature) {
        view.organVisualHandle?.dispose();
        view.organVisualHandle = applyOrganVisuals(view.model, c.species, state.organs);
        view.organSignature = sig;
      }
    }
  }

  // Part 2（postfix-9）：只有玩家能叼运，且一次只能叼一具——一次性查一遍即可，不必
  // 在下面的循环里对每具尸体各自重新 find() 一次玩家。
  const player = state.creatures.find((c) => c.id === state.playerId);
  const carriedCarcassId = player?.carryingCarcassId ?? null;

  for (const carcass of state.carcasses) {
    const key = carcassKey(carcass.id);
    liveKeys.add(key);
    let view = views.get(key);
    if (!view) {
      const model = buildCarcassModel(carcass.species);
      scene.add(model.group);
      view = newView(model, carcass.pos, 0);
      views.set(key, view);
    }
    view.currPos.set(carcass.pos.x, carcass.pos.y, carcass.pos.z);
    view.mesh.visible = true;
    view.isCarried = carriedCarcassId === carcass.id;
  }

  for (const [key, view] of views) {
    if (liveKeys.has(key)) continue;
    scene.remove(view.mesh);
    view.organVisualHandle?.dispose(); // M1 B5：玩家死亡这个理论上唯一会命中的路径——见 organSignature 字段注释
    view.dispose();
    views.delete(key);
  }
}

/**
 * Copies each view's currPos/currYaw into prevPos/prevYaw. Call once, right
 * before sim.step(), so the interpolation source reflects the pose as it was
 * before this fixed step (the target is filled in afterwards by syncCreatures).
 */
export function snapshotPrev(views: CreatureViews): void {
  for (const view of views.values()) {
    view.prevPos.copy(view.currPos);
    view.prevYaw = view.currYaw;
  }
}

/** Shortest-path angle lerp so yaw doesn't spin the long way around across the ±π wrap. */
function lerpAngle(a: number, b: number, t: number): number {
  let diff = (b - a) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  else if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

/**
 * Render-frame interpolation: blends each view's prev→curr pose by alpha
 * (leftover accumulator / DT) and writes the result onto the model's root
 * transform (position + yaw only — pitch/roll/scale are Task 4's
 * animate()'s job, not this function's, so it never touches rotation.x or
 * any part transform).
 *
 * Then drives `model.animate` (via `view.animate`) for procedural
 * locomotion/attack/eat motion. Order matters: animate's one `+=` (the
 * movement bob onto `group.position.y`) counts on this function having
 * *just* overwritten position.y with a fresh lerp — recomputed from
 * prevPos/currPos, never carried over from a prior frame — immediately
 * before animate() runs, so the bob never accumulates across frames even
 * though it's a bare `+=`.
 *
 * speedHint reuses the same prevPos/currPos this function already lerps
 * from — dist2d (horizontal-only, matches "水平速度") over one fixed
 * timestep — rather than computing anything new: it's constant for the
 * whole fixed step, independent of alpha.
 *
 * Part 2（postfix-9）：`view.isCarried` 视图（叼运中的尸体）在 `animate()`（对
 * carcass 永远是 no-op）之后再叠加一个小幅度的 bob——见 CARRY_BOB_* 常量的头部
 * 注释。同样是 `+=`，同样依赖"这一帧刚被 lerp 写过一次 position.y"这个前提，与
 * `createLivingAnimate` 自己那处 `+=` 的安全性论证完全一致（不会跨帧累积）。
 */
export function applyInterp(views: CreatureViews, alpha: number, tSec: number): void {
  const t = Math.max(0, Math.min(1, alpha));
  for (const view of views.values()) {
    view.mesh.position.lerpVectors(view.prevPos, view.currPos, t);
    view.mesh.rotation.y = lerpAngle(view.prevYaw, view.currYaw, t);
    const speedHint = dist2d(view.prevPos, view.currPos) / DT;
    view.animate({ activity: view.activity, locomotion: view.locomotion, speedHint, tSec });
    if (view.isCarried) {
      const bobFreq = CARRY_BOB_FREQ_BASE + speedHint * CARRY_BOB_FREQ_SPEED_SCALE;
      const bobAmp = Math.min(CARRY_BOB_AMP_CAP, speedHint * CARRY_BOB_AMP_SPEED_SCALE);
      view.mesh.position.y += Math.abs(Math.sin(tSec * bobFreq)) * bobAmp;
    }
  }
}
