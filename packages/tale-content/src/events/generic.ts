/**
 * 通用／季节事件（8）—— 不限行动（`trigger.actions` 缺省），任何一季都可能撞上。
 *
 * 七条按 `seasons` 分布（春 2／夏 1／秋 2／冬 2），把一年四季的节奏做出来：春汛与野蓂是
 * 机会，夏旱与冬雪是压力，秋天最肥也最招人。第八条是「天命」—— 唯一的登神出口，靠引擎
 * 的 `sys:ascend-ready` flag 入池（year≥15 且器官≥5 且 ling≥60 且 de≥40），
 * 内容侧只读不写这个 flag。
 *
 * 冬季两条刻意最狠：「冬雪封山」的贪心选项直接挂 `die: "starve"` 兜底，
 * 「穷奇夜至」把全库最硬的敌人放在饿得最惨的那一季。
 */

import type { TaleEvent } from "@shiling/tale-sim";
import { SYS_FLAG_ASCEND_READY } from "@shiling/tale-sim";
import { ENEMY_CAO_HU, ENEMY_QIONG_QI } from "../enemies.js";
import { FLAG_HUNTED, FLAG_SICK, FLAG_WOUND } from "../flags.js";
import { TAG_ARMOR, TAG_DIG, TAG_NIGHT_EYE, TAG_SWIM, TAG_TOUGH } from "../tags.js";
import { VT } from "../visualTokens.js";

