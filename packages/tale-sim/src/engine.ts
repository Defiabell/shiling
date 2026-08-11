/**
 * 《食灵·列传》回合制确定性引擎。
 *
 * ## 不可变约定（CRITICAL，B2/B3 都靠它）
 * 所有导出函数都是**纯函数**：读入 `TaleState`，返回**新的** `TaleState`，绝不就地修改
 * 入参。调用方**不得依赖旧引用**（旧 state 仍然有效，但不再是「当前」状态），也不得
 * 就地修改返回值 —— 引擎不做 `Object.freeze`（省掉深冻结开销），靠约定。
 *
 * ## 确定性
 * 唯一随机源是 `TaleState.rngState`（mulberry32，见 rng.ts）。禁 `Date.now`／
 * `Math.random`／DOM。同一 seed ＋同一操作序列（行动/抉择/战斗指令）必然得到同一终态。
 *
 * ## 保留 flag
 * 引擎用三个 `sys:` 前缀 flag 承载 `TaleState` 里没有专用字段的状态（接口正本的
 * TaleState 无饿死计数器、无诈术蓄势位、无登神门槛位）。内容侧可以在 `requiresFlags`
 * 里**读**它们，但不要在 `addFlags`／`removeFlags` 里写。
 */

import { createCursor, weightedPick, weightedSample, type RngCursor } from "./rng.js";
import { ENGINE_MESSAGES, render } from "./messages.js";
import type {
  ActionId,
  ChronicleEntry,
  ChroniclePraiseVariant,
  ChronicleTemplates,
  EffectDelta,
  EnemyDef,
  EndingType,
  EssenceType,
  EventChoice,
  LifeRecord,
  OrganDef,
  Season,
  SeedDef,
  Stats,
  TaleEvent,
  TaleState,
  TaleTuning,
} from "./types.js";

// ===== 依赖注入 =====

/** 引擎的全部内容依赖。B2 的导出聚合成此对象（`TALE_CONTENT`）。 */
export interface TaleContent {
  events: TaleEvent[];
  organs: OrganDef[];
  seeds: SeedDef[];
  enemies: EnemyDef[];
  tuning: TaleTuning;
  /** 结构见 types.ts 的 ChronicleTemplates，composeChronicle 消费 */
  chronicleTemplates: ChronicleTemplates;
}

// ===== 返回值类型 =====

/** `performAction` 的结果。`pendingEvent` 非 null 时界面须先渲染事件卡并调 `resolveChoice`。 */
export interface TurnResult {
  state: TaleState;
  pendingEvent: TaleEvent | null;
  notices: string[];
  moltResult: MoltResult | null;
}

/**
 * 蛰伏开奖结果。`candidates` 是加权抽出的候选，`chosen` 是其中等权抽中的那个。
 *
 * ⚠️ `candidates`／`chosen` 是 `content.organs` 里那些对象的**只读引用**（不拷贝，
 * 因为 OrganDef 是纯静态定义）。界面渲染开奖卷轴时只读不写。
 */
export interface MoltResult {
  candidates: OrganDef[];
  chosen: OrganDef;
  essenceType: EssenceType;
}

/**
 * `resolveChoice` 的结果。
 *
 * `delta` 是被抽中分支**声明**的 effects（未夹紧的原始值，供界面做数值飘字）。它是
 * 内容对象的**深拷贝** —— 界面可以随便就地归一化它，不会污染 `TaleContent` 里那份
 * 事件数据（否则同种子同抉择的下一次结算就变了，直接击穿确定性承诺）。
 */
export interface ChoiceResult {
  state: TaleState;
  outcomeText: string;
  delta: EffectDelta;
}

/** 单个战斗回合的结果。`over` 非 null 时 `state.combat` 已置 null。 */
export interface CombatTurn {
  state: TaleState;
  roundLog: string[];
  over: "win" | "fled" | "dead" | null;
}

// ===== 保留 flag =====

/** 上一季饱食已 ≤0（再连续一季即饿死）。 */
export const SYS_FLAG_STARVING = "sys:starving";
/** 登神四项门槛已全部满足，「天命」事件可用 `requiresFlags` 入池。 */
export const SYS_FLAG_ASCEND_READY = "sys:ascend-ready";
/** 上一次战斗指令是「诈」且成功，下一次出手伤害翻倍。 */
export const SYS_FLAG_FEINT_PRIMED = "sys:feint-primed";

const ESSENCE_ORDER: readonly EssenceType[] = ["zu", "lin", "xue", "meng"];
const WINTER: Season = 3;

// ===== 通用小工具 =====

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

function clampStats(stats: Stats): Stats {
  return {
    meng: clamp(stats.meng, 0, 100),
    ling: clamp(stats.ling, 0, 100),
    ti: clamp(stats.ti, 0, 100),
    de: clamp(stats.de, 0, 100),
  };
}

function addStats(base: Stats, delta?: Partial<Stats>): Stats {
  if (!delta) return { ...base };
  return clampStats({
    meng: base.meng + (delta.meng ?? 0),
    ling: base.ling + (delta.ling ?? 0),
    ti: base.ti + (delta.ti ?? 0),
    de: base.de + (delta.de ?? 0),
  });
}

