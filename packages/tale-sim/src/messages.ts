/**
 * 引擎自身产出的旁白文案（notices 与 LifeRecord.text）。
 *
 * 为什么放在引擎里而不是 tale-content：`TaleContent` 的字段在接口正本里是封闭的
 * （events/organs/seeds/enemies/tuning/chronicleTemplates），没有 strings 槽位，
 * 而 `TurnResult.notices` 又是引擎返回给界面的成品字符串。列传文案仍归内容
 * （`ChronicleTemplates`），引擎只负责这些结构性旁白。
 *
 * 支持 `{{key}}` 占位，替换见 `render()`。全角标点。
 */
export const ENGINE_MESSAGES = {
  birth: "食灵凭{{seedName}}降世，托身青丘幼兽。",

  /**
   * [S2] 探索的起手旁白 —— 带上去处名。
   *
   * 原文是「循青丘旧径独行，草木皆是生面」：一句放在哪一处都成立的话。S2 之后玩家每季
   * 都在**选**一处，日志里若不写去了哪儿，回头复盘就分不出「这条精气是从幽潭还是焦原
   * 带回来的」—— 而那正是这一批要让玩家读出来的因果。
   */
  explore: "往{{place}}去。",
  /** [S2] 此地的兽撞上了你（无事时才掷，见 `rollAmbush`） */
  exploreAmbush: "{{place}}深处，{{enemy}}自暗中出。",
  /** [S2] 得了一处秘藏（记进图鉴那一句在客户端的演出里；这一条只进日志） */
  treasureFound: "{{treasure}}到手。此地之秘，已录入图鉴。",
  rest: "蜷于石隙间敛息养神。",
  restHeal: "旧创渐合，痛意稍退。",

  /*
   * [饥饿节奏批] 速猎与食余。
   *
   * 速猎为什么另起一套词而不复用追猎那几句：两条路在**屏幕上必须读得出分别**
   * （正本：按钮要摊开两者差别）。追猎那几句写的是「周旋」，速猎写的是「随手」——
   * 一句「就地扑倒一头野雉，草草吃了」与「自侧后一口咬住」不是同一种狩猎。
   */
  quickHuntCatch: "顺手扑倒一头{{enemy}}，草草吃过，不及细取。",
  quickHuntMiss: "随手一扑，{{enemy}}窜进草里，这一季白费。",
  /** 得手且留下余粮（大猎物才有；`{{seasons}}` 是汉字季数） */
  huntSurplus: "余下的肉拖回穴里，够吃{{seasons}}季。",
  /** 食余续了这一季（每季自动，无需任何点击） */
  surplusFeed: "取穴中旧肉充饥，未曾出猎。",
  /** 余粮吃完了那一季 —— 要在饿之前给一句提醒，否则玩家只会在饱食掉下来时莫名其妙 */
  surplusGone: "穴中的肉见了底。",
  molt: "蛰伏一季，蜕生{{organ}}。",
  moltNoCandidate: "蛰伏一季，精气无所凭依，终未成形。",
  organGained: "身内又生{{organ}}。",

  combatStart: "{{enemy}}当道，避之不得。",
  combatSkillHit: "施{{skill}}，{{enemy}}受创{{dmg}}。",
  /** [S1] 不出伤的技（护体／明识／脱身／硬受）—— 不能借 `combatSkillHit` 报「受创 0」 */
  combatSkillUse: "施{{skill}}。",
  /**
   * [S1] 自伤代价。
   *
   * 单独一行而不是并进技能那一句：代价是玩家**主动**付的，它该在日志里留一道自己的痕
   * （「这一架我为了放两次溃咬掉了六血」是复盘时看得见的账）。
   */
  combatSkillToll: "施{{skill}}，自身亦损{{dmg}}。",
  /** [S1] 流血在回合末结算（单句、不抽变体 —— 见 combatAct 的抽取顺序） */
  combatBleedTick: "{{enemy}}的伤口仍在渗血，又失{{dmg}}。",
  /** [S1] 反刺：它命中我方时自扎一记 */
  combatThornsPrick: "{{enemy}}这一下撞在硬鬃上，自伤{{dmg}}。",
  /** [S1] 硬受挡下了它这一手 */
  combatBraceHold: "{{enemy}}这一下砸在合拢的鳞上，一分力也没进来。",
  combatWin: "{{enemy}}毙于爪牙之下，吞其精气。",
  combatWinRecord: "搏杀{{enemy}}，食其精气。",
  /**
   * [M2-B1] 三条来路各自的开场白 —— 一场遭遇是怎么起的，玩家第一行字就该读到。
   *
   * 三条走同一个 `beginEncounter`，措辞不同是因为**主动权不同**：我盯上了它／它扑了我／
   * 撞到一处。主动权正是起手势的来源（见 `EncounterState.momentum`），所以它必须写在脸上。
   */
  encounterAmbush: "{{enemy}}自暗处扑出 —— 它先动的手。",
  encounterEvent: "{{enemy}}当道，避之不得。",
  /** [M2-B1] 接近阶段转交锋时结转的势 */
  encounterCarry: "潜到这一步才失手 —— 身上还留着一股势。",
  /** [M2-B1] 敌人进入新的行为段（兜底；内容 `EnemyStageDef.text` 优先） */
  encounterStage: "{{enemy}}换了打法。",
  /** [M2-B1] 打赢留下的食余 */
  combatWinSurplus: "尸首拖回穴口，够吃{{seasons}}季。",
  combatFleeOk: "觑得一隙遁去，未损分毫。",
  combatFleeFail: "去路已绝，遁而不得脱。",

  /**
   * [M2-B2] 凝招。两句都进列传摘录（`LifeRecord.kind === "forge"`）——
   * 「这一世自己想出了什么」比第三次「蜕生鳞甲」更该被记住。
   *
   * 自拟招那一句**把三件部件念出来**：一篇列传若只写「自成一手『齿鬃蚀』」，
   * 读的人不知道它凭什么成立；而因果（哪三件凑的）正是这一批的「情理之中」。
   */
  forge: "以{{parts}}三者相凑，自成一手，名之曰「{{name}}」。",
  forgeLore: "循古法{{lore}}，凝而习之，名之曰「{{name}}」。",

  deathStarve: "饥馑连季，形销骨立而终。",
  /**
   * [M1-P2] 寿终**改成明确的失败**。
   *
   * 原句「寿数已尽，卧于旧穴不复起」是中性的 —— owner 验收 M0 的原话是「最后寿终正寝，
   * 让人没有再次玩的欲望」。一个中性的收尾读起来像「这一世正常结束了」，玩家于是没有
   * 「我差了什么」这个念头。列传体裁允许把这件事说得刺一点：**终未成器**。
   */
  deathOldage: "终未成器，殁于青丘，与草木同朽。",
  deathSlain: "力尽，横死于{{enemy}}之口。",
  deathSlainGeneric: "力尽，横死于青丘荒野。",
  /** 兜底：`die: "ascend"` 而没能定出是哪条道时用（正常路径恒有道，见 applyEffects） */
  deathAscend: "白光贯顶，遂脱兽身而登神位。",
  /**
   * [2026-08-13] 四条道各自的收束旁白。
   *
   * 为什么不能共用一句：四条道的 `ending` 都是 `ascend`，而「众兽伏首」与「白光贯顶」
   * 是两件完全不同的事 —— 共用一句等于把这一批想立起来的四条道又抹回一条。
   */
  deathWay: {
    shen: "白光贯顶，遂脱兽身而登神位。",
    yaowang: "青丘之兽尽伏于道左。自此山中之事，由你说了算。",
    /*
     * 归山这一句与 `deathOldage` 是**同一个时刻的两种结果**（`closeSeason` 里一次判定），
     * 措辞刻意对着写：那边是「终未成器，与草木同朽」，这边说清「同样是老死，而这一次是成了」。
     * 寿终那条路径也走这里取句（不另留一份 `deathGuishan` —— 两份同样的话总有一天会改歪一份）。
     */
    guishan: "寿数既满，德亦既厚。卧于旧穴而化，青丘为之寂三日。",
    hualing: "一世未曾饮血。形骸自内里透明起来，风过时便散了。",
  },
} as const;

