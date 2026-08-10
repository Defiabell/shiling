import { SPECIES, TUNING, type SpeciesDef } from "@shiling/content";
import { norm2d } from "./vec.js";
import { DT } from "./sim.js";
import { getModifiers } from "./organs.js";
import type { Terrain } from "./terrain.js";
import type { Creature, GameState, PlayerInput } from "./state.js";

/**
 * 地形挡行判定，双向（M1 B4，溪鱼 xiyu 引入水生锁定后新增）：
 *   - 旱鸭子（canSwim=false）踏入水域被挡——既有的挡水守卫，M0 起就有。
 *   - 水生锁定（aquatic=true）踏上陆地被挡——上一条的镜像，SpeciesDef.aquatic 字段的
 *     唯一判定入口（见该字段注释）。
 * 导出供 ai.ts 的逃跑/追击方向探测复用（原来那两处各自手写了一份只覆盖前一条的判定，
 * 现在统一走这一个函数，双向逻辑不会在两处漂移）。
 */
export function isTerrainBlocked(def: SpeciesDef, terrain: Terrain, x: number, z: number): boolean {
  const water = terrain.isWater(x, z);
  if (!def.canSwim && water) return true;
  if (def.aquatic && !water) return true;
  return false;
}

/**
 * 通用运动学移动：走/游自动切换、贴地、边界 clamp。也供 AI 使用。
 * speedScale（默认 1）：M0.5 postfix-3 为 lingshu 逃跑疲态新增的乘数出口——
 * norm2d 会把 dirX/dirZ 归一化，直接缩放方向向量的模长不起作用，所以疲态减速
 * 必须走这个显式参数，而不是塞进 dirX/dirZ 里。
 * `bypassSprintFatigueFloor`（M15 P1，默认 false）：濒死爆发窗口内冲刺不再要求
 * `fatigue > minSprintFatigue` 才生效——code review 用真实 sim 跑出的复现：玩家几乎
 * 总是"刚冲刺逃命、被咬中跌破阈值"这个顺序触发爆发，此刻疲劳大概率已经跌到底线
 * (0~5)，若冲刺加速本身仍要求疲劳过线，"冲刺不耗疲劳"这条 brief 承诺就是空话——没有
 * 消耗可省，但冲刺压根不生效，速度只剩裸的 adrenalineSpeedMult(1.3x)，拿不到
 * sprintMultiplier(1.85x) 叠乘。只有玩家会传 true（见 movePlayer），NPC 调用点全部
 * 显式传 `sprint=false`（NPC 从不冲刺，见 ai.ts 各 do* 函数），该参数因此对 NPC 路径
 * 完全惰性，不改变任何既有行为。
 */
export function moveCreature(
  c: Creature,
  dirX: number,
  dirZ: number,
  sprint: boolean,
  terrain: Terrain,
  speedScale = 1,
  bypassSprintFatigueFloor = false,
): void {
  if (c.burrowId !== null || c.activity === "dead") return;
  // 陷坑定身（M15 P1，见 pits.ts）：与 burrowId/dead 同一"整体早退"处理——不改
  // activity/locomotion，纯粹是"这一 tick 不产生任何位移"。倒数本身由 ai.ts 的
  // tickTanshou 在自己的 attackCooldown 递减旁边一并处理，本函数只做纯的位置早退，
  // 不在这里做任何状态倒计时的副作用（同 burrowId!==null 分支一样是无副作用的纯判定）。
  if (c.snaredTicks > 0) return;
  const def = SPECIES[c.species]!;
  const half = terrain.size / 2;
  // 边界 clamp 对"当前"位置无条件生效（不止对本 tick 的移动目标位置）——否则外部
  // 把某个生物的 pos 直接改到界外（例如测试把玩家钉在旁观角落）后，只要它本 tick
  // 恰好是零方向输入（idle），就会一直停在界外，永远等不到下一次"有方向输入"的
  // clamp 分支来把它拉回来。这里在函数最开头统一收口，保证"位置永远落在世界范围内"
  // 是 moveCreature 的无条件不变量，和函数注释里写的"边界 clamp"一致。
  c.pos.x = Math.max(-half, Math.min(half, c.pos.x));
  c.pos.z = Math.max(-half, Math.min(half, c.pos.z));
  const { x: nx, z: nz } = norm2d(dirX, dirZ);
  if (nx === 0 && nz === 0) {
    if (c.activity === "moving") c.activity = "idle";
    // 静止时也要按当前位置同步 locomotion/贴地高度（例如站在水里不动仍应是 swim）。
    const stillInWater = terrain.isWater(c.pos.x, c.pos.z);
    c.locomotion = stillInWater ? "swim" : "walk";
    c.pos.y = stillInWater ? terrain.waterLevel : terrain.heightAt(c.pos.x, c.pos.z);
    return;
  }
  const inWater = terrain.isWater(c.pos.x, c.pos.z);
  let speed = inWater ? def.swimSpeed : def.walkSpeed;
  if (sprint && (bypassSprintFatigueFloor || c.needs.fatigue > TUNING.minSprintFatigue)) speed *= TUNING.sprintMultiplier;
  speed *= speedScale;
  const tx = Math.max(-half, Math.min(half, c.pos.x + nx * speed * DT));
  const tz = Math.max(-half, Math.min(half, c.pos.z + nz * speed * DT));
  if (isTerrainBlocked(def, terrain, tx, tz)) {
    // 挡在岸边（双向，见 isTerrainBlocked）：位置不变，但仍要按当前（未位移）位置同步
    // locomotion/pos.y，并把 activity 从 "moving" 回落 "idle"（不动就不该停留在 moving 状态）。
    if (c.activity === "moving") c.activity = "idle";
    c.locomotion = inWater ? "swim" : "walk";
    c.pos.y = inWater ? terrain.waterLevel : terrain.heightAt(c.pos.x, c.pos.z);
    return;
  }
  c.pos.x = tx; c.pos.z = tz;
  const nowWater = terrain.isWater(tx, tz);
  c.locomotion = nowWater ? "swim" : "walk";
  c.pos.y = nowWater ? terrain.waterLevel : terrain.heightAt(tx, tz);
  c.yaw = Math.atan2(nx, nz);
  c.activity = "moving";
}

