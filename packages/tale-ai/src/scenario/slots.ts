/**
 * 槽位规格生成 —— 这一批的**核心手法**：不要让 AI 写「一个事件」，要让它给指定的机制骨架添血肉。
 *
 * ## 什么归代码，什么归 AI
 * | 归代码（本文件） | 归 AI |
 * |---|---|
 * | 触发条件：行动池、年龄段、季节、权重、分类 tag、`once` | 标题与正文 |
 * | 抉择个数与各自的**取舍类型** | 抉择的字面 |
 * | 门槛挂哪个器官 tag（从 `content.organs` 现取） | 结果分支的叙述 |
 * | 开哪一场战、挂哪个 flag、取几条命（id 全从 `TaleContent` 现取） | 每个字段填哪个数（在给定区间内） |
 * | 每个分支允许出现哪些字段、各自的区间 | —— |
 * | 复用哪一张插图 | —— |
 *
 * 于是「AI 编造了一个不存在的敌人」这类事故**在结构上不可能发生**：它的回复里没有 id 字段。
 *
 * ## 纯函数、确定性
 * 全部由 `state.seed` 掷出（`createCursor`），所以同一局的槽位表恒等 —— 生成包随存档持久化
 * 之后，重放读到的是同一副骨架（架构红线 1）。本文件不碰 `Date.now`／`Math.random`／网络。
 */

import {
  createCursor,
  premiseOf,
  type ActionId,
  type EnemyDef,
  type OrganDef,
  type PremiseDef,
  type RngCursor,
  type Season,
  type TaleContent,
  type TaleEvent,
  type TaleState,
} from "@shiling/tale-sim";
import {
  ACTION_LABELS,
  GENERATED_ID_PREFIX,
  SLOT_COUNT,
  type BudgetKey,
  type ChoiceSpec,
  type EffectBudget,
  type OutcomeSpec,
  type PremiseEcho,
  type SlotSpec,
  type TradeoffKind,
} from "./types.js";

// ===== 前提母题词表 =====

/**
 * 每条天时／出身的**机械判据词**：呼应这一条前提的事件，正文里必须至少出现其中一个字。
 *
 * ## 为什么非要有这张表
 * 「呼应本世前提」若只写在 prompt 里，实测拿回来的是「今年天时不太好」这种放之四海皆准的
 * 句子 —— 那正是 owner 说的「每一局几乎都一样的剧情」。要求正文里出现「涸」「碱」「泉」
 * 这类**只有大旱之年才写得出**的字，是把「呼应」从愿望变成可判定的性质。
 *
 * ## 为什么不在 tale-content 里
 * 它是**校验器的词表**，不是游戏内容：改它不会改变任何一世的玩法，只会改变「什么样的
 * 生成稿算合格」。放在内容库里会让人误以为它参与抽取或结算。
 *
 * 「平年」刻意缺席：它是对照组（无任何机制），硬要求它的事件写出「平年感」等于逼模型
 * 编一个不存在的世道 —— 那一档的槽位一律退回 `none`（见 `echoFor`）。
 */
const PREMISE_KEYWORDS: Record<string, readonly string[]> = {
  "sky-drought": ["旱", "涸", "渴", "干", "水", "泉", "溪", "雨", "碱", "潭", "见底"],
  "sky-beast-tide": ["兽潮", "成群", "群", "南", "北", "嚎", "窜", "逃"],
  "sky-spirit-flux": ["灵气", "青光", "荧", "芒", "异", "露", "通灵", "光"],
  "sky-early-winter": ["寒", "冬", "雪", "冰", "霜", "冻", "枯", "僵"],
  "origin-solitary": ["孤", "独", "无伴", "同类", "只身", "单", "一只"],
  "origin-spirit-womb": ["眼", "神识", "睁", "视", "异于", "先", "明"],
  "origin-breech": ["异", "痕", "疤", "逆", "绕", "避", "怪", "祥"],
  "origin-twin": ["同胞", "双", "同穴", "伴", "一模一样", "兄", "弟", "另一个"],
};

/**
 * 词表缺条目时的兜底：拿这条前提名字里的字当判据。
 *
 * 兜底不是摆设 —— 内容库将来加一条天时而没人来补词表时，它保证的是「那一档的槽位仍然
 * 要求正文提到它」，而不是静默退化成「随便写」（那种退化没有任何测试会红）。
 */
