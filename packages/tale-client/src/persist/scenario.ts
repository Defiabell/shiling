/**
 * 生成事件包的 localStorage 读写 —— **「同一局重放必须一致」这条红线的兑现方式**。
 *
 * ## 为什么非存不可
 * 生成是一次网络调用，同样的输入每次得到的文本都不一样。若不存，玩家刷新一次页面
 * 或者从存档回到同一局，撞见的就是另一个剧本 —— 「同一种子同一局」当场变成两件事
 * （架构红线 1：生成结果随存档持久化，同一局重放必须完全一致）。
 *
 * 存下来之后这件事变成结构性的：**同一个 `cacheKey` 只生成一次**，之后一律读缓存，
 * 连请求都不发（顺带省钱）。
 *
 * ## 读取一律防御式
 * 同 `bloodline.ts`：存档是用户机器上的任意字符串，可能是旧版本、被手改过、或者
 * 半截写坏的。任何一处不合形状就当没有缓存，绝不让一世开局崩在读档上 —— 而这里比
 * 血统更要紧：一条形状不对的事件塞进事件池，引擎会在 `applyEffects` 里当场抛错。
 */

import type { TaleEvent } from "@shiling/tale-sim";
import type { StorageLike } from "./bloodline.js";

/** 带版本号：结构变了就换 key，旧档自然失效而不是被误读。 */
export const SCENARIO_KEY = "shiling.tale.scenario.v1";

/**
 * 留几局。
 *
 * 三局：够覆盖「刷新回到这一局」与「上一局刚死、这一局刚开」，又不至于把 localStorage
 * 撑爆（一局十六条事件约 8〜12KB，配额通常 5MB）。超出丢最旧。
 */
export const SCENARIO_CAPACITY = 3;

interface StoredPack {
  cacheKey: string;
  version: number;
  events: TaleEvent[];
}

/**
 * 事件形状的**逐字段**校验。
 *
 * 比血统那边严得多，理由在文件头：坏事件不是显示错，是引擎抛错。这里只认
 * 「引擎读得懂的最小形状」—— 更深的正确性（id 是否存在、数值是否越界）由 tale-ai
 * 的 `auditEvent` 在生成那一刻把过，缓存里的东西本来就是过了那一关才写进来的。
 */
function isEvent(value: unknown): value is TaleEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Record<string, unknown>;
  if (typeof event.id !== "string" || typeof event.title !== "string" || typeof event.body !== "string") {
    return false;
  }
  if (typeof event.trigger !== "object" || event.trigger === null) return false;
  const trigger = event.trigger as Record<string, unknown>;
  if (typeof trigger.region !== "string" || typeof trigger.weight !== "number") return false;
  if (!Array.isArray(event.choices) || event.choices.length === 0) return false;
  return event.choices.every((choice) => {
    if (typeof choice !== "object" || choice === null) return false;
    const record = choice as Record<string, unknown>;
    if (typeof record.label !== "string") return false;
    if (!Array.isArray(record.outcomes) || record.outcomes.length === 0) return false;
    return record.outcomes.every((outcome) => {
      if (typeof outcome !== "object" || outcome === null) return false;
      const item = outcome as Record<string, unknown>;
      return (
        typeof item.weight === "number" &&
        typeof item.text === "string" &&
        typeof item.effects === "object" &&
        item.effects !== null
      );
    });
  });
}

export function parseScenarioStore(raw: string | null, version: number): Map<string, TaleEvent[]> {
  const store = new Map<string, TaleEvent[]>();
  if (!raw) return store;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return store;
  }
  if (!Array.isArray(data)) return store;
  for (const item of data) {
    if (typeof item !== "object" || item === null) continue;
    const pack = item as Partial<StoredPack>;
    // 版本不符即丢弃：拿旧结构的事件去喂新引擎是最难查的一类 bug
    if (typeof pack.cacheKey !== "string" || pack.version !== version) continue;
    if (!Array.isArray(pack.events)) continue;
    const events = pack.events.filter(isEvent);
    if (events.length > 0) store.set(pack.cacheKey, events);
  }
  return store;
}

export function serializeScenarioStore(store: ReadonlyMap<string, TaleEvent[]>, version: number): string {
  const entries = [...store.entries()].slice(-SCENARIO_CAPACITY);
  return JSON.stringify(entries.map(([cacheKey, events]) => ({ cacheKey, version, events })));
}

/** 读这一局的包；没有（或读坏了）返回 null，调用方据此去生成。 */
export function loadScenarioPack(
  storage: StorageLike | null,
  cacheKey: string,
  version: number,
): TaleEvent[] | null {
  if (!storage) return null;
  try {
    return parseScenarioStore(storage.getItem(SCENARIO_KEY), version).get(cacheKey) ?? null;
  } catch {
    return null;
  }
}

/**
 * 写这一局的包（**每一批落定都写一次**，所以中途刷新也留得住已经生成的那几条）。
 *
 * 写入失败（配额满／隐私模式）返回 false，调用方只降级不报错 —— 缓存丢了最多是
 * 下一次重放时重新生成一遍，不是故障。
 */
export function saveScenarioPack(
  storage: StorageLike | null,
  cacheKey: string,
  events: readonly TaleEvent[],
  version: number,
): boolean {
  if (!storage) return false;
  try {
    const store = parseScenarioStore(storage.getItem(SCENARIO_KEY), version);
    // 先删再设：Map 按插入序，重设一个已存在的键不会把它挪到队尾，
    // 于是「超出丢最旧」会丢掉刚刚才更新过的那一局
    store.delete(cacheKey);
    store.set(cacheKey, [...events]);
    storage.setItem(SCENARIO_KEY, serializeScenarioStore(store, version));
    return true;
  } catch {
    return false;
  }
}