function addEssence(
  base: Record<EssenceType, number>,
  delta?: Partial<Record<EssenceType, number>>,
): Record<EssenceType, number> {
  if (!delta) return { ...base };
  const out = { ...base };
  for (const type of ESSENCE_ORDER) {
    out[type] = Math.max(0, out[type] + (delta[type] ?? 0));
  }
  return out;
}

function withoutFlags(flags: readonly string[], remove: readonly string[]): string[] {
  const drop = new Set(remove);
  return flags.filter((flag) => !drop.has(flag));
}

function withFlags(flags: readonly string[], add: readonly string[]): string[] {
  const out = [...flags];
  for (const flag of add) if (!out.includes(flag)) out.push(flag);
  return out;
}

/** `sys:` 前缀是引擎保留命名空间，内容侧只读不写。 */
const SYS_FLAG_PREFIX = "sys:";

/**
 * 过滤掉内容想写的 `sys:` flag。
 *
 * 不是洁癖：`addFlags: ["sys:starving"]` 会让玩家**一个饥荒季就饿死**（规格要求连续
 * 两季），`removeFlags: ["sys:starving"]` 则等于饿死免疫 —— 内容一个手误就能改掉规则。
 * 光靠注释约定挡不住 44 个手写事件，这里做成硬约束。
 */
function contentFlags(flags: readonly string[]): string[] {
  return flags.filter((flag) => !flag.startsWith(SYS_FLAG_PREFIX));
}

/** 深拷贝一个 EffectDelta，切断与 content 里那份事件数据的引用关系。 */
function cloneDelta(delta: EffectDelta): EffectDelta {
  const out: EffectDelta = { ...delta };
  if (delta.stats) out.stats = { ...delta.stats };
  if (delta.essence) out.essence = { ...delta.essence };
  if (delta.addFlags) out.addFlags = [...delta.addFlags];
  if (delta.removeFlags) out.removeFlags = [...delta.removeFlags];
  return out;
}

/** 浅拷贝 state 并把所有可变容器换成新实例，之后只改这个 draft。 */
function draftOf(state: TaleState): TaleState {
  return {
    ...state,
    stats: { ...state.stats },
    essence: { ...state.essence },
    organIds: [...state.organIds],
    flags: [...state.flags],
    firedOnceIds: [...state.firedOnceIds],
    combat: state.combat ? { ...state.combat, log: [...state.combat.log] } : null,
    records: [...state.records],
  };
}

// ===== 内容查询 =====

/**
 * 器官查表：`content.organs` ∪ 各神种自带的第 0 器官。
 *
 * ⚠️ 神种器官**只**存在于 `content.seeds[].organ`，在 `content.organs` 里查不到 ——
 * 任何「把 organIds 还原成 OrganDef」的地方都必须走这个并集，否则玩家的神种 tag
 * 会凭空消失。所以下面三个查询是**公开** API，B3 别自己重写。
 */
export function organIndex(content: TaleContent): Map<string, OrganDef> {
  const index = new Map<string, OrganDef>();
  for (const organ of content.organs) index.set(organ.id, organ);
  for (const seed of content.seeds) index.set(seed.organ.id, seed.organ);
  return index;
}

/** 当前持有的器官定义（顺序同 `state.organIds`，[0] 为神种器官）。查不到的 id 跳过。 */
export function ownedOrgans(state: TaleState, content: TaleContent): OrganDef[] {
  const index = organIndex(content);
  const owned: OrganDef[] = [];
  for (const id of state.organIds) {
    const organ = index.get(id);
    if (organ) owned.push(organ);
  }
  return owned;
}

/**
 * 当前持有的全部器官 tag 并集。
 * B3 渲染「不满足门槛的抉择置灰并显示原因」时用它算缺哪个 tag。
 */
export function ownedTags(state: TaleState, content: TaleContent): Set<string> {
  const tags = new Set<string>();
  for (const organ of ownedOrgans(state, content)) {
    for (const tag of organ.tags) tags.add(tag);
  }
  return tags;
}

/**
 * 提供战斗技的器官（多个则取 `organIds` 里最早的那个）；没有则 null。
 *
 * B3 用它决定战斗界面第四个按钮是否点亮、显示什么技名 —— `combatAct(state, "organ", …)`
 * 在返回 null 时会抛错。
 */
export function combatSkillOrgan(state: TaleState, content: TaleContent): OrganDef | null {
  return ownedOrgans(state, content).find((organ) => organ.combatSkill) ?? null;
}

function enemyById(content: TaleContent, id: string): EnemyDef | undefined {
  return content.enemies.find((enemy) => enemy.id === id);
}

function meetsStats(stats: Stats, required?: Partial<Stats>): boolean {
  if (!required) return true;
  return (
    stats.meng >= (required.meng ?? 0) &&
    stats.ling >= (required.ling ?? 0) &&
    stats.ti >= (required.ti ?? 0) &&
    stats.de >= (required.de ?? 0)
  );
}

// ===== 登神门槛 =====

/**
 * 就地重算 draft 的登神资格 flag。死亡时一律摘掉（免得列传/转世界面读到脏 flag）。
 *
 * 只对**本次调用新建的 draft**（或 createLife 刚造出来的对象）调用，never 对入参 state。
 * performAction 会在事件抽取**之前**再调一次，好让本回合刚满足门槛（例如刚蜕出第 5 个
 * 器官）的「天命」当场入池，而不是白等一季。
 */
