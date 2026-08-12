/** 测试用的状态构造工具 —— 一律从引擎的 `createLife` 出发，再定点改字段。 */

import { createLife, type CombatState, type TaleState } from "@shiling/tale-sim";
import { SEED_CHANG_TAI, TALE_CONTENT } from "@shiling/tale-content";
import { FIXTURE_CONTENT, FIXTURE_SEED_ID } from "@shiling/tale-sim/test/fixtures";

export { FIXTURE_CONTENT, FIXTURE_SEED_ID };

export function newState(seed = 1234): TaleState {
  return createLife(seed, FIXTURE_SEED_ID, FIXTURE_CONTENT);
}

/**
 * [2026-08-13] 用**真内容**造一世。
 *
 * 必须与传给被测函数的那份 content 配对：`TaleState` 现在带着 `skyId`／`originId`
 * （这一世的天时与出身），拿 fixture 造的 state 去问真内容会直接抛
 * 「premiseOf: 未知天时 sky-fixture」—— 那是引擎该吵的（内容 id 悬空不许静默降级），
 * 所以测试这边配对好。
 */
export function realState(seed = 1234): TaleState {
  return createLife(seed, SEED_CHANG_TAI, TALE_CONTENT);
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