/**
 * [M1-P2] 部位的**名词**读法 —— 引擎旁白与客户端的守备标记共用这一份。
 *
 * 与客户端按钮上的动词标签（咬喉／咬腿／扑眼）是两码事：那是动作名，这是部位名。
 * 抽成导出常量是因为「引擎日志说咽喉、界面说喉部」这类漂移只会在实机读文字时才发现。
 */
export const BODY_PART_NAMES = { throat: "咽喉", leg: "后腿", eye: "眼" } as const;

/**
 * [M1-P2] 搏杀旁白的通用变体池。
 *
 * ## 为什么是数组（同 STALK_MESSAGES 的理由，且更刚性）
 * 一场搏杀三到八个回合，每回合都要读「我咬了哪里 ＋ 它做了什么 ＋ 它下一手要干嘛」三行。
 * 固定字符串会让同一屏里连着出现三遍同一句 —— M0 实测这种重复被 owner 直接读成「廉价」。
 *
 * ## 与 `EnemyDef.combatFlavor` 的分工
 * 只有 `intent`（意图宣告）归内容按敌人分措辞，其余归引擎：引擎不认识具体敌人，
 * 但「咬中咽喉」这件事对所有兽都是同一句话。
 *
 * 占位：`{{enemy}}` `{{dmg}}` `{{part}}` `{{rounds}}`。
 */
