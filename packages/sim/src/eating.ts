import { SPECIES, TUNING } from "@shiling/content";
import { DT } from "./sim.js";
import { dist2d } from "./vec.js";
import { killCreature } from "./needs.js";
import type { Creature, GameState, PlayerInput } from "./state.js";
import type { Terrain } from "./terrain.js";

/**
 * 键位拆分（W2，playtest feedback「单一 E 键在重叠时无法选择操作」）：撕咬与情境交互
 * 现在各自绑一个独立字段——input.attack（左键）驱动攻击分支，input.interact（E）驱动
 * 进食分支——互不阻塞。旧版本两者共用 input.interact 一个字段，靠"没有攻击目标才轮到
 * 进食"这层隐藏优先级来消歧；键位拆开之后消歧不再需要（用户按哪个键，意图已经是显式
 * 的），所以下面两段判定各自独立跑，不再互相查对方的前置条件：
 *   1) 攻击：input.attack 且 attackRange 内有活着的非玩家生物 → 造成一次伤害并把冷却
 *      重置为 attackCooldownSec；不要求上升沿（按住即可持续判定，实际出手频率由冷却
 *      节流）。范围内存在目标但冷却未到时，仍保留 "attacking" 语义不降级——出手频率
 *      完全交给冷却节流，而不是让 activity 在每个冷却 tick 里来回闪烁。
 *   2) 进食：input.interact 且 interactRange 内有尸体 → activity="eating"，每 tick 按
 *      eatMeatPerSec×DT 消耗尸体 meat；hunger 的回复量额外叠加 hungerDecayPerSec×DT，
 *      用来抵消同一 tick 里 tickNeeds 对所有生物一视同仁的饥饿衰减（tickNeeds 不对
 *      activity==="eating" 做任何特判——衰减对谁都一样，是否要抵消衰减只是"进食系统"
 *      自己的净值语义，只补偿正在进食的玩家自己，不会像 needs.ts 里的全局特判那样悄悄
 *      影响苓鼠 graze/潭狩 feed 的净回复速率）；移动输入打断进食（清空 feedingCarcassId；
 *      activity 已由更早执行的 movePlayer 改写为 moving/idle，这里不重复处理）；尸体 meat
 *      耗尽（<=0）从 state.carcasses 移除并清空 feedingCarcassId。
 *
 * 两个分支若同一 tick 都成立（比如玩家同时按住左键和 E，且攻击目标恰好站在一具尸体
 * 附近）：攻击分支先跑，进食分支后跑，activity 字段是单值、后写的赢——这是刻意接受的
 * 边缘情形（现实操作里两键很少会被同时按住），不为此额外设计仲裁规则。
 *
 * activity 生命周期（务必维护，否则会冻结衰减/显示错误状态）：本 tick 没有真正攻击时，
 * 把残留的 "attacking" 降级回 "idle"；没有真正进食时，把残留的 "eating" 降级回 "idle"
 * （镜像 tickDigging 松开 interact 就把 "digging" 落回 "idle" 的写法）；两条降级逻辑各自
 * 独立、不联动。绝不touch "digging"/"moving"/"drinking"/"dead"——那些由各自的系统负责
 * （tickDigging 管 digging、movePlayer 管 moving、tickNeeds 管 drinking、killCreature 管
 * dead）。旧版本的 bug：早退路径只清了 feedingCarcassId，没有降级 activity，导致"吃一口
 * 就松开 interact、原地不动"时 activity 永远停在 "eating"——如果 needs.ts 再按 activity
 * 特判衰减（已撤销），饥饿衰减会被永久冻结。
 *
 * interactHeld 坑（务必读这段再改动判定逻辑）：tickDigging 在它自己的每一条分支末尾都会执行
 * `p.interactHeld = input.interact;`——哪怕玩家附近根本没有挖点/洞口。也就是说，等本系统
 * 读到 `p.interactHeld` 时，它已经在同一个 tick 里被 tickDigging 覆写成了当前 tick 的
 * input.interact，不再携带"上一 tick 的按键状态"，无法用来做边沿判断。因此本系统的进食
 * 判定一律直接读 input.interact（按住即持续触发，由消耗节流），不复用 interactHeld；
 * 攻击判定同理直接读 input.attack（按住即持续判定，由冷却节流）。
 *
 * 跨文件联动（needs.ts 的饮水守卫）：饮水不在本文件内，是第三个消费者，它的守卫现在直接
 * 读 input.attack（"举着左键就别喝水"），不再像键位拆分前那样需要反查本文件的攻击目标
 * 扫描结果——两个系统各自只认自己对应的输入字段，不再需要跨文件共享一份"攻击目标是否
 * 存在"的判定（旧版本导出的 hasAttackTargetInRange 已随之移除，见 git 历史）。
 *
 * 叼运联动（M1 postfix N1，见 carrying.ts）：
 *   - 攻击禁用：p.carryingCarcassId !== null 时攻击分支整体不判定（"叼着东西没法再
 *     腾出嘴撕咬"）——见下方攻击分支的守卫。
 *   - 叼着时按 E 仍能就地进食：不需要特判——carrying.ts 把叼着的尸体钉在
 *     interactRange 之内（偏移量小于 interactRange），本系统的尸体扫描天然会扫到它。
 *   - 储粮进食（stash）：interactRange 内没有真实尸体、但站在自己的巢穴附近且
 *     stash>0 时，作为进食分支的 fallback 从 state.homeNest.stash 里扣（见下方
 *     "carcassIdx < 0" 分支）。守卫顺序是刻意的——真实尸体永远优先于 stash（新鲜的
 *     肉"该先腐烂"，不该反而先动用囤积的存粮），只有附近确实没有物理尸体时才退而
 *     求其次吃储备。
 */