function refreshAscendFlag(draft: TaleState, content: TaleContent): void {
  const t = content.tuning;
  const ready =
    draft.alive &&
    draft.year >= t.ascendMinYear &&
    draft.organIds.length >= t.ascendMinOrgans &&
    draft.stats.ling >= t.ascendMinLing &&
    draft.stats.de >= t.ascendMinDe;
  const has = draft.flags.includes(SYS_FLAG_ASCEND_READY);
  if (ready === has) return;
  draft.flags = ready
    ? withFlags(draft.flags, [SYS_FLAG_ASCEND_READY])
    : withoutFlags(draft.flags, [SYS_FLAG_ASCEND_READY]);
}

// ===== 出生 =====

/**
 * 造一世。
 *
 * @param seedNum 种子数（同时作为 rngState 初值）
 * @param seedDefId 选中的神种 `SeedDef.id`
 * @throws 神种 id 不存在时抛错（内容 bug 要吵，不要静默降级）
 */
export function createLife(seedNum: number, seedDefId: string, content: TaleContent): TaleState {
  const seed = content.seeds.find((candidate) => candidate.id === seedDefId);
  if (!seed) throw new Error(`createLife: 未知神种 ${seedDefId}`);
  const t = content.tuning;
  const stats = addStats(t.initialStats, seed.organ.statMods);
  const state: TaleState = {
    seed: seedNum >>> 0,
    rngState: seedNum >>> 0,
    year: 0,
    season: 0,
    region: "qingqiu",
    stats,
    hunger: clamp(t.hungerInit, 0, t.hungerMax),
    lifespanMax: t.lifespanBase + Math.floor(stats.ti / t.lifespanTiDivisor),
    essence: { zu: 0, lin: 0, xue: 0, meng: 0 },
    organIds: [seed.organ.id],
    flags: [],
    firedOnceIds: [],
    combat: null,
    records: [
      {
        year: 0,
        season: 0,
        kind: "birth",
        text: render(ENGINE_MESSAGES.birth, { seedName: seed.name }),
        refId: seed.id,
      },
    ],
    alive: true,
    ending: null,
  };
  refreshAscendFlag(state, content);
  return state;
}

/**
 * 当前可选行动。死亡或战斗未结束时返回空数组（界面据此禁用行动面板）。
 * 「蛰伏」仅在任一型精气 ≥ `tuning.moltThreshold` 时出现。
 */
export function availableActions(state: TaleState, content: TaleContent): ActionId[] {
  if (!state.alive || state.combat) return [];
  const actions: ActionId[] = ["hunt", "explore", "rest"];
  if (ESSENCE_ORDER.some((type) => state.essence[type] >= content.tuning.moltThreshold)) {
    actions.push("dormant");
  }
  return actions;
}

// ===== 回合：行动 =====

/** 打一场架的起手状态。playerHp 每场重置为 ti（本模型无跨战常驻 HP）。 */
function beginCombat(draft: TaleState, enemy: EnemyDef): void {
  draft.combat = {
    enemyId: enemy.id,
    enemyHp: enemy.hp,
    playerHp: draft.stats.ti,
    round: 0,
    log: [render(ENGINE_MESSAGES.combatStart, { enemy: enemy.name })],
  };
}

function huntSuccessRate(draft: TaleState, content: TaleContent): number {
  const t = content.tuning;
  let rate = t.huntBase + draft.stats.meng * t.huntPerMeng;
  if (ownedTags(draft, content).has(t.huntHunterTag)) rate += t.huntHunterTagBonus;
  return clamp(rate, t.minChance, t.maxChance);
}

function resolveHunt(
  draft: TaleState,
  cursor: RngCursor,
  content: TaleContent,
  notices: string[],
): void {
  const t = content.tuning;
  // 猎物表配错是内容 bug，要吵不要静默：空表或悬空 id 都会让狩猎永久失效、每一世饿死，
  // 而「山野寂寂」那种氛围旁白会把它伪装成正常玩法。
  if (t.huntPreyIds.length === 0) {
    throw new Error("resolveHunt: tuning.huntPreyIds 为空，狩猎无从掷骰（B2 必须填猎物表）");
  }
  const pool = t.huntPreyIds.map((id) => {
    const enemy = enemyById(content, id);
    if (!enemy) throw new Error(`resolveHunt: 猎物表里的未知敌人 ${id}`);
    return enemy;
  });
  const prey = pool[cursor.int(pool.length)];
  if (!prey) throw new Error("resolveHunt: 猎物表抽取失败");
  if (cursor.next() < huntSuccessRate(draft, content)) {
    draft.hunger = clamp(draft.hunger + t.huntFoodGain, 0, t.hungerMax);
    draft.essence = addEssence(draft.essence, prey.essence);
    notices.push(render(ENGINE_MESSAGES.huntSuccess, { enemy: prey.name }));
    return;
  }
  notices.push(ENGINE_MESSAGES.huntFail);
  if (cursor.next() < t.huntFailCombatChance) {
    notices.push(render(ENGINE_MESSAGES.huntEncounter, { enemy: prey.name }));
    beginCombat(draft, prey);
  }
}

