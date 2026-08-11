/**
 * 《食灵·列传》数据模型。
 *
 * 接口正本：docs/plans/shiling/2026-08-11-liezhuan-m0-plan.md 的「数据模型与引擎 API」节。
 * 本文件中带 `[正本]` 注记的类型逐字对应正本；带 `[B1 补全]` 的类型是正本只给了名字
 * （`TaleTuning`／`ChronicleTemplates`）而未给字段、由 B1 按「数值基线」与「回合结算顺序」
 * 两节推导出的结构 —— B2 必须按这里的形状提供数据。
 */

// ===== 枚举与标量 =====

/** [正本] 精气四型：足 鳞 穴 猛。 */
export type EssenceType = "zu" | "lin" | "xue" | "meng";
/** [正本] 地域。M0 仅青丘。 */
export type RegionId = "qingqiu";
/** [正本] 每季可选行动。 */
export type ActionId = "hunt" | "explore" | "rest" | "dormant";
/** [正本] 季节：0 春 1 夏 2 秋 3 冬。 */
export type Season = 0 | 1 | 2 | 3;
/** [正本] 一世的四种收束方式。 */
export type EndingType = "starve" | "slain" | "oldage" | "ascend";
/** [正本] 器官槽位。 */
export type OrganSlot = "eye" | "tooth" | "hide" | "limb" | "gut" | "spirit";

/** [正本] 四属性，0-100 夹紧。 */
export interface Stats {
  meng: number;
  ling: number;
  ti: number;
  de: number;
}

// ===== 内容定义（B2 提供数据） =====

/** [正本] 器官定义。 */
export interface OrganDef {
  id: string;
  name: string;
  slot: OrganSlot;
  /** 开奖权重用，0-1 */
  affinity: Partial<Record<EssenceType, number>>;
  /** 获得时一次性加成 */
  statMods?: Partial<Stats>;
  /** 事件/战斗钩子，如 "night-eye" "venom" "armor" */
  tags: string[];
  /** 有则解锁战斗第四选项 */
  combatSkill?: { name: string; desc: string };
  desc: string;
}

/** [正本] 神种（出生第 0 器官）。 */
export interface SeedDef {
  id: string;
  name: string;
  /** 血统点，0 为初始免费种 */
  cost: number;
  organ: OrganDef;
  desc: string;
}

/** [正本] 敌人定义。 */
export interface EnemyDef {
  id: string;
  name: string;
  meng: number;
  hp: number;
  /** "beast" "venom" "divine"… */
  tags: string[];
  /** 战胜吞食所得 */
  essence: Partial<Record<EssenceType, number>>;
  /** 逃跑难度修正 -20〜+20 */
  fleeBias: number;
  desc: string;
}

/** [正本] 事件触发条件。 */
export interface EventTrigger {
  region: RegionId | "any";
  /** 缺省=任意行动后都可能触发 */
  actions?: ActionId[];
  minYear?: number;
  maxYear?: number;
  seasons?: Season[];
  /** 任一命中即可 */
  requiresOrganTags?: string[];
  /** 全部命中才算（与 requiresOrganTags 的「任一」语义不同） */
  requiresFlags?: string[];
  /** 命中任一即排除 */
  forbidsFlags?: string[];
  minStats?: Partial<Stats>;
  /** 本世只触发一次 */
  once?: boolean;
  /** 同池抽取权重，1-100 */
  weight: number;
}

/** [正本] 效果增量。应用顺序固定见 engine.applyEffects 的 JSDoc。 */
export interface EffectDelta {
  stats?: Partial<Stats>;
  hunger?: number;
  /** 寿元增减（岁） */
  lifespan?: number;
  essence?: Partial<Record<EssenceType, number>>;
  addOrganId?: string;
  addFlags?: string[];
  removeFlags?: string[];
  /** EnemyDef.id */
  startCombat?: string;
  die?: EndingType;
}

/** [正本] 抉择的一个加权结果分支。 */
export interface EventOutcome {
  weight: number;
  text: string;
  effects: EffectDelta;
}

/** [正本] 事件抉择。 */
export interface EventChoice {
  label: string;
  requires?: {
    stats?: Partial<Stats>;
    /** 任一命中即可（同 EventTrigger.requiresOrganTags 语义） */
    organTags?: string[];
    essenceMin?: Partial<Record<EssenceType, number>>;
  };
  /** 加权抽一 */
  outcomes: EventOutcome[];
}

