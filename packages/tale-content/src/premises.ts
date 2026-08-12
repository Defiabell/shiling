/**
 * 开局变量：5 天时 ＋ 4 出身（2026-08-13「每局不同」批次）。
 *
 * ## 为什么要有这一层
 * owner 验收「看得懂」批次后的原话：「每一局几乎都一样的剧情，没啥特色，没有想玩第二局的
 * 欲望」。根因是算术：44 个事件、一世实测触发 25 次 —— 一局看掉池子的 57%，第二局天然
 * 大面积重播；而世界本身在第二局**没有任何不同**（一个地域、事件无记忆、转世只换神种）。
 * 所以正解不是加内容（那只把重播推迟到第三局），而是让每一局从**第一个回合**起前提就不同。
 *
 * ## 纪律：每一条都必须真改机制
 * 每一条至少改一样玩家在过程中会撞上的东西 —— 调参（大旱年真的更容易饿死）、事件权重
 * （水泽之事翻倍）、属性／寿限（灵胎灵 +8 寿 −2），或挂一个开专属事件线的 flag。
 * `effect` 那一行是**给玩家看的机制账**（降世屏与择神种屏都会念它），`desc` 才是风味。
 * 只有 `desc` 的条目在屏幕上与「一行风味字」无从区分 —— 那正是这一批要消灭的东西。
 *
 * ## 组合数
 * 5 × 4 × 3 神种 ＝ **60 种开局**。两局撞上同一组前提的概率约 1.7%，而每一组都改动一批
 * 不同的数与一批不同的事件权重 —— 这是「第二局不一样」的结构性来源。
 */

import type { PremiseDef } from "@shiling/tale-sim";
import { EV_FOE, EV_KIN, EV_SOLITARY, EV_WATER, EV_WINTER, EV_WONDER } from "./eventTags.js";
import { FLAG_BORN_SOLITARY, FLAG_BORN_TWIN, FLAG_SKY_DROUGHT } from "./flags.js";

// ===== id 常量（内容、界面与测试都别写字面量） =====

export const SKY_DROUGHT = "sky-drought";
export const SKY_BEAST_TIDE = "sky-beast-tide";
export const SKY_SPIRIT_FLUX = "sky-spirit-flux";
export const SKY_EARLY_WINTER = "sky-early-winter";
export const SKY_PLAIN = "sky-plain";

export const ORIGIN_SOLITARY = "origin-solitary";
export const ORIGIN_SPIRIT_WOMB = "origin-spirit-womb";
export const ORIGIN_BREECH = "origin-breech";
export const ORIGIN_TWIN = "origin-twin";

/**
 * 天时（世道）。
 *
 * 权重：四种「有事的年头」各 23，平年 8 —— 平年是**对照组**（无修正），刻意做成少见的：
 * 一个玩家若头两局都撞上平年，这一批的全部工作对他就等于不存在。
 *
 * `tuningDelta` 是加法，括号里的数是基线值（`BASELINE_TUNING` 与本库覆写之后）。
 */
