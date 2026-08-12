import type { TaleTuning } from "./types.js";

/**
 * 计划「数值基线」表的落地初值。
 *
 * 归属说明：`tuning` 按计划归 tale-content 提供（`TALE_CONTENT.tuning`），这里给的是
 * **基线常量**，让 B2 直接 `{ ...BASELINE_TUNING, huntPreyIds: [...] }` 而不必从计划
 * 文档里手抄数字（抄一次就会漂移一次）。B4 平衡粗校时改 B2 的覆写值，或直接改这里。
 *
 * `huntPreyIds` 引用 EnemyDef.id，基线无法预知内容 id，故留空 —— **B2 必须填**。
 * 留空不会静默失效：第一次狩猎就会抛错（空猎物表＝狩猎永久失效＝每一世饿死，
 * 这种内容 bug 宁可当场吵）。
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

  // 行动
  huntHunterTag: "hunter",
  huntPreyIds: [],
  huntFoodGain: 26,
  restHungerGain: 10,
  restHealFlags: [],
  eventChanceBase: 0.35,
  exploreEventBonus: 2,

  /*
   * 追猎（M1-P1）。这组数被三条**手感**约束钉住，不是随手写的。**复算工具**：
   * `pnpm -C packages/gen balance -- --lab --lives 400`（追猎实验台：按打法×风向×build 拆表，
   * 末尾五条判据就是下面这三条的可执行版；括号里的数是它 400 场/格的实测值）：
   *
   * 1. 逆风稳扎稳打（绕风 → 潜行到贴身 → 扑）得手 **≥0.60**（实测 0.743，出手时均命中 0.73）。
   * 2. 顺风硬冲（不绕风、连潜到底）得手 **≤0.45**（实测 0.317，其中 0.52 是猎物直接跑掉）。
   * 3. 屏息一次值 **+0.096 命中率**（12 点警觉 × 0.008）；它是**补救**工具而非常规步骤 ——
   *    在顺风打坏的接近里值 +0.12 得手率（实测 0.317 → 0.439），在顺利的局面里几乎没收益。
   */
  stalkStartDistance: 34,
  stalkStartDistanceJitter: 4,
  stalkStartAlert: 15,
  stalkStartAlertJitter: 3,
  stalkStamina: 6,
  stalkLoseDistance: 46,
  stalkAlertMax: 100,

  stalkCreepDistance: 12,
  stalkCreepSwiftBonus: 5,
  stalkSwiftTag: "swift",
  stalkCreepAlert: 8,
  stalkNearDistance: 16,
  stalkNearAlertMul: 2,
  stalkQuietAlertMul: 0.6,
  stalkWindAlertMul: { into: 0.5, cross: 1, with: 2 },
  stalkCircleAlert: 3,
  stalkWaitAlertDrop: 12,
  stalkWaitMoveChance: 0.3,
  stalkWaitMoveAwayChance: 0.55,
  stalkWaitMoveMin: 4,
  stalkWaitMoveMax: 10,

  stalkPounceBase: 0.95,
  stalkPouncePerDistance: 0.035,
  stalkPouncePerAlert: 0.008,
  stalkPouncePerMeng: 0.004,

  stalkAlertTags: ["night-eye", "insight"],
  stalkWindTags: ["night-eye", "insight", "far-sight"],
  stalkVenomTag: "venom",
  stalkVenomHpMul: 0.7,

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
