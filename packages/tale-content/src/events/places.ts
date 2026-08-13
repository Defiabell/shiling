/**
 * 去处专属事件（19）—— S2 补的那一半。
 *
 * `explore.ts` 里的 20 条是 S2 之前写的「青丘随便走走」，重新归属之后各有各的地方，
 * 但六处的密度差得离谱（兽径 8 条、秘窟 2 条）—— 而这一批的判据是
 * **「读起来像另一个地方」，不是「换了两个名词」**。所以这里按处补齐：
 *
 * | 去处 | 既有 | 本文件补 | 合计 | 这一处写的是什么 |
 * |---|---|---|---|---|
 * | 兽径 | 8 | 1 | 9 | 熟悉、琐碎、活物、日常 —— 别处的对照组 |
 * | 幽潭 | 2 | 4 | 6 | 水下：冷、静、没有声音、压力、鳞 |
 * | 险峰 | 3 | 3 | 6 | 高处：风、暴露、落石、只上不下 |
 * | 古祠 | 3 | 3 | 6 | 人留下的规矩：字、香、像、坟 |
 * | 秘窟 | 2 | 4 | 6 | 全黑：只剩听觉，方向感失灵，地下水 |
 * | 焦原 | 2 | 4 | 6 | 烧过之后：热、灰、无生命、白骨 |
 *
 * ## 每处一件秘藏（`findTreasureId`）
 * 六条 `once: true` 的秘藏事件是这一批的「意料之外」：门槛写在按钮上（玩家早知道幽潭
 * 要鳞甲＋浮鳔），**但潭底有什么，不下去就不知道**。发现那一刻走
 * `TreasureDef.reveal`（因果在名号之前，同 S1 的异变演出），记进图鉴跨世保留。
 *
 * 秘藏事件的落笔纪律三条：
 * 1. **`once: true` ＋ 年岁门槛**：秘藏不该是第一季就撞上的东西（那样它就只是一件装备）。
 * 2. **拿它要付代价**：三条秘藏各自要一件器官／一次冒险／一笔精气，没有白捡的。
 * 3. **不拿也有得拿**：另外两个选项各自成立，否则它不是抉择而是一颗「领取」按钮。
 *
 * ## 插图
 * 本文件 19 条**暂无插图**（美术管线要单独跑一轮），走客户端的程序化水墨占位。
 * `artAssets.test.ts` 的待补图白名单里逐条列了它们的 id —— 名单只许收敛。
 */

import type { TaleEvent } from "@shiling/tale-sim";
import {
  DEST_GU_CI,
  DEST_JIAO_YUAN,
  DEST_MI_KU,
  DEST_SHOU_JING,
  DEST_XIAN_FENG,
  DEST_YOU_TAN,
  TREASURE_DI_XIN,
  TREASURE_LEI_SUI,
  TREASURE_LU_HEN,
  TREASURE_YUAN_ZHU,
  TREASURE_YUN_GEN,
  TREASURE_ZHU_JIAN,
} from "../destinations.js";
import { ENEMY_QIONG_QI, ENEMY_SHAN_XIAO, ENEMY_XUAN_MANG } from "../enemies.js";
import { EV_FOE, EV_KIN, EV_WATER, EV_WINTER, EV_WONDER } from "../eventTags.js";
import {
  FLAG_BLOOD_RITE,
  FLAG_CAVE_KNOWN,
  FLAG_MERCY,
  FLAG_SICK,
  FLAG_WOUND,
} from "../flags.js";
import {
  TAG_ARMOR,
  TAG_DIG,
  TAG_FANG,
  TAG_INSIGHT,
  TAG_NIGHT_EYE,
  TAG_PIERCE,
  TAG_SWIFT,
  TAG_SWIM,
  TAG_TOUGH,
  TAG_VENOM,
} from "../tags.js";
import { VT } from "../visualTokens.js";

