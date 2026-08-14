/**
 * 最小 fixture 内容 —— 3 事件 / 4 器官 / 2 敌人 / 1 神种 ＋极简列传模板。
 *
 * 两个用途：
 * 1. 本包单测的内容依赖（不等 B2）。
 * 2. **B3 开发期的临时内容**：tale-client 在 tale-content 就绪前直接 import
 *    `FIXTURE_CONTENT` 就能跑通全流程，B4 再换成真内容。
 *
 * 刻意保持「够小、够极端」：器官对 `zu` 的 affinity 是 0.02/0.05/0.1/0.9 这种拉开的量级，
 * 好让开奖分布的统计断言有信噪比。
 */

import {
  BASELINE_TUNING,
  SYS_FLAG_ASCEND_READY,
  type ChronicleTemplates,
  type CombatSkillDef,
  type CombatSkillEffect,
  type ClashState,
  type EncounterState,
  type DestinationDef,
  type EnemyDef,
  type OrganDef,
  type PremiseDef,
  type SeedDef,
  type ApproachState,
  type SigilDef,
  type SynergyDef,
  type TaleContent,
  type TaleEvent,
  type TaleState,
  type TaleTuning,
} from "../src/index.js";

// ===== id 常量（测试与 B3 都别写字面量） =====

export const FIXTURE_SEED_ID = "seed-ling-yun";
export const FIXTURE_SEED_ORGAN_ID = "organ-ling-yun";
export const ORGAN_GOU_CHI = "gou-chi";
export const ORGAN_WU_MU = "wu-mu";
export const ORGAN_LIN_JIA = "lin-jia";
export const ORGAN_JI_ZU = "ji-zu";
export const ENEMY_YE_ZHI = "ye-zhi";
export const ENEMY_QIONG_QI = "qiong-qi-you";
export const EVENT_SPROUT = "qiu-spring-sprout";
export const EVENT_THICKET = "qiu-hunt-thicket";
export const EVENT_MANDATE = "qiu-heaven-mandate";

// ===== 器官 =====

const FIXTURE_ORGANS: OrganDef[] = [
  {
    id: ORGAN_GOU_CHI,
    name: "狩齿",
    slot: "tooth",
    affinity: { meng: 0.9, zu: 0.02 },
    statMods: { meng: 6 },
    tags: ["hunter", "fang"],
    combatSkill: { name: "撕咬", desc: "咬断猎物咽喉，伤害倍增。" },
    desc: "颌骨外翻，齿如列锯。",
  },
  {
    id: ORGAN_WU_MU,
    name: "雾目",
    slot: "eye",
    affinity: { lin: 0.8, zu: 0.05 },
    statMods: { ling: 5 },
    tags: ["night-eye"],
    desc: "瞳中生雾，能见隐微。",
  },
  {
    id: ORGAN_LIN_JIA,
    name: "鳞甲",
    slot: "hide",
    affinity: { xue: 0.7, zu: 0.1 },
    statMods: { ti: 6 },
    tags: ["armor"],
    desc: "背生重鳞，水火难侵。",
  },
  {
    id: ORGAN_JI_ZU,
    name: "疾足",
    slot: "limb",
    affinity: { zu: 0.9 },
    statMods: { meng: 2, ling: 2 },
    tags: ["swift"],
    desc: "四足生风，一跃数丈。",
  },
];

// ===== 神种 =====

const FIXTURE_SEEDS: SeedDef[] = [
  {
    id: FIXTURE_SEED_ID,
    name: "灵蕴神种",
    cost: 0,
    organ: {
      id: FIXTURE_SEED_ORGAN_ID,
      name: "灵蕴",
      slot: "spirit",
      affinity: { lin: 0.5 },
      statMods: { ling: 3 },
      tags: ["spirit-born"],
      desc: "一缕神识寄于血肉，是食灵入世的凭据。",
    },
    desc: "最寻常的神种，胜在灵性稍长。",
  },
];

