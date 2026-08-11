/**
 * 器官 tag 常量。
 *
 * tag 是内容侧唯一的「能力词汇表」：器官声明它，事件 `trigger.requiresOrganTags` 与抉择
 * `requires.organTags` 消费它，`tuning.huntHunterTag` 也指向其中一个。
 *
 * 纪律：**任何地方都不写 tag 字面量**。schema 测试断言器官声明的 tag 与事件引用的 tag
 * 都落在本表内 —— 手写字面量拼错一个字母，会得到一条永久无法满足的门槛（灰按钮）或一个
 * 永远不入池的事件，而这两种坏内容都不会让任何测试变红。
 */

// — 感知 —
/** 雾目：见隐微（雾中、暗处、字迹） */
export const TAG_FAR_SIGHT = "far-sight";
/** 夜瞳：夜视 */
export const TAG_NIGHT_EYE = "night-eye";
/** 灵犀：通物情、辨神异 */
export const TAG_INSIGHT = "insight";

// — 攻击 —
/** 狩齿：撕咬。同时是 `tuning.huntHunterTag`（狩猎成功率加成） */
export const TAG_HUNTER = "hunter";
/** 犬齿外翻，可撕咬绳索/皮革 */
export const TAG_FANG = "fang";
/** 坚喙：穿刺、破骨 */
export const TAG_PIERCE = "pierce";
/** 毒腺：喷毒、辨毒 */
export const TAG_VENOM = "venom";

// — 防护 —
/** 鳞甲／铁鬃：硬质外覆 */
export const TAG_ARMOR = "armor";
/** 铁鬃：耐寒耐钝击 */
export const TAG_TOUGH = "tough";

// — 移动 —
/** 疾足：疾行、攀跃 */
export const TAG_SWIFT = "swift";
/** 穴爪：掘土、入穴 */
export const TAG_DIG = "dig";
/** 浮鳔：入水不沉 */
export const TAG_SWIM = "swim";

// — 神异 —
/** 神种自带：食灵入世的凭据 */
export const TAG_SPIRIT_BORN = "spirit-born";
/** 白泽遗种：能听懂异类言语 */
export const TAG_ORACLE = "oracle";
/** 龙涎／应龙遗种：龙属血脉，可作龙吟 */
export const TAG_DRAGON_KIN = "dragon-kin";
/** 龙涎：神物之属 */
export const TAG_DIVINE = "divine";

/** 全部合法 tag（schema 测试用）。 */
export const ALL_TAGS: readonly string[] = [
  TAG_FAR_SIGHT,
  TAG_NIGHT_EYE,
  TAG_INSIGHT,
  TAG_HUNTER,
  TAG_FANG,
  TAG_PIERCE,
  TAG_VENOM,
  TAG_ARMOR,
  TAG_TOUGH,
  TAG_SWIFT,
  TAG_DIG,
  TAG_SWIM,
  TAG_SPIRIT_BORN,
  TAG_ORACLE,
  TAG_DRAGON_KIN,
  TAG_DIVINE,
];