function resolveRest(draft: TaleState, content: TaleContent, notices: string[]): void {
  const t = content.tuning;
  draft.hunger = clamp(draft.hunger + t.restHungerGain, 0, t.hungerMax);
  notices.push(ENGINE_MESSAGES.rest);
  const healed = t.restHealFlags.filter((flag) => draft.flags.includes(flag));
  if (healed.length > 0) {
    draft.flags = withoutFlags(draft.flags, healed);
    notices.push(ENGINE_MESSAGES.restHeal);
  }
}

/**
 * 蛰伏开奖。
 *
 * 1. 取达阈值的精气型中数值最高的一型（并列时按 zu→lin→xue→meng 顺序）。
 * 2. 候选池 = `content.organs` 中**未持有**且对该型 `affinity > 0` 的器官；
 *    按 `affinity × 该型精气` 加权不重复抽 `moltCandidateCount` 个。
 * 3. 候选里等权抽 1 个开出（M0 不做玩家挑选）。
 * 4. 该型精气清零。
 *
 * 池为空（内容耗尽）时：不清零、不获得，仅一条 notice —— 让玩家白费一季，
 * 但不因引擎侧内容短缺没收已攒的精气。
 */
function resolveMolt(
  draft: TaleState,
  cursor: RngCursor,
  content: TaleContent,
  notices: string[],
  records: LifeRecord[],
): MoltResult | null {
  const t = content.tuning;
  const ripe = ESSENCE_ORDER.filter((type) => draft.essence[type] >= t.moltThreshold);
  const type = ripe.reduce(
    (best, candidate) => (draft.essence[candidate] > draft.essence[best] ? candidate : best),
    ripe[0] ?? "zu",
  );
  const owned = new Set(draft.organIds);
  const pool = content.organs.filter(
    (organ) => !owned.has(organ.id) && (organ.affinity[type] ?? 0) > 0,
  );
  if (pool.length === 0) {
    notices.push(ENGINE_MESSAGES.moltNoCandidate);
    return null;
  }
  const amount = draft.essence[type];
  const candidates = weightedSample(
    cursor,
    pool,
    (organ) => (organ.affinity[type] ?? 0) * amount,
    t.moltCandidateCount,
  );
  const chosen = candidates[cursor.int(candidates.length)];
  if (!chosen) {
    notices.push(ENGINE_MESSAGES.moltNoCandidate);
    return null;
  }
  draft.organIds = [...draft.organIds, chosen.id];
  draft.stats = addStats(draft.stats, chosen.statMods);
  draft.essence = { ...draft.essence, [type]: 0 };
  const text = render(ENGINE_MESSAGES.molt, { organ: chosen.name });
  notices.push(text);
  records.push({ year: draft.year, season: draft.season, kind: "molt", text, refId: chosen.id });
  return { candidates, chosen, essenceType: type };
}

// ===== 回合：事件抽取 =====

function matchesTrigger(
  state: TaleState,
  event: TaleEvent,
  action: ActionId,
  tags: Set<string>,
): boolean {
  const trigger = event.trigger;
  if (trigger.once && state.firedOnceIds.includes(event.id)) return false;
  if (trigger.region !== "any" && trigger.region !== state.region) return false;
  if (trigger.actions && !trigger.actions.includes(action)) return false;
  if (trigger.minYear !== undefined && state.year < trigger.minYear) return false;
  if (trigger.maxYear !== undefined && state.year > trigger.maxYear) return false;
  if (trigger.seasons && !trigger.seasons.includes(state.season)) return false;
  if (trigger.requiresOrganTags && !trigger.requiresOrganTags.some((tag) => tags.has(tag))) {
    return false;
  }
  if (trigger.requiresFlags && !trigger.requiresFlags.every((flag) => state.flags.includes(flag))) {
    return false;
  }
  if (trigger.forbidsFlags?.some((flag) => state.flags.includes(flag))) return false;
  if (!meetsStats(state.stats, trigger.minStats)) return false;
  return true;
}

function drawEvent(
  draft: TaleState,
  cursor: RngCursor,
  content: TaleContent,
  action: ActionId,
): TaleEvent | null {
  const t = content.tuning;
  const chance = clamp(
    t.eventChanceBase * (action === "explore" ? t.exploreEventBonus : 1),
    0,
    1,
  );
  if (cursor.next() >= chance) return null;
  const tags = ownedTags(draft, content);
  const pool = content.events.filter((event) => matchesTrigger(draft, event, action, tags));
  return weightedPick(cursor, pool, (event) => event.trigger.weight);
}

// ===== 回合：死亡 =====

/**
 * 落死亡：改 draft 的存活位并**返回**那条 death 记录（不直接写进 draft.records）——
 * 让调用方把它并进本次调用的 records 缓冲，death 记录才能稳定落在末条。
 */
function die(draft: TaleState, ending: EndingType, text: string, refId?: string): LifeRecord {
  draft.alive = false;
  draft.ending = ending;
  draft.combat = null;
  return { year: draft.year, season: draft.season, kind: "death", text, refId };
}