export const GENERIC_EVENTS: readonly TaleEvent[] = [
  {
    id: "qiu-spring-flood",
    trigger: { region: "qingqiu", seasons: [0], weight: 26 },
    title: "春汛",
    body: "雪水一夜之间灌满了谷，旧路全在水下。水里漂着上游冲下来的东西：断枝、死鱼、一头肿胀的鹿，还有别的什么在水底慢慢地走，走得比水还慢。",
    illustration: "events/qiu-spring-flood.webp",
    illustrationBrief: `广角浑黄洪水漫过谷地，水面浮断枝与一头肿胀的鹿尸；${VT.self}立于半淹的高石上俯视水面。天色灰白，远景为${VT.qiuHills}。`,
    choices: [
      {
        label: "涉水取食",
        outcomes: [
          {
            weight: 56,
            text: "你拖回那头鹿的一条后腿。水冷，肉冷，可这一季不必再愁。",
            effects: { hunger: 24, essence: { lin: 8, zu: 4 } },
          },
          {
            weight: 44,
            text: "水下有暗流把你卷了两个回旋。爬上岸时，嘴里全是泥沙。",
            effects: { hunger: 8, stats: { ti: -4 } },
          },
        ],
      },
      {
        label: "浮而渡之",
        requires: { organTags: [TAG_SWIM] },
        outcomes: [
          {
            weight: 1,
            text: "你在浊水里浮沉自如，一路捡食漂来的死鱼，直到对岸。",
            effects: { hunger: 28, essence: { lin: 20 } },
          },
        ],
      },
      {
        label: "登高避水",
        outcomes: [
          {
            weight: 1,
            text: "你在坡顶蹲了整整一季，看水把青丘改了模样。饿，但看得很清楚。",
            effects: { hunger: -4, stats: { ling: 2, de: 1 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-spring-sprout",
    trigger: { region: "qingqiu", seasons: [0], weight: 28 },
    title: "野蓂初生",
    body: "涧边石隙里钻出一丛蓂草，叶背泛着极淡的青光。凡草不该有这样的光。你伏下身去闻，气味又腥又甜，像血，也像熟透到快要烂掉的果子。",
    illustration: "events/qiu-spring-sprout.webp",
    illustrationBrief: `近景石隙间一丛蓂草，叶背透出极淡青光；${VT.self}俯身贴近嗅闻，鼻尖几乎触叶。早春残雪未化，背景简净，右上留白。`,
    choices: [
      {
        label: "循香而食",
        outcomes: [
          {
            weight: 68,
            text: "草汁入喉，一股暖意自腹中散开，散到四肢的末梢。",
            effects: { hunger: 12, essence: { zu: 10 } },
          },
          {
            weight: 32,
            text: "草性阴寒，腹中绞痛了半日才止。此后你见了青光就绕。",
            effects: { hunger: 4, stats: { ti: -2 } },
          },
        ],
      },
      {
        label: "以灵息养之",
        requires: { stats: { ling: 20 } },
        outcomes: [
          {
            weight: 1,
            text: "灵息与草光相引，青芒盛而复敛，最后尽数落进你的识海。",
            effects: { essence: { lin: 20 }, stats: { ling: 2 } },
          },
        ],
      },
      {
        label: "以足精催之",
        requires: { essenceMin: { zu: 30 } },
        outcomes: [
          {
            weight: 1,
            text: "精气灌下去，草茎暴长三尺，结出一枚赤果。食之，筋骨咯咯作响。",
            effects: { essence: { zu: -30 }, hunger: 10, stats: { meng: 3, ti: 1 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-summer-drought",
    trigger: { region: "qingqiu", seasons: [1], weight: 26 },
    title: "夏旱",
    body: "三个月没有雨。溪只剩一线，泥裂成龟纹，走得动的兽都走了。剩下的都挤在同一处饮水，谁也不敢先低头——低头的那一刻，脖子就交给别人了。",
    illustration: "events/qiu-summer-drought.webp",
    illustrationBrief: `中景干涸溪床龟裂，仅余一线细流；数头瘦兽围成半圈互相戒备，其中一头是${VT.yanyang}，${VT.self}在另一侧压低身体。烈日当空，光线惨白，影子极短。`,
    choices: [
      {
        label: "争而先饮",
        outcomes: [
          {
            weight: 58,
            text: "你先低的头，也先龇的牙。水是喝到了，喝得满嘴是泥。",
            effects: { hunger: 10, essence: { meng: 10 } },
          },
          {
            weight: 42,
            text: "有一头比你更渴，也比你更瘦。瘦的东西下嘴最狠。",
            effects: { startCombat: ENEMY_CAO_HU },
          },
        ],
      },
      {
        label: "掘沙取水",
        requires: { organTags: [TAG_DIG] },
        outcomes: [
          {
            weight: 1,
            text: "你在溪床下掘出一汪清水。别的兽远远看着，谁都没敢过来。",
            effects: { hunger: 16, essence: { xue: 14 } },
          },
        ],
      },
      {
        label: "让众兽先饮",
        outcomes: [
          {
            weight: 1,
            text: "你退到最后。水浑了，也浅了，可那一夜没有一头兽朝你龇牙。",
            effects: { hunger: -6, stats: { de: 4, ling: 1 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-autumn-fruit",
    trigger: { region: "qingqiu", seasons: [2], weight: 28 },
    title: "秋实",
    body: "满山的果都熟了，红的紫的压弯了枝，落在地上积成一层，踩上去出水。这是青丘一年里最不必挨饿的一季，也是最容易忘事的一季——忘了自己也是别人的食物。",
    illustration: "events/qiu-autumn-fruit.webp",
    illustrationBrief: `广角结满红紫果实的林坡，地面落果堆积；${VT.self}埋头进食于画面中央，林影深处有一双反光的眼睛。秋阳暖色，构图饱满。`,
    choices: [
      {
        label: "尽食而积",
        outcomes: [
          {
            weight: 1,
            text: "你吃到走不动，又把剩下的埋在三处不同的石下。冬天会记得的。",
            effects: { hunger: 34, stats: { ti: 1 } },
          },
        ],
      },
      {
        label: "食而不忘守",
        requires: { stats: { ling: 25 } },
        outcomes: [
          {
            weight: 1,
            text: "你背靠石壁进食，一双耳朵始终对着林子。那双眼睛终于退走了。",
            effects: { hunger: 26, essence: { lin: 10 }, stats: { ling: 2 } },
          },
        ],
      },
      {
        label: "循果诱兽",
        outcomes: [
          {
            weight: 62,
            text: "落果引来的东西比果子好吃。你在果堆边守了两夜，得手一次。",
            effects: { hunger: 30, essence: { meng: 12, zu: 6 } },
          },
          {
            weight: 38,
            text: "你守着果堆，别的东西守着你。谁先动，谁就是猎物。",
            effects: { startCombat: ENEMY_CAO_HU },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-autumn-fire",
    trigger: { region: "qingqiu", seasons: [2], weight: 24 },
    title: "秋猎之火",
    body: "南坡起了火，不是天火——火线是直的，一路推着往北走。烟里混着人声、犬吠和铜器相击的响动。风正往你这边吹，火也是。你没有多少时间挑方向。",
    illustration: "events/qiu-autumn-fire.webp",
    illustrationBrief: `远中景一道笔直火线横贯南坡，浓烟压低；烟后隐约可见${VT.lieren}举火成列。近景${VT.self}回头逆火奔逃，鬃毛被热风掀起。`,
    choices: [
      {
        label: "逆火而奔",
        outcomes: [
          {
            weight: 58,
            text: "你贴着火线的边缘冲了出去，尾梢烧焦一截，命还整着。",
            effects: { essence: { zu: 18 }, addFlags: [FLAG_HUNTED] },
          },
          {
            weight: 42,
            text: "热浪扑面，你在滚烫的灰里滚了两圈才冲出来。背上一片焦。",
            effects: { stats: { ti: -6 }, addFlags: [FLAG_WOUND, FLAG_HUNTED] },
          },
        ],
      },
      {
        label: "入水避之",
        requires: { organTags: [TAG_SWIM] },
        outcomes: [
          {
            weight: 1,
            text: "你沉在溪里只留鼻孔在外，听火从头顶过去。水面浮着一层黑灰。",
            effects: { essence: { lin: 14 }, hunger: -4 },
          },
        ],
      },
      {
        label: "伏于土下",
        requires: { organTags: [TAG_DIG] },
        outcomes: [
          {
            weight: 1,
            text: "你掘了一个刚够容身的坑，把自己埋进去。火从背上走过，土是热的。",
            effects: { essence: { xue: 16 } },
          },
        ],
      },
      {
        label: "冒烟而行",
        outcomes: [
          {
            weight: 52,
            text: "你在浓烟里穿了过去。烟熏得眼睛流泪，但没有一个人看见你。",
            effects: { essence: { meng: 12 }, stats: { ling: 1 } },
          },
          {
            weight: 48,
            text: "烟灌进肺里，咳了整整一季，咳出来的东西是黑的。",
            effects: { stats: { ti: -3 }, addFlags: [FLAG_SICK] },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-winter-snow",
    trigger: { region: "qingqiu", seasons: [3], weight: 30 },
    title: "冬雪封山",
    body: "雪把青丘盖成一片白，兽径全断了。你走一步陷半尺，鼻子里只剩雪的味道，闻不到任何活物。这样的日子还有很长，长到你数不出来还剩几个夜。",
    illustration: "events/qiu-winter-snow.webp",
    illustrationBrief: `广角大雪覆盖的${VT.qiuHills}，天地皆白，只余几处黑石与枯枝；${VT.self}在雪中深一脚浅一脚，身后一串孤零零的足迹。极简构图，大面积留白。`,
    choices: [
      {
        label: "掘雪寻食",
        requires: { organTags: [TAG_DIG] },
        outcomes: [
          {
            weight: 1,
            text: "你顺着记忆掘开旧径，翻出几只冻僵的鼠。冻硬的肉也是肉。",
            effects: { hunger: 22, essence: { xue: 12 } },
          },
        ],
      },
      {
        label: "拥鬃而伏",
        requires: { organTags: [TAG_ARMOR, TAG_TOUGH] },
        outcomes: [
          {
            weight: 1,
            text: "你把自己蜷成一团，任雪埋过背脊。硬鬃底下，热一点没漏。",
            effects: { hunger: 8, essence: { meng: 8 }, stats: { ti: 1 } },
          },
        ],
      },
      {
        label: "伏而少动",
        outcomes: [
          {
            weight: 1,
            text: "不动就不饿得那么快。你在石隙里躺了一季，听自己的心跳变慢。",
            effects: { hunger: 10, stats: { ling: 1 } },
          },
        ],
      },
      {
        label: "冒雪远猎",
        outcomes: [
          {
            weight: 46,
            text: "走了三日，终于撞见一头陷在雪里的岩羊。它比你更走不动。",
            effects: { hunger: 28, essence: { zu: 14, meng: 6 } },
          },
          {
            weight: 34,
            text: "什么也没有。回程时一只前爪冻坏了，走一步疼一步。",
            effects: { hunger: -6, stats: { ti: -5 }, addFlags: [FLAG_WOUND] },
          },
          {
            weight: 20,
            text: "雪比你想的深。你走到再也抬不起腿，就在原地卧下了。雪很快盖住背。",
            effects: { die: "starve" },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-winter-qiongqi",
    trigger: { region: "qingqiu", seasons: [3], minYear: 5, once: true, weight: 38 },
    title: "穷奇夜至",
    body: "后半夜，雪地上传来婴儿一样的啼哭。哭声一步一步靠近，靠近到你能听见爪子踏碎雪壳的声音。青丘的老兽说过：听见小孩哭，就不要再睁眼。你睁了。",
    illustration: "events/qiu-winter-qiongqi.webp",
    illustrationBrief: `夜雪中${VT.qiongqi}自远处踏雪走来，肩翼微张，口鼻呼出白气；近景${VT.self}半起身回望，双眼反光。冷蓝月色，雪面留下两行足迹。`,
    choices: [
      {
        label: "起而迎之",
        outcomes: [
          {
            weight: 1,
            text: "你迎着那哭声站了起来。它停在三步外，很高兴地看着你。",
            effects: { startCombat: ENEMY_QIONG_QI },
          },
        ],
      },
      {
        label: "循暗而遁",
        requires: { organTags: [TAG_NIGHT_EYE] },
        outcomes: [
          {
            weight: 74,
            text: "你在黑里看得比它清楚，绕开月光走了一整夜。哭声跟到坡下就没了。",
            effects: { essence: { xue: 16 }, stats: { ling: 2 } },
          },
          {
            weight: 26,
            text: "你绕到坡下，它已经在那里等着。它一直知道你要往哪边走。",
            effects: { startCombat: ENEMY_QIONG_QI },
          },
        ],
      },
      {
        label: "闭目不动",
        outcomes: [
          {
            weight: 62,
            text: "你把脸埋进雪里装死。它绕着你走了三圈，闻了闻，走了。",
            effects: { hunger: -8, stats: { ling: 3, de: -1 } },
          },
          {
            weight: 38,
            text: "它绕到第三圈就不耐烦了。装死的东西，它见得太多。",
            effects: { startCombat: ENEMY_QIONG_QI },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-heaven-mandate",
    // 门槛**只**认 SYS_FLAG_ASCEND_READY：那个 flag 由引擎按 tuning.ascendMin* 四项算出
    // （含 trigger 表达不了的「器官数 ≥5」）。这里不再重复写 minYear／minStats ——
    // 重复一遍就是两份门槛，B4 调 ascendMin* 时必然漂移成「flag 亮了但事件不入池」。
    trigger: {
      region: "any",
      requiresFlags: [SYS_FLAG_ASCEND_READY],
      once: true,
      weight: 100,
    },
    title: "天命",
    body: "云自四方合拢，中开一隙，白光垂落如柱，正照在你伏身之处。光里没有声音，却有一句话直接落进识海：可去矣。你听得很清楚，清楚到知道这句话只说一次。",
    illustration: "events/qiu-heaven-mandate.webp",
    illustrationBrief: `夜山之巅浓云中开一道竖隙，一柱冷白光垂落至山石；光柱下${VT.self}伏地仰首，只见剪影。远景为${VT.qiuHills}。上方留白占三分之一。`,
    choices: [
      {
        label: "应命而升",
        outcomes: [
          {
            weight: 1,
            text: "你踏光而上，兽身如旧衣般褪落在山石间。青丘的风声，自此与你无关。",
            effects: { die: "ascend" },
          },
        ],
      },
      {
        label: "辞而不受",
        outcomes: [
          {
            weight: 1,
            text: "你转身走回林中。光柱在背后缓缓收拢，山野重归昏黑，而你还饿着。",
            effects: { stats: { de: 5, ling: 2 }, lifespan: 2 },
          },
        ],
      },
    ],
  },
];