// ===== 敌人 =====

const FIXTURE_ENEMIES: EnemyDef[] = [
  {
    id: ENEMY_YE_ZHI,
    name: "野雉",
    meng: 4,
    hp: 6,
    tags: ["beast", "prey"],
    essence: { zu: 12, xue: 4 },
    fleeBias: -10,
    desc: "羽色斑驳，惊则疾走。",
    // 追猎参数写死（不吃 tuning 缺省），让距离/警觉的算式在测试里可手算
    startDistance: 24,
    wariness: 18,
    /*
     * 只填两槽、且带【雉】标记：追猎旁白有「猎物专属 → 引擎兜底」两条路，测试要能
     * **分辨**走的是哪条。填满就分辨不出兜底路是否还活着（那正是内容漏写时的实际路径）。
     */
    stalkFlavor: {
      creep: ["【雉】压草而近{{steps}}步。"],
      miss: ["【雉】扑空，它贴地走了。"],
    },
  },
  {
    id: ENEMY_QIONG_QI,
    name: "穷奇幼崽",
    meng: 30,
    hp: 40,
    tags: ["beast", "divine"],
    essence: { meng: 30, xue: 6 },
    fleeBias: 15,
    desc: "生而有翼，啼声如婴。虽幼，已知食人。",
    startDistance: 30,
    wariness: 20,
    // 反扑：追猎失手／受惊即转搏杀。刻意**不给** stalkFlavor —— 兜底旁白的测试靠它。
    retaliates: true,
  },
];

// ===== 事件 =====

const FIXTURE_EVENTS: TaleEvent[] = [
  {
    id: EVENT_SPROUT,
    trigger: { region: "any", weight: 50 },
    title: "野蓂初生",
    body: "涧边石隙里钻出一丛蓂草，叶背泛着极淡的青光。凡草不该有这样的光。你伏下身，闻见一股又腥又甜的气味，像是血，又像是熟透的果子。",
    choices: [
      {
        label: "循香而食",
        outcomes: [
          {
            weight: 70,
            text: "草汁入喉，一股暖意自腹中散开。",
            effects: { hunger: 8, essence: { zu: 6 } },
          },
          {
            weight: 30,
            text: "草性阴寒，腹中绞痛半日方止。",
            effects: { stats: { ti: -2 } },
          },
        ],
      },
      {
        label: "以灵息养之（灵 20）",
        requires: { stats: { ling: 20 } },
        outcomes: [
          {
            weight: 1,
            text: "灵息与草光相引，青芒盛而复敛，尽入你识海。",
            effects: { essence: { lin: 20 }, stats: { ling: 1 } },
          },
        ],
      },
      {
        label: "以足之精气催之（足 30）",
        requires: { essenceMin: { zu: 30 } },
        outcomes: [
          {
            weight: 1,
            text: "精气灌注，草茎暴长，结出一枚赤果。食之，筋骨作响。",
            effects: { essence: { zu: -30 }, stats: { meng: 3 } },
          },
        ],
      },
    ],
  },
  {
    id: EVENT_THICKET,
    trigger: { region: "qingqiu", actions: ["hunt"], once: true, weight: 30 },
    title: "丛中窥影",
    body: "追踪的血迹断在一片棘丛前。丛内有物在动，压得枝叶簌簌作响，却始终不肯出来。风向不对，你闻不出那是什么。",
    choices: [
      {
        label: "破丛而入",
        outcomes: [
          {
            weight: 1,
            text: "棘刺划开皮肉的同时，那东西也扑了上来。",
            effects: { startCombat: ENEMY_YE_ZHI },
          },
        ],
      },
      {
        label: "以异目窥之（雾目／疾足）",
        requires: { organTags: ["night-eye", "swift"] },
        outcomes: [
          {
            weight: 1,
            text: "你绕到上风处，看清了丛中之物，也看清了它身后那条旧路。",
            effects: { essence: { lin: 10 }, addFlags: ["saw-thicket"] },
          },
        ],
      },
    ],
  },
  {
    id: EVENT_MANDATE,
    trigger: {
      region: "any",
      minYear: 15,
      minStats: { ling: 60, de: 40 },
      requiresFlags: [SYS_FLAG_ASCEND_READY],
      once: true,
      weight: 100,
    },
    title: "天命",
    body: "云自四方合拢，中开一隙，白光垂落如柱，正照在你伏身之处。光里没有声音，却有一句话直接落进识海：可去矣。",
    // illustrationBrief 是可选字段，这里给一条给 B2 当格式参照
    illustrationBrief:
      "水墨。青丘夜山之巅，浓云中开一道竖隙，一柱冷白光垂落至山石；光柱下一头小兽伏地仰首，只见剪影。留白占三分之一，无文字。",
    choices: [
      {
        label: "应命而升",
        outcomes: [
          {
            weight: 1,
            text: "你踏光而上，兽身如旧衣般褪落。青丘的风声，自此与你无关。",
            effects: { die: "ascend" },
          },
        ],
      },
      {
        label: "辞而不受",
        outcomes: [
          {
            weight: 1,
            text: "你转身走回林中。光柱在背后缓缓收拢，山野重归昏黑。",
            effects: { stats: { de: 5 }, lifespan: 2 },
          },
        ],
      },
    ],
  },
];