export function movePlayer(state: GameState, terrain: Terrain, input: PlayerInput): void {
  const p = state.creatures.find((c) => c.id === state.playerId);
  if (!p || p.activity === "dead") return;
  // 蛰伏中（M1 B3）：玩家专属输入系统整体锁死，见 dormancy.ts 头部注释——本系统只做
  // 早退，state.dormancy 本身的推进/清空完全由 tickDormancy（排在本系统之前）负责。
  if (state.dormancy !== null) return;
  // organ modifier（M1 B2）：walkSpeedMult/swimSpeedMult 按玩家"当前"是否在水里二选一
  // ——探测口径与 moveCreature 内部的 `terrain.isWater(c.pos...)` 完全一致（同一 tick、
  // 同一起始位置），跟冲刺乘数不同，这两个是"地形二选一"而不是"都乘一遍"。
  const mods = getModifiers(state);
  const inWaterNow = terrain.isWater(p.pos.x, p.pos.z);
  const organSpeedMult = inWaterNow ? mods.swimSpeedMult : mods.walkSpeedMult;
  // 濒死爆发（M15 P1，adrenaline.ts）：窗口内整体速度再乘一档，与叼运减速/器官乘数一样
  // 走同一个 speedScale 出口——四者都是乘法组合，顺序无关。无条件生效（不要求正在冲刺，
  // 见 tuning.ts 对 adrenalineSpeedMult 的注释："speed×1.3 and sprint costs no fatigue"
  // 是两条独立的效果，前者不看是否在冲刺）。
  const adrenalineActive = state.adrenalineTicks > 0;
  const speedScale =
    (p.carryingCarcassId !== null ? TUNING.carrySpeedMult : 1) *
    organSpeedMult *
    (adrenalineActive ? TUNING.adrenalineSpeedMult : 1);
  // code review 修正：窗口内冲刺不该再要求 fatigue>minSprintFatigue 才生效——见
  // moveCreature 的 bypassSprintFatigueFloor 参数头部注释，下面判断"是否要跳过疲劳
  // 扣减"的这道门槛同理放宽，两处必须保持同一个布尔值，否则会出现"冲刺确实提速了，
  // 但疲劳扣减判断那边仍然认为没在冲刺"的自相矛盾。
  moveCreature(p, input.moveX, input.moveZ, input.sprint, terrain, speedScale, adrenalineActive);
  // behaviorStats.swimSec（M1 B1，consumed by B3 roll）：看 locomotion 本身而不是"是否在
  // 移动"——moveCreature 的零输入/挡水分支同样会同步 locomotion，站在水里不动也算"泡着"。
  // 洞中不会误计：enterBurrow 把 locomotion 钉成 "burrow"，moveCreature 对洞中生物是
  // no-op，不会把它改回 "swim"。
  if (p.locomotion === "swim") state.behaviorStats.swimSec += DT;
  // burrowId !== null：moveCreature 对洞中生物直接 no-op（不产生位移），冲刺不该在洞里也扣疲劳
  // ——client 端会屏蔽洞中的移动/冲刺输入，但 sim 是权威层，这里不加守卫就是一个 sim 级漏洞
  // （被客户端输入屏蔽掩盖，直接调 sim 或客户端校验被绕过时仍会白扣疲劳）。
  if (input.sprint && (input.moveX !== 0 || input.moveZ !== 0) && (adrenalineActive || p.needs.fatigue > TUNING.minSprintFatigue) && p.burrowId === null) {
    // 濒死爆发：窗口内冲刺不耗疲劳（brief 原话"sprint costs no fatigue"）——跳过下面的
    // 扣减，但仍照常计入 behaviorStats.sprintSec（冲刺行为本身确实发生了，只是没有代价）。
    if (!adrenalineActive) {
      // organ modifier（M1 B2）：sprintFatigueMult（疾足/平衡尾）缩放疲劳消耗速率。
      p.needs.fatigue = Math.max(0, p.needs.fatigue - TUNING.fatigueSprintPerSec * mods.sprintFatigueMult * DT);
    }
    // behaviorStats.sprintSec（M1 B1，consumed by B3 roll）：与疲劳消耗同一条件——这个
    // 分支被走到就是冲刺"实际生效"的定义（单纯按住 sprint 键但不满足前置条件不算）。
    state.behaviorStats.sprintSec += DT;
  }
}
