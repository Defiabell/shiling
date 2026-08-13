/**
 * `@shiling/tale-ai` 的接口正本。
 *
 * 这个包是全仓库**唯一允许联网**的包（架构红线 1）。tale-sim／tale-content 不得 import 它 ——
 * 引擎的确定性承诺（同种子同操作＝同终态）靠的正是「引擎里没有任何外部输入」，
 * 而 AI 产物**只以文本形态**进入客户端展示层：它替换的是列传正文，不改任何一个玩法数值。
 */

import type { ChronicleEntry, EndingType, LifeRecord, Stats, WayId } from "@shiling/tale-sim";

/**
 * 一条编年摘录 —— 引擎选出来的「值得入传的事」。
 *
 * `prefix` 是**事实锚**：由引擎的汉字数字与季名拼成（「三岁秋」／「初岁春」），
 * AI 必须原样带回。中段的时间线因此不可能被编造 —— 校验只需比对前缀集合，
 * 不必去理解生成文本里的年份。
 */
export interface ChronicleExcerpt {
  prefix: string;
  kind: LifeRecord["kind"];
  /** 引擎写下的原始记录短句（AI 要改写成史笔，但不得改事） */
  text: string;
}

/** 四道之一的进度（写进 prompt，让收束与赞语说得出「差在哪」）。 */
export interface WayFactLine {
  id: WayId;
  label: string;
  met: number;
  total: number;
  /** 未达成的门槛，人话短句 */
  shortfalls: string[];
}

/**
 * 一世的**全部可用事实**。AI 只能取材于此 —— prompt 里没有的事就是没发生过的事。
 *
 * 由 `collectLifeFacts` 从终态 `TaleState` ＋ `TaleContent` 纯函数导出，不含随机、不含时间。
 */
export interface LifeFacts {
  seedName: string;
  seedDesc: string;
  skyName: string;
  skyDesc: string;
  originName: string;
  originDesc: string;
  years: number;
  yearsCn: string;
  ending: EndingType;
  endingLabel: string;
  way: WayId | null;
  wayLabel: string | null;
  stats: Stats;
  /** 终局身上的器官（含神种，[0] 恒为神种器官） */
  organs: { name: string; slotLabel: string; desc: string }[];
  /** 这一世**蜕出**的器官名（含事件直接赠予的） */
  moltNames: string[];
  /** 搏杀取胜的敌人名 */
  killedNames: string[];
  /** 咬死自己的那头（横死才有） */
  killerName: string | null;
  livesTaken: number;
  moltCount: number;
  killCount: number;
  excerpts: ChronicleExcerpt[];
  /** 引擎写的那句死亡旁白 */
  deathText: string;
  /** 最接近的那条道（成道则是成的那条）的进度 */
  nearestWay: WayFactLine;
  /**
   * 事实校验白名单：这一世**真实出现过**的专名（器官／敌人／神种）。
   *
   * 注意它比「records 里出现过的字符串」更宽一点：终局身上的器官即使不是这一世蜕的
   * （神种器官出生自带），也是真实存在的事实，史官当然写得。
   */
  allowedNouns: string[];
  /**
   * 起法轮转序号 —— 由 `state.seed` 定，故同一局重放必取到同一条（架构红线 1：AI 产物
   * 随存档一致）。用途见 `prompt.ts` 的 `OPENING_ANGLES`：**三篇列传的第一句不该同一个模子**。
   */
  variant: number;
  /**
   * 全内容的专名目录（器官名／敌人名／神种名，含别名）。
   *
   * 校验的判据是「目录里出现在生成文本中、却不在 `allowedNouns` 里的名字」＝编造。
   * 只查目录内的名字：AI 用「猛兽」「山中之物」这类泛称不该被误伤。
   */
  catalogNouns: string[];
}

/** AI 交回来的列传草稿（结构由代码定，AI 只填血肉）。 */
export interface ChronicleDraft {
  /** 开篇：神种＋出身＋天时＋一世总账 */
  opening: string;
  /** 中段编年，与 `LifeFacts.excerpts` 一一对应、同序、同前缀 */
  middle: { prefix: string; text: string }[];
  /** 收束（结局那一段） */
  closing: string;
  /** 赞语正文（**不含**「赞曰：」前缀，前缀由代码补） */
  praise: string;
}

