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

import { boonCost, type Bloodline, type ChronicleEntry, type EndingType, type TaleContent } from "@shiling/tale-sim";

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
    // [S1] 图鉴与血脉从零开始 —— 第一世的玩家什么都还没见过，这正是「异变」该有的样子
    knownSynergyIds: [],
    knownOrganIds: [],
    boonOrganId: null,
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

  /*
   * [S1] 图鉴与血脉同样与内容对账：内容改过 id 的旧存档里，悬空的组合 id 会让图鉴
   * 「已知 7/10」虚高（而那 7 条里有一条永远显示不出配方），悬空的器官 id 会让
   * `createLife` 在降世那一刻抛错。宁可丢掉一条已知，也不要一个读不懂的存档。
   *
   * 旧存档（S1 之前）根本没有这三个键 —— 全部退回空，等于「这个玩家还没发现过任何异变」。
   * 那是**对的**降级：图鉴是发现记录，不是解锁开关，不该凭空补上。
   */
  const knownSynergyIds = idList(record.knownSynergyIds, new Set(content.synergies.map((item) => item.id)));
  const knownOrganIds = idList(record.knownOrganIds, new Set(content.organs.map((item) => item.id)));
  const boon = record.boonOrganId;
  const boonOrganId =
    typeof boon === "string" && knownOrganIds.includes(boon) ? boon : null;

  return { points, unlockedSeedIds, chronicle, knownSynergyIds, knownOrganIds, boonOrganId };
}

/** 存档里一串 id：只留内容库里还认得、且不重复的那些。 */
function idList(raw: unknown, known: ReadonlySet<string>): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const id of raw) {
    if (typeof id === "string" && known.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

export function serializeBloodline(bloodline: Bloodline): string {
  return JSON.stringify({
    points: bloodline.points,
    unlockedSeedIds: bloodline.unlockedSeedIds,
    chronicle: bloodline.chronicle.slice(-CHRONICLE_CAPACITY),
    knownSynergyIds: bloodline.knownSynergyIds,
    knownOrganIds: bloodline.knownOrganIds,
    boonOrganId: bloodline.boonOrganId,
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

/**
 * 一世收束：加血统点 ＋ 列传入目录（纯，返回新对象）。
 *
 * [S1] `ownedOrganIds` 是这一世**拥有过**的器官（`state.organIds`）—— 累进
 * `knownOrganIds`，「血脉」只卖已发现过的器官。为什么在这里记而不是在蜕变那一刻：
 * 一世里获得器官有三条路（蛰伏／事件赠予／血脉自带），收束这一处能一次收齐，
 * 漏一条的后果是玩家明明见过某件器官却永远买不到。
 *
 * 神种器官不进图鉴（它们不在 `content.organs` 里，由 `parseBloodline` 的对账挡掉）——
 * 神种走的是自己那条「解锁」线，混进血脉会变成「花 4 点买一个 5 点的神种」。
 */
export function recordLife(
  bloodline: Bloodline,
  gainedPoints: number,
  entry: ChronicleEntry,
  ownedOrganIds: readonly string[] = [],
  content?: TaleContent,
): Bloodline {
  const catalogue = content ? new Set(content.organs.map((organ) => organ.id)) : null;
  const knownOrganIds = [...bloodline.knownOrganIds];
  for (const id of ownedOrganIds) {
    if (catalogue !== null && !catalogue.has(id)) continue;
    if (!knownOrganIds.includes(id)) knownOrganIds.push(id);
  }
  return {
    ...bloodline,
    points: bloodline.points + Math.max(0, Math.floor(gainedPoints)),
    unlockedSeedIds: [...bloodline.unlockedSeedIds],
    chronicle: [...bloodline.chronicle, entry].slice(-CHRONICLE_CAPACITY),
    knownOrganIds,
  };
}

/**
 * [S1] 记下新发现的组合（纯）。已知的一律跳过 —— 图鉴是集合，不是流水。
 *
 * 返回同一个对象（引用相等）表示「没有新东西」，调用方据此决定要不要写存档与播演出。
 */
export function noteSynergies(bloodline: Bloodline, synergyIds: readonly string[]): Bloodline {
  const fresh = synergyIds.filter((id) => !bloodline.knownSynergyIds.includes(id));
  if (fresh.length === 0) return bloodline;
  return { ...bloodline, knownSynergyIds: [...bloodline.knownSynergyIds, ...fresh] };
}

/**
 * [S1] 买「血脉」：花血统点让下一世起手自带一件**已发现过的**器官（纯）。
 *
 * 返回 null 表示买不成，调用方据此不改状态、不扣点 —— 同 `unlockSeed` 的约定。
 * 价钱问引擎（`boonCost`：常规 4／事件专属 8），界面不写第二份价目表。买不成有四种：
 * 内容里没有这件器官（脏存档）／没见过它／点数不够／**这一世的血脉已经买过了**。
 *
 * ## 一世只带一件，且不许改主意
 * 早先这里允许「再买一件换掉前一件，前一件的钱不退」，而界面那边把整排锁住 ——
 * 同一条规则两套语义，**而花钱的那一份是松的**（code-reviewer 抓到的：今天玩家点不到
 * 第二次只是因为按钮恰好置灰，判据一旦有两份，早晚有一次点得到）。
 * 现在规则只有这一处：**买过就买不了了**，界面的置灰是它的镜像而不是它的补充。
 *
 * 之所以选「不许改」而不是「允许改并退款」：退款会让血脉变成一个可以反复试的下拉框，
 * 而它该是转世那一刻的一个决定（同「解锁神种」不退款）。
 */
export function buyBoon(
  bloodline: Bloodline,
  organId: string,
  content: TaleContent,
): Bloodline | null {
  if (!content.organs.some((organ) => organ.id === organId)) return null;
  if (!bloodline.knownOrganIds.includes(organId)) return null;
  if (bloodline.boonOrganId !== null) return null;
  const cost = boonCost(organId, content);
  if (bloodline.points < cost) return null;
  return { ...bloodline, points: bloodline.points - cost, boonOrganId: organId };
}

/** [S1] 血脉已被这一世用掉（`createLife` 之后调）—— 一次性消费，钱在买的时候就付了。 */
export function consumeBoon(bloodline: Bloodline): Bloodline {
  if (bloodline.boonOrganId === null) return bloodline;
  return { ...bloodline, boonOrganId: null };
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
    ...bloodline,
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
