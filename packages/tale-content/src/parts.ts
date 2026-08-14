/**
 * 部件表（凝招的原料）—— M2-B2 的灵魂。
 *
 * 需求正本：`docs/plans/shiling/2026-08-14-liezhuan-m2-combat-core-plan.md` 的「B2 凝招」节，
 * 以及 owner 拍板的那张招式框原型（三槽：起手／力道／附加）。
 *
 * ## 一件器官产出一件部件
 * 15 件器官（12 常规 ＋ 3 神种）各产出一件部件。**神种也产出**：不给的话常胎那一世要
 * 蜕满三件才凝得了第一手招，而一世平均只蜕 2.8 件 —— 那等于把这一批的功能推到大半世
 * 之后才出现。给部件不等于给技（S1 那条「神种不给技，否则解锁神种与买血脉成了同一件事
 * 的两个价钱」仍然成立）：部件要花精气才变得成招，它不是白拿的一颗按钮。
 *
 * ## 三个槽各读部件的一项 payload
 * | 槽 | 读什么 | 它决定 |
 * |---|---|---|
 * | 起手 `open` | `damageMul` ＋ `stat` | 这一手的基础动作、伤害系数、按猛还是按灵、**付哪一型精气** |
 * | 力道 `force` | `damageMul`（追加系数）＋ `woundPart` | 力道加成与「断伤」（顺带断它一处，整场累积） |
 * | 附加 `addon` | `effect` | 十档附带效果里的一档 |
 *
 * 一件部件**只在它擅长的槽里有 payload**（缺 ＝ 放不进那个槽）。这是「部件有类别」的
 * 机制形态：齿是打出去的东西（起手／力道），目是看的东西（只有附加），
 * 鳞是挡的东西（力道／附加）。于是「这一世蜕到了什么」直接决定「拼得出什么」。
 *
 * ## 三条落笔纪律（schema 测试逐条盯着）
 *
 * 1. **十档效果各由恰好一件部件承担**（毒→附毒、爪→流血、犀→顿挫、瞳→蒙目、涎→护体、
 *    鬃→反刺、鳞→硬受、速→脱身、目→明识、鳔→疗愈）。两件部件给同一档效果的话，
 *    它们在附加槽里的向量完全相同 —— 便宜的那件让贵的那件从此没人会拼，
 *    而那正是这一批必须为 0 的东西。齿／喙／蕴／血／胎五件因此**没有附加 payload**：
 *    它们的位置在起手与力道。
 * 2. **断伤只指向腿或眼**，不指向喉。喉不留整场伤（引擎的 `woundOf` 那条：
 *    咬喉是爆发档，若它还白拿一条持续线，三颗咬击就退化成挑伤害最高那颗）——
 *    一件把断伤指向喉的部件会让屏幕上写着「断喉一层」而引擎什么也不记。
 * 3. **精气型跟着器官的 affinity 走**（沿用 S1 器官技代价那条）：付的是「养出这件器官的
 *    那一型」，读起来才像同一件事的两面。龙涎的 affinity 是空的（它不进开奖池），
 *    所以它自己声明 `lin` —— 那是它三项 statMods 的落点。
 *
 * ## 数值的量纲
 * 起手系数 0.6〜1.4、力道追加 +0.2〜+0.6，**一律 0.2 一格**。断伤 4 分量、效果 6〜11 分量。
 * 三档代价（精气／势／冷却）**全部由引擎的 `forgePower` 一条公式算**，这张表里一个价钱
 * 都没有 —— 手写价目表只要有一处写歪就是一条严格占优的拼法（`forgeDominance` 那道闸门
 * 第一版就是这么被推翻的）。
 *
 * **为什么力道给的也是系数而不是定额加成**（第一版是定额，被闸门推翻）：
 * 定额与系数是两把不可通约的尺（定额每点恒 +1 伤，0.2 系数在低属性值 +0.8、高属性值 +2），
 * 一个整数价钱同时给两把尺定价时必然出现「同价而处处不差」的组合。改成同一把尺之后，
 * **一手招的伤害由总系数一个数唯一决定**，价钱也就跟着它单调走。
 * 0.2 一格同样是为了这个：0.1 一格时分量会出现半整数，取整又会把两档不同的分量压成同价。
 */

import type { PartDef } from "@shiling/tale-sim";
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
import {
  SEED_ORGAN_BAI_ZE_XUE,
  SEED_ORGAN_LING_YUN,
  SEED_ORGAN_LONG_LIN_TAI,
} from "./seeds.js";

