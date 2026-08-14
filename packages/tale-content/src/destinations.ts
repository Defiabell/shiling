/**
 * 探索去处表（6 处）—— S2 的灵魂。
 *
 * 需求正本：`docs/plans/shiling/2026-08-13-liezhuan-build-depth-plan.md` 的
 * 「统一机制：器官组合表」与「S2 探索方向」两节。
 *
 * ## 这张表要解决的问题
 * S2 之前「探索」是单按钮、单事件池、单风险：玩家点它的时候**不做任何决定**
 * （owner 原话「摸不着头脑，不知道怎么发展」的第三条）。现在那一次点击选的是「往哪走」，
 * 而每一处都是一个真的地方 —— 独立事件池（`TaleEvent.trigger.destinations`）、
 * 独立猎物表（`denizens`）、独立风险档（`peril`）、独立秘藏（`treasure`）。
 *
 * ## 门槛公开、秘藏隐藏（与组合表刚好互补）
 * | | 隐藏的是 | 公开的是 | 为什么 |
 * |---|---|---|---|
 * | 组合（S1） | 配方 | 发现之后的一切 | 「意外」靠不知道要凑什么 |
 * | 去处（S2） | 秘藏 | 门槛、风险、此地有什么兽 | 「意外」靠不知道那儿有什么 |
 *
 * 去处的门槛**必须**公开：它是欲望展示位（同 M1 的置灰抉择、S1 的置灰技能）——
 * 玩家看得见「幽潭　尚缺 浮鳔」，才会为了它去攒鳞精气。把门槛也藏起来只会得到
 * 一排看不懂的灰按钮，那不是悬念，是缺信息。
 *
 * ## 六处的开启顺序（这一节是数值，不是文风）
 * 门槛照 `organs.ts` 的 affinity 复算过 —— 判据是「这一件（或这一对）实际蜕得到吗」：
 *
 * | 去处 | 门槛 | 每件的主亲和 | 难在哪 |
 * |---|---|---|---|
 * | 兽径 | 无 | —— | 始终可去，是别处的对照组 |
 * | 险峰 | 疾足 | zu 0.9 | 单件、主亲和最高的一档 —— 多半是第一处开的 |
 * | 古祠 | 灵犀 | lin 0.7 | 单件；灵系 build 的自留地 |
 * | 幽潭 | 鳞甲 ＋ 浮鳔 | xue 0.75 / lin 0.85 | **跨型**：两条精气线都要攒 |
 * | 秘窟 | 雾目 ＋ 夜瞳 | lin 0.8 / xue 0.8 | **跨型**，且与「夜猎之眼」同一副配方 |
 * | 焦原 | 铁鬃 | meng 0.6 | 单件；猛系 build 的自留地（这一条的定法见下方注释） |
 *
 * **一处无门槛 ＋ 三处单件 ＋ 两处双件**：四型精气各有一处一件就开得了的去处
 * （zu→险峰、lin→古祠、meng→焦原，xue 的鳞甲与夜瞳分别是两处双件的一半），
 * 于是第一世大概率能开出一处新地方；幽潭与秘窟是第二、三世「我这一世要去凑什么」的
 * 目标 —— 与 S1 组合表同一个节奏。
 *
 * ## 秘窟与「夜猎之眼」共用配方，是有意的
 * 雾目 ＋ 夜瞳 既开一手技，也开一处地。这正是计划里「探索目的地就是组合表的另一半
 * 解锁物」那句话的落点：凑齐那一对的玩家会在同一世里拿到两样东西，而两样的因果
 * 是同一句 —— 「看得见暗，也辨得出微」。
 */

import type { DestinationDef } from "@shiling/tale-sim";
import {
  ENEMY_BI_FANG,
  ENEMY_CAO_HU,
  ENEMY_CHI_RU,
  ENEMY_GU_DIAO,
  ENEMY_GUAN_GUAN,
  ENEMY_HUA_HUAI,
  ENEMY_JIU_WEI_HU,
  ENEMY_LI_LI,
  ENEMY_LU_SHU,
  ENEMY_LUO_YU,
  ENEMY_MING_SHE,
  ENEMY_QIONG_QI,
  ENEMY_SHAN_XIAO,
  ENEMY_SHU_HU,
  ENEMY_TU_LOU,
  ENEMY_XUAN_GUI,
  ENEMY_XUAN_MANG,
  ENEMY_YAN_YANG,
} from "./enemies.js";
import {
  ORGAN_FU_BIAO,
  ORGAN_JI_ZU,
  ORGAN_LIN_JIA,
  ORGAN_LING_XI,
  ORGAN_TIE_ZONG,
  ORGAN_WU_MU,
  ORGAN_YE_TONG,
} from "./organs.js";

// ===== id 常量（内容、界面与测试都别写字面量） =====

export const DEST_SHOU_JING = "dest-shou-jing";
export const DEST_XIAN_FENG = "dest-xian-feng";
export const DEST_GU_CI = "dest-gu-ci";
export const DEST_YOU_TAN = "dest-you-tan";
export const DEST_MI_KU = "dest-mi-ku";
export const DEST_JIAO_YUAN = "dest-jiao-yuan";

