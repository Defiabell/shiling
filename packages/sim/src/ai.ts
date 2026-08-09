import { SPECIES, TUNING, type SpeciesDef } from "@shiling/content";
import { DT } from "./sim.js";
import { moveCreature, isTerrainBlocked } from "./movement.js";
import { killCreature } from "./needs.js";
import { getModifiers } from "./organs.js";
import { dist2d, norm2d } from "./vec.js";
import type { Rng } from "./rng.js";
import type { Creature, GameState } from "./state.js";
import type { Terrain } from "./terrain.js";

/**
 * other 是否对 c 构成"肉食威胁"：diet===carnivore 且未死亡、未入洞、未隐匿。
 * 玩家（youshou，diet=carnivore）天然被同一条件覆盖，无需特判——潭狩同理（Task 10）。
 * hiddenTicks>0 排除（M1 B4）：目前只有食草的穴獾会隐匿，从不构成威胁，这条防御性排除
 * 是为了让"隐匿=从场上消失"这条不变量在威胁判定这一侧也成立，不依赖"隐匿物种恰好都是
 * 食草动物"这个偶然事实。
 */
function isCarnivoreThreat(c: Creature, other: Creature): boolean {
  if (other.id === c.id) return false;
  if (other.activity === "dead") return false;
  if (other.burrowId !== null) return false;
  if (other.hiddenTicks > 0) return false;
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
 * 场景内最近的"猎物"（非同类、活着、未入洞、未隐匿）及其距离。不限定 diet——
 * 潭狩既猎苓鼠也猎玩家（幼兽亦为 carnivore，但规则只按物种区分，不按 diet），M1 B4 起
 * 也会猎水里的溪鱼（canSwim=true，游得进去）与地面的穴獾（未隐匿时与苓鼠同等对待）。
 * hiddenTicks>0 排除（M1 B4）：遁地隐匿中的穴獾不可被选为狙击目标——见 Creature.hiddenTicks
 * 字段注释与 tickBurrowEvader。
 */
function nearestPrey(c: Creature, state: GameState): { prey: Creature; dist: number } | null {
  let best: { prey: Creature; dist: number } | null = null;
  for (const other of state.creatures) {
    if (other.id === c.id) continue;
    if (other.species === c.species) continue;
    if (other.activity === "dead") continue;
    if (other.burrowId !== null) continue;
    if (other.hiddenTicks > 0) continue;
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
 * 与 moveCreature 内部同款"目标点是否会被地形挡住"探测（isTerrainBlocked，双向——
 * 旱鸭子挡水、M1 B4 起水生锁定物种反过来挡陆地），供 flee/chase 挑选 ±60° 备选方向使用。
 * 探测用的速度与 moveCreature 同一口径："当前"是否在水里决定读 swimSpeed 还是 walkSpeed
 * （而不是无条件读 walkSpeed）——这个修正是 M1 B4 引入水生锁定物种（溪鱼 xiyu，
 * walkSpeed=0）时发现的：若探测距离恒用 walkSpeed，水生生物的探测位移永远是 0，
 * "会不会游上岸"这个真正要问的问题从未被真正探测过。speedScale（默认 1）：doFlee 在
 * 疲态减速时要传同一个 speedScale，否则这里探测的落点比 moveCreature 实际会走到的更远，
 * 可能多绕一次不必要的 ±60°（moveCreature 自己会用真实目标点重新校验，不会因此卡死或
 * 走错，纯属保守，但探测口径不一致终归是隐患）。
 */
function wouldBeBlocked(c: Creature, dirX: number, dirZ: number, terrain: Terrain, def: SpeciesDef, speedScale = 1): boolean {
  const { x: nx, z: nz } = norm2d(dirX, dirZ);
  if (nx === 0 && nz === 0) return false;
  const inWaterNow = terrain.isWater(c.pos.x, c.pos.z);
  const speed = (inWaterNow ? def.swimSpeed : def.walkSpeed) * speedScale;
  const tx = c.pos.x + nx * speed * DT;
  const tz = c.pos.z + nz * speed * DT;
  return isTerrainBlocked(def, terrain, tx, tz);
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
  if (wouldBeBlocked(c, dirX, dirZ, terrain, def, speedScale)) {
    const plus60 = rotate2d(dirX, dirZ, Math.PI / 3);
    const minus60 = rotate2d(dirX, dirZ, -Math.PI / 3);
    if (!wouldBeBlocked(c, plus60.x, plus60.z, terrain, def, speedScale)) {
      dirX = plus60.x; dirZ = plus60.z;
    } else if (!wouldBeBlocked(c, minus60.x, minus60.z, terrain, def, speedScale)) {
      dirX = minus60.x; dirZ = minus60.z;
    }
    // 三个方向都被挡：仍用原方向调用，moveCreature 会在边界贴住并把 activity 回落 idle。
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

/** 直线追击目标；撞水/撞岸沿用 ±60° 备选方向（潭狩 canSwim=true，通常不会触发；追鱼下水时会用到）。 */
function doChase(c: Creature, terrain: Terrain, target: Creature, def: SpeciesDef): void {
  let { x: dirX, z: dirZ } = norm2d(target.pos.x - c.pos.x, target.pos.z - c.pos.z);
  if (dirX === 0 && dirZ === 0) return; // 位置重合：交给下一帧的攻击判定处理
  if (wouldBeBlocked(c, dirX, dirZ, terrain, def)) {
    const plus60 = rotate2d(dirX, dirZ, Math.PI / 3);
    const minus60 = rotate2d(dirX, dirZ, -Math.PI / 3);
    if (!wouldBeBlocked(c, plus60.x, plus60.z, terrain, def)) {
      dirX = plus60.x; dirZ = plus60.z;
    } else if (!wouldBeBlocked(c, minus60.x, minus60.z, terrain, def)) {
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
  if (target.hiddenTicks > 0) {
    // M1 B4：目标（穴獾）在追击途中钻地隐匿——同上一条 burrowId 分支同一处理，猎杀途中
    // 目标"凭空消失"也要立刻放弃，回 patrol 重新择目标，而不是继续对着一个隐形目标
    // 空追（nearestPrey 本身已经排除隐匿目标，但正在进行中的猎杀是靠 targetId 持有引用，
    // 不会重新经过 nearestPrey 的筛选，必须在这里单独补一道同等的早退）。
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
      // organ modifier（M1 B2）：damageTakenMult（鳞甲/棘背）只在受害者是玩家时生效——
      // getModifiers(state) 本身就是"玩家的聚合效果"（organs 是玩家专属的全局字段，见
      // state.ts），target 若是别的 NPC（潭狩也会猎苓鼠），它没有 organs，不该被这个
      // 乘数影响，所以显式判 isPlayer 才应用。
      const isPlayerTarget = target.id === state.playerId;
      const dmg = isPlayerTarget ? def.attackDamage * getModifiers(state).damageTakenMult : def.attackDamage;
      target.hp -= dmg;
      c.attackCooldown = TUNING.attackCooldownSec;
      c.activity = "attacking"; // 供渲染层识别攻击帧
      // hitsTaken（M1 B2，organs.ts 的 tickTemper 消费）：只在真正命中玩家时 +1——
      // 与"饥饿归零掉血"（needs.ts）是两种不同的伤害语义，只有这里的"挨打"才该磨砺
      // 护体器官的淬炼度，见 state.ts 的字段注释。
      if (isPlayerTarget) state.hitsTaken += 1;
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

/**
 * 威胁检测（M1 B4 从原 tickLingshu 内联逻辑抽出，供 tickFleeingHerbivore 与
 * tickBurrowEvader 共用——M0 遗留的 ledger note"tickLingshu 硬编码 SPECIES.lingshu"
 * 真正要修的不只是那一行 `const def = SPECIES.lingshu!`，威胁检测这一整段本身就该是
 * 任何"食草被威胁"物种都能复用的通用子例程，不是苓鼠专属）：
 *   - 觅食分心（M0.5 postfix-3）：吃草时（aiState==="graze"）警觉性降低，威胁检测
 *     半径按 grazeDistractionFactor 收缩——奖励玩家绕到侧后方潜近。
 *   - organ modifier（M1 B2）：preyNoticeMult（苔纹皮潜行）只在最近威胁恰好是玩家时
 *     收缩感知半径——潭狩同样 diet==="carnivore" 会被判成威胁（核心捕食链的一部分），
 *     organs 只反映玩家的装备，必须显式判"最近威胁是不是玩家"才能应用这个乘数。
 * 返回值里的 effectiveSenseRadius 已经把上面两条都应用完毕，调用方只需比较距离。
 */
function detectThreat(c: Creature, state: GameState, def: SpeciesDef): { threat: Creature | null; dist: number; effectiveSenseRadius: number } {
  const senseRadius = c.aiState === "graze" ? def.senseRadius * TUNING.grazeDistractionFactor : def.senseRadius;
  const found = nearestThreat(c, state);
  const isPlayerThreat = found !== null && found.threat.id === state.playerId;
  const effectiveSenseRadius = isPlayerThreat ? senseRadius * getModifiers(state).preyNoticeMult : senseRadius;
  return { threat: found?.threat ?? null, dist: found?.dist ?? Infinity, effectiveSenseRadius };
}

/**
 * 拉开距离逃跑的食草兽机器（M1 B4 泛化自原 tickLingshu，species-generic——`SPECIES[c.species]!`
 * 取代硬编码的 `SPECIES.lingshu!`，苓鼠 lingshu 与溪鱼 xiyu 现在共用同一份机器）：
 * wander/graze/flee 三态。溪鱼的水生锁定（aquatic=true）完全在 moveCreature/wouldBeBlocked
 * 的地形判定层解决（见 isTerrainBlocked）——这里的状态机本身不需要知道"我是不是鱼"，
 * doFlee/doWander 传的 def 自动带出正确的 walkSpeed/swimSpeed/canSwim/aquatic 组合。
 */
function tickFleeingHerbivore(c: Creature, state: GameState, terrain: Terrain, rng: Rng): void {
  const def = SPECIES[c.species]!;
  const { threat, dist: threatDist, effectiveSenseRadius } = detectThreat(c, state, def);

  // 威胁判定优先于饥饿状态机：任一状态下进入 senseRadius 都立即转 flee；
  // 已在 flee 中的则要等威胁拉开到 fleeDistance 之外才解除。
  if (threatDist <= effectiveSenseRadius) {
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

  if (c.aiState === "flee") doFlee(c, terrain, threat!, def);
  else if (c.aiState === "graze") doGraze(c, terrain);
  else doWander(c, terrain, rng);
}

// 遁地重现的采样上限——一个固定半径 8m 的圆环几乎不会连续 1000 次都落在水里/界外，
// 与 sim.ts 的 randomLandPos/terrain.ts 的 digSpot 采样同一"有界尝试、超限即报错"纪律，
// 只是量级小一档（那两处是全图撒点，这里是小半径定点环采样，命中率天然更高）。
const REAPPEAR_MAX_ATTEMPTS = 1000;

/**
 * randomLandPos（sim.ts）的镜像变体（M1 B4，穴獾遁地重现专用）：以 origin 为圆心、固定
 * 距离 dist、随机角度 rejection-sample 一个陆地点（h > waterLevel+0.5，与 randomLandPos/
 * digSpot 采样同一陆地判据），clamp 到世界边界内。"~8m 外的随机陆地点"取的是固定半径+
 * 随机方向，不是半径内任意撒点——与 plan 原话"约 8m 外"对应的最直接实现。
 */
function randomLandPosNear(rng: Rng, terrain: Terrain, originX: number, originZ: number, dist: number): { x: number; y: number; z: number } {
  const half = terrain.size / 2;
  for (let attempt = 0; attempt < REAPPEAR_MAX_ATTEMPTS; attempt++) {
    const angle = rng.range(0, Math.PI * 2);
    const x = Math.max(-half, Math.min(half, originX + Math.sin(angle) * dist));
    const z = Math.max(-half, Math.min(half, originZ + Math.cos(angle) * dist));
    const h = terrain.heightAt(x, z);
    if (h > terrain.waterLevel + 0.5) return { x, y: h, z };
  }
  throw new Error("randomLandPosNear: no land position found after max attempts; check TUNING.xuehuanReappearDist/world size");
}

/**
 * 遁地重现：hiddenTicks 倒数归零后，在约 8m 外的随机陆地点重新出现，回到 wander。
 *
 * 已知/接受的简化（code review 2026-08-10 提出）：随机角度只按"陆地与否"筛选，不参考
 * 触发这次遁地的威胁（例如玩家）当前在哪个方向——channel(1.2s)+隐匿(4s) 累计约 5.2s
 * 里威胁完全可能已经移动到重现点附近，理论上穴獾可能重新出现在紧贴着同一个威胁的位置。
 * 这是刻意接受的简化，不是遗漏：tickBurrowEvader 顶层的 detectThreat 每 tick 都会重新
 * 判定，若真的贴脸重现，下一 tick 立即再次触发 channel（"钻地躲一下没躲开，接着躲"是
 * 可读的失败模式，不是卡死/崩溃）；要让重现方向"背离威胁"需要把威胁方向一起传进
 * randomLandPosNear，留给后续批次按需再做，本批不扩大 B4 既定范围。
 */
function reappear(c: Creature, rng: Rng, terrain: Terrain): void {
  const pos = randomLandPosNear(rng, terrain, c.pos.x, c.pos.z, TUNING.xuehuanReappearDist);
  c.pos.x = pos.x; c.pos.y = pos.y; c.pos.z = pos.z;
  c.locomotion = "walk";
  c.activity = "idle";
  c.aiState = "wander";
  c.aiTimer = 0; // 立即重新择向，同 tickFleeingHerbivore 脱险后的处理
}

/**
 * 遁地逃脱的食草兽机器（M1 B4，穴獾 xuehuan 专属）：与 tickFleeingHerbivore 共用威胁
 * 检测/觅食子例程（detectThreat/doGraze/doWander），但"惊动后做什么"完全不同——不是
 * 拉开距离跑，而是原地钻地：
 *   wander/graze → 威胁进 senseRadius → "channel"（1.2s，activity="digging"，原地不动但
 *   仍可被击杀——channel 本身不提供无敌，"interruptible by damage" 只是这个意思：打断
 *   channel 唯一的方式是把它打死，走正常死亡路径，不需要额外的取消/重置逻辑）→ channel
 *   完成后隐匿（hiddenTicks 倒数，见该字段注释）→ 倒数归零后 reappear，回到 wander。
 * hiddenTicks>0 时整个函数顶部就早退（已经不在场景里，没有"移动/觅食/威胁检测"可言）。
 */
function tickBurrowEvader(c: Creature, state: GameState, terrain: Terrain, rng: Rng): void {
  const def = SPECIES[c.species]!;

  if (c.hiddenTicks > 0) {
    c.hiddenTicks -= 1;
    if (c.hiddenTicks === 0) reappear(c, rng, terrain);
    return;
  }

  if (c.aiState === "channel") {
    moveCreature(c, 0, 0, false, terrain); // 原地不动，仅同步 locomotion/pos.y（同 doFeed 的写法）
    c.activity = "digging";
    c.aiTimer -= DT;
    if (c.aiTimer <= 0) {
      c.hiddenTicks = Math.round(TUNING.xuehuanHiddenSec * TUNING.tickHz);
      c.activity = "idle"; // 隐匿期间无事可做——下一 tick 起交给上面的 hiddenTicks>0 早退接管
      // aiState 显式落到 "hidden"（而不是让它停留在过期的 "channel"）：功能上无人读取
      // 这个字段来判定隐匿本身（hiddenTicks>0 才是权威信号，见上方早退分支），但让状态
      // 名如实反映"这只生物现在在做什么"，对调试/HUD 探针更诚实——不留一个自相矛盾的
      // 读法（"仍在 channel 中"却已经消失不见）。
      c.aiState = "hidden";
    }
    return;
  }

  const { dist: threatDist, effectiveSenseRadius } = detectThreat(c, state, def);
  if (threatDist <= effectiveSenseRadius) {
    c.aiState = "channel";
    c.aiTimer = TUNING.xuehuanChannelSec;
    c.activity = "digging";
    return;
  }

  if (c.aiState === "graze" && c.needs.hunger >= 90) c.aiState = "wander";
  else if (c.aiState === "wander" && c.needs.hunger < 50) c.aiState = "graze";

  if (c.aiState === "graze") doGraze(c, terrain);
  else doWander(c, terrain, rng);
}

/**
 * 顶层 AI 派发：食草兽（wander/graze/flee，苓鼠+溪鱼共用 tickFleeingHerbivore）、穴獾
 * （wander/graze/channel/hidden，专属 tickBurrowEvader）、潭狩（patrol/hunt/feed）。
 * 玩家保持 aiState="idle" 不做任何处理，留给 Task 11 的玩家专属逻辑（进食/攻击响应）。
 * 穴獾隐匿期间（hiddenTicks>0）不会被顶层的 `burrowId !== null` 早退挡住（隐匿不是
 * burrowId 机制，是独立字段，见 Creature.hiddenTicks 注释）——必须继续调用
 * tickBurrowEvader 才能推进倒数/触发重现，函数内部自己在最顶端做 hiddenTicks>0 的早退。
 */
export function tickAi(state: GameState, terrain: Terrain, rng: Rng): void {
  for (const c of state.creatures) {
    if (c.activity === "dead" || c.burrowId !== null) continue;
    if (c.species === "lingshu" || c.species === "xiyu") tickFleeingHerbivore(c, state, terrain, rng);
    else if (c.species === "tanshou") tickTanshou(c, state, terrain, rng);
    else if (c.species === "xuehuan") tickBurrowEvader(c, state, terrain, rng);
  }
}
