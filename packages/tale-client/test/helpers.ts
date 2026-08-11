/** 测试用的状态构造工具 —— 一律从引擎的 `createLife` 出发，再定点改字段。 */

import { createLife, type TaleState } from "@shiling/tale-sim";
import { FIXTURE_CONTENT, FIXTURE_SEED_ID } from "@shiling/tale-sim/test/fixtures";

export { FIXTURE_CONTENT, FIXTURE_SEED_ID };

export function newState(seed = 1234): TaleState {
  return createLife(seed, FIXTURE_SEED_ID, FIXTURE_CONTENT);
}

export function withPatch(state: TaleState, patch: Partial<TaleState>): TaleState {
  return { ...state, ...patch };
}
