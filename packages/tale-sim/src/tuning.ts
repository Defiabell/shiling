import type { TaleTuning } from "./types.js";

/**
 * 计划「数值基线」表的落地初值。
 *
 * 归属说明：`tuning` 按计划归 tale-content 提供（`TALE_CONTENT.tuning`），这里给的是
 * **基线常量**，让 B2 直接 `{ ...BASELINE_TUNING, huntPreyIds: [...] }` 而不必从计划
 * 文档里手抄数字（抄一次就会漂移一次）。B4 平衡粗校时改 B2 的覆写值，或直接改这里。
 *
 * `huntPreyIds` 引用 EnemyDef.id，基线无法预知内容 id，故留空 —— **B2 必须填**，
 * 否则狩猎永远返回「山野寂寂」。
 */
export const BASELINE_TUNING: TaleTuning = {
  // 出生：meng 10／ling 10／ti 20／de 5，lifespanMax = 16 + floor(ti/10)
  initialStats: { meng: 10, ling: 10, ti: 20, de: 5 },
  lifespanBase: 16,
  lifespanTiDivisor: 10,

  // 饱食：初始 60／上限 100，每季 −12，冬季额外 −6
  hungerInit: 60,
  hungerMax: 100,
  hungerPerSeason: 12,
  winterHungerExtra: 6,

  // 蜕变：阈值 60，候选 3
  moltThreshold: 60,
  moltCandidateCount: 3,

  // 行动：狩猎成功率 0.45 + meng×0.004 + "hunter" 0.15
  huntBase: 0.45,
  huntPerMeng: 0.004,
  huntHunterTagBonus: 0.15,
  huntHunterTag: "hunter",
  huntPreyIds: [],
  huntFoodGain: 26,
  huntFailCombatChance: 0.2,
  restHungerGain: 10,
  restHealFlags: [],
  eventChanceBase: 0.35,
  exploreEventBonus: 2,

  // 战斗：伤害 3 + floor(meng/8) ±1
  combatDamageBase: 3,
  combatDamageMengDivisor: 8,
  combatDamageJitter: 1,
  combatWinHungerGain: 18,
  fleeBase: 0.5,
  fleePerLingDiff: 0.005,
  fleeBiasFactor: 0.01,
  feintPerLing: 0.008,
  feintFailDamageMul: 1.5,
  feintBonusDamageMul: 2,
  organSkillDamageMul: 2,
  minChance: 0.05,
  maxChance: 0.95,

  // 登神：year≥15 且 organIds≥5 且 ling≥60 且 de≥40
  ascendMinYear: 15,
  ascendMinOrgans: 5,
  ascendMinLing: 60,
  ascendMinDe: 40,

  chronicleMaxExcerpts: 8,
};