// ===== 列传模板 =====

const FIXTURE_CHRONICLE: ChronicleTemplates = {
  titleTemplate: "{{seedName}}列传",
  opening:
    "{{seedName}}者，青丘之属也。凡历{{years}}岁，成器官{{organCount}}，蜕{{moltCount}}，杀{{killCount}}。",
  middleLine: "{{year}}岁{{season}}，{{text}}",
  endings: {
    starve: "终以饥馑不振，殒于青丘。",
    slain: "终为强兽所杀，血沃荒原。",
    oldage: "寿数既尽，卧于旧穴而化。",
    ascend: "白光贯顶，遂脱兽籍而列神班。",
  },
  // [2026-08-13] 四条道各一段（必填）；fixture 里刻意各带一个可识别的词，
  // 好让测试断言「读到的是这一条道的结语」而不是兜底那句
  wayEndings: {
    shen: "白光贯顶，遂脱兽籍而列神班。",
    yaowang: "青丘之兽尽伏，自此山中之事决于其一念。",
    guishan: "寿全德厚，卧于旧穴而化，山中之兽皆来送之。",
    hualing: "未尝杀一命，形骸透明，风过而散。",
  },
  praisePrefix: "赞曰：",
  praise: [
    {
      id: "ascend",
      endings: ["ascend"],
      text: "食灵之志，不在饱腹，而在超然。此其所以为神也。",
    },
    { id: "high-de", minDe: 40, text: "其德厚，异类亦亲之。虽死，犹有余闻。" },
    { id: "low-de", maxDe: 4, text: "其行暴，同类畏之。所得者众，所存者寡。" },
    { id: "default", text: "生于青丘，死于青丘。兽之常也。" },
  ],
  seasonNames: ["春", "夏", "秋", "冬"],
};

// ===== 聚合 =====

