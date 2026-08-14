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

import {
  boonCost,
  chartCost,
  loreCost,
  sigilById,
  type Bloodline,
  type ChronicleEntry,
  type EndingType,
  type TaleContent,
} from "@shiling/tale-sim";

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
    // [S2] 图鉴的另外两格：去过哪儿、得过什么秘藏。同样从零开始
    knownDestinationIds: [],
    foundTreasureIds: [],
    // [S3] 图鉴的第三格（见过哪些兽）与三个新消费项的账
    knownEnemyIds: [],
    loreEnemyIds: [],
    sigilIds: [],
    chartedDestinationId: null,
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

  // [S2] 去处与秘藏同样与内容对账：悬空 id 会让图鉴「已至之地 4/6」虚高，而那四格里有一格
  // 点开什么都没有。旧存档（S2 之前）没有这两个键 → 退回空，等于「这个玩家还没去过任何地方」
  const knownDestinationIds = idList(
    record.knownDestinationIds,
    new Set(content.destinations.map((item) => item.id)),
  );
  const foundTreasureIds = idList(
    record.foundTreasureIds,
    new Set(content.destinations.map((item) => item.treasure.id)),
  );

  /*
   * [S3] 三样新资产同样与内容对账，理由与上两批逐字相同。多一条**上限**的对账：
   * `sigilIds` 截到 `tuning.sigilCap` —— 一份手改过的存档不该让「至多三枚」变成一句空话
   * （引擎那边 `createLife` 也截，两处都截是有意的：引擎那一处守规则，这一处守屏幕上的账）。
   *
   * 旧存档（S3 之前）没有这四个键 → 全退回空／null，等于「这个玩家还没见过任何兽、
   * 一样新东西都没买」。那是**对的**降级：图鉴是记录，消费项是花过的钱，都不该凭空补上。
   */
  const knownEnemyIds = idList(record.knownEnemyIds, new Set(content.enemies.map((item) => item.id)));
  // 「已参透」必须是「已照面」的子集：反过来会让图鉴出现一行「？ · 已参透」
  const loreEnemyIds = idList(record.loreEnemyIds, new Set(knownEnemyIds));
  const sigilIds = idList(record.sigilIds, new Set(content.sigils.map((item) => item.id))).slice(
    0,
    Math.max(0, content.tuning.sigilCap),
  );
  const charted = record.chartedDestinationId;
  const chartedDestinationId =
    typeof charted === "string" && knownDestinationIds.includes(charted) ? charted : null;

  return {
    points,
    unlockedSeedIds,
    chronicle,
    knownSynergyIds,
    knownOrganIds,
    boonOrganId,
    knownDestinationIds,
    foundTreasureIds,
    knownEnemyIds,
    loreEnemyIds,
    sigilIds,
    chartedDestinationId,
  };
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
    knownDestinationIds: bloodline.knownDestinationIds,
    foundTreasureIds: bloodline.foundTreasureIds,
    knownEnemyIds: bloodline.knownEnemyIds,
    loreEnemyIds: bloodline.loreEnemyIds,
    sigilIds: bloodline.sigilIds,
    chartedDestinationId: bloodline.chartedDestinationId,
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
 * [S2 ＋ S3] 记下这一世的**见闻**：到过的去处、得到的秘藏、[S3] 照过面的异兽（纯，幂等）。
 *
 * 语义与 `noteSynergies` 同形：集合、只增、没有新东西就返回同一个引用（调用方据此决定
 * 要不要写存档）。三样一起收是因为它们来自同一个地方（`TaleState` 的三个数组）——
 * 分成三个函数会让客户端在**每一次行动之后**都要记得调三次，而漏调一次的后果是
 * 图鉴与实际玩过的不一致，且不会有任何测试变红。
 *
 * ⚠️ 调用时机是**每一步之后**（不是死亡结算时）：一世打到一半刷新页面，去过的地方不该白去，
 * 见过的兽也不该白见（尤其被它咬死的那一头 —— 那一世根本走不到结算）。
 */