function fallbackKeywords(premise: PremiseDef): string[] {
  return [...premise.name].filter((char) => /\p{Script=Han}/u.test(char) && !"之年生带".includes(char));
}

function keywordsOf(premise: PremiseDef): readonly string[] {
  const table = PREMISE_KEYWORDS[premise.id];
  return table && table.length > 0 ? table : fallbackKeywords(premise);
}

/** 一条前提是不是「有机制可写」的 —— 无 `tuningDelta`／`eventWeightMul`／`statMods` 即对照组。 */
function hasMechanics(premise: PremiseDef): boolean {
  return (
    premise.tuningDelta !== undefined ||
    premise.eventWeightMul !== undefined ||
    premise.statMods !== undefined ||
    premise.lifespanDelta !== undefined ||
    (premise.flags !== undefined && premise.flags.length > 0)
  );
}

// ===== 槽位骨架表 =====

/** 年龄段：`early` 幼年／`mid` 壮年／`late` 老成。三段各有各的语气与赌注。 */
type AgeBand = "early" | "mid" | "late";

const AGE_TRIGGERS: Record<AgeBand, { minYear?: number; maxYear?: number; label: string }> = {
  early: { maxYear: 4, label: "四岁以前（还小，什么都没见过）" },
  mid: { minYear: 3, maxYear: 11, label: "三岁到十一岁（正当年，敢下手）" },
  late: { minYear: 8, label: "八岁以后（见过世面，也开始有旧伤）" },
};

/**
 * 十六个槽位的骨架分布 —— **手排而不是随机掷**。
 *
 * 随机掷会掷出「五条都落在休憩池」这种池子（休憩一世只点几次，那五条基本不会出现），
 * 而这一批的成败恰恰在于玩家**真的撞得上**它们。所以行动池、年龄段、季节、抉择形状
 * 全部按一张表铺开，掷骰只用来决定「哪一条落在哪个母题上」。
 */
interface SlotBlueprint {
  action: ActionId | "any";
  age: AgeBand;
  /** 缺省＝不限季 */
  seasons?: Season[];
  /** 抉择的取舍类型组合 */
  kinds: TradeoffKind[];
  /** 优先呼应哪一半前提；`none` ＝ 这一条只讲青丘本身 */
  echo: PremiseEcho["kind"];
}

const BLUEPRINTS: readonly SlotBlueprint[] = [
  // — 狩猎 5 条：这一池的主题是「饱腹的代价」，所以贪／险占多数 —
  { action: "hunt", age: "early", kinds: ["greedy", "prudent", "virtue"], echo: "origin" },
  { action: "hunt", age: "mid", kinds: ["peril", "prudent", "virtue"], echo: "sky" },
  { action: "hunt", age: "mid", seasons: [1, 2], kinds: ["greedy", "gated", "prudent"], echo: "sky" },
  { action: "hunt", age: "late", kinds: ["greedy", "prudent", "virtue"], echo: "none" },
  { action: "hunt", age: "late", seasons: [3, 0], kinds: ["peril", "gated", "prudent"], echo: "sky" },

  // — 探索 6 条：奇遇与旧迹，德与灵的主要来源 —
  { action: "explore", age: "early", kinds: ["greedy", "prudent", "virtue"], echo: "sky" },
  { action: "explore", age: "early", kinds: ["greedy", "virtue"], echo: "origin" },
  { action: "explore", age: "mid", seasons: [0, 1], kinds: ["greedy", "gated", "virtue"], echo: "sky" },
  { action: "explore", age: "mid", kinds: ["peril", "prudent", "virtue"], echo: "none" },
  { action: "explore", age: "late", kinds: ["greedy", "gated", "prudent", "virtue"], echo: "origin" },
  { action: "explore", age: "late", seasons: [2, 3], kinds: ["greedy", "virtue"], echo: "sky" },

  // — 休憩 2 条：穴里的一夜，旧伤与梦 —
  { action: "rest", age: "mid", kinds: ["greedy", "prudent", "virtue"], echo: "origin" },
  { action: "rest", age: "late", kinds: ["greedy", "prudent"], echo: "none" },

  // — 不限行动 3 条：季候本身的事，哪个行动之后都可能撞上 —
  { action: "any", age: "early", seasons: [0], kinds: ["greedy", "prudent", "virtue"], echo: "origin" },
  { action: "any", age: "mid", seasons: [3], kinds: ["peril", "prudent", "virtue"], echo: "sky" },
  { action: "any", age: "late", seasons: [2], kinds: ["greedy", "gated", "prudent"], echo: "none" },
];

