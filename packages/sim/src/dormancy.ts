import {
  ORGANS,
  ORGAN_LIST,
  SPECIES,
  TUNING,
  type EssenceType,
  type OrganDef,
  type OrganEffects,
  type OrganSlot,
} from "@shiling/content";
import { DT } from "./sim.js";
import type { Rng } from "./rng.js";
import type { Creature, GameState, PlayerInput } from "./state.js";

/**
 * 蛰伏蜕变（M1 B3，见 docs/plans/shiling/2026-08-10-m1-evolution-plan.md 数据模型/B3 一节）。
 *
 * 触发（V 边沿，镜像 carryHeld/interactHeld 的边沿检测惯例，见 Creature.dormantHeld）：
 * 在自己家巢洞内（p.burrowId === state.homeNest.spotId）＋任一精气 ≥ essenceThreshold(60)
 * ＋stash ≥ dormancyStashCost(20)，三者缺一不可——见 isDormancyEligible 的三条早退。
 *
 * 进行中（state.dormancy = { ticksLeft }）：玩家专属输入系统整体锁死——movement/digging/
 * eating/carrying 各自在自己文件顶部加一行 `if (state.dormancy !== null) return;`（"least
 * invasive wiring"，本文件不反向 import 那四个系统，只由它们各自的守卫读 state.dormancy）。
 * tickTemper/tickAi/tickNeeds 刻意不锁：
 *   - tickAi 对洞中生物本就无条件跳过（ai.ts 顶部 `c.burrowId !== null` continue），与
 *     蛰伏本身无关，是既有行为的自然结果。
 *   - tickTemper 的被动缓慢增长（sense/prey 系）蛰伏中继续生效——睡着也在缓慢淬炼，不是
 *     漏挡，其余触发类别（swim/sprint/dig/eat）因为对应系统已经整体 skip，天然不会命中。
 *   - tickNeeds 提供饥饿的"基础 1x"衰减、全部疲劳恢复（p.burrowId!==null 已经命中
 *     burrowFatigueRecoverPerSec）、口渴衰减与饿死判定，蛰伏不改变这条路径——本文件只在
 *     它之前（tickDormancy 排在 step() 最前面）再叠一份"额外 0.5x"衰减 + 储粮补偿
 *     （见 feedFromStash），两者相加正好是 brief 要求的 1.5x。
 *
 * 中断：每 tick 先检查 stash>0，一旦耗尽（燃料耗尽——储粮是蛰伏期间维持代谢的唯一燃料）
 * 立即中断：不开奖、精气不倒扣（已经花掉的储粮燃料不退，但开奖的"入场费"——主导精气/
 * stash 各一份——只在真正完成蛰伏、调用 rollOrgan 那一刻才扣，中途 abort 因此不会让玩家
 * 两头受损，只是这次没能换来器官）。
 *
 * 完成：ticksLeft 归零触发 rollOrgan（见该函数文档）。
 *
 * 已知设计缺口（code review 2026-08-10 提出，刻意未在本批修复——plan/brief 的措辞只提到
 * 用 stash 补偿"饥饿"衰减，从未提过口渴）：蛰伏中口渴仍按 tickNeeds 的正常速率无补偿地
 * 衰减，且没有任何手段中途取消蛰伏（V 在 state.dormancy!==null 期间不再被读作触发信号，
 * 见 tickDormancy）——如果玩家带着偏低的口渴值入睡，45 秒里可能真的渴死（needs.ts 的
 * starve 分支对玩家一视同仁）。这是产品决策而非 bug（"蛰伏有风险"也可能是刻意的玩法张力），
 * 留给后续批次/owner 判断是否要加门槛或补偿，本批不擅自扩大 B3 的既定范围。
 */

/** 任一精气达到开奖门槛。 */
function anyEssenceReady(essence: Record<EssenceType, number>): boolean {
  return (Object.keys(essence) as EssenceType[]).some((t) => essence[t] >= TUNING.essenceThreshold);
}

/** 数值最大的精气类型（并列时取 Object.keys 遍历顺序里先出现的一项，确定性）。 */
function dominantEssenceType(essence: Record<EssenceType, number>): EssenceType {
  const types = Object.keys(essence) as EssenceType[];
  let best = types[0]!;
  for (const t of types) if (essence[t] > essence[best]) best = t;
  return best;
}

