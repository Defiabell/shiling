/**
 * 一世一剧本的编排：出骨架 → 分批生成 → 逐条校验 → 打回重写 → 到点收摊。
 *
 * ## 两条不可动摇的性质
 * 1. **永不抛错**。它跑在降世那一刻，任何一步出岔子（无网络、无 key、网关 5xx、JSON 崩、
 *    校验全红、预算耗尽）都只是**少几条生成事件**，手写池照常开局（架构红线 4）。
 *    所以调用方不必 try／catch。
 * 2. **绝不阻塞开局**。调用方拿到的是一个 Promise，玩家那边该点第一个行动就点第一个行动。
 *    每批落定即回调 `onBatch` —— 头一批四条通常几秒就到，热注入之后马上就能撞上。
 *
 * ## 为什么要分批（而不是一发要十六条）
 * 一条事件的 JSON 约 350〜500 token，十六条就是 6000〜8000 —— 一发要完的后果实测有三样：
 * 生成时间线性堆到分钟级、`max_tokens` 一超就**整发作废**（截断的 JSON 连解析都过不去，
 * 钱花了一条也拿不到）、以及校验打回时要连坐重写十六条。
 * 分成四批并行：墙钟时间 ≈ 最慢那一批，某一批崩了只损失那四条，重试也只重试那四条。
 */

import type { TaleContent, TaleEvent, TaleState } from "@shiling/tale-sim";
import { callChat, type ChatMessage } from "../gateway.js";
import type { CallStat } from "../types.js";
import { assembleEvent, buildSlots } from "./slots.js";
import {
  buildScenarioMessages,
  premiseBlock,
  retryScenarioMessages,
  styleAnchors,
  writtenDigest,
} from "./prompt.js";
import { SCENARIO_COPY_SPAN, parseScenarioReply, validateEventDraft } from "./validate.js";
import { longestSharedSpan } from "../validate.js";
import {
  DEFAULT_SCENARIO_OPTIONS,
  SLOT_COUNT,
  type BatchStat,
  type ScenarioOptions,
  type ScenarioPack,
  type ScenarioResult,
  type ScenarioTelemetry,
  type SlotSpec,
} from "./types.js";

/** 生成包的结构版本。换结构就换号，旧存档里的包自然失效而不是被误读。 */
export const SCENARIO_PACK_VERSION = 1;

/**
 * 再试一次至少要留这么多毫秒；不够就不试了（同 P1：重试到一半超时比不重试更糟 ——
 * 前者白花一次钱还是拿不到）。
 *
 * 四十五秒是按**选进生产的那一档**定的：`claude-sonnet` 一批四条实测 70〜102s，
 * 用史官那边的 1.8s 会让每一次打回都启动一次注定超时的重试。
 */
const RETRY_HEADROOM_MS = 45_000;

export interface ScenarioInput {
  /** 刚降世的状态（只读 seed／region／skyId／originId） */
  state: TaleState;
  content: TaleContent;
  /** 「同一局」的定义 —— 生成包按它持久化，重放读同一份 */
  cacheKey: string;
  options: Partial<ScenarioOptions> & Pick<ScenarioOptions, "endpoint" | "model">;
  /** 槽位数（缺省 16）。lab 里调小可以省钱地试 prompt */
  slotCount?: number;
}

/**
 * 专名目录：这一世**不许被点名**的兽／器／神。
 *
 * 数据驱动（从 `TaleContent` 现取）而不是写一张名单：内容库加一头兽时，名单不会自己跟上，
 * 而漏掉的那个名字恰恰是最新、最容易被模型抓去用的那个。
 */
export function catalogNouns(content: TaleContent): string[] {
  const nouns = new Set<string>();
  const add = (name: string): void => {
    for (const alias of nounAliases(name)) if (alias.length >= 2) nouns.add(alias);
  };
  for (const organ of content.organs) add(organ.name);
  for (const seed of content.seeds) {
    add(seed.name);
    add(seed.organ.name);
  }
  for (const enemy of content.enemies) add(enemy.name);
  return [...nouns];
}

/** 「穷奇幼崽」在文案里多半只写「穷奇」—— 不收别名就查不出这一类点名。 */
function nounAliases(name: string): string[] {
  const stripped = name.replace(/(幼崽|之属|遗种|鱼)$/u, "");
  return stripped.length >= 2 && stripped !== name ? [name, stripped] : [name];
}

/** 本槽位**允许**出现的专名：只有它自己那场搏杀的对手。 */
function allowedNounsFor(slot: SlotSpec, content: TaleContent): string[] {
  const enemyById = new Map(content.enemies.map((enemy) => [enemy.id, enemy]));
  const names: string[] = [];
  for (const choice of slot.choices) {
    for (const outcome of choice.outcomes) {
      const id = outcome.fixed.startCombat;
      const enemy = id === undefined ? undefined : enemyById.get(id);
      if (enemy) names.push(...nounAliases(enemy.name));
    }
  }
  return names;
}

