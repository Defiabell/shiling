/**
 * 70 事件的聚合出口。
 *
 * 分池即分「什么时候会撞上」：
 * | 池 | 数量 | 触发 |
 * |---|---|---|
 * | 狩猎 | 12 | `actions: ["hunt"]` |
 * | 探索 | 20 ＋ **19** | `actions: ["explore"]` ＋ `destinations: [...]`（S2 起必声明去处） |
 * | 休憩 | 4 | `actions: ["rest"]` |
 * | 通用／季节 | 10 | 不限行动，按 `seasons` 分布（＋三个成道出口：天命／兽王之礼／形解） |
 * | 开局变量专属 | 5 | 不限行动，按 `requiresFlags` 挂在天时／出身的 flag 上 |
 *
 * 「开局变量专属」池是 2026-08-13「每局不同」批次加的：它只在特定的天时／出身里存在，
 * 所以它同时是「第二局与第一局不一样」最直白的一半（详见 `premise.ts` 的头注）。
 *
 * [S2] 探索池拆成两个文件而不是一个：`explore.ts` 是 S2 之前写的 20 条（按地点**重新
 * 归属**，一条都没删），`places.ts` 是为了把六处补到「读起来像另一个地方」新写的 19 条。
 * 两者合起来才是探索池 —— `EXPLORE_EVENTS` 因此导出的是**并集**，下游（实验台、
 * AI 插图取材、schema 测试）不必知道这条历史缝。
 *
 * 数量与分布是硬性清单，schema 测试逐条断言 —— 改数量必须同时改测试与计划。
 */

import type { TaleEvent } from "@shiling/tale-sim";
import { EXPLORE_BASE_EVENTS } from "./explore.js";
import { GENERIC_EVENTS } from "./generic.js";
import { HUNT_EVENTS } from "./hunt.js";
import { PLACE_EVENTS } from "./places.js";
import { PREMISE_EVENTS } from "./premise.js";
import { REST_EVENTS } from "./rest.js";

/** 探索池的全部（S2 前的 20 条 ＋ 去处专属的 19 条）。 */
export const EXPLORE_EVENTS: readonly TaleEvent[] = [...EXPLORE_BASE_EVENTS, ...PLACE_EVENTS];

export {
  EXPLORE_BASE_EVENTS,
  GENERIC_EVENTS,
  HUNT_EVENTS,
  PLACE_EVENTS,
  PREMISE_EVENTS,
  REST_EVENTS,
};

export const EVENTS: readonly TaleEvent[] = [
  ...HUNT_EVENTS,
  ...EXPLORE_EVENTS,
  ...REST_EVENTS,
  ...GENERIC_EVENTS,
  ...PREMISE_EVENTS,
];
