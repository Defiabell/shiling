/**
 * 8 敌人（青丘食物链）。
 *
 * ## 分两层
 * - **猎物层**（`PREY_IDS`，进 `tuning.huntPreyIds`）：野雉／文鳐鱼／穴鼠／岩羊。狩猎掷骰
 *   从这四个里等权抽一，成功即吞其 `essence`，失败还有 `huntFailCombatChance` 的概率反被
 *   缠上 —— 所以岩羊（meng 10／hp 14）留在表里是**故意**的：狩猎不是纯掷骰，运气差时
 *   会撞上一场真打。
 * - **强敌层**：草狐／山魈／玄蟒／穷奇幼崽。只由事件的 `startCombat` 引来，越往后越像一堵墙。
 *
 * ## 精气分工
 * 猎物各主一型（zu／lin／xue），**猛（meng）精气基本只能从搏杀与凶险抉择里来** —— 想走
 * 狩齿／毒腺／铁鬃那条线，就必须冒真打的风险，这是「稳妥 vs 稀有器官线索」这条抉择原则的
 * 数值底座。
 *
 * ## 战斗强度参照（playerHp ＝ ti，起手 20 上下；玩家每回合伤害 3＋floor(meng/8)）
 * 野雉/穴鼠/文鳐鱼 = 两三回合可下；岩羊 = 五回合，会掉半血；草狐 = 早期必须考虑逃；
 * 山魈/玄蟒 = 中期带器官技才谈得上打；穷奇幼崽 = 全内容库最硬的一堵墙，正面赢它多半要
 * ti≥45、有战斗技，且诈术先手。
 */

import type { EnemyDef } from "@shiling/tale-sim";

export const ENEMY_YE_ZHI = "ye-zhi";
export const ENEMY_WEN_YAO = "wen-yao";
export const ENEMY_XUE_SHU = "xue-shu";
export const ENEMY_YAN_YANG = "yan-yang";
export const ENEMY_CAO_HU = "cao-hu";
export const ENEMY_SHAN_XIAO = "shan-xiao";
export const ENEMY_XUAN_MANG = "xuan-mang";
export const ENEMY_QIONG_QI = "qiong-qi-you";

export const ENEMIES: readonly EnemyDef[] = [
  {
    id: ENEMY_YE_ZHI,
    name: "野雉",
    meng: 4,
    hp: 6,
    tags: ["beast", "prey", "bird"],
    essence: { zu: 16, lin: 4 },
    fleeBias: -12,
    desc: "羽色斑驳，惊则疾走十余步方起，起则不远。",
  },
  {
    id: ENEMY_WEN_YAO,
    name: "文鳐鱼",
    meng: 5,
    hp: 8,
    tags: ["beast", "prey", "fish"],
    essence: { lin: 20 },
    fleeBias: -8,
    desc: "银鳞，胸鳍宽张如翼，夜则跃出水面滑行数丈。",
  },
  {
    id: ENEMY_XUE_SHU,
    name: "穴鼠",
    meng: 4,
    hp: 7,
    tags: ["beast", "prey"],
    essence: { xue: 18, zu: 2 },
    fleeBias: -10,
    desc: "土黄短毛，前爪宽厚，一惊便往地下去，地下是它的天。",
  },
  {
    id: ENEMY_YAN_YANG,
    name: "岩羊",
    meng: 10,
    hp: 14,
    tags: ["beast", "prey", "horn"],
    essence: { meng: 10, zu: 10 },
    fleeBias: 4,
    desc: "青灰皮毛，双角后弯。逼到崖边它就不再退，回头顶来。",
  },
  {
    id: ENEMY_CAO_HU,
    name: "草狐",
    meng: 14,
    hp: 18,
    tags: ["beast"],
    essence: { zu: 12, meng: 10 },
    fleeBias: 0,
    desc: "瘦削，毛色枯黄，眼极亮。青丘的狐都记仇，也都记路。",
  },
  {
    id: ENEMY_SHAN_XIAO,
    name: "山魈",
    meng: 20,
    hp: 26,
    tags: ["beast", "humanoid"],
    essence: { meng: 16, xue: 8 },
    fleeBias: 6,
    desc: "人形，赤面无毛，两臂过膝。夜行山间，专拣落单者。",
  },
  {
    id: ENEMY_XUAN_MANG,
    name: "玄蟒",
    meng: 26,
    hp: 34,
    tags: ["beast", "venom"],
    essence: { xue: 20, lin: 12 },
    fleeBias: 12,
    desc: "黑鳞泛紫，身粗如柱。不追不扑，只等你自己走进它的一圈。",
  },
  {
    id: ENEMY_QIONG_QI,
    name: "穷奇幼崽",
    meng: 34,
    hp: 44,
    tags: ["beast", "divine"],
    essence: { meng: 32, xue: 8 },
    fleeBias: 16,
    desc: "虎身猬毛，肩生小翼，啼声如婴。虽幼，已知食人，且专食有理者。",
  },
];

/** 狩猎掷骰的猎物表 —— 进 `tuning.huntPreyIds`。 */
export const PREY_IDS: readonly string[] = [
  ENEMY_YE_ZHI,
  ENEMY_WEN_YAO,
  ENEMY_XUE_SHU,
  ENEMY_YAN_YANG,
];