export async function generateScenario(input: ScenarioInput): Promise<ScenarioResult> {
  const options: ScenarioOptions = { ...DEFAULT_SCENARIO_OPTIONS, ...input.options };
  const now = options.now ?? Date.now;
  const started = now();
  const deadline = started + options.budgetMs;

  const context = buildSlots(input.state, input.content, input.slotCount ?? SLOT_COUNT);
  const anchors = styleAnchors(input.content.events);
  const digest = writtenDigest(input.content.events);
  const premise = premiseBlock(context.sky, context.origin);
  const catalog = catalogNouns(input.content);

  /*
   * 分批前**按年龄段排一次序**（幼年的槽位先走）。
   *
   * 理由是时序而不是整洁：四批并行，最快的那一批也要几十秒才回得来，而玩家那时已经在玩了。
   * 若把 `minYear: 8` 的槽位排进第一批，它先落地也没用（那一世还没到八岁）；把
   * `maxYear: 4` 的排进第一批，落地那一刻它正好还在窗口里。
   * `trigger.minYear` 缺省即幼年（0），所以一次稳定排序就够。
   */
  const ordered = [...context.slots].sort((a, b) => (a.trigger.minYear ?? 0) - (b.trigger.minYear ?? 0));
  const batches: SlotSpec[][] = [];
  for (let index = 0; index < ordered.length; index += options.batchSize) {
    batches.push(ordered.slice(index, index + options.batchSize));
  }

  const results = await Promise.all(
    batches.map((slots) =>
      runBatch({
        slots,
        content: input.content,
        anchors,
        digest,
        premise,
        catalog,
        writtenTitles: context.writtenTitles,
        writtenBodies: context.writtenBodies,
        premiseNames: [context.sky.name, context.origin.name],
        options,
        deadline,
        now,
      }),
    ),
  );

  /*
   * 跨批去重放在最后、按槽位序做一遍 —— 四批是并行的，谁先回来是网络说了算，
   * 让它们互相看着去重会让「同一局生成出哪十六条」取决于网络时序（那是最难查的一类不确定）。
   */
  const events = dropCollisions(results.flatMap((result) => result.events));

  const stats = results.map((result) => result.stat);
  const calls = stats.flatMap((stat) => stat.calls);
  const costs = calls.map((call) => call.costUsd).filter((cost): cost is number => cost !== null);
  const failureReason =
    events.length > 0
      ? null
      : (calls.find((call) => !call.ok)?.error ??
        stats.flatMap((stat) => stat.rejections.flat())[0] ??
        "未生成任何事件");

  const telemetry: ScenarioTelemetry = {
    cacheKey: input.cacheKey,
    skyId: input.state.skyId,
    originId: input.state.originId,
    source: events.length > 0 ? "ai" : "none",
    totalMs: now() - started,
    accepted: events.length,
    slots: context.slots.length,
    batches: stats,
    costUsd: costs.length > 0 ? costs.reduce((sum, cost) => sum + cost, 0) : null,
    promptTokens: calls.reduce((sum, call) => sum + call.promptTokens, 0),
    completionTokens: calls.reduce((sum, call) => sum + call.completionTokens, 0),
    reasoningTokens: calls.reduce((sum, call) => sum + call.reasoningTokens, 0),
    failureReason,
  };

  const pack: ScenarioPack = { cacheKey: input.cacheKey, version: SCENARIO_PACK_VERSION, events };
  return { pack, telemetry };
}

interface BatchInput {
  slots: SlotSpec[];
  content: TaleContent;
  anchors: string[];
  digest: string[];
  premise: string;
  catalog: string[];
  writtenTitles: string[];
  writtenBodies: string[];
  premiseNames: string[];
  options: ScenarioOptions;
  deadline: number;
  now: () => number;
}

interface BatchOutput {
  events: TaleEvent[];
  stat: BatchStat;
}