export const COMBAT_MESSAGES = {
  /** 咬中（按部位分池）—— 玩家每回合都读的一行 */
  bite: {
    throat: [
      "自侧后扑上，一口咬向{{enemy}}的咽喉，伤其{{dmg}}。",
      "齿贴着喉皮撕开一道，{{enemy}}受创{{dmg}}。",
      "整个身子压上去咬住咽喉，{{enemy}}受创{{dmg}}。",
    ],
    /*
     * [M2-B3] 「后腿」换成 `{{leg}}` 占位：名册里现在有鱼、鸟、蛇与带甲的东西，
     * 而它们没有后腿（实机读到过「蠃鱼的后腿已经拖在地上」）。
     * 措辞归内容（`EnemyDef.legWord`），缺省仍是「后腿」。
     */
    leg: [
      "低身撕{{enemy}}的{{leg}}，伤其{{dmg}}。",
      "一口咬住{{leg}}的筋，{{enemy}}受创{{dmg}}。",
      "从下方掀它的{{leg}}，{{enemy}}受创{{dmg}}。",
    ],
    eye: [
      "一爪拍向{{enemy}}的眼，伤其{{dmg}}。",
      "爪尖擦过眼眶，{{enemy}}受创{{dmg}}。",
      "扑向它的脸，指爪先到眼上，{{enemy}}受创{{dmg}}。",
    ],
  },
  /** 打的正是它护着的地方 */
  biteGuarded: [
    "{{enemy}}早把{{part}}护在里侧，这一下只伤其{{dmg}}。",
    "撞在护着的{{part}}上，力道散了大半，仅伤{{dmg}}。",
  ],
  /** 被护部位招来的反击 */
  counter: [
    "{{enemy}}就着这一下反口，自身受创{{dmg}}。",
    "它等的就是这一扑 —— 反咬一记，自身受创{{dmg}}。",
  ],
  /** 敌人常规出手 */
  enemyBite: [
    "{{enemy}}扑上来咬，自身受创{{dmg}}。",
    "{{enemy}}一口啄下，自身受创{{dmg}}。",
  ],
  /** 敌人重击（意图＝扑） */
  enemyPounce: [
    "{{enemy}}整个身子砸下来，自身受创{{dmg}}。",
    "那一扑带着全身的力，自身受创{{dmg}}。",
  ],
  /** 敌人打空（致盲） */
  enemyMiss: [
    "{{enemy}}朝着空处扑了一下 —— 它看不见你。",
    "它咬向记忆里你站的地方，那里已经没有人了。",
  ],
  /** 敌人这一回合只守 */
  enemyHold: [
    "{{enemy}}把身子收紧，只守不攻。",
    "它退了半步，护住要害，不动。",
  ],
  /** 我方换姿态 */
  stance: {
    low: ["伏低身子，四足贴地，把要害收进阴影里。", "把重心压到最低，只留背脊在外。"],
    square: ["转正身子，与它对面而立。", "站定，不进不退，正对着它。"],
    lunge: ["身子前倾，后腿蹬紧，只等一个空隙。", "把重心压向前爪，随时要扑。"],
  },
  /** 致盲落地 */
  blinded: ["{{enemy}}的眼里灌进血，看不清了。", "{{enemy}}甩着头，眼上一片红。"],
  /** 迟滞落地 */
  slowed: ["{{enemy}}的{{leg}}一软，动作慢了下来。", "那一处不再吃力，{{enemy}}的势头断了。"],
  /** 附毒落地 */
  venomed: ["腥液渗进伤口，{{enemy}}的血凝住了。"],
  /** 顿挫（stun）落地 */
  stunned: ["{{enemy}}被震得一滞，下一手打不出来了。"],
  /** 护体落地 */
  warded: ["一层硬物在皮下撑开，钝击都吃得住了。"],
  /** 疗愈落地 */
  healed: ["涎液敷上创口，血止住了。"],
  /** [S1] 流血落地（此后每合末它自己掉血） */
  bleeding: ["爪痕深而不齐，{{enemy}}的血止不住了。"],
  /** [S1] 反刺落地 */
  thorned: ["颈背的鬃根根竖起，尖端向外 —— 谁撞上来谁疼。"],
  /** [S1] 明识落地（数合内读得出意图） */
  insighted: ["心里忽然静下来，它每一处细小的动静都有了意思。"],
  /** [S1] 硬受落地（这一合免伤） */
  braced: ["鳞片层层合拢，把自己钉在原地。"],
  /** [S1] 脱身落地（必定遁走） */
  bolted: ["一蹬石棱，几个起落便隔开了它。"],
  /** 敌人遁走（意图＝逃且未被迟滞）——玩家什么也没得到 */
  enemyFled: [
    "{{enemy}}掉头就走，几步便没入林中 —— 什么也没留下。",
    "它不肯再打，转身遁去。你连一口肉都没吃到。",
  ],
  /** 咬腿拦住了它的退路 */
  fleeBlocked: ["{{enemy}}想走，那一处却不听使唤 —— 它没走成。"],
  /** [M2-B1] 腿伤累到「再也逃不掉」那一层 —— 与 `fleeBlocked`（一时的迟滞）分开 */
  legCrippled: ["{{enemy}}的{{leg}}已经废了，它这辈子都追不上你，也走不了了。"],
  /** [M2-B1] 眼伤累到「不再反击」那一层 */
  eyeRuined: ["{{enemy}}的两眼糊成一片红，它只能凭声音乱扑了。"],
  /** [M2-B1] 决杀（攒够势的一记） */
  finisher: [
    "势已在身，整个身子压着这一记落下 —— {{enemy}}受创{{dmg}}，护也护不住。",
    "攒了几合的力气尽数吐出，{{enemy}}被掀翻在地，受创{{dmg}}。",
  ],
  /** [M2-B1] 暴击（德之气运） */
  crit: ["这一下不偏不倚正落在筋节上。"],
  /** [M2-B1] 闪避（德之气运）—— 整下躲开 */
  dodge: [
    "身子先于念头偏了半寸，{{enemy}}这一下擦着毛尖过去。",
    "不知怎么就侧开了 —— {{enemy}}扑了个空。",
  ],
  /** [M2-B1] 识破弱点（兜底；内容 `EnemyDef.weakness.text` 优先） */
  weakness: ["看出来了 —— {{enemy}}的{{part}}是它护不住的地方。"],
  /** 器官技还在冷却（前置校验用不到，留给界面文案对齐） */
  skillCooling: ["{{skill}}还使不出来，得再等{{rounds}}合。"],
  /** 意图宣告的兜底池（内容 `combatFlavor.intent` 优先） */
  intent: {
    pounce: [
      "{{enemy}}压低身子，重心后坐 —— 这一下会重。",
      "它把身子往后一沉，要扑。",
    ],
    bite: [
      "{{enemy}}向前逼了半步，齿露在外。",
      "它的头低下来，盯着你的颈子。",
    ],
    guard: [
      "{{enemy}}把身子收紧，像要挨这一下。",
      "它护住要害，退了半步。",
    ],
    flee: [
      "{{enemy}}斜着身子，眼睛已经往林子里看了。",
      "它的四足对着退路 —— 它想走。",
    ],
  },
} as const;