export const SKIES: readonly PremiseDef[] = [
  {
    id: SKY_DROUGHT,
    name: "大旱之年",
    /*
     * 每季 −12（冬 −18）→ −15（冬 −21）：一次得手从「够两季半」降到「够两季」。
     * 但**得手更肥**（+30 → +38）：旱年的兽都挤在剩下那几处水边，一次得手抵得上平年一次半。
     * 这一给一取是刻意的（同「兽潮」的杀获 +20%）—— 五种天时若三种是纯负面，
     * 「活过 8 岁 ≥60%」这条平衡目标就只能靠把别的数调软来救，那等于把开局变量调没。
     */
    effect: "每季多饿 3　得手多回 12 饱食　水泽之事 ×2　泉眼干涸入池",
    desc: "自去冬无雪，入春无雨。溪底的石头一块块露出来，露出来的地方长了白碱。",
    weight: 23,
    tuningDelta: { hungerPerSeason: 3, huntFoodGain: 12 },
    eventWeightMul: { [EV_WATER]: 2 },
    flags: [FLAG_SKY_DROUGHT],
  },
  {
    id: SKY_BEAST_TIDE,
    name: "兽潮",
    // 起手警觉 +8：一次潜行的余量少一步，「绕上风」从可选变成几乎必选
    effect: "猎物起手警觉 +8　强敌之事 ×2　杀获精气 +20%",
    desc: "北边的山里空了，兽都往南来。夜里此起彼伏的叫声不是求偶，是彼此报位置。",
    weight: 23,
    tuningDelta: { stalkAlertBonus: 8, combatWinEssenceMul: 0.2 },
    eventWeightMul: { [EV_FOE]: 2 },
  },
  {
    id: SKY_SPIRIT_FLUX,
    name: "灵气盛",
    // 蜕变阈值 90 → 75：一世多蜕出一件左右，也让「攒精气」这条线在本局明显更快
    effect: "蜕变阈值 −15　奇遇之事增半",
    desc: "草叶上的露水到中午还不干，夜里石缝里透出青光。青丘每隔些年就有这么一年。",
    weight: 23,
    tuningDelta: { moltThreshold: -15 },
    eventWeightMul: { [EV_WONDER]: 1.5 },
  },
  {
    id: SKY_EARLY_WINTER,
    name: "寒冬早至",
    /*
     * 冬季额外消耗 6 → 12：冬天那一季从 −18 变 −24，一次得手撑不过一冬。
     * 补偿在**肉**上（得手 30 → 38）：冬来得早，兽也早早把脂肪贴上了身。
     * 为什么补在得手而不是休憩：休憩的补偿只有「肯歇的打法」拿得到，而实测最吃亏的
     * 恰是那种「饿了才猎、猎完就走」的谨慎打法（它一世只在受伤时歇）。
     */
    effect: "冬季多饿 6　得手多回 8 饱食　冬事 ×2",
    desc: "才八月，风里已经有铁的味道。老兽开始往深穴里挪，谁也不说话。",
    weight: 23,
    tuningDelta: { winterHungerExtra: 6, huntFoodGain: 8 },
    eventWeightMul: { [EV_WINTER]: 2 },
  },
  {
    id: SKY_PLAIN,
    name: "平年",
    /*
     * 唯一没有任何机制的一条 —— 它是**对照组**，不是漏写的风味字。
     * 存在的理由：没有「什么都不改」的那一档，玩家就无从感知别的天时到底改了什么。
     * 权重压到 8，让它偶尔出现即可。
     */
    effect: "无修正 —— 青丘少有的太平年",
    desc: "雨水按时来，兽各安其位。这样的年头在青丘的记事里通常一笔不写。",
    weight: 8,
  },
];

/**
 * 出身（异相）。
 *
 * 与天时的分工：天时改**世界**（更饿、更险、更容易蜕形），出身改**这一只兽**
 * （属性、寿限，以及它身边有没有别人）。两者各自独立掷，所以「大旱年的孤生」与
 * 「灵气盛年的双生」是两种完全不同的开局。
 *
 * 三条带德行代价的出身刻意都是**负德**：德只能从抉择里一点点挣（一世实测达成 40 的只有
 * 一成），所以「出身欠了德」直接把登神与归山两条道的难度顶上去 —— 那是开局变量真的
 * 改变了「这一世该奔哪条道」的地方。
 */
export const ORIGINS: readonly PremiseDef[] = [
  {
    id: ORIGIN_SOLITARY,
    name: "孤生",
    effect: "德 −5　独行之事入池　同类之事减半",
    desc: "一窝只活下来一个。你没有听过同类的声音，所以也不知道那是该亲近的还是该躲的。",
    weight: 30,
    statMods: { de: -5 },
    // 同类之事减半：孤生这一世的世界里「别的兽」本来就少，那半份权重让给独行线
    eventWeightMul: { [EV_SOLITARY]: 3, [EV_KIN]: 0.5 },
    flags: [FLAG_BORN_SOLITARY],
  },
  {
    id: ORIGIN_SPIRIT_WOMB,
    name: "灵胎",
    effect: "灵 +8　寿限 −2",
    desc: "生下来眼睛就是开的，且看的不是母亲。神识来得太早，肉身跟不上。",
    weight: 25,
    statMods: { ling: 8 },
    // 寿限 −2 是刻意的代价：灵 +8 直接推近化灵与登神，得让它把归山那条道推远
    lifespanDelta: -2,
  },
  {
    id: ORIGIN_BREECH,
    name: "逆产带异相",
    effect: "德 −8　奇遇之事增六成",
    desc: "倒着出来的，落地时身上带一道旧痕。同穴的兽自此都绕着你走。",
    weight: 25,
    statMods: { de: -8 },
    eventWeightMul: { [EV_WONDER]: 1.6 },
  },
  {
    id: ORIGIN_TWIN,
    name: "双生",
    effect: "休憩多回 4 饱食　同胞之事增倍半　同胞专属事件入池",
    desc: "有一个和你一模一样的东西，比你早半刻出来。你们分同一个穴，也分同一份口粮。",
    weight: 20,
    // 休憩 14 → 18：有同胞替你守着穴口，歇得踏实 —— 这让「不狩猎的那一季」真的存在
    tuningDelta: { restHungerGain: 4 },
    eventWeightMul: { [EV_KIN]: 2.5 },
    flags: [FLAG_BORN_TWIN],
  },
];
