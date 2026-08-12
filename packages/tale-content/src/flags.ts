/**
 * 内容侧 flag 常量。
 *
 * 引擎保留 `sys:` 前缀（`applyEffects` 会过滤掉内容想写的 `sys:` flag），所以本表一律
 * 不带前缀。两类用途：
 *
 * 1. **身体状态**：`wound`／`sick` —— 由事件挂上，`tuning.restHealFlags` 让「休憩」摘掉，
 *    并被若干事件的 `requiresFlags`／`forbidsFlags` 读取（旧伤发热只在带伤时入池）。
 * 2. **奇遇线索**：`baize-met`／`spring-known` 等 —— 记住这一世见过什么，供后续事件分支
 *    与列传摘录使用。M0 的链条刻意只做两级（A 挂 flag → B 读 flag），三级以上的长链留 M2。
 */

// — 身体状态（休憩可解） —
/** 旧伤未愈 */
export const FLAG_WOUND = "wound";
/** 腹疾／疫气 */
export const FLAG_SICK = "sick";

// — 奇遇线索 —
/** 曾遇白泽并答其问 */
export const FLAG_BAIZE_MET = "baize-met";
/** 知灵泉所在 */
export const FLAG_SPRING_KNOWN = "spring-known";
/** 知幽穴所在（冬季可入穴避雪） */
export const FLAG_CAVE_KNOWN = "cave-known";
/** 曾放生幼弱 */
export const FLAG_MERCY = "mercy";
/** 与野狐结盟 */
export const FLAG_FOX_ALLY = "fox-ally";
/** 曾以血涂骨坛 */
export const FLAG_BLOOD_RITE = "blood-rite";
/** 曾循萤火而行 */
export const FLAG_FIREFLY_LED = "firefly-led";
/** 为人所记恨（猎人循迹而来） */
export const FLAG_HUNTED = "hunted";
/** 穴中容留过异类小兽 */
export const FLAG_KIN_GUEST = "kin-guest";

// — 开局变量（2026-08-13）：由 `PremiseDef.flags` 在降世那一刻挂上，一世不摘 —
//
// 它们与「奇遇线索」的分工是：线索记「这一世发生过什么」，这三个记「这一世生在什么局面里」。
// 都是普通内容 flag（不带 `sys:`）—— 引擎只负责把它们挂上，读取全在事件 trigger 里，
// 于是「专属事件线」是纯内容决定的事。

/** 天时＝大旱之年（开泉眼干涸那条线） */
export const FLAG_SKY_DROUGHT = "sky-drought";
/** 出身＝孤生（开独行那条线） */
export const FLAG_BORN_SOLITARY = "born-solitary";
/** 出身＝双生（开同胞那条线） */
export const FLAG_BORN_TWIN = "born-twin";

/**
 * 全部合法内容 flag（schema 测试用）。
 *
 * 测试还会断言**每个 flag 都既被写过又被读过**：写＝某事件的 `addFlags` **或**某个开局
 * 变量的 `PremiseDef.flags`（2026-08-13 起多了这个来源），读＝某事件的
 * `requiresFlags`／`forbidsFlags`，或 `tuning.restHealFlags`。只写不读的 flag 是死数据，
 * 看起来像内容其实什么都不做，最容易在后续批次里被误当成「已经实现的机制」。
 */
export const ALL_FLAGS: readonly string[] = [
  FLAG_WOUND,
  FLAG_SICK,
  FLAG_BAIZE_MET,
  FLAG_SPRING_KNOWN,
  FLAG_CAVE_KNOWN,
  FLAG_MERCY,
  FLAG_FOX_ALLY,
  FLAG_BLOOD_RITE,
  FLAG_FIREFLY_LED,
  FLAG_HUNTED,
  FLAG_KIN_GUEST,
  FLAG_SKY_DROUGHT,
  FLAG_BORN_SOLITARY,
  FLAG_BORN_TWIN,
];