export const TREASURE_LU_HEN = "treasure-lu-hen";
export const TREASURE_YUN_GEN = "treasure-yun-gen";
export const TREASURE_ZHU_JIAN = "treasure-zhu-jian";
export const TREASURE_YUAN_ZHU = "treasure-yuan-zhu";
export const TREASURE_DI_XIN = "treasure-di-xin";
export const TREASURE_LEI_SUI = "treasure-lei-sui";

export const DESTINATIONS: readonly DestinationDef[] = [
  {
    id: DEST_SHOU_JING,
    name: "兽径",
    desc: "青丘诸兽踏了不知多少年的旧路。走得熟，也就走不出什么新东西。",
    requiresOrganIds: [],
    peril: "calm",
    /*
      * [M2-B3] 兽径从「只有草狐」变成四头，但**这一处的身份没有变**：全是打得赢的兽。
      * 加的三头各补一格 —— 灌灌是教具（比草狐轻得多）、狸力是「拦得住腿才打得完」的一课、
      * 旋龟是全库第一头**只靠咬打不动**的兽（护喉六成、血 44）。一条常路上撞见一只乌龟
      * 不该要命，但它会让一个只会咬喉的玩家第一次觉得「这么打好像不对」。
      */
    denizens: [
      { enemyId: ENEMY_CAO_HU, weight: 34 },
      { enemyId: ENEMY_LI_LI, weight: 30 },
      { enemyId: ENEMY_GUAN_GUAN, weight: 24 },
      { enemyId: ENEMY_XUAN_GUI, weight: 12 },
    ],
    treasure: {
      id: TREASURE_LU_HEN,
      name: "熟径",
      reveal: "同一条路走过一百遍之后，你开始看得见别人留下的那些印子里，哪一道是新的。",
      desc: "青丘的每一处岔口都在你脑子里了。此后走这条路，眼睛用在别处。",
    },
    scenery: ["兽径", "旧路", "蹄印", "草", "林", "土", "坡"],
  },

  {
    id: DEST_XIAN_FENG,
    name: "险峰",
    desc: "青丘北面的石脊，一路只上不下。风大，落脚的地方比爪子宽不了多少。",
    requiresOrganIds: [ORGAN_JI_ZU],
    peril: "wary",
    /*
      * 险峰的兽是有角的与有翼的：石脊上撞下来的东西，不是从暗处摸上来的东西。
      * [M2-B3] 岩羊与鹿蜀是「打得赢」那一档（它们也在猎物表里，在这儿反过来先扑你），
      * 蛊雕与孰湖是这一处真正的价钱 —— 高处的东西是从上面掉下来的。
      */
    denizens: [
      { enemyId: ENEMY_YAN_YANG, weight: 30 },
      { enemyId: ENEMY_LU_SHU, weight: 25 },
      { enemyId: ENEMY_GU_DIAO, weight: 27 },
      { enemyId: ENEMY_SHU_HU, weight: 18 },
    ],
    treasure: {
      id: TREASURE_YUN_GEN,
      name: "云根",
      reveal: "云不是从天上下来的 —— 它从石头缝里长出来，长了很久，长成了一块能拿在爪里的东西。",
      desc: "一块凝了千年云气的白石。含在舌下，一口气能上到从前上不去的地方。",
    },
    scenery: ["石脊", "崖", "风", "云", "峰", "高处", "落石", "青石"],
  },

  {
    id: DEST_GU_CI,
    name: "古祠",
    desc: "林子深处一片没人管的旧祀之地：断碑、骨坛、坟丘，都朝着同一个方向。",
    requiresOrganIds: [ORGAN_LING_XI],
    peril: "wary",
    /*
      * [M2-B3] 古祠是**九尾狐**的家。青丘的旧祀之地，供的本来就是它 ——
      * 全库护得最密的一头（喉与眼都护、三段、血 68），也是灵系 build 整条线的兑现处。
      */
    denizens: [
      { enemyId: ENEMY_SHAN_XIAO, weight: 40 },
      { enemyId: ENEMY_JIU_WEI_HU, weight: 24 },
      { enemyId: ENEMY_CAO_HU, weight: 22 },
      { enemyId: ENEMY_LI_LI, weight: 14 },
    ],
    treasure: {
      id: TREASURE_ZHU_JIAN,
      name: "祝简",
      reveal: "碑上的字你早就看得懂了。看得懂之后才发现，碑不是给人看的 —— 它是写给一个还没来的东西的。",
      desc: "一片刻满小字的竹。上头写着青丘从前的规矩，与现在只差一点点。",
    },
    scenery: ["碑", "坛", "坟", "祀", "香", "石阶", "字", "旧"],
  },

  {
    id: DEST_YOU_TAN,
    name: "幽潭",
    desc: "水面静得像一块铁。青丘的兽都只在岸上饮，没有一头下去过。",
    requiresOrganIds: [ORGAN_LIN_JIA, ORGAN_FU_BIAO],
    peril: "wary",
    /*
      * [M2-B3] 水下四头：玄蟒（墙）／鸣蛇（甲）／蠃鱼（啄）／赤鱬（教具）。
      * 蠃鱼在这儿是有讲究的 —— 它是全库「体」那一位最值钱的一头兽，
      * 而幽潭的门槛正好要鳞甲＋浮鳔（两件都在体那条线上）。走到这儿的 build 打得动它。
      */
    denizens: [
      { enemyId: ENEMY_XUAN_MANG, weight: 30 },
      { enemyId: ENEMY_MING_SHE, weight: 26 },
      { enemyId: ENEMY_LUO_YU, weight: 28 },
      { enemyId: ENEMY_CHI_RU, weight: 16 },
    ],
    treasure: {
      id: TREASURE_YUAN_ZHU,
      name: "渊心珠",
      reveal: "潭底没有泥，只有一层旧鳞。鳞下压着的那点光，是这潭水一直静着的原因。",
      desc: "一枚从潭心取出来的冷珠，握久了整只爪都发麻。青丘的水从此认得你。",
    },
    scenery: ["潭", "水", "浪", "鳞", "泡", "沉", "底", "冷"],
  },

  {
    id: DEST_MI_KU,
    name: "秘窟",
    desc: "山腹里连成一片的暗洞。进去之后没有一处是亮的，出来的路也不是进去那条。",
    requiresOrganIds: [ORGAN_WU_MU, ORGAN_YE_TONG],
    peril: "grim",
    // [M2-B3] 穴居的东西：猾褢冬蛰于此（「壁」型），其余三头是摸黑撞上的
    denizens: [
      { enemyId: ENEMY_HUA_HUAI, weight: 32 },
      { enemyId: ENEMY_XUAN_MANG, weight: 24 },
      { enemyId: ENEMY_MING_SHE, weight: 22 },
      { enemyId: ENEMY_SHAN_XIAO, weight: 14 },
      { enemyId: ENEMY_JIU_WEI_HU, weight: 8 },
    ],
    treasure: {
      id: TREASURE_DI_XIN,
      name: "地心髓",
      reveal: "越往下越暖。暖到某一处，石头是软的 —— 那不是石头，是这座山自己还没凉透的地方。",
      desc: "一捧从山腹最深处捧出来的温髓。含着它睡一觉，骨头会重新长一遍。",
    },
    scenery: ["洞", "暗", "石壁", "滴水", "钟乳", "地下", "黑", "苔"],
  },

  {
    id: DEST_JIAO_YUAN,
    name: "焦原",
    desc: "一场没人见过的火烧过之后留下的平地。灰有半尺厚，踩下去还是热的。",
    /*
     * 门槛只要铁鬃（不要穴爪）：因果上「硬鬃不惧火燎」就够走这片灰了，掘不掘得开焦土是
     * 事件里那颗选项的事（`qiu-yuan-unburnt` 的掘根一档挂着 dig）。
     *
     * 这一条是**平衡逼出来的**，不是文风：焦原是「垂死应龙」的家，而应龙是登神那条道
     * `divine` 门槛的主来源。第一版把它设成双件门槛，500 世 wayseek 实测登神成道率从
     * S1 的 2.8% 掉到 **0.2%** —— 一条道被一处地的门槛静默关掉了。改成单件之后回到 2%＋。
     */
    requiresOrganIds: [ORGAN_TIE_ZONG],
    peril: "grim",
    /*
     * 焦原是全库唯一摇得出**神兽**的去处（穷奇幼崽，meng 34）。这不是失手：
     * 「战胜神兽」是登神的一道门槛，而在此之前它只能靠一条 `once` 事件撞上 ——
     * 于是那条道的最后一步是纯运气。焦原把它变成一个**可以主动去的地方**，
     * 代价写在按钮上（此地有穷奇幼崽 · 绝境 · 三成遇袭）。
     */
    // [M2-B3] 火烧过的地方剩下的都是硬东西：毕方衔火、土蝼四角、猾褢从灰下爬出来
    denizens: [
      { enemyId: ENEMY_QIONG_QI, weight: 26 },
      { enemyId: ENEMY_TU_LOU, weight: 24 },
      { enemyId: ENEMY_BI_FANG, weight: 24 },
      { enemyId: ENEMY_SHAN_XIAO, weight: 16 },
      { enemyId: ENEMY_HUA_HUAI, weight: 10 },
    ],
    treasure: {
      id: TREASURE_LEI_SUI,
      name: "雷髓",
      reveal: "烧焦的东西里总有一样没烧尽 —— 因为那火本来就是从它身上出来的。",
      desc: "一段还在噼啪作响的焦木心，握着时整条脊背都发麻。它烧过一次，还想再烧一次。",
    },
    scenery: ["灰", "焦", "烧", "烟", "炭", "热", "裂", "白骨"],
  },
];
