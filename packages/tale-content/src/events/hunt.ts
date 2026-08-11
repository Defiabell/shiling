/**
 * 狩猎事件（12）—— `trigger.actions: ["hunt"]`。
 *
 * 这一池的主题是**饱腹的代价**：几乎每个诱人选项都拿德、伤病或一场真打去换食物。
 * 稳妥选项从不空手（至少给一点灵或德），但也从不解决饥饿 —— 让「今天吃不吃这口」
 * 始终是个真问题。
 */

import type { TaleEvent } from "@shiling/tale-sim";
import { ENEMY_CAO_HU, ENEMY_SHAN_XIAO, ENEMY_YE_ZHI } from "../enemies.js";
import { FLAG_FOX_ALLY, FLAG_HUNTED, FLAG_MERCY, FLAG_SICK, FLAG_WOUND } from "../flags.js";
import {
  TAG_ARMOR,
  TAG_DIG,
  TAG_DRAGON_KIN,
  TAG_FANG,
  TAG_FAR_SIGHT,
  TAG_NIGHT_EYE,
  TAG_PIERCE,
  TAG_SWIM,
  TAG_VENOM,
} from "../tags.js";
import { VT } from "../visualTokens.js";

export const HUNT_EVENTS: readonly TaleEvent[] = [
  {
    id: "qiu-hunt-thicket",
    trigger: { region: "qingqiu", actions: ["hunt"], weight: 34 },
    title: "丛中窥影",
    body: "追踪的血迹断在一片棘丛前。丛内有物在动，压得枝叶簌簌作响，却始终不肯出来。你伏在下风处等了半刻，那声响不急不缓，像是知道你在等。",
    illustrationBrief: `近景一片密棘丛占画面右半，枝叶缝里只透出一团看不清形状的暗影；左下角${VT.self}伏地，耳朵朝向棘丛。薄雾，光自左后斜来，留白在上方。`,
    choices: [
      {
        label: "破丛而入",
        outcomes: [
          {
            weight: 58,
            text: "棘刺划开皮肉的同时，一只野雉自丛心炸起。",
            effects: { startCombat: ENEMY_YE_ZHI },
          },
          {
            weight: 42,
            text: "丛心蹲的不是猎物。它先看清了你，才慢慢站起来。",
            effects: { startCombat: ENEMY_CAO_HU },
          },
        ],
      },
      {
        label: "绕至上风",
        requires: { organTags: [TAG_FAR_SIGHT, TAG_NIGHT_EYE] },
        outcomes: [
          {
            weight: 1,
            text: "隔着雾看清了丛中之物，也看清了它身后那条被踩熟的旧路。",
            effects: { essence: { lin: 12 }, stats: { ling: 1 } },
          },
        ],
      },
      {
        label: "弃之而去",
        outcomes: [
          {
            weight: 1,
            text: "退开三十步，把那片棘丛留给它。饿着，但还整着。",
            effects: { stats: { ling: 1 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-hunt-fawn",
    trigger: { region: "qingqiu", actions: ["hunt"], weight: 26 },
    title: "幼鹿哀鸣",
    body: "泥泞里陷着一头幼鹿，后腿折了，见你来反而不叫了，只把头往草里埋。它的母亲还在坡上打转，喉里发出你听不懂的调子。血腥气很淡，风把它压在低处，只有你闻得见。",
    illustrationBrief: `中景泥沼里一头折了后腿的幼鹿低头埋进草中，坡上远处一头母鹿侧身回望；${VT.self}立于近景左侧，只见半身与压低的头。黄昏，泥面反光。`,
    choices: [
      {
        label: "取其咽喉",
        outcomes: [
          {
            weight: 1,
            text: "很快，也很静。母鹿在坡上叫了整整一夜，你听着，睡得很沉。",
            effects: { hunger: 30, essence: { zu: 14 }, stats: { de: -4 } },
          },
        ],
      },
      {
        label: "驱母鹿而食",
        requires: { stats: { meng: 25 } },
        outcomes: [
          {
            weight: 1,
            text: "先撞开母鹿，再回头收拾小的。青丘的规矩本来就是这样。",
            effects: { hunger: 40, essence: { meng: 12, zu: 8 }, stats: { de: -8 } },
          },
        ],
      },
      {
        label: "让开一步",
        outcomes: [
          {
            weight: 1,
            text: "你绕过泥沼往下风去。身后母鹿下坡的蹄声很急，急得难听。",
            effects: { stats: { de: 5, ling: 1 }, addFlags: [FLAG_MERCY] },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-hunt-carrion",
    trigger: { region: "qingqiu", actions: ["hunt"], weight: 30 },
    title: "腐肉之宴",
    body: "沟底一具鹿骸，皮肉半烂，蝇声如沸。空了三日的胃在叫，可那气味里除了腐还有别的东西，隐隐发甜——青丘的老兽说，发甜的肉不能碰。你不是老兽。",
    illustrationBrief: `俯视沟底一具半烂鹿骸，蝇群成一层薄雾般的黑点；${VT.self}立在沟沿探头下望，姿态犹豫。光线阴沉，画面下三分之一留给阴影。`,
    choices: [
      {
        label: "饱食一顿",
        outcomes: [
          {
            weight: 58,
            text: "吃到骨头露出来为止。腐味在舌上散开，竟有些像蜜。",
            effects: { hunger: 34, essence: { xue: 8 } },
          },
          {
            weight: 42,
            text: "夜里腹如翻浪，吐了三回，吐到最后只剩黄水。",
            effects: { hunger: 22, stats: { ti: -3 }, addFlags: [FLAG_SICK] },
          },
        ],
      },
      {
        label: "只取骨髓",
        requires: { organTags: [TAG_FANG, TAG_PIERCE] },
        outcomes: [
          {
            weight: 1,
            text: "咬开腿骨，吮尽其中。烂的都在外头，里头是干净的。",
            effects: { hunger: 20, essence: { xue: 10 } },
          },
        ],
      },
      {
        label: "掩鼻而去",
        outcomes: [
          {
            weight: 1,
            text: "你记住了那股甜味，以后遇见它便绕开。这也算学了一样。",
            effects: { stats: { ling: 2 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-hunt-snare",
    trigger: { region: "qingqiu", actions: ["hunt"], weight: 22, forbidsFlags: [FLAG_HUNTED] },
    title: "绳套",
    body: "兽径当中横着一根麻绳，绳头系在弯下的树梢上，绳圈里搁着半块熏肉。你从没见过这样规整的东西——它太直了，直得不像山里长出来的。可肉香是真的。",
    illustrationBrief: `近景${VT.shengTao}横在窄兽径中央，绳索绷得笔直；${VT.self}在三步外压低身子嗅探。林间斜光打亮熏肉，其余处偏暗。`,
    choices: [
      {
        label: "取肉而食",
        outcomes: [
          {
            weight: 62,
            text: "肉到口中，绳圈从颈侧擦过。你逃得快，可这条径从此有人认得你。",
            effects: { hunger: 24, addFlags: [FLAG_HUNTED] },
          },
          {
            weight: 38,
            text: "树梢弹起，绳勒住后腿。挣了半日才脱，皮肉翻开一片。",
            effects: { hunger: 12, stats: { ti: -5 }, addFlags: [FLAG_WOUND, FLAG_HUNTED] },
          },
        ],
      },
      {
        label: "咬断绳索",
        requires: { organTags: [TAG_FANG] },
        outcomes: [
          {
            weight: 1,
            text: "先断绳，再吃肉。断口留给下山的人看，让他们自己想。",
            effects: { hunger: 24, essence: { meng: 8 }, stats: { de: 1 } },
          },
        ],
      },
      {
        label: "远远绕开",
        outcomes: [
          {
            weight: 1,
            text: "你从坡上绕了一大圈。这一季少吃一顿，多认得一样东西。",
            effects: { stats: { ling: 2 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-hunt-beehive",
    trigger: { region: "qingqiu", actions: ["hunt"], seasons: [1, 2], weight: 24 },
    title: "石蜂之巢",
    body: "崖壁裂缝里嵌着一团灰白的巢，蜜色顺着石纹往下淌，蜂群在洞口结成一片薄薄的云。甜味很重，重到让你一时想不起来疼是什么滋味。",
    illustrationBrief: `仰视崖壁一道裂缝中的${VT.shifeng}，蜜色沿石纹垂流，蜂群如薄云绕巢；崖下${VT.self}仰头，前爪已搭上石棱。正午强光。`,
    choices: [
      {
        label: "破巢取蜜",
        outcomes: [
          {
            weight: 55,
            text: "蜜灌满了整个口腔，蜂尾扎在鼻梁上，甜与痛一起来。",
            effects: { hunger: 30, stats: { ti: -2 } },
          },
          {
            weight: 45,
            text: "整片云都落在你身上。滚下崖时，嘴里还是甜的。",
            effects: { hunger: 20, stats: { ti: -4 }, addFlags: [FLAG_WOUND] },
          },
        ],
      },
      {
        label: "以甲当之",
        requires: { organTags: [TAG_ARMOR] },
        outcomes: [
          {
            weight: 1,
            text: "蜂针撞在鳞上，如雨落瓦。你从容取尽，一路舔到崖下。",
            effects: { hunger: 34, essence: { xue: 10 } },
          },
        ],
      },
      {
        label: "候夜而取",
        requires: { organTags: [TAG_NIGHT_EYE] },
        outcomes: [
          {
            weight: 1,
            text: "夜里蜂皆归巢不动。你在黑里看得比白日还清楚。",
            effects: { hunger: 28, essence: { xue: 8 }, stats: { ling: 1 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-hunt-fishpool",
    trigger: { region: "qingqiu", actions: ["hunt"], seasons: [0, 1, 2], weight: 26 },
    title: "浅滩鳞影",
    body: "溪水拐弯处积成一潭，潭底压着一片游动的银亮。水冷得刺骨，深处望不见底，可那些鳞光就在两尺之下，看着一伸爪就能够到。看着而已。",
    illustrationBrief: `水面视角，潭底数尾${VT.wenyao}银鳞成群游动；${VT.self}立在浅滩石上，一只前爪已探入水中，水面漾开圈纹。清晨，水色偏青。`,
    choices: [
      {
        label: "涉水扑之",
        outcomes: [
          {
            weight: 58,
            text: "扑了七八回，湿透，得鱼两尾。冷得发抖，也算值。",
            effects: { hunger: 20, essence: { lin: 12 } },
          },
          {
            weight: 42,
            text: "脚下石滑，呛了一口冷水，鱼群一晃就没了影。",
            effects: { stats: { ti: -3 } },
          },
        ],
      },
      {
        label: "潜入深处",
        requires: { organTags: [TAG_SWIM] },
        outcomes: [
          {
            weight: 1,
            text: "沉到潭底，才知那片银亮下面还压着更大的一群。",
            effects: { hunger: 26, essence: { lin: 24 } },
          },
        ],
      },
      {
        label: "守在浅处",
        outcomes: [
          {
            weight: 1,
            text: "只在浅滩截了一尾落单的。不多，但一根毛都没湿。",
            effects: { hunger: 10, essence: { lin: 6 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-hunt-vulture",
    trigger: { region: "qingqiu", actions: ["hunt"], weight: 24 },
    title: "秃鹫争食",
    body: "你按倒的东西还热着，三只秃鹫已落在旁边枯枝上，一动不动地看你。它们不急。它们知道你要走，也知道你一次带不走多少，剩下的迟早是它们的。",
    illustrationBrief: `中景枯枝上三只秃鹫并列俯视，姿态静止；地面${VT.self}压着一头猎物抬头对峙。逆光，枝与鸟近乎剪影，地面留一小片亮部。`,
    choices: [
      {
        label: "驱而独食",
        outcomes: [
          {
            weight: 68,
            text: "你冲了三次，它们退了三次，又落回原处。肉终究是你先吃的。",
            effects: { hunger: 26, essence: { zu: 6, meng: 4 } },
          },
          {
            weight: 32,
            text: "扑空一次，翅膀扇在眼上。等你睁开眼，肉已被撕去一半。",
            effects: { hunger: 12, stats: { ti: -2 } },
          },
        ],
      },
      {
        label: "以毒示之",
        requires: { organTags: [TAG_VENOM] },
        outcomes: [
          {
            weight: 1,
            text: "你朝枯枝喷了一线腥液。三只一齐起飞，再没落下来。",
            effects: { hunger: 28, essence: { meng: 10 } },
          },
        ],
      },
      {
        label: "分而食之",
        outcomes: [
          {
            weight: 1,
            text: "你只取了腹脏，其余留着。秃鹫落下来时，没有一只叫。",
            effects: { hunger: 16, stats: { de: 3 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-hunt-burrow",
    trigger: { region: "qingqiu", actions: ["hunt"], weight: 26 },
    title: "穴中有声",
    body: "草根下的土是新翻的，爪子一探，底下空空作响。那声音往深处退，退到你听不见为止，只留一股温热的土腥气从洞口慢慢漫出来。里头不止一只。",
    illustrationBrief: `低角度近景一处新翻土的洞口，土粒散落；${VT.self}前爪按在洞沿低头细听，耳朵前倾。画面右侧一只${VT.xueshu}的尾巴刚没入土中。`,
    choices: [
      {
        label: "掘而取之",
        requires: { organTags: [TAG_DIG] },
        outcomes: [
          {
            weight: 1,
            text: "掘了一夜，掏空了整条地道，连巢里的幼崽都没剩下。",
            effects: { hunger: 26, essence: { xue: 20 } },
          },
        ],
      },
      {
        label: "以精气震之",
        requires: { essenceMin: { xue: 30 } },
        outcomes: [
          {
            weight: 1,
            text: "你把穴之精气按进土里，地下一阵闷响，鼠群自己涌了出来。",
            effects: { hunger: 34, essence: { xue: -30, meng: 6 }, stats: { ti: 2 } },
          },
        ],
      },
      {
        label: "守洞待之",
        outcomes: [
          {
            weight: 52,
            text: "守到月落，终于有一只探出头来。就一只。",
            effects: { hunger: 16, essence: { xue: 8 } },
          },
          {
            weight: 48,
            text: "守了整整一季，土里再没动静。它们另开了口子。",
            effects: { stats: { ling: 1 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-hunt-fox-steal",
    // 与野狐结过盟就不会再被同类夺食 —— FLAG_FOX_ALLY 在这里被读掉
    trigger: { region: "qingqiu", actions: ["hunt"], weight: 24, forbidsFlags: [FLAG_FOX_ALLY] },
    title: "草狐夺食",
    body: "你正低头进食，一头草狐从侧面窜出来，咬住猎物的另一头往回拖。它比你瘦，眼睛比你亮，牙齿也不见得比你短。两边都不肯松口，肉在中间被扯得咯咯响。",
    illustrationBrief: `中景${VT.self}与${VT.caohu}各咬猎物一端相持，四足抵地，尘土微扬；两兽头部齐平对视。侧逆光，背景是枯草坡。`,
    choices: [
      {
        label: "夺而斗之",
        outcomes: [
          {
            weight: 1,
            text: "它先松的口——松口不是为了让，是为了咬你。",
            effects: { startCombat: ENEMY_CAO_HU },
          },
        ],
      },
      {
        label: "诈作弃食",
        requires: { stats: { ling: 25 } },
        outcomes: [
          {
            weight: 68,
            text: "你松口退开，它埋头就吃。它埋头的那一刻，你从背后绕了回来。",
            effects: { hunger: 24, essence: { meng: 10, zu: 4 } },
          },
          {
            weight: 32,
            text: "它没上当，反而叼着肉退进灌木，边退边盯着你。",
            effects: { hunger: 6, stats: { ling: 1 } },
          },
        ],
      },
      {
        label: "松口相让",
        outcomes: [
          {
            weight: 1,
            text: "你松口退开。它吃剩的那点，你等到天黑才回去舔干净。",
            effects: { hunger: 8, stats: { de: 2 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-hunt-moon-hare",
    trigger: { region: "qingqiu", actions: ["hunt"], seasons: [2, 3], once: true, weight: 30 },
    title: "月下白兔",
    body: "月色最亮的那一夜，草坡上蹲着一只通体雪白的兔，不逃，也不看你。它耳后有一道旧疤，像是被什么东西咬住过又放开了。风停了，草也不动。",
    illustrationBrief: `夜景全月下的白草坡，${VT.baiTu}端坐正中不动；${VT.self}自画面左侧低身逼近，只见轮廓。月光把两者影子拉向同一侧，大面积留白给天空。`,
    choices: [
      {
        label: "扑而食之",
        outcomes: [
          {
            weight: 76,
            text: "一口咬断。肉是暖的，可你吃完之后，月色好像暗了一层。",
            effects: { hunger: 24, essence: { zu: 16 }, stats: { de: -2 } },
          },
          {
            weight: 24,
            text: "爪下一空，白兔化作一缕白气散了，只余耳后那道疤留在草上。",
            effects: { essence: { lin: 20 }, stats: { ling: 2 } },
          },
        ],
      },
      {
        label: "以灵视之",
        requires: { stats: { ling: 30 } },
        outcomes: [
          {
            weight: 1,
            text: "你看清了那不是兔，是某个更老的东西借了兔的形。它对你点了点头。",
            effects: { essence: { lin: 18 }, stats: { ling: 3, de: 2 }, lifespan: 1 },
          },
        ],
      },
      {
        label: "任其自去",
        outcomes: [
          {
            weight: 1,
            text: "你绕开了那片月光。走出很远，回头看它还坐在原处。",
            effects: { essence: { lin: 8 }, stats: { de: 3, ling: 1 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-hunt-shanxiao-road",
    trigger: { region: "qingqiu", actions: ["hunt"], minYear: 3, weight: 16 },
    title: "山魈拦路",
    body: "岩影里立着一个人形的东西，赤面无毛，两臂过膝。它把你按倒的猎物提起来看了看，随手扔在一边，然后转过脸来看你。它看你的样子，和你看猎物时一样。",
    illustrationBrief: `中景巨岩阴影中${VT.shanxiao}直立，一手垂着刚扔下的猎物；${VT.self}在画面下缘压低前身，鬃毛竖起。天光只从岩顶漏下一线。`,
    choices: [
      {
        label: "先发扑之",
        outcomes: [
          {
            weight: 1,
            text: "你先动的手。它笑了一声，那声音不像兽，也不像人。",
            effects: { startCombat: ENEMY_SHAN_XIAO },
          },
        ],
      },
      {
        label: "以龙吟慑之",
        requires: { organTags: [TAG_DRAGON_KIN] },
        outcomes: [
          {
            weight: 1,
            text: "喉中一声闷响滚过岩壁。它退了两步，把猎物又推回你脚边。",
            effects: { essence: { meng: 20 }, stats: { de: 2 } },
          },
        ],
      },
      {
        label: "缓步而退",
        outcomes: [
          {
            weight: 64,
            text: "你一步一步退到岩外。它始终没追，只是看着，直到你转过山脊。",
            effects: { stats: { ling: 2 } },
          },
          {
            weight: 36,
            text: "退到第五步时，它动了。原来它等的就是你转身。",
            effects: { startCombat: ENEMY_SHAN_XIAO },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-hunt-first-blood",
    trigger: { region: "qingqiu", actions: ["hunt"], maxYear: 2, once: true, weight: 55 },
    title: "初猎",
    body: "你第一次追上活物。它在爪下挣得很凶，喉咙里咕噜作响，热的血溅在脸上，甜得让你发抖。这一刻你忽然明白自己是什么——不是吃草的那种，是另一种。",
    illustrationBrief: `近景${VT.self}压住一只${VT.yezhi}，口鼻沾血，双眼睁大；羽毛四散飞起。构图紧凑，背景虚化成一片枯黄。`,
    choices: [
      {
        label: "尽食其精气",
        outcomes: [
          {
            weight: 1,
            text: "你连骨带髓一并吞了，连那点惊惧也吞了。腹中有热东西在走。",
            effects: { hunger: 22, essence: { meng: 14, zu: 10 }, stats: { de: -2 } },
          },
        ],
      },
      {
        label: "只取饱腹",
        outcomes: [
          {
            weight: 1,
            text: "吃到不饿就停了手。剩下的埋进土里，你也说不清为什么要埋。",
            effects: { hunger: 32, essence: { zu: 6 }, stats: { de: 2 } },
          },
        ],
      },
      {
        label: "追而不杀",
        requires: { stats: { ling: 15 } },
        outcomes: [
          {
            weight: 1,
            text: "你松开爪子，看它跌撞着逃走。饿是真饿，可你记住了它跑的样子。",
            effects: { essence: { zu: 14, lin: 6 }, stats: { ling: 2, de: 2 } },
          },
        ],
      },
    ],
  },
];
