/**
 * 「一世一剧本」（P2）的接口正本 —— 降世时按这一世的前提批量生成专属事件注入池。
 *
 * ## 一句话架构：**AI 不写事件，AI 给骨架添血肉**
 * 一条事件里「会不会坏游戏」的部分（触发条件、门槛挂哪个 tag、每个分支落什么账、
 * 抽取权重、取几条命、开哪一场战）**全部由代码生成**（`SlotSpec`）。AI 拿到的是
 * 一副已经站得住的骨架 ＋ 这一世的前提，它只做两件事：**编一个故事**，**在给定的
 * 数值区间里挑几个数**。
 *
 * 于是机制正确性不依赖模型的自觉：
 * - id 白名单是**结构性**的 —— AI 根本没有写 id 的字段（器官／敌人／flag 全在 `fixed` 里，
 *   由代码从 `TaleContent` 里取），所以它连编造一个不存在的敌人的机会都没有。
 * - 数值越界是**可判定**的 —— 每个允许出现的字段都带 `[min, max]`，多一个键、超一格数
 *   都当场打回（见 `validate.ts`）。
 * - 「假抉择」是**可判定**的 —— AI 唯一的自由度就是数值，而严格占优正是数值上的性质。
 *
 * ## 依赖方向
 * 与 P1 史官同一条：`tale-client → tale-ai → tale-sim`。本模块产出的是标准 `TaleEvent`，
 * 客户端把它接在内容池尾巴上（热注入），引擎全程不知道它们来自哪里。
 */

import type {
  ActionId,
  EnemyDef,
  EventChoice,
  EventTrigger,
  TaleEvent,
} from "@shiling/tale-sim";
import type { CallStat } from "../types.js";

// ===== 效果预算 =====

/**
 * AI 可以填数的字段（**白名单**，不在表里的键一律打回）。
 *
 * 键写成带点的扁平名（`stat.de`／`essence.zu`）而不是嵌套对象：一来 `stats.meng` 与
 * `essence.meng` 是两个完全不同的东西（属性 vs 精气），扁平名让它们在 prompt 里一眼可分；
 * 二来校验只需在一层上比对区间，不必递归 —— 而校验代码越短，「AI 塞进来一个没人查的字段」
 * 的面就越小。
 */
export type BudgetKey =
  | "stat.meng"
  | "stat.ling"
  | "stat.ti"
  | "stat.de"
  | "hunger"
  | "lifespan"
  | "essence.zu"
  | "essence.lin"
  | "essence.xue"
  | "essence.meng";

/** 全部合法预算键（校验与 prompt 共用同一份，不许两处各写一遍）。 */
export const BUDGET_KEYS: readonly BudgetKey[] = [
  "stat.meng",
  "stat.ling",
  "stat.ti",
  "stat.de",
  "hunger",
  "lifespan",
  "essence.zu",
  "essence.lin",
  "essence.xue",
  "essence.meng",
];

/** 一个字段的取值区间（闭区间，整数）。`min` 与 `max` 同号或跨零都合法。 */
export interface BudgetRange {
  min: number;
  max: number;
}

/**
 * 一个分支允许出现的字段与区间。
 *
 * **缺席即禁止**：表里没有的键出现在回复里就是越界。这条比「值越界」更要紧 ——
 * 前者是 AI 在给自己发明新的作用域，后者只是把旋钮拧过了头。
 */
export type EffectBudget = Partial<Record<BudgetKey, BudgetRange>>;

/**
 * 代码钉死、AI 不许碰也不许添的那部分效果。
 *
 * 这里正是「id 白名单」的落点：`startCombat` 的敌人 id、`addFlags` 的 flag 名都由
 * `slots.ts` 从 `TaleContent` 里现取，AI 的回复里根本没有对应字段。
 */
export interface FixedEffects {
  /** 开战的敌人 id（取自 `content.enemies`） */
  startCombat?: string;
  /** 挂上的内容 flag（取自内容库真实存在的 flag） */
  addFlags?: string[];
  /** 摘掉的内容 flag */
  removeFlags?: string[];
  /**
   * 这一支亲手取了几条命。
   *
   * 由代码定而不是由 AI 定：`livesTaken` 同时是妖王（要够多）与化灵（要恒为 0）两条道的
   * 判据 —— 让模型顺手写一个数，等于让它有权关掉玩家的一条成道之路。
   */
  takesLife?: number;
}

// ===== 槽位规格（代码生成，AI 只读） =====

