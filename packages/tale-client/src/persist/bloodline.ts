/**
 * 血统（跨世资产）的 localStorage 读写包装。
 *
 * 归属：计划把持久化划给 tale-client（引擎不碰 IO）。这里刻意接 `StorageLike` 而不是
 * 直接摸全局 `localStorage`，两个原因：单测能在 node 里跑（不需要 jsdom），以及隐私模式
 * 下 `localStorage` 取值即抛异常时能整体降级成「内存存档」而不是白屏。
 *
 * 读取一律**防御式**：存档是用户机器上的任意字符串，可能是旧版本、被手改过、或者
 * 半截写坏的。任何一处不合形状就退回默认值，绝不让一世开局崩在读档上。
 */

import type { Bloodline, ChronicleEntry, EndingType, TaleContent } from "@shiling/tale-sim";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 带版本号：将来结构变了就换 key，旧档自然失效而不是被误读。 */
export const BLOODLINE_KEY = "shiling.tale.bloodline.v1";

/** 列传目录上限 —— localStorage 有配额，一世一篇，留 60 世足够，超出丢最旧。 */
export const CHRONICLE_CAPACITY = 60;

const ENDINGS: readonly EndingType[] = ["starve", "slain", "oldage", "ascend"];

/** 免费神种（cost ≤ 0）恒为已解锁 —— 否则新玩家一个可选项都没有。 */
export function emptyBloodline(content: TaleContent): Bloodline {
  return {
    points: 0,
    unlockedSeedIds: content.seeds.filter((seed) => seed.cost <= 0).map((seed) => seed.id),
    chronicle: [],
  };
}

function isChronicleEntry(value: unknown): value is ChronicleEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.title === "string" &&
    typeof entry.body === "string" &&
    typeof entry.years === "number" &&
    typeof entry.organCount === "number" &&
    typeof entry.ending === "string" &&
    ENDINGS.includes(entry.ending as EndingType)
  );
}

/**
 * 解析存档 JSON。
 *
 * 逐字段校验并与内容库对账：`unlockedSeedIds` 里已不存在的神种 id 会被丢掉
 * （内容改名后留着它只会让「已解锁」数目虚高），免费种恒被补上。
 */
export function parseBloodline(raw: string | null, content: TaleContent): Bloodline {
  const fallback = emptyBloodline(content);
  if (!raw) return fallback;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (typeof data !== "object" || data === null) return fallback;
  const record = data as Record<string, unknown>;

  const points =
    typeof record.points === "number" && Number.isFinite(record.points)
      ? Math.max(0, Math.floor(record.points))
      : 0;

  const knownSeedIds = new Set(content.seeds.map((seed) => seed.id));
  const stored = Array.isArray(record.unlockedSeedIds) ? record.unlockedSeedIds : [];
  const unlockedSeedIds = [...fallback.unlockedSeedIds];
  for (const id of stored) {
    if (typeof id === "string" && knownSeedIds.has(id) && !unlockedSeedIds.includes(id)) {
      unlockedSeedIds.push(id);
    }
  }

  const storedChronicle = Array.isArray(record.chronicle) ? record.chronicle : [];
  const chronicle = storedChronicle.filter(isChronicleEntry).slice(-CHRONICLE_CAPACITY);

  return { points, unlockedSeedIds, chronicle };
}

export function serializeBloodline(bloodline: Bloodline): string {
  return JSON.stringify({
    points: bloodline.points,
    unlockedSeedIds: bloodline.unlockedSeedIds,
    chronicle: bloodline.chronicle.slice(-CHRONICLE_CAPACITY),
  });
}

export function loadBloodline(storage: StorageLike | null, content: TaleContent): Bloodline {
  if (!storage) return emptyBloodline(content);
  try {
    return parseBloodline(storage.getItem(BLOODLINE_KEY), content);
  } catch {
    return emptyBloodline(content);
  }
}

/** 写入失败（配额满／隐私模式）返回 false，调用方只降级不报错。 */
export function saveBloodline(storage: StorageLike | null, bloodline: Bloodline): boolean {
  if (!storage) return false;
  try {
    storage.setItem(BLOODLINE_KEY, serializeBloodline(bloodline));
    return true;
  } catch {
    return false;
  }
}

/** 一世收束：加血统点 ＋ 列传入目录（纯，返回新对象）。 */
export function recordLife(
  bloodline: Bloodline,
  gainedPoints: number,
  entry: ChronicleEntry,
): Bloodline {
  return {
    points: bloodline.points + Math.max(0, Math.floor(gainedPoints)),
    unlockedSeedIds: [...bloodline.unlockedSeedIds],
    chronicle: [...bloodline.chronicle, entry].slice(-CHRONICLE_CAPACITY),
  };
}

/**
 * 花血统点解锁神种（纯）。
 *
 * 点数不足、id 未知、或已解锁时返回 null —— 调用方据此不改状态、不扣点。
 */
export function unlockSeed(
  bloodline: Bloodline,
  seedId: string,
  content: TaleContent,
): Bloodline | null {
  const seed = content.seeds.find((candidate) => candidate.id === seedId);
  if (!seed) return null;
  if (seed.cost <= 0 || bloodline.unlockedSeedIds.includes(seedId)) return null;
  if (bloodline.points < seed.cost) return null;
  return {
    points: bloodline.points - seed.cost,
    unlockedSeedIds: [...bloodline.unlockedSeedIds, seedId],
    chronicle: [...bloodline.chronicle],
  };
}

/** 浏览器里取 localStorage；不可用（隐私模式/无 window）时返回 null。 */
export function browserStorage(): StorageLike | null {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;
    // 探一次写：Safari 隐私模式下 localStorage 存在但 setItem 直接抛。
    const probe = `${BLOODLINE_KEY}.probe`;
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}
