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
 * - **12 件全部带 `combatSkill`**（S1；此前只有狩齿／坚喙／毒腺／龙涎 四件）。
 *
 * ## 战斗技：一件器官 ＝ 一个新动作（S1）
 * S1 之前只有 4 件带技，而且引擎只用得上其中**一件**（`combatSkillOrgan` 是 `.find`）——
 * 于是「这一世蜕了什么」在搏杀屏上几乎看不出来，owner 的原话是「摸不着头脑、不知道要
 * 怎么发展」。现在每蜕一件器官就多一颗按钮，而且十二颗**各占一种工具**（不是十二档伤害）：
 *
 * | 器官 | 技 | 类型 | 效果 | 冷却 | 代价 | 它在搏杀里是什么 |
 * |---|---|---|---|---|---|---|
 * | 狩齿 | 撕咬 | 爆发 | 纯伤害 ×2 | 2 | 自伤 2 | 最短冷却、最直伤害 —— 收官那一下 |
 * | 坚喙 | 贯啄 | 控制 | `stun` | 3 | 自伤 2 | 把它下一合压成守势 ＝ **偷一个回合** |
 * | 雾目 | 垂雾 | 信息 | `insight` | 3 | 鳞精气 8 | 三合内读得出确切意图（没有灵犀也读得出） |
 * | 夜瞳 | 掩明 | 控制 | `blind` | 3 | 穴精气 6 | 它多半打空，也不再反咬 —— 对爱扑的兽最值 |
 * | 鳞甲 | 合鳞 | 防御·即时 | `brace` | 3 | 穴精气 6 | **这一合免伤**：预知重击时的硬闸 |
 * | 铁鬃 | 竖鬃 | 防御·惩罚 | `thorns` | 4 | 自伤 1 | 它每打你一次自伤 2 —— 越爱出手越吃亏 |
 * | 疾足 | 掠影 | 位移 | `bolt` | 4 | 足精气 10 | **必定脱身**（不掷骰）：救命键，代价是蜕变的本钱 |
 * | 穴爪 | 撩爪 | 持续·伤害 | `bleed` | 3 | 自伤 1 | 它守着不动也照掉血 —— 对爱守的兽的解法 |
 * | 毒腺 | 喷毒 | 持续·削弱 | `venom` | 3 | 自伤 2 | 迟滞三合：削它出伤、断它退路（比咬腿久） |
 * | 浮鳔 | 纳气 | 恢复 | `heal` | 4 | 鳞精气 6 | 一口气续回 8 血，不出伤 |
 * | 灵犀 | 灵犀一点 | 爆发·灵 | 伤害按**灵**算 | 3 | 鳞精气 8 | 灵系 build 唯一的输出手（猛低也打得动） |
 * | 龙涎 | 龙吟 | 防御·持续 | `armor` | 4 | 自伤 2 | 受伤减半几合，硬仗的续命手段 |
 *
 * ## 三条落笔纪律
 * 1. **代价与器官的性格同向**：猛系器官（齿、喙、爪、鬃、毒腺）与龙涎付**血**（打出去的
 *    东西自己也要挨；龙涎那一声「要拿自己的血去换」），其余（雾目、浮鳔、灵犀、鳞甲、
 *    夜瞳、疾足）付**精气** ——
 *    而精气是蜕变的本钱，于是「这一架打得漂亮」与「这一世多蜕一件」是一道真的取舍。
 *    引擎只认 `hp`／`essence` 两档（`体力` 是追猎屏的量，搏杀里没有对应物）。
 * 2. **代价的精气型跟着 `affinity` 走**：夜瞳吃穴（它自己就是穴系开出来的），雾目吃鳞。
 *    付的是「养出这件器官的那一型」，读起来才像同一件事的两面。
 * 3. **控制类的伤害倍率压到 1 以下**：`damageMul` 缺省是 2（`tuning.organSkillDamageMul`），
 *    掩明 0.6、竖鬃 0.5、撩爪 0.8 —— 若控制技的伤害也不差，那三颗咬击按钮就又废了
 *    （M1-P2 咬腿那条教训的同一形状）。
 * - `statMods` 总量刻意压在 +6〜+12 之间：一世蜕 2〜4 件，属性增益要看得见但不能让
 *   四道门槛（灵 60／德 40 之类）靠堆器官就够 —— 那些得靠抉择挣。
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
    combatSkill: {
      name: "撕咬",
      desc: "咬定咽喉不放，伤害倍出 —— 自己的颌也要崩掉一点。",
      cooldown: 2,
      cost: { kind: "hp", amount: 2 },
    },
    desc: "颌骨外翻，齿如列锯。咬住的东西不会再走。",
  },
  {
    id: ORGAN_JIAN_HUI,
    name: "坚喙",
    slot: "tooth",
    affinity: { zu: 0.5, xue: 0.35 },
    statMods: { meng: 4, ti: 2 },
    tags: [TAG_PIERCE, TAG_HUNTER],
    combatSkill: {
      name: "贯啄",
      desc: "自上而下一啄，专破骨缝 —— 它下一合只守得住。",
      cooldown: 3,
      effects: ["stun"],
      damageMul: 1.2,
      cost: { kind: "hp", amount: 2 },
    },
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
    combatSkill: {
      name: "垂雾",
      desc: "把雾放到眼前，它每一处细小的动静都有了意思 —— 数合之内看得出它要干什么。",
      cooldown: 3,
      effects: ["insight"],
      // 不出伤：它买的是知情权。`damageMul: 0` 是「不出伤」的唯一声明方式（见引擎注释）
      damageMul: 0,
      cost: { kind: "essence", type: "lin", amount: 8 },
    },
    desc: "瞳中生雾，雾里反而看得见隐微之物。",
  },
  {
    id: ORGAN_YE_TONG,
    name: "夜瞳",
    slot: "eye",
    affinity: { xue: 0.75, meng: 0.1 },
    statMods: { ling: 3, meng: 2 },
    tags: [TAG_NIGHT_EYE],
    combatSkill: {
      name: "掩明",
      desc: "瞳孔骤开，一道暗影泼到它脸上 —— 它有几合看不见你。",
      cooldown: 3,
      effects: ["blind"],
      damageMul: 0.6,
      cost: { kind: "essence", type: "xue", amount: 6 },
    },
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
    combatSkill: {
      name: "合鳞",
      desc: "重鳞层层合拢，把自己钉在原地 —— 它这一下一分力也进不来。",
      cooldown: 3,
      effects: ["brace"],
      damageMul: 0,
      cost: { kind: "essence", type: "xue", amount: 6 },
    },
    desc: "背生重鳞，层层相压，水火难侵。",
  },
  {
    id: ORGAN_TIE_ZONG,
    name: "铁鬃",
    slot: "hide",
    affinity: { meng: 0.6, zu: 0.25 },
    statMods: { ti: 5, meng: 2 },
    tags: [TAG_TOUGH, TAG_ARMOR],
    combatSkill: {
      name: "竖鬃",
      desc: "鬃根根竖起、尖端向外，数合之内谁撞上来谁疼。",
      cooldown: 4,
      effects: ["thorns"],
      damageMul: 0.5,
      cost: { kind: "hp", amount: 1 },
    },
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
    combatSkill: {
      name: "掠影",
      desc: "一蹬石棱，几个起落就隔开了它 —— 这一走必成，但这一架什么也不剩。",
      cooldown: 4,
      effects: ["bolt"],
      damageMul: 0,
      // 十点足之精气 ＝ 蜕变本钱的六分之一。「必定脱身」不能是白拿的
      cost: { kind: "essence", type: "zu", amount: 10 },
    },
    desc: "四足生风，一跃数丈，落地无声。",
  },
  {
    id: ORGAN_XUE_ZHAO,
    name: "穴爪",
    slot: "limb",
    affinity: { xue: 0.85, zu: 0.2 },
    statMods: { meng: 3, ti: 2 },
    tags: [TAG_DIG],
    combatSkill: {
      name: "撩爪",
      desc: "宽爪由下向上撩开一道长口，血止不住 —— 它守着不动也照流。",
      cooldown: 3,
      effects: ["bleed"],
      damageMul: 0.8,
      cost: { kind: "hp", amount: 1 },
    },
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
    combatSkill: {
      name: "喷毒",
      desc: "吐出一线腥液，中者血凝，数合不得起势 —— 「自身先受其苦」不是虚话。",
      cooldown: 3,
      effects: ["venom"],
      damageMul: 1,
      cost: { kind: "hp", amount: 2 },
    },
    desc: "颊内藏腺，自身先受其苦，而后能施于人。",
  },
  {
    id: ORGAN_FU_BIAO,
    name: "浮鳔",
    slot: "gut",
    affinity: { lin: 0.85 },
    statMods: { ti: 4, ling: 2 },
    tags: [TAG_SWIM],
    combatSkill: {
      name: "纳气",
      desc: "鼓鳔纳一口长气，压住翻涌的血 —— 伤处稍合。",
      cooldown: 4,
      effects: ["heal"],
      damageMul: 0,
      cost: { kind: "essence", type: "lin", amount: 6 },
    },
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
    combatSkill: {
      name: "灵犀一点",
      desc: "灵窍上一点寒意直贯过去，不经皮肉 —— 这一下算的是灵，不是猛。",
      cooldown: 3,
      // `stat: "ling"` 是这一批唯一的一处：灵系 build（化灵／登神）猛很低，若所有技都按猛
      // 算伤害，它们的技能池里就只有控制与防御 —— 而「灵系也该有自己的输出手」正是
      // 「两种 build 的技能池明显不同」的一半。倍率压到 1.4（缺省 2）以免高灵后期一击定胜负。
      stat: "ling",
      damageMul: 1.4,
      cost: { kind: "essence", type: "lin", amount: 8 },
    },
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
    combatSkill: {
      name: "龙吟",
      desc: "喉中一声闷响，兽类先怯三分，数合不敢近身 —— 这一声要拿自己的血去换。",
      cooldown: 4,
      effects: ["armor"],
      damageMul: 1,
      cost: { kind: "hp", amount: 2 },
    },
    desc: "舌下一泓凉涎，是龙属死时留在世上的一点余息。",
  },
];