/**
 * 一个抉择的取舍类型。**每个槽位至少要有两种不同的类型** —— 三个「拿得多一点／少一点」
 * 摆在一起不是抉择，是三档音量。
 *
 * - `greedy` 贪：拿得最多，但代价在别处（伤病／德行／一次真赌）。恒有一好一坏两支。
 * - `prudent` 稳：拿得少，但没有代价。它是「今天不冒险」的那个出口。
 * - `virtue` 德：放弃眼前所得换德行（登神与归山两条道的唯一来源）。
 * - `gated` 门槛：挂在某个器官 tag 上，明显优于同屏其它选项 —— 那是器官该有的回报。
 * - `peril` 险：多半直接开战。赌注是命，回报是精气与猛。
 */
export type TradeoffKind = "greedy" | "prudent" | "virtue" | "gated" | "peril";

/** 一个结果分支的规格。 */
export interface OutcomeSpec {
  /** 加权抽取的权重（代码定；单分支恒为 1） */
  weight: number;
  /** 这一支往哪个方向走 —— 只用来给 AI 写文案定调，不参与任何结算 */
  tone: "good" | "bad";
  /** 给 AI 的一句话：这一支发生了什么（人话，不是字段） */
  brief: string;
  fixed: FixedEffects;
  budget: EffectBudget;
}

/** 一个抉择的规格。 */
export interface ChoiceSpec {
  kind: TradeoffKind;
  /** 门槛（只有 `gated` 有；由代码从内容库的 tag 表里取） */
  requires?: EventChoice["requires"];
  /**
   * 门槛的人话（进 prompt）。
   *
   * 非有不可：tag 是 `swift`／`night-eye` 这类**内部词汇**，模型看不出它是「一双能追的腿」
   * 还是「暗处也看得清的眼」——直接把 tag 名递过去，换来的文案会是「凭 swift 之力」这种
   * 东西。这里由代码从 `content.organs` 现取器官名与它自己的 `desc`，模型写的才是那件器官。
   */
  gateHint?: string;
  /** 给 AI 的一句话：这个选项是干什么的 */
  brief: string;
  outcomes: OutcomeSpec[];
}

/**
 * 这一条要呼应本世的哪一半前提。
 *
 * `keywords` 是**机械判据**：正文里必须至少出现其中一个字词，否则打回。没有它，
 * 「大旱之年」只会换来一句「今年天时不好」——那正是 owner 说的「每一局几乎都一样」。
 */
export interface PremiseEcho {
  kind: "sky" | "origin" | "none";
  /** `PremiseDef.id`；`none` 时为空串 */
  premiseId: string;
  name: string;
  /** 那一条前提的风味与机制（原样取自内容，进 prompt） */
  brief: string;
  keywords: readonly string[];
}

/**
 * 一个槽位 —— 代码写好的骨架，AI 往里填血肉。
 *
 * `trigger` 与 `illustration` 都由代码定死并**原样进最终事件**：AI 的回复里没有它们。
 */
export interface SlotSpec {
  id: string;
  trigger: EventTrigger;
  /** 复用现有插图（取自同池手写事件，故文件必然存在）；空串＝走客户端的水墨占位兜底 */
  illustration: string;
  /** 这一条落在哪个行动上（人话，进 prompt） */
  actionLabel: string;
  /** 年龄段与季节的人话描述 */
  timing: string;
  echo: PremiseEcho;
  /** 场景母题：给 AI 一个具体的切入角，避免十六条都写成「你在林子里走」 */
  motif: string;
  choices: ChoiceSpec[];
}

// ===== AI 交回来的草稿 =====

/** 一个结果分支的文案 ＋ 数值。 */
export interface OutcomeDraft {
  text: string;
  /** 只能出现在 `OutcomeSpec.budget` 里声明过的键 */
  effects: Partial<Record<BudgetKey, number>>;
}

export interface ChoiceDraft {
  label: string;
  outcomes: OutcomeDraft[];
}

export interface EventDraft {
  /** 必须与槽位 id 一致（错了就说明模型把两条串了） */
  id: string;
  title: string;
  body: string;
  choices: ChoiceDraft[];
}

// ===== 生成包 =====

/**
 * 一世的生成事件包。
 *
 * **随存档持久化**（架构红线 1）：同一世重放（刷新、断线重连）读的是同一份包，
 * 不重新生成 —— 否则「同一局」在第二次打开时会是另一个剧本。
 */
