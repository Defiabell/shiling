import { SPECIES, TUNING } from "@shiling/content";
import { DT } from "./sim.js";
import { dist2d } from "./vec.js";
import { killCreature } from "./needs.js";
import type { Creature, GameState, PlayerInput } from "./state.js";
import type { Terrain } from "./terrain.js";

/**
 * 玩家 interact 情境动作之三（优先级：dig spot > 攻击 > 尸体 > 饮水；四个消费者各自在自己的
 * 系统里守卫前置条件，按 sim.step 的执行顺序先到先得——本系统排在 tickDigging 之后、
 * tickAi/tickNeeds 之前）：
 *   1) 攻击：interact 且 attackRange 内有活着的非玩家生物 → 造成一次伤害并把冷却重置为
 *      attackCooldownSec；不要求上升沿（按住即可持续判定，实际出手频率由冷却节流），
 *      且只要范围内存在目标就压过进食（哪怕本 tick 恰好在冷却中、未能真正出手）。
 *   2) 进食：interact 且 interactRange 内有尸体（且没有攻击目标）→ activity="eating"，
 *      每 tick 按 eatMeatPerSec×DT 消耗尸体 meat，hunger += 消耗量×hungerPerMeat（clamp 100）；
 *      移动输入打断进食（清空 feedingCarcassId；activity 已由更早执行的 movePlayer 改写为
 *      moving/idle，这里不重复处理）；尸体 meat 耗尽（<=0）从 state.carcasses 移除并清空
 *      feedingCarcassId。
 *
 * interactHeld 坑（务必读这段再改动判定逻辑）：tickDigging 在它自己的每一条分支末尾都会执行
 * `p.interactHeld = input.interact;`——哪怕玩家附近根本没有挖点/洞口。也就是说，等本系统
 * 读到 `p.interactHeld` 时，它已经在同一个 tick 里被 tickDigging 覆写成了当前 tick 的
 * input.interact，不再携带"上一 tick 的按键状态"，无法用来做边沿判断。因此本系统的攻击/
 * 进食判定一律直接读 input.interact（按住即持续触发，由各自的冷却/消耗节流），不复用
 * interactHeld——这也正是 brief 测试所验证的行为（连续 hold interact 但每次只在冷却好时
 * 命中一次）。
 */
// terrain 参数仅为与其它 tick* 系统保持一致的签名（本系统的攻击/进食判定不需要地形信息）。
export function tickEating(state: GameState, terrain: Terrain, input: PlayerInput): void {
  const p = state.creatures.find((c) => c.id === state.playerId);
  if (!p || p.activity === "dead" || p.burrowId !== null) return;

  // 冷却是实时的，不受本 tick 是否真正出手影响，先统一递减。
  p.attackCooldown = Math.max(0, p.attackCooldown - DT);

  const moving = input.moveX !== 0 || input.moveZ !== 0;
  // 移动、正在挖洞（dig spot 优先级更高，由 tickDigging 在本系统之前写好 activity）、
  // 或未按 interact：都应打断进食，且不进入攻击/进食判定。
  if (moving || p.activity === "digging" || !input.interact) {
    if (p.feedingCarcassId !== null) p.feedingCarcassId = null;
    return;
  }

  // 1) 攻击优先：attackRange 内最近的活着的非玩家生物，只要存在就压过进食。
  const atk = SPECIES.youshou!;
  let target: Creature | null = null;
  let targetDist = Infinity;
  for (const c of state.creatures) {
    if (c.id === p.id || c.activity === "dead" || c.burrowId !== null) continue;
    const d = dist2d(p.pos, c.pos);
    if (d <= atk.attackRange && d < targetDist) { target = c; targetDist = d; }
  }
  if (target) {
    if (p.attackCooldown <= 0) {
      target.hp -= atk.attackDamage;
      p.attackCooldown = TUNING.attackCooldownSec;
      p.activity = "attacking";
      if (target.hp <= 0) killCreature(state, target);
    }
    if (p.feedingCarcassId !== null) p.feedingCarcassId = null;
    return;
  }

  // 2) 进食：interactRange 内最近的尸体，持续消耗 meat 回复 hunger。
  let carcassIdx = -1;
  let carcassDist = Infinity;
  for (let i = 0; i < state.carcasses.length; i++) {
    const d = dist2d(p.pos, state.carcasses[i]!.pos);
    if (d <= TUNING.interactRange && d < carcassDist) { carcassIdx = i; carcassDist = d; }
  }
  if (carcassIdx < 0) {
    if (p.feedingCarcassId !== null) p.feedingCarcassId = null;
    return;
  }

  const carcass = state.carcasses[carcassIdx]!;
  p.activity = "eating";
  p.feedingCarcassId = carcass.id;
  const eaten = Math.min(carcass.meat, TUNING.eatMeatPerSec * DT);
  carcass.meat -= eaten;
  p.needs.hunger = Math.min(100, p.needs.hunger + eaten * TUNING.hungerPerMeat);
  if (carcass.meat <= 0) {
    state.carcasses = state.carcasses.filter((cc) => cc.id !== carcass.id);
    p.feedingCarcassId = null;
  }
}
