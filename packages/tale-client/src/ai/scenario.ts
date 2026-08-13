/**
 * 客户端这一侧的「一世一剧本」接线 —— 只做四件事：**该不该生成、读不读得到缓存、
 * 生成好了往哪注、把账记下来**。
 *
 * 生成与校验的逻辑全在 `@shiling/tale-ai`（唯一允许联网的包），这里不重复一行。
 * 密钥不在这个文件里，也不在浏览器里：`/ai/chat` 是同源相对路径，dev server 的
 * `aigwPlugin` 在 Node 侧注入 `Authorization`。生产构建没有那个端点 → 404 → 静默不生成，
 * 手写池照常开局（架构红线 4）。
 */

import {
  SCENARIO_PACK_VERSION,
  generateScenario,
  type ScenarioTelemetry,
} from "@shiling/tale-ai";
import type { TaleContent, TaleEvent, TaleState } from "@shiling/tale-sim";
import { AI_CHAT_ENDPOINT } from "./historian.js";
import { loadScenarioPack, saveScenarioPack } from "../persist/scenario.js";
import type { StorageLike } from "../persist/bloodline.js";

/**
 * 缺省模型 —— **这一批与史官的选型结论不同，因为约束不同**。
 *
 * 史官那边一世一次调用，躲在 5.6s 的死亡演出后面，所以只有 mini 档进得来。这一批
 * 一秒都不挡玩家（降世屏之后就开打，头几个回合本来就用手写池），于是**该买的是质量**。
 *
 * 2026-08-13 实测（同一副骨架、十六槽、四批并行、每发都 `cache: {"no-cache": true}`）：
 *
 * | 模型 | 收下 | 耗时 | 每世成本 | 判 |
 * |---|---|---|---|---|
 * | `claude-sonnet-with-fallback` | **16/16** | 102s | $0.34 | ✅ 文笔最好，打回 1 条 |
 * | `gpt-5.4-mini-with-fallback` | 14/16 | 38s | $0.068 | 快十倍、便宜五倍，但打回 18 条，选项字面收敛成「贪某／稳某／让某」 |
 * | `gpt-latest` | 16/16 | 86s | $0.34 | 与 sonnet 同价，思考 token 6499，文笔不占优 |
 * | `gemini-3-flash-with-fallback` | 4/8 | 61s | —— | 思考 token 13948，两次都吐不出可解析的 JSON |
 * | `Kimi-latest`／`DeepSeek-latest` | 0 | >120s | —— | 超预算 |
 * | `GLM-latest` | 0 | —— | —— | 网关侧 429：余额不足 |
 *
 * 选 sonnet 的理由只有一条：这一批的验收标准是「随机抽五条混进手写事件里，能不能分辨」。
 * mini 那一版光看三颗按钮就分得出来。
 *
 * `?scenariomodel=` 可以现场换（省钱试或者赶时间时切 mini）。
 */
export const SCENARIO_MODEL = "litellm/claude-sonnet-with-fallback";

export interface ScenarioConfig {
  enabled: boolean;
  endpoint: string;
  model: string;
}

/**
 * 按 URL 查询串定这一局的生成配置（纯函数，好测）。
 *
 * - `?scenario=0` 关掉一世一剧本（离线回落验收、以及任何时候只想玩手写内容）。
 * - `?ai=0` 一并关掉（它是「全部 AI」的总开关，同史官）。
 * - `?scenariomodel=litellm/<名>` 换模型。
 */
export function scenarioConfig(search: string, dev: boolean): ScenarioConfig {
  const params = new URLSearchParams(search);
  const model = params.get("scenariomodel");
  return {
    // 生产构建里端点不存在，留着只会每世多四次必然 404 的请求
    enabled: dev && params.get("scenario") !== "0" && params.get("ai") !== "0",
    endpoint: AI_CHAT_ENDPOINT,
    model: model !== null && /^[\w./-]{3,64}(\[1m\])?$/u.test(model) ? model : SCENARIO_MODEL,
  };
}