/** 一次网关调用的账（token／耗时／成本都在这里，报告的实测值就是它）。 */
export interface CallStat {
  model: string;
  latencyMs: number;
  /**
   * 网关缓存命中。判据是响应头 `x-litellm-cache-key` **存在**（body 的 `cache_hit` 恒为
   * 空，不可用）。命中时 `latencyMs` 量的是缓存而非模型 —— 实测同一发请求命中前 1.75s、
   * 命中后 0.99s，选型时把这种数当真就会选错（2026-08-13 实测）。
   */
  cacheHit: boolean;
  promptTokens: number;
  completionTokens: number;
  /** 推理型模型的思考 token（含在 `completionTokens` 里）—— 选型时它就是延迟的主因 */
  reasoningTokens: number;
  /** 读响应头 `x-litellm-response-cost`；读不到为 null（**不是** 0 —— 0 会被当成免费） */
  costUsd: number | null;
  /** `x-litellm-call-id`，报障用 */
  callId: string | null;
  /**
   * 模型自己说的收尾方式（`stop`／`length`／…）。
   *
   * **`length` ＝ 被 `max_tokens` 截断**，而截断的回复在别处与成功毫无区别：HTTP 200、
   * `content` 非空、`ok` 为真。不记这一位，日志里就分不出「写跑题了」与「写到一半没额度了」。
   */
  finishReason?: string;
  /** HTTP 状态；网络层失败为 0 */
  status: number;
  ok: boolean;
  error?: string;
}

/** 一世一条的遥测记录（客户端落本地日志，报告按它统计）。 */
export interface HistorianTelemetry {
  /** 一世一个（`seed:lifeIndex`），便于把多次尝试归拢 */
  lifeKey: string;
  ending: EndingType;
  way: WayId | null;
  source: "ai" | "template";
  /** 从发起到定稿（含重试与校验），毫秒 */
  totalMs: number;
  attempts: number;
  calls: CallStat[];
  /** 校验打回的原因（每次尝试一条，成功那次为空） */
  rejections: string[][];
  /** 回落原因：超时／网络／校验不过／未启用 */
  fallbackReason: string | null;
  costUsd: number | null;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
}

export interface HistorianResult {
  entry: ChronicleEntry;
  source: "ai" | "template";
  telemetry: HistorianTelemetry;
}

export interface HistorianOptions {
  /**
   * 网关端点。浏览器里是**同源相对路径**（dev server 的中间件代打，见 tale-client 的
   * `aigwPlugin`）—— 密钥永远不进浏览器包。Node 侧的实验台可以直接给绝对地址。
   */
  endpoint: string;
  model: string;
  /** 一世的总预算（含重试）。到点即回落模板版，绝不让玩家干等 */
  budgetMs: number;
  /** 最多试几次（含首次）。校验打回才重试；网络错不重试（多半还是错） */
  maxAttempts: number;
  /** 一次调用的输出上限。网关默认 ~1024 会截断，见 knowledge/tooling/ai-gateway-litellm.md */
  maxTokens: number;
  temperature: number;
  /** 注入用（测试与 Node 实验台）；缺省用全局 `fetch` */
  fetchImpl?: typeof fetch;
  /** 注入用；缺省 `Date.now`（引擎禁 Date.now，这个包不禁 —— 它本来就在时间轴上） */
  now?: () => number;
  /** 额外请求头（Node 实验台直连网关时放 Authorization；浏览器路径永远为空） */
  headers?: Record<string, string>;
  /** 额外请求体字段（模型专属旋钮，如 `reasoning_effort`），见 `ChatRequest.extraParams` */
  extraParams?: Record<string, unknown>;
}

export const DEFAULT_HISTORIAN_OPTIONS: Omit<HistorianOptions, "endpoint" | "model"> = {
  /*
   * 6s 是计划给的上限，且它躲在死亡演出后面：墨渍 1.2s ＋ 卷轴前的结局演出 4.4s ＝ 5.6s，
   * 而客户端在**死亡那一刻**（玩家还在读死亡旁白、还没按「瞑目」）就发起调用，
   * 所以实机的可感知等待恒为 0。
   */
  budgetMs: 6000,
  maxAttempts: 2,
  maxTokens: 4096,
  /*
   * 恒为 1 —— 不是「想要最大随机」，是**只有 1 到处都收**：网关后面的 `gpt-5.5`／`gpt-5.6`／
   * `Kimi-latest` 对非默认 temperature 直接回 400（`unsupported_value`，实测 2026-08-13），
   * 而 `-with-fallback` 别名随时可能把请求切到它们身上。一个会让 fallback 全灭的参数，
   * 不值那点温度微调。
   *
   * ⚠️ 也**别拿 temperature 去绕网关缓存**：它对上述模型是致命参数，一改就整批 400
   * （这条注释本身就是那么踩出来的）。绕缓存用 `cache: {"no-cache": true}`，见实验台。
   */
  temperature: 1,
};
