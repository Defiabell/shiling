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
  stalkAlertBonus: 0,
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
  combatWinEssenceMul: 1,
  fleeBase: 0.5,
  fleePerLingDiff: 0.005,
  fleeBiasFactor: 0.01,
  organSkillDamageMul: 2,
  minChance: 0.05,
  maxChance: 0.95,

  /*
   * 搏杀（M1-P2）。这一组数被三条**手感**约束钉住（复算：
   * `pnpm -C packages/gen balance -- --lab combat --lives 400`，末尾判据是它们的可执行版）：
   *
   * 1. 三个部位各有**自己赢**的局面 —— 没有一个部位在所有敌人上都最优。
   * 2. 「照屏幕金光打」不比手写的最优启发式差（同 P1：界面的推荐就该是当前最好的打法）。
   * 3. 读得出意图（洞察类器官）比读不出**明显**更强 —— 差在存活，不在伤害。
   *
   * 为什么咬腿／扑眼的伤害倍率压得这么低：它们换回来的是**跨回合的控制**（拦逃／致盲），
   * 若伤害也不差，咬喉就没有存在的理由。低伤是它们的价格。
   */
  combatBiteMul: { throat: 1.6, leg: 0.7, eye: 0.35 },
  combatGuardDamageMul: 0.5,
  combatGuardIntentMul: 0.5,
  combatGuardCounterChance: 0.5,
  combatCounterDamageMul: 1,
  combatStanceMul: {
    low: { out: 0.75, in: 0.7 },
    square: { out: 1, in: 1 },
    lunge: { out: 1.35, in: 1.25 },
  },
  // 扑 2.2 倍是刻意的：一次重击要**大到值得为它花一个回合换姿态**，否则姿态系统只是装饰
  combatIntentDamageMul: { pounce: 2.2, bite: 1, guard: 0, flee: 0 },
  combatIntentWeights: { pounce: 26, bite: 46, guard: 18, flee: 10 },
  combatFleeIntentHpRatio: 0.5,
  combatBlindRounds: 2,
  combatBlindMissChance: 0.55,
  combatBlindFleeBonus: 0.2,
  combatSlowRounds: 2,
  // 0.6 太强了：配上「扑被压低」，只会咬腿一手对岩羊就有 99.5% 胜率（实验台实测）
  combatSlowDamageMul: 0.75,
  combatSlowPounceMul: 0.5,
  combatWardRounds: 2,
  combatWardDamageMul: 0.5,
  combatSkillCooldown: 3,
  combatSkillHealAmount: 8,
  combatVenomSlowRounds: 3,

  /*
   * [S1] 四档新效果。三条持续类的**总量**刻意压在「一口咬喉上下」（咬喉一口 5〜7）：
   *   流血 3 合 × 2 ＝ 6；反刺 3 合 × 2 ＝ 6（且要它每合都命中才收满）。
   * 技不是「更强的咬」，是**在别的局面里更划算的咬** —— 若总量明显超过咬喉，
   * 技能池就会变成「谁转好了按谁」，三颗咬击又退化成装饰（同 M1-P2 咬腿那条教训）。
   *
   * 明识 3 合：够读完「宣告 → 应对 → 结算」两个完整回合，但读不完一整场架 ——
   * 它是**买一段知情权**，不是把洞察器官白送。
   */
  combatBleedRounds: 3,
  combatBleedDamage: 2,
  combatThornsRounds: 3,
  combatThornsDamage: 2,
  combatInsightRounds: 3,

  // [S1] 血脉：一世产 3〜8 点血统，4 点 ≈ 一世能买一件；事件专属器官（龙涎）翻倍
  bloodlineBoonCost: 4,
  bloodlineBoonRareCost: 8,

  combatIntentTags: ["insight", "night-eye"],

  /*
   * 四道门槛（2026-08-13）。基线值＝计划正本那张表，**实测校准归内容层**
   * （`tale-content/src/tuning.ts` 的覆写小节写了每一项为什么从基线挪开，及 500 世实测）。
   *
   * 三条道刻意共用同一批属性但要求不同的组合，这样「奔哪条道」才真的改变一世怎么过：
   * 登神要灵与德**同时**够（且尝过神兽），妖王要杀与猛，归山要寿与德，化灵要极高的灵
   * **加上**一世不杀 —— 最后这一条是唯一改变操作序列的（不能靠狩猎活着）。
   */
  wayShenLing: 60,
  wayShenDe: 40,
  wayYaowangLives: 20,
  wayYaowangMeng: 70,
  wayGuishanYear: 25,
  wayGuishanDe: 60,
  wayHualingLing: 90,
  wayDivineTag: "divine",
  // 成道的血统点按道分：越难、越改玩法的道给得越多（化灵最难，归山最稳）
  wayBloodline: { shen: 4, yaowang: 4, guishan: 3, hualing: 5 },

  chronicleMaxExcerpts: 8,
};
