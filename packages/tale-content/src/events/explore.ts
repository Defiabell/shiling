/**
 * 探索事件（20）—— `trigger.actions: ["explore"]`，本库最大的一池。
 *
 * 探索一季不产食物（`hunger` 净减），换来的是**双倍事件概率**与这池子里的东西：精气、
 * 灵与德、器官线索、以及四条会改写一世走向的稀有奇遇（白泽／应龙／骨坛／照影潭）。
 * 所以「今天探不探」本身就是一次抉择：拿饱食赌可能性。
 *
 * 稀有奇遇一律 `once: true` 且权重压在 30〜60 —— 稀有不是靠低概率堆出来的，是靠
 * 「一世只有一次」＋「选错就没了」。
 */

import type { TaleEvent } from "@shiling/tale-sim";
import { ENEMY_CAO_HU, ENEMY_SHAN_XIAO, ENEMY_XUAN_MANG } from "../enemies.js";
import {
  FLAG_BAIZE_MET,
  FLAG_BLOOD_RITE,
  FLAG_CAVE_KNOWN,
  FLAG_FIREFLY_LED,
  FLAG_FOX_ALLY,
  FLAG_HUNTED,
  FLAG_MERCY,
  FLAG_SICK,
  FLAG_SPRING_KNOWN,
  FLAG_WOUND,
} from "../flags.js";
import { ORGAN_LONG_XIAN } from "../organs.js";
import { TAG_DIG, TAG_FAR_SIGHT, TAG_INSIGHT, TAG_SWIFT, TAG_VENOM } from "../tags.js";
import { VT } from "../visualTokens.js";