/**
 * 追猎屏的通用旁白变体（M1-P1）。
 *
 * ## 为什么是数组
 * 一场追猎要潜行三四次、一世要追几十场 —— 同一句话会在同一屏里连着出现三遍。M0 实测
 * 「探索空手时中央卡重复同一句」被 owner 直接感知为「廉价」，追猎屏的重复密度比它高一个
 * 量级，所以这里从一开始就是变体池（每槽 3 条），由引擎的种子 rng 抽（**恒定消耗一次抽取**，
 * 见 `pickFlavor`）。
 *
 * ## 与 `EnemyDef.stalkFlavor` 的分工
 * 这里是**兜底**：猎物没写自己那一槽时用。真正的「野雉与岩羊说法不同」归内容
 * （`stalkFlavor`）—— 引擎不认识具体猎物，写不出「一头扎进地下」这种只对穴鼠成立的话。
 *
 * 占位：`{{enemy}}`（猎物名）、`{{steps}}`（步数）。
 */
export const STALK_MESSAGES = {
  begin: [
    "草梢有一线新踩过的痕。{{enemy}}就在前头，还没发现你。",
    "风里混进一股活物的气味。{{enemy}}在那儿，尚不知有人在看它。",
    "你伏下身，把自己压进草色里。{{enemy}}离得还远。",
  ],
  creep: [
    "四足轮换落地，无声近了{{steps}}步。",
    "贴着石影游走，又近了{{steps}}步。",
    "压低身形，借草色挪近{{steps}}步。",
  ],
  circle: [
    "退开半圈，绕到下风处 —— 气味不再往它那边送了。",
    "顺着坡脊兜转，直到风迎面吹来。",
    "沿着湿地绕行一段，把风留在正面。",
  ],
  wait: [
    "伏地不动，只余鼻息。草间那点惊意慢慢散了。",
    "屏住气，任草叶擦过脊背，一动不动。",
    "静了一阵。它重新低下头去。",
  ],
  stir: [
    "{{enemy}}忽然抬头，挪开了{{steps}}步。",
    "{{enemy}}绕着走了半圈，位置换了{{steps}}步。",
    "{{enemy}}没来由地一惊，挪了{{steps}}步。",
  ],
  catch: [
    "一跃而出，{{enemy}}未及转身。",
    "扑落如石，{{enemy}}只挣了两下。",
    "自侧后一口咬住，{{enemy}}的挣动很快就停了。",
  ],
  miss: [
    "扑空了 —— {{enemy}}几乎在同一瞬弹开。",
    "只擦到一把毛，{{enemy}}已窜出丈外。",
    "落地时草响，{{enemy}}早不在原处。",
  ],
  escape: [
    "{{enemy}}再不肯留，转眼没入林中。",
    "一声惊叫，{{enemy}}去得干净。",
    "{{enemy}}扬长而去，只剩一片踩乱的草。",
  ],
  /** 受惊／失手后反扑（`EnemyDef.retaliates`） */
  retaliate: [
    "{{enemy}}非但不走，反而低头压了上来。",
    "{{enemy}}转身立定，眼里全是要打的意思。",
    "{{enemy}}把身子横过来 —— 这一场躲不掉了。",
  ],
  /** 体力耗尽 */
  exhausted: [
    "腿脚发软，追不动了。空手而返。",
    "气力散尽，只得罢手。",
    "半日追逐，终究没能近身。",
  ],
  /** 得手后的进食 */
  feed: [
    "就地饱食一顿，精气入腹。",
    "血肉入喉，一股暖意自腹中散开。",
    "吃得干净，只剩一地零碎。",
  ],
  /** 附毒（venom tag）：扑空转搏杀时敌人已带伤 */
  venom: ["爪牙上的腥液蹭进它的皮肉，{{enemy}}的动作滞了一滞。"],
} as const;