/**
 * 伤病 flag 的人话（进 prompt）。
 *
 * 非有不可：`sick` 三个字母对模型没有任何语义，实测它把这一支写成了「肩头渗出血来」
 * —— 那是外伤，而这个 flag 在内容里是腹疾／疫气（`tuning.restHealFlags` 挂的那个）。
 * 机制上无碍（它唯一的作用是「歇一季能好」），但文案与状态说的不是一件事，
 * 而玩家的状态栏上写着那个词。
 *
 * 表里没有的 flag 退回通用说法 —— 兜底句仍然把「歇一季能好」这条机制说清楚。
 */
const FLAG_LABELS: Record<string, string> = {
  sick: "腹疾／疫气（吃坏了、着了凉、或者伤口发炎这一类，歇一季能好）",
  wound: "旧伤未愈（外伤，歇一季能好）",
};

function flagLabel(flag: string): string {
  return FLAG_LABELS[flag] ?? `${flag}（一种歇一季能好的身体状态）`;
}

/**
 * 场景母题：给 AI 一个**具体的切入角**，避免十六条都写成「你在林子里走」。
 *
 * `live` 是这一批实测长出来的一位：**母题决定这条事件的贪档取不取命**。
 * 一度只按行动池定（狩猎取命、别的不取），结果探索池的贪档拿回来「你扯断藤蔓把它按倒，
 * 它挣了两下就不动了」—— 文案明写了杀生，而骨架没记这条命。玩家读完那一段之后，
 * 化灵之道的进度条上仍然写着「一世不杀」。
 *
 * 把这一位挂在母题上（而不是行动池上），故事与机制就**由构造保证一致**：
 * 母题是活物就取命，母题是果实／旧迹／天象就不取，两边不可能说两套话。
 */
interface Motif {
  text: string;
  /** 这个母题的贪档是不是「从一条活命上下来的」 */
  live: boolean;
}

const MOTIFS: Record<ActionId | "any", readonly Motif[]> = {
  hunt: [
    { text: "一处刚留下的痕迹（爪印、断毛、还温着的粪），顺着它摸到了那头活物", live: true },
    { text: "与另一个食客当面争同一口食", live: true },
    { text: "一头伤了还没死透的活物", live: true },
    { text: "一样不该出现在山里的东西（人留下的绳、铁、布），旁边有别人剩下的肉", live: false },
    { text: "一个埋伏——你也不确定谁埋伏谁", live: true },
    { text: "夜里循着声音摸过去的一次", live: true },
  ],
  explore: [
    { text: "一处旧迹：碑、坛、骨堆、废巢", live: false },
    { text: "一种从没见过的草木，看着能吃", live: false },
    { text: "一头不攻击你、也不躲你的兽", live: true },
    { text: "人留下的东西：火塘、绳、布、字", live: false },
    { text: "一片走进去就与外头不同的地界", live: false },
    { text: "天象或声响的一次异常", live: false },
  ],
  rest: [
    { text: "穴里的一夜，外头有东西在走动", live: false },
    { text: "身上的旧伤在夜里发作", live: false },
    { text: "一个梦，梦里的东西认得你", live: false },
    { text: "有别的活物来分你这个地方", live: true },
  ],
  dormant: [{ text: "蛰伏中被惊动的一刻", live: false }],
  any: [
    { text: "季节交替那几日的一件事", live: false },
    { text: "远处传来的一场动静，与你无关但你听见了", live: false },
    { text: "食物之外的一样东西：一块石、一段皮、一只角", live: false },
  ],
};

// ===== 预算表 =====

/** 一个精气型（进预算键）。 */
const ESSENCE_KEYS: readonly BudgetKey[] = [
  "essence.zu",
  "essence.lin",
  "essence.xue",
  "essence.meng",
];