/**
 * 执行一个行动，走完固定的五步结算。
 *
 * 结算顺序（计划「回合结算顺序」节，固定不可变更）：
 * 1. 行动本体（狩猎掷骰／探索／休憩／蛰伏开奖）
 * 2. 事件抽取（步骤 1 已开战则跳过 —— 打起来了就没心思看别的）
 * 3. 季推进：扣饱食（冬季加扣）→ 季 +1 → 跨年
 * 4. 死亡判定：饱食 ≤0 连续两季 → starve；year > lifespanMax → oldage
 * 5. records 追加（步骤 1-4 攒下的记录一次性并入，各条按产生时的岁/季打戳）
 *
 * 步骤 4 判定出死亡时会撤掉本回合抽出的事件（`pendingEvent` 返回 null）并清空 `combat`
 * —— 死亡覆盖一切未结算的东西，界面不会拿到「已死却还要选抉择」的状态。
 *
 * ⚠️ **调用方纪律**：拿到非 null 的 `pendingEvent` 后必须先 `resolveChoice` 再进下一个
 * 回合。`TaleState` 没有承载未决事件的字段，引擎无从强制；直接再调 performAction 不会
 * 报错，事件会被静默丢掉。`once` 事件的 id 记在 `resolveChoice` 而不是抽取时，所以丢掉
 * 的稀有事件只是下一季可能重抽，不会本世永久消失。
 *
 * @throws 已死亡、战斗未结束、或该行动当前不可用时抛错
 */
export function performAction(
  state: TaleState,
  action: ActionId,
  content: TaleContent,
): TurnResult {
  if (!state.alive) throw new Error("performAction: 已死亡，不能行动");
  if (state.combat) throw new Error("performAction: 战斗未结束，先调 combatAct");
  if (!availableActions(state, content).includes(action)) {
    throw new Error(`performAction: 当前不可执行行动 ${action}`);
  }

  const t = content.tuning;
  const cursor = createCursor(state.rngState);
  const draft = draftOf(state);
  const notices: string[] = [];
  const records: LifeRecord[] = [];
  let moltResult: MoltResult | null = null;

  // 1. 行动本体
  switch (action) {
    case "hunt":
      resolveHunt(draft, cursor, content, notices);
      break;
    case "explore":
      notices.push(ENGINE_MESSAGES.explore);
      break;
    case "rest":
      resolveRest(draft, content, notices);
      break;
    case "dormant":
      moltResult = resolveMolt(draft, cursor, content, notices, records);
      break;
  }

  // 2. 事件抽取（先刷新登神门槛 flag，让本回合刚够格的「天命」当场入池，不白等一季）
  refreshAscendFlag(draft, content);
  const drawn = draft.combat ? null : drawEvent(draft, cursor, content, action);

  // 3. 季推进
  const cost = t.hungerPerSeason + (draft.season === WINTER ? t.winterHungerExtra : 0);
  draft.hunger = clamp(draft.hunger - cost, 0, t.hungerMax);
  const nextSeason = ((draft.season + 1) % 4) as Season;
  if (nextSeason === 0) draft.year += 1;
  draft.season = nextSeason;

  // 4. 死亡判定
  if (draft.hunger <= 0) {
    if (draft.flags.includes(SYS_FLAG_STARVING)) {
      records.push(die(draft, "starve", ENGINE_MESSAGES.deathStarve));
    } else {
      draft.flags = withFlags(draft.flags, [SYS_FLAG_STARVING]);
    }
  } else {
    draft.flags = withoutFlags(draft.flags, [SYS_FLAG_STARVING]);
  }
  if (draft.alive && draft.year > draft.lifespanMax) {
    records.push(die(draft, "oldage", ENGINE_MESSAGES.deathOldage));
  }

  // 5. records 追加
  draft.records = [...state.records, ...records];
  draft.rngState = cursor.state;

  refreshAscendFlag(draft, content);
  return { state: draft, pendingEvent: draft.alive ? drawn : null, notices, moltResult };
}

// ===== 事件抉择 =====

function meetsChoiceRequirement(
  state: TaleState,
  choice: EventChoice,
  tags: Set<string> | null,
): boolean {
  const requires = choice.requires;
  if (!requires) return true;
  if (!meetsStats(state.stats, requires.stats)) return false;
  if (requires.organTags && requires.organTags.length > 0) {
    // tags 为 null = 调用方没传 content，无从校验器官 tag。这里**抛错而不是保守判否**：
    // 判否会让所有 organTags 门槛的抉择永久置灰，变成谁都发现不了的死内容
    // （B2 按计划要写 ≥4 处这类门槛）；抛错则让漏传 content 在第一次遇到这类事件时
    // 就当场暴露。
    if (!tags) {
      throw new Error(
        "eligibleChoiceIdxs: 该抉择带 organTags 门槛，必须传第三参 content 才能校验",
      );
    }
    if (!requires.organTags.some((tag) => tags.has(tag))) return false;
  }
  if (requires.essenceMin) {
    for (const type of ESSENCE_ORDER) {
      const need = requires.essenceMin[type];
      if (need !== undefined && state.essence[type] < need) return false;
    }
  }
  return true;
}

/**
 * 当前满足门槛的抉择下标。
 *
 * ⚠️ **接口缺口（待仲裁）**：正本的签名是 `(state, event)` 两参，但
 * `EventChoice.requires.organTags` 必须靠 `content` 才能把 `organIds` 解析成 tag
 * （神种器官还只存在于 `seeds[].organ`，见 `organIndex`）。为不破坏正本签名，第三参
 * `content` 做成**可选**；但只要碰到带 organTags 门槛的抉择又没传 content 就**抛错**，
 * 不静默置灰。
 *
 * **B3 一律传 content。** 建议正本把签名改成三参必填，B1 报告已列为第一号仲裁项。
 */
