/**
 * 客户端这一侧的 AI 史官接线 —— 只做三件事：**该不该调、往哪调、把账记下来**。
 *
 * 作传的逻辑全在 `@shiling/tale-ai`（唯一允许联网的包），这里不重复一行。
 * 密钥不在这个文件里，也不在浏览器里：`/ai/chat` 是同源相对路径，dev server 的
 * `aigwPlugin` 在 Node 侧注入 `Authorization`。生产构建没有那个端点 → 404 → 静默回落模板版。
 */

import { writeChronicle, type HistorianResult, type HistorianTelemetry } from "@shiling/tale-ai";
import type { TaleContent, TaleState } from "@shiling/tale-sim";

/** dev server 中间件的两个端点（同源，故不涉跨域，也不涉密钥）。 */
export const AI_CHAT_ENDPOINT = "/ai/chat";
export const AI_TELEMETRY_ENDPOINT = "/ai/telemetry";

/**
 * 缺省模型 —— **由延迟预算选出来的，不是挑最强的那个**。
 *
 * 2026-08-13 在网关上实测「同一篇列传的 prompt，未命中缓存时要多久」（`pnpm -C
 * packages/tale-ai lab`，每发都带 `cache: {"no-cache": true}` —— 命中缓存的 1.4s 是假象，
 * 判据是响应头 `x-litellm-cache-key`）：
 *
 * | 模型 | 未缓存耗时 | 每世成本 | 判 |
 * |---|---|---|---|
 * | `gpt-5.4-mini-with-fallback` | **3.1s** | $0.0015 | 唯一稳进 6s 的 |
 * | `gpt-5.4-nano-with-fallback` | 4.9s | $0.0008 | 勉强，文笔更弱 |
 * | `gemini-3.5-flash-with-fallback` | 15.6s | $0.029 | 思考 token 2638，超预算 |
 * | `MiniMax-latest` | 31.2s | $0.0007 | 超预算 |
 * | `claude-sonnet-with-fallback` | 35〜44s | $0.035 | 文笔最好，但差一个数量级 |
 * | `claude-fable-latest` | 50.3s | $0.152 | 超预算且最贵 |
 *
 * 结论：一世一次调用要躲在死亡演出（5.6s）后面，就只能用 mini 这一档。真要用 sonnet 的
 * 文笔，得先改交付形态（如「列传后台生成，下次开图谱时才补上」），那是另一批的事。
 *
 * 名字里的 `-with-fallback` **不是选它的理由，也不给这条路径任何兜底**（2026-08-13 查实）：
 * 网关的 model-group fallback 表只有三条（`gpt-with-fallback`→`gemini-latest` 等），不含它；
 * `/model/info` 显示它底下只挂一个 deployment（`openai/gpt-5.4-mini`）。用这个 id 纯粹是
 * 因为 mini 档在网关上**只有它** —— 裸名 `litellm/gpt-5.4-mini` 不存在。
 *
 * 所以模型真下线时，接住的是本包自己：`budgetMs` 到点即回落 `composeChronicle` 的模板版
 * （见 tale-ai/historian.ts 的「永不抛错、永不超时」）。玩家最多少读一篇 AI 传，不会卡住。
 */
export const AI_MODEL = "litellm/gpt-5.4-mini-with-fallback";

export interface HistorianConfig {
  enabled: boolean;
  endpoint: string;
  model: string;
}

/**
 * 按 URL 查询串定这一局的 AI 配置（纯函数，好测）。
 *
 * - `?ai=0` 关掉 AI 史官（离线回落验收、以及任何时候想看模板版原样）。
 * - `?aimodel=litellm/<名>` 换模型（dev 试模型用，形状按网关的 id 规矩收紧）。
 */
export function historianConfig(search: string, dev: boolean): HistorianConfig {
  const params = new URLSearchParams(search);
  const model = params.get("aimodel");
  return {
    // 生产构建里端点不存在，留着只会每世多一次必然 404 的请求
    enabled: dev && params.get("ai") !== "0",
    endpoint: AI_CHAT_ENDPOINT,
    model: model !== null && /^[\w./-]{3,64}(\[1m\])?$/u.test(model) ? model : AI_MODEL,
  };
}

/**
 * 起一次作传。**永不抛错**：拿不到 AI 版就回落模板版（`writeChronicle` 自己保证），
 * 这里再兜一层是为了「连回落都炸了」的极端情况 —— 那时返回 null，调用方走 `composeChronicle`。
 */
export async function requestChronicle(
  state: TaleState,
  content: TaleContent,
  config: HistorianConfig,
  lifeKey: string,
): Promise<HistorianResult | null> {
  if (!config.enabled) return null;
  try {
    return await writeChronicle({
      state,
      content,
      lifeKey,
      options: { endpoint: config.endpoint, model: config.model },
    });
  } catch {
    return null;
  }
}

/**
 * 把这一世的账（token／耗时／成本／回落原因）送去 dev server 落盘。
 *
 * 发完不等、失败不管：遥测挂掉绝不能影响玩家看列传。用 `keepalive` 是因为这条请求
 * 恰好发在切屏那一刻，页面若被刷新，普通 fetch 会被中断。
 */
export function reportTelemetry(telemetry: HistorianTelemetry): void {
  try {
    void fetch(AI_TELEMETRY_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ at: new Date().toISOString(), ...telemetry }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* 遥测是可选项 */
  }
}
