/** 测试用的状态构造工具 —— 一律从引擎的 `createLife` 出发，再定点改字段。 */

import {
  createLife,
  type ClashState,
  type EncounterState,
  type TaleState,
} from "@shiling/tale-sim";
import { SEED_CHANG_TAI, TALE_CONTENT } from "@shiling/tale-content";
import { FIXTURE_CONTENT, FIXTURE_SEED_ID } from "@shiling/tale-sim/test/fixtures";

import { makeContent } from "@shiling/tale-sim/test/fixtures";

export { FIXTURE_CONTENT, FIXTURE_SEED_ID, makeContent };

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
 * 造一个交锋中状态。[M1-P2] 它从 5 个字段长到 11 个（[S1] 再加流血／反刺／明识 → 14），
 * 各测试手搓一遍就会各漂一遍 —— 缺省摆的是「它护后腿、这一合要常规咬一口」，
 * 与 tale-sim fixture 同一套缺省。
 */
export type ClashPatch = Partial<ClashState> & { enemyId?: string };

export function combatState(patch: ClashPatch = {}): ClashState {
  const { enemyId: _enemyId, ...rest } = patch;
  return {
    enemyHp: 6,
    playerHp: 32,
    round: 0,
    stance: "square",
    guardPart: "leg",
    intent: { kind: "bite", text: "它向前逼了半步。" },
    blind: 0,
    slow: 0,
    ward: 0,
    bleed: 0,
    thorns: 0,
    insight: 0,
    skillCooldowns: {},
    ...rest,
  };
}

/**
 * [M2-B1] 一步把「正在跟某头兽交锋」的 `TaleState` 造出来 —— 界面测试的唯一入口。
 *
 * `enemyId` 现在住在遭遇外壳上（一场遭遇只有一头兽），所以它从 `combatState` 的补丁里
 * 取出来放到外壳上；两处各写一遍就会出现「clash 说野雉、encounter 说穷奇」这种状态。
 */
export function fightingState(
  state: TaleState,
  patch: ClashPatch = {},
  shell: Partial<Omit<EncounterState, "clash" | "approach">> = {},
): TaleState {
  const clash = combatState(patch);
  return {
    ...state,
    encounter: encounterOf(clash, {
      ...(patch.enemyId === undefined ? {} : { enemyId: patch.enemyId }),
      ...shell,
    }),
  };
}

/**
 * [M2-B1] 把一个交锋状态包进遭遇外壳 —— 界面测试一律用它塞 `TaleState.encounter`。
 *
 * 外壳（势／部位伤／行为段／弱点／整场日志）现在是**两个阶段共用**的那一层，
 * 所以造状态的入口只有一个。
 */
export function encounterOf(
  clash: ClashState,
  patch: Partial<Omit<EncounterState, "clash" | "approach">> = {},
): EncounterState {
  return {
    enemyId: "ye-zhi",
    origin: "event",
    phase: "clash",
    momentum: 0,
    momentumMax: 4,
    wounds: { throat: 0, leg: 0, eye: 0 },
    weaknessFound: false,
    weaknessHits: 0,
    stage: 0,
    log: ["野雉当道，避之不得。"],
    approach: null,
    ...patch,
    clash,
  };
}