export function eligibleChoiceIdxs(
  state: TaleState,
  event: TaleEvent,
  content?: TaleContent,
): number[] {
  const tags = content ? ownedTags(state, content) : null;
  const idxs: number[] = [];
  event.choices.forEach((choice, idx) => {
    if (meetsChoiceRequirement(state, choice, tags)) idxs.push(idx);
  });
  return idxs;
}

/**
 * 落账一个 `EffectDelta`。
 *
 * 应用顺序固定：stats → hunger → lifespan → essence → addOrganId → flags →
 * startCombat → die。（stats 先落账，所以同一 delta 里加了 ti 又开战时，
 * `playerHp` 用的是加成后的 ti。）
 *
 * 不产 notices —— `ChoiceResult`（接口正本）没有 notices 槽位，效果的可见痕迹全部落在
 * `records`（获得器官 → molt、死亡 → death）与 state 本身（开战 → `combat` 非 null）。
 *
 * @throws `addOrganId`／`startCombat` 引用的 id 不存在时抛错（内容 bug 要吵）
 */
function applyEffects(
  draft: TaleState,
  effects: EffectDelta,
  content: TaleContent,
  records: LifeRecord[],
): void {
  const t = content.tuning;
  if (effects.stats) draft.stats = addStats(draft.stats, effects.stats);
  if (effects.hunger !== undefined) {
    draft.hunger = clamp(draft.hunger + effects.hunger, 0, t.hungerMax);
  }
  if (effects.lifespan !== undefined) {
    draft.lifespanMax = Math.max(0, draft.lifespanMax + effects.lifespan);
  }
  if (effects.essence) draft.essence = addEssence(draft.essence, effects.essence);
  if (effects.addOrganId !== undefined) {
    const organ = organIndex(content).get(effects.addOrganId);
    if (!organ) throw new Error(`applyEffects: 未知器官 ${effects.addOrganId}`);
    // 已持有则整体跳过：不重复加 statMods，也不写记录（什么都没发生）。
    if (!draft.organIds.includes(organ.id)) {
      draft.organIds = [...draft.organIds, organ.id];
      draft.stats = addStats(draft.stats, organ.statMods);
      records.push({
        year: draft.year,
        season: draft.season,
        kind: "molt",
        text: render(ENGINE_MESSAGES.organGained, { organ: organ.name }),
        refId: organ.id,
      });
    }
  }
  if (effects.addFlags) draft.flags = withFlags(draft.flags, contentFlags(effects.addFlags));
  if (effects.removeFlags) {
    draft.flags = withoutFlags(draft.flags, contentFlags(effects.removeFlags));
  }
  if (effects.startCombat !== undefined) {
    const enemy = enemyById(content, effects.startCombat);
    if (!enemy) throw new Error(`applyEffects: 未知敌人 ${effects.startCombat}`);
    beginCombat(draft, enemy);
  }
  if (effects.die !== undefined) {
    records.push(die(draft, effects.die, deathText(effects.die)));
  }
}

/** 事件直接判定的死亡用哪句旁白（战斗致死走 combatAct，那里带击杀者名字）。 */
function deathText(ending: EndingType): string {
  switch (ending) {
    case "starve":
      return ENGINE_MESSAGES.deathStarve;
    case "oldage":
      return ENGINE_MESSAGES.deathOldage;
    case "ascend":
      return ENGINE_MESSAGES.deathAscend;
    case "slain":
      return ENGINE_MESSAGES.deathSlainGeneric;
  }
}

/**
 * 结算一次事件抉择：加权抽一个 outcome，落账其 effects。
 *
 * 记录顺序：先写 outcome 本身的 `event` 记录，再写 effects 派生的记录
 * （获得器官的 `molt`、死亡的 `death`），保证 `death` 恒为末条。
 *
 * @param choiceIdx 必须在 `eligibleChoiceIdxs(state, event, content)` 内
 * @throws 已死亡、下标不合法、或 outcomes 为空时抛错
 */
export function resolveChoice(
  state: TaleState,
  event: TaleEvent,
  choiceIdx: number,
  content: TaleContent,
): ChoiceResult {
  if (!state.alive) throw new Error("resolveChoice: 已死亡，不能再作抉择");
  if (!eligibleChoiceIdxs(state, event, content).includes(choiceIdx)) {
    throw new Error(`resolveChoice: 抉择 ${choiceIdx} 不满足门槛或不存在（事件 ${event.id}）`);
  }
  const choice = event.choices[choiceIdx];
  if (!choice) throw new Error(`resolveChoice: 抉择 ${choiceIdx} 不存在（事件 ${event.id}）`);

  const cursor = createCursor(state.rngState);
  const outcome = weightedPick(cursor, choice.outcomes, (candidate) => candidate.weight);
  if (!outcome) throw new Error(`resolveChoice: 抉择 ${choiceIdx} 没有 outcomes（事件 ${event.id}）`);

  const draft = draftOf(state);
  // once 事件在**结算时**才烧掉 id（而不是 performAction 抽出时）：这样界面若因为
  // 刷新/误操作丢了未结算的稀有事件，它下一季还能再抽出来，而不是本世永久消失。
  if (event.trigger.once && !draft.firedOnceIds.includes(event.id)) {
    draft.firedOnceIds = [...draft.firedOnceIds, event.id];
  }
  const records: LifeRecord[] = [
    {
      year: draft.year,
      season: draft.season,
      kind: "event",
      text: outcome.text,
      refId: event.id,
    },
  ];
  applyEffects(draft, outcome.effects, content, records);
  draft.records = [...state.records, ...records];
  draft.rngState = cursor.state;
  refreshAscendFlag(draft, content);

  return {
    state: draft,
    outcomeText: outcome.text,
    delta: cloneDelta(outcome.effects),
  };
}

