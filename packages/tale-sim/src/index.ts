/**
 * `@shiling/tale-sim` 公开出口。
 *
 * B2（tale-content）`import type` 全部内容定义类型；B3（tale-client）import 引擎函数。
 * 两者都不应该深入 `src/*.js` 子路径 —— 只认这个 barrel。
 */
export * from "./types.js";
export * from "./engine.js";
export { BASELINE_TUNING } from "./tuning.js";
export { ENGINE_MESSAGES, render } from "./messages.js";
export {
  nextRandom,
  createCursor,
  weightedPick,
  weightedPickIndex,
  weightedSample,
  type RngDraw,
  type RngCursor,
} from "./rng.js";
