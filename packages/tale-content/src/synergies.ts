/**
 * 器官组合表（异变）—— S1 的灵魂。
 *
 * 需求正本：`docs/plans/shiling/2026-08-13-liezhuan-build-depth-plan.md` 的
 * 「统一机制：器官组合表」与「S1 技能组合」两节。
 *
 * ## 两条铁律
 * 1. **对玩家隐藏**：图鉴只显示「已知 N/10」与「？」占位，未发现的**不列配方**
 *    （`seedVm.buildSynergyCodexVm`）。发现那一刻有专门的「异变」揭示演出，
 *    发现记录进 `Bloodline.knownSynergyIds`（跨世保留），于是第二世起玩家可以**主动去凑**。
 * 2. **必须自洽**：`reveal` 那一句要把因果说清 —— 玩家读完应该觉得「本来就该如此」，
 *    而不是「哦，又解锁了一个」。禁止随机拼配：「意料之外」靠隐藏，「情理之中」只能靠因果。
 *
 * ## 怎么保证「凑得到」（这一节是数值，不是文风）
 * 一世蜕 2〜4 件器官，而蛰伏开奖的候选池按 `affinity × 该型精气` 加权 —— 也就是说
 * 玩家实际拿到的几件器官**大概率同属一两个精气型**。所以每一型都至少有一条**同型配方**，
 * 否则首世发现率会掉到近乎零（配方跨两型时要两条精气线都攒满，那是第三、四世的事）：
 *
 * 「同型」的判据与 schema 测试一致：配方里**每一件**器官对该型的 affinity ≥ 0.2。
 * 下表是照 `organs.ts` 的 affinity 复算出来的（第一版是手写的，四行错两行 ——
 * 而这一节自己写着「这一节是数值，不是文风」）：
 *
 * | 精气型 | 同型可凑（每件的 affinity） |
 * |---|---|
 * | 猛 meng | 溃咬（狩齿 0.9 ＋ 毒腺 0.5） |
 * | 足 zu | 抵撞（坚喙 0.5 ＋ 铁鬃 0.25）、穿地（疾足 0.9 ＋ 穴爪 0.2） |
 * | 穴 xue | 埋毒爪（毒腺 0.4 ＋ 穴爪 0.85） |
 * | 鳞 lin | 窥心（雾目 0.8 ＋ 灵犀 0.7 ＋ 浮鳔 0.85） |
 *
 * 其余五条都是**跨型**，刻意更难，各有各的难法：夜猎之眼（鳞×穴）、重甲（穴×猛）、
 * 吐雾（鳞×猛）、碎骨（狩齿的 zu 只有 0.15，差一点点够不着同型）、
 * 龙语（要龙涎 —— 它压根不进开奖池，只能靠「垂死应龙」那条事件线）。
 * 它们是第三世之后「我这一世要去凑什么」的目标 —— 那正是 S1 要立起来的那个念头。
 *
 * ## 组合技凭什么比器官技强
 * 不是靠倍率，而是靠**两条效果同时落地**（溃咬＝爆发＋附毒，重甲＝硬受＋反刺）。
 * 冷却与代价也都比单件器官技高一档 —— 它是「攒了两件才有的一手」，不是「更强的那一手」。
 */

import type { SynergyDef } from "@shiling/tale-sim";
import {
  ORGAN_DU_XIAN,
  ORGAN_FU_BIAO,
  ORGAN_GOU_CHI,
  ORGAN_JI_ZU,
  ORGAN_JIAN_HUI,
  ORGAN_LIN_JIA,
  ORGAN_LING_XI,
  ORGAN_LONG_XIAN,
  ORGAN_TIE_ZONG,
  ORGAN_WU_MU,
  ORGAN_XUE_ZHAO,
  ORGAN_YE_TONG,
} from "./organs.js";

// ===== id 常量（测试与界面都别写字面量） =====

