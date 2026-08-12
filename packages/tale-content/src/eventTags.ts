/**
 * 事件**分类** tag（`EventTrigger.tags`）—— 2026-08-13「每局不同」批次。
 *
 * 与器官 tag（`tags.ts`）是两套完全不同的词汇表，别混：
 * - 器官 tag 决定**能不能**（事件是否入池、抉择是否点得开）；
 * - 事件分类 tag 只决定**多不多**（天时／出身的 `eventWeightMul` 在抽取阶段乘一下）。
 *
 * 纪律同器官 tag：**任何地方都不写字面量**。写错一个字母得到的是一个永远乘不上的权重
 * —— 天时看着有效（降世屏照样写着「水泽之事翻倍」），实际一局都没翻，而没有任何测试会红。
 * schema 测试断言事件声明的分类 tag 与开局变量引用的分类 tag 都落在本表内，且本表无死条目。
 */

/** 水源与饮事：泉、瀑、潭、浅滩、汛、旱。大旱之年翻倍 */
export const EV_WATER = "water";
/** 强敌当前：会打起来的、或摆明打不过的那些 */
export const EV_FOE = "foe";
/** 奇遇与神异：碑、坛、白泽、应龙、雷木、蝉蜕这一类 */
export const EV_WONDER = "wonder";
/** 冬事：封山、夜雪、越冬 */
export const EV_WINTER = "winter";
/** 同类与同胞：巢、窝、结伴、血亲 */
export const EV_KIN = "kin";
/** 独行：一个人扛的那些事（孤生的专属线） */
export const EV_SOLITARY = "solitary";

/** 全部合法事件分类 tag（schema 测试用）。 */
export const ALL_EVENT_TAGS: readonly string[] = [
  EV_WATER,
  EV_FOE,
  EV_WONDER,
  EV_WINTER,
  EV_KIN,
  EV_SOLITARY,
];