/**
 * 触发条件的纯判定（不含 V 边沿本身）：在自己家巢洞内＋任一精气达标＋stash 达标。导出
 * 给 client 的 HUD 用（main.ts 的 computeHudContext 消费，决定「V 蛰伏」提示是否显示），
 * 避免在 client 侧重复一份精气/stash 阈值判断——sim 是这条判据唯一的权威来源。
 */
export function isDormancyEligible(state: GameState): boolean {
  const p = state.creatures.find((c) => c.id === state.playerId);
  if (!p || p.burrowId === null) return false;
  if (state.homeNest === null || p.burrowId !== state.homeNest.spotId) return false;
  if (!anyEssenceReady(state.essence)) return false;
  return state.homeNest.stash >= TUNING.dormancyStashCost;
}

function tryTriggerDormancy(state: GameState): void {
  if (!isDormancyEligible(state)) return;
  state.dormancy = { ticksLeft: Math.round(TUNING.dormancySec * TUNING.tickHz) };
}

/**
 * 蛰伏期间的饥饿结算：tickNeeds 稍后本 tick 仍会跑一次基础 1x 衰减（不受蛰伏影响，见
 * 文件头注释），本函数只补上额外的 (mult-1)x，并按标准换算公式（meat×hungerPerMeat）从
 * stash 里全额买回这 mult 倍衰减的份额，让蛰伏期间的饥饿基本持平（只要 stash 撑得住）
 * ——这正是"存粮供给睡眠"的燃料语义，与 eating.ts 的家巢自动进食公式同源，只是衰减/
 * 补偿的倍率从 1 换成了 TUNING.dormancyHungerDecayMult。
 *
 * 不足全额补偿时（consumed < meatNeeded）净饥饿仍会下降，直到下一 tick 顶部的
 * `stash<=0` 判定为真才真正中断——不在这里提前中断，保持单一入口（tickActiveDormancy）。
 */
function feedFromStash(nest: NonNullable<GameState["homeNest"]>, p: Creature): void {
  const mult = TUNING.dormancyHungerDecayMult;
  const extraDecay = TUNING.hungerDecayPerSec * (mult - 1) * DT; // tickNeeds 稍后再叠基础 1x，凑够 mult 倍
  const meatNeeded = (TUNING.hungerDecayPerSec * mult * DT) / TUNING.hungerPerMeat;
  const consumed = Math.min(nest.stash, meatNeeded);
  nest.stash -= consumed;
  p.needs.hunger = Math.min(100, Math.max(0, p.needs.hunger - extraDecay + consumed * TUNING.hungerPerMeat));
}

function tickActiveDormancy(state: GameState, dormancy: { ticksLeft: number }, p: Creature, rng: Rng): void {
  const nest = state.homeNest;
  if (nest === null || nest.stash <= 0) {
    // 燃料耗尽（或家巢理论上不该发生的丢失）——中断：不开奖，精气保留，见文件头设计理由。
    // 立即清空是安全的：此刻 stash<=0，eating.ts 家巢自动进食分支的守卫本身也要求
    // stash>0 才会跑，本 tick 稍后不会重复扣费（与下面"完成"分支的处境不同，见那里的注释）。
    state.dormancy = null;
    return;
  }
  feedFromStash(nest, p);
  dormancy.ticksLeft -= 1;
  if (dormancy.ticksLeft <= 0) {
    rollOrgan(state, rng);
    // 刻意不在这里把 state.dormancy 清空——完成的这一 tick 里，movePlayer/tickDigging/
    // tickEating/tickCarrying 仍会在 tickDormancy 返回之后紧接着跑（它排在 step() 最
    // 前面）。若这里立刻清空，eating.ts 的家巢自动进食分支会看到"未在蛰伏"，对刚刚
    // feedFromStash 结算过、可能仍 >0 的 stash 在同一 tick 里又吃一口——一个真实验证过
    // 的 double-feed bug（code review 2026-08-10 用真实 sim 跑出 stash 多扣了
    // eatMeatPerSec*DT 那一份）。真正的解锁延后到下一 tick 的 tickDormancy 顶部（见
    // 该函数 ticksLeft<=0 分支），只让"完成"这一 tick 的四个玩家系统仍然完整早退，
    // 代价是解锁多等一个 tick（50ms，不可感知）。
  }
}