export const SYN_KUI_YAO = "syn-kui-yao";
export const SYN_YE_LIE_YAN = "syn-ye-lie-yan";
export const SYN_ZHONG_JIA = "syn-zhong-jia";
export const SYN_CHUAN_DI = "syn-chuan-di";
export const SYN_LONG_YU = "syn-long-yu";
export const SYN_MAI_DU_ZHAO = "syn-mai-du-zhao";
export const SYN_DI_ZHUANG = "syn-di-zhuang";
export const SYN_TU_WU = "syn-tu-wu";
export const SYN_KUI_XIN = "syn-kui-xin";
export const SYN_SUI_GU = "syn-sui-gu";

export const SYNERGIES: readonly SynergyDef[] = [
  {
    id: SYN_KUI_YAO,
    name: "溃咬",
    organIds: [ORGAN_GOU_CHI, ORGAN_DU_XIAN],
    kind: "skill",
    reveal: "齿咬开的口子，正好是毒进得去的地方。",
    desc: "咬定不放，颊内的腺同时挤空 —— 伤处从里面烂开。",
    skill: {
      name: "溃咬",
      desc: "咬住不松，把腺里的东西全挤进伤口 —— 重伤，且它数合不得起势。",
      cooldown: 4,
      effects: ["venom"],
      damageMul: 2.6,
      cost: { kind: "hp", amount: 3 },
    },
  },
  {
    id: SYN_YE_LIE_YAN,
    name: "夜猎之眼",
    organIds: [ORGAN_WU_MU, ORGAN_YE_TONG],
    kind: "skill",
    reveal: "雾里辨得出隐微，暗中又如白昼 —— 剩下的只是让它看不见你。",
    desc: "两只眼各管一半：一半读它的动静，一半把光从它眼前拿走。",
    skill: {
      name: "夜猎之眼",
      desc: "看清它要干什么，同时把暗影泼到它脸上 —— 数合之内你看得见它，它看不见你。",
      cooldown: 4,
      effects: ["insight", "blind"],
      damageMul: 0,
      cost: { kind: "essence", type: "lin", amount: 8 },
    },
  },
  {
    id: SYN_ZHONG_JIA,
    name: "重甲",
    organIds: [ORGAN_LIN_JIA, ORGAN_TIE_ZONG],
    kind: "skill",
    reveal: "重鳞在下、硬鬃在上，撞上来的那一下自己先疼。",
    desc: "鳞合成闸、鬃竖成刺 —— 一件挡住，一件还回去。",
    skill: {
      name: "重甲",
      desc: "鳞闸合拢挡住这一下，竖起的鬃则数合之内让它每次得手都自伤。",
      cooldown: 5,
      effects: ["brace", "thorns"],
      damageMul: 0,
      cost: { kind: "essence", type: "xue", amount: 10 },
    },
  },
  {
    id: SYN_CHUAN_DI,
    name: "穿地",
    organIds: [ORGAN_JI_ZU, ORGAN_XUE_ZHAO],
    kind: "skill",
    reveal: "爪能破土，足够快 —— 那就不必从正面来。",
    desc: "一爪掘进浮土，几步之后从它腹下窜出来。它护着的那一面，对你没有意义。",
    skill: {
      name: "穿地",
      desc: "钻进土里再从它下面上来：它这一下扑空，而你正咬在它腹上。",
      cooldown: 5,
      effects: ["brace"],
      damageMul: 1.8,
      cost: { kind: "essence", type: "zu", amount: 10 },
    },
  },
  {
    id: SYN_LONG_YU,
    name: "龙语",
    organIds: [ORGAN_LING_XI, ORGAN_LONG_XIAN],
    kind: "skill",
    reveal: "龙吟本使兽怯，而灵犀让它**听懂了**那一声在说什么。",
    desc: "喉中的余息借灵窍出去，成了话。青丘的兽伏在地上不敢抬头。",
    skill: {
      name: "龙语",
      desc: "一句非兽之语压下去：它下一合动不了，而你身上覆起一层怯它的东西。",
      cooldown: 5,
      effects: ["stun", "armor"],
      damageMul: 1,
      cost: { kind: "essence", type: "lin", amount: 12 },
    },
  },
  {
    id: SYN_MAI_DU_ZHAO,
    name: "埋毒爪",
    organIds: [ORGAN_DU_XIAN, ORGAN_XUE_ZHAO],
    kind: "skill",
    reveal: "爪缝里存得住腥液 —— 撩开的口子于是不肯合。",
    desc: "先把腺里的东西抹在爪上，再由下向上撩。血与毒一起走。",
    skill: {
      name: "埋毒爪",
      desc: "带毒的爪撩开一道长口：血止不住，它也数合不得起势。",
      cooldown: 4,
      effects: ["bleed", "venom"],
      damageMul: 1.4,
      cost: { kind: "hp", amount: 2 },
    },
  },
  {
    id: SYN_DI_ZHUANG,
    name: "抵撞",
    organIds: [ORGAN_JIAN_HUI, ORGAN_TIE_ZONG],
    kind: "skill",
    reveal: "颈背的鬃护住了头，你才敢把喙当锤用。",
    desc: "低头、蹬地、整个身子随喙撞出去。硬鬃替你受了回震。",
    skill: {
      name: "抵撞",
      desc: "全身的力压在喙尖上撞进骨缝 —— 重伤，且它下一合只守得住。",
      cooldown: 4,
      effects: ["stun"],
      damageMul: 1.8,
      cost: { kind: "hp", amount: 3 },
    },
  },
  {
    id: SYN_TU_WU,
    name: "吐雾",
    organIds: [ORGAN_FU_BIAO, ORGAN_DU_XIAN],
    kind: "skill",
    reveal: "鳔里的气足以把毒液喷成一片雾，而不只是一线。",
    desc: "鼓鳔，压腺，一口喷出去 —— 那片雾既迷眼，也入血。",
    skill: {
      name: "吐雾",
      desc: "一片腥雾罩住它的头：它看不见，血也凝了。",
      cooldown: 4,
      effects: ["blind", "venom"],
      damageMul: 0.7,
      cost: { kind: "essence", type: "xue", amount: 8 },
    },
  },
  {
    id: SYN_KUI_XIN,
    name: "窥心",
    organIds: [ORGAN_WU_MU, ORGAN_LING_XI, ORGAN_FU_BIAO],
    kind: "skill",
    reveal: "三窍互通之后，它起念的那一瞬你就知道了 —— 于是它下一手起不来。",
    desc: "雾目看形、灵犀通情、浮鳔纳气以承之。三者相为用，遂能先它一步。",
    skill: {
      name: "窥心",
      desc: "在它起念的那一瞬按住它：数合之内看得清它要干什么，而它下一合只守得住。",
      cooldown: 5,
      effects: ["insight", "stun"],
      stat: "ling",
      damageMul: 1.4,
      cost: { kind: "essence", type: "lin", amount: 14 },
    },
  },
  {
    id: SYN_SUI_GU,
    name: "碎骨",
    organIds: [ORGAN_GOU_CHI, ORGAN_JIAN_HUI, ORGAN_TIE_ZONG],
    kind: "skill",
    reveal: "齿咬定、喙贯骨、鬃承它的反扑 —— 三件缺一件都不敢这么打。",
    desc: "先咬住不让它退，再把喙钉进同一处，硬鬃替你挡住它临死的那一记。",
    skill: {
      name: "碎骨",
      desc: "咬定、贯骨、硬承其反扑 —— 全库最重的一下，它下一合也只守得住。",
      cooldown: 6,
      effects: ["stun"],
      damageMul: 3,
      cost: { kind: "hp", amount: 5 },
    },
  },
];