function range(min: number, max: number): { min: number; max: number } {
  return { min, max };
}

/**
 * 按取舍类型出预算。
 *
 * ## 区间必须**重叠**，否则「严格占优检测」是摆设
 * 若稳健档只许写灵、德行档只许写德，两者的效果向量永远落在不同的维度上，**永远不可能**
 * 互相占优 —— 那道闸门就成了每次都返回「0 条」的装饰。所以两档共享 `hunger`／`stat.ling`／
 * `stat.de` 三个维度，只是区间偏向不同：一个真把稳健档写满、把德行档写空的稿子会被当场打回
 * （`scenarioValidate.test.ts` 钉了这条）。
 */
function budgetFor(kind: TradeoffKind, essence: BudgetKey, second: BudgetKey): EffectBudget {
  switch (kind) {
    case "greedy":
      return { hunger: range(18, 34), [essence]: range(6, 16), "stat.meng": range(0, 2) };
    case "prudent":
      return {
        hunger: range(6, 16),
        "stat.ling": range(0, 3),
        "stat.de": range(0, 2),
        [essence]: range(0, 8),
      };
    case "virtue":
      return {
        "stat.de": range(2, 6),
        "stat.ling": range(0, 2),
        hunger: range(0, 8),
        [second]: range(0, 8),
      };
    case "gated":
      return {
        hunger: range(16, 32),
        [essence]: range(8, 18),
        "stat.ling": range(0, 2),
        "stat.meng": range(0, 2),
      };
    case "peril":
      return { "stat.ling": range(1, 3), hunger: range(0, 8) };
  }
}

/** 贪档的坏结局：吃到了一点，但落下病根。 */
function greedyBadBudget(essence: BudgetKey): EffectBudget {
  return { hunger: range(4, 18), "stat.ti": range(-5, -2), [essence]: range(0, 6) };
}

// ===== 内容取材 =====

/** 可挂门槛的器官 tag —— 只取**蜕得出来的**那些（神种自带的 tag 不算门槛，人人都有）。 */
export function gateableTags(content: TaleContent): string[] {
  const seedTags = new Set(content.seeds.flatMap((seed) => seed.organ.tags));
  const tags = new Set<string>();
  for (const organ of content.organs) {
    for (const tag of organ.tags) if (!seedTags.has(tag)) tags.add(tag);
  }
  return [...tags].sort();
}

/**
 * 可开战的敌人 —— **刻意排除带 `wayDivineTag` 的那些**。
 *
 * 战胜神兽是「登神」的一条门槛（引擎在搏杀取胜时自己记）。生成事件若能递出一场神兽之战，
 * 就等于让 AI 有权发放成道门槛 —— 那越过了「AI 产物只以内容形态进入」的红线（架构红线 2：
 * 机制沙箱）。这一条不是保守，是边界。
 */
export function combatableEnemies(content: TaleContent): EnemyDef[] {
  const divine = content.tuning.wayDivineTag;
  return content.enemies.filter((enemy) => !enemy.tags.includes(divine));
}

/**
 * 按年龄段挑一头对手：幼年打得过的，老成才配硬仗。
 *
 * 窗口刻意**不从最弱那一头开始**：`peril` 档的说辞是「赌注是命」，而「惊动了野雉，当场
 * 就是一场搏杀」读起来是滑稽的（野雉 meng 4，一合就倒）。所以三段窗口都往强的一侧偏，
 * 幼年那一段也只到中游。
 */
function enemyForAge(enemies: readonly EnemyDef[], age: AgeBand, cursor: RngCursor): EnemyDef | null {
  const sorted = [...enemies].sort((a, b) => a.meng - b.meng);
  const size = sorted.length;
  if (size === 0) return null;
  const bands: Record<AgeBand, [number, number]> = {
    early: [Math.floor(size * 0.3), Math.max(1, Math.floor(size * 0.7))],
    mid: [Math.floor(size * 0.45), Math.max(1, Math.floor(size * 0.85))],
    late: [Math.floor(size * 0.6), size],
  };
  const [lo, hi] = bands[age];
  const window = sorted.slice(lo, Math.max(lo + 1, hi));
  return window[cursor.int(window.length)] ?? sorted[size - 1] ?? null;
}

