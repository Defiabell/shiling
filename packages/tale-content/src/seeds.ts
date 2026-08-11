/**
 * 3 神种（出生自带的第 0 器官）。
 *
 * 神种器官**只**存在于 `SeedDef.organ`，不进 `ORGANS` —— 引擎的 `organIndex` 会把两处并起来
 * 查，但蛰伏开奖池只看 `content.organs`，所以神种器官永远不会被重复开出。
 *
 * 定价（`cost` ＝血统点，`bloodlineGain` 一世约产 3〜8 点）：免费种 0，白泽遗种 5，
 * 应龙遗种 8 —— 第二世通常能开一个，第三、四世才够应龙。三个种对应三条起手路线：
 * 常胎无偏（靠抉择定型）、白泽偏灵德（开奇遇与登神线）、应龙偏猛体（开硬碰硬线）。
 */

import type { SeedDef } from "@shiling/tale-sim";
import {
  TAG_ARMOR,
  TAG_DRAGON_KIN,
  TAG_INSIGHT,
  TAG_ORACLE,
  TAG_SPIRIT_BORN,
} from "./tags.js";

export const SEED_CHANG_TAI = "seed-chang-tai";
export const SEED_BAI_ZE = "seed-bai-ze-yi";
export const SEED_YING_LONG = "seed-ying-long-yi";

export const SEED_ORGAN_LING_YUN = "organ-ling-yun";
export const SEED_ORGAN_BAI_ZE_XUE = "organ-bai-ze-xue";
export const SEED_ORGAN_LONG_LIN_TAI = "organ-long-lin-tai";

export const SEEDS: readonly SeedDef[] = [
  {
    id: SEED_CHANG_TAI,
    name: "常胎",
    cost: 0,
    organ: {
      id: SEED_ORGAN_LING_YUN,
      name: "灵蕴",
      slot: "spirit",
      affinity: { lin: 0.4 },
      statMods: { ling: 3 },
      tags: [TAG_SPIRIT_BORN],
      desc: "一缕神识寄于血肉，是食灵入世的凭据，此外别无长处。",
    },
    desc: "最寻常的降生：无所偏，亦无所恃。一世成什么样，全看自己吃了什么、选了什么。",
  },
  {
    id: SEED_BAI_ZE,
    name: "白泽遗种",
    cost: 5,
    organ: {
      id: SEED_ORGAN_BAI_ZE_XUE,
      name: "白泽血",
      slot: "spirit",
      affinity: { lin: 0.5 },
      statMods: { ling: 7, de: 5 },
      tags: [TAG_SPIRIT_BORN, TAG_ORACLE, TAG_INSIGHT],
      desc: "血中掺了一点知万物之情的东西。听得懂的越多，怕的也越多。",
    },
    desc: "白泽经行处，草木亦记其言。凭此种降世者，生而能辨异类之语。",
  },
  {
    id: SEED_YING_LONG,
    name: "应龙遗种",
    cost: 8,
    organ: {
      id: SEED_ORGAN_LONG_LIN_TAI,
      name: "龙鳞胎",
      slot: "hide",
      affinity: { xue: 0.4 },
      statMods: { meng: 5, ti: 6 },
      tags: [TAG_SPIRIT_BORN, TAG_ARMOR, TAG_DRAGON_KIN],
      desc: "初生即覆薄鳞，硬如旧甲。鳞下的血比同类烫。",
    },
    desc: "应龙陨于青丘，其气入土三尺。凭此种降世者，生而带鳞，亦生而招祸。",
  },
];