/**
 * 「同一局」的定义 —— 缓存键。
 *
 * 用**种子数 ＋ 神种 id**，不用 `lifeIndex`：一世的天时／出身／骨架全部由这两样掷出，
 * 而 `lifeIndex` 会随血统存档漂移（清一次档，同一个种子就变成了另一个 key）。
 */
export function scenarioCacheKey(seedNum: number, seedId: string): string {
  return `${seedNum >>> 0}:${seedId}`;
}

export interface ScenarioRequest {
  state: TaleState;
  content: TaleContent;
  config: ScenarioConfig;
  cacheKey: string;
  storage: StorageLike | null;
  /** 每批落定（或缓存命中）就回调一次 —— 客户端据此热注入 */
  onEvents: (events: readonly TaleEvent[]) => void;
  /**
   * 「这一世还是当初那一世吗」。返回 true ＝ 玩家已经转世走了，**注入与落盘都要立刻停**。
   *
   * 为什么落盘也要停（而不是只停注入）：生成要一两分钟，而一世最短四五岁、不到一分钟就完。
   * 一次陈旧的落盘会做两件坏事 ——
   * ① 它把**玩家没见过的那几批**补进那一局的存档，于是「重放读到的包」与「当时真玩到的包」
   *    不是同一份，正是这一批要保证的性质被自己破坏；
   * ② `saveScenarioPack` 是 delete-then-set（好让刚更新的那局排到队尾），于是一次陈旧的写
   *    会把一个**更新的**局挤出只留三局的缓存。
   *
   * 缺省恒为 false（测试与任何不关心转世的调用方照旧）。
   */
  isStale?: () => boolean;
}

export interface ScenarioOutcome {
  source: "ai" | "cache" | "none";
  events: TaleEvent[];
  telemetry: ScenarioTelemetry | null;
}

/**
 * 起一次生成。**永不抛错、绝不阻塞开局**：调用方拿到 Promise 之后就该去渲染降世屏。
 *
 * 三条路径：
 * 1. 缓存命中 → 同步注入，一次网络请求都不发（同一局重放因此逐字一致）。
 * 2. 没开（生产构建、`?scenario=0`、无 dev server）→ 什么都不做，手写池开局。
 * 3. 生成 → 一批落定就注入一批，并把**累积到当下**的包写回缓存（中途刷新也留得住）。
 */
export async function requestScenario(request: ScenarioRequest): Promise<ScenarioOutcome> {
  // 注入回调是客户端的事，它自己炸了不该把取货流程一起带走（同 `generate.ts` 对 onBatch 的处置）
  const emit = (events: readonly TaleEvent[]): void => {
    try {
      request.onEvents(events);
    } catch {
      /* 注入失败只是少几条事件 */
    }
  };
  const stale = (): boolean => request.isStale?.() === true;

  const cached = loadScenarioPack(request.storage, request.cacheKey, SCENARIO_PACK_VERSION);
  if (cached !== null && cached.length > 0) {
    emit(cached);
    return { source: "cache", events: cached, telemetry: null };
  }
  if (!request.config.enabled) return { source: "none", events: [], telemetry: null };

  const collected: TaleEvent[] = [];
  try {
    const result = await generateScenario({
      state: request.state,
      content: request.content,
      cacheKey: request.cacheKey,
      options: {
        endpoint: request.config.endpoint,
        model: request.config.model,
        onBatch: (events) => {
          collected.push(...events);
          if (stale()) return;
          emit([...collected]);
          saveScenarioPack(request.storage, request.cacheKey, collected, SCENARIO_PACK_VERSION);
        },
      },
    });
    // 收尾再写一次：跨批去重（`dropCollisions`）之后的那一份才是最终的包
    if (result.pack.events.length > 0 && !stale()) {
      emit(result.pack.events);
      saveScenarioPack(request.storage, request.cacheKey, result.pack.events, SCENARIO_PACK_VERSION);
    }
    return {
      source: result.pack.events.length > 0 ? "ai" : "none",
      events: result.pack.events,
      telemetry: result.telemetry,
    };
  } catch {
    // generateScenario 自己不抛；这里兜的是「连 fetch 都不存在」这一类环境事故
    return { source: collected.length > 0 ? "ai" : "none", events: collected, telemetry: null };
  }
}
