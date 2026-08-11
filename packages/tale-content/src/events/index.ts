/**
 * 44 事件的聚合出口。
 *
 * 分池即分「什么时候会撞上」：
 * | 池 | 数量 | 触发 |
 * |---|---|---|
 * | 狩猎 | 12 | `actions: ["hunt"]` |
 * | 探索 | 20 | `actions: ["explore"]`，事件概率是别的行动的 2 倍 |
 * | 休憩 | 4 | `actions: ["rest"]` |
 * | 通用／季节 | 8 | 不限行动，按 `seasons` 分布（＋登神出口「天命」） |
 *
 * 数量与分布是计划 B2 节的硬性清单，schema 测试逐条断言 —— 改数量必须同时改测试与计划。
 */

import type { TaleEvent } from "@shiling/tale-sim";
import { EXPLORE_EVENTS } from "./explore.js";
import { GENERIC_EVENTS } from "./generic.js";
import { HUNT_EVENTS } from "./hunt.js";
import { REST_EVENTS } from "./rest.js";

export { EXPLORE_EVENTS, GENERIC_EVENTS, HUNT_EVENTS, REST_EVENTS };

export const EVENTS: readonly TaleEvent[] = [
  ...HUNT_EVENTS,
  ...EXPLORE_EVENTS,
  ...REST_EVENTS,
  ...GENERIC_EVENTS,
];
