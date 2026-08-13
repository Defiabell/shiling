/**
 * AI 史官的编排：取事实 → 作传 → 校验 → 打回重生 → 到点回落模板版。
 *
 * ## 一条不可动摇的性质：**永不抛错、永不超时**
 * 这个函数出现在玩家刚死那一刻的路径上。它无论遇到什么（无网络、无 key、网关 5xx、
 * 模型返空、JSON 崩了、校验全红）都返回一篇能读的列传 —— 拿不到 AI 版就回落
 * `composeChronicle` 的模板版（架构红线 4：离线可玩，绝不因为 AI 不可用而卡住或弹错）。
 * 所以调用方不必 try／catch，也不该给它加 UI 的「加载中」。
 *
 * ## 预算是**总预算**，不是单次超时
 * 一世给 `budgetMs`（缺省 6s），首次调用与重试共享它。剩余时间不够再试一次时直接收摊 ——
 * 「重试到一半超时」比「不重试」更糟：前者白花一次钱还是回落。
 */

import { composeChronicle, type ChronicleEntry, type TaleContent, type TaleState } from "@shiling/tale-sim";
import { collectLifeFacts } from "./facts.js";
import { callChat, type ChatMessage } from "./gateway.js";
import { assembleBody, buildMessages, retryMessages, styleAnchors } from "./prompt.js";
import { parseDraft, validateDraft } from "./validate.js";
import {
  DEFAULT_HISTORIAN_OPTIONS,
  type CallStat,
  type HistorianOptions,
  type HistorianResult,
  type HistorianTelemetry,
  type LifeFacts,
} from "./types.js";

/** 再试一次至少要留这么多毫秒；不够就不试了（见文件头「预算是总预算」）。 */
const RETRY_HEADROOM_MS = 1800;

export interface HistorianInput {
  state: TaleState;
  content: TaleContent;
  /** 遥测归拢用的一世标识（`seed:lifeIndex` 之类），不进 prompt */
  lifeKey: string;
  options: Partial<HistorianOptions> & Pick<HistorianOptions, "endpoint" | "model">;
}

export async function writeChronicle(input: HistorianInput): Promise<HistorianResult> {
  const options: HistorianOptions = { ...DEFAULT_HISTORIAN_OPTIONS, ...input.options };
  const now = options.now ?? Date.now;
  const started = now();
  const template: ChronicleEntry = composeChronicle(input.state, input.content);
  const praisePrefix = input.content.chronicleTemplates.praisePrefix;

  const calls: CallStat[] = [];
  const rejections: string[][] = [];
  const finish = (
    entry: ChronicleEntry,
    source: "ai" | "template",
    fallbackReason: string | null,
  ): HistorianResult => {
    const costs = calls.map((call) => call.costUsd).filter((cost): cost is number => cost !== null);
    const telemetry: HistorianTelemetry = {
      lifeKey: input.lifeKey,
      ending: input.state.ending ?? "oldage",
      way: input.state.wayAchieved,
      source,
      totalMs: now() - started,
      attempts: calls.length,
      calls,
      rejections,
      fallbackReason,
      costUsd: costs.length > 0 ? costs.reduce((sum, cost) => sum + cost, 0) : null,
      promptTokens: calls.reduce((sum, call) => sum + call.promptTokens, 0),
      completionTokens: calls.reduce((sum, call) => sum + call.completionTokens, 0),
      reasoningTokens: calls.reduce((sum, call) => sum + call.reasoningTokens, 0),
    };
    return { entry, source, telemetry };
  };

  let facts: LifeFacts;
  try {
    facts = collectLifeFacts(input.state, input.content);
  } catch (error) {
    // 事实提取炸了是代码 bug，不是运行时意外 —— 但玩家仍该看到一篇传
    return finish(template, "template", `事实提取失败：${describe(error)}`);
  }

  let messages: ChatMessage[] = buildMessages({
    facts,
    anchors: styleAnchors(input.content),
    templateBody: template.body,
  });

  /*
   * 模板版的**自有文案**三段（开篇／收束／赞语），拿去查照抄。
   * 中段那几行是引擎写的记录原句，不查（理由见 `validateDraft` 的 `templateFrame`）。
   */
  const templateLines = template.body.split("\n");
  const templateFrame = [
    templateLines[0],
    templateLines[templateLines.length - 2],
    templateLines[templateLines.length - 1],
  ].filter((line): line is string => typeof line === "string" && line.length > 0);

  const deadline = started + options.budgetMs;
  let lastReason = "预算耗尽";

  for (let attempt = 0; attempt < options.maxAttempts; attempt += 1) {
    const remaining = deadline - now();
    if (remaining <= 0) break;
    /*
     * 单次调用的超时＝剩余预算。用调用方给的 AbortSignal 之外**自己再挂一个 timer**：
     * 浏览器的 fetch 不会因为「我们不想等了」而自己停下，而卷轴那一屏必须准点开。
     */
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
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
    } finally {
      clearTimeout(timer);
    }
    calls.push(response.stat);

    if (!response.stat.ok) {
      lastReason = response.stat.error ?? `调用失败（HTTP ${response.stat.status}）`;
      // 网络／网关错基本不会因为再问一次就好，且重试要吃掉整段预算 —— 直接收摊
      break;
    }

    const parsed = parseDraft(response.text);
    const problems =
      parsed.draft === null
        ? parsed.problems
        : validateDraft(parsed.draft, facts, praisePrefix, templateFrame);

    if (parsed.draft !== null && problems.length === 0) {
      return finish(
        { ...template, body: assembleBody(parsed.draft, praisePrefix) },
        "ai",
        null,
      );
    }

    rejections.push(problems);
    lastReason = `校验打回：${problems.join(" ")}`;
    if (now() + RETRY_HEADROOM_MS >= deadline) break;
    messages = retryMessages(messages, response.text, problems);
  }

  return finish(template, "template", lastReason);
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
