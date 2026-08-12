/**
 * 51 事件的聚合出口。
 *
 * 分池即分「什么时候会撞上」：
 * | 池 | 数量 | 触发 |
 * |---|---|---|
 * | 狩猎 | 12 | `actions: ["hunt"]` |
 * | 探索 | 20 | `actions: ["explore"]`，事件概率是别的行动的 2 倍 |
 * | 休憩 | 4 | `actions: ["rest"]` |
 * | 通用／季节 | 10 | 不限行动，按 `seasons` 分布（＋三个成道出口：天命／兽王之礼／形解） |
 * | 开局变量专属 | 5 | 不限行动，按 `requiresFlags` 挂在天时／出身的 flag 上 |
 *
 * 「开局变量专属」池是 2026-08-13「每局不同」批次加的：它只在特定的天时／出身里存在，
 * 所以它同时是「第二局与第一局不一样」最直白的一半（详见 `premise.ts` 的头注）。
 *
 * 数量与分布是硬性清单，schema 测试逐条断言 —— 改数量必须同时改测试与计划。
 */

import type { TaleEvent } from "@shiling/tale-sim";
import { EXPLORE_EVENTS } from "./explore.js";
import { GENERIC_EVENTS } from "./generic.js";
import { HUNT_EVENTS } from "./hunt.js";
import { PREMISE_EVENTS } from "./premise.js";
import { REST_EVENTS } from "./rest.js";

export { EXPLORE_EVENTS, GENERIC_EVENTS, HUNT_EVENTS, PREMISE_EVENTS, REST_EVENTS };

export const EVENTS: readonly TaleEvent[] = [
  ...HUNT_EVENTS,
  ...EXPLORE_EVENTS,
  ...REST_EVENTS,
  ...GENERIC_EVENTS,
  ...PREMISE_EVENTS,
];