/**
 * 复用插图：从**同一行动池**的手写事件里取一张。
 *
 * 不写死文件名的理由很实在：手写事件的插图是 B4 美术管线真产出来的 60 张，路径由
 * `artAssets.test.ts` 对着磁盘核过 —— 从那里取必然存在。自己拼一个 `events/gen-3.webp`
 * 只会在玩家眼前留一块空图位，而 `<img>` 加载失败**不报错**（这类漏接线在运行时是静默的）。
 */
function illustrationPool(content: TaleContent, action: ActionId | "any"): string[] {
  const sameAction = content.events.filter((event) => {
    if (event.illustration === undefined || event.illustration.length === 0) return false;
    const actions = event.trigger.actions;
    if (action === "any") return actions === undefined;
    return actions !== undefined && actions.includes(action);
  });
  const pool = sameAction.length > 0 ? sameAction : content.events.filter((event) => event.illustration);
  return pool.map((event) => event.illustration ?? "");
}

// ===== 主函数 =====

export interface SlotContext {
  slots: SlotSpec[];
  /** 手写事件的标题（去重对照，进 prompt） */
  writtenTitles: string[];
  /** 手写事件正文（少样本风格锚 ＋ 机械去重对照） */
  writtenBodies: string[];
  sky: PremiseDef;
  origin: PremiseDef;
}

/**
 * 掷出这一世的十六个槽位。
 *
 * @param state 刚降世的状态（只读 `seed`／`region`／`skyId`／`originId`）
 */
export function buildSlots(state: TaleState, content: TaleContent, count = SLOT_COUNT): SlotContext {
  const { sky, origin } = premiseOf(state, content);
  // 掷骰只用来分配母题与取材，骨架本身是手排的（见 BLUEPRINTS 的头注）
  const cursor = createCursor(state.seed ^ 0x51_ed_27_0b);
  const tags = gateableTags(content);
  const organsByTag = new Map(tags.map((tag) => [tag, organsWithTag(content, tag)]));
  const enemies = combatableEnemies(content);
  const injuryFlags = content.tuning.restHealFlags;
  const idBase = (state.seed >>> 0).toString(36);

  const usedMotifs = new Set<string>();
  const usedIllustrations = new Set<string>();
  const slots: SlotSpec[] = [];

  for (let index = 0; index < count; index += 1) {
    const blueprint = BLUEPRINTS[index % BLUEPRINTS.length];
    if (blueprint === undefined) break;
    const echo = echoFor(blueprint.echo, sky, origin);
    const motifs = MOTIFS[blueprint.action] ?? MOTIFS.any;
    const motif = pickUnusedMotif(motifs, usedMotifs, cursor);
    const illustrations = illustrationPool(content, blueprint.action);
    const illustration = pickUnused(illustrations, usedIllustrations, cursor);
    const essence = ESSENCE_KEYS[cursor.int(ESSENCE_KEYS.length)] ?? "essence.zu";
    const second = ESSENCE_KEYS[cursor.int(ESSENCE_KEYS.length)] ?? "essence.lin";
    const age = AGE_TRIGGERS[blueprint.age];

    const choices: ChoiceSpec[] = blueprint.kinds.map((kind) =>
      choiceSpecFor({
        kind,
        live: motif.live,
        age: blueprint.age,
        essence,
        second,
        tags,
        organsByTag,
        enemies,
        injuryFlags,
        cursor,
      }),
    );

    slots.push({
      id: `${GENERATED_ID_PREFIX}${idBase}-${index + 1}`,
      trigger: {
        region: state.region,
        ...(blueprint.action === "any" ? {} : { actions: [blueprint.action] }),
        ...(age.minYear === undefined ? {} : { minYear: age.minYear }),
        ...(age.maxYear === undefined ? {} : { maxYear: age.maxYear }),
        ...(blueprint.seasons ? { seasons: blueprint.seasons } : {}),
        /*
         * 一世只演一次：这一池是「这一局的专属剧本」，同一段故事在同一世里演两遍
         * 与 owner 抱怨的「每一局几乎都一样」是同一种廉价感，只是尺度小一号。
         */
        once: true,
        /*
         * 权重比手写事件略高（手写 16〜55，均值约 26）。要的是「这一局的专属剧本真的撞得上」：
         * 实测一世抽出事件约 25 次，本池 16 条按这个权重能占到三成上下（`scenario-lab --draw`
         * 报的就是这个数）。压得太低＝白生成，抬得太高＝手写内容一世都见不着。
         */
        weight: echo.kind === "none" ? 56 : 66,
        /*
         * 分类 tag 直接取自这一世前提**自己声明的**权重表（`eventWeightMul` 的键）——
         * 于是「大旱之年的水泽之事 ×2」这条乘子照样落在生成事件上。写死字面量会得到一个
         * 永远乘不上的 tag，而那种失效不会有任何测试变红（同 `eventTags.ts` 的头注）。
         */
        ...(echoTags(echo, sky, origin).length > 0 ? { tags: echoTags(echo, sky, origin) } : {}),
      },
      illustration,
      actionLabel: blueprint.action === "any" ? "任意行动之后（季候本身的事）" : ACTION_LABELS[blueprint.action],
      timing: `${age.label}${blueprint.seasons ? `，只在${blueprint.seasons.map((s) => "春夏秋冬"[s]).join("／")}` : ""}`,
      echo,
      motif: motif.text,
      choices,
    });
  }

  return {
    slots,
    writtenTitles: content.events.map((event) => event.title),
    writtenBodies: content.events.map((event) => event.body),
    sky,
    origin,
  };
}

