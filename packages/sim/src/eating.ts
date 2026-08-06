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
 *      每 tick 按 eatMeatPerSec×DT 消耗尸体 meat；hunger 的回复量额外叠加
 *      hungerDecayPerSec×DT，用来抵消同一 tick 里 tickNeeds 对所有生物一视同仁的饥饿衰减
 *      （tickNeeds 不再对 activity==="eating" 做任何特判——衰减对谁都一样，是否要抵消衰减
 *      只是"进食系统"自己的净值语义，只补偿正在进食的玩家自己，不会像 needs.ts 里
 *      的全局特判那样悄悄影响苓鼠 graze/潭狩 feed 的净回复速率）；
 *      移动输入打断进食（清空 feedingCarcassId；activity 已由更早执行的 movePlayer 改写为
 *      moving/idle，这里不重复处理）；尸体 meat 耗尽（<=0）从 state.carcasses 移除并清空
 *      feedingCarcassId。
 *
 * activity 生命周期（务必维护，否则会冻结衰减/显示错误状态）：本 tick 没有真正攻击或进食时，
 * 一律把残留的 "eating"/"attacking" 降级回 "idle"（镜像 tickDigging 松开 interact 就把
 * "digging" 落回 "idle" 的写法）；绝不touch "digging"/"moving"/"drinking"/"dead" ——那些
 * 由各自的系统负责（tickDigging 管 digging、movePlayer 管 moving、tickNeeds 管 drinking、
 * killCreature 管 dead）。旧版本的 bug：早退路径只清了 feedingCarcassId，没有降级
 * activity，导致"吃一口就松开 interact、原地不动"时 activity 永远停在 "eating"——如果
 * needs.ts 再按 activity 特判衰减（已撤销），饥饿衰减会被永久冻结。
 *
 * interactHeld 坑（务必读这段再改动判定逻辑）：tickDigging 在它自己的每一条分支末尾都会执行
 * `p.interactHeld = input.interact;`——哪怕玩家附近根本没有挖点/洞口。也就是说，等本系统
 * 读到 `p.interactHeld` 时，它已经在同一个 tick 里被 tickDigging 覆写成了当前 tick 的
 * input.interact，不再携带"上一 tick 的按键状态"，无法用来做边沿判断。因此本系统的攻击/
 * 进食判定一律直接读 input.interact（按住即持续触发，由各自的冷却/消耗节流），不复用
 * interactHeld——这也正是 brief 测试所验证的行为（连续 hold interact 但每次只在冷却好时
 * 命中一次）。
 *
 * 跨文件优先级坑（Finding 1 修复，务必读）：饮水（needs.ts tickNeeds）不在本文件内，是第四个
 * 消费者，之前完全没有接"是否存在攻击目标"这一判定——水边且 attackRange 内有活物时，
 * 攻击 tick 会把 activity 设成 "attacking"，但随后执行的 tickNeeds 只要 nearWater 就会把
 * activity 覆写成 "drinking" 并回复口渴，攻击的表现被吞掉、且冷却中的 tick（一秒 20 个 tick
 * 里 19 个）也会照常回水，等于水边战斗白嫖饮水。修复：本文件导出 hasAttackTargetInRange，
 * 与下面攻击分支共用同一份 findAttackTarget 扫描逻辑（单一事实来源，不允许两处各写一份判定
 * 漂移），needs.ts 的饮水守卫额外要求 !hasAttackTargetInRange(...)——只判"目标在不在范围
 * 内"，不判 activity（"activity !== 'attacking'" 这种写法在冷却 tick 上会失效，因为冷却中
 * 攻击分支会把 activity 降级成 idle，跟"没有攻击"完全同一个信号，必须直接查目标存在性）。
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
    demoteStaleActivity(p);
    return;
  }

  // 1) 攻击优先：attackRange 内最近的活着的非玩家生物，只要存在就压过进食。
  const atk = SPECIES.youshou!;
  const target = findAttackTarget(state, p);
  if (target) {
    if (p.feedingCarcassId !== null) p.feedingCarcassId = null;
    if (p.attackCooldown <= 0) {
      target.hp -= atk.attackDamage;
      p.attackCooldown = TUNING.attackCooldownSec;
      p.activity = "attacking";
      if (target.hp <= 0) killCreature(state, target);
    } else {
      // 范围内有目标但冷却未到：本 tick 没有真正出手，别让上一 tick 残留的
      // "eating"/"attacking" 继续挂着。
      demoteStaleActivity(p);
    }
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
    demoteStaleActivity(p);
    return;
  }

  const carcass = state.carcasses[carcassIdx]!;
  p.activity = "eating";
  p.feedingCarcassId = carcass.id;
  const eaten = Math.min(carcass.meat, TUNING.eatMeatPerSec * DT);
  carcass.meat -= eaten;
  // + hungerDecayPerSec*DT：抵消本 tick 稍后 tickNeeds 对玩家（和所有生物一样）无差别扣掉的
  // 饥饿衰减，让"进食中"的净回复量恰好等于 eaten*hungerPerMeat（brief 的验收公式）。
  // 只加在这里（进食者自己的这一次回复上），不改 needs.ts 的衰减规则，因此不会影响苓鼠
  // graze / 潭狩 feed 的净速率。
  p.needs.hunger = Math.min(100, p.needs.hunger + eaten * TUNING.hungerPerMeat + TUNING.hungerDecayPerSec * DT);
  if (carcass.meat <= 0) {
    state.carcasses = state.carcasses.filter((cc) => cc.id !== carcass.id);
    p.feedingCarcassId = null;
  }
}

/** 本 tick 没有真正攻击/进食时，把残留的 "eating"/"attacking" 降级回 "idle"；其它 activity 不动。 */
function demoteStaleActivity(p: Creature): void {
  if (p.activity === "eating" || p.activity === "attacking") p.activity = "idle";
}

/**
 * attackRange 内最近的、活着的非玩家生物（无则 null）——攻击目标判定的唯一实现。
 * 单一事实来源：上面的攻击分支与下面导出的 hasAttackTargetInRange（供 needs.ts 饮水守卫
 * 复用）都调用这个函数，不允许各自再写一份同样的扫描逻辑（会漂移）。
 */
function findAttackTarget(state: GameState, player: Creature): Creature | null {
  const atk = SPECIES.youshou!;
  let target: Creature | null = null;
  let targetDist = Infinity;
  for (const c of state.creatures) {
    if (c.id === player.id || c.activity === "dead" || c.burrowId !== null) continue;
    const d = dist2d(player.pos, c.pos);
    if (d <= atk.attackRange && d < targetDist) { target = c; targetDist = d; }
  }
  return target;
}

/**
 * 供 needs.ts 的饮水守卫复用：attackRange 内是否存在可攻击目标。只判"目标存在"，不判
 * p.activity——冷却中的 tick 里 activity 会被降级成 "idle"（demoteStaleActivity），跟"没有
 * 攻击目标"是同一个信号，若饮水守卫改成排除 activity==="attacking" 则冷却 tick 会漏判。
 */
export function hasAttackTargetInRange(state: GameState, player: Creature): boolean {
  return findAttackTarget(state, player) !== null;
}