export const PLACE_EVENTS: readonly TaleEvent[] = [
  // ===== 兽径（1）：熟悉到能读出细节 =====

  {
    id: "qiu-path-worn",
    // 秘藏。走了四年才读得出这条路，所以有年岁门槛
    trigger: {
      region: "qingqiu",
      actions: ["explore"],
      destinations: [DEST_SHOU_JING],
      minYear: 4,
      once: true,
      weight: 34,
      tags: [EV_WONDER],
    },
    title: "旧径重踏",
    body: "这条兽径你走过多少遍已经数不清了。今天走到那株歪脖子松下面时，你忽然停住——地上叠了七层蹄印，最底下那一层是你自己的，落在四年前的春天。你第一次看出了它们的先后。",
    illustrationBrief: `俯视${VT.shouJing}上一段泥地，层层叠压的蹄印深浅不一；${VT.self}低头凑近地面辨认，一只前爪悬停未落。旁有一株歪斜老松，晨雾未散，画面上方大片留白。`,
    choices: [
      {
        label: "循最旧的那一道走",
        outcomes: [
          {
            weight: 1,
            text: "你跟着四年前的自己走。它绕开了三处塌方、两个蜂巢、一段总在渗水的坡——那时你不知道为什么绕，现在这条路整个在你脑子里了。",
            effects: {
              findTreasureId: TREASURE_LU_HEN,
              essence: { zu: 16, lin: 8 },
              stats: { ling: 3 },
              hunger: 6,
            },
          },
        ],
      },
      {
        label: "另辟一条新路",
        outcomes: [
          {
            weight: 62,
            text: "你拐进从来没走过的那一侧，蹚了半日的荆棘，出来时到了一片没见过的坡地。膝上全是划口，但你多了一块地方。",
            effects: { essence: { zu: 14, xue: 6 }, stats: { ti: -1 } },
          },
          {
            weight: 38,
            text: "新路绕了一个大圈，天黑前又把你送回歪脖子松下。你饿着，且什么都没多知道。",
            effects: { hunger: -6, stats: { ling: 1 } },
          },
        ],
      },
      {
        label: "就地卧下听一日",
        outcomes: [
          {
            weight: 1,
            text: "你在松下趴到日落，把这条路上过往的脚步声听了个遍：谁沉、谁跛、谁在你之后来过。听完并没得到什么，只是从此不必再看地上。",
            effects: { essence: { lin: 10 }, stats: { ling: 2, de: 1 } },
          },
        ],
      },
    ],
  },

  // ===== 幽潭（4）：水面以下没有声音 =====

  {
    id: "qiu-tan-sunken",
    trigger: {
      region: "qingqiu",
      actions: ["explore"],
      destinations: [DEST_YOU_TAN],
      weight: 26,
      tags: [EV_WATER],
    },
    title: "沉物",
    body: "下到两丈，水就不凉了，只是重。潭底斜插着一件东西：木的，被水泡得发黑，一半陷在淤里，另一半朝上张着，形状像一口翻过来的巨兽腹腔。里头堆着不知谁的骨。",
    illustrationBrief: `水下视角：${VT.youTan}深处斜插一具泡黑的巨大木壳，形如翻覆的兽腹，内堆白骨；${VT.self}悬浮于壳口前，四足微张。光只从画面上缘漏下几道，其余幽墨。`,
    choices: [
      {
        label: "钻进去翻",
        outcomes: [
          {
            weight: 58,
            text: "腹腔里全是陈骨与烂绳。你在最深处扒出一枚被水磨圆的角，握在爪里还是温的——这么冷的水里，它凭什么是温的？",
            effects: { essence: { lin: 20, xue: 8 }, stats: { ling: 2 } },
          },
          {
            weight: 42,
            text: "刚探进半个身子，那木壳就散了。你被压在下面挣了很久才顶开一条缝，出水时肋下全是暗青。",
            effects: { essence: { lin: 8 }, stats: { ti: -4 }, addFlags: [FLAG_WOUND] },
          },
        ],
      },
      {
        label: "以鳞甲撑开它",
        requires: { organTags: [TAG_ARMOR] },
        outcomes: [
          {
            weight: 1,
            text: "你把背脊顶进裂口，鳞一片片立起来当楔子。木壳整个掀开的那一下，一潭陈水混着骨屑翻上去，很久没有落下来。",
            effects: { essence: { lin: 26, xue: 12 }, stats: { ling: 1, ti: 1 } },
          },
        ],
      },
      {
        label: "绕它一周便上去",
        outcomes: [
          {
            weight: 1,
            text: "你绕着它游了一圈，把每一个开口的位置都记下来，然后浮上去换气。它跑不了，你也不必今天就进去。",
            effects: { essence: { lin: 10 }, stats: { ling: 3, de: 1 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-tan-scale-drift",
    trigger: {
      region: "qingqiu",
      actions: ["explore"],
      destinations: [DEST_YOU_TAN],
      weight: 24,
      tags: [EV_WATER, EV_FOE],
    },
    title: "落鳞",
    body: "一片鳞从上方飘下来，比你的头还大，边缘还带着新裂的白茬。接着是第二片、第三片——上面有什么东西正在蜕，而蜕的时候它不能动。",
    illustrationBrief: `竖构图，${VT.youTan}水中数片巨鳞自上缓缓飘落，边缘泛新裂的白；${VT.self}居画面下方仰头看，体量对比悬殊。上方暗处隐约一段${VT.xuanmang}的身躯轮廓。`,
    choices: [
      {
        label: "循鳞而上",
        outcomes: [
          {
            weight: 46,
            text: "你顺着落鳞游上去，在一处水下石台上看见它：黑得发亮的一大盘，正把旧皮从头上往后褪。它看见了你，但它现在动不了。",
            effects: { startCombat: ENEMY_XUAN_MANG },
          },
          {
            weight: 54,
            text: "上面已经空了，只剩一整张脱下来的旧皮挂在石棱上，像一件没人要的衣裳。你把它整个卷走了。",
            effects: { essence: { lin: 22, xue: 6 } },
          },
        ],
      },
      {
        label: "只拾落下的",
        outcomes: [
          {
            weight: 1,
            text: "你在水里接了七片鳞，一片也没多要，然后贴着潭底退出来。上面那东西始终没有下来。",
            effects: { essence: { lin: 14 }, stats: { ling: 2, de: 1 } },
          },
        ],
      },
      {
        label: "以毒试其新肉",
        requires: { organTags: [TAG_VENOM] },
        outcomes: [
          {
            weight: 1,
            text: "蜕壳的东西新肉最软。你把腺里的东西沿着水流放上去，等了半日，然后从容地上去取该取的。",
            effects: { takesLife: 1, essence: { lin: 24, meng: 12 }, hunger: 18, stats: { de: -3 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-tan-no-bottom",
    trigger: {
      region: "qingqiu",
      actions: ["explore"],
      destinations: [DEST_YOU_TAN],
      minYear: 2,
      weight: 22,
      tags: [EV_WATER],
    },
    title: "无底处",
    body: "潭的东边有一处，水色从青转成墨。你把一块石头推下去，数到六十还没听见回声——不是听不见，是这里根本没有声音。往下看，那墨色像是在缓缓地转。",
    illustrationBrief: `${VT.youTan}一侧水色由青骤转墨黑，交界成一道弧线；${VT.self}立于青水那一侧俯视深处，一块石头正沉入墨色。全画极低对比，墨色区大片留白式的黑。`,
    choices: [
      {
        label: "闭气沉下去",
        outcomes: [
          {
            weight: 44,
            text: "越往下越静，静到你听见自己的心。到某一处，水忽然变暖，暖处浮着一层极细的白沙——你抓了一把就往上冲。",
            effects: { essence: { lin: 24, xue: 10 }, stats: { ling: 2, ti: -2 } },
          },
          {
            weight: 40,
            text: "下到看不见天光那一层，胸口开始烧。你调头往上，那一段比下去时长了三倍。",
            effects: { essence: { lin: 8 }, stats: { ti: -3 }, addFlags: [FLAG_SICK] },
          },
          {
            weight: 16,
            text: "墨色不是水。它裹上来的时候你才明白过来，而那时候已经分不出上下了。",
            effects: { die: "slain" },
          },
        ],
      },
      {
        label: "以浮鳔缓沉",
        requires: { organTags: [TAG_SWIM] },
        outcomes: [
          {
            weight: 1,
            text: "你把鳔里的气一点点放掉，像一片叶子那样落下去，落到暖处再一点点鼓回来。这一趟你带上来的白沙够装满一个石臼。",
            effects: { essence: { lin: 30, xue: 12 }, stats: { ling: 2 } },
          },
        ],
      },
      {
        label: "在界上做个记号",
        outcomes: [
          {
            weight: 1,
            text: "你在青墨交界的那块石头上磨了三道爪痕，然后回岸。有些地方要先记住位置，再考虑要不要进去。",
            effects: { essence: { lin: 8 }, stats: { ling: 3 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-tan-heart-pearl",
    // 秘藏。要先知道潭里有个「无底处」（那条事件的第三个选项挂的就是它）
    trigger: {
      region: "qingqiu",
      actions: ["explore"],
      destinations: [DEST_YOU_TAN],
      minYear: 3,
      once: true,
      weight: 46,
      tags: [EV_WATER, EV_WONDER],
    },
    title: "渊心",
    body: "潜过这么多次之后，你终于摸到了潭心。那里不是泥，是一整片摞起来的旧鳞，厚得踩下去会陷。鳞下透着一点光，不亮，但整潭水静得这么久，就是因为它。",
    illustrationBrief: `${VT.youTan}最深处一片层叠旧鳞铺成底面，鳞缝间透出一点冷白微光；${VT.self}伏在鳞层上刨挖，激起细屑悬浮。四周全暗，只此一点光源。`,
    choices: [
      {
        label: "掘开鳞层取之",
        requires: { organTags: [TAG_DIG] },
        outcomes: [
          {
            weight: 1,
            text: "旧鳞一层层被你刨开，每刨一层，水就往上涌一次。最后一层下面躺着一枚冷珠，握上去整条前肢都麻了——从这天起，青丘的水认得你。",
            effects: {
              findTreasureId: TREASURE_YUAN_ZHU,
              essence: { lin: 34, xue: 10 },
              stats: { ling: 4, ti: 1 },
            },
          },
        ],
      },
      {
        label: "以身压之，硬取",
        outcomes: [
          {
            weight: 54,
            text: "你整个压上去把鳞层碾开，抢在肺烧起来之前抓住了那枚珠。上去之后吐了半日的水，但珠在爪里。",
            effects: {
              findTreasureId: TREASURE_YUAN_ZHU,
              essence: { lin: 26 },
              stats: { ling: 2, ti: -5 },
              addFlags: [FLAG_WOUND],
            },
          },
          {
            weight: 46,
            text: "鳞层比你想的厚。气用尽的那一刻你放了手，往上冲的一路都在想：它就在下面，只差一层。",
            effects: { essence: { lin: 10 }, stats: { ti: -3, ling: 1 } },
          },
        ],
      },
      {
        label: "把鳞重新盖回去",
        outcomes: [
          {
            weight: 1,
            text: "你把刨松的那几片一一压回原位，然后浮上去。这一潭静了很多年，你不想是自己让它响起来的那一个。",
            effects: { essence: { lin: 12 }, stats: { de: 5, ling: 2 }, addFlags: [FLAG_MERCY] },
          },
        ],
      },
    ],
  },

  // ===== 险峰（3）：风大，只上不下 =====

  {
    id: "qiu-feng-eyrie",
    trigger: {
      region: "qingqiu",
      actions: ["explore"],
      destinations: [DEST_XIAN_FENG],
      seasons: [0, 1],
      weight: 26,
      tags: [EV_KIN],
    },
    title: "崖巢",
    body: "石脊背风的一侧凿出一个巢，垒得比你见过的任何鸟巢都大，垫的是整张兽皮。巢里两只雏，羽还没长齐，看见你只把嘴张开，不叫。母的不在——它去了很远的地方才敢把巢空这么久。",
    illustrationBrief: `${VT.xianFeng}背风一侧凿出的大巢，巢中两只未齐羽的雏张口；${VT.self}攀在巢沿探身，后半身仍悬在崖外。云层在崖下平铺，天光冷白。`,
    choices: [
      {
        label: "两只都吃了",
        outcomes: [
          {
            weight: 1,
            text: "很快，也很饱。下崖的路上你一直听着背后的天，一直到进了林子都没听见翅膀声。",
            effects: { takesLife: 2, hunger: 30, essence: { zu: 16, meng: 8 }, stats: { de: -5 } },
          },
        ],
      },
      {
        label: "取巢底那张皮",
        outcomes: [
          {
            weight: 66,
            text: "你把两只雏挪到一边，抽走了垫底的整张兽皮——那是一头岩羊的，鞣得极好，不知道被谁鞣的。雏又把嘴张开了，你没理。",
            effects: { essence: { xue: 18, zu: 6 }, stats: { ling: 1 } },
          },
          {
            weight: 34,
            text: "皮抽到一半，风向变了。翅膀声压下来的时候，你还有一只爪陷在巢里。",
            effects: { startCombat: ENEMY_SHAN_XIAO },
          },
        ],
      },
      {
        label: "退到崖下等",
        outcomes: [
          {
            weight: 1,
            text: "你退到崖下伏着，看那东西回来喂食。它衔回来的是一整条鱼——这么高的地方，鱼是从哪儿来的？你想了很久。",
            effects: { essence: { lin: 12, zu: 6 }, stats: { ling: 3, de: 2 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-feng-gap",
    trigger: {
      region: "qingqiu",
      actions: ["explore"],
      destinations: [DEST_XIAN_FENG],
      weight: 28,
    },
    title: "风口",
    body: "两片石壁夹出一道缝，青丘所有的风都从这里过。缝里站不住兽，可缝对面那块平台上堆着东西——被风一年一年吹过去、堆起来的东西：断角、枯枝、旧骨、一小堆分不出来源的毛。",
    illustrationBrief: `两片高耸石壁夹出一道窄缝，缝中气流以细线示意；${VT.self}贴地匍匐穿行，鬃毛被吹向一侧。缝对面平台上堆着断角枯骨，属${VT.xianFeng}一段。`,
    choices: [
      {
        label: "顶着风过去",
        outcomes: [
          {
            weight: 52,
            text: "你贴着地爬过那道缝，耳朵里全是啸声。平台上的东西比看着多：你挑了三根还带着髓的骨，和一枚谁也认不出是什么的角。",
            effects: { essence: { xue: 16, zu: 10 }, hunger: 8 },
          },
          {
            weight: 48,
            text: "半途一阵横风把你掀起来，摔在缝口的石棱上。爬回来的时候，那堆东西还在对面，看得清清楚楚。",
            effects: { stats: { ti: -5 }, addFlags: [FLAG_WOUND] },
          },
        ],
      },
      {
        label: "以疾足抢过",
        requires: { organTags: [TAG_SWIFT] },
        outcomes: [
          {
            weight: 1,
            text: "你等两阵风之间那一息，三步就过去了。平台上的东西够你挑很久，而回程的那一息你也算好了。",
            effects: { essence: { zu: 24, xue: 12 }, hunger: 10, stats: { ling: 1 } },
          },
        ],
      },
      {
        label: "在缝口坐一日",
        outcomes: [
          {
            weight: 1,
            text: "你在缝口背风处趴了一整日，听风什么时候大、什么时候停。傍晚起身时，你已经能凭声音说出下一阵风还有多久。",
            effects: { essence: { zu: 10 }, stats: { ling: 3 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-feng-cloud-root",
    // 秘藏。要在最高处，且天要冷（云低）
    trigger: {
      region: "qingqiu",
      actions: ["explore"],
      destinations: [DEST_XIAN_FENG],
      seasons: [2, 3],
      minYear: 3,
      once: true,
      weight: 46,
      tags: [EV_WONDER, EV_WINTER],
    },
    title: "云根",
    body: "秋末的云压得极低，低到脊线整个没进去。你在云里走了半日，脚下忽然踩到一处不像石头的石头——白，温，边缘是柔的，像还没凝完。云不是从天上下来的，它从这里长出来。",
    illustrationBrief: `${VT.xianFeng}脊线整个没入低云，云中露出一处白而温润、边缘柔软的石体；${VT.self}立于其上低头嗅探。云气弥漫占画面四分之三，极高留白。`,
    choices: [
      {
        label: "凿下一块",
        requires: { organTags: [TAG_PIERCE] },
        outcomes: [
          {
            weight: 1,
            text: "喙尖凿进去的那一下，白石里渗出一缕气，顺着喙一路走到肺里。你含着那一块下山，走了从前要歇三次的路，一次也没歇。",
            effects: {
              findTreasureId: TREASURE_YUN_GEN,
              essence: { zu: 30, lin: 14 },
              stats: { ti: 2, ling: 2 },
              lifespan: 1,
            },
          },
        ],
      },
      {
        label: "用牙硬啃",
        outcomes: [
          {
            weight: 50,
            text: "啃了半夜，崩了两颗牙，总算咬下拳头大的一块。牙的事以后再说——这东西含在舌下，整个胸腔都是凉的。",
            effects: {
              findTreasureId: TREASURE_YUN_GEN,
              essence: { zu: 22, lin: 10 },
              stats: { ti: -3, ling: 2 },
            },
          },
          {
            weight: 50,
            text: "石面比看着硬得多。天亮时云散了，你脚下只剩一块寻常的白石，怎么看都不特别。",
            effects: { essence: { zu: 8 }, stats: { ti: -2, ling: 1 } },
          },
        ],
      },
      {
        label: "伏在上面睡一夜",
        outcomes: [
          {
            weight: 1,
            text: "你趴在那片温白上睡了一夜，梦里一直在往上走。醒来时云已经散了，石也凉了，但骨头里那点暖留了很久。",
            effects: { essence: { zu: 14, lin: 8 }, stats: { ti: 2, ling: 2 }, hunger: 6 },
          },
        ],
      },
    ],
  },

  // ===== 古祠（3）：人留下的规矩 =====

  {
    id: "qiu-ci-incense",
    trigger: {
      region: "qingqiu",
      actions: ["explore"],
      destinations: [DEST_GU_CI],
      weight: 26,
      tags: [EV_WONDER],
    },
    title: "余香",
    body: "祠前的石台上插着三根香，烧掉了一半，灰还没散。这地方一个人也没有，草长到膝盖高，可这三根香是今天早上才点的。台下摆着一小碟米，米上没有虫。",
    illustrationBrief: `${VT.guCi}阶前石台上三炷香烧过半、青烟直上；台下一只小碟盛米。${VT.self}立于阶下仰头看香，身形半在草中。逆光，烟线为画面唯一亮部。`,
    choices: [
      {
        label: "把米吃了",
        outcomes: [
          {
            weight: 56,
            text: "米是熟的，还带一点甜。你把碟舔干净，抬头时香刚好烧到根。",
            effects: { hunger: 18, essence: { lin: 8 }, stats: { de: -2 } },
          },
          {
            weight: 44,
            text: "米里拌了东西。你在祠外吐了整整一夜，边吐边想：那不是给你的。",
            effects: { hunger: 6, stats: { ti: -3 }, addFlags: [FLAG_SICK] },
          },
        ],
      },
      {
        label: "以灵犀察其意",
        requires: { organTags: [TAG_INSIGHT] },
        outcomes: [
          {
            weight: 1,
            text: "香烟在你眼里不是烟，是一句一句的话，从台上一直连到祠里那尊没有脸的像。话是求来的，求的是「今年别再来了」。你听懂了「你」指的是谁。",
            effects: { essence: { lin: 24 }, stats: { ling: 5, de: 1 } },
          },
        ],
      },
      {
        label: "把香插正再走",
        outcomes: [
          {
            weight: 1,
            text: "三根里有一根歪了，你用鼻子把它拱回去，然后退出祠外。你不知道该拜谁，可摆歪的东西看着难受。",
            effects: { essence: { lin: 10 }, stats: { de: 4, ling: 1 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-ci-clay-figure",
    trigger: {
      region: "qingqiu",
      actions: ["explore"],
      destinations: [DEST_GU_CI],
      minYear: 2,
      weight: 24,
      tags: [EV_KIN, EV_WONDER],
    },
    title: "泥像",
    body: "祠的最里头供着一尊泥像，人身，兽首。塑的那一头兽你认得——额上的纹路、耳后那一撮翘毛，和你照水时看见的一模一样。像的年头比你老得多。",
    illustrationBrief: `${VT.guCi}内室供一尊人身兽首泥像，兽首额有淡纹；${VT.self}伏在像前地面，形貌与像上兽首呼应。侧窗漏进一道斜光正落在像脸上，余处昏暗。`,
    choices: [
      {
        label: "推倒泥像",
        outcomes: [
          {
            weight: 62,
            text: "泥像碎在地上，里头是空的，只有一根撑着的木。你踩过碎泥走出去，走出很远才发现自己一直在走得很快。",
            effects: { essence: { meng: 20, xue: 6 }, stats: { de: -4, ling: 1 } },
          },
          {
            weight: 38,
            text: "像倒下去的声音在祠里滚了三圈。第三圈还没停，祠外的草丛里有什么站了起来。",
            effects: { stats: { de: -3 }, startCombat: ENEMY_SHAN_XIAO },
          },
        ],
      },
      {
        label: "在像前伏下",
        outcomes: [
          {
            weight: 1,
            text: "你在像前趴了很久，像它们从前那样。塑这尊像的人早死了，可他见过一头和你一样的东西，而且见过之后还愿意把它塑出来。",
            effects: { essence: { lin: 18 }, stats: { ling: 3, de: 4 }, lifespan: 1 },
          },
        ],
      },
      {
        label: "以血涂其首",
        outcomes: [
          {
            weight: 1,
            text: "你咬破舌尖，把血抹在泥兽的额上。泥吸得很快。做完之后祠里冷了一档，而你身上热了一档。",
            effects: {
              essence: { meng: 26, xue: 10 },
              stats: { de: -6, ti: 1 },
              addFlags: [FLAG_BLOOD_RITE],
            },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-ci-slips",
    // 秘藏。要先读得懂字（白泽问过路，或身上有灵犀之外的洞察）
    trigger: {
      region: "qingqiu",
      actions: ["explore"],
      destinations: [DEST_GU_CI],
      minYear: 4,
      once: true,
      weight: 44,
      tags: [EV_WONDER],
    },
    title: "祝简",
    body: "祠后的塌墙里露出一只陶瓮，瓮口的封泥裂了。里头竖着一捆竹片，片上刻满小字，密得像虫。你现在看得懂一些了——头一行写的是青丘的规矩，第二行写的是「规矩改过一次」。",
    illustrationBrief: `${VT.guCi}后墙塌口露出一只陶瓮，瓮口封泥开裂，内竖一捆刻满小字的竹简；${VT.self}探头看瓮，鼻尖几乎触到简面。墙缝透光，尘埃可见。`,
    choices: [
      {
        label: "把整捆读完",
        requires: { organTags: [TAG_INSIGHT] },
        outcomes: [
          {
            weight: 1,
            text: "你读到天黑又读到天亮。改的那一次是把「兽不得入祠」改成了「兽不得独入祠」——一个字。写这个字的人知道会有你这样的东西来读它。",
            effects: {
              findTreasureId: TREASURE_ZHU_JIAN,
              essence: { lin: 32 },
              stats: { ling: 6, de: 2 },
              lifespan: 1,
            },
          },
        ],
      },
      {
        label: "叼走几片慢慢看",
        outcomes: [
          {
            weight: 58,
            text: "你抽了七八片带走，回穴里对着看了一整个冬天。看懂的不多，但「规矩是人改的」这件事，你从此知道了。",
            effects: {
              findTreasureId: TREASURE_ZHU_JIAN,
              essence: { lin: 20 },
              stats: { ling: 3 },
            },
          },
          {
            weight: 42,
            text: "竹片一离开瓮就开始发脆。走到林边时你嘴里只剩一把碎渣，字全散了。",
            effects: { essence: { lin: 6 }, stats: { ling: 2 } },
          },
        ],
      },
      {
        label: "把封泥重新压好",
        outcomes: [
          {
            weight: 1,
            text: "你把裂开的封泥拱回瓮口，又推了半块墙石挡住。有些东西不是不该看，是不该由你先看完。",
            effects: { essence: { lin: 12 }, stats: { de: 5, ling: 2 } },
          },
        ],
      },
    ],
  },

  // ===== 秘窟（4）：全黑，只剩听觉 =====

  {
    id: "qiu-ku-blind-fish",
    trigger: {
      region: "qingqiu",
      actions: ["explore"],
      destinations: [DEST_MI_KU],
      weight: 26,
      tags: [EV_WATER],
    },
    title: "无目之鱼",
    body: "洞里有一条地下河，水面浮着一层白。凑近才看清那不是浮沫，是鱼——通体透明，没有眼睛，一层压一层地贴着水面走。它们感觉不到你，也感觉不到彼此。",
    illustrationBrief: `${VT.miKu}中一条地下暗河，水面浮满通体透明、无目的小鱼；${VT.self}立于水边低头，倒影不清。仅洞顶一线微光照亮水面，其余全黑。`,
    choices: [
      {
        label: "张口趟过去",
        outcomes: [
          {
            weight: 1,
            text: "你贴着水面走了一趟，什么也没追，光张着嘴就吃饱了。它们直到被咬住的那一刻都不知道发生了什么。",
            effects: { takesLife: 4, hunger: 34, essence: { xue: 14 }, stats: { de: -3 } },
          },
        ],
      },
      {
        label: "取一条细看",
        outcomes: [
          {
            weight: 1,
            text: "你叼起一条对着洞口那点微光看。皮下的骨与心都看得见，心跳得很慢很规律。这东西一辈子没见过光，也就一辈子不怕黑。",
            effects: { takesLife: 1, hunger: 6, essence: { lin: 16, xue: 6 }, stats: { ling: 3 } },
          },
        ],
      },
      {
        label: "顺着鱼群走",
        outcomes: [
          {
            weight: 64,
            text: "鱼群一直往同一个方向流。你跟着它们走了很深，走到一处水面开阔、顶上有风的地方——这条洞不是死的，它通到别处去。",
            effects: { essence: { xue: 18, zu: 8 }, stats: { ling: 2 }, addFlags: [FLAG_CAVE_KNOWN] },
          },
          {
            weight: 36,
            text: "鱼群在一处忽然全部沉了下去。你在原地站了很久，才想明白它们是被什么东西惊的，然后开始往回退。",
            effects: { hunger: -6, stats: { ling: 2 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-ku-stone-teat",
    trigger: {
      region: "qingqiu",
      actions: ["explore"],
      destinations: [DEST_MI_KU],
      weight: 24,
    },
    title: "石乳",
    body: "这一段洞顶垂下无数石笋，尖端都在滴水，滴得极慢——一滴、很久、又一滴。你数了数：一百多根，可滴声只有一种节奏，像它们商量好了。地上对应的位置也长出了一截截朝上的。",
    illustrationBrief: `${VT.miKu}一段洞厅，顶垂无数石笋、地生对应石柱，尖端各挂一滴将落未落的水；${VT.self}行于石柱之间，体量极小。冷调，微光自水滴反射。`,
    choices: [
      {
        label: "咬断几根含着",
        outcomes: [
          {
            weight: 60,
            text: "石乳入口先是涩，含化之后一股土腥的凉顺着喉咙下去，直落到腹里。你含了三根，觉得骨头缝里也开始滴水。",
            effects: { essence: { xue: 22 }, stats: { ti: 1 } },
          },
          {
            weight: 40,
            text: "断下来的那一根比看着重，砸在你前爪上。洞里的滴声乱了半刻，然后重新排回原来的节奏。",
            effects: { essence: { xue: 8 }, stats: { ti: -3 }, addFlags: [FLAG_WOUND] },
          },
        ],
      },
      {
        label: "以夜瞳数其上下",
        requires: { organTags: [TAG_NIGHT_EYE] },
        outcomes: [
          {
            weight: 1,
            text: "暗中看得清：上下两截其实是同一根，只是中间还差最后一线。这一线要再滴多少年，你算不出来，但你知道这洞比青丘老。",
            effects: { essence: { xue: 20, lin: 12 }, stats: { ling: 4 } },
          },
        ],
      },
      {
        label: "在滴声里睡一觉",
        outcomes: [
          {
            weight: 1,
            text: "你在石笋林里卧下。那节奏比心跳慢，睡着睡着，你自己的心也慢了下来。醒来时不知道过了多久，只知道歇够了。",
            effects: { hunger: 8, essence: { xue: 10 }, stats: { ti: 1, ling: 1 }, removeFlags: [FLAG_WOUND] },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-ku-old-mark",
    trigger: {
      region: "qingqiu",
      actions: ["explore"],
      destinations: [DEST_MI_KU],
      minYear: 2,
      weight: 22,
      tags: [EV_FOE],
    },
    title: "前人之记",
    body: "岔口的石壁上刻着三道横痕，一道深两道浅。往前走二十步，又是三道，位置一模一样。刻它的东西有爪，个头比你大，而且它是从里面往外刻的——它认得出去的路，说明它进去过很多次。",
    illustrationBrief: `${VT.miKu}岔口石壁上刻着三道横痕（一深两浅），痕迹粗于寻常爪印；${VT.self}立于痕前抬爪比对。壁面湿亮，深处一片纯黑，构图左右分置。`,
    choices: [
      {
        label: "反着记号往里走",
        outcomes: [
          {
            weight: 48,
            text: "你逆着它的路往深处去。走到某一处，三道痕变成了一道，一道之后什么也没有——它到这里就不再做记号了，因为再往里它也没打算回来。",
            effects: { essence: { xue: 24, lin: 10 }, stats: { ling: 3 }, hunger: -6 },
          },
          {
            weight: 52,
            text: "记号在一处忽然断了。你在断处站着，听见前面很远的地方有东西在挪动，挪得很慢，很大。",
            effects: { startCombat: ENEMY_XUAN_MANG },
          },
        ],
      },
      {
        label: "顺着记号出去",
        outcomes: [
          {
            weight: 1,
            text: "你顺着三道痕一路走到洞口，全程没走错一次。这条路你现在也会了——代价是这一趟什么都没拿。",
            effects: { essence: { zu: 12 }, stats: { ling: 2 }, addFlags: [FLAG_CAVE_KNOWN] },
          },
        ],
      },
      {
        label: "在旁边刻上自己的",
        outcomes: [
          {
            weight: 1,
            text: "你在它的三道旁边刻了两道，刻得比它深。刻完之后你想：如果它还活着，它会看见；如果它死了，那这洞里现在只有一种记号。",
            effects: { essence: { meng: 16, xue: 8 }, stats: { meng: 2, ling: 1 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-ku-earth-marrow",
    // 秘藏。要先摸熟这片洞（FLAG_CAVE_KNOWN 在这里被读掉）
    trigger: {
      region: "qingqiu",
      actions: ["explore"],
      destinations: [DEST_MI_KU],
      requiresFlags: [FLAG_CAVE_KNOWN],
      minYear: 3,
      once: true,
      weight: 48,
      tags: [EV_WONDER],
    },
    title: "地心髓",
    body: "认得路之后你敢往更深处走。越深越暖，暖到某一段，石壁摸上去是软的——不是湿，是软。你把爪按进去，按出一个坑，坑里慢慢渗出一点发着微光的东西。这座山还没有凉透。",
    illustrationBrief: `${VT.miKu}最深一段，石壁一处被按出凹坑，坑中渗出微微发光的温润髓质；${VT.self}将前爪按在坑上。暖调微光自坑内散出，是画面唯一光源。`,
    choices: [
      {
        label: "掘开石壁取髓",
        requires: { organTags: [TAG_DIG] },
        outcomes: [
          {
            weight: 1,
            text: "你把软石整片刨开，里头的温髓像脂一样淌出来。捧了一路，回到洞口时它还是温的。那一夜你睡得极沉，醒来觉得骨头重新长过一遍。",
            effects: {
              findTreasureId: TREASURE_DI_XIN,
              essence: { xue: 34, meng: 12 },
              stats: { ti: 4, ling: 1 },
              hunger: 12,
            },
          },
        ],
      },
      {
        label: "直接伏上去吸",
        outcomes: [
          {
            weight: 56,
            text: "你把嘴贴在坑上吸。温髓比想的稠，也比想的烫，一路烫到腹里。烫过之后，那股暖就再没散过。",
            effects: {
              findTreasureId: TREASURE_DI_XIN,
              essence: { xue: 24, meng: 8 },
              stats: { ti: 2, ling: -1 },
              hunger: 8,
            },
          },
          {
            weight: 44,
            text: "刚吸了一口，整段石壁塌了半边。你被埋到肩，扒了半日才出来，那个坑早不见了。",
            effects: { essence: { xue: 10 }, stats: { ti: -5 }, addFlags: [FLAG_WOUND] },
          },
        ],
      },
      {
        label: "把爪印抹平退出去",
        outcomes: [
          {
            weight: 1,
            text: "你把按出来的那个坑抹平，退着走出那一段。山会不会记得你不知道，但你不想让它记得。",
            effects: { essence: { xue: 12, lin: 8 }, stats: { de: 4, ling: 2 } },
          },
        ],
      },
    ],
  },

  // ===== 焦原（4）：烧过之后，什么也不长 =====

  {
    id: "qiu-yuan-ash-egg",
    trigger: {
      region: "qingqiu",
      actions: ["explore"],
      destinations: [DEST_JIAO_YUAN],
      weight: 26,
      tags: [EV_KIN],
    },
    title: "灰下之卵",
    body: "灰里有一处鼓起来，扒开是一窝卵，七枚，壳被烤成了褐色。奇的是它们没有裂——火从上面过去了，而灰替它们挡住了。你把爪贴上去，里头有东西在动。",
    illustrationBrief: `俯视${VT.jiaoYuan}灰面一处隆起被扒开，露出七枚烤成褐色的卵；${VT.self}低头以鼻触卵。灰白铺满画面，卵为唯一暖色，四周焦木桩剪影。`,
    choices: [
      {
        label: "尽数食之",
        outcomes: [
          {
            weight: 1,
            text: "七枚一口气吃完，蛋液是热的，热得像刚从火里出来。这一顿够你在焦原上撑很久。",
            effects: { takesLife: 7, hunger: 36, essence: { meng: 18, xue: 8 }, stats: { de: -6 } },
          },
        ],
      },
      {
        label: "只取三枚，余者盖回",
        outcomes: [
          {
            weight: 1,
            text: "你吃了三枚，把剩下四枚重新埋回灰里，还多拨了一层。灰是暖的，比任何一处窝都暖。",
            effects: { takesLife: 3, hunger: 16, essence: { xue: 8 }, stats: { ling: 1, de: 1 } },
          },
        ],
      },
      {
        label: "守到它们出壳",
        outcomes: [
          {
            weight: 60,
            text: "你在旁边卧了三日。第三日夜里，七枚一起裂开，出来的东西看了你一眼就朝四面散进灰里。你饿了三日，什么也没吃到。",
            effects: {
              hunger: -12,
              essence: { lin: 16 },
              stats: { de: 6, ling: 2 },
              addFlags: [FLAG_MERCY],
            },
          },
          {
            weight: 40,
            text: "第二日夜里，母的回来了。它不是从天上来的，是从灰底下钻出来的，而且它比你大。",
            effects: { stats: { de: 2 }, startCombat: ENEMY_QIONG_QI },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-yuan-unburnt",
    trigger: {
      region: "qingqiu",
      actions: ["explore"],
      destinations: [DEST_JIAO_YUAN],
      weight: 24,
      tags: [EV_WONDER],
    },
    title: "不焚之木",
    body: "整片焦原上只有一株树站着，皮是白的，叶是绿的，脚下三尺之内一点灰都没有。那场火从四面绕过了它。你走近，叶子朝你这一侧全部转了过来。",
    illustrationBrief: `${VT.jiaoYuan}中央独立一株白皮绿叶之树，脚下三尺无灰；${VT.self}立于净土边缘仰头，树叶朝其一侧偏转。灰白与绿形成强对比，天色浑浊。`,
    choices: [
      {
        label: "食其一叶",
        outcomes: [
          {
            weight: 54,
            text: "叶子入口清凉，凉意一路铺到四肢。你在树下站了半日，觉得皮毛里那股焦味淡了。",
            effects: { hunger: 10, essence: { lin: 18 }, stats: { ling: 2 }, removeFlags: [FLAG_SICK] },
          },
          {
            weight: 46,
            text: "叶子一离枝就枯了，入口是灰的味道。你嚼了半天，什么也没有。树上剩下的叶子转回去了。",
            effects: { essence: { lin: 4 }, stats: { ling: 1 } },
          },
        ],
      },
      {
        label: "掘其根下",
        requires: { organTags: [TAG_DIG] },
        outcomes: [
          {
            weight: 1,
            text: "根下没有土，是一整块黑得反光的石。石上有一道旧裂口，裂口里塞着一段不知道是谁的指骨。火绕过这株树，是因为火从这里出来的时候它就在。",
            effects: { essence: { meng: 24, xue: 14 }, stats: { ling: 2 } },
          },
        ],
      },
      {
        label: "在树下卧一夜",
        outcomes: [
          {
            weight: 1,
            text: "整片焦原上只有这三尺是凉的。你在这三尺里睡了一夜，梦见火从四面过来，而你一点也不慌。",
            effects: { hunger: 8, essence: { lin: 12, meng: 6 }, stats: { ti: 2, ling: 2 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-yuan-great-bones",
    trigger: {
      region: "qingqiu",
      actions: ["explore"],
      destinations: [DEST_JIAO_YUAN],
      minYear: 3,
      weight: 24,
      tags: [EV_FOE, EV_WONDER],
    },
    title: "焦骨",
    body: "焦原中央横着一排肋骨，每一根都比你高。骨头是黑的，敲上去很脆，可它没有倒——它是站着烧完的。骨腔里有窝，窝里有毛，毛是新的：有东西住在这具尸骸里，而且现在不在家。",
    illustrationBrief: `${VT.jiaoYuan}上一列巨大黑色肋骨自灰中立起，每根高过兽身数倍；${VT.self}立于骨列之下抬头，体量对比极端。骨腔内暗处有一处兽窝。`,
    choices: [
      {
        label: "钻进骨腔翻",
        outcomes: [
          {
            weight: 46,
            text: "窝里垫着别的兽的皮，皮下压着一堆没啃干净的骨头，还有一块烧结成琉璃的东西。你把琉璃叼走了，那块皮也一并带上。",
            effects: { hunger: 14, essence: { meng: 22, xue: 10 } },
          },
          {
            weight: 54,
            text: "你钻进去的时候，外头的光被挡住了。回头看，洞口站着这窝的主人。",
            effects: { startCombat: ENEMY_SHAN_XIAO },
          },
        ],
      },
      {
        label: "折一根肋骨",
        requires: { organTags: [TAG_FANG] },
        outcomes: [
          {
            weight: 1,
            text: "你在最外侧那一根上咬了三次才咬断。断口里不是骨髓，是一层结晶的白，嚼起来沙沙作响，咽下去整条脊背都在发热。",
            effects: { essence: { meng: 28, xue: 8 }, stats: { meng: 2, ti: 1 } },
          },
        ],
      },
      {
        label: "绕着它走一圈",
        outcomes: [
          {
            weight: 1,
            text: "你绕着这具尸骸走了一整圈，数清了它有二十六根肋。走完你确定了一件事：能把这东西烧死的，还在青丘的什么地方。",
            effects: { essence: { lin: 14 }, stats: { ling: 4, de: 1 } },
          },
        ],
      },
    ],
  },

  {
    id: "qiu-yuan-thunder-marrow",
    // 秘藏。要先在焦原上见过那株不焚之木或那具焦骨（年岁门槛替代）
    trigger: {
      region: "qingqiu",
      actions: ["explore"],
      destinations: [DEST_JIAO_YUAN],
      minYear: 4,
      once: true,
      weight: 46,
      tags: [EV_WONDER],
    },
    title: "雷髓",
    body: "灰下埋着一截焦木，一尺来长，还在轻轻地噼啪作响——烧了这么久还没停。你靠近三步，全身的毛就立了起来，牙根发麻。烧焦的东西里总有一样没烧尽，因为那场火本来就是从它身上出来的。",
    illustrationBrief: `${VT.jiaoYuan}灰下半埋一截尺许焦木，木上迸出细小电弧；${VT.self}退在数步外全身鬃毛竖立。灰面因电光泛出一圈冷白，其余暗沉。`,
    choices: [
      {
        label: "以铁鬃裹之带走",
        requires: { organTags: [TAG_TOUGH] },
        outcomes: [
          {
            weight: 1,
            text: "你把硬鬃竖起来当篓，把那截焦木卷进去。一路上它在鬃里跳，跳得你半边身子都麻，可鬃没有焦，你也没有松口。",
            effects: {
              findTreasureId: TREASURE_LEI_SUI,
              essence: { meng: 34, zu: 10 },
              stats: { meng: 3, ti: 1 },
            },
          },
        ],
      },
      {
        label: "赤口叼起就跑",
        outcomes: [
          {
            weight: 52,
            text: "一咬下去整个下颌都在抖，那股躁气顺着牙一路窜进头顶。你跑出焦原才敢松口——木还在响，而你的心跳跟它一个节奏。",
            effects: {
              findTreasureId: TREASURE_LEI_SUI,
              essence: { meng: 26 },
              stats: { meng: 2, ti: -4 },
              addFlags: [FLAG_WOUND],
            },
          },
          {
            weight: 48,
            text: "牙碰上去的那一瞬，残雷在齿间炸开。你被掀翻在灰里，半边脸麻了整整一季，那截木仍在原处响。",
            effects: { essence: { meng: 10 }, stats: { ti: -5 }, addFlags: [FLAG_WOUND, FLAG_SICK] },
          },
        ],
      },
      {
        label: "远远看它烧完",
        outcomes: [
          {
            weight: 1,
            text: "你退到十步外趴下，看它响了一夜。天亮时它终于不响了，散成一小堆白灰。你走过去嗅了嗅，什么也没有——但你看完了一整场，从头到尾。",
            effects: { essence: { meng: 12, lin: 10 }, stats: { ling: 4, de: 1 } },
          },
        ],
      },
    ],
  },
];