const CN_DIGITS = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"] as const;

/**
 * 汉字数字（0〜99）：0→「〇」、10→「十」、11→「十一」、20→「二十」。
 *
 * 超出 0〜99 或非有限数时退回阿拉伯数字 —— 列传里出现「一百二十三」不如出现 123 好读，
 * 而 M0 的寿数上限是 20 余岁，越界只会是将来的新数据。
 *
 * 唯一实现放在 tale-sim：列传模板的 `{{n|cn}}` 与界面 `format.ts` 的岁数／计数汉字化
 * 用的必须是同一张表，否则「凡历四岁」与状态栏的「四岁」哪天就会各写一套。
 */
export function cnNumeral(value: number): string {
  const n = Math.floor(value);
  if (!Number.isFinite(n) || n < 0 || n > 99) return String(Math.floor(value));
  if (n < 10) return CN_DIGITS[n] as string;
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  const tensPart = tens === 1 ? "十" : `${CN_DIGITS[tens] as string}十`;
  return ones === 0 ? tensPart : `${tensPart}${CN_DIGITS[ones] as string}`;
}

/**
 * `{{key|fmt}}` 支持的格式化器。`cn` = 汉字数字（史书体列传要的那种）。
 *
 * 用 Map 而不是对象字面量：对象查表会连原型链上的 `constructor`／`toString` 一起「查到」，
 * 于是 `{{n|constructor}}` 这种写错的模板不会按「未知格式化器」处理，而是拿到一个能调的
 * 函数、悄悄输出点什么。Map 没有这个面。
 */