function echoTags(echo: PremiseEcho, sky: PremiseDef, origin: PremiseDef): string[] {
  if (echo.kind === "none") return [];
  const table = (echo.kind === "sky" ? sky : origin).eventWeightMul;
  if (!table) return [];
  return Object.entries(table)
    .filter(([, mul]) => mul > 1)
    .map(([tag]) => tag);
}

function echoFor(kind: PremiseEcho["kind"], sky: PremiseDef, origin: PremiseDef): PremiseEcho {
  const none: PremiseEcho = { kind: "none", premiseId: "", name: "", brief: "", keywords: [] };
  if (kind === "none") return none;
  const premise = kind === "sky" ? sky : origin;
  // 平年那一档（无任何机制）退回 `none`：逼模型给一个不存在的世道编具体情节，
  // 换来的只会是硬凑的风味字 —— 那正是这一批要消灭的东西
  if (!hasMechanics(premise)) return none;
  return {
    kind,
    premiseId: premise.id,
    name: premise.name,
    brief: `${premise.desc}（机制：${premise.effect}）`,
    keywords: keywordsOf(premise),
  };
}

/** 母题版的「不重复地取一个」。 */
function pickUnusedMotif(pool: readonly Motif[], used: Set<string>, cursor: RngCursor): Motif {
  const fallback: Motif = { text: "", live: false };
  if (pool.length === 0) return fallback;
  const fresh = pool.filter((item) => !used.has(item.text));
  const from = fresh.length > 0 ? fresh : pool;
  const picked = from[cursor.int(from.length)] ?? from[0] ?? fallback;
  used.add(picked.text);
  return picked;
}

/** 不重复地取一个（取尽则允许重复，但每一轮都重新洗过）。 */
function pickUnused(pool: readonly string[], used: Set<string>, cursor: RngCursor): string {
  if (pool.length === 0) return "";
  const fresh = pool.filter((item) => !used.has(item));
  const from = fresh.length > 0 ? fresh : pool;
  const picked = from[cursor.int(from.length)] ?? from[0] ?? "";
  used.add(picked);
  return picked;
}

interface ChoiceContext {
  kind: TradeoffKind;
  /** 本条母题是不是「活物」（决定贪档取不取命，见 `MOTIFS` 的头注） */
  live: boolean;
  age: AgeBand;
  essence: BudgetKey;
  second: BudgetKey;
  tags: readonly string[];
  organsByTag: ReadonlyMap<string, OrganDef[]>;
  enemies: readonly EnemyDef[];
  injuryFlags: readonly string[];
  cursor: RngCursor;
}

