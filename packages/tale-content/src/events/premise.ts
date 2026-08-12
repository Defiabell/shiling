/**
 * 开局变量的**专属事件线**（5 条）—— 2026-08-13「每局不同」批次。
 *
 * ## 这一池与别的四池不同的地方
 * 每一条都以 `requiresFlags` 挂在某个开局变量的 flag 上（`sky-drought`／`born-solitary`／
 * `born-twin`），所以它们**只在那一类开局里存在**。这是「第二局不一样」最直白的一半：
 * 上一世是孤生，这一世是双生，于是有两条你上一世根本没见过的线。
 *
 * 计划正本里三条点名要的线都在这儿：大旱之年的「泉眼干涸」、孤生的「独行专属事件线」、
 * 双生的「同胞相关事件」。
 *
 * ## 为什么不按行动分池
 * 这几条问的是「这一世生在什么局面里」，与玩家这一季选了狩猎还是探索无关 —— 所以
 * `actions` 一律不写（任何行动之后都可能撞上），同「通用／季节」池的体例。
 */

import type { TaleEvent } from "@shiling/tale-sim";
import { ENEMY_CAO_HU } from "../enemies.js";
import { EV_KIN, EV_SOLITARY, EV_WATER, EV_WINTER } from "../eventTags.js";
import {
  FLAG_BORN_SOLITARY,
  FLAG_BORN_TWIN,
  FLAG_KIN_GUEST,
  FLAG_MERCY,
  FLAG_SICK,
  FLAG_SKY_DROUGHT,
  FLAG_WOUND,
} from "../flags.js";
import { TAG_DIG, TAG_INSIGHT } from "../tags.js";
import { VT } from "../visualTokens.js";

