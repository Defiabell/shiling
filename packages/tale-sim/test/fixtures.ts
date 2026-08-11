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
  type EnemyDef,
  type OrganDef,
  type SeedDef,
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
};

/** fixture 内容聚合体，形状与 B2 的 `TALE_CONTENT` 一致。 */
export const FIXTURE_CONTENT: TaleContent = {
  events: FIXTURE_EVENTS,
  organs: FIXTURE_ORGANS,
  seeds: FIXTURE_SEEDS,
  enemies: FIXTURE_ENEMIES,
  tuning: FIXTURE_TUNING,
  chronicleTemplates: FIXTURE_CHRONICLE,
};

/** `makeContent` 的覆写入参；`tuning` 是**浅合并**，其余整体替换。 */
export interface ContentOverrides {
  events?: TaleEvent[];
  organs?: OrganDef[];
  seeds?: SeedDef[];
  enemies?: EnemyDef[];
  tuning?: Partial<TaleTuning>;
  chronicleTemplates?: ChronicleTemplates;
}

/**
 * 造一份改了某几项的 content。测试用它把概率钉死（例如 `{ huntBase: 1, minChance: 0,
 * maxChance: 1 }` 让狩猎必成），从而在**不猜种子**的前提下测边界分支。
 */
export function makeContent(overrides: ContentOverrides = {}): TaleContent {
  return {
    events: overrides.events ?? FIXTURE_CONTENT.events,
    organs: overrides.organs ?? FIXTURE_CONTENT.organs,
    seeds: overrides.seeds ?? FIXTURE_CONTENT.seeds,
    enemies: overrides.enemies ?? FIXTURE_CONTENT.enemies,
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

/** 手工把状态推进到「正在打某个敌人」，省得靠事件抽取碰运气。 */
export function enterCombat(
  state: TaleState,
  enemyId: string,
  content: TaleContent = FIXTURE_CONTENT,
): TaleState {
  const enemy = content.enemies.find((candidate) => candidate.id === enemyId);
  if (!enemy) throw new Error(`enterCombat: 未知敌人 ${enemyId}`);
  return {
    ...state,
    combat: {
      enemyId,
      enemyHp: enemy.hp,
      playerHp: state.stats.ti,
      round: 0,
      log: [],
    },
  };
}

/** 直接塞器官 id（**不**叠加 statMods —— 只想借它的 tags 时用这个）。 */
export function withOrgans(state: TaleState, ...organIds: string[]): TaleState {
  return { ...state, organIds: [...state.organIds, ...organIds] };
}