/**
 * 蛰伏系统主入口，接进 sim.ts step() 的最前面（排在 movePlayer 之前——见该文件调用点
 * 注释）。边沿检测与 carryHeld/interactHeld 同一惯例：只在 V 从"未按住"翻到"按住"的
 * 那一 tick 才尝试触发，长按不会每 tick 重试一次（触发条件本身也具备幂等性，重试无害，
 * 但边沿检测是本工程统一的既有写法，这里不特例）。
 */
export function tickDormancy(state: GameState, input: PlayerInput, rng: Rng): void {
  const p = state.creatures.find((c) => c.id === state.playerId);
  if (!p || p.activity === "dead") return;

  if (state.dormancy !== null) {
    if (state.dormancy.ticksLeft <= 0) {
      // 上一 tick 已经完成蜕变（rollOrgan 已经跑过，见 tickActiveDormancy 的注释）——
      // 现在才真正解锁，避免在完成的那一 tick 里被 eating.ts 的自动进食"补一刀"。
      state.dormancy = null;
      p.dormantHeld = input.dormant;
      return;
    }
    tickActiveDormancy(state, state.dormancy, p, rng);
    p.dormantHeld = input.dormant;
    return;
  }

  if (input.dormant && !p.dormantHeld) tryTriggerDormancy(state);
  p.dormantHeld = input.dormant;
}

/** 器官效果字段 → B3 开奖行为偏置类别；与 organs.ts 的 EFFECT_TRIGGERS（用进增长用途）
 *  结构相似但语义/公式完全独立，不合并成共享表——一个是"增长速率"，一个是"开奖权重"。 */
type BiasKind = "swim" | "dig" | "sprint" | "kill";

const BIAS_KEYS: Record<BiasKind, (keyof OrganEffects)[]> = {
  swim: ["swimSpeedMult"],
  dig: ["digSpeedMult"],
  sprint: ["walkSpeedMult", "sprintFatigueMult"],
  kill: ["attackDamageAdd"],
};

function biasFactor(kind: BiasKind, stats: GameState["behaviorStats"]): number {
  switch (kind) {
    case "swim":
      return 1 + stats.swimSec / 300;
    case "dig":
      return 1 + stats.digCount / 20;
    case "sprint":
      return 1 + stats.sprintSec / 300;
    case "kill":
      return 1 + stats.kills / 15;
  }
}

/**
 * 单个器官的行为偏置乘数：命中的类别（可能不止一个，例如掘爪同时有 digSpeedMult 和
 * attackDamageAdd）各自的因子相乘——与 organs.ts tickTemper 的去重惯例一致（同一类别内
 * 的多个字段只算一次，跨类别则都要计入乘积），没有命中任何类别时恒为 1（"others ×1"）。
 */
function behaviorBiasFor(def: OrganDef, stats: GameState["behaviorStats"]): number {
  const kinds = new Set<BiasKind>();
  for (const key of Object.keys(def.effects) as (keyof OrganEffects)[]) {
    for (const kind of Object.keys(BIAS_KEYS) as BiasKind[]) {
      if (BIAS_KEYS[kind].includes(key)) kinds.add(kind);
    }
  }
  let mult = 1;
  for (const kind of kinds) mult *= biasFactor(kind, stats);
  return mult;
}

/** affinity·essence 点积——精气构成越偏向该器官的亲和方向，权重越高。 */
function affinityDot(def: OrganDef, essence: Record<EssenceType, number>): number {
  let sum = 0;
  for (const t of Object.keys(essence) as EssenceType[]) sum += (def.affinity[t] ?? 0) * essence[t];
  return sum;
}

/**
 * 五因子权重的纯函数核心（不含 rng，可直接单测断言）：
 *   weight = affinity·essence（点积） × behaviorBias × occupiedSlotPenalty
 * occupiedSlotPenalty 只在该器官所在槽已经装了别的器官时打折
 * （TUNING.rollOccupiedSlotPenalty），空槽是 1（不打折）。导出供测试直接断言权重计算，
 * 也是 rollOrgan 内部唯一的权重来源。
 */