/** [正本] 图文事件。 */
export interface TaleEvent {
  /** kebab-case，如 "qiu-dying-yinglong" */
  id: string;
  trigger: EventTrigger;
  title: string;
  body: string;
  /** public/art/ 下文件名，B4 接立绘 */
  illustration?: string;
  /** 1-4 个 */
  choices: EventChoice[];
}

// ===== 一世的记录与跨世资产 =====

/**
 * [正本] 列传素材条目。
 *
 * 引擎的记录纪律（B2/B3 依赖）：
 * - `birth` 一世恰好一条，`refId` = SeedDef.id。
 * - `molt` = 获得器官（蛰伏开奖或事件 addOrganId），`refId` = OrganDef.id。
 * - `combat` = **击杀**（战胜敌人）专用，`refId` = EnemyDef.id；逃脱不写记录（仅 notices）。
 *   composeChronicle 的 killCount 就是 combat 记录数。
 * - `event` = 事件抉择结果，`refId` = TaleEvent.id。狩猎成败不写记录（仅 notices）。
 * - `death` 一世最多一条且恒为末条，`refId` 可为击杀者 EnemyDef.id。
 */
export interface LifeRecord {
  year: number;
  season: Season;
  kind: "birth" | "event" | "combat" | "molt" | "death";
  /** 列传素材短句 */
  text: string;
  refId?: string;
}

/** [正本] 一篇列传。 */
export interface ChronicleEntry {
  title: string;
  body: string;
  ending: EndingType;
  years: number;
  organCount: number;
}

/** [正本] 跨世血统资产。持久化（localStorage）归 tale-client。 */
export interface Bloodline {
  points: number;
  unlockedSeedIds: string[];
  chronicle: ChronicleEntry[];
}

/** [正本] 战斗中状态。战斗结束（win/fled/dead）后 TaleState.combat 置 null。 */
export interface CombatState {
  enemyId: string;
  enemyHp: number;
  playerHp: number;
  /** 已结算回合数；开战时为 0，每次 combatAct 后 +1 */
  round: number;
  log: string[];
}

/**
 * [正本] 一世的完整状态。
 *
 * 引擎所有函数都按**约定式不可变**返回新对象：调用方不得依赖旧引用，也不得就地修改
 * 返回值（引擎不做 freeze，靠约定）。`rngState` 是唯一的随机源，同 seed + 同操作序列
 * 必然得到同一终态。
 *
 * 保留 flag：引擎自用的三个内部 flag 见 `SYS_FLAG_STARVING`／`SYS_FLAG_ASCEND_READY`／
 * `SYS_FLAG_FEINT_PRIMED`，内容侧只读不写（`sys:` 前缀保留给引擎）。
 */
export interface TaleState {
  seed: number;
  rngState: number;
  year: number;
  season: Season;
  region: RegionId;
  stats: Stats;
  hunger: number;
  lifespanMax: number;
  essence: Record<EssenceType, number>;
  /** [0] 恒为神种器官 */
  organIds: string[];
  flags: string[];
  firedOnceIds: string[];
  combat: CombatState | null;
  records: LifeRecord[];
  alive: boolean;
  ending: EndingType | null;
}

// ===== 调参与列传模板（B1 补全结构，B2 填数据） =====

/**
 * [B1 补全] 全部可调数值。初值见 `BASELINE_TUNING`（tuning.ts），逐项对应计划
 * 「数值基线」表；表里没有的项（狩猎食物量、器官技倍率等）是引擎实现必需的补全，
 * 已在字段注释里标明。
 */
export interface TaleTuning {
  // — 出生 —
  /** 初始 stats（神种 statMods 在此之上叠加） */
  initialStats: Stats;
  /** lifespanMax = lifespanBase + floor(ti / lifespanTiDivisor)，出生时定一次 */
  lifespanBase: number;
  lifespanTiDivisor: number;

  // — 饱食 —
  hungerInit: number;
  hungerMax: number;
  /** 每季固定消耗 */
  hungerPerSeason: number;
  /** 冬季（season 3）额外消耗 */
  winterHungerExtra: number;

