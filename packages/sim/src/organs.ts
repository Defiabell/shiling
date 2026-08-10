import { ORGANS, TUNING, type OrganEffects, type OrganSlot } from "@shiling/content";
import { DT } from "./sim.js";
import type { GameState, PlayerInput } from "./state.js";

/** 乘子字段默认 1（不生效）、加数字段默认 0（不生效）——数据模型注释里的默认值。 */
const DEFAULT_MODIFIERS: Required<OrganEffects> = {
  walkSpeedMult: 1, swimSpeedMult: 1, sprintFatigueMult: 1,
  attackDamageAdd: 0, damageTakenMult: 1, digSpeedMult: 1,
  eatSpeedMult: 1, senseRadiusAdd: 0, preyNoticeMult: 1,
};

/**
 * 每个效果字段是"乘子"还是"加数"——用 `Record<keyof OrganEffects, ...>` 而不是两个手写
 * 数组，是为了让 TS 在新增/改名 OrganEffects 字段时强制这里也补一行（否则编译不过），
 * 不会像两个平行数组那样悄悄漏掉一个字段却不报错。MULT_KEYS/ADD_KEYS 从这张表派生。
 */
const EFFECT_KIND: Record<keyof OrganEffects, "mult" | "add"> = {
  walkSpeedMult: "mult", swimSpeedMult: "mult", sprintFatigueMult: "mult",
  damageTakenMult: "mult", digSpeedMult: "mult", eatSpeedMult: "mult", preyNoticeMult: "mult",
  attackDamageAdd: "add", senseRadiusAdd: "add",
};
const ALL_KEYS = Object.keys(EFFECT_KIND) as (keyof OrganEffects)[];
const MULT_KEYS = ALL_KEYS.filter((k) => EFFECT_KIND[k] === "mult");
const ADD_KEYS = ALL_KEYS.filter((k) => EFFECT_KIND[k] === "add");

/** state.organs 里已存在的槽位键（含没实际装备、值为 undefined 的槽——调用方自己判空）。 */
function organSlotKeys(state: GameState): (OrganSlot | "innate")[] {
  return Object.keys(state.organs) as (OrganSlot | "innate")[];
}

/**
 * 效果聚合（M1 B2 唯一入口，movement/eating/digging/ai 消费）。
 *
 * 输入是 GameState 而不是某个 Creature：organs 是玩家专属的全局字段（同 essence/
 * behaviorStats 一样挂在 state 上，不挂在 Creature 上，见 state.ts 的字段注释）——
 * 所以"对 NPC 恒返回默认值"这句话不需要在函数体内再判一次"这个生物是不是玩家"：
 * state.organs 天然只反映玩家的装备，调用方（ai.ts）只在明确知道"这次要算的是玩家"
 * 时才调用本函数（例如 tanshou 咬到的目标恰好是玩家、苓鼠这次探测到的威胁恰好是玩家），
 * 从未也不应该以 NPC 自身的名义调用它。
 *
 * 聚合规则：同一效果字段，乘子相乘、加数相加，跨所有已装备的槽（含 innate）；
 * 每一项先按该器官自身的 temper 缩放到"effective"值，再参与聚合——公式（数据模型
 * 正本）：
 *   乘子 effective = 1 + (v-1) * (temperScaleBase + temperScaleSpan * t/100)
 *   加数 effective = v * (temperScaleBase + temperScaleSpan * t/100)
 * 其中 v 是 OrganDef.effects 里满淬炼(temper=100)时的效果值，t 是当前 temper(0..100)。
 * 计算便宜，按需调用不缓存（brief 原话）。
 */
export function getModifiers(state: GameState): Required<OrganEffects> {
  const mods: Required<OrganEffects> = { ...DEFAULT_MODIFIERS };
  const scale = (t: number) => TUNING.temperScaleBase + TUNING.temperScaleSpan * (t / 100);

  for (const slotKey of organSlotKeys(state)) {
    const equipped = state.organs[slotKey];
    if (!equipped) continue;
    const def = ORGANS[equipped.organId];
    if (!def) continue; // 防御性：理论上不会发生（organId 总是来自 ORGANS 的 key）
    const s = scale(equipped.temper);

    for (const key of MULT_KEYS) {
      const v = def.effects[key];
      if (v === undefined) continue;
      mods[key] *= 1 + (v - 1) * s;
    }
    for (const key of ADD_KEYS) {
      const v = def.effects[key];
      if (v === undefined) continue;
      mods[key] += v * s;
    }
  }
  return mods;
}

/**
 * 某个具体器官（按 organId）当前是否装备在任意槽位（M15 P1，ai.ts 的 resolveHunt 用它
 * 判定目标玩家是否戴着棘背 jibei）。只有玩家有 organs（见 state.ts 字段注释），调用方
 * 因此只应该在明确知道"这次要判定的目标是玩家"时才调用——与 getModifiers 同一前提。
 * 遍历 state.organs 而不是直接读固定槽位（例如 `state.organs.back?.organId`）：
 * organId 与其登记的槽位键在数据模型上恒等（rollOrgan 只会把某个器官装进它自己
 * OrganDef.slot 对应的键），但按 id 整体扫描不依赖这条隐含假设，未来若某个器官的槽位
 * 定义变化也不需要回来改这里的判定逻辑。
 */
export function hasOrganEquipped(state: GameState, organId: string): boolean {
  return Object.values(state.organs).some((equipped) => equipped?.organId === organId);
}