export function computeRollWeights(state: GameState): Record<string, number> {
  const weights: Record<string, number> = {};
  for (const def of ORGAN_LIST) {
    const occupied = state.organs[def.slot] !== undefined;
    weights[def.id] =
      affinityDot(def, state.essence) *
      behaviorBiasFor(def, state.behaviorStats) *
      (occupied ? TUNING.rollOccupiedSlotPenalty : 1);
  }
  return weights;
}

/** 加权抽取一个器官 id；权重总和 <=0（极端构造，正常触发路径下不会发生——essence 至少
 *  有一项 ≥60 时,只要还有器官对该类型有亲和,点积必然>0）时退化为等概率。
 *  判定用"消费前"的 `r < weights[id]`（而不是先减后判 `<=0`）：即便 rng.next() 精确
 *  命中 0（理论上限概率 ~1/2^32，code review 2026-08-10 提出），r=0 也不会误选一个
 *  权重恰为 0 的候选——0<0 为假，循环会正确跳到下一个权重>0 的候选。 */
function pickWeighted(weights: Record<string, number>, rng: Rng): string {
  const ids = ORGAN_LIST.map((o) => o.id);
  const total = ids.reduce((sum, id) => sum + weights[id]!, 0);
  if (total <= 0) return ids[rng.int(ids.length)]!;
  let r = rng.next() * total;
  for (const id of ids) {
    if (r < weights[id]!) return id;
    r -= weights[id]!;
  }
  return ids[ids.length - 1]!; // 浮点误差兜底：理论上循环内必然命中
}

/**
 * 五因子开奖（M1 B3，dormancy 蜕变完成时调用）：候选池=ORGAN_LIST（12 个可替换器官，不含
 * 本命，见 computeRollWeights）；roll 用注入 rng（确定性，同 seed 同输入序列同结果）。
 *
 * 装备：占用则替换（旧器官消失，只记 id，不保留旧 temper——器官不能"收纳"，M1 没有仓库
 * 系统，是刻意的简化）。初始 temper = 20+30×quality，quality 在"醒来那一刻"（本函数被
 * 调用的这一刻，蛰伏期间的储粮补偿已经结算完）取 hp/needs 现值三者均值。
 *
 * 消耗：主导精气（数值最大的那一项）−essenceThreshold、stash −dormancyStashCost，两者都
 * clamp 在 0——蛰伏期间的储粮燃料消耗（feedFromStash）可能已经把 stash 吃到低于
 * dormancyStashCost（例如恰好以 20 存粮触发、45 秒燃料耗掉大半），这里不允许倒扣出负数。
 *
 * 导出（不只是内部消费）：测试需要独立于"跑完 45 秒蛰伏"这条慢路径，直接调用本函数验证
 * roll 确定性/消耗/替换记录；tickActiveDormancy 是唯一的生产调用点。
 */
export function rollOrgan(state: GameState, rng: Rng): void {
  const p = state.creatures.find((c) => c.id === state.playerId);
  if (!p) return; // 防御性：玩家理论上永远存在于 creatures[]（killCreature 从不移除玩家）

  const weights = computeRollWeights(state);
  const organId = pickWeighted(weights, rng);
  const def = ORGANS[organId]!;
  const slot = def.slot as OrganSlot; // ORGAN_LIST 已排除 innate，候选池里的 slot 必属六个可替换槽之一

  const maxHp = SPECIES[p.species]!.maxHp;
  const quality = (p.hp / maxHp + p.needs.hunger / 100 + p.needs.thirst / 100) / 3;
  const temper = 20 + 30 * quality;

  const replacedId = state.organs[slot]?.organId ?? null;
  state.organs[slot] = { organId, temper };

  const dominant = dominantEssenceType(state.essence);
  state.essence[dominant] = Math.max(0, state.essence[dominant] - TUNING.essenceThreshold);
  if (state.homeNest) state.homeNest.stash = Math.max(0, state.homeNest.stash - TUNING.dormancyStashCost);

  state.lastEvolution = { organId, slot, replacedId, tick: state.tick };
}