export interface ScenarioPack {
  /** 缓存键（种子 ＋ 神种），也是「同一局」的定义 */
  cacheKey: string;
  /** 生成包的结构版本；换结构就换号，旧包自然失效而不是被误读 */
  version: number;
  events: TaleEvent[];
}

/** 一批（若干槽位）的生成结果，进遥测。 */
export interface BatchStat {
  slotIds: string[];
  accepted: number;
  attempts: number;
  /** 每次尝试被打回的理由（成功那次为空） */
  rejections: string[][];
  calls: CallStat[];
  totalMs: number;
}

/** 一世一条的生成遥测（客户端落 dev server 日志，报告的账就是它）。 */
export interface ScenarioTelemetry {
  cacheKey: string;
  skyId: string;
  originId: string;
  source: "ai" | "cache" | "none";
  /** 从发起到最后一批落定 */
  totalMs: number;
  /** 生成成功的事件数（`slots` 是本该生成的数量） */
  accepted: number;
  slots: number;
  batches: BatchStat[];
  costUsd: number | null;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  /** 一条都没生成出来时的原因；有产出则为 null */
  failureReason: string | null;
}

export interface ScenarioResult {
  pack: ScenarioPack;
  telemetry: ScenarioTelemetry;
}

export interface ScenarioOptions {
  endpoint: string;
  model: string;
  /**
   * 总预算（含重试）。**比史官宽两个数量级**：这一批的产出躲在整段开局之后
   * （降世屏 → 择行动 → 头几个回合都用手写池），玩家一秒都不必等，
   * 所以这里该买的是质量而不是速度。到点仍未回的批次被丢弃，已回的照常注入。
   *
   * 五分钟是实测定的：浏览器实机里 sonnet 一发 60〜85s，一次打回就是两发 ——
   * 头一版给 180s，于是「打回一次」几乎必然赶不上收尾（实机 16 槽只收下 4 条）。
   */
  budgetMs: number;
  /** 每批最多试几次（含首次）。只有校验打回才重试；网络错不重试 */
  maxAttempts: number;
  maxTokens: number;
  temperature: number;
  /** 一批几个槽位。批内串行、批间并行 —— 见 `generate.ts` 的「为什么要分批」 */
  batchSize: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  headers?: Record<string, string>;
  extraParams?: Record<string, unknown>;
  /** 每批落定就回调一次（客户端据此**增量热注入**，不必等最后一批） */
  onBatch?: (events: readonly TaleEvent[]) => void;
}

/**
 * 缺省配置 —— 数值依据见 `.superpowers/sdd/2026-08-13-liezhuan-ai-narrative/p2-report.md`
 * 的「模型选型」一节（每一项都是实测出来的，不是拍的）。
 */
export const DEFAULT_SCENARIO_OPTIONS: Omit<ScenarioOptions, "endpoint" | "model"> = {
  budgetMs: 300_000,
  maxAttempts: 2,
  /*
   * 一批四条事件的 JSON 约 2400〜4000 completion token（中文，含数值）。
   *
   * 给 16384 而不是刚好够：网关默认 ~1024 会**静默截断**（P1 踩过），而截断的 JSON
   * 连解析都过不去 —— 那是最贵的一种失败（钱花了，一条也没拿到，还要再花一次重试）。
   * `max_tokens` 是**上限不是预付**，多给不花钱；实机第一轮里三次「没能解析出 JSON」
   * 的打回就是这么来的。
   */
  maxTokens: 16384,
  /*
   * 恒为 1，理由同史官：`gpt-5.5`／`gpt-5.6`／`Kimi-latest` 对非默认 temperature 直接 400，
   * 而 `-with-fallback` 别名随时可能把请求切到它们身上。绕网关缓存用 `cache: {"no-cache": true}`。
   */
  temperature: 1,
  batchSize: 4,
};

/** 事件池的规模。计划给的是 15〜20 条，取 16 ＝ 4 批 × 4 条（批间并行，见 `generate.ts`）。 */
export const SLOT_COUNT = 16;

/** 生成事件 id 的前缀 —— 一眼看得出它不是手写的（日志、存档、报告里都要认得出）。 */
export const GENERATED_ID_PREFIX = "gen-";

/** 内部用：把敌人按强弱分档时要读的字段（`slots.ts` 与测试共用同一条判据）。 */
export type EnemyLike = Pick<EnemyDef, "id" | "name" | "meng" | "tags">;

/** 内部用：某个行动池的人话名字。 */
export const ACTION_LABELS: Record<ActionId, string> = {
  hunt: "狩猎",
  explore: "探索",
  rest: "休憩",
  dormant: "蛰伏",
};
