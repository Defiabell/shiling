/** 测试用的状态构造工具 —— 一律从引擎的 `createLife` 出发，再定点改字段。 */

import { createLife, type CombatState, type TaleState } from "@shiling/tale-sim";
import { FIXTURE_CONTENT, FIXTURE_SEED_ID } from "@shiling/tale-sim/test/fixtures";

export { FIXTURE_CONTENT, FIXTURE_SEED_ID };

export function newState(seed = 1234): TaleState {
  return createLife(seed, FIXTURE_SEED_ID, FIXTURE_CONTENT);
}

export function withPatch(state: TaleState, patch: Partial<TaleState>): TaleState {
  return { ...state, ...patch };
}

/**
 * 造一个战斗中状态。[M1-P2] `CombatState` 从 5 个字段长到 11 个，各测试手搓一遍就会
 * 各漂一遍 —— 缺省摆的是「它护后腿、这一合要常规咬一口」，与 tale-sim fixture 同一套缺省。
 */
export function combatState(patch: Partial<CombatState> = {}): CombatState {
  return {
    enemyId: "ye-zhi",
    enemyHp: 6,
    playerHp: 20,
    round: 0,
    stance: "square",
    guardPart: "leg",
    intent: { kind: "bite", text: "它向前逼了半步。" },
    blind: 0,
    slow: 0,
    ward: 0,
    skillCooldowns: {},
    log: ["野雉当道，避之不得。"],
    ...patch,
  };
}