// ===== 战斗 =====

function rollDamage(cursor: RngCursor, meng: number, t: TaleTuning, multiplier: number): number {
  const base = t.combatDamageBase + Math.floor(meng / t.combatDamageMengDivisor);
  const jitter = t.combatDamageJitter;
  const swing = jitter > 0 ? cursor.int(jitter * 2 + 1) - jitter : 0;
  return Math.max(1, Math.floor((base + swing) * multiplier));
}

/**
 * 打一个战斗回合。
 *
 * - `fight`：出手 → 敌人未死则反击。
 * - `organ`：伤害 ×`organSkillDamageMul`；**仅当持有带 `combatSkill` 的器官**，否则抛错。
 * - `feint`：成功 = 本回合免伤 ＋ 挂 `SYS_FLAG_FEINT_PRIMED`（下一次出手伤害
 *   ×`feintBonusDamageMul`）；失败 = 受 `feintFailDamageMul` 倍伤。
 * - `flee`：成功 = `over: "fled"`；失败 = 挨一下正常伤害。
 *
 * `SYS_FLAG_FEINT_PRIMED` 只管**紧接的下一次** combatAct：无论那次干什么，结算完都会摘掉。
 *
 * `over` 非 null 时 `state.combat` 置 null —— 界面要自己累加每次返回的 `roundLog`
 * （战斗进行中也可以读 `state.combat.log` 拿累积日志，但结束那一刻它就没了）。
 *
 * @throws 已死亡、不在战斗中、敌人 id 失效、或 `act="organ"` 但无器官技时抛错
 */
export function combatAct(
  state: TaleState,
  act: "fight" | "flee" | "feint" | "organ",
  content: TaleContent,
): CombatTurn {
  if (!state.alive) throw new Error("combatAct: 已死亡");
  const current = state.combat;
  if (!current) throw new Error("combatAct: 当前不在战斗中");
  const enemy = enemyById(content, current.enemyId);
  if (!enemy) throw new Error(`combatAct: 未知敌人 ${current.enemyId}`);

  const t = content.tuning;
  const skillOrgan = combatSkillOrgan(state, content);
  if (act === "organ" && !skillOrgan) throw new Error("combatAct: 未持有带战斗技的器官");

  const cursor = createCursor(state.rngState);
  const draft = draftOf(state);
  const roundLog: string[] = [];
  const records: LifeRecord[] = [];

  const primed = draft.flags.includes(SYS_FLAG_FEINT_PRIMED);
  draft.flags = withoutFlags(draft.flags, [SYS_FLAG_FEINT_PRIMED]);
  const primeMul = primed ? t.feintBonusDamageMul : 1;

  let enemyHp = current.enemyHp;
  let playerHp = current.playerHp;
  let over: "win" | "fled" | "dead" | null = null;
  let enemyAttacks = true;
  let incomingMul = 1;

  switch (act) {
    case "fight": {
      const dmg = rollDamage(cursor, draft.stats.meng, t, primeMul);
      enemyHp -= dmg;
      roundLog.push(render(ENGINE_MESSAGES.combatPlayerHit, { enemy: enemy.name, dmg }));
      break;
    }
    case "organ": {
      const dmg = rollDamage(cursor, draft.stats.meng, t, t.organSkillDamageMul * primeMul);
      enemyHp -= dmg;
      roundLog.push(
        render(ENGINE_MESSAGES.combatSkillHit, {
          skill: skillOrgan?.combatSkill?.name ?? "",
          enemy: enemy.name,
          dmg,
        }),
      );
      break;
    }
    case "feint": {
      const rate = clamp(draft.stats.ling * t.feintPerLing, t.minChance, t.maxChance);
      if (cursor.next() < rate) {
        enemyAttacks = false;
        draft.flags = withFlags(draft.flags, [SYS_FLAG_FEINT_PRIMED]);
        roundLog.push(render(ENGINE_MESSAGES.combatFeintOk, { enemy: enemy.name }));
      } else {
        incomingMul = t.feintFailDamageMul;
        roundLog.push(render(ENGINE_MESSAGES.combatFeintFail, { enemy: enemy.name }));
      }
      break;
    }
    case "flee": {
      const rate = clamp(
        t.fleeBase +
          (draft.stats.ling - enemy.meng) * t.fleePerLingDiff -
          enemy.fleeBias * t.fleeBiasFactor,
        t.minChance,
        t.maxChance,
      );
      if (cursor.next() < rate) {
        over = "fled";
        enemyAttacks = false;
        roundLog.push(ENGINE_MESSAGES.combatFleeOk);
      } else {
        roundLog.push(ENGINE_MESSAGES.combatFleeFail);
      }
      break;
    }
  }

  if (over === null && enemyHp <= 0) {
    over = "win";
    enemyAttacks = false;
    draft.essence = addEssence(draft.essence, enemy.essence);
    draft.hunger = clamp(draft.hunger + t.combatWinHungerGain, 0, t.hungerMax);
    roundLog.push(render(ENGINE_MESSAGES.combatWin, { enemy: enemy.name }));
    records.push({
      year: draft.year,
      season: draft.season,
      kind: "combat",
      text: render(ENGINE_MESSAGES.combatWinRecord, { enemy: enemy.name }),
      refId: enemy.id,
    });
  }

  if (over === null && enemyAttacks) {
    const dmg = rollDamage(cursor, enemy.meng, t, incomingMul);
    playerHp -= dmg;
    roundLog.push(render(ENGINE_MESSAGES.combatEnemyHit, { enemy: enemy.name, dmg }));
    if (playerHp <= 0) over = "dead";
  }

  const round = current.round + 1;
  if (over === "dead") {
    records.push(
      die(draft, "slain", render(ENGINE_MESSAGES.deathSlain, { enemy: enemy.name }), enemy.id),
    );
  }
  draft.combat =
    over === null
      ? {
          enemyId: current.enemyId,
          enemyHp,
          playerHp,
          round,
          log: [...current.log, ...roundLog],
        }
      : null;
  draft.records = [...state.records, ...records];
  draft.rngState = cursor.state;

  refreshAscendFlag(draft, content);
  return { state: draft, roundLog, over };
}