const FIXTURE_TUNING: TaleTuning = {
  ...BASELINE_TUNING,
  // 基线里 huntPreyIds 是空的（基线不认识具体内容 id），fixture 只放野雉：
  // 让狩猎的精气收益可预测，穷奇留给战斗测试。
  huntPreyIds: [ENEMY_YE_ZHI],

  /*
   * ## [M2-B1] fixture 把五个**世界尺度**的旋钮调成中性
   *
   * 与 `FIXTURE_SKY`／`FIXTURE_ORIGIN`「无修正」同一条纪律（见那两处的注释）：既有的
   * 两百多条数值断言测的是**部位倍率／姿态／守备／效果**这些公式，若 fixture 里再叠一层
   * 全局缩放（血 ×1.6、体给的减伤、德给的闪避与暴击），每一条都要按缩放重算一遍 —— 那样测的就不是被测的那个公式了，而且哪一天调了缩放，两百条断言会一起变红
   * 却没有任何一条指得出问题在哪。
   *
   * 五个旋钮本身**各有专测**（`encounter.test.ts`，用显式调参把它们逐个打开），
   * 真内容库的那一套则由 `tale-content` 的冒烟与 `packages/gen` 的平衡台盯着。
   */
  combatHpPerTi: 1,
  // 除数极大 ＝ 减伤恒为 0（不写 0：那会 floor(ti/0) 得 Infinity）
  combatToughnessPerTi: 100000,
  combatDodgePerDe: 0,
  combatCritPerDe: 0,
  combatEnemyFleePerDe: 0,

  /*
   * 势同理：既有断言里的技能是「冷却好了就能放」，加一道势的闸门会让两百条里的每一条
   * 都要先攒势。势本身（自涨／乘隙／不挨伤／决杀）由 `encounter.test.ts` 专测。
   * 决杀的门槛调到够不着，好让 `recommendCombatAct` 的既有断言仍在比「咬 vs 技」。
   */
  encounterSkillMomentumCost: 0,
  encounterFinisherMomentum: 9999,
};

/**
 * [2026-08-13] fixture 的天时／出身：**各只有一条、且都不带任何修正**。
 *
 * 刻意做成「无修正」：既有的两百多条断言全都建立在「tuning 就是 fixture 那一份」之上，
 * 若 fixture 的开局变量带修正，每一条数值断言都要按天时重算一遍 —— 那样测的就不是被测的
 * 那个公式了。开局变量本身的行为由 `premise.test.ts` 用**显式声明修正**的 content 专测。
 */
export const FIXTURE_SKY: PremiseDef = {
  id: "sky-fixture",
  name: "常年",
  effect: "无修正",
  desc: "测试用的天时：什么都不改。",
  weight: 1,
};

export const FIXTURE_ORIGIN: PremiseDef = {
  id: "origin-fixture",
  name: "常胎",
  effect: "无修正",
  desc: "测试用的出身：什么都不改。",
  weight: 1,
};

/**
 * [S2] fixture 的探索去处：**两处**（够小、够极端）。
 *
 * - `DEST_NEAR` 无门槛、`calm`、**无兽**（`denizens: []`）—— 于是既有的探索断言不会被
 *   遇袭掷骰打乱，且它是「摇不出敌人的地方连概率骰都不掷」那条分支的用例。
 * - `DEST_FAR` 要疾足、`grim`、只有一头穷奇 —— 门槛、路费、遇袭三条都能在它身上钉死。
 *
 * 秘藏两件，各自的 id 在下面导出：`applyEffects` 的 `findTreasureId` 只认它们。
 */
export const DEST_NEAR = "dest-near";
export const DEST_FAR = "dest-far";
export const TREASURE_NEAR = "treasure-near";
export const TREASURE_FAR = "treasure-far";

/**
 * 「去近野」这个行动参数 —— 既有的探索断言一律改用它。
 *
 * 抽成常量而不是每处写 `{ destinationId: DEST_NEAR }`：这些断言测的都不是去处本身
 * （是季推进、饿死、事件概率…），近野的定义是「不改变任何既有量的那一处」——
 * 无门槛、无路费、无兽，于是它们的期望值一个字都不用改。
 */
export const NEAR = { destinationId: "dest-near" } as const;

