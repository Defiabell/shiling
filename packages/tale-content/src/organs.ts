/**
 * 12 器官（沿用 3D 版谱系改造）。
 *
 * ## 设计约束（schema 测试逐条盯着）
 * - `slot` 覆盖全部 6 槽，每槽两件：同槽两件走**不同精气型**，让四型各有自己的成长线。
 * - `affinity` 覆盖四型（含次要亲和）：**zu 6 件／lin 4 件／xue 6 件／meng 4 件** —— 一世
 *   平均只蜕 2.8 件，4 件的池子足够不空转（schema 测试的下限是每型 ≥3 件）。
 *   龙涎不计入任何一型，它的 affinity 是空的（见下）。
 * - **龙涎的 affinity 刻意留空**：`resolveMolt` 的候选池只收 `affinity[type] > 0` 的器官，
 *   空 affinity ＝ 永不进开奖池 ＝ 只能靠「垂死应龙」事件的 `addOrganId` 得到。这是唯一的
 *   事件专属器官，也是那条稀有线的全部回报。
 * - 带 `combatSkill` 的四件（狩齿／坚喙／毒腺／龙涎）分散在 tooth／gut／spirit，
 *   `combatSkillOrgan` 取 `organIds` 里最早的一件，所以先蜕出哪件决定战斗第四选项是什么。
 * - `statMods` 总量刻意压在 +6〜+12 之间：一世蜕 2〜4 件，属性增益要看得见但不能让
 *   登神门槛（ling 60／de 40）靠堆器官就够 —— 那两条得靠抉择挣。
 */

import type { OrganDef } from "@shiling/tale-sim";
import {
  TAG_ARMOR,
  TAG_DIG,
  TAG_DIVINE,
  TAG_DRAGON_KIN,
  TAG_FANG,
  TAG_FAR_SIGHT,
  TAG_HUNTER,
  TAG_INSIGHT,
  TAG_NIGHT_EYE,
  TAG_PIERCE,
  TAG_SWIFT,
  TAG_SWIM,
  TAG_TOUGH,
  TAG_VENOM,
} from "./tags.js";

// ===== id 常量（内容与测试都别写字面量） =====

export const ORGAN_GOU_CHI = "gou-chi";
export const ORGAN_JIAN_HUI = "jian-hui";
export const ORGAN_WU_MU = "wu-mu";
export const ORGAN_YE_TONG = "ye-tong";
export const ORGAN_LIN_JIA = "lin-jia";
export const ORGAN_TIE_ZONG = "tie-zong";
export const ORGAN_JI_ZU = "ji-zu";
export const ORGAN_XUE_ZHAO = "xue-zhao";
export const ORGAN_DU_XIAN = "du-xian";
export const ORGAN_FU_BIAO = "fu-biao";
export const ORGAN_LING_XI = "ling-xi";
export const ORGAN_LONG_XIAN = "long-xian";

export const ORGANS: readonly OrganDef[] = [
  // — tooth —
  {
    id: ORGAN_GOU_CHI,
    name: "狩齿",
    slot: "tooth",
    affinity: { meng: 0.9, zu: 0.15 },
    statMods: { meng: 7 },
    tags: [TAG_HUNTER, TAG_FANG],
    combatSkill: { name: "撕咬", desc: "咬定咽喉不放，伤害倍出。" },
    desc: "颌骨外翻，齿如列锯。咬住的东西不会再走。",
  },
  {
    id: ORGAN_JIAN_HUI,
    name: "坚喙",
    slot: "tooth",
    affinity: { zu: 0.5, xue: 0.35 },
    statMods: { meng: 4, ti: 2 },
    tags: [TAG_PIERCE, TAG_HUNTER],
    combatSkill: { name: "贯啄", desc: "自上而下一啄，专破骨缝。" },
    desc: "唇吻硬化成角质的喙，啄石有声。",
  },

  // — eye —
  {
    id: ORGAN_WU_MU,
    name: "雾目",
    slot: "eye",
    affinity: { lin: 0.8, zu: 0.1 },
    statMods: { ling: 6 },
    tags: [TAG_FAR_SIGHT],
    desc: "瞳中生雾，雾里反而看得见隐微之物。",
  },
  {
    id: ORGAN_YE_TONG,
    name: "夜瞳",
    slot: "eye",
    affinity: { xue: 0.75, meng: 0.1 },
    statMods: { ling: 3, meng: 2 },
    tags: [TAG_NIGHT_EYE],
    desc: "瞳如竖线，昼则近盲，夜则如昼。",
  },

  // — hide —
  {
    id: ORGAN_LIN_JIA,
    name: "鳞甲",
    slot: "hide",
    affinity: { xue: 0.7, lin: 0.3 },
    statMods: { ti: 7 },
    tags: [TAG_ARMOR],
    desc: "背生重鳞，层层相压，水火难侵。",
  },
  {
    id: ORGAN_TIE_ZONG,
    name: "铁鬃",
    slot: "hide",
    affinity: { meng: 0.6, zu: 0.25 },
    statMods: { ti: 5, meng: 2 },
    tags: [TAG_TOUGH, TAG_ARMOR],
    desc: "颈背长出一片硬鬃，钝击与霜寒都吃得住。",
  },

  // — limb —
  {
    id: ORGAN_JI_ZU,
    name: "疾足",
    slot: "limb",
    affinity: { zu: 0.9 },
    statMods: { meng: 2, ling: 2, ti: 2 },
    tags: [TAG_SWIFT],
    desc: "四足生风，一跃数丈，落地无声。",
  },
  {
    id: ORGAN_XUE_ZHAO,
    name: "穴爪",
    slot: "limb",
    affinity: { xue: 0.85, zu: 0.2 },
    statMods: { meng: 3, ti: 2 },
    tags: [TAG_DIG],
    desc: "前爪宽厚如铲，掘土一夜可通一山。",
  },

  // — gut —
  {
    id: ORGAN_DU_XIAN,
    name: "毒腺",
    slot: "gut",
    affinity: { meng: 0.5, xue: 0.4 },
    statMods: { meng: 5 },
    tags: [TAG_VENOM],
    combatSkill: { name: "喷毒", desc: "吐出一线腥液，中者血凝。" },
    desc: "颊内藏腺，自身先受其苦，而后能施于人。",
  },
  {
    id: ORGAN_FU_BIAO,
    name: "浮鳔",
    slot: "gut",
    affinity: { lin: 0.85 },
    statMods: { ti: 4, ling: 2 },
    tags: [TAG_SWIM],
    desc: "腹中一囊，可鼓可敛，入水不沉。",
  },

  // — spirit —
  {
    id: ORGAN_LING_XI,
    name: "灵犀",
    slot: "spirit",
    affinity: { lin: 0.7, xue: 0.15 },
    statMods: { ling: 8, de: 3 },
    tags: [TAG_INSIGHT],
    desc: "额下一线灵窍，能通异类之情，也听得见自己心里的动静。",
  },
  {
    id: ORGAN_LONG_XIAN,
    name: "龙涎",
    slot: "spirit",
    // affinity 留空 = 不入蛰伏开奖池，唯一来源是「垂死应龙」事件的 addOrganId
    affinity: {},
    statMods: { ling: 6, ti: 4, de: 2 },
    tags: [TAG_DIVINE, TAG_DRAGON_KIN],
    combatSkill: { name: "龙吟", desc: "喉中一声闷响，兽类先怯三分。" },
    desc: "舌下一泓凉涎，是龙属死时留在世上的一点余息。",
  },
];