function choiceSpecFor(context: ChoiceContext): ChoiceSpec {
  const { kind, cursor } = context;
  switch (kind) {
    case "greedy": {
      /*
       * 活物母题的贪档**必然取命**，非活物母题**必然不取**（见 `MOTIFS` 的头注）。
       * `takesLife` 由代码钉死（不是 AI 填）—— 它同时是妖王（要够多）与化灵（要恒为 0）
       * 两条道的判据，交给模型顺手写等于让它有权关掉玩家的一条路。
       */
      const takesLife = context.live ? 1 : 0;
      const injury = context.injuryFlags[cursor.int(Math.max(1, context.injuryFlags.length))];
      return {
        kind,
        brief: "拿得最多的那一个。代价不在当场，在后头（病、伤、或者德行）。",
        outcomes: [
          {
            weight: 58,
            tone: "good",
            brief:
              takesLife > 0
                ? "得手了，而且是从一条活命上下来的（文案要看得出取了命）"
                : "得手了，拿到了想要的 —— **但不是从活物身上取命**（果实、腐肉、别人剩下的、非致命地取，都行）",
            fixed: takesLife > 0 ? { takesLife } : {},
            budget: budgetFor("greedy", context.essence, context.second),
          },
          {
            weight: 42,
            tone: "bad",
            brief:
              injury === undefined
                ? "拿到了一点，但吃了亏"
                : `拿到了一点，但落下了${flagLabel(injury)}`,
            fixed: injury === undefined ? {} : { addFlags: [injury] },
            budget: greedyBadBudget(context.essence),
          },
        ],
      };
    }
    case "prudent":
      return {
        kind,
        brief: "不冒险的那个出口。拿得少，但一点代价也没有。",
        outcomes: [
          {
            weight: 1,
            tone: "good",
            brief: "什么险都没冒，也就什么都没多得——但学到了一样东西",
            fixed: {},
            budget: budgetFor("prudent", context.essence, context.second),
          },
        ],
      };
    case "virtue":
      return {
        kind,
        brief: "把到嘴的让出去。德行是登神与归山两条道的本钱，而它只能从这种选项里挣。",
        outcomes: [
          {
            weight: 1,
            tone: "good",
            brief: "让了。眼前空手，心里另有所得",
            fixed: {},
            budget: budgetFor("virtue", context.essence, context.second),
          },
        ],
      };
    case "gated": {
      const tag = context.tags[cursor.int(Math.max(1, context.tags.length))];
      const organs = tag === undefined ? [] : (context.organsByTag.get(tag) ?? []);
      return {
        kind,
        ...(tag === undefined ? {} : { requires: { organTags: [tag] } }),
        ...(organs.length === 0
          ? {}
          : {
              gateHint: organs
                .map((organ) => `${organ.name}（${organ.desc}）`)
                .join("、"),
            }),
        brief: "只有身上长出了对应器官才点得开。它明显比同屏别的选项好——那是器官该有的回报。",
        outcomes: [
          {
            weight: 1,
            tone: "good",
            brief: "凭身上那样东西，把别人做不到的事做成了",
            fixed: {},
            budget: budgetFor("gated", context.essence, context.second),
          },
        ],
      };
    }
    case "peril": {
      const enemy = enemyForAge(context.enemies, context.age, cursor);
      return {
        kind,
        brief: "多半会打起来。赌注是命。",
        outcomes: [
          {
            weight: 60,
            tone: "bad",
            brief: enemy === null ? "事情往最坏处去了" : `惊动了${enemy.name}，当场就是一场搏杀`,
            fixed: enemy === null ? {} : { startCombat: enemy.id },
            budget: {},
          },
          {
            weight: 40,
            tone: "good",
            brief: "险是险，到底没打起来",
            fixed: {},
            budget: budgetFor("peril", context.essence, context.second),
          },
        ],
      };
    }
  }
}

/**
 * 把槽位规格与 AI 的草稿拼成一条真事件。
 *
 * **触发条件、id、插图一律取自槽位**（草稿里那几个字段只是回声，不作数）——
 * 于是「模型把两条槽位串了」最多让文案对不上，绝不会让一条事件挂上错误的触发条件。
 */