const FORMATTERS = new Map<string, (value: string | number) => string>([
  ["cn", (value) => (typeof value === "number" ? cnNumeral(value) : String(value))],
]);

/**
 * 条件段：`{{#key}}…{{/key}}` 值非零非空时保留内层，`{{^key}}…{{/key}}` 反之。
 *
 * 为什么需要它：列传是史记笔法，而「蜕〇，杀〇」「凡历〇岁」是机器话，一句就把整段文气
 * 破掉（死亡屏的摘要早就为此专门写了零值措辞）。零值该怎么说是**文案决定**，不是引擎
 * 决定，所以给内容一个开关，而不是在引擎里内置「杀 0 时说未尝杀生」。
 *
 * 不支持嵌套（内容里也没有嵌套的需求）；未知 key 的段**整段原样留着**，与未知占位同待遇。
 */
function renderSections(template: string, vars: Record<string, string | number>): string {
  return template.replace(
    /\{\{([#^])(\w+)\}\}([\s\S]*?)\{\{\/\2\}\}/g,
    (whole, mode: string, key: string, inner: string) => {
      const value = vars[key];
      if (value === undefined) return whole;
      const truthy = typeof value === "number" ? value !== 0 : value.length > 0;
      return (mode === "#") === truthy ? inner : "";
    },
  );
}

/**
 * 把 `{{key}}`／`{{key|fmt}}` 占位替换为 `vars` 中的值，并先处理条件段。
 *
 * 未知占位与未知格式化器**一律保持原样**（不静默吞掉，也不退回未格式化的值）——
 * 静默降级会让「模板写错」看起来像「数字风格没生效」，那是最难查的一类。
 *
 * `fmt` 目前只有 `cn`（汉字数字）：列传是史记笔法，正文里出现「凡历4岁，成器官2」
 * 会当场破掉文气，所以内容侧写 `凡历{{years|cn}}岁`。哪些数字用汉字由**内容**决定，
 * 引擎只提供这一支笔。
 */
export function render(template: string, vars: Record<string, string | number> = {}): string {
  return renderSections(template, vars).replace(
    /\{\{(\w+)(?:\|(\w+))?\}\}/g,
    (whole, key: string, fmt?: string) => {
      const value = vars[key];
      if (value === undefined) return whole;
      if (fmt === undefined) return String(value);
      const formatter = FORMATTERS.get(fmt);
      return formatter === undefined ? whole : formatter(value);
    },
  );
}