export function tickEating(state: GameState, terrain: Terrain, input: PlayerInput): void {
  const p = state.creatures.find((c) => c.id === state.playerId);
  if (!p || p.activity === "dead" || p.burrowId !== null) return;

  // 冷却是实时的，不受本 tick 是否真正出手影响，先统一递减。
  p.attackCooldown = Math.max(0, p.attackCooldown - DT);

  const moving = input.moveX !== 0 || input.moveZ !== 0;
  // dig spot 优先级更高，由 tickDigging 在本系统之前写好 activity；移动同样打断两条分支。
  const suppressed = moving || p.activity === "digging";

  // 1) 攻击：input.attack 独立判定，attackRange 内最近的活着的非玩家生物。
  // 叼着尸体时（carryingCarcassId !== null）整体禁用——见文件头"叼运联动"一节。
  if (!suppressed && input.attack && p.carryingCarcassId === null) {
    const atk = SPECIES.youshou!;
    const target = findAttackTarget(state, p);
    if (target) {
      if (p.attackCooldown <= 0) {
        target.hp -= atk.attackDamage;
        p.attackCooldown = TUNING.attackCooldownSec;
        p.activity = "attacking";
        if (target.hp <= 0) killCreature(state, target);
      }
      // 冷却中：范围内仍有目标，本 tick 没有真正出手但保留 "attacking" 语义不降级。
    } else if (p.activity === "attacking") {
      p.activity = "idle";
    }
  } else if (p.activity === "attacking") {
    p.activity = "idle";
  }

  // 2) 进食：input.interact 独立判定，interactRange 内最近的尸体。
  if (suppressed || !input.interact) {
    if (p.feedingCarcassId !== null) p.feedingCarcassId = null;
    if (p.activity === "eating") p.activity = "idle";
    return;
  }

  let carcassIdx = -1;
  let carcassDist = Infinity;
  for (let i = 0; i < state.carcasses.length; i++) {
    const d = dist2d(p.pos, state.carcasses[i]!.pos);
    if (d <= TUNING.interactRange && d < carcassDist) { carcassIdx = i; carcassDist = d; }
  }
  if (carcassIdx < 0) {
    // 储粮 fallback（M1 postfix N1）：附近没有真实尸体时，才轮到自己巢穴的存粮——
    // 守卫顺序见文件头"叼运联动"一节。同时要求站在 interactRange 内（贴着 dig spot
    // 本身，与真实尸体的判定用同一距离常量），不是"只要有家、随便多远都能吃"。
    if (state.homeNest && state.homeNest.stash > 0) {
      const spot = terrain.digSpots.find((s) => s.id === state.homeNest!.spotId);
      if (spot && dist2d(p.pos, spot.pos) <= TUNING.interactRange) {
        p.activity = "eating";
        if (p.feedingCarcassId !== null) p.feedingCarcassId = null; // stash 不是 Carcass，没有对应 id
        const eaten = Math.min(state.homeNest.stash, TUNING.eatMeatPerSec * DT);
        state.homeNest.stash -= eaten;
        // 与真实尸体进食同一公式（含 hungerDecayPerSec*DT 的衰减抵消，见下方原有注释）。
        p.needs.hunger = Math.min(100, p.needs.hunger + eaten * TUNING.hungerPerMeat + TUNING.hungerDecayPerSec * DT);
        return;
      }
    }
    if (p.feedingCarcassId !== null) p.feedingCarcassId = null;
    if (p.activity === "eating") p.activity = "idle";
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

/** attackRange 内最近的、活着的非玩家生物（无则 null）——攻击目标判定的唯一实现。 */
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