export function assembleEvent(
  slot: SlotSpec,
  draft: { title: string; body: string; choices: { label: string; outcomes: { text: string; effects: Partial<Record<BudgetKey, number>> }[] }[] },
): TaleEvent {
  return {
    id: slot.id,
    trigger: slot.trigger,
    title: draft.title,
    body: draft.body,
    ...(slot.illustration.length > 0 ? { illustration: slot.illustration } : {}),
    choices: slot.choices.map((choiceSpec, choiceIdx) => {
      const choiceDraft = draft.choices[choiceIdx];
      return {
        label: choiceDraft?.label ?? "",
        ...(choiceSpec.requires ? { requires: choiceSpec.requires } : {}),
        outcomes: choiceSpec.outcomes.map((outcomeSpec, outcomeIdx) => ({
          weight: outcomeSpec.weight,
          text: choiceDraft?.outcomes[outcomeIdx]?.text ?? "",
          effects: mergeEffects(outcomeSpec, choiceDraft?.outcomes[outcomeIdx]?.effects ?? {}),
        })),
      };
    }),
  };
}

/** 把「代码钉死的那部分」与「AI 填的数」合成一个 `EffectDelta`。 */
export function mergeEffects(
  spec: OutcomeSpec,
  filled: Partial<Record<BudgetKey, number>>,
): TaleEvent["choices"][number]["outcomes"][number]["effects"] {
  const stats: Record<string, number> = {};
  const essence: Record<string, number> = {};
  let hunger: number | undefined;
  let lifespan: number | undefined;

  for (const key of Object.keys(filled) as BudgetKey[]) {
    const value = filled[key];
    // 预算里没声明的键一律丢弃（校验层已经打回过一次，这里是第二道门）
    if (value === undefined || spec.budget[key] === undefined || value === 0) continue;
    if (key === "hunger") hunger = value;
    else if (key === "lifespan") lifespan = value;
    else if (key.startsWith("stat.")) stats[key.slice(5)] = value;
    else if (key.startsWith("essence.")) essence[key.slice(8)] = value;
  }

  return {
    ...(Object.keys(stats).length > 0 ? { stats } : {}),
    ...(hunger === undefined ? {} : { hunger }),
    ...(lifespan === undefined ? {} : { lifespan }),
    ...(Object.keys(essence).length > 0 ? { essence } : {}),
    ...(spec.fixed.addFlags ? { addFlags: [...spec.fixed.addFlags] } : {}),
    ...(spec.fixed.removeFlags ? { removeFlags: [...spec.fixed.removeFlags] } : {}),
    ...(spec.fixed.startCombat === undefined ? {} : { startCombat: spec.fixed.startCombat }),
    ...(spec.fixed.takesLife === undefined || spec.fixed.takesLife <= 0
      ? {}
      : { takesLife: spec.fixed.takesLife }),
  };
}

/** 只给测试与 lab 用：某个器官 tag 对应的器官名（报告里要说清门槛挂在哪）。 */
export function organsWithTag(content: TaleContent, tag: string): OrganDef[] {
  return content.organs.filter((organ) => organ.tags.includes(tag));
}

/**
 * 把一个槽位填成「中值草稿」—— **不联网**地看清这副骨架长什么样。
 *
 * 两处用得着，都不是玩具：
 * - 实验台的 `--draw`：拿它当占位事件跑真引擎，量「生成池实际被抽中的比例」
 *   （这个数决定权重该定多少，而它不该靠猜）。
 * - 单测：占优检测、id 白名单终审这些闸门必须能在**没有网络**的情况下跑起来。
 *
 * 文案是明写的占位符（不是像模像样的假内容）—— 万一它哪天漏进玩家眼里，要一眼看得出是 bug。
 */
export function midpointDraft(slot: SlotSpec): {
  id: string;
  title: string;
  body: string;
  choices: { label: string; outcomes: { text: string; effects: Partial<Record<BudgetKey, number>> }[] }[];
} {
  return {
    id: slot.id,
    title: `占位${slot.id.slice(-2)}`,
    body: `〔占位正文〕${slot.motif}`,
    choices: slot.choices.map((choice, index) => ({
      label: `占位选项${index + 1}`,
      outcomes: choice.outcomes.map((outcome, outcomeIdx) => {
        const effects: Partial<Record<BudgetKey, number>> = {};
        for (const key of Object.keys(outcome.budget) as BudgetKey[]) {
          const span = outcome.budget[key];
          if (span === undefined) continue;
          effects[key] = Math.trunc((span.min + span.max) / 2);
        }
        return { text: `〔占位结果${outcomeIdx + 1}〕`, effects };
      }),
    })),
  };
}
