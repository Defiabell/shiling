/**
 * `@shiling/tale-content` 公开出口 —— 《食灵·列传》M0 青丘一世的全部内容。
 *
 * ## 唯一必需的导出
 * `TALE_CONTENT` 是引擎的依赖注入体（`TaleContent`）：tale-client 只需
 * `import { TALE_CONTENT } from "@shiling/tale-content"` 再把它传给每个引擎函数。
 *
 * 其余导出（各分池、id 常量、tag／flag 常量、视觉 token 表）是给测试、B4 美术管线与
 * B3 界面文案用的 —— **界面若要显示器官名／敌人名，用这里的定义，不要自己写字符串**。
 *
 * ## 本库不做什么
 * - 不含任何逻辑：纯数据 ＋ 常量。随机、结算、判定全在 tale-sim。
 * - 不含引擎旁白（狩猎成败／战斗／死亡那些短句）：那些在 tale-sim 的 `ENGINE_MESSAGES`。
 * - 不含插图文件名：`TaleEvent.illustration` 留空，B4 产出图后回填。
 *
 * ## 内容清单
 * 44 事件（狩猎 12／探索 20／休憩 4／通用季节 8，其中 `once` 稀有 8）＝133 抉择／176 结果分支、
 * 12 器官（覆盖 6 槽与 4 型精气，**12 件全部带战斗技** —— S1）、**10 条器官组合**（异变，
 * 对玩家隐藏、跨世记入图鉴 —— S1）、3 神种、8 敌人、列传模板（8 段赞语变体）、
 * tuning（基线覆写若干项）、27 个视觉 token。
 */

import type { TaleContent } from "@shiling/tale-sim";
import { CHRONICLE_TEMPLATES } from "./chronicle.js";
import { ENEMIES } from "./enemies.js";
import { EVENTS } from "./events/index.js";
import { ORIGINS, SKIES } from "./premises.js";
import { ORGANS } from "./organs.js";
import { SEEDS } from "./seeds.js";
import { SYNERGIES } from "./synergies.js";
import { TUNING } from "./tuning.js";

/**
 * 引擎的内容依赖体。
 *
 * `TaleContent` 的字段都是可变数组类型，而本库内部一律用 `readonly` 数组（防止别处就地
 * 改内容 —— 那会击穿「同种子同操作＝同终态」的确定性承诺）。这里各 spread 一次交出可变
 * 副本：引擎只读，不写。
 */
export const TALE_CONTENT: TaleContent = {
  events: [...EVENTS],
  organs: [...ORGANS],
  seeds: [...SEEDS],
  enemies: [...ENEMIES],
  skies: [...SKIES],
  origins: [...ORIGINS],
  synergies: [...SYNERGIES],
  tuning: TUNING,
  chronicleTemplates: CHRONICLE_TEMPLATES,
};

export { CHRONICLE_TEMPLATES } from "./chronicle.js";
export { ENEMIES, PREY_IDS } from "./enemies.js";
export {
  ENEMY_CAO_HU,
  ENEMY_QIONG_QI,
  ENEMY_SHAN_XIAO,
  ENEMY_WEN_YAO,
  ENEMY_XUAN_MANG,
  ENEMY_XUE_SHU,
  ENEMY_YAN_YANG,
  ENEMY_YE_ZHI,
} from "./enemies.js";
export {
  EVENTS,
  EXPLORE_EVENTS,
  GENERIC_EVENTS,
  HUNT_EVENTS,
  PREMISE_EVENTS,
  REST_EVENTS,
} from "./events/index.js";
export {
  ALL_EVENT_TAGS,
  EV_FOE,
  EV_KIN,
  EV_SOLITARY,
  EV_WATER,
  EV_WINTER,
  EV_WONDER,
} from "./eventTags.js";
export {
  ORIGINS,
  ORIGIN_BREECH,
  ORIGIN_SOLITARY,
  ORIGIN_SPIRIT_WOMB,
  ORIGIN_TWIN,
  SKIES,
  SKY_BEAST_TIDE,
  SKY_DROUGHT,
  SKY_EARLY_WINTER,
  SKY_PLAIN,
  SKY_SPIRIT_FLUX,
} from "./premises.js";
export { ALL_FLAGS } from "./flags.js";
export {
  FLAG_BAIZE_MET,
  FLAG_BORN_SOLITARY,
  FLAG_BORN_TWIN,
  FLAG_BLOOD_RITE,
  FLAG_CAVE_KNOWN,
  FLAG_FIREFLY_LED,
  FLAG_FOX_ALLY,
  FLAG_HUNTED,
  FLAG_KIN_GUEST,
  FLAG_MERCY,
  FLAG_SICK,
  FLAG_SKY_DROUGHT,
  FLAG_SPRING_KNOWN,
  FLAG_WOUND,
} from "./flags.js";
export { ORGANS } from "./organs.js";
export {
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
export { SEED_BAI_ZE, SEED_CHANG_TAI, SEED_YING_LONG, SEEDS } from "./seeds.js";
export {
  SYNERGIES,
  SYN_CHUAN_DI,
  SYN_DI_ZHUANG,
  SYN_KUI_XIN,
  SYN_KUI_YAO,
  SYN_LONG_YU,
  SYN_MAI_DU_ZHAO,
  SYN_SUI_GU,
  SYN_TU_WU,
  SYN_YE_LIE_YAN,
  SYN_ZHONG_JIA,
} from "./synergies.js";
export { ALL_TAGS } from "./tags.js";
export { TUNING } from "./tuning.js";
export { VISUAL_TOKENS, VT, type VisualToken, type VisualTokenId } from "./visualTokens.js";
