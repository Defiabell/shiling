/**
 * LiteLLM 网关（OpenAI 兼容）的最小客户端 —— 全仓库唯一发起网络请求的地方。
 *
 * ## 密钥纪律
 * 本文件**不认识**任何密钥。浏览器里 `endpoint` 是同源相对路径，由 dev server 的中间件
 * 代打并在服务端注入 `Authorization`（见 tale-client 的 `aigwPlugin`）；Node 侧的实验台
 * 自己从 `envs/` 读 key 塞进 `headers`。密钥因此永远不进浏览器包、不进日志、不进报告。
 *
 * ## 三个实测坑（knowledge/tooling/ai-gateway-litellm.md）
 * 1. `max_tokens` 默认约 1024，推理型模型会把额度花在 reasoning 上导致输出被截断 →
 *    显式设 4096+（`DEFAULT_HISTORIAN_OPTIONS.maxTokens`）。
 * 2. **成本在响应头 `x-litellm-response-cost`，不在 body** —— 只读 body 的实现会报 cost=0，
 *    那是「免费」的假象。读不到时本文件返回 `null` 而不是 0。
 * 3. **网关会缓存整发请求**，命中时延迟只有真实值的一半上下，且 body 里没有任何标志 ——
 *    唯一可靠判据是响应头 `x-litellm-cache-key` 存在与否，本文件把它记成 `stat.cacheHit`。
 */

import type { CallStat } from "./types.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  endpoint: string;
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  now?: () => number;
  headers?: Record<string, string>;
  /**
   * 额外的请求体字段（如 `reasoning_effort`）。网关按模型转译，不认识的字段会被丢掉，
   * 所以这里放模型专属的旋钮是安全的 —— 但**别放会改语义的东西**，那属于 prompt。
   */
  extraParams?: Record<string, unknown>;
}

export interface ChatResponse {
  text: string;
  stat: CallStat;
}

function toNumber(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function callChat(request: ChatRequest): Promise<ChatResponse> {
  const fetchImpl = request.fetchImpl ?? globalThis.fetch;
  const now = request.now ?? Date.now;
  const started = now();
  const base: CallStat = {
    model: request.model,
    latencyMs: 0,
    cacheHit: false,
    promptTokens: 0,
    completionTokens: 0,
    reasoningTokens: 0,
    costUsd: null,
    callId: null,
    status: 0,
    ok: false,
  };

  let response: Response;
  try {
    response = await fetchImpl(request.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", ...(request.headers ?? {}) },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        ...(request.extraParams ?? {}),
      }),
      ...(request.signal ? { signal: request.signal } : {}),
    });
  } catch (error) {
    return {
      text: "",
      stat: { ...base, latencyMs: now() - started, error: describe(error) },
    };
  }

  const latencyMs = now() - started;
  const stat: CallStat = {
    ...base,
    latencyMs,
    cacheHit: response.headers.get("x-litellm-cache-key") !== null,
    status: response.status,
    costUsd: toNumber(response.headers.get("x-litellm-response-cost")),
    callId: response.headers.get("x-litellm-call-id"),
  };

  if (!response.ok) {
    // 正文可能是 JSON 也可能是 HTML（代理层的错误页）——都只取前 200 字进日志，不整段留存
    const body = await response.text().catch(() => "");
    return { text: "", stat: { ...stat, error: `HTTP ${response.status}：${body.slice(0, 200)}` } };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    return { text: "", stat: { ...stat, error: `响应不是 JSON：${describe(error)}` } };
  }

  const data = payload as {
    choices?: { message?: { content?: unknown }; finish_reason?: unknown }[];
    usage?: {
      prompt_tokens?: unknown;
      completion_tokens?: unknown;
      completion_tokens_details?: { reasoning_tokens?: unknown };
    };
  };
  const content = data.choices?.[0]?.message?.content;
  const text = typeof content === "string" ? content : "";
  const finish = data.choices?.[0]?.finish_reason;

  return {
    text,
    stat: {
      ...stat,
      ok: text.length > 0,
      promptTokens: numberOr(data.usage?.prompt_tokens, 0),
      completionTokens: numberOr(data.usage?.completion_tokens, 0),
      reasoningTokens: numberOr(data.usage?.completion_tokens_details?.reasoning_tokens, 0),
      ...(text.length === 0
        ? { error: `空回复（finish_reason=${String(finish)}）—— 多半是 max_tokens 太小被截断` }
        : {}),
    },
  };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
