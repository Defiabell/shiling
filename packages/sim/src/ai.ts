import { SPECIES, TUNING, type SpeciesDef } from "@shiling/content";
import { DT } from "./sim.js";
import { moveCreature } from "./movement.js";
import { killCreature } from "./needs.js";
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

/**
 * 场景内最近的"猎物"（非同类、活着、未入洞）及其距离。不限定 diet——
 * 潭狩既猎苓鼠也猎玩家（幼兽亦为 carnivore，但规则只按物种区分，不按 diet）。
 */
function nearestPrey(c: Creature, state: GameState): { prey: Creature; dist: number } | null {
  let best: { prey: Creature; dist: number } | null = null;
  for (const other of state.creatures) {
    if (other.id === c.id) continue;
    if (other.species === c.species) continue;
    if (other.activity === "dead") continue;
    if (other.burrowId !== null) continue;
    const d = dist2d(c.pos, other.pos);
    if (!best || d < best.dist) best = { prey: other, dist: d };
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
 * speedScale（默认 1）：doFlee 在疲态减速时要传同一个 speedScale，否则这里探测的落点比
 * moveCreature 实际会走到的更远，可能在岸边多绕一次不必要的 ±60°（moveCreature 自己会
 * 用真实目标点重新校验，不会因此卡死或走错，纯属保守，但探测口径不一致终归是隐患）。
 */
function blockedByWater(c: Creature, dirX: number, dirZ: number, terrain: Terrain, def: SpeciesDef, speedScale = 1): boolean {
  const { x: nx, z: nz } = norm2d(dirX, dirZ);
  if (nx === 0 && nz === 0) return false;
  const tx = c.pos.x + nx * def.walkSpeed * speedScale * DT;
  const tz = c.pos.z + nz * def.walkSpeed * speedScale * DT;
  return !def.canSwim && terrain.isWater(tx, tz);
}

/**
 * 反向全速逃离威胁；撞水则尝试 ±60° 旋转后的备选方向。
 * 逃跑耐力（M0.5 postfix-3）：c.fleeTime 记录本轮连续 flee 已持续的秒数（由
 * tickLingshu 逐 tick 累加/清零，见该函数注释），超过 fleeFatigueThresholdSec
 * 后按 fleeFatigueSpeedMult 减速——"追一段就能追上"的正反馈，避免无限风筝。
 */
function doFlee(c: Creature, terrain: Terrain, threat: Creature, def: SpeciesDef): void {
  const fatigued = c.fleeTime > TUNING.fleeFatigueThresholdSec;
  const speedScale = fatigued ? TUNING.fleeFatigueSpeedMult : 1;
  let { x: dirX, z: dirZ } = norm2d(c.pos.x - threat.pos.x, c.pos.z - threat.pos.z);
  if (dirX === 0 && dirZ === 0) {
    // 极端退化：位置重合，借当前朝向随便选一个逃跑方向。
    dirX = Math.sin(c.yaw);
    dirZ = Math.cos(c.yaw);
  }
  if (blockedByWater(c, dirX, dirZ, terrain, def, speedScale)) {
    const plus60 = rotate2d(dirX, dirZ, Math.PI / 3);
    const minus60 = rotate2d(dirX, dirZ, -Math.PI / 3);
    if (!blockedByWater(c, plus60.x, plus60.z, terrain, def, speedScale)) {
      dirX = plus60.x; dirZ = plus60.z;
    } else if (!blockedByWater(c, minus60.x, minus60.z, terrain, def, speedScale)) {
      dirX = minus60.x; dirZ = minus60.z;
    }
    // 三个方向都挡水：仍用原方向调用，moveCreature 会在岸边贴住并把 activity 回落 idle。
  }
  moveCreature(c, dirX, dirZ, false, terrain, speedScale); // 不冲刺：NPC 无疲劳消耗简化
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

/** 直线追击目标；撞水沿用 ±60° 备选方向（潭狩 canSwim=true，通常不会触发）。 */
function doChase(c: Creature, terrain: Terrain, target: Creature, def: SpeciesDef): void {
  let { x: dirX, z: dirZ } = norm2d(target.pos.x - c.pos.x, target.pos.z - c.pos.z);
  if (dirX === 0 && dirZ === 0) return; // 位置重合：交给下一帧的攻击判定处理
  if (blockedByWater(c, dirX, dirZ, terrain, def)) {
    const plus60 = rotate2d(dirX, dirZ, Math.PI / 3);
    const minus60 = rotate2d(dirX, dirZ, -Math.PI / 3);
    if (!blockedByWater(c, plus60.x, plus60.z, terrain, def)) {
      dirX = plus60.x; dirZ = plus60.z;
    } else if (!blockedByWater(c, minus60.x, minus60.z, terrain, def)) {
      dirX = minus60.x; dirZ = minus60.z;
    }
  }
  moveCreature(c, dirX, dirZ, false, terrain);
}

/** 追击/攻击判定：目标丢失、入洞或脱离 1.5×感知圈 → 回 patrol；进入攻击距离且冷却好 → 落地伤害，死亡则转 feed。 */
function resolveHunt(c: Creature, state: GameState, terrain: Terrain, def: SpeciesDef): void {
  const target = state.creatures.find((x) => x.id === c.targetId);
  if (!target || target.activity === "dead") {
    c.targetId = null;
    c.aiState = "patrol";
    return;
  }
  if (target.burrowId !== null) {
    // 目标入洞：入洞玩家/生物不可见（同 nearestPrey 的获取前置条件），须每 tick 重新校验，
    // 否则会出现"猎杀开始后目标才入洞"漏判——追击途中入洞也要立刻放弃，回 patrol 重新择目标。
    c.targetId = null;
    c.aiState = "patrol";
    return;
  }
  const d = dist2d(c.pos, target.pos);
  if (d > def.senseRadius * 1.5) {
    c.targetId = null;
    c.aiState = "patrol";
    return;
  }
  if (d <= def.attackRange) {
    moveCreature(c, 0, 0, false, terrain); // 站桩攻击：同步 locomotion/pos.y，不位移
    if (c.attackCooldown <= 0) {
      target.hp -= def.attackDamage;
      c.attackCooldown = TUNING.attackCooldownSec;
      c.activity = "attacking"; // 供渲染层识别攻击帧
      if (target.hp <= 0) {
        // killCreature 会重建 state.creatures（filter 掉非玩家的 target）；
        // tickAi 的 for-of 仍在遍历旧数组引用，不受影响（旧数组里 target 对象本身
        // 已被标记 activity="dead"，后续若被同 tick 的 for-of 扫到，会被顶层
        // `if (c.activity === "dead") continue;` 挡掉，无需额外处理）。
        killCreature(state, target);
        c.feedingCarcassId = target.id;
        c.targetId = null;
        c.aiState = "feed";
        c.aiTimer = TUNING.predatorEatFromCarcassSec;
      }
    }
    return;
  }
  doChase(c, terrain, target, def);
}

/** 钉在尸体旁进食：按 eatMeatPerSec 消耗尸体 meat，同速率折算回复自身 hunger（与玩家进食语义一致，见 Task 11）。 */
function doFeed(c: Creature, state: GameState, terrain: Terrain): void {
  moveCreature(c, 0, 0, false, terrain); // 不位移，仅同步 locomotion/pos.y
  c.activity = "eating";
  c.aiTimer = Math.max(0, c.aiTimer - DT);
  const carcass = state.carcasses.find((cc) => cc.id === c.feedingCarcassId);
  if (carcass) {
    const eaten = Math.min(carcass.meat, TUNING.eatMeatPerSec * DT);
    carcass.meat -= eaten;
    c.needs.hunger = Math.min(100, c.needs.hunger + eaten * TUNING.hungerPerMeat);
    if (carcass.meat <= 0) {
      state.carcasses = state.carcasses.filter((x) => x.id !== carcass.id);
      endFeed(c);
      return;
    }
  }
  if (!carcass || c.aiTimer <= 0) endFeed(c);
}

/** 结束进食：满足 satiatedTimer，回 patrol 并立即重新择向（同 tickLingshu 脱险后的处理）。 */
function endFeed(c: Creature): void {
  c.feedingCarcassId = null;
  c.satiatedTimer = TUNING.predatorSatiatedSec;
  c.aiState = "patrol";
  c.aiTimer = 0;
}

function tickTanshou(c: Creature, state: GameState, terrain: Terrain, rng: Rng): void {
  const def = SPECIES.tanshou!;
  c.attackCooldown = Math.max(0, c.attackCooldown - DT); // 潭狩自身冷却；玩家的另见 Task 11

  if (c.aiState === "patrol") {
    if (c.satiatedTimer > 0) {
      c.satiatedTimer = Math.max(0, c.satiatedTimer - DT);
    } else {
      const found = nearestPrey(c, state);
      if (found && found.dist <= def.senseRadius) {
        c.targetId = found.prey.id;
        c.aiState = "hunt";
      }
    }
  }

  if (c.aiState === "hunt") resolveHunt(c, state, terrain, def);

  if (c.aiState === "feed") doFeed(c, state, terrain);
  else if (c.aiState === "patrol") doWander(c, terrain, rng);
}

function tickLingshu(c: Creature, state: GameState, terrain: Terrain, rng: Rng): void {
  const def = SPECIES.lingshu!;
  // 觅食分心（M0.5 postfix-3）：吃草时（aiState==="graze"，等价于本 tick 开始时
  // 上一帧已经把 activity 落成 "eating"）警觉性降低，威胁检测半径按
  // grazeDistractionFactor 收缩——奖励玩家绕到侧后方潜近，而不是从任意方向
  // 一走近就被 10m 的满感知半径惊动。只影响"是否触发 flee"这一判定，不改
  // fleeDistance/脱险阈值。
  const senseRadius = c.aiState === "graze" ? def.senseRadius * TUNING.grazeDistractionFactor : def.senseRadius;
  const found = nearestThreat(c, state);
  const threatDist = found?.dist ?? Infinity;

  // 威胁判定优先于饥饿状态机：任一状态下进入 senseRadius 都立即转 flee；
  // 已在 flee 中的则要等威胁拉开到 fleeDistance 之外才解除。
  if (threatDist <= senseRadius) {
    c.aiState = "flee";
  } else if (c.aiState === "flee" && threatDist > def.fleeDistance) {
    c.aiState = "wander";
    c.aiTimer = 0; // 脱险后立即重新择向，而不是沿用逃跑方向
  }

  if (c.aiState !== "flee") {
    if (c.aiState === "graze" && c.needs.hunger >= 90) c.aiState = "wander";
    else if (c.aiState !== "graze" && c.needs.hunger < 50) c.aiState = "graze";
  }

  // 逃跑耐力计时（M0.5 postfix-3）：flee 中累加 fleeTime、清零 fleeRecoverTime；
  // 非 flee 时反过来累加 fleeRecoverTime，攒够 fleeRecoverSec 才把 fleeTime
  // 清零——中途再次受惊会打断恢复计时，但不会把已经攒下的疲态提前抹掉。
  if (c.aiState === "flee") {
    c.fleeTime += DT;
    c.fleeRecoverTime = 0;
  } else {
    c.fleeRecoverTime += DT;
    if (c.fleeRecoverTime >= TUNING.fleeRecoverSec) c.fleeTime = 0;
  }

  if (c.aiState === "flee") doFlee(c, terrain, found!.threat, def);
  else if (c.aiState === "graze") doGraze(c, terrain);
  else doWander(c, terrain, rng);
}

/**
 * 顶层 AI 派发：苓鼠（wander/graze/flee）与潭狩（patrol/hunt/feed）。玩家保持
 * aiState="idle" 不做任何处理，留给 Task 11 的玩家专属逻辑（进食/攻击响应）。
 */
export function tickAi(state: GameState, terrain: Terrain, rng: Rng): void {
  for (const c of state.creatures) {
    if (c.activity === "dead" || c.burrowId !== null) continue;
    if (c.species === "lingshu") tickLingshu(c, state, terrain, rng);
    else if (c.species === "tanshou") tickTanshou(c, state, terrain, rng);
  }
}