export function noteExploration(
  bloodline: Bloodline,
  destinationIds: readonly string[],
  treasureIds: readonly string[],
  enemyIds: readonly string[] = [],
): Bloodline {
  const freshPlaces = destinationIds.filter((id) => !bloodline.knownDestinationIds.includes(id));
  const freshTreasures = treasureIds.filter((id) => !bloodline.foundTreasureIds.includes(id));
  const freshEnemies = enemyIds.filter((id) => !bloodline.knownEnemyIds.includes(id));
  if (freshPlaces.length === 0 && freshTreasures.length === 0 && freshEnemies.length === 0) {
    return bloodline;
  }
  return {
    ...bloodline,
    knownDestinationIds: [...bloodline.knownDestinationIds, ...freshPlaces],
    foundTreasureIds: [...bloodline.foundTreasureIds, ...freshTreasures],
    knownEnemyIds: [...bloodline.knownEnemyIds, ...freshEnemies],
  };
}

/**
 * [S3] 买「图鉴知识」：花血统点参透一头**已照过面**的异兽（纯）。**永久**，此后每一世都算数。
 *
 * 返回 null 表示买不成（同 `buyBoon`／`unlockSeed` 的约定：不改状态、不扣点）。四种买不成：
 * 内容里没有这头兽（脏存档）／没见过它／已经参透过／点数不够。
 *
 * ## 它为什么不是数值加成
 * 买到的是**信息**：这头兽在追猎屏读得出确切警觉与命中率、在搏杀屏读得出确切意图
 * （引擎那边由 `TaleState.loreEnemyIds` 兑现）。P1 已经量过这条信息值多少
 * （玄蟒身上死亡率 43.8% → 33.3%），所以它不需要再挂一个 +X 才显得值。
 */
export function buyLore(bloodline: Bloodline, enemyId: string, content: TaleContent): Bloodline | null {
  if (!content.enemies.some((enemy) => enemy.id === enemyId)) return null;
  if (!bloodline.knownEnemyIds.includes(enemyId)) return null;
  if (bloodline.loreEnemyIds.includes(enemyId)) return null;
  const cost = loreCost(enemyId, content);
  if (bloodline.points < cost) return null;
  return {
    ...bloodline,
    points: bloodline.points - cost,
    loreEnemyIds: [...bloodline.loreEnemyIds, enemyId],
  };
}

/**
 * [S3] 买「世家印记」：**永久**的小加成，至多 `tuning.sigilCap` 枚（纯）。
 *
 * 上限的判据只有这一处（界面的置灰与引擎 `createLife` 的截断都是它的镜像）——
 * S1 的血脉踩过这个坑：同一条规则两套语义，而花钱的那一份是松的。
 */
export function buySigil(bloodline: Bloodline, sigilId: string, content: TaleContent): Bloodline | null {
  const sigil = sigilById(content, sigilId);
  if (!sigil) return null;
  if (bloodline.sigilIds.includes(sigilId)) return null;
  if (bloodline.sigilIds.length >= content.tuning.sigilCap) return null;
  if (bloodline.points < sigil.cost) return null;
  return {
    ...bloodline,
    points: bloodline.points - sigil.cost,
    sigilIds: [...bloodline.sigilIds, sigilId],
  };
}

/**
 * [S3] 买「图录」：花血统点让下一世**不必其门也进得去**某一处已到过的秘境（纯）。
 *
 * 与「血脉」逐字同形的一次性消费（一世一处、买过就买不了、用掉即清、不退款）——
 * 那不是偷懒，是同一个位置的同一件事：转世那一刻的一个决定。五种买不成：
 * 内容里没有这一处／没到过／**这一处没有门槛**（兽径，`chartCost` 恒 0）／这一世已经买过／点数不够。
 *
 * ## 为什么是一世一次而不是永久
 * 门槛是 S2 全部欲望的来源（「为了下幽潭去凑浮鳔」）。永久免门槛等于把那条循环
 * 一次性买断 —— 六处地方从此一律敞着，那正是 S2 之前「探索是一颗按钮」的样子。
 */
export function buyChart(
  bloodline: Bloodline,
  destinationId: string,
  content: TaleContent,
): Bloodline | null {
  if (!content.destinations.some((destination) => destination.id === destinationId)) return null;
  if (!bloodline.knownDestinationIds.includes(destinationId)) return null;
  if (bloodline.chartedDestinationId !== null) return null;
  const cost = chartCost(destinationId, content);
  if (cost <= 0) return null;
  if (bloodline.points < cost) return null;
  return { ...bloodline, points: bloodline.points - cost, chartedDestinationId: destinationId };
}

/** [S3] 图录已被这一世用掉（`createLife` 之后调）—— 同 `consumeBoon`，钱在买的时候就付了。 */
export function consumeChart(bloodline: Bloodline): Bloodline {
  if (bloodline.chartedDestinationId === null) return bloodline;
  return { ...bloodline, chartedDestinationId: null };
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
