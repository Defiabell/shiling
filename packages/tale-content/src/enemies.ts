/**
 * 8 敌人（青丘食物链）。
 *
 * ## 分两层
 * - **猎物层**（`PREY_IDS`，进 `tuning.huntPreyIds`）：野雉／文鳐鱼／穴鼠／岩羊。起追时
 *   从这四个里等权抽一，扑中即吞其 `essence`。岩羊（meng 10／hp 14，且 `retaliates`）
 *   留在表里是**故意**的：狩猎不是纯运气，判断失误时会撞上一场真打。
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

/*
 * ## 追猎战术档案（M1-P1）
 *
 * 三个字段 ＋ 一套旁白，决定「同一套四个按钮，面对不同猎物要打出不同的顺序」：
 *
 * | 猎物 | 起手距离 | 起手警觉 | 反扑 | 它逼玩家改什么 |
 * |---|---|---|---|---|
 * | 野雉 | 24（起得近） | 18 | 否 | 近而易惊：两步就能到贴身，但没绕风的话警觉先爆 |
 * | 文鳐鱼 | 34（隔着水） | 10 | 否 | 远而迟钝：要潜三步，体力预算最紧的一头 |
 * | 穴鼠 | 22（近） | 16 | 否 | 一惊就入地：它是「敢不敢现在就扑」的教具 |
 * | 岩羊 | 36（山坡上） | 8 | **是** | 远、沉稳、失手就顶回来 —— 唯一一头「扑之前要先算赌注」的猎物 |
 * | 草狐 | 30 | 44 | 是 | 起手就在「有疑」档：不绕风基本没得谈 |
 * | 山魈 | 32 | 30 | 是 | — |
 * | 玄蟒 | 20 | 8 | 是 | 「不追不扑，只等你自己走进它的一圈」＝ 极近、极钝、极险 |
 * | 穷奇幼崽 | 38 | 20 | 是 | — |
 *
 * 后四头目前只由事件的 `startCombat` 引来（不进 `huntPreyIds`），字段先按性格填好：
 * M1 之后若把它们放进猎场，数值与文案已经在位，不必再回来补一遍。
 *
 * **`retaliates` 是故意做成确定的**（不是概率）：玩家在扑之前就能从预览里看到「失手要打」，
 * 于是「扑还是再等一息」变成一道算得清的题。掷骰决定要不要打，就又回到翻牌了。
 */

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
    startDistance: 24,
    wariness: 18,
    stalkFlavor: {
      begin: [
        "草窠里一团斑驳的影子在啄食，尾羽一翘一翘。",
        "前头有翅膀扑打泥地的声音 —— 一只野雉在洗尘。",
        "它把头埋进土里刨虫，正是看不见你的时候。",
      ],
      creep: [
        "趁它低头刨土，你压着草面挪近{{steps}}步。",
        "借着一丛乱蓬蓬的蒿子，近了{{steps}}步。",
        "四足一次只挪一寸，前进了{{steps}}步。",
      ],
      wait: [
        "野雉抬头张望了一阵，又重新低头去啄。",
        "你贴着地面，等它把那只惊眼闭上。",
        "它侧头听了听，什么也没听见。",
      ],
      stir: ["它扑腾两下换了个食处，挪开{{steps}}步。", "野雉小跑着追一只虫，位置偏了{{steps}}步。"],
      catch: [
        "扑出去时它才张翅，太晚了 —— 羽毛炸了一地。",
        "一口咬住颈子，翅膀在你颊边扑打了两下就停了。",
      ],
      miss: [
        "它贴地疾走十余步才起飞，恰好从你爪下溜过。",
        "只咬到一嘴尾羽，野雉已经跳上矮枝。",
      ],
      escape: ["野雉直冲上树梢，扭头看着你，再不肯下来。", "一声惊叫，它飞过溪去，落在你到不了的对岸。"],
    },
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
    startDistance: 34,
    wariness: 10,
    stalkFlavor: {
      begin: [
        "浅滩上银光一闪 —— 一尾文鳐鱼搁在半露的石背上晒鳞。",
        "水面下有个影子悬着不动，鳍张如两片薄翼。",
        "溪湾里传来啪的一声，是鱼跃出水面又落回去。",
      ],
      creep: [
        "踩着水下的卵石，一步一步涉近{{steps}}步。",
        "沿着溪岸的湿泥绕过去，近了{{steps}}步。",
        "水到腹下，你几乎是浮着挪了{{steps}}步。",
      ],
      wait: [
        "水纹平了。鱼的鳍缓缓开合，像在打盹。",
        "你立在水里不动，任小鱼来啄爪缝。",
        "等了一阵，水面重新映出天光。",
      ],
      stir: ["它顺着水流滑开{{steps}}步。", "一道逆流把它带偏了{{steps}}步。"],
      catch: ["爪子按进水里，正压在鳞背上 —— 它连滑翔的机会都没有。", "一口咬住，鳞片在齿间脆响。"],
      miss: [
        "水花溅起半人高，它已张翼滑出十步之外。",
        "爪下只有一把凉水，鱼从指缝里出去了。",
      ],
      escape: ["文鳐鱼张翼贴水滑走，落进深潭再不上来。", "它沉进石缝的阴影里，水面重归平静。"],
    },
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
    startDistance: 22,
    wariness: 16,
    stalkFlavor: {
      begin: [
        "土坡上新翻出一堆浮土，一只穴鼠正把头探在洞口外。",
        "枯叶底下有细碎的抓挠声 —— 它离自己的洞不远。",
        "穴鼠蹲在洞口啃草根，两只前爪捧着。",
      ],
      creep: [
        "顺着它看不见的那侧土脊，摸近{{steps}}步。",
        "踩在软土上无声，前进了{{steps}}步。",
        "你把身子压进浮土的阴影里，近了{{steps}}步。",
      ],
      wait: [
        "它直起身闻了闻风，又低头去啃。",
        "你等着 —— 只要它再往洞外走两步。",
        "洞口那点警觉散了，它把半个身子探了出来。",
      ],
      stir: ["它往洞口缩回{{steps}}步。", "穴鼠换了一处草根，挪了{{steps}}步。"],
      catch: ["爪子先落在它与洞口之间，然后一切就结束了。", "一口咬住后颈，它连叫都没叫出来。"],
      miss: ["它一头扎进洞里，只剩土屑扑在你脸上。", "爪子拍在浮土上，它已经没影了 —— 地下是它的天。"],
      escape: ["穴鼠钻回地下，把洞口的土蹬松。你只能对着一个黑洞。", "它在土里越挖越深，声音渐远。"],
    },
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
    startDistance: 36,
    wariness: 8,
    // 唯一一头会反扑的猎物：远、沉稳、扑空就是一场真打 —— 「值不值得扑」这道题的正主
    retaliates: true,
    stalkFlavor: {
      begin: [
        "半坡上一头岩羊在啃石缝里的草，双角朝后压着。",
        "碎石滚了两下 —— 它就在上头，还没朝这边看。",
        "岩羊立在一块斜石上，安静得像块石头的一部分。",
      ],
      creep: [
        "沿着石棱的背面爬升，近了{{steps}}步。",
        "踩住每一块会响的碎石，向上挪了{{steps}}步。",
        "贴着崖壁的阴影上行{{steps}}步。",
      ],
      wait: [
        "它转过头来看了很久，才重新低下去。",
        "你贴在石上不动。风把碎石的气味吹开了。",
        "岩羊挪了挪蹄子，警觉慢慢松下来。",
      ],
      stir: ["它沿坡上行，离开了{{steps}}步。", "岩羊换了块草皮，横移了{{steps}}步。"],
      catch: [
        "扑上羊背的一瞬它才发力，可后蹄已经离了石面。",
        "一口咬住咽喉，它把你连带着撞在石壁上，然后不动了。",
      ],
      miss: [
        "蹄子在石面上一磕，它转过身来 —— 你扑空了。",
        "只撞在它的肩上，那身皮硬得像树皮。",
      ],
      retaliate: [
        "岩羊不退，反而把双角压低，朝你冲了过来。",
        "它把后腿蹬在石棱上 —— 逼到这一步，它宁可顶。",
      ],
      escape: ["它三两跳上了你上不去的石台，回头看你。", "岩羊沿着崖线小跑离开，蹄声在石间回响。"],
    },
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
    startDistance: 30,
    wariness: 44,
    retaliates: true,
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
    startDistance: 32,
    wariness: 30,
    retaliates: true,
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
    startDistance: 20,
    wariness: 8,
    retaliates: true,
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
    startDistance: 38,
    wariness: 20,
    retaliates: true,
  },
];

/** 追猎的猎物表 —— 进 `tuning.huntPreyIds`，起追时等权抽一。 */
export const PREY_IDS: readonly string[] = [
  ENEMY_YE_ZHI,
  ENEMY_WEN_YAO,
  ENEMY_XUE_SHU,
  ENEMY_YAN_YANG,
];