export const FIXTURE_DESTINATIONS: DestinationDef[] = [
  {
    id: DEST_NEAR,
    name: "近野",
    desc: "测试用的常路：无门槛、无兽。",
    requiresOrganIds: [],
    peril: "calm",
    denizens: [],
    treasure: {
      id: TREASURE_NEAR,
      name: "近野之秘",
      reveal: "走得多了自然看得见。",
      desc: "测试用的秘藏。",
    },
    scenery: ["野"],
  },
  {
    id: DEST_FAR,
    name: "远地",
    desc: "测试用的绝境：要疾足才去得了。",
    requiresOrganIds: [ORGAN_JI_ZU],
    peril: "grim",
    denizens: [{ enemyId: ENEMY_QIONG_QI, weight: 1 }],
    treasure: {
      id: TREASURE_FAR,
      name: "远地之秘",
      reveal: "去得了的人少，所以还在。",
      desc: "测试用的秘藏。",
    },
    scenery: ["远"],
  },
];

/** fixture 内容聚合体，形状与 B2 的 `TALE_CONTENT` 一致。 */
export const FIXTURE_CONTENT: TaleContent = {
  events: FIXTURE_EVENTS,
  organs: FIXTURE_ORGANS,
  seeds: FIXTURE_SEEDS,
  enemies: FIXTURE_ENEMIES,
  skies: [FIXTURE_SKY],
  origins: [FIXTURE_ORIGIN],
  // [S1] 缺省**没有**组合：既有的两百多条搏杀断言都建立在「技能池里只有器官技」之上。
  // 组合的机制由专测用 `makeContent({ synergies: [...] })` 显式声明（同 fixture 天时的理由）。
  synergies: [],
  destinations: FIXTURE_DESTINATIONS,
  // [S3] 缺省**没有**印记：既有断言全部建立在「初始属性就是 tuning 那一份」之上。
  // 要测印记的用 `makeContent({ sigils: [...] })` 显式声明（同 fixture 组合表的理由）。
  sigils: [],
  tuning: FIXTURE_TUNING,
  chronicleTemplates: FIXTURE_CHRONICLE,
};

/** `makeContent` 的覆写入参；`tuning` 是**浅合并**，其余整体替换。 */
export interface ContentOverrides {
  events?: TaleEvent[];
  organs?: OrganDef[];
  seeds?: SeedDef[];
  enemies?: EnemyDef[];
  skies?: PremiseDef[];
  origins?: PremiseDef[];
  synergies?: SynergyDef[];
  destinations?: DestinationDef[];
  sigils?: SigilDef[];
  tuning?: Partial<TaleTuning>;
  chronicleTemplates?: ChronicleTemplates;
}

/**
 * 造一份改了某几项的 content。测试用它把概率钉死（例如 `{ stalkPounceBase: 1, minChance: 0,
 * maxChance: 1 }` ＝ `ALWAYS_POUNCE`，让扑击必中），从而在**不猜种子**的前提下测边界分支。
 */
export function makeContent(overrides: ContentOverrides = {}): TaleContent {
  return {
    events: overrides.events ?? FIXTURE_CONTENT.events,
    organs: overrides.organs ?? FIXTURE_CONTENT.organs,
    seeds: overrides.seeds ?? FIXTURE_CONTENT.seeds,
    enemies: overrides.enemies ?? FIXTURE_CONTENT.enemies,
    skies: overrides.skies ?? FIXTURE_CONTENT.skies,
    origins: overrides.origins ?? FIXTURE_CONTENT.origins,
    synergies: overrides.synergies ?? FIXTURE_CONTENT.synergies,
    destinations: overrides.destinations ?? FIXTURE_CONTENT.destinations,
    sigils: overrides.sigils ?? FIXTURE_CONTENT.sigils,
    tuning: { ...FIXTURE_CONTENT.tuning, ...overrides.tuning },
    chronicleTemplates: overrides.chronicleTemplates ?? FIXTURE_CONTENT.chronicleTemplates,
  };
}

/** 关掉事件抽取的 content —— 测回合机制时不想被事件卡打断。 */
export function contentWithoutEvents(overrides: ContentOverrides = {}): TaleContent {
  return makeContent({ ...overrides, tuning: { eventChanceBase: 0, ...overrides.tuning } });
}