export const PREMISE_EVENTS: readonly TaleEvent[] = [
  // ===== 大旱之年 =====
  {
    id: "qiu-dry-springhead",
    trigger: {
      region: "qingqiu",
      requiresFlags: [FLAG_SKY_DROUGHT],
      seasons: [1, 2],
      weight: 40,
      tags: [EV_WATER],
    },
    title: "泉眼干涸",
    body: "你循着记忆走到那眼泉边，泉口只剩一圈湿泥，泥上密密都是别的兽的爪印。有几只还在附近打转，谁也不肯先走开。再往下掘、把它们赶走、或者去更远的地方——旱年里，这是每一日都要重答一遍的题。",
    illustrationBrief: `近景一圈干裂的泉口只余湿泥，泥面密布各种爪印；${VT.self}低头嗅泥，远处两三个模糊兽影在坡上打转。烈日当顶，地面反光刺白。背景为${VT.qiuHills}。`,
    choices: [
      {
        label: "掘泥取水",
        outcomes: [
          {
            weight: 62,
            text: "掘到一臂深，泥里渗出一小汪。混着沙，但是凉的。",
            effects: { hunger: 14, essence: { xue: 10 } },
          },
          {
            weight: 38,
            text: "掘了半日，掘到一层石板。石板下面什么也没有，只有更干的土。",
            effects: { hunger: -6, addFlags: [FLAG_SICK] },
          },
        ],
      },
      {
        label: "掘穿石板",
        requires: { organTags: [TAG_DIG] },
        outcomes: [
          {
            weight: 1,
            text: "爪子刨开石板，底下是一线活水。这一眼此后只有你知道怎么开。",
            effects: { hunger: 26, essence: { xue: 18 }, stats: { ling: 2 } },
          },
        ],
      },
      {
        label: "另寻水源",
        outcomes: [
          {
            weight: 1,
            text: "你顺着风里那点湿气走了很远，走到腿软，终于听见水声。",
            effects: { hunger: -8, essence: { lin: 8 }, stats: { ling: 2, de: 1 } },
          },
        ],
      },
    ],
  },

  // ===== 孤生 =====
  {
    id: "qiu-lone-path",
    trigger: {
      region: "qingqiu",
      requiresFlags: [FLAG_BORN_SOLITARY],
      weight: 34,
      tags: [EV_SOLITARY],
    },
    title: "独径",
    body: "你走的这条径上只有自己的爪印，来的与回的叠在一处。青丘的兽多结伴，别的径上层层都是旁人的味道，唯有这一条干净得反常。走熟之后你才明白：干净是因为没有别的兽肯来。",
    illustrationBrief: `俯视一条窄径穿过枯草，径上只有一行爪印来回重叠；${VT.self}立于径中回头看自己的脚印。远景${VT.qiuHills}空无一物，构图强调孤独与留白。`,
    choices: [
      {
        label: "独守此径",
        outcomes: [
          {
            weight: 1,
            text: "这条径的每一处坡、每一块松石你都记熟了。没有谁来分它。",
            effects: { essence: { zu: 14 }, stats: { meng: 2, ling: 2 } },
          },
        ],
      },
      {
        label: "循他兽之径",
        outcomes: [
          {
            weight: 58,
            text: "你踩上别人的味道走了一段，学到些东西，也被那味道的主人记住了。",
            effects: { stats: { ling: 3, de: 2 }, essence: { xue: 8 } },
          },
          {
            weight: 42,
            text: "径的尽头有东西回头看你。它先到，这条径本来是它的。",
            effects: { startCombat: ENEMY_CAO_HU },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-lone-winter",
    trigger: {
      region: "qingqiu",
      requiresFlags: [FLAG_BORN_SOLITARY],
      seasons: [3],
      weight: 36,
      tags: [EV_SOLITARY, EV_WINTER],
    },
    title: "孤影过冬",
    body: "雪下到第三夜，穴里只有你一个的热气，撑不开这么大的空。别的穴口都是两三层脚印，一层压一层，压得很实。你可以去敲一个，也可以把自己再缩小一点。",
    illustrationBrief: `夜雪中一处穴口，${VT.self}独自蜷在穴内只露出眼睛；画面另一侧远处另一穴口透出暖光与层叠脚印。冷蓝调，大面积雪面留白。`,
    choices: [
      {
        label: "缩身自守",
        outcomes: [
          {
            weight: 1,
            text: "你把四肢收到最紧，把自己熬成一小团热。天亮时雪停了。",
            effects: { hunger: -6, stats: { ti: 3, ling: 2 } },
          },
        ],
      },
      {
        label: "投他穴而居",
        outcomes: [
          {
            weight: 54,
            text: "穴里那几只挪出一个位置给你。谁都没说话，你也就没走。",
            effects: { hunger: 16, stats: { de: 3 }, addFlags: [FLAG_KIN_GUEST] },
          },
          {
            weight: 46,
            text: "刚探进头就被咬了出来。雪里躺了半夜，才想起自己本来就没有穴可投。",
            effects: { hunger: -10, stats: { de: -2 }, addFlags: [FLAG_WOUND] },
          },
        ],
      },
    ],
  },

  // ===== 双生 =====
  {
    id: "qiu-twin-call",
    trigger: {
      region: "qingqiu",
      requiresFlags: [FLAG_BORN_TWIN],
      weight: 34,
      tags: [EV_KIN],
    },
    title: "同胞相唤",
    body: "坡那边传来一声叫，调子与你自己的一模一样。你们生下来分同一个穴，后来各走一边，可那调子改不掉。它在叫你，也可能只是在叫，叫给整座山听。",
    illustrationBrief: `暮色双坡对望，近坡${VT.self}抬头张口欲应，远坡另有一只同形兽影只作剪影。两者体态镜像对称，中间是深谷留白。背景${VT.qiuHills}。`,
    choices: [
      {
        label: "应而往之",
        outcomes: [
          {
            weight: 66,
            text: "你们一前一后撵了半日，合力按住一头岩羊。分食时谁也没抢。",
            effects: { hunger: 22, essence: { meng: 12, zu: 6 }, stats: { de: 2 }, takesLife: 1 },
          },
          {
            weight: 34,
            text: "赶到坡那边，草是热的，它已经走了。那一声原来不是叫你。",
            effects: { hunger: -6, stats: { ling: 2, de: 1 } },
          },
        ],
      },
      {
        label: "不应而去",
        outcomes: [
          {
            weight: 1,
            text: "你听完那一声，转身往反方向走。此后它再叫，你也听得出来。",
            effects: { essence: { xue: 10 }, stats: { meng: 2, de: -1 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-twin-fall",
    trigger: {
      region: "qingqiu",
      requiresFlags: [FLAG_BORN_TWIN],
      minYear: 4,
      once: true,
      weight: 44,
      tags: [EV_KIN],
    },
    title: "同胞之殁",
    body: "你在坡下找到它，身子已经硬了，颈上一排整齐的齿痕。它到死都朝着你们出生那个穴的方向。你可以吃它，青丘的规矩允许；也可以把它埋了，规矩没说不许。",
    illustrationBrief: `晨雾坡下一只与主角同形的兽俯卧不动，颈侧有齿痕；${VT.self}立于其侧低头俯视，只见半身。冷灰调，露水与草叶细节，构图留出上方三分之一空白。`,
    choices: [
      {
        label: "食其血肉",
        outcomes: [
          {
            weight: 1,
            // 它已经死了 —— 不算「夺命」（takesLife 不写），代价全在德上
            text: "同一个穴里出来的东西，味道竟与自己极像。你吃到天黑。",
            effects: { hunger: 34, essence: { meng: 18, xue: 10 }, stats: { de: -12 } },
          },
        ],
      },
      {
        label: "掘土葬之",
        outcomes: [
          {
            weight: 1,
            text: "你掘了一夜，把它推进去，又把土推回来。饿着回的穴。",
            effects: { hunger: -8, stats: { de: 8, ling: 2 }, addFlags: [FLAG_MERCY] },
          },
        ],
      },
      {
        label: "守其骨三日",
        requires: { organTags: [TAG_INSIGHT], stats: { ling: 25 } },
        outcomes: [
          {
            weight: 1,
            text: "三日里你听见它剩下的那点动静一点点散尽。散尽之前，它把路指给了你。",
            effects: { essence: { lin: 16 }, stats: { ling: 4, de: 4 }, lifespan: 1 },
          },
        ],
      },
    ],
  },
];