export const EXPLORE_EVENTS: readonly TaleEvent[] = [
  {
    id: "qiu-explore-spring",
    trigger: { region: "qingqiu", actions: ["explore"], weight: 28 },
    title: "灵泉",
    body: "乱石之间一眼清泉，泉底铺着九曲青石纹，水面浮一层极薄的白气。你低头去饮，水里那张脸比你自己的更清楚些——它先动的嘴，你才觉出渴。",
    illustration: "events/qiu-explore-spring.webp",
    illustrationBrief: `近景${VT.lingquan}占画面下半，水面浮薄白气；${VT.self}俯身饮水，水中倒影比实体清晰。四周乱石，晨光偏冷，上方留白。`,
    choices: [
      {
        label: "俯首而饮",
        outcomes: [
          {
            weight: 68,
            text: "水凉到骨头里，一路凉进识海。抬头时，天比刚才亮。",
            effects: { hunger: 8, essence: { lin: 14 }, stats: { ling: 2 } },
          },
          {
            weight: 32,
            text: "水性阴寒，饮罢腹中如压一块石，半日才缓过来。",
            effects: { hunger: 6, stats: { ti: -2 } },
          },
        ],
      },
      {
        label: "浸身其中",
        outcomes: [
          {
            weight: 1,
            text: "整个泡进去。石纹的凉顺着毛孔往里走，走到你记住了这泉的位置。",
            effects: {
              essence: { lin: 18, xue: 6 },
              stats: { ti: 1 },
              addFlags: [FLAG_SPRING_KNOWN],
            },
          },
        ],
      },
      {
        label: "以精气相酬",
        requires: { essenceMin: { lin: 30 } },
        outcomes: [
          {
            weight: 1,
            text: "你把攒下的鳞之精气推回水里。泉眼咕地涌了一下，像是应了一声。",
            effects: {
              essence: { lin: -30 },
              stats: { ling: 4, de: 3 },
              lifespan: 1,
              addFlags: [FLAG_SPRING_KNOWN],
            },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-explore-stele",
    trigger: { region: "qingqiu", actions: ["explore"], weight: 22 },
    title: "断碑",
    body: "半截石碑埋在藤里，字是刻上去的，比爪痕深得多。你不识字，可看久了那些笔画会在眼里动，像很多小虫排着队往同一个方向走。你也想跟着走。",
    illustration: "events/qiu-explore-stele.webp",
    illustrationBrief: `中景${VT.duanbei}斜插在藤蔓中；${VT.self}仰头贴近碑面，鼻尖几乎触到刻痕。林间散光，碑面刻痕投出细影，右侧大片留白。`,
    choices: [
      {
        label: "久视其文",
        outcomes: [
          {
            weight: 60,
            text: "看到日头偏西。那些笔画走完了一圈，你说不出学到什么，但确实学到了。",
            effects: { essence: { lin: 12 }, stats: { ling: 3 } },
          },
          {
            weight: 40,
            text: "看到头里发胀，眼前发黑。醒来时天已黑透，碑还在，字不动了。",
            effects: { stats: { ling: 1, ti: -2 } },
          },
        ],
      },
      {
        label: "以灵犀通之",
        requires: { organTags: [TAG_INSIGHT] },
        outcomes: [
          {
            weight: 1,
            text: "灵窍一开，碑上的字自己念给你听。念的是一个死了很久的名字。",
            effects: { essence: { lin: 22 }, stats: { ling: 5, de: 1 } },
          },
        ],
      },
      {
        label: "掘碑下之土",
        requires: { organTags: [TAG_DIG] },
        outcomes: [
          {
            weight: 1,
            text: "碑下埋着一具蜷曲的兽骨，骨上还压着半枚玉。土是干的，骨是凉的。",
            effects: { essence: { xue: 18, lin: 6 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-explore-baize",
    // 血祭过的东西白泽不与之言 —— FLAG_BLOOD_RITE 在这里被读掉
    trigger: {
      region: "qingqiu",
      actions: ["explore"],
      minStats: { ling: 20 },
      forbidsFlags: [FLAG_BLOOD_RITE],
      once: true,
      weight: 50,
    },
    title: "白泽问路",
    body: "山脊上站着一头人面四目的白鹿，通体霜白，额生双角。它不惊，也不避，先开口问你：你要往哪里去。你听得懂它的话——正因为听得懂，你才更怕。",
    illustration: "events/qiu-explore-baize.webp",
    illustrationBrief: `远中景山脊线上${VT.baize}侧立，四目齐睁；坡下${VT.self}仰头相望，两者间隔一段空白山脊。天光平，云层压低，构图左右分置。`,
    choices: [
      {
        label: "答以求生",
        outcomes: [
          {
            weight: 1,
            text: "你说想活下去。它说，那就够难的了，然后让开半步让你过。",
            effects: {
              essence: { lin: 20 },
              stats: { ling: 2, de: 2 },
              addFlags: [FLAG_BAIZE_MET],
            },
          },
        ],
      },
      {
        label: "答以求道",
        requires: { stats: { ling: 35 } },
        outcomes: [
          {
            weight: 1,
            text: "你说想知道自己是什么。它看了你很久，说：那你得先活得够长。",
            effects: {
              essence: { lin: 26 },
              stats: { ling: 5, de: 4 },
              lifespan: 1,
              addFlags: [FLAG_BAIZE_MET],
            },
          },
        ],
      },
      {
        label: "不答而退",
        outcomes: [
          {
            weight: 1,
            text: "你低头绕过山脊。它没有再问。走出很远，那四只眼睛还在背后。",
            effects: { essence: { lin: 8 }, stats: { ling: 1 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-explore-yinglong",
    trigger: { region: "qingqiu", actions: ["explore"], minYear: 3, once: true, weight: 44 },
    title: "垂死应龙",
    body: "谷底横着一条身长数丈的巨物，背上残翼半张，鳞色青金而黯。它还活着，每一次呼吸都把地上的碎石一粒粒吹开。它的眼睛正对着你，从你进谷起就一直对着你。",
    illustration: "events/qiu-explore-yinglong.webp",
    illustrationBrief: `广角谷底${VT.yinglong}横卧占据画面大半，残翼一侧张开；谷口${VT.self}极小地立在画面右下，形成体量对比。天色将暮，云低压。`,
    choices: [
      {
        label: "食其血肉",
        outcomes: [
          {
            weight: 72,
            text: "你从它还睁着眼的时候开始吃。腹中那股热，很多年都没散。",
            effects: {
              hunger: 40,
              essence: { meng: 28, xue: 18 },
              stats: { de: -10 },
            },
          },
          {
            weight: 28,
            text: "肉一入口，龙气自内里炸开。你活了下来，但吐了三日的血。",
            effects: { hunger: 20, essence: { meng: 16 }, stats: { ti: -8, de: -6 } },
          },
        ],
      },
      {
        label: "守其气绝",
        requires: { stats: { de: 20 } },
        outcomes: [
          {
            weight: 1,
            text: "你守了三日，替它赶开秃鹫。它闭眼前吐出一泓凉涎，正落在你舌下。",
            effects: {
              addOrganId: ORGAN_LONG_XIAN,
              essence: { lin: 20 },
              stats: { de: 4 },
            },
          },
        ],
      },
      {
        label: "以精气饲之",
        requires: { essenceMin: { lin: 40 } },
        outcomes: [
          {
            weight: 1,
            text: "你把鳞之精气尽数推入它口中。它多活了半日，那半日里教了你一样东西。",
            effects: {
              essence: { lin: -40 },
              addOrganId: ORGAN_LONG_XIAN,
              stats: { ling: 3, de: 2 },
            },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-explore-mushroom",
    trigger: { region: "qingqiu", actions: ["explore"], seasons: [1, 2], weight: 24 },
    title: "鬼伞",
    body: "腐叶堆上生出一圈灰白的伞，伞面有淡红的斑，一碰就渗水。这东西闻起来像肉，可青丘的老兽从不碰它，连蝇都绕着走。你饿，而且已经饿了很久。",
    illustration: "events/qiu-explore-mushroom.webp",
    illustrationBrief: `俯视腐叶层上一圈${VT.guiSan}环生，伞面淡红斑清晰；${VT.self}低头嗅探，一只前爪悬在伞上未落。光线幽绿，四周暗。`,
    choices: [
      {
        label: "取而食之",
        outcomes: [
          {
            weight: 46,
            text: "味道竟然是好的。半日后手脚发麻，麻过去以后，眼前的东西全都亮了一层。",
            effects: { hunger: 26, essence: { xue: 12 }, stats: { ling: 1 } },
          },
          {
            weight: 42,
            text: "腹中如有虫走，泻了两日。第三日才想起来把剩下的那几朵踩烂。",
            effects: { hunger: 14, stats: { ti: -4 }, addFlags: [FLAG_SICK] },
          },
          {
            weight: 12,
            text: "喉咙先麻，然后是心口。你倒在腐叶上，看着伞面上的红斑慢慢合成一片。",
            effects: { die: "slain" },
          },
        ],
      },
      {
        label: "以毒辨之",
        requires: { organTags: [TAG_VENOM] },
        outcomes: [
          {
            weight: 1,
            text: "同类识同类。你挑出无毒的那几朵吃了，剩下的连根刨出来带走。",
            effects: { hunger: 22, essence: { xue: 14 }, stats: { ling: 1 } },
          },
        ],
      },
      {
        label: "弃而远之",
        outcomes: [
          {
            weight: 1,
            text: "你退开。饿是难受，可老兽绕着走的东西，总有绕着走的道理。",
            effects: { stats: { ling: 2 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-explore-fog-woods",
    trigger: { region: "qingqiu", actions: ["explore"], weight: 26 },
    title: "雾林",
    body: "雾起得极快，三步之外只剩灰白。你辨不出方向，只听见水声在左边，走两步又像在右边。这样的雾里走错一步，一整季就要费在原地打转。",
    illustration: "events/qiu-explore-fog-woods.webp",
    illustrationBrief: `画面几乎被灰白雾气填满，只见近处三两株树干与湿地；${VT.self}居中偏下，形体一半没入雾中。极低对比，大量留白。`,
    choices: [
      {
        label: "循水声行",
        outcomes: [
          {
            weight: 58,
            text: "水声果然是真的。你顺溪走出雾林时，天已经放晴了两日。",
            effects: { essence: { zu: 12, lin: 6 } },
          },
          {
            weight: 42,
            text: "转了整整一季，回到原处，认出自己昨天的爪印，压在今天的爪印下面。",
            effects: { hunger: -8, stats: { ling: 1 } },
          },
        ],
      },
      {
        label: "以雾目视之",
        requires: { organTags: [TAG_FAR_SIGHT] },
        outcomes: [
          {
            weight: 1,
            text: "雾中反而看得清。你看见石壁上有一道裂缝，缝里吹出的风是暖的。",
            effects: { essence: { lin: 16 }, addFlags: [FLAG_CAVE_KNOWN] },
          },
        ],
      },
      {
        label: "伏地待雾散",
        outcomes: [
          {
            weight: 1,
            text: "你趴下不动，听了半季的水声。雾散时，你已经能分辨它有几处拐弯。",
            effects: { hunger: -4, stats: { ling: 2 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-explore-cave",
    // 已经知道这处幽穴就不必再「发现」一次
    trigger: {
      region: "qingqiu",
      actions: ["explore"],
      forbidsFlags: [FLAG_CAVE_KNOWN],
      weight: 24,
    },
    title: "幽穴",
    body: "石壁裂开一道缝，缝里吹出的风是暖的，带着湿土与陈骨的气味。风里没有活物的气息，可你分明听见很深的地方有水在滴，一滴，很久，又一滴。",
    illustration: "events/qiu-explore-cave.webp",
    illustrationBrief: `近景${VT.youxue}裂口占画面左侧，口沿湿苔；${VT.self}半身探入缝中，后腿仍在外。洞内深处一点微光，其余全暗。`,
    choices: [
      {
        label: "径入穴中",
        outcomes: [
          {
            weight: 54,
            text: "越往里越暖。尽头是一泓地下水，水边堆着不知谁留下的骨。",
            effects: { essence: { xue: 20 }, addFlags: [FLAG_CAVE_KNOWN] },
          },
          {
            weight: 26,
            text: "暖风是从一圈盘着的东西身上来的。它比你先醒。",
            effects: { startCombat: ENEMY_XUAN_MANG },
          },
          {
            weight: 20,
            text: "顶上一块松石砸下来，砸在肩胛上。你退出来时，缝里的风停了。",
            effects: { stats: { ti: -4 }, addFlags: [FLAG_WOUND] },
          },
        ],
      },
      {
        label: "掘广其口",
        requires: { organTags: [TAG_DIG] },
        outcomes: [
          {
            weight: 1,
            text: "你把缝掘成了门。从此青丘多一处只有你进得去的地方。",
            effects: { essence: { xue: 24 }, hunger: 6, addFlags: [FLAG_CAVE_KNOWN] },
          },
        ],
      },
      {
        label: "留待日后",
        outcomes: [
          {
            weight: 1,
            text: "你在缝口撒了一泡尿作记，转身走了。有些洞不该在饿的时候进。",
            effects: { stats: { ling: 1 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-explore-hermit",
    trigger: { region: "qingqiu", actions: ["explore"], weight: 20, forbidsFlags: [FLAG_HUNTED] },
    title: "采药人",
    body: "坡上有个青布短褐的人，背着竹篓，腰悬小镰，正低头挖一株带紫花的草。他没有抬头。你与他之间不过十步——这十步很近，近到你能听见他哼的调子。",
    illustration: "events/qiu-explore-hermit.webp",
    illustrationBrief: `中景${VT.caiyaoren}蹲在坡上挖草，背影为主；坡下草丛中${VT.self}伏低窥视，只露出头与前爪。逆光，人影与草坡成剪影。`,
    choices: [
      {
        label: "扑而杀之",
        outcomes: [
          {
            weight: 1,
            text: "人比鹿好杀，也比鹿难忘。那调子在你耳里哼了很多年。",
            effects: {
              hunger: 30,
              essence: { meng: 18 },
              stats: { de: -12 },
              addFlags: [FLAG_HUNTED],
            },
          },
        ],
      },
      {
        label: "受其一饼",
        requires: { stats: { de: 25 } },
        outcomes: [
          {
            weight: 1,
            text: "他抬头看见你，不惊，只从怀里掰了半块饼放在石上，然后接着挖他的草。",
            effects: { hunger: 26, essence: { lin: 8 }, stats: { de: 2 } },
          },
        ],
      },
      {
        label: "远观其采",
        outcomes: [
          {
            weight: 1,
            text: "你看了整整一日：他挖三株，留一株。你不明白为什么，但记住了。",
            effects: { essence: { lin: 10 }, stats: { ling: 3, de: 1 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-explore-cicada",
    trigger: { region: "qingqiu", actions: ["explore"], seasons: [1], weight: 22 },
    title: "蝉蜕",
    body: "枝上挂着一只完整的空壳，背缝裂开一线，六足还牢牢抓着树皮。壳仍是活物的形状，里头却什么都没有。你看着看着，觉得自己身上某一处也开始发痒。",
    illustration: "events/qiu-explore-cicada.webp",
    illustrationBrief: `特写树枝上一只${VT.chanTui}，背缝裂口清晰，六足仍抓紧树皮；背景虚化，${VT.self}的一只眼睛在画面边缘凑近。夏日强光透过树叶。`,
    choices: [
      {
        label: "食其空壳",
        outcomes: [
          {
            weight: 1,
            text: "壳入口即碎，味同枯叶。可那点痒，忽然就顺着脊背走了一遍。",
            effects: { essence: { lin: 12, zu: 4 } },
          },
        ],
      },
      {
        label: "以身试之",
        requires: { essenceMin: { zu: 30 } },
        outcomes: [
          {
            weight: 1,
            text: "你把足之精气逼向皮下，像蝉那样从旧壳里挤出去。疼，但换了个身子。",
            effects: {
              essence: { zu: -30, lin: 12, xue: 8 },
              stats: { ti: 3, ling: 2 },
            },
          },
        ],
      },
      {
        label: "久视而思",
        outcomes: [
          {
            weight: 1,
            text: "你想：那只蝉现在在哪里？它还认得这具壳吗？想到天黑也没想明白。",
            effects: { essence: { lin: 8, xue: 6 }, stats: { ling: 2 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-explore-altar",
    trigger: { region: "qingqiu", actions: ["explore"], once: true, weight: 32 },
    title: "骨坛",
    body: "林中空地垒着一圈兽骨，中央一块黑石，石面被血浸得发亮。骨都朝着同一个方向摆，摆得太整齐了，不像野兽干的，也不太像人干的。空地上一根草都不长。",
    illustration: "events/qiu-explore-altar.webp",
    illustrationBrief: `俯视林中空地一座${VT.gutan}，兽骨环列指向中心黑石；${VT.self}立在骨圈之外，一足悬停未踏入。四周林木暗，空地异常明亮。`,
    choices: [
      {
        label: "以血涂石",
        outcomes: [
          {
            weight: 1,
            text: "你咬破自己的舌尖，把血抹上黑石。石面吸得很快，快得像早就在等。",
            effects: {
              essence: { meng: 24, xue: 8 },
              stats: { de: -6 },
              addFlags: [FLAG_BLOOD_RITE],
            },
          },
        ],
      },
      {
        label: "毁其骨坛",
        outcomes: [
          {
            weight: 66,
            text: "你把骨一根根踢散，把黑石推翻。做完之后，林子安静得反常。",
            effects: { essence: { xue: 10 }, stats: { de: 4 } },
          },
          {
            weight: 34,
            text: "石翻过来的那一刻，林子那头有什么东西站了起来，正朝这边走。",
            effects: { stats: { de: 3 }, startCombat: ENEMY_SHAN_XIAO },
          },
        ],
      },
      {
        label: "绕行而拜",
        outcomes: [
          {
            weight: 1,
            text: "你绕着骨圈走了三匝，低头，然后离开。谁垒的坛不重要，垒坛的意思你懂。",
            effects: { essence: { lin: 8 }, stats: { de: 2, ling: 1 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-explore-waterfall",
    trigger: { region: "qingqiu", actions: ["explore"], seasons: [0, 1, 2], weight: 22 },
    title: "悬瀑",
    body: "水从三十丈高的崖口砸下来，砸出的白雾把整条谷填满。崖壁湿滑，雾里却隐约有一条斜上去的石棱，棱上留着旧爪痕——比你的爪大，而且只上不下。",
    illustration: "events/qiu-explore-waterfall.webp",
    illustrationBrief: `竖构图高崖瀑布自上倾泻，白雾弥漫下半；崖壁一道斜石棱上留有旧爪痕，${VT.self}立于棱下抬头。水汽厚重，画面上端留白。`,
    choices: [
      {
        label: "缘棱而上",
        requires: { organTags: [TAG_SWIFT] },
        outcomes: [
          {
            weight: 1,
            text: "三跃到顶。站在崖口回头看，整座青丘都在雾下面铺开。",
            effects: { essence: { zu: 22 }, stats: { ling: 2, de: 1 } },
          },
        ],
      },
      {
        label: "强行攀之",
        outcomes: [
          {
            weight: 52,
            text: "爪子在石上打了三次滑，终究爬了上去。上头什么也没有，但你上去了。",
            effects: { essence: { zu: 14 } },
          },
          {
            weight: 34,
            text: "半途踩空，滚落十余丈，被一株横生的松接住。肋下疼了一整季。",
            effects: { stats: { ti: -5 }, addFlags: [FLAG_WOUND] },
          },
          {
            weight: 14,
            text: "石棱在爪下断了。下坠的那一瞬很长，长到你听清了水声里没有你的名字。",
            effects: { die: "slain" },
          },
        ],
      },
      {
        label: "沿潭而行",
        outcomes: [
          {
            weight: 1,
            text: "你沿潭边绕过去。水汽扑了一身，凉，但一处伤都没添。",
            effects: { essence: { lin: 10 }, stats: { ling: 1 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-explore-firefly",
    trigger: {
      region: "qingqiu",
      actions: ["explore"],
      seasons: [1, 2],
      forbidsFlags: [FLAG_FIREFLY_LED],
      weight: 24,
    },
    title: "萤引",
    body: "入夜后，一点青萤从草里升起来，飘三步，停一停，像在等你。你跟了十几步才发现，草里还有别的萤，一点接一点，排成一条长得看不到头的线。",
    illustration: "events/qiu-explore-firefly.webp",
    illustrationBrief: `夜景草地上一串青萤连成蜿蜒光线，向画面深处延伸；${VT.self}立于线首回望，身上落着两点萤光。整体深暗，只靠萤光提亮。`,
    choices: [
      {
        label: "循萤而行",
        outcomes: [
          {
            weight: 62,
            text: "萤线尽头是一片开满白花的洼地，花下压着一层很厚的腐叶，暖得像穴。",
            effects: {
              essence: { lin: 16, xue: 6 },
              hunger: 6,
              addFlags: [FLAG_FIREFLY_LED],
            },
          },
          {
            weight: 38,
            text: "跟到半夜，萤忽然全灭了。你站在不认得的地方，等到天亮才认出路。",
            effects: { hunger: -8, stats: { ling: 2 } },
          },
        ],
      },
      {
        label: "捕而食之",
        outcomes: [
          {
            weight: 1,
            text: "萤在舌上碎了，青光在腮帮里亮了一下。这一夜再没有第二只飞起来。",
            effects: { essence: { lin: 6 }, stats: { de: -2 } },
          },
        ],
      },
      {
        label: "止步不前",
        outcomes: [
          {
            weight: 1,
            text: "你在原地看那条线一直亮到天明。它没有等你，也没有走。",
            effects: { essence: { lin: 8 }, stats: { ling: 1 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-explore-mulberry",
    trigger: { region: "qingqiu", actions: ["explore"], weight: 20 },
    title: "千年桑",
    body: "一株老桑独立在坡顶，树身要三兽合抱，枝上却只剩几片叶。树根处的土是暖的，暖得像底下睡着一个活物。你把耳朵贴上去，听见很慢很慢的一下、又一下。",
    illustration: "events/qiu-explore-mulberry.webp",
    illustrationBrief: `坡顶一株${VT.qiannianSang}孤立，枝干虬曲仅余数叶；${VT.self}伏在树根处侧头贴地倾听。天空大片留白，坡线简洁。`,
    choices: [
      {
        label: "掘其根下",
        requires: { organTags: [TAG_DIG] },
        outcomes: [
          {
            weight: 70,
            text: "根下盘着一团陈年的须，须里裹着一枚温热的卵，卵已经空了很久。",
            effects: { essence: { xue: 20, lin: 8 } },
          },
          {
            weight: 30,
            text: "掘到第三尺，土自己动了。你挖出来的不是根。",
            effects: { startCombat: ENEMY_XUAN_MANG },
          },
        ],
      },
      {
        label: "食其余叶",
        outcomes: [
          {
            weight: 1,
            text: "叶入口发苦，咽下去却回甘。老树的叶，吃一片少一片。",
            effects: { hunger: 10, essence: { lin: 8 } },
          },
        ],
      },
      {
        label: "倚树而息",
        outcomes: [
          {
            weight: 1,
            text: "你靠着树根睡了一觉。醒来时旧伤的痂自己脱了，底下是新肉。",
            effects: {
              hunger: 12,
              stats: { ling: 1, ti: 1 },
              removeFlags: [FLAG_WOUND],
            },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-explore-mang-den",
    trigger: { region: "qingqiu", actions: ["explore"], minYear: 2, weight: 16 },
    title: "蟒穴",
    body: "石隙里堆着一层蜕下的旧皮，薄如纸，长得看不到尽头。隙内很暗，暗处有一段极缓的呼吸，缓到你要屏住自己的呼吸才听得见。旧皮上没有灰——蜕下不久。",
    illustration: "events/qiu-explore-mang-den.webp",
    illustrationBrief: `近景石隙口堆叠成层的蛇蜕旧皮，半透明；隙内暗处隐约可见${VT.xuanmang}一段黑鳞身躯。${VT.self}在画面右下角贴地窥视。`,
    choices: [
      {
        label: "取其旧皮",
        outcomes: [
          {
            weight: 68,
            text: "你卷了一大团旧皮退出来。皮上的鳞气够你嚼很久。",
            effects: { essence: { lin: 14, xue: 8 } },
          },
          {
            weight: 32,
            text: "皮的那一头还连着没蜕完的身子。它转过头来，很慢。",
            effects: { startCombat: ENEMY_XUAN_MANG },
          },
        ],
      },
      {
        label: "挤入石隙",
        outcomes: [
          {
            weight: 1,
            text: "你把整个身子挤进石隙。里头的东西终于把最后一段旧皮蜕干净了。",
            effects: { startCombat: ENEMY_XUAN_MANG },
          },
        ],
      },
      {
        label: "缓退而出",
        outcomes: [
          {
            weight: 1,
            text: "你一步一步倒退出来，退到听不见那呼吸为止。这一季什么都没得到。",
            effects: { stats: { ling: 1 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-explore-mirror-pool",
    // 知道灵泉在哪的，才找得到与它同源的这一潭 —— FLAG_SPRING_KNOWN 在这里被读掉
    trigger: {
      region: "qingqiu",
      actions: ["explore"],
      minYear: 2,
      requiresFlags: [FLAG_SPRING_KNOWN],
      once: true,
      weight: 40,
    },
    title: "照影潭",
    body: "潭水静得不像水。你走近去看，水里那只兽比你大，牙比你长，额上的灵纹亮得刺眼。它抬头的时候你也抬了头，可它抬得比你早那么一瞬。",
    illustration: "events/qiu-explore-mirror-pool.webp",
    illustrationBrief: `俯视${VT.zhaoyingtan}水面倒影：岸上${VT.self}瘦小，水中倒影却是同一形貌放大、牙更长、额纹更亮的成兽。碎石环列，水面无波。`,
    choices: [
      {
        label: "认其为己",
        outcomes: [
          {
            weight: 1,
            text: "你对着水里那只点了点头。它也点头。从此你知道自己还能长成什么。",
            effects: { essence: { lin: 14 }, stats: { ling: 3, de: 2 } },
          },
        ],
      },
      {
        label: "以德映之",
        requires: { stats: { de: 30 } },
        outcomes: [
          {
            weight: 1,
            text: "水面忽然平了下去，映出的不再是兽形，而是一段你还没走过的路。",
            effects: {
              essence: { lin: 18 },
              stats: { ling: 4, de: 3 },
              lifespan: 1,
            },
          },
        ],
      },
      {
        label: "扑而击之",
        outcomes: [
          {
            weight: 1,
            text: "水花溅起，倒影碎成一片。等水静下来，里面那只的牙比刚才更长。",
            effects: { essence: { meng: 14 }, stats: { ti: -3, de: -2 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-explore-thunder-tree",
    trigger: { region: "qingqiu", actions: ["explore"], seasons: [1, 2], weight: 20 },
    title: "雷击木",
    body: "一株松被雷劈成两半，断口焦黑，里头还留着一股说不出的躁气。你走近三步，身上的毛就全立起来，牙根发麻，像有什么东西在皮下面找出口。",
    illustration: "events/qiu-explore-thunder-tree.webp",
    illustrationBrief: `背景为${VT.qiuHills}；中景一株松树被雷劈裂成两半，断口焦黑冒细烟；${VT.self}在数步外全身鬃毛竖立。天色铅灰，地面焦痕成放射状。`,
    choices: [
      {
        label: "食其焦心",
        outcomes: [
          {
            weight: 58,
            text: "焦木入腹，一股躁气顺脊背窜上头顶。三日之后你才敢合眼。",
            effects: { essence: { meng: 24 }, stats: { ti: -3 } },
          },
          {
            weight: 42,
            text: "刚咬下去，残余的雷气就在齿间炸开。半边脸麻了整整一季。",
            effects: { essence: { meng: 10 }, stats: { ti: -2 }, addFlags: [FLAG_WOUND] },
          },
        ],
      },
      {
        label: "以身受之",
        requires: { stats: { ti: 35 } },
        outcomes: [
          {
            weight: 1,
            text: "你伏在断口上，让那股躁气一寸寸走遍全身。走完之后，骨头是热的。",
            effects: { essence: { meng: 30, xue: 6 }, stats: { ti: 2, ling: 1 } },
          },
        ],
      },
      {
        label: "绕道避之",
        outcomes: [
          {
            weight: 1,
            text: "你绕出很远。那股躁气追了你半里，追不上，散了。",
            effects: { stats: { ling: 2 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-explore-crow-omen",
    trigger: { region: "qingqiu", actions: ["explore"], weight: 22 },
    title: "乌鸦示警",
    body: "一群乌鸦从林子那头炸开，绕着你叫了三圈，往南飞了。青丘的鸦从不多事——它们叫，是因为林子里有比你更饿的东西，而且那东西已经知道你在这里。",
    illustration: "events/qiu-explore-crow-omen.webp",
    illustrationBrief: `中景一群乌鸦自林梢炸起盘旋，剪影密集；林下${VT.self}停步仰头，身后林影深处一团模糊暗形。构图上重下轻，天色发白。`,
    choices: [
      {
        label: "往南避之",
        outcomes: [
          {
            weight: 1,
            text: "你跟着鸦群往南走了半日。身后什么也没有跟来——这次没有。",
            effects: { hunger: -4, stats: { ling: 2, de: 1 } },
          },
        ],
      },
      {
        label: "反行探之",
        outcomes: [
          {
            weight: 42,
            text: "林子深处有一具刚死的鹿，尸身尚温，颈上的咬口比你的嘴大一圈。",
            effects: { hunger: 20, essence: { meng: 12 } },
          },
          {
            weight: 36,
            text: "你找到了那东西。准确地说，是它让你找到的。",
            effects: { startCombat: ENEMY_SHAN_XIAO },
          },
          {
            weight: 22,
            text: "什么也没有，只有一片被压平的草，和一股散不掉的膻味。",
            effects: { essence: { xue: 10 }, stats: { ling: 1 } },
          },
        ],
      },
      {
        label: "循鸦拾余",
        outcomes: [
          {
            weight: 1,
            text: "你跟着鸦群捡它们吃剩的。饱是饱了，只是这顿吃得没什么滋味。",
            effects: { hunger: 14, stats: { de: -1 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-explore-empty-nest",
    trigger: { region: "qingqiu", actions: ["explore"], seasons: [0, 1], weight: 24 },
    title: "空巢遗卵",
    body: "高枝上的巢空了，巢里剩三枚卵，还是温的。母鸟的羽毛散在树下，散得很开，一直散到坡那边去。你数了数：三枚，每一枚都够你半日。",
    illustration: "events/qiu-explore-empty-nest.webp",
    illustrationBrief: `仰视高枝上一只鸟巢，巢中三枚卵；树下散落大量羽毛。${VT.self}已攀至半途，前爪扒住枝干抬头。清晨侧光，天空留白。`,
    choices: [
      {
        label: "三枚尽食",
        outcomes: [
          {
            weight: 1,
            text: "三枚一口气吃完，蛋液顺着下巴滴回巢里。三日不必再找食。",
            effects: { hunger: 26, essence: { zu: 12 }, stats: { de: -3 } },
          },
        ],
      },
      {
        label: "只食其一",
        outcomes: [
          {
            weight: 1,
            text: "只取一枚，另两枚拢回巢心。你也说不清留着给谁。",
            effects: { hunger: 12, essence: { zu: 4 }, stats: { ling: 1, de: 1 } },
          },
        ],
      },
      {
        label: "覆巢而去",
        outcomes: [
          {
            weight: 1,
            text: "你把巢往枝桠深处推了推，让风吹不着。饿着下的树。",
            effects: { stats: { de: 4, ling: 1 }, addFlags: [FLAG_MERCY] },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-explore-stone-forest",
    trigger: { region: "qingqiu", actions: ["explore"], weight: 22 },
    title: "石林",
    body: "一片直立的青石，高矮如林，风穿过去有人说话的声音。石面上凿着许多小坑，坑里积着雨水，水面浮着不知多少年的灰。凿坑的东西没留下别的痕迹。",
    illustration: "events/qiu-explore-stone-forest.webp",
    illustrationBrief: `广角${VT.shilin}纵深排列，石柱高矮参差；${VT.self}行于石柱之间，体量极小。风起，坑中积水微漾。天光斜射形成长影。`,
    choices: [
      {
        label: "饮坑中水",
        outcomes: [
          {
            weight: 66,
            text: "水有股铁锈味，喝下去却清爽。石坑一个接一个，你喝了七个。",
            effects: { hunger: 8, essence: { xue: 10 } },
          },
          {
            weight: 34,
            text: "第三个坑里的水是坏的。你在石林里吐了半日，声音传得很远。",
            effects: { stats: { ti: -2 }, addFlags: [FLAG_SICK] },
          },
        ],
      },
      {
        label: "循声而行",
        requires: { stats: { ling: 20 } },
        outcomes: [
          {
            weight: 1,
            text: "你顺着风声走到石林中心，那里的石坑排成一个你看不懂但记得住的形状。",
            effects: { essence: { lin: 16, xue: 4 }, stats: { ling: 3 } },
          },
        ],
      },
      {
        label: "磨爪于石",
        outcomes: [
          {
            weight: 1,
            text: "你在青石上磨了一整季的爪。磨完那天，石上多了你自己的一道痕。",
            effects: { essence: { meng: 10 }, stats: { meng: 2 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-explore-fox-grave",
    trigger: { region: "qingqiu", actions: ["explore"], weight: 20 },
    title: "野狐坟",
    body: "土坡上有一排小丘，每丘前压着一块白石。你嗅得出丘下都是狐，死了很久，骨头一律朝着丘外摆。其中有一丘的土是新的，新到还能闻出翻土者的气味。",
    illustration: "events/qiu-explore-fox-grave.webp",
    illustrationBrief: `中景${VT.huGrave}成排列于缓坡，白石整齐；最近的一丘土色新鲜。${VT.self}立于新丘前低头嗅探。暮色，坡后天空留大片空白。`,
    choices: [
      {
        label: "掘新土者",
        outcomes: [
          {
            weight: 58,
            text: "土下的狐还没凉透，颈上一道很干净的咬口。你吃了，也记住了那道口。",
            effects: { hunger: 18, essence: { xue: 16 }, stats: { de: -4 } },
          },
          {
            weight: 42,
            text: "爪子刚沾土，坡后就绕出一头瘦狐。它没有叫，只是走过来。",
            effects: { startCombat: ENEMY_CAO_HU },
          },
        ],
      },
      {
        label: "以爪覆土",
        requires: { stats: { de: 20 } },
        outcomes: [
          {
            weight: 1,
            text: "你把新丘的土重新拢好，压上白石。做完时，坡后有什么东西低低应了一声。",
            effects: {
              essence: { lin: 10 },
              stats: { de: 5, ling: 1 },
              addFlags: [FLAG_FOX_ALLY],
            },
          },
        ],
      },
      {
        label: "伏而不动",
        outcomes: [
          {
            weight: 1,
            text: "你在坟边趴到天亮，什么也没做。天亮时坡上多了几串脚印，绕开了你。",
            effects: { stats: { de: 3, ling: 1 }, addFlags: [FLAG_FOX_ALLY] },
          },
        ],
      },
    ],
  },
];