/** 概率全部钉死用的开关：夹紧上下限放开到 [0,1]，方便把某个 rate 设成 0 或 1。 */
export const UNCLAMPED_CHANCE: Partial<TaleTuning> = { minChance: 0, maxChance: 1 };

// ===== 造状态的小工具（测试用；B3 不需要） =====

/**
 * 手工把状态推进到「正在打某个敌人」，省得靠事件抽取碰运气。
 *
 * [M1-P2] 缺省摆出「它护着后腿、这一回合要常规咬一口」这张脸 —— 于是「咬喉」是未被护住的
 * 那一咬，最接近 M0 的「战」，测试写起来最短。守备／意图／计数器全部可覆写：搏杀的边界
 * （打在守备上、它要逃、它已被致盲、技能还在冷却）靠 `performAction` 碰要试上百个种子。
 */
export function enterCombat(
  state: TaleState,
  enemyId: string,
  content: TaleContent = FIXTURE_CONTENT,
  overrides: Partial<ClashState> = {},
  /** [M2-B1] 遭遇外壳（势／部位伤／行为段／弱点／来路）的覆写 */
  shell: Partial<Omit<EncounterState, "approach" | "clash">> = {},
): TaleState {
  const enemy = content.enemies.find((candidate) => candidate.id === enemyId);
  if (!enemy) throw new Error(`enterCombat: 未知敌人 ${enemyId}`);
  const t = content.tuning;
  return {
    ...state,
    encounter: {
      enemyId,
      origin: "event",
      phase: "clash",
      momentum: 0,
      momentumMax: t.encounterMomentumBase + Math.floor(state.stats.ling / t.encounterMomentumMaxPerLing),
      wounds: { throat: 0, leg: 0, eye: 0 },
      weaknessFound: false,
      weaknessHits: 0,
      stage: 0,
      log: [],
      approach: null,
      ...shell,
      clash: {
        enemyHp: enemy.hp,
        playerHp: Math.max(1, Math.round(state.stats.ti * t.combatHpPerTi)),
        round: 0,
        stance: "square",
        guardPart: "leg",
        intent: { kind: "bite", text: "它向前逼了半步。" },
        blind: 0,
        slow: 0,
        ward: 0,
        bleed: 0,
        thorns: 0,
        insight: 0,
        skillCooldowns: {},
        ...overrides,
      },
    },
  };
}

/**
 * 造一个带战斗技的器官。
 *
 * [S1] `effects` 是**数组**（一个技可以同时附两条效果，组合技就靠这个），`extra` 用来
 * 加代价／伤害倍率／出伤属性 —— 那三项都是 S1 新加的、需要逐项钉住的字段。
 */
export function organWithSkill(
  id: string,
  name: string,
  effects?: readonly CombatSkillEffect[],
  cooldown?: number,
  extra: Partial<CombatSkillDef> = {},
): OrganDef {
  return {
    id,
    name,
    slot: "gut",
    affinity: { meng: 0.5 },
    tags: [],
    combatSkill: {
      name,
      desc: `试${name}。`,
      ...(effects === undefined ? {} : { effects }),
      ...(cooldown === undefined ? {} : { cooldown }),
      ...extra,
    },
    desc: `试用器官${name}。`,
  };
}

/**
 * [S1] 造一条组合：`organIds` 全在身上即解锁，技名与效果可指定。
 *
 * fixture 侧要能造「两件器官凑一条」的最小局面 —— 真内容那 10 条的因果自洽由
 * `tale-content` 的 schema 测试守，这里只守机制（差集、技能池、冷却、代价）。
 */
export function makeSynergy(
  id: string,
  organIds: readonly string[],
  skill: CombatSkillDef,
): SynergyDef {
  return {
    id,
    name: skill.name,
    organIds,
    kind: "skill",
    skill,
    reveal: `试${skill.name}的因果。`,
    desc: `试用组合${id}。`,
  };
}

