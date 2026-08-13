/**
 * 编排层 —— 这一层唯一的承诺是：**永远返回一篇能读的列传，永远不超预算**。
 *
 * 「AI 挂了游戏照常」不是一句设计宣言，它就是下面这几条断言。
 */

import { describe, expect, it } from "vitest";
import { composeChronicle } from "@shiling/tale-sim";
import { writeChronicle } from "../src/index.js";
import { collectLifeFacts } from "../src/facts.js";
import { CONTENT, KILL_RECORD, MOLT_RECORD, fakeFetch, finishedLife, goodDraft } from "./helpers.js";

const STATE = finishedLife({ ending: "oldage", extraRecords: [MOLT_RECORD, KILL_RECORD] });
const PREFIXES = collectLifeFacts(STATE, CONTENT).excerpts.map((excerpt) => excerpt.prefix);
const GOOD = JSON.stringify(goodDraft(PREFIXES));
const BAD = JSON.stringify({ ...goodDraft(PREFIXES), middle: [] });

function run(script: (string | Error | { status: number; body?: string })[], overrides = {}) {
  const { impl, calls } = fakeFetch(script);
  return {
    calls,
    result: writeChronicle({
      state: STATE,
      content: CONTENT,
      lifeKey: "t:1",
      options: { endpoint: "/ai/chat", model: "test-model", fetchImpl: impl, ...overrides },
    }),
  };
}

describe("成稿", () => {
  it("一次过：正文是 AI 版，结构与模板版同形（开篇／编年／收束／赞曰）", async () => {
    const { result } = run([GOOD]);
    const { entry, source, telemetry } = await result;
    expect(source).toBe("ai");
    const lines = entry.body.split("\n");
    expect(lines).toHaveLength(1 + PREFIXES.length + 2);
    expect(lines[lines.length - 1]?.startsWith(CONTENT.chronicleTemplates.praisePrefix)).toBe(true);
    lines.slice(1, 1 + PREFIXES.length).forEach((line, index) => {
      expect(line.startsWith(`${PREFIXES[index]}，`)).toBe(true);
    });
    // 标题与元信息仍由引擎出（AI 只写正文）
    expect(entry.title).toBe(composeChronicle(STATE, CONTENT).title);
    expect(entry.years).toBe(STATE.year);
    expect(telemetry.fallbackReason).toBeNull();
  });

  it("token／成本／耗时都记了账（成本读的是响应头）", async () => {
    const { result } = run([GOOD]);
    const { telemetry } = await result;
    expect(telemetry.promptTokens).toBe(1200);
    expect(telemetry.completionTokens).toBe(400);
    expect(telemetry.costUsd).toBeCloseTo(0.0031, 6);
    expect(telemetry.calls[0]?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("头一稿被打回时带着问题重问，第二稿通过", async () => {
    const { result, calls } = run([BAD, GOOD]);
    const { source, telemetry } = await result;
    expect(source).toBe("ai");
    expect(telemetry.attempts).toBe(2);
    expect(telemetry.rejections[0]?.join("")).toMatch(/条数/u);
    // 重试请求里带着上一稿与逐条问题（不是把同一个 prompt 再发一遍）
    const retry = calls[1]?.body as { messages: { role: string; content: string }[] };
    expect(retry.messages.some((message) => message.role === "assistant")).toBe(true);
    expect(retry.messages[retry.messages.length - 1]?.content).toMatch(/不合格/u);
  });
});

describe("回落（AI 不可用时游戏照常）", () => {
  const templateBody = composeChronicle(STATE, CONTENT).body;

  it("网络层炸 → 模板版，且不重试（重试只会白花预算）", async () => {
    const { result, calls } = run([new TypeError("Failed to fetch")]);
    const { entry, source, telemetry } = await result;
    expect(source).toBe("template");
    expect(entry.body).toBe(templateBody);
    expect(calls).toHaveLength(1);
    expect(telemetry.fallbackReason).toMatch(/TypeError/u);
  });

  it("没配 key（503）→ 模板版", async () => {
    const { result } = run([{ status: 503, body: '{"error":"aigw-key-missing"}' }]);
    const { source, telemetry } = await result;
    expect(source).toBe("template");
    expect(telemetry.fallbackReason).toMatch(/503/u);
  });

  it("两稿都不合格 → 模板版，两次尝试都记了账", async () => {
    const { result } = run([BAD, BAD]);
    const { entry, source, telemetry } = await result;
    expect(source).toBe("template");
    expect(entry.body).toBe(templateBody);
    expect(telemetry.attempts).toBe(2);
    expect(telemetry.rejections).toHaveLength(2);
  });

  it("模型返空（被 max_tokens 截断的典型症状）→ 模板版", async () => {
    const { impl } = fakeFetch([""]);
    const { source, telemetry } = await writeChronicle({
      state: STATE,
      content: CONTENT,
      lifeKey: "t:1",
      options: { endpoint: "/ai/chat", model: "test-model", fetchImpl: impl },
    });
    expect(source).toBe("template");
    expect(telemetry.fallbackReason).toMatch(/空回复/u);
  });

  it("超预算 → 模板版，且不会等到天荒地老", async () => {
    const { impl } = fakeFetch([GOOD], { delayMs: 400 });
    const started = Date.now();
    const { source } = await writeChronicle({
      state: STATE,
      content: CONTENT,
      lifeKey: "t:1",
      options: { endpoint: "/ai/chat", model: "test-model", fetchImpl: impl, budgetMs: 60 },
    });
    expect(source).toBe("template");
    expect(Date.now() - started).toBeLessThan(400);
  });

  it("剩余预算不够再试一次时不重试（宁可回落，也不白花一次钱还是回落）", async () => {
    const { impl, calls } = fakeFetch([BAD, GOOD], { delayMs: 30 });
    const { source } = await writeChronicle({
      state: STATE,
      content: CONTENT,
      lifeKey: "t:1",
      options: { endpoint: "/ai/chat", model: "test-model", fetchImpl: impl, budgetMs: 900 },
    });
    expect(source).toBe("template");
    expect(calls).toHaveLength(1);
  });

  it("网关回了一堆看不懂的东西 → 仍然给一篇能读的传，且不抛", async () => {
    // 「永不抛错」这条承诺要盖住的不只是网络错：HTML 错误页、JSON 但结构不对、fetch 自己炸
    for (const script of [
      [{ status: 200, body: "<html>gateway</html>" }],
      [{ status: 200, body: JSON.stringify({ hello: "world" }) }],
      [new TypeError("Load failed")],
    ] as const) {
      const { impl } = fakeFetch([...script]);
      const result = await writeChronicle({
        state: STATE,
        content: CONTENT,
        lifeKey: "t:1",
        options: { endpoint: "/ai/chat", model: "test-model", fetchImpl: impl },
      });
      expect(result.source).toBe("template");
      expect(result.entry.body.length).toBeGreaterThan(0);
    }
  });

  it("请求体带足 max_tokens（网关默认 ~1024 会截断推理模型）", async () => {
    const { result, calls } = run([GOOD]);
    await result;
    expect((calls[0]?.body as { max_tokens: number }).max_tokens).toBeGreaterThanOrEqual(4096);
  });
});
