/**
 * 休憩事件（4）—— `trigger.actions: ["rest"]`。
 *
 * 休憩本身是引擎行为（回饱食＋摘掉 `restHealFlags` 里的伤病 flag），这一池负责给「躺着」
 * 一点内容重量：养伤要付代价、穴里会来客、皮下会有东西想出去。
 *
 * 「旧伤发热」用 `requiresFlags: [FLAG_WOUND]` 入池 —— 它只在你真的带伤时出现，
 * 而带伤这件事又是别的池子里那些贪心选项种下的。
 */

import type { TaleEvent } from "@shiling/tale-sim";
import { FLAG_BAIZE_MET, FLAG_KIN_GUEST, FLAG_MERCY, FLAG_SICK, FLAG_WOUND } from "../flags.js";
import { TAG_INSIGHT, TAG_VENOM } from "../tags.js";
import { VT } from "../visualTokens.js";

export const REST_EVENTS: readonly TaleEvent[] = [
  {
    id: "qiu-rest-white-dream",
    // 梦是白泽的先兆；见过真的，就不再梦见 —— FLAG_BAIZE_MET 在这里被读掉
    trigger: {
      region: "qingqiu",
      actions: ["rest"],
      forbidsFlags: [FLAG_BAIZE_MET],
      weight: 30,
    },
    title: "梦中白兽",
    body: "浅眠里你见到一头白兽站在雪上，四只眼睛都睁着，看你，不说话。醒来时穴口的草被压平了一片，压出的形状不是你的，也不是这一带任何一种兽的。",
    illustrationBrief: `梦境感画面上半为雪原上侧立的${VT.baize}，四目齐睁；下半为现实穴口一片压平的白草。${VT.self}半醒探头，两层景以雾气分隔。`,
    choices: [
      {
        label: "追出穴外",
        outcomes: [
          {
            weight: 58,
            text: "草迹一路往北，到坡下就断了。断处的土上，有一点很淡的白。",
            effects: { essence: { lin: 14 }, stats: { ling: 2 } },
          },
          {
            weight: 42,
            text: "你在坡上找了半日，什么也没找到，只把自己找饿了。",
            effects: { hunger: -6, stats: { ling: 1 } },
          },
        ],
      },
      {
        label: "以灵犀记之",
        requires: { organTags: [TAG_INSIGHT] },
        outcomes: [
          {
            weight: 1,
            text: "你把那四只眼睛的样子记进灵窍。此后每次快要走错路，它就亮一下。",
            effects: { essence: { lin: 20 }, stats: { ling: 4, de: 1 } },
          },
        ],
      },
      {
        label: "闭目再睡",
        outcomes: [
          {
            weight: 1,
            text: "你翻了个身接着睡。这一觉睡得极沉，醒来时毛都是暖的。",
            effects: { hunger: 10, essence: { lin: 6 }, stats: { ling: 1 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-rest-fever",
    trigger: { region: "qingqiu", actions: ["rest"], requiresFlags: [FLAG_WOUND], weight: 60 },
    title: "旧伤发热",
    body: "伤口周围的肉肿了起来，热得发亮，一碰就有黄水渗出。你舔了半日，那热反而顺着筋往身体深处走，走到你开始发抖，抖得连爪子都收不住。",
    illustrationBrief: `近景${VT.self}侧卧于石隙中，一处伤口红肿发亮，口鼻凑近舔舐；身下石面有暗色水渍。光线昏暗，只一线天光落在伤处。`,
    choices: [
      {
        label: "咬开患处",
        outcomes: [
          {
            weight: 64,
            text: "你自己咬开了那块肉，黄水混着血涌出来。痛过之后，热退了。",
            effects: { removeFlags: [FLAG_WOUND], stats: { ti: -2, meng: 1 } },
          },
          {
            weight: 36,
            text: "咬得太深，血止不住，创口又添新创。这一季白养了。",
            effects: { stats: { ti: -6 }, addFlags: [FLAG_SICK] },
          },
        ],
      },
      {
        label: "以毒攻之",
        requires: { organTags: [TAG_VENOM] },
        outcomes: [
          {
            weight: 1,
            text: "你把自己的毒抹进伤口。腐肉一夜之间黑透脱落，底下是干净的。",
            effects: { removeFlags: [FLAG_WOUND], essence: { meng: 8 }, stats: { ti: 1 } },
          },
        ],
      },
      {
        label: "忍而待之",
        outcomes: [
          {
            weight: 52,
            text: "熬了三日，热自己退了。你什么也没做，只是没死。",
            effects: { removeFlags: [FLAG_WOUND], stats: { ti: -1 } },
          },
          {
            weight: 30,
            text: "热退了一半又回来，反复了整整一季。伤口至今没有合拢。",
            effects: { stats: { ti: -3 } },
          },
          {
            weight: 18,
            text: "第五日夜里，热终于烧到了骨头里。你没能等到它退。",
            effects: { die: "slain" },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-rest-guest",
    // 放过幼弱的才会有客投奔；已经容留过就不会再来
    trigger: {
      region: "qingqiu",
      actions: ["rest"],
      requiresFlags: [FLAG_MERCY],
      forbidsFlags: [FLAG_KIN_GUEST],
      weight: 46,
    },
    title: "同穴之客",
    body: "你的穴里多了一只小兽，缩在最里侧，见你回来也不逃，只把耳朵放平贴住后脑。它身上有血味，不是它自己的。外头的风一夜比一夜冷。",
    illustrationBrief: `穴内近景一只瘦小异兽缩在最深处，耳朵贴平；洞口${VT.self}侧身站定，与之对视。洞外冷光自入口斜射，洞内其余处深暗。`,
    choices: [
      {
        label: "就穴食之",
        outcomes: [
          {
            weight: 1,
            text: "它没有挣扎，这让你吃得比平时快。穴里从此又只剩一种气味。",
            effects: { hunger: 20, essence: { zu: 10 }, stats: { de: -5 } },
          },
        ],
      },
      {
        label: "容之同穴",
        outcomes: [
          {
            weight: 1,
            text: "你在洞口睡，让它睡里侧。它整夜没动，你也整夜没睡踏实。",
            effects: {
              hunger: -4,
              stats: { de: 4, ling: 1 },
              addFlags: [FLAG_KIN_GUEST],
            },
          },
        ],
      },
      {
        label: "驱之出穴",
        outcomes: [
          {
            weight: 1,
            text: "你把它赶了出去。第二天洞口的雪上有一小串脚印，往北，没有回来的。",
            effects: { stats: { de: -1, ling: 1 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-rest-molting-itch",
    trigger: { region: "qingqiu", actions: ["rest"], weight: 28 },
    title: "蜕痒",
    body: "皮下有东西在挤。你在石上磨了半日，磨破了几处，那痒却从骨头里透出来，像另一个自己想从这层皮里出去，而这层皮已经不够它用了。",
    illustrationBrief: `近景${VT.self}侧身在粗石上磨蹭，几处毛发脱落露出发红的皮；皮下隐约有起伏的形状。光线低平，画面偏暖，背景大片空石。`,
    choices: [
      {
        label: "任其自成",
        outcomes: [
          {
            weight: 1,
            text: "你不再管它。痒了整整一季，散在四处的精气自己往一处聚。",
            effects: { essence: { zu: 6, lin: 6, xue: 6, meng: 6 } },
          },
        ],
      },
      {
        label: "以石磨之",
        outcomes: [
          {
            weight: 1,
            text: "磨到出血才痛快。旧皮成片脱落，新皮薄，但底下的肉是硬的。",
            effects: { hunger: -4, essence: { meng: 12 }, stats: { ti: 2 } },
          },
        ],
      },
      {
        label: "凝神导之",
        requires: { essenceMin: { lin: 20 } },
        outcomes: [
          {
            weight: 1,
            text: "你以鳞之精气为引，把那股躁动分别引向四肢与脏腑。它们各自安顿了。",
            effects: {
              essence: { lin: -20, zu: 10, xue: 10, meng: 10 },
              stats: { ling: 2 },
            },
          },
        ],
      },
    ],
  },
];