/** 反击必中／必不中的 content 开关（`combatGuardCounterChance` 钉成 1 或 0）。 */
export const ALWAYS_COUNTER: Partial<TaleTuning> = { combatGuardCounterChance: 1 };
export const NEVER_COUNTER: Partial<TaleTuning> = { combatGuardCounterChance: 0 };
/** 致盲必打空／必打中。 */
/**
 * 「它必定打空／必定打中」的开关。
 *
 * [M2-B1] **两个来源都要拨**：技能挂的致盲（`combatBlindMissChance`）与整场累积的眼伤
 * （`woundEyeMissChance`）。只拨一个的话，扑眼那一路的测试会在「必空」档下照样挨打 ——
 * 而那正是这一族开关存在的理由（把概率钉死，不靠猜种子）。
 */
export const ALWAYS_MISS: Partial<TaleTuning> = {
  combatBlindMissChance: 1,
  woundEyeMissChance: 1,
};
export const NEVER_MISS: Partial<TaleTuning> = {
  combatBlindMissChance: 0,
  woundEyeMissChance: 0,
};

/**
 * 手工把状态推进到「正在追某头猎物」，四个量逐项可覆写。
 *
 * 存在的理由：起追时距离与警觉都带抖动、风向三选一 —— 靠 `performAction("hunt")` 碰出
 * 「顺风 ＋ 警觉 96 ＋ 体力 1」这种边界要试几百个种子，而那些边界正是最该被钉住的。
 */
export function enterStalk(
  state: TaleState,
  preyId: string,
  overrides: Partial<ApproachState> = {},
  content: TaleContent = FIXTURE_CONTENT,
  /** [M2-B1] 遭遇外壳（势／部位伤／来路）的覆写 */
  shell: Partial<Omit<EncounterState, "approach" | "clash">> = {},
): TaleState {
  const prey = content.enemies.find((candidate) => candidate.id === preyId);
  if (!prey) throw new Error(`enterStalk: 未知猎物 ${preyId}`);
  const t = content.tuning;
  return {
    ...state,
    encounter: {
      enemyId: preyId,
      origin: "hunt",
      phase: "approach",
      momentum: 0,
      momentumMax: t.encounterMomentumBase + Math.floor(state.stats.ling / t.encounterMomentumMaxPerLing),
      wounds: { throat: 0, leg: 0, eye: 0 },
      weaknessFound: false,
      weaknessHits: 0,
      stage: 0,
      log: [],
      clash: null,
      ...shell,
      approach: {
        distance: prey.startDistance ?? t.stalkStartDistance,
        alertness: prey.wariness ?? t.stalkStartAlert,
        stamina: t.stalkStamina,
        wind: "cross",
        windKnown: false,
        round: 0,
        ...overrides,
      },
    },
  };
}

/** 扑击必中／必空的 content（`UNCLAMPED_CHANCE` 打底，把命中率钉成 1 或 0）。 */
export const ALWAYS_POUNCE: Partial<TaleTuning> = {
  ...UNCLAMPED_CHANCE,
  stalkPounceBase: 1,
  stalkPouncePerDistance: 0,
  stalkPouncePerAlert: 0,
  stalkPouncePerMeng: 0,
};
export const NEVER_POUNCE: Partial<TaleTuning> = {
  ...UNCLAMPED_CHANCE,
  stalkPounceBase: 0,
  stalkPouncePerDistance: 0,
  stalkPouncePerAlert: 0,
  stalkPouncePerMeng: 0,
};

/** 直接塞器官 id（**不**叠加 statMods —— 只想借它的 tags 时用这个）。 */
export function withOrgans(state: TaleState, ...organIds: string[]): TaleState {
  return { ...state, organIds: [...state.organIds, ...organIds] };
}