  // — 精气与蜕变 —
  /** 任一型精气达此值解锁蛰伏；开奖后该型清零 */
  moltThreshold: number;
  /** 开奖候选数（按 affinity×该型精气加权不重复抽，再等权抽 1） */
  moltCandidateCount: number;

  // — 行动 —
  /** 狩猎成功率 = huntBase + meng×huntPerMeng (+ huntHunterTagBonus if 有 huntHunterTag) */
  huntBase: number;
  huntPerMeng: number;
  huntHunterTagBonus: number;
  /** [补全] 给狩猎加成的器官 tag 名 */
  huntHunterTag: string;
  /** [补全] 猎物表：EnemyDef.id 列表，等权抽一；成功吞其 essence */
  huntPreyIds: string[];
  /** [补全] 狩猎成功回饱食 */
  huntFoodGain: number;
  /** [补全] 狩猎失败转为遭遇战的概率 */
  huntFailCombatChance: number;
  /** [补全] 休憩回饱食 */
  restHungerGain: number;
  /** [补全] 休憩清除的伤病 flag（计划「小回血」的落地形式：本模型无常驻 HP） */
  restHealFlags: string[];
  /** [补全] 每回合抽出事件的基础概率 */
  eventChanceBase: number;
  /** 探索行动对抽中概率的倍率 */
  exploreEventBonus: number;

  // — 战斗 —
  /** 伤害 = combatDamageBase + floor(meng / combatDamageMengDivisor) ± combatDamageJitter */
  combatDamageBase: number;
  combatDamageMengDivisor: number;
  combatDamageJitter: number;
  /** [补全] 战胜额外回的饱食 */
  combatWinHungerGain: number;
  /** 逃跑成功率 = fleeBase + (ling − enemy.meng)×fleePerLingDiff − enemy.fleeBias×fleeBiasFactor */
  fleeBase: number;
  fleePerLingDiff: number;
  fleeBiasFactor: number;
  /** 诈成功率 = ling × feintPerLing */
  feintPerLing: number;
  /** 诈失败受伤倍率 */
  feintFailDamageMul: number;
  /** 诈成功后下一次出手的伤害倍率 */
  feintBonusDamageMul: number;
  /** [补全] 器官技伤害倍率 */
  organSkillDamageMul: number;
  /** 所有概率的夹紧下限/上限（避免 0% 与 100% 的死局） */
  minChance: number;
  maxChance: number;

  // — 登神（M0 极简）—
  /** 四项全部满足时引擎挂上 SYS_FLAG_ASCEND_READY，「天命」事件靠 requiresFlags 入池 */
  ascendMinYear: number;
  ascendMinOrgans: number;
  ascendMinLing: number;
  ascendMinDe: number;

  // — 列传 —
  /** [补全] 列传中段最多摘录几条记录（birth 恒在其外） */
  chronicleMaxExcerpts: number;
}

/**
 * [B1 补全] 列传模板。正本写「结构由 B2 定」，但 B2 `import type` 自本包，
 * 结构只能落在这里；B2 按此形状填文案。
 *
 * 所有 `string` 字段支持 `{{key}}` 占位，可用 key 见 `composeChronicle` 的 JSDoc；
 * 未知占位保持原样输出（便于内容侧发现错别字）。
 */
export interface ChronicleTemplates {
  /** 列传标题，如 "{{seedName}}列传" */
  titleTemplate: string;
  /** 开篇：神种＋出生 */
  opening: string;
  /** 中段每条摘录一行，如 "{{year}}岁{{season}}，{{text}}" */
  middleLine: string;
  /** 结局四型各一段 */
  endings: Record<EndingType, string>;
  /** 「赞曰」前缀（引擎不内置中文列传文案，此处由内容提供） */
  praisePrefix: string;
  /** 赞语变体，按数组顺序取第一个匹配；末项应为无条件兜底 */
  praise: ChroniclePraiseVariant[];
  /** 季节名，索引即 Season */
  seasonNames: [string, string, string, string];
}

/** [B1 补全] 赞语变体的匹配条件（按 de 与 ending 分支）。 */
export interface ChroniclePraiseVariant {
  id: string;
  /** state.stats.de ≥ minDe */
  minDe?: number;
  /** state.stats.de ≤ maxDe */
  maxDe?: number;
  /** 命中任一 ending 即可；缺省=不限 */
  endings?: EndingType[];
  text: string;
}
