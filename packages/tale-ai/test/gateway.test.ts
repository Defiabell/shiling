/**
 * 网关客户端 —— 这一层的三条断言全都对着**文件头注释里那三个实测坑**。
 *
 * 写它的理由是 review 指出的一个 gap 形状：三个坑写进了注释，却只有 `max_tokens` 那条
 * 有测试兜着。成本与缓存命中都只影响遥测（不影响回落决策），但下一次重构 header 解析时
 * 它们会**静默**失真 —— 而选型正是拿这两个数做的。
 */

import { describe, expect, it } from "vitest";
import { callChat } from "../src/index.js";

function reply(body: unknown, headers: Record<string, string> = {}): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json", ...headers },
    })) as unknown as typeof fetch;
}

const OK_BODY = {
  choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
  usage: {
    prompt_tokens: 1200,
    completion_tokens: 900,
    completion_tokens_details: { reasoning_tokens: 640 },
  },
};

async function call(fetchImpl: typeof fetch) {
  return callChat({
    endpoint: "/ai/chat",
    model: "test-model",
    messages: [{ role: "user", content: "作传" }],
    maxTokens: 4096,
    temperature: 1,
    fetchImpl,
  });
}

describe("响应头（body 里没有的那些账）", () => {
  it("成本读 `x-litellm-response-cost`；读不到是 null 而不是 0", async () => {
    const priced = await call(reply(OK_BODY, { "x-litellm-response-cost": "0.0031" }));
    expect(priced.stat.costUsd).toBeCloseTo(0.0031, 6);
    // 0 会被下游当成「这次免费」，而真相是「不知道花了多少」——两者必须分得开
    const silent = await call(reply(OK_BODY));
    expect(silent.stat.costUsd).toBeNull();
  });

  it("缓存命中的判据是 `x-litellm-cache-key` 存在与否（body 里没有任何标志）", async () => {
    const hit = await call(reply(OK_BODY, { "x-litellm-cache-key": "abc123" }));
    expect(hit.stat.cacheHit).toBe(true);
    const miss = await call(reply(OK_BODY));
    expect(miss.stat.cacheHit).toBe(false);
  });

  it("call-id 记下来（报障要带）", async () => {
    const stat = (await call(reply(OK_BODY, { "x-litellm-call-id": "req-7" }))).stat;
    expect(stat.callId).toBe("req-7");
  });
});

describe("usage", () => {
  it("思考 token 单独记账 —— 它就是推理型模型延迟的主因", async () => {
    const stat = (await call(reply(OK_BODY))).stat;
    expect(stat.promptTokens).toBe(1200);
    expect(stat.completionTokens).toBe(900);
    expect(stat.reasoningTokens).toBe(640);
  });

  it("网关不给 usage 时按 0 记，不崩", async () => {
    const stat = (await call(reply({ choices: [{ message: { content: "{}" } }] }))).stat;
    expect(stat.promptTokens).toBe(0);
    expect(stat.reasoningTokens).toBe(0);
    expect(stat.ok).toBe(true);
  });
});

describe("请求体", () => {
  it("`extraParams` 原样并进去（模型专属旋钮，如 no-cache／reasoning_effort）", async () => {
    let sent: Record<string, unknown> = {};
    const spy = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify(OK_BODY), { status: 200 });
    }) as unknown as typeof fetch;
    await callChat({
      endpoint: "/ai/chat",
      model: "test-model",
      messages: [{ role: "user", content: "作传" }],
      maxTokens: 4096,
      temperature: 1,
      fetchImpl: spy,
      extraParams: { cache: { "no-cache": true } },
    });
    expect(sent.cache).toEqual({ "no-cache": true });
    expect(sent.max_tokens).toBe(4096);
    expect(sent.temperature).toBe(1);
  });
});

describe("失败路径", () => {
  it("非 JSON 响应 → 记错不抛", async () => {
    const impl = (async () => new Response("<html>502</html>", { status: 200 })) as unknown as typeof fetch;
    const stat = (await call(impl)).stat;
    expect(stat.ok).toBe(false);
    expect(stat.error).toMatch(/不是 JSON/u);
  });

  it("HTTP 错时正文只留前 200 字进日志（可能是整页 HTML）", async () => {
    const impl = (async () => new Response("x".repeat(5000), { status: 500 })) as unknown as typeof fetch;
    const stat = (await call(impl)).stat;
    expect(stat.ok).toBe(false);
    expect((stat.error ?? "").length).toBeLessThan(260);
  });
});