// ===== 一世收束 =====

function pickPraise(
  variants: readonly ChroniclePraiseVariant[],
  de: number,
  ending: EndingType,
): ChroniclePraiseVariant | undefined {
  const matched = variants.find(
    (variant) =>
      (variant.minDe === undefined || de >= variant.minDe) &&
      (variant.maxDe === undefined || de <= variant.maxDe) &&
      (variant.endings === undefined || variant.endings.includes(ending)),
  );
  // 内容侧应把无条件兜底放在末项；没匹配上时退到末项而不是抛错 ——
  // 一世刚结束正是玩家最不该吃到崩溃的时刻。B2 的 schema 测试负责保证兜底存在。
  return matched ?? variants[variants.length - 1];
}

/**
 * 生成列传。
 *
 * 结构：`opening` → 中段摘录若干行（birth 恒为第一行，其后取 molt／combat／once 事件
 * 记录的前 `tuning.chronicleMaxExcerpts` 条）→ `endings[ending]` → `praisePrefix` ＋赞语。
 *
 * 模板可用占位：`seedName` `years` `season` `organCount` `moltCount` `killCount`
 * `meng` `ling` `ti` `de` `text`（`season`/`text` 仅 `middleLine` 有意义）。
 *
 * @throws 一世尚未结束（`alive` 为真或 `ending` 为 null）时抛错
 */
export function composeChronicle(state: TaleState, content: TaleContent): ChronicleEntry {
  if (state.alive || state.ending === null) {
    throw new Error("composeChronicle: 一世尚未结束，无从作传");
  }
  const tpl = content.chronicleTemplates;
  const ending = state.ending;
  const birth = state.records.find((record) => record.kind === "birth");
  const seed = content.seeds.find((candidate) => candidate.id === birth?.refId);
  const onceEventIds = new Set(
    content.events.filter((event) => event.trigger.once).map((event) => event.id),
  );
  const moltCount = state.records.filter((record) => record.kind === "molt").length;
  const killCount = state.records.filter((record) => record.kind === "combat").length;

  const vars: Record<string, string | number> = {
    seedName: seed?.name ?? "无名神种",
    years: state.year,
    organCount: state.organIds.length,
    moltCount,
    killCount,
    meng: state.stats.meng,
    ling: state.stats.ling,
    ti: state.stats.ti,
    de: state.stats.de,
  };

  const excerpts = state.records
    .filter(
      (record) =>
        record.kind === "molt" ||
        record.kind === "combat" ||
        (record.kind === "event" && record.refId !== undefined && onceEventIds.has(record.refId)),
    )
    .slice(0, Math.max(0, content.tuning.chronicleMaxExcerpts));

  const lines: string[] = [render(tpl.opening, vars)];
  for (const record of birth ? [birth, ...excerpts] : excerpts) {
    lines.push(
      render(tpl.middleLine, {
        ...vars,
        year: record.year,
        season: tpl.seasonNames[record.season],
        text: record.text,
      }),
    );
  }
  lines.push(render(tpl.endings[ending], vars));
  const praise = pickPraise(tpl.praise, state.stats.de, ending);
  lines.push(tpl.praisePrefix + (praise ? render(praise.text, vars) : ""));

  return {
    title: render(tpl.titleTemplate, vars),
    body: lines.join("\n"),
    ending,
    years: state.year,
    organCount: state.organIds.length,
  };
}

/**
 * 一世结算的血统点：蜕变 +1／每满 10 岁 +1／登神 +3。
 *
 * 「蜕变」计 `molt` 记录数（含事件直接赠予的器官）。不吃 tuning —— 三个来源的数值
 * 写在接口正本的函数注释里，是接口的一部分。
 */
export function bloodlineGain(state: TaleState): number {
  const molts = state.records.filter((record) => record.kind === "molt").length;
  const decades = Math.floor(state.year / 10);
  const ascend = state.ending === "ascend" ? 3 : 0;
  return molts + decades + ascend;
}
