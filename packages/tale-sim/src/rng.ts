/**
 * 自带的 mulberry32 种子 RNG。
 *
 * 纪律：本包**不 import 3D 版 packages/sim 的任何代码**（那边的 `createRng` 持有闭包
 * 可变状态，与本包「RNG 状态存在 TaleState.rngState、纯函数式推进」的模型不兼容）。
 * 禁 `Math.random`／`Date.now`：一切随机都由 `rngState: number` 决定。
 */

/** 一次抽取的结果：`value ∈ [0,1)` 与推进后的新状态。 */
export interface RngDraw {
  value: number;
  rngState: number;
}

/**
 * 纯函数式推进一步 mulberry32。
 *
 * @param rngState 当前状态（uint32 语义，内部会 `>>> 0`）
 * @returns 抽到的 `[0,1)` 值与新状态；同一入参恒得同一出参。
 */
export function nextRandom(rngState: number): RngDraw {
  const s = (rngState + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, rngState: s };
}

/**
 * 一次引擎调用内部使用的游标：把「读状态 → 抽 → 写回状态」的样板收敛掉。
 *
 * 游标自身是可变的（局部变量），但只在单次引擎调用的栈上存活；调用结束时把
 * `cursor.state` 写进新 TaleState.rngState。TaleState 本身仍然不被就地修改。
 */
export interface RngCursor {
  /** 当前（已推进到的）状态 */
  readonly state: number;
  /** [0,1) */
  next(): number;
  /** [0, maxExclusive) 的整数；maxExclusive ≤ 0 时返回 0 且**不**消耗抽取 */
  int(maxExclusive: number): number;
  /** [min, max) 的浮点 */
  range(min: number, max: number): number;
}

/** 从一个 rngState 开一个游标。 */
export function createCursor(rngState: number): RngCursor {
  let s = rngState >>> 0;
  const next = (): number => {
    const draw = nextRandom(s);
    s = draw.rngState;
    return draw.value;
  };
  return {
    get state(): number {
      return s;
    },
    next,
    int: (maxExclusive: number): number =>
      maxExclusive <= 0 ? 0 : Math.floor(next() * maxExclusive),
    range: (min: number, max: number): number => min + next() * (max - min),
  };
}

/**
 * 按权重抽一个元素的**下标**。总权重 ≤ 0 时退化为等权抽取（不静默返回 null，避免
 * 内容权重写错时整条链路无声失效）。
 *
 * 恒定消耗 1 次抽取（items 为空时消耗 0 次），保证确定性可推演。
 */
export function weightedPickIndex<T>(
  cursor: RngCursor,
  items: readonly T[],
  weightOf: (item: T) => number,
): number | null {
  if (items.length === 0) return null;
  const weights = items.map((item) => Math.max(0, weightOf(item)));
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return cursor.int(items.length);
  let roll = cursor.next() * total;
  for (let i = 0; i < items.length; i += 1) {
    roll -= weights[i] ?? 0;
    if (roll < 0) return i;
  }
  return items.length - 1;
}

/** `weightedPickIndex` 的取值版。 */
export function weightedPick<T>(
  cursor: RngCursor,
  items: readonly T[],
  weightOf: (item: T) => number,
): T | null {
  const idx = weightedPickIndex(cursor, items, weightOf);
  return idx === null ? null : items[idx] ?? null;
}

/**
 * 按权重不重复抽 k 个（顺序即抽出顺序）。k ≥ items.length 时返回全部（仍按抽出顺序，
 * 消耗与逐个抽取一致）。
 */
export function weightedSample<T>(
  cursor: RngCursor,
  items: readonly T[],
  weightOf: (item: T) => number,
  k: number,
): T[] {
  const pool = [...items];
  const picked: T[] = [];
  const want = Math.min(k, pool.length);
  for (let n = 0; n < want; n += 1) {
    // 按**下标**取并按下标删：若 items 里出现同一个对象两次（内容重复条目），
    // indexOf 会反复删掉第一个，让同一元素被抽出多次。
    const idx = weightedPickIndex(cursor, pool, weightOf);
    if (idx === null) break;
    const chosen = pool[idx];
    if (chosen === undefined) break;
    picked.push(chosen);
    pool.splice(idx, 1);
  }
  return picked;
}
