import { SPECIES, TUNING, type SpeciesDef } from "@shiling/content";
import { DT } from "./sim.js";
import { moveCreature } from "./movement.js";
import { dist2d, norm2d } from "./vec.js";
import type { Rng } from "./rng.js";
import type { Creature, GameState } from "./state.js";
import type { Terrain } from "./terrain.js";

/**
 * other 是否对 c 构成"肉食威胁"：diet===carnivore 且未死亡、未入洞。
 * 玩家（youshou，diet=carnivore）天然被同一条件覆盖，无需特判——潭狩同理（Task 10）。
 */
function isCarnivoreThreat(c: Creature, other: Creature): boolean {
  if (other.id === c.id) return false;
  if (other.activity === "dead") return false;
  if (other.burrowId !== null) return false;
  return SPECIES[other.species]?.diet === "carnivore";
}

/** 场景内最近的肉食威胁及其距离（不设上限，由调用方按 senseRadius/fleeDistance 判定进出 flee）。 */
function nearestThreat(c: Creature, state: GameState): { threat: Creature; dist: number } | null {
  let best: { threat: Creature; dist: number } | null = null;
  for (const other of state.creatures) {
    if (!isCarnivoreThreat(c, other)) continue;
    const d = dist2d(c.pos, other.pos);
    if (!best || d < best.dist) best = { threat: other, dist: d };
  }
  return best;
}

function rotate2d(x: number, z: number, radians: number): { x: number; z: number } {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: x * cos - z * sin, z: x * sin + z * cos };
}

/**
 * 与 moveCreature 内部同款"目标点是否落水"探测，供 flee 挑选 ±60° 备选方向使用。
 * 旱鸭子（canSwim=false）在陆地上时用 walkSpeed 探测，与 moveCreature 的挡水判定保持一致。
 */
function blockedByWater(c: Creature, dirX: number, dirZ: number, terrain: Terrain, def: SpeciesDef): boolean {
  const { x: nx, z: nz } = norm2d(dirX, dirZ);
  if (nx === 0 && nz === 0) return false;
  const tx = c.pos.x + nx * def.walkSpeed * DT;
  const tz = c.pos.z + nz * def.walkSpeed * DT;
  return !def.canSwim && terrain.isWater(tx, tz);
}

/** 反向全速逃离威胁；撞水则尝试 ±60° 旋转后的备选方向。 */
function doFlee(c: Creature, terrain: Terrain, threat: Creature, def: SpeciesDef): void {
  let { x: dirX, z: dirZ } = norm2d(c.pos.x - threat.pos.x, c.pos.z - threat.pos.z);
  if (dirX === 0 && dirZ === 0) {
    // 极端退化：位置重合，借当前朝向随便选一个逃跑方向。
    dirX = Math.sin(c.yaw);
    dirZ = Math.cos(c.yaw);
  }
  if (blockedByWater(c, dirX, dirZ, terrain, def)) {
    const plus60 = rotate2d(dirX, dirZ, Math.PI / 3);
    const minus60 = rotate2d(dirX, dirZ, -Math.PI / 3);
    if (!blockedByWater(c, plus60.x, plus60.z, terrain, def)) {
      dirX = plus60.x; dirZ = plus60.z;
    } else if (!blockedByWater(c, minus60.x, minus60.z, terrain, def)) {
      dirX = minus60.x; dirZ = minus60.z;
    }
    // 三个方向都挡水：仍用原方向调用，moveCreature 会在岸边贴住并把 activity 回落 idle。
  }
  moveCreature(c, dirX, dirZ, false, terrain); // 不冲刺：NPC 无疲劳消耗简化
}

/** 每 aiRepathSec 用 rng 重新选一个随机方向游走。 */
function doWander(c: Creature, terrain: Terrain, rng: Rng): void {
  c.aiTimer -= DT;
  if (c.aiTimer <= 0) {
    const angle = rng.range(0, Math.PI * 2);
    c.aiDirX = Math.sin(angle);
    c.aiDirZ = Math.cos(angle);
    c.aiTimer = TUNING.aiRepathSec;
  }
  moveCreature(c, c.aiDirX, c.aiDirZ, false, terrain);
}

/** 原地进食：借 moveCreature(0,0,...) 同步 locomotion/pos.y，饥饿按 grazeHungerPerSec 回升。 */
function doGraze(c: Creature, terrain: Terrain): void {
  moveCreature(c, 0, 0, false, terrain);
  c.activity = "eating";
  c.needs.hunger = Math.min(100, c.needs.hunger + TUNING.grazeHungerPerSec * DT);
}

function tickLingshu(c: Creature, state: GameState, terrain: Terrain, rng: Rng): void {
  const def = SPECIES.lingshu!;
  const found = nearestThreat(c, state);
  const threatDist = found?.dist ?? Infinity;

  // 威胁判定优先于饥饿状态机：任一状态下进入 senseRadius 都立即转 flee；
  // 已在 flee 中的则要等威胁拉开到 fleeDistance 之外才解除。
  if (threatDist <= def.senseRadius) {
    c.aiState = "flee";
  } else if (c.aiState === "flee" && threatDist > def.fleeDistance) {
    c.aiState = "wander";
    c.aiTimer = 0; // 脱险后立即重新择向，而不是沿用逃跑方向
  }

  if (c.aiState !== "flee") {
    if (c.aiState === "graze" && c.needs.hunger >= 90) c.aiState = "wander";
    else if (c.aiState !== "graze" && c.needs.hunger < 50) c.aiState = "graze";
  }

  if (c.aiState === "flee") doFlee(c, terrain, found!.threat, def);
  else if (c.aiState === "graze") doGraze(c, terrain);
  else doWander(c, terrain, rng);
}

/**
 * 顶层 AI 派发。本任务只接线苓鼠（wander/graze/flee）；潭狩与玩家保持 aiState="idle"
 * 不做任何处理，为 Task 10 的掠食者状态机留出干净的分派点。
 */
export function tickAi(state: GameState, terrain: Terrain, rng: Rng): void {
  for (const c of state.creatures) {
    if (c.activity === "dead" || c.burrowId !== null) continue;
    if (c.species === "lingshu") tickLingshu(c, state, terrain, rng);
  }
}