// ===== id 常量（内容与测试都别写字面量） =====

export const PART_CHI = "part-chi";
export const PART_HUI = "part-hui";
export const PART_MU = "part-mu";
export const PART_TONG = "part-tong";
export const PART_LIN = "part-lin";
export const PART_ZONG = "part-zong";
export const PART_SU = "part-su";
export const PART_ZHAO = "part-zhao";
export const PART_DU = "part-du";
export const PART_BIAO = "part-biao";
export const PART_XI = "part-xi";
export const PART_XIAN = "part-xian";
export const PART_YUN = "part-yun";
export const PART_XUE = "part-xue";
export const PART_TAI = "part-tai";

export const PARTS: readonly PartDef[] = [
  // — 锐：打出去的东西（起手 ＋ 力道，没有附加） —
  {
    id: PART_CHI,
    name: "齿",
    kind: "锐",
    organId: ORGAN_GOU_CHI,
    essenceType: "meng",
    // 全库最高的起手系数（与灵犀并列）：狩齿本来就是「咬住的东西不会再走」那一件
    open: { damageMul: 1.4, text: "咬定不放 —— 伤 ×1.4" },
    force: { damageMul: 0.6, woundPart: null, text: "整副颌压上去 —— 力道 +0.6 倍" },
    desc: "外翻的颌骨与列锯般的齿。它只会往前，不会往回。",
  },
  {
    id: PART_HUI,
    name: "喙",
    kind: "锐",
    organId: ORGAN_JIAN_HUI,
    essenceType: "zu",
    open: { damageMul: 1.2, text: "自上而下一啄 —— 伤 ×1.2" },
    // 喙专破骨缝 —— 断伤指向腿（「它这辈子都追不上你」是引擎里现成的那条线）
    force: { damageMul: 0.4, woundPart: "leg", text: "凿进骨缝 —— 力道 +0.4 倍 · 断其腿" },
    desc: "角质硬化的喙，啄石有声。它找的是缝，不是肉。",
  },

  // — 明：看的东西 —
  {
    id: PART_MU,
    name: "目",
    kind: "明",
    organId: ORGAN_WU_MU,
    essenceType: "lin",
    // 只有附加：雾目是「看得见隐微」，它自己打不出伤，也承不了力
    addon: { effect: "insight", text: "雾里辨形 —— 数合读得出它的意图" },
    desc: "瞳中生雾，雾里反而看得见隐微之物。",
  },
  {
    id: PART_TONG,
    name: "瞳",
    kind: "明",
    organId: ORGAN_YE_TONG,
    essenceType: "xue",
    open: { damageMul: 0.6, text: "一道暗影泼过去 —— 伤 ×0.6" },
    force: { damageMul: 0.2, woundPart: "eye", text: "直取其目 —— 力道 +0.2 倍 · 瞎其眼" },
    addon: { effect: "blind", text: "夺其明 —— 数合之内它多半打空" },
    desc: "竖线般的瞳，昼则近盲，夜则如昼。它先要的是对方的眼。",
  },

  // — 韧：挡的东西 —
  {
    id: PART_LIN,
    name: "鳞",
    kind: "韧",
    organId: ORGAN_LIN_JIA,
    essenceType: "xue",
    force: { damageMul: 0.2, woundPart: null, text: "借鳞把身子压实 —— 力道 +0.2 倍" },
    addon: { effect: "brace", text: "合鳞硬受 —— 它这一下一分力也进不来" },
    desc: "层层相压的重鳞。它的用处是「站得住」，不是「打得动」。",
  },
  {
    id: PART_ZONG,
    name: "鬃",
    kind: "韧",
    organId: ORGAN_TIE_ZONG,
    essenceType: "meng",
    force: { damageMul: 0.4, woundPart: null, text: "鬃根承住回震 —— 力道 +0.4 倍" },
    addon: { effect: "thorns", text: "竖鬃向外 —— 数合之内谁撞上来谁疼" },
    desc: "颈背一片硬鬃。它替你受下回震，你才敢把力全压出去。",
  },
  {
    id: PART_TAI,
    name: "胎",
    kind: "韧",
    organId: SEED_ORGAN_LONG_LIN_TAI,
    essenceType: "xue",
    force: { damageMul: 0.6, woundPart: null, text: "鳞下那口烫血 —— 力道 +0.6 倍" },
    desc: "初生即覆的薄鳞。鳞下的血比同类烫，撞上去的力也回得更狠。",
  },

  // — 疾 —
  {
    id: PART_SU,
    name: "速",
    kind: "疾",
    organId: ORGAN_JI_ZU,
    essenceType: "zu",
    open: { damageMul: 0.8, text: "一蹬石棱抢先手 —— 伤 ×0.8" },
    force: { damageMul: 0.4, woundPart: "leg", text: "掠过它腿侧 —— 力道 +0.4 倍 · 断其腿" },
    addon: { effect: "bolt", text: "几个起落就隔开了它 —— 这一走必成" },
    desc: "四足生风，一跃数丈，落地无声。",
  },

  // — 爪与腺 —
  {
    id: PART_ZHAO,
    name: "爪",
    kind: "锐",
    organId: ORGAN_XUE_ZHAO,
    essenceType: "xue",
    open: { damageMul: 1, text: "由下向上撩开 —— 伤 ×1.0" },
    force: { damageMul: 0.6, woundPart: "eye", text: "宽爪扫过它脸 —— 力道 +0.6 倍 · 瞎其眼" },
    addon: { effect: "bleed", text: "撩开的长口 —— 它守着不动也照流" },
    desc: "宽厚如铲的前爪，掘土一夜可通一山。它开的口子不肯合。",
  },
  {
    id: PART_DU,
    name: "毒",
    kind: "毒",
    organId: ORGAN_DU_XIAN,
    essenceType: "meng",
    open: { damageMul: 0.8, text: "先吐一线腥液 —— 伤 ×0.8" },
    addon: { effect: "venom", text: "中者血凝 —— 数合不得起势" },
    desc: "颊内藏着的腺。自身先受其苦，而后能施于人。",
  },

  // — 气 —
  {
    id: PART_BIAO,
    name: "鳔",
    kind: "气",
    organId: ORGAN_FU_BIAO,
    essenceType: "lin",
    addon: { effect: "heal", text: "鼓鳔纳一口长气 —— 伤处稍合" },
    desc: "腹中一囊，可鼓可敛。它管的是自己的一口气。",
  },

  // — 灵 —
  {
    id: PART_XI,
    name: "犀",
    kind: "灵",
    organId: ORGAN_LING_XI,
    essenceType: "lin",
    // 全库唯一按灵算的起手（沿用 S1「灵犀一点」那条：灵系 build 也该有自己的输出手）
    open: { damageMul: 1.4, stat: "ling", text: "一点寒意直贯灵窍 —— 伤 ×1.4（按灵算）" },
    addon: { effect: "stun", text: "按住它起念的那一瞬 —— 它下一合只守得住" },
    desc: "额下一线灵窍。它走的不是皮肉那条路。",
  },
  {
    id: PART_XIAN,
    name: "涎",
    kind: "灵",
    organId: ORGAN_LONG_XIAN,
    // 龙涎的 affinity 是空的（不进开奖池），所以自己声明；lin 是它三项 statMods 的落点
    essenceType: "lin",
    open: { damageMul: 1, stat: "ling", text: "喉中一声闷响 —— 伤 ×1.0（按灵算）" },
    force: { damageMul: 0.4, woundPart: null, text: "余息压着这一下 —— 力道 +0.4 倍" },
    addon: { effect: "armor", text: "覆起一层怯它的东西 —— 数合内受伤减半" },
    desc: "舌下一泓凉涎，是龙属死时留在世上的一点余息。",
  },
  {
    id: PART_YUN,
    name: "蕴",
    kind: "灵",
    organId: SEED_ORGAN_LING_YUN,
    essenceType: "lin",
    open: { damageMul: 0.8, stat: "ling", text: "一缕神识推出去 —— 伤 ×0.8（按灵算）" },
    force: { damageMul: 0.2, woundPart: null, text: "神识托住那一手 —— 力道 +0.2 倍" },
    desc: "寄于血肉的一缕神识，是食灵入世的凭据 —— 此外别无长处，但它一直都在。",
  },
  {
    id: PART_XUE,
    name: "血",
    kind: "灵",
    organId: SEED_ORGAN_BAI_ZE_XUE,
    essenceType: "lin",
    open: { damageMul: 1.2, stat: "ling", text: "以知其情者伤其情 —— 伤 ×1.2（按灵算）" },
    force: { damageMul: 0.4, woundPart: null, text: "知它疼在哪 —— 力道 +0.4 倍" },
    desc: "血中掺了一点知万物之情的东西。知道它哪里疼，下手就准。",
  },
];