/** 器官效果字段 → 用进触发类别（"写成器官→触发条件映射表常量"）。 */
type TriggerKind = "swim" | "sprint" | "dig" | "kill" | "eat" | "hit" | "passive";

const EFFECT_TRIGGERS: Record<keyof OrganEffects, TriggerKind> = {
  swimSpeedMult: "swim",
  walkSpeedMult: "sprint",
  sprintFatigueMult: "sprint",
  digSpeedMult: "dig",
  attackDamageAdd: "kill",
  eatSpeedMult: "eat",
  damageTakenMult: "hit",
  senseRadiusAdd: "passive",
  preyNoticeMult: "passive",
};

/**
 * 用进增长（M1 B2，统一在这里做，接进 step 序——见 sim.ts 的调用点注释）。
 *
 * 每个已装备器官按其 effects 拥有的字段，映射到上面 EFFECT_TRIGGERS 表里的一个或多个
 * "触发类别"（去重——同一器官若有两个字段映射到同一类别，例如疾足的 walkSpeedMult 和
 * sprintFatigueMult 都映射到 "sprint"，只按该类别贡献一次增量，不重复叠加）；每个
 * 触发类别本 tick 是否生效、生效时增量多少，见下表：
 *
 *   swim    —— 持续：本 tick locomotion==="swim"                     → temperGainPerSecUse*DT
 *   sprint  —— 持续：本 tick 冲刺条件成立（与 movement.ts 的真实冲刺  → temperGainPerSecUse*DT
 *              判定同一条件：input.sprint && 有位移 && fatigue 够 &&
 *              不在洞里）
 *   eat     —— 持续：本 tick p.activity==="eating"（只算洞外吃鲜尸这   → temperGainPerSecUse*DT
 *              一条活跃路径，镜像 essence 的"储粮不养精"设计——巢中
 *              自动吃 stash 不触发这条，见 eating.ts 头注）
 *   dig     —— 离散：本 tick behaviorStats.digCount 相比上次快照增加了 → temperGainDigComplete（一次性）
 *   kill    —— 离散：本 tick behaviorStats.kills 相比上次快照增加了   → temperGainKill（一次性）
 *   hit     —— 离散：本 tick state.hitsTaken 相比上次快照增加了       → temperGainHitTaken（一次性）
 *   passive —— 无条件：只要装备着就一直缓慢增长                        → temperGainPassivePerSec*DT
 *
 * "离散"类别用 organsPrevCounters 快照 diff 判定"这一 tick 新发生了一次"（这些计数器
 * 只增不减，且事件的产生点——digging.ts 的 spot.dug 翻转 tick、eating.ts 的击杀分支——
 * 都排在 tickTemper 之前执行，同一 tick 内可以看到最新值，不存在"晚一 tick 才发现"的
 * 延迟。唯一的例外是"hit"：伤害来自 ai.ts 的 tickAi，按 sim.ts 现在的顺序排在
 * tickTemper 之后，所以"被咬中"这个事件要等到下一 tick 的 tickTemper 才会被 diff 出来
 * ——一 tick=50ms 的延迟，游戏体感上不可感知，不是 bug）。
 *
 * clamp 到 [0,100]（数据模型要求）。
 */
export function tickTemper(state: GameState, input: PlayerInput): void {
  const p = state.creatures.find((c) => c.id === state.playerId);
  if (!p || p.activity === "dead") return;

  const prev = state.organsPrevCounters;
  const justDug = state.behaviorStats.digCount > prev.digCount;
  const justKilled = state.behaviorStats.kills > prev.kills;
  const justHit = state.hitsTaken > prev.hitsTaken;
  // 与 movement.ts 的 movePlayer 完全同一条件（重复这一行是为了不反向依赖 movement.ts，
  // 避免给 organs.ts 添一个不必要的模块依赖——这四个判定条件本身很稳定，不是易漂移的逻辑）。
  const isSprinting = input.sprint && (input.moveX !== 0 || input.moveZ !== 0)
    && p.needs.fatigue > TUNING.minSprintFatigue && p.burrowId === null;
  const isSwimming = p.locomotion === "swim";
  const isEatingFresh = p.activity === "eating";

  const gainFor: Record<TriggerKind, number> = {
    swim: isSwimming ? TUNING.temperGainPerSecUse * DT : 0,
    sprint: isSprinting ? TUNING.temperGainPerSecUse * DT : 0,
    eat: isEatingFresh ? TUNING.temperGainPerSecUse * DT : 0,
    dig: justDug ? TUNING.temperGainDigComplete : 0,
    kill: justKilled ? TUNING.temperGainKill : 0,
    hit: justHit ? TUNING.temperGainHitTaken : 0,
    passive: TUNING.temperGainPassivePerSec * DT,
  };

  for (const slotKey of organSlotKeys(state)) {
    const equipped = state.organs[slotKey];
    if (!equipped) continue;
    const def = ORGANS[equipped.organId];
    if (!def) continue;
    const kinds = new Set<TriggerKind>();
    for (const key of Object.keys(def.effects) as (keyof OrganEffects)[]) {
      kinds.add(EFFECT_TRIGGERS[key]);
    }
    let delta = 0;
    for (const kind of kinds) delta += gainFor[kind];
    if (delta !== 0) {
      equipped.temper = Math.max(0, Math.min(100, equipped.temper + delta));
    }
  }

  prev.digCount = state.behaviorStats.digCount;
  prev.kills = state.behaviorStats.kills;
  prev.hitsTaken = state.hitsTaken;
}