async function runBatch(input: BatchInput): Promise<BatchOutput> {
  const { options, now } = input;
  const startedAt = now();
  const calls: CallStat[] = [];
  const rejections: string[][] = [];
  const accepted: TaleEvent[] = [];
  const finish = (): BatchOutput => ({
    events: accepted,
    stat: {
      slotIds: input.slots.map((slot) => slot.id),
      accepted: accepted.length,
      attempts: calls.length,
      rejections,
      calls,
      totalMs: now() - startedAt,
    },
  });

  let messages: ChatMessage[] = buildScenarioMessages({
    slots: input.slots,
    anchors: input.anchors,
    writtenDigest: input.digest,
    premiseBlock: input.premise,
  });

  for (let attempt = 0; attempt < options.maxAttempts; attempt += 1) {
    const budgetLeft = input.deadline - now();
    if (budgetLeft <= 0) break;
    /*
     * 自己再挂一个 timer：浏览器的 fetch 不会因为「我们不想等了」而停下，
     * 而一个吊死的批次会把整个 Promise.all 拖到天荒地老（玩家那边虽然照玩，
     * 但遥测与热注入就永远不落定了）。
     */
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), budgetLeft);
    let response;
    try {
      response = await callChat({
        endpoint: options.endpoint,
        model: options.model,
        messages,
        maxTokens: options.maxTokens,
        temperature: options.temperature,
        signal: controller.signal,
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(options.now ? { now: options.now } : {}),
        ...(options.headers ? { headers: options.headers } : {}),
        ...(options.extraParams ? { extraParams: options.extraParams } : {}),
      });
    } catch (error) {
      // callChat 自己不抛，这里兜的是「连 fetch 都不是函数」这一类环境事故
      calls.push(errorStat(options.model, now() - startedAt, describe(error)));
      break;
    } finally {
      clearTimeout(timer);
    }
    calls.push(response.stat);
    if (!response.stat.ok) break;

    const parsed = parseScenarioReply(response.text);
    const problems: string[] = [...parsed.problems];
    const round: TaleEvent[] = [];
    const draftById = new Map(parsed.drafts.map((draft) => [draft.id, draft]));

    for (const slot of input.slots) {
      if (accepted.some((event) => event.id === slot.id)) continue;
      const draft = draftById.get(slot.id);
      if (draft === undefined) {
        if (parsed.drafts.length > 0) problems.push(`槽位 ${slot.id} 没有对应的事件 —— 每个槽位都要写。`);
        continue;
      }
      const assembled = assembleEvent(slot, draft);
      const allowed = new Set(allowedNounsFor(slot, input.content));
      const issues = validateEventDraft(
        draft,
        assembled,
        {
          slot,
          writtenTitles: input.writtenTitles,
          writtenBodies: input.writtenBodies,
          premiseNames: input.premiseNames,
          forbiddenNouns: input.catalog.filter((noun) => !allowed.has(noun)),
          accepted: [...accepted, ...round],
        },
        input.content,
      );
      if (issues.length === 0) round.push(assembled);
      else problems.push(...issues);
    }

    accepted.push(...round);
    /*
     * **一批落定就热注入**（不等别的批）。这是「绝不阻塞开局」那条纪律的兑现方式：
     * 头一批落地时玩家多半才走过两三个季节，那四条当场就进池子。
     * 回调自己抛错不该弄坏生成流程 —— 它是客户端的事，这里只负责递过去。
     */
    if (round.length > 0) {
      try {
        options.onBatch?.(round);
      } catch {
        /* 注入失败只是少几条事件，绝不能反过来打断生成 */
      }
    }
    if (accepted.length === input.slots.length) break;
    rejections.push(problems);
    if (now() + RETRY_HEADROOM_MS >= input.deadline) break;
    /*
     * 重问**只带没过的那几条**：已经收下的不再重写（既省一半时间，也免得把好稿改坏）。
     * 规格书整份重出而不是接在旧对话后面 —— 见 `retryScenarioMessages` 的头注。
     */
    const remaining = input.slots.filter((slot) => !accepted.some((event) => event.id === slot.id));
    messages = retryScenarioMessages(
      buildScenarioMessages({
        slots: remaining,
        anchors: input.anchors,
        writtenDigest: input.digest,
        premiseBlock: input.premise,
      }),
      problems.slice(0, 24),
    );
  }

  return finish();
}

/**
 * 跨批去重：重名或撞正文的，**按槽位序**留先者 —— 与网络时序无关，故同一批结果恒等。
 *
 * 正文那一项是实机补的：批内去重用的是同一条判据（最长公共片段 ≥ `SCENARIO_COPY_SPAN`），
 * 但四批是并行的、互相看不见，于是同一世里出现过两条都写「夜里石缝里又透出那种青光」的
 * 事件（一条在幼年批、一条在壮年批）。闸门的判据在批内批外必须是同一个，否则它挡的是
 * 「同一批里的重复」而不是「同一世里的重复」，而玩家读到的是后者。
 *
 * 这里**丢弃**而不是重生成：跨批去重发生在全部批次落定之后，那时再起一轮网络请求，
 * 换来的是又一百秒和一次收费 —— 而少一条事件的代价远小于此（池子本来就有十六条）。
 */
function dropCollisions(events: readonly TaleEvent[]): TaleEvent[] {
  const kept: TaleEvent[] = [];
  const titles = new Set<string>();
  const ids = new Set<string>();
  for (const event of events) {
    if (ids.has(event.id) || titles.has(event.title)) continue;
    if (kept.some((other) => longestSharedSpan(event.body, other.body, SCENARIO_COPY_SPAN) !== null)) {
      continue;
    }
    ids.add(event.id);
    titles.add(event.title);
    kept.push(event);
  }
  return kept;
}

function errorStat(model: string, latencyMs: number, error: string): CallStat {
  return {
    model,
    latencyMs,
    cacheHit: false,
    promptTokens: 0,
    completionTokens: 0,
    reasoningTokens: 0,
    costUsd: null,
    callId: null,
    status: 0,
    ok: false,
    error,
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
