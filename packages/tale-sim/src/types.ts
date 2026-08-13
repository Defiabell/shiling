/**
 * 《食灵·列传》数据模型。
 *
 * 接口正本：docs/plans/shiling/2026-08-11-liezhuan-m0-plan.md 的「数据模型与引擎 API」节。
 * 本文件中带 `[正本]` 注记的类型逐字对应正本；带 `[B1 补全]` 的类型是正本只给了名字
 * （`TaleTuning`／`ChronicleTemplates`）而未给字段、由 B1 按「数值基线」与「回合结算顺序」
 * 两节推导出的结构 —— B2 必须按这里的形状提供数据。
 */

// ===== 枚举与标量 =====

/** [正本] 精气四型：足 鳞 穴 猛。 */
export type EssenceType = "zu" | "lin" | "xue" | "meng";
/** [正本] 地域。M0 仅青丘。 */
export type RegionId = "qingqiu";
/** [正本] 每季可选行动。 */
export type ActionId = "hunt" | "explore" | "rest" | "dormant";

/**
 * [M1-P1 正本] 风向，对玩家由有利到不利：逆（气味吹向自己）／侧／顺（气味送到猎物鼻子里）。
 *
 * 顺序不是装饰：`tuning.stalkWindAlertMul` 按它索引潜行的警觉倍率（0.5／1／2）。
 */
export type WindDir = "into" | "cross" | "with";

/** [M1-P1 正本] 追猎的四个动作：潜行／绕至上风／屏息等待／扑击。 */
export type StalkAct = "creep" | "circle" | "wait" | "pounce";

/**
 * [S2] 一处探索去处的风险档：常路／险地／绝境。
 *
 * 三档不是形容词，是**三组数**（遇袭概率／远行的饱食代价／事件概率乘子），表在
 * `TaleTuning.explorePeril`。之所以做成枚举而不是让每处自己写三个数：那样六处就有
 * 十八个可以各自漂移的旋钮，而「去处之间的风险差」是这一批的主设计量 —— 它该在
 * 一张表里一眼比得出来，调平衡也只调那一张表。
 */
export type PerilTier = "calm" | "wary" | "grim";

// ===== 搏杀（M1-P2）=====

/**
 * [M1-P2 正本] 可咬的三个部位。
 *
 * 三者**不是伤害档位**，而是三种不同的工具，各有各的适用局面（这是「有一个永远最优」
 * 与「有得选」的分界）：
 * - `throat` 咽喉：高伤，收官用；被护住则减半＋招反击。
 * - `leg` 后腿：低伤 ＋ 迟滞（`CombatState.slow`）—— 它**拦得住要逃的敌人**，也压得住扑击。
 * - `eye` 眼：极低伤 ＋ 致盲（`CombatState.blind`）—— 收益随**敌人伤害**放大，硬仗开局用。
 */
export type BodyPart = "throat" | "leg" | "eye";

/** [M1-P2 正本] 三种姿态：伏低／正对／扑击。**切换占一个回合**（那一回合不出手）。 */
export type Stance = "low" | "square" | "lunge";

/** [M1-P2] 敌人意图的四种类型。`guard` 与 `flee` 都不出手 —— 这正是洞察类器官要分辨的那一对。 */
export type EnemyIntentKind = "pounce" | "bite" | "guard" | "flee";

/**
 * [M1-P2 正本] 敌人**这一回合**宣告的意图，结算在玩家动作之后。
 *
 * 它在玩家出手**之前**就写在屏幕上（宣告 → 玩家应对 → 结算），所以「读意图选姿态」
 * 是一道有信息、可打错的题。`text` 由内容的 `EnemyDef.combatFlavor.intent` 提供
 * （缺省吃引擎兜底池）—— 措辞按敌人性格走，「它压低身子」与「它盘起来」不是同一头兽。
 */
export interface EnemyIntent {
  kind: EnemyIntentKind;
  text: string;
}

/**
 * [M1-P2 正本] 一个搏杀指令。
 *
 * 部位／姿态／技能／逃**在同一屏一次点选完成**（计划「既定裁决」第三条：P2 不得增加
 * 每回合的必点次数，不做多级菜单）。所以这是一个扁平联合，不是「先选类型再选参数」。
 *
 * ## [S1] `skill` 那一支从 `organId` 换成 `skillId`
 * 技能不再一定属于某一件器官：**组合技**（`SynergyDef`）由 2〜3 件器官凑齐才出现，
 * 它没有自己的器官。`skillId` 的取值见 `combatSkills`（器官技＝器官 id，组合技＝
 * `syn:<synergyId>`）。留 `organId` 会让「这个 id 是器官吗」变成一个要看情况的问题。
 */
export type CombatAct =
  | { kind: "bite"; part: BodyPart }
  | { kind: "stance"; to: Stance }
  | { kind: "skill"; skillId: string }
  | { kind: "flee" };

/**
 * 接口正本里这个类型写作 `CombatAct2` —— 那个「2」是计划期的产物（当时它与旧的
 * `"fight"|"flee"|"feint"|"organ"` 字符串联合并存）。旧签名已按「兼容纪律」整批替换，
 * `CombatAct` 名下不存在 v1，留个「2」在公开 API 上是永久的疤。故正本名保留为别名，
 * 照正本写的消费方逐字可用。
 */
export type CombatAct2 = CombatAct;

/**
 * [M1-P2 正本 ＋ S1 扩充] 一个技能的附带效果（`CombatSkillDef.effects`，可多条）。
 *
 * ## 十档，按「它在搏杀里是什么工具」分类
 * 这一档清单是 S1 的核心约束：12 件器官全部带技，**若十二个技全是「多打几点伤害」，
 * 技能池就只是一排等价按钮**（那正是 owner 说的「摸不着头脑」）。所以每一档都改变
 * 一个玩家看得见的量，而不是同一个量的不同大小。
 *
 * | 档 | 类型 | 落到哪个字段 |
 * |---|---|---|
 * | `venom` 附毒 | 持续·削弱 | `CombatState.slow`（血凝：它出伤打折、逃不掉、扑不起来） |
 * | `bleed` 流血 | 持续·伤害 | `CombatState.bleed`（每回合末它自己掉血，与出手无关） |
 * | `stun` 顿挫 | 控制 | 把它**下一回合**的意图压成 `guard`（偷一个回合） |
 * | `blind` 蒙目 | 控制 | `CombatState.blind`（它多半打空，且不再反击） |
 * | `armor` 护体 | 防御·持续 | `CombatState.ward`（数合内受伤减半） |
 * | `thorns` 反刺 | 防御·惩罚 | `CombatState.thorns`（它每命中你一次就自伤，越爱出手越吃亏） |
 * | `brace` 硬受 | 防御·即时 | **这一回合**它那一手伤害归零（不留计数器 —— 它只挡当下这一下） |
 * | `bolt` 脱身 | 位移 | 这一回合**必定**遁走（`over: "fled"`），不掷骰 |
 * | `insight` 明识 | 信息 | `CombatState.insight`（数合内读得出确切意图 —— 洞察类器官的临时替身） |
 * | `heal` 疗愈 | 恢复 | 回自身血量 |
 *
 * `brace` 与 `bolt` 刻意**没有**计数器：两者都在「玩家动作 → 敌人动作」这同一个回合里
 * 兑现完毕（见 `combatAct` 的回合顺序），留一个恒为 1 的计数器只会多一处要维护的衰减。
 */
export type CombatSkillEffect =
  | "venom"
  | "bleed"
  | "stun"
  | "blind"
  | "armor"
  | "thorns"
  | "brace"
  | "bolt"
  | "insight"
  | "heal";

/**
 * [S1] 一个技能的代价。
 *
 * ## 为什么每个技都必须有代价
 * 只有冷却的技是「转好了就按」——一世蜕四五件器官之后，技能池里永远有一颗好了的，
 * 于是「用哪个」退化成「谁的冷却先转好」。代价把它变成一道题：
 * - `hp` 自伤：**现在**就要付，血是这场架的本钱（`combatPreview.roundsToLive` 会当场变短）。
 * - `essence` 精气：付的是**蜕变的本钱**（精气攒满才能蛰伏）—— 一个跨系统的取舍，
 *   「这一架赢得漂亮」与「这一世多蜕一件器官」二者不可兼得。
 *
 * 付不起时技能**不可用**（`CombatSkillPreview.affordable` 为假，`combatAct` 抛错）——
 * 不做「打个折照样能放」的兜底：那会让屏幕上写的代价变成一句可以不算数的话。
 */
export type CombatSkillCost =
  | { kind: "hp"; amount: number }
  | { kind: "essence"; type: EssenceType; amount: number };

/**
 * [M1-P2 正本 ＋ S1 扩充] 一个搏杀技的定义。
 *
 * 器官技（`OrganDef.combatSkill`）与组合技（`SynergyDef.skill`）共用这一份形状 ——
 * 战斗屏的技能池把两者摆在同一排按钮里，引擎的结算也只有一条路径。
 */
export interface CombatSkillDef {
  name: string;
  desc: string;
  /**
   * [M1-P2 正本] 冷却回合数，缺省 `tuning.combatSkillCooldown`。
   *
   * 冷却是这颗按钮**存在的理由**：M0 的器官技是「每回合都能按的更强的战」，于是它把
   * 别的按钮全废了。有冷却之后「现在用还是留着收官」才是一道题。
   */
  cooldown?: number;
  /**
   * [S1] 附带效果，可多条（缺省／空数组＝纯伤害）。
   *
   * 组合技靠「两条效果同时落地」区别于单件器官技（溃咬＝爆发＋附毒，重甲＝硬受＋反刺）——
   * 这也是「凑齐两件器官换来的不只是数值」的唯一兑现方式。
   */
  effects?: readonly CombatSkillEffect[];
  /**
   * [S1] 伤害按哪个属性算，缺省 `meng`。
   *
   * `ling` 那一档只有灵性器官用（灵犀的「灵犀一点」）：灵系 build（化灵／登神）猛很低，
   * 若所有技都按猛算伤害，它们的技能池就只剩控制与防御 —— 而「灵系也该有自己的输出手」
   * 正是「两种 build 的技能池明显不同」的一半。
   */
  stat?: "meng" | "ling";
  /** [S1] 伤害倍率，缺省 `tuning.organSkillDamageMul`。控制类技压低它，组合技抬高它 */
  damageMul?: number;
  /** [S1] 代价，缺省＝无代价（本库的 12 件器官与 10 条组合全部显式写了代价） */
  cost?: CombatSkillCost;
}

/**
 * [S1] 一条**器官组合**（synergy）：2〜3 件器官凑齐即解锁一个新东西。
 *
 * ## 两条铁律（计划「统一机制：器官组合表」节）
 * 1. **对玩家隐藏**：图鉴只显示已知数量与「？」占位，未发现的**不列配方**。发现的那一刻
 *    有专门的「异变」揭示演出（`fx/synergyReveal.ts`），发现记录进 `Bloodline`（跨世保留），
 *    于是第二世起玩家可以**主动去凑**已知的组合 —— 那是「摸得着的发展方向」。
 * 2. **必须自洽**：配方与解锁物的因果关系要一眼说得通（毒腺＋狩齿→溃烂撕咬；雾目＋夜瞳→
 *    夜猎之眼）。禁止随机拼配 —— 「意料之外」靠隐藏，「情理之中」只能靠因果，
 *    而后者一旦破了，发现的瞬间就只是「解锁了一个新按钮」。
 *
 * `kind` 现在只有 `"skill"`（S1 交付战斗组合技）。S2 会加 `"place"`（探索目的地）——
 * 加一档时旧行一个字都不用改，这就是这一位存在的理由。
 */
export interface SynergyDef {
  id: string;
  /** 异变名号：「溃咬」「夜猎之眼」 */
  name: string;
  /** 配方：2〜3 件器官的 id，**全部持有**即解锁（顺序无关） */
  organIds: readonly string[];
  kind: "skill";
  /** `kind: "skill"` 的解锁物 */
  skill: CombatSkillDef;
  /**
   * 揭示演出上那一句**因果**：为什么这两件凑一起会是这个。
   *
   * 它不是风味字，是「情理之中」的唯一载体 —— 玩家读完这一句应该觉得「本来就该如此」，
   * 而不是「哦，又解锁了一个」。
   */
  reveal: string;
  desc: string;
}

// ===== 探索去处（S2）=====

/**
 * [S2] 一处去处的**专属秘藏** —— 那地方藏着的、只有到过才知道的东西。
 *
 * 与「组合（异变）」是同一条设计的两半：异变的**配方**隐藏、去处的**门槛**公开，
 * 而秘藏反过来 —— 你早就知道幽潭要鳞甲＋浮鳔（那是欲望展示位，写着才会去凑），
 * 但潭底有什么，不下去就不知道。「意料之外」在探索这一侧由它承担，
 * 「情理之中」由 `reveal` 那一句承担（同 `SynergyDef.reveal`：因果排在名号之前）。
 *
 * 发现记录进 `Bloodline.foundTreasureIds`（跨世保留）。S3 的「图录」会消费它 ——
 * 本批**只记不卖**。
 */
export interface TreasureDef {
  id: string;
  /** 秘藏名号：「渊心之珠」「雷髓」 */
  name: string;
  /** 揭示演出上那一句**因果**：为什么这地方会有这个东西 */
  reveal: string;
  /** 它是什么、给了什么（演出与图鉴共用一句） */
  desc: string;
}

/**
 * [S2] 一处探索去处 —— 「探索」那一次点击的真正对象。
 *
 * ## 为什么它不是一个 tag，而是一张表
 * S2 之前「探索」是单按钮、单事件池、单风险：玩家点它的时候不做任何决定。这张表把
 * 「往哪走」变成一道题，而题面必须**可读**（同 M1 追猎屏的铁律：没有预览的按钮＝翻牌）：
 * 每一处的事件池、猎物表、风险档、秘藏都在这里声明，界面据 `destinationPreview` 把它们
 * 全部摊在按钮上。
 *
 * ## 门槛是**公开**信息（与组合表刚好相反）
 * `requiresOrganIds` 是「全部持有才进得去」。未开启的去处照样渲染、照样写明缺哪几件 ——
 * 那是**欲望展示位**（同 M1 的置灰抉择、S1 的置灰技能）：玩家看得见幽潭要鳞甲＋浮鳔，
 * 才会为了它去攒。把门槛也藏起来只会得到一排看不懂的灰按钮。
 */
export interface DestinationDef {
  id: string;
  /** 去处名号：「兽径」「幽潭」 */
  name: string;
  /** 一句地貌 —— 按钮上的常驻说明，也是 AI 生成事件的景物锚 */
  desc: string;
  /**
   * 进得去的门槛：**全部**持有才开启（顺序无关）。空数组 ＝ 始终可去（兽径）。
   *
   * 两件以上即「由组合而非单件器官开启」（计划正本原话）—— 幽潭要鳞甲＋浮鳔，
   * 秘窟要雾目＋夜瞳（与「夜猎之眼」同一副配方：同一对器官既开一手技，也开一处地）。
   */
  requiresOrganIds: readonly string[];
  /** 风险档（数在 `TaleTuning.explorePeril`） */
  peril: PerilTier;
  /**
   * 此地的兽 —— 遇袭时从这张表里加权摇一头。空表 ＝ 此地无袭（只有兽径够太平）。
   *
   * 「独立猎物表」的落点就是它：同一个「遇袭」在兽径是草狐，在秘窟是玄蟒。
   */
  denizens: readonly { enemyId: string; weight: number }[];
  /** 专属秘藏（每处恰好一件；由此地某条 `once` 事件的 `findTreasureId` 兑现） */
  treasure: TreasureDef;
  /**
   * 此地的景物词 —— **AI 生成事件的正文必须命中其一**（`tale-ai` 的第七道闸门）。
   *
   * 同 `PREMISE_KEYWORDS` 的办法：「写出该地的具体景物」若只写在 prompt 里，拿回来的
   * 会是「你在林中走着」这种放在哪一处都成立的句子 —— 而那正是这一批要消灭的东西。
   */
  scenery: readonly string[];
}

/**
 * [M1-P2] 一头敌人的搏杀旁白。
 *
 * 只有**意图宣告**需要按敌人分措辞：它是玩家每一回合都要读的一行，一句到底会在三回合里
 * 连着出现三遍（同 P1 追猎旁白的教训）。守备与伤害的措辞由引擎兜底池负责 —— 引擎不认识
 * 具体敌人，写不出「它把身子盘起来」这种只对玄蟒成立的话。
 */
export interface CombatFlavor {
  /** 每槽 2〜3 条；占位 `{{enemy}}`。缺省（或某槽缺省）退回 `COMBAT_MESSAGES.intent`。 */
  intent?: Partial<Record<EnemyIntentKind, string[]>>;
}
/** [正本] 季节：0 春 1 夏 2 秋 3 冬。 */
export type Season = 0 | 1 | 2 | 3;
/**
 * [正本 ＋ 2026-08-13 语义扩写] 一世的四种收束方式。
 *
 * `ascend` 原意是「登神」，现在读作**成道** —— 四条道（`WayId`）中的任意一条走通都收束成
 * 它，具体是哪条写在 `TaleState.wayAchieved` 里。之所以不把四条道拆成四个 `EndingType`：
 * 下游（血统结算、死亡演出、列传赞语、存档目录）判「这一世成了吗」全是
 * `ending === "ascend"` 一处，拆开就要在每一处补四个分支，而漏补的那处不会有测试变红。
 *
 * `oldage` 因此**语义分叉**（计划正本原话）：寿数到了那一刻若「归山」门槛已备，收束成
 * `ascend`＋`wayAchieved: "guishan"`；不备才是 `oldage`（仍是「终未成器」的失败）。
 * 判定只在 `closeSeason` 的寿终那一处做一次，不存在两套并行逻辑。
 */
export type EndingType = "starve" | "slain" | "oldage" | "ascend";

// ===== 四道（2026-08-13「每局不同」批次）=====

/**
 * 四条并列的成道之路。**顺序即界面顺序**（`WAY_ORDER`），别改。
 *
 * 为什么要四条：M1-P2 把「登神」摆到了主界面，但所有 build 仍然朝同一个门槛跑 ——
 * 玩法再不同，目标是一样的，于是第二局仍旧是「同一件事再做一遍」。四条道各自指向一种
 * 完全不同的活法（灵德双修／杀伐立威／长寿厚德／一世不杀），于是「这一世我奔哪条」
 * 本身成了每局要重新回答的问题。
 *
 * - `shen` 登神：灵德双修，且**尝过神兽**（沿用 M0 那条路线）。
 * - `yaowang` 妖王：夺命数与猛都要够 —— 主动挑强敌、以杀立威。
 * - `guishan` 归山：寿数与德都要够 —— **寿终因此从失败变成一种胜利**。
 * - `hualing` 化灵：灵性极高，且**一世不杀一命** —— 唯一改变操作序列的一条
 *   （不能靠狩猎活着，只能探索＋休憩＋非致命抉择）。
 */
export type WayId = "shen" | "yaowang" | "guishan" | "hualing";

/**
 * 一条门槛的种类。同一个 id 可以出现在不同的道里，需求值不同（例如「德」在登神是 40、
 * 在归山是 60）—— 界面按 id 取字（`德`），按 `need` 报数。
 */
export type WayGateId = "year" | "ling" | "de" | "meng" | "lives" | "divine" | "nokill";

/**
 * 门槛的方向。
 *
 * `max` 那一档只有「不杀一命」用得上，但它必须是**数据里的一位**而不是特例分支：
 * 若用 `min` 硬套（need 0、have 0），任何 `have >= need` 的通用判定都会把「已夺三命」
 * 判成达标。方向写在门槛上，判定只有一处。
 */
export type WayGateBound = "min" | "max";

/** 四道里的一条门槛。`have`／`need` 都是原始数值 —— 措辞归界面。 */
export interface WayGate {
  id: WayGateId;
  bound: WayGateBound;
  have: number;
  need: number;
  met: boolean;
  /**
   * 还差多少（已达成为 0）。
   *
   * `min` 类＝`need − have`（「德行差二八」）；`max` 类＝`have − need`，读作**超出了多少**
   * （「已夺三命」）—— 那不是「再努力就能补上」的差距，而是这条道已经关了。
   */
  short: number;
}

/** 一条道的进度。 */
export interface WayProgress {
  id: WayId;
  /** 固定顺序，见各道在 `waysProgress` 里的定义 */
  gates: WayGate[];
  metCount: number;
  /** 全部门槛达成 ＝ 这条道的成道事件可以入池（归山除外，它在寿终那一刻判） */
  ready: boolean;
  /**
   * 0〜1 的接近度（各门槛完成比的均值）—— 只用来排「最接近哪条道」，不参与任何结算。
   * 布尔门槛（尝神兽／不杀一命）按 0 或 1 计。
   */
  closeness: number;
  /**
   * 这条道**已经永远走不到了**（某条 `max` 门槛被打破）。今天只有化灵会：夺过一命就闭。
   *
   * 有这一位，界面才能把「化灵 已闭」和「化灵 差灵八十」说成两件不同的事，
   * 「最接近的那条道」也才不会一直指着一条已经关掉的门。
   */
  lost: boolean;
}

export interface WaysProgress {
  /** 固定顺序：登神 → 妖王 → 归山 → 化灵 */
  ways: WayProgress[];
  /** 已够格的道（同上顺序）。归山够格也在其中 —— 它只是要等寿终那一刻兑现 */
  readyIds: WayId[];
  ready: boolean;
  /**
   * 最接近的那条（先比达成门槛数，再比接近度，再按固定顺序）—— 死亡屏的差距报告与
   * 状态栏横带的缺省视图都按它走。**已闭的道不参与竞争**。
   */
  nearest: WayId;
}

// ===== 开局变量：天时与出身（2026-08-13「每局不同」批次）=====

/**
 * 可被天时／出身改写的 tuning 数值字段（白名单）。
 *
 * 白名单不是洁癖：能改的字段越多，「同一份内容在两局里表现不同」的排查面就越大。这里只
 * 放**玩家在一局之内真能感觉到**的那几个（更饿、更难攒精气、猎物更警觉、杀获更多）。
 */
export type PremiseTuningKey =
  | "hungerPerSeason"
  | "winterHungerExtra"
  | "moltThreshold"
  | "huntFoodGain"
  | "restHungerGain"
  | "eventChanceBase"
  | "stalkAlertBonus"
  | "stalkStamina"
  | "combatWinEssenceMul";

/**
 * tuning 覆写量，**加法**语义（`hungerPerSeason: +3` ＝ 每季多饿 3 点）。
 *
 * 为什么是加法而不是乘法：一个操作比两种操作好推演，而计划里写成「×2」的那两项
 * （`winterHungerExtra` ×2）在当前基线上与加法等价（6 → 12），落地时按加法写并在
 * 内容里注明基线值。乘法项若真需要，由字段自身承载（如 `combatWinEssenceMul`）。
 */
export type PremiseTuningDelta = Partial<Record<PremiseTuningKey, number>>;

/**
 * 一个开局变量（天时或出身）。
 *
 * ## 它必须真改机制，不是风味字
 * 每一条都至少改一样**玩家在过程中会撞上**的东西：调参（大旱年真的更容易饿死）、
 * 事件权重（水泽之事翻倍）、属性／寿限（灵胎灵 +8 寿 −2），或挂一个开专属事件线的 flag。
 * 只写 `desc` 不写任何机制的条目，是这一批要消灭的那种东西。
 *
 * `effect` 是**降世屏上那一行机制**（给玩家看的账），`desc` 才是风味。两者都必填 ——
 * 只有 `desc` 的开局变量在屏幕上与「一行风味字」无从区分。
 */
export interface PremiseDef {
  id: string;
  name: string;
  /** 降世屏那一行机制：「每季多饿 3 点　水泽之事翻倍」 */
  effect: string;
  /** 风味一句 */
  desc: string;
  /** 抽取权重（同池内相对值） */
  weight: number;
  /** 覆写调参（加法） */
  tuningDelta?: PremiseTuningDelta;
  /**
   * 事件权重乘子：键是 `EventTrigger.tags` 里的分类 tag，多条命中则**相乘**。
   *
   * ⚠️ 乘子作用在**抽取阶段**（`drawEvent`），绝不改内容里的 `weight` 原值 ——
   * 改原值会污染 `TaleContent`（那是所有一世共享的同一份对象），并让「同种子同操作
   * ＝同终态」在第二世起就不成立。
   */
  eventWeightMul?: Record<string, number>;
  /** 出生时一次性属性修正（在神种 statMods 之后落账） */
  statMods?: Partial<Stats>;
  /** 寿限修正（岁）；在 `lifespanMax` 按体质算完之后加 */
  lifespanDelta?: number;
  /** 降世即挂的内容 flag（专属事件线的入池条件）。`sys:` 前缀会被过滤 */
  flags?: string[];
}

/** 一世的开局前提：天时 ＋ 出身。 */
export interface LifePremise {
  sky: PremiseDef;
  origin: PremiseDef;
}
/** [正本] 器官槽位。 */
export type OrganSlot = "eye" | "tooth" | "hide" | "limb" | "gut" | "spirit";

/** [正本] 四属性，0-100 夹紧。 */
export interface Stats {
  meng: number;
  ling: number;
  ti: number;
  de: number;
}

// ===== 内容定义（B2 提供数据） =====

/** [正本] 器官定义。 */
export interface OrganDef {
  id: string;
  name: string;
  slot: OrganSlot;
  /** 开奖权重用，0-1 */
  affinity: Partial<Record<EssenceType, number>>;
  /** 获得时一次性加成 */
  statMods?: Partial<Stats>;
  /** 事件/战斗钩子，如 "night-eye" "venom" "armor" */
  tags: string[];
  /**
   * 有则搏杀屏多出一颗技能按钮。
   *
   * [S1] **12 件器官全部带技**（此前只有 4 件）：每蜕一件器官就多一个**新动作**，
   * 而不只是几点属性 —— 这是「一局里积累的东西有用途」的最直接兑现。
   */
  combatSkill?: CombatSkillDef;
  desc: string;
}

/** [正本] 神种（出生第 0 器官）。 */
export interface SeedDef {
  id: string;
  name: string;
  /** 血统点，0 为初始免费种 */
  cost: number;
  organ: OrganDef;
  desc: string;
}

/**
 * [M1-P1 补] 一头猎物在追猎屏里的专属旁白变体。
 *
 * 为什么挂在 `EnemyDef` 而不是别处：`TaleContent` 的字段在接口正本里是封闭的
 * （events/organs/seeds/enemies/tuning/chronicleTemplates），没有 strings 槽位；而 P1
 * 交付线要求「猎物不同措辞不同」，那就只能跟着猎物本身走。缺省（或某一槽缺省）时引擎
 * 退回 `ENGINE_MESSAGES` 的通用变体 —— 内容漏写只是少了个性，不会变成空字符串。
 *
 * 每槽 **2〜3 条**：M0 实测「探索空手时中央卡重复同一句」被 owner 直接感知为廉价，
 * 而追猎一场就要潜行三四次，一句到底会比探索更刺眼。
 */
export interface StalkFlavor {
  /** 起追开场（一场追猎里最先读到的一句）。占位：`{{enemy}}` */
  begin?: string[];
  /** 潜行拉近一步。占位：`{{enemy}}` `{{steps}}` */
  creep?: string[];
  /** 绕至上风。占位：`{{enemy}}` */
  circle?: string[];
  /** 屏息等待（猎物没动）。占位：`{{enemy}}` */
  wait?: string[];
  /** 等待时猎物自行挪动。占位：`{{enemy}}` `{{steps}}` */
  stir?: string[];
  /** 扑击得手。占位：`{{enemy}}` */
  catch?: string[];
  /** 扑击落空。占位：`{{enemy}}` */
  miss?: string[];
  /** 猎物受惊遁走。占位：`{{enemy}}` */
  escape?: string[];
  /** 受惊／失手后反扑（仅 `retaliates` 的猎物用得上）。占位：`{{enemy}}` */
  retaliate?: string[];
}

/** [正本] 敌人定义。 */
export interface EnemyDef {
  id: string;
  name: string;
  meng: number;
  hp: number;
  /** "beast" "venom" "divine"… */
  tags: string[];
  /** 战胜吞食所得 */
  essence: Partial<Record<EssenceType, number>>;
  /** 逃跑难度修正 -20〜+20 */
  fleeBias: number;
  desc: string;

  // — [M1-P1 正本] 追猎参数（可选，缺省吃 tuning 的通用值）—

  /** 起手警觉，缺省 `tuning.stalkStartAlert` */
  wariness?: number;
  /** 追猎失手／受惊时反扑（转入搏杀）而不是逃走，缺省 false */
  retaliates?: boolean;
  /** 起手距离（步），缺省 `tuning.stalkStartDistance` */
  startDistance?: number;
  /** [M1-P1 补] 追猎旁白变体，缺省退回引擎通用变体 */
  stalkFlavor?: StalkFlavor;

  // — [M1-P2] 搏杀战术档案（可选，缺省吃 tuning 的通用值）—

  /**
   * 守备偏好：三部位的抽取权重，缺省均等。
   *
   * 这是「面对不同敌人要咬不同地方」的唯一来源：岩羊常护咽喉（双角就压在那儿），
   * 野雉常护后腿（它靠腿逃）。玩家几场之后会记住某头兽的习惯 —— 那是**可积累的知识**，
   * 与掷骰完全不同。
   */
  guardBias?: Partial<Record<BodyPart, number>>;
  /** 意图模式：四意图的抽取权重，缺省吃 `tuning.combatIntentWeights` */
  intentBias?: Partial<Record<EnemyIntentKind, number>>;
  /** [M1-P2] 搏杀旁白（意图宣告），缺省退回引擎通用变体 */
  combatFlavor?: CombatFlavor;
}

/** [正本] 事件触发条件。 */
export interface EventTrigger {
  region: RegionId | "any";
  /** 缺省=任意行动后都可能触发 */
  actions?: ActionId[];
  /**
   * [S2] 这条事件属于哪几处去处（`DestinationDef.id`）。
   *
   * 语义：**声明了就只在那几处入池**；缺省 ＝ 与去处无关（哪一处探索之后都可能撞上）。
   *
   * 纪律（`tale-content` 的 schema 测试钉着）：`actions` 里显式含 `"explore"` 的事件
   * **必须**声明它，且非空 —— 「独立事件池」是这一批的判据，一条忘了归属的探索事件
   * 会在六处全部出现，那就是换皮而不是新世界，且不会有任何测试变红。
   * 反过来，不声明 `actions` 的事件（季候本身的事）刻意**不许**声明它：那类事写的是
   * 天气与时令，不是地方。
   */
  destinations?: readonly string[];
  minYear?: number;
  maxYear?: number;
  seasons?: Season[];
  /** 任一命中即可 */
  requiresOrganTags?: string[];
  /** 全部命中才算（与 requiresOrganTags 的「任一」语义不同） */
  requiresFlags?: string[];
  /** 命中任一即排除 */
  forbidsFlags?: string[];
  minStats?: Partial<Stats>;
  /** 本世只触发一次 */
  once?: boolean;
  /** 同池抽取权重，1-100 */
  weight: number;
  /**
   * [2026-08-13] 分类 tag（`water` 水泽／`foe` 强敌／`wonder` 奇遇／`winter` 冬事…）。
   *
   * **不参与是否入池的判定** —— 它只被天时／出身的 `PremiseDef.eventWeightMul` 用来在
   * 抽取阶段加权。放在 trigger 里是因为它与 `weight` 是同一件事的两半：weight 是内容
   * 自己定的基准，tags 是让世道去改它的把手。
   */
  tags?: string[];
}

/** [正本] 效果增量。应用顺序固定见 engine.applyEffects 的 JSDoc。 */
export interface EffectDelta {
  stats?: Partial<Stats>;
  hunger?: number;
  /** 寿元增减（岁） */
  lifespan?: number;
  essence?: Partial<Record<EssenceType, number>>;
  addOrganId?: string;
  addFlags?: string[];
  removeFlags?: string[];
  /** EnemyDef.id */
  startCombat?: string;
  die?: EndingType;

  // — [2026-08-13] 「这一笔算不算一桩事迹」的两个显式钩子 —

  /**
   * 这个分支**亲手取了几条命**（缺省 0），累进 `TaleState.livesTaken`。
   *
   * 为什么要内容自己标：引擎只看得见搏杀取胜与追猎得手，看不出「食其血肉」「取其卵」
   * 这类在文本里明写了杀生的抉择。而「化灵」之道的全部本钱就是**这一世真的没杀过**
   * —— 漏标一条，玩家就会在读完一段吃活物的文字之后仍然被告知「你还没夺过命」。
   */
  takesLife?: number;
  /**
   * 这个分支让玩家**尝到了神兽**（登神那条道的门槛之一）。
   *
   * 搏杀战胜带 `divine` tag 的敌人由引擎自己记；而「垂死应龙」那一类不经搏杀的神兽
   * 因缘只有内容知道，所以留这一个钩子。
   */
  devourDivine?: boolean;
  /**
   * [S2] 这个分支让玩家**得到了某处的秘藏**（`TreasureDef.id`），累进
   * `TaleState.foundTreasureIds`，由客户端记进 `Bloodline.foundTreasureIds` 跨世保留。
   *
   * 引擎只记不判：秘藏本身的收益（精气／器官／寿元）照常写在同一个 `EffectDelta` 里，
   * 这一位纯粹是「这一桩算不算发现」的钩子 —— 同 `takesLife`／`devourDivine` 的体例。
   * 已经得过的秘藏不重复记（图鉴是集合，不是流水）。
   */
  findTreasureId?: string;
  /**
   * 与 `die: "ascend"` 配套：这一世是**由哪条道**成的。
   *
   * 成道事件（天命／称王／化形）各自声明自己那条道。不给就退回「当前已够格且最接近的
   * 那条」—— 但内容应当显式写出来，因为同时够格两条时的兜底选择是**引擎的**默契，
   * 而列传结语与赞语要按道分。
   */
  way?: WayId;
}

/** [正本] 抉择的一个加权结果分支。 */
export interface EventOutcome {
  weight: number;
  text: string;
  effects: EffectDelta;
}

/** [正本] 事件抉择。 */
export interface EventChoice {
  label: string;
  requires?: {
    stats?: Partial<Stats>;
    /** 任一命中即可（同 EventTrigger.requiresOrganTags 语义） */
    organTags?: string[];
    essenceMin?: Partial<Record<EssenceType, number>>;
  };
  /** 加权抽一 */
  outcomes: EventOutcome[];
}

/** [正本] 图文事件。 */
export interface TaleEvent {
  /** kebab-case，如 "qiu-dying-yinglong" */
  id: string;
  trigger: EventTrigger;
  title: string;
  body: string;
  /** public/art/ 下文件名，B4 美术管线产出后回填 */
  illustration?: string;
  /**
   * 给 text-to-image 的画面描述（B2 与正文同笔撰写，B4 美术管线消费）。
   * 引擎不读它 —— 纯粹随事件数据一起流转。
   */
  illustrationBrief?: string;
  /** 1-4 个 */
  choices: EventChoice[];
}

// ===== 一世的记录与跨世资产 =====

/**
 * [正本] 列传素材条目。
 *
 * 引擎的记录纪律（B2/B3 依赖）：
 * - `birth` 一世恰好一条，`refId` = SeedDef.id。
 * - `molt` = 获得器官（蛰伏开奖或事件 addOrganId），`refId` = OrganDef.id。
 * - `combat` = **击杀**（战胜敌人）专用，`refId` = EnemyDef.id；逃脱不写记录（仅 notices）。
 *   composeChronicle 的 killCount 就是 combat 记录数。
 * - `event` = 事件抉择结果，`refId` = TaleEvent.id。狩猎成败不写记录（仅 notices）。
 * - `death` 一世最多一条且恒为末条，`refId` 可为击杀者 EnemyDef.id。
 */
export interface LifeRecord {
  year: number;
  season: Season;
  kind: "birth" | "event" | "combat" | "molt" | "death";
  /** 列传素材短句 */
  text: string;
  refId?: string;
}

/** [正本] 一篇列传。 */
export interface ChronicleEntry {
  title: string;
  body: string;
  ending: EndingType;
  years: number;
  organCount: number;
}

/**
 * [正本 ＋ S1 扩充] 跨世血统资产。持久化（localStorage）归 tale-client。
 *
 * ## [S1] 为什么图鉴与血脉在这里，而不在 `TaleState`
 * 「已发现的组合」若记在 `TaleState` 里，每一世重来都要重新发现一遍 —— 那就永远只是
 * 「意料之外」，成不了「摸得着的发展方向」。记在血统里，第二世起玩家才可能**主动去凑**。
 * 血统点也终于有了第二个去处（此前只解锁神种，三个种共 13 点花完即永久无处可花）。
 */
export interface Bloodline {
  points: number;
  unlockedSeedIds: string[];
  chronicle: ChronicleEntry[];
  /** [S1] 已发现过的器官组合（`SynergyDef.id`）—— 图鉴的「已知 N/M」与配方由它决定 */
  knownSynergyIds: string[];
  /**
   * [S1] 历代**曾经拥有过**的器官 id —— 「血脉」只能挑已发现过的器官。
   *
   * 不用「已知组合里出现过的器官」推：那样第一世蜕出的器官若不属于任何组合，
   * 就永远买不到，而玩家明明见过它。
   */
  knownOrganIds: string[];
  /**
   * [S1] 已买下、下一世**起手自带**的器官（`OrganDef.id`）；null ＝ 没买。
   *
   * 一次性消费：`createLife` 用掉它之后由客户端清空（钱在买的那一刻就付了）。
   */
  boonOrganId: string | null;
  /**
   * [S2] 历代**到过**的去处（`DestinationDef.id`）—— 图鉴的「已至之地 N/M」。
   *
   * 与 `knownSynergyIds` 的分工：那一份记的是「凑出过什么」，这一份记的是「去过哪儿」。
   * 两份都只增不减，都由客户端在发生的那一刻写档（不是死亡时才结算 —— 一世打到一半
   * 刷新页面，去过的地方不该白去）。
   */
  knownDestinationIds: string[];
  /**
   * [S2] 历代**得过**的秘藏（`TreasureDef.id`）—— 图鉴的「秘藏 N/M」，未得的一格恒为「？」。
   *
   * S3 的「图录」会拿它当货架（花血统点让下一世直通某处秘境）。**本批只记不卖**：
   * 消费项的价钱体系要与「血脉」「神种」一起排，混在这一批里排会排出第三份价目表。
   */
  foundTreasureIds: string[];
}

/**
 * [M1-P1 正本] 追猎中状态。追猎收束（caught/escaped/exhausted/combat）后 `TaleState.stalk` 置 null。
 *
 * 四个量就是玩家面前的全部决策变量，所以它们必须**全部可见**（精度按器官 tag 分档，
 * 见 `stalkPreview`）：看不见的变量等于不存在，玩家只会退回「点了再说」。
 *
 * `stamina` 是**动作预算**（含最后那一扑），不是血条：扣到 0 而还没扑，就是空手而归。
 */
export interface StalkState {
  /** EnemyDef.id */
  preyId: string;
  /** 步。0 ＝ 贴身 */
  distance: number;
  /** 0-100。满则受惊（逃走或反扑） */
  alertness: number;
  /** 还能做几个动作（含扑击） */
  stamina: number;
  wind: WindDir;
  /**
   * [M1-P1 补] 玩家**确知**当前风向。
   *
   * 起追时为 false（没有 `stalkWindTags` 器官的话就是「风势难辨」），一旦亲手「绕至上风」
   * 就恒为 true —— **自己刚做过的事自己知道**。
   *
   * 为什么这一位必须在 `TaleState` 里、而不是记在客户端：不记的话，读不出风向的 build 会
   * 反复绕圈（每次都不敢确定自己已在上风），把 6 点体力全花在绕风上。实验台同一批 400 场
   * 实测（`pnpm -C packages/gen balance -- --lab --lives 400`，bare build），加这一位前 → 后：
   * 「明理猎手」53.3% → **74.3%**，「照界面提示打」18.5% → **76.8%**（后者更惨是因为界面的
   * 推荐链更早就劝绕风，于是绕得更多）。而且**玩家无从察觉自己在浪费回合**。
   * 而放在客户端会击穿「TaleState 完整自描述」这条纪律（determinism 测试正盯着它）：
   * 界面能显示什么，必须能从 state 重建出来。
   */
  windKnown: boolean;
  /** 已结算动作数；起追时为 0，每次 stalkAct 后 +1 */
  round: number;
  log: string[];
}

/**
 * [正本 ＋ M1-P2 扩展] 战斗中状态。战斗结束（win/fled/dead/escaped）后 `TaleState.combat` 置 null。
 *
 * ## P2 加的六个字段都是「玩家看得见的决策变量」
 * 同 `StalkState` 的纪律：界面能显示什么，必须能从 `TaleState` 重建出来（determinism
 * 测试正盯着这条）。`guardPart` 与 `intent` 尤其不能只活在客户端 —— 它们必须在玩家出手
 * **之前**就定下来并可见，否则「避开守备部位」「读意图选姿态」两道题都不存在。
 */
export interface CombatState {
  enemyId: string;
  enemyHp: number;
  playerHp: number;
  /** 已结算回合数；开战时为 0，每次 combatAct 后 +1 */
  round: number;
  /** [M1-P2] 我方姿态；开战恒为 `square` */
  stance: Stance;
  /** [M1-P2] 敌人这一回合护着的部位。**对谁都可见**（同 P1 的距离与体力：自己眼前的事不需要器官来读） */
  guardPart: BodyPart;
  /** [M1-P2] 敌人这一回合宣告的意图，结算在玩家动作之后。精确读法要洞察类 tag，粗档人人可读 */
  intent: EnemyIntent;
  /** [M1-P2] 敌人致盲剩余回合（扑眼）：>0 时它多半打空，且不再对被护部位反击 */
  blind: number;
  /** [M1-P2] 敌人迟滞剩余回合（咬腿／附毒）：>0 时它出伤打折，且**扑不起来、也逃不掉** */
  slow: number;
  /** [M1-P2] 我方护体剩余回合（`armor` 类器官技）：>0 时受伤打折 */
  ward: number;
  /**
   * [S1] 敌人流血剩余回合（`bleed` 类技）：每回合**末**它自己掉 `tuning.combatBleedDamage`。
   *
   * 与迟滞（`slow`）刻意分开：迟滞削的是它的**出手**（它守着不动时迟滞一点用没有），
   * 流血削的是它的**血**（它守着不动照样掉）—— 于是「它爱守」这种敌人有了专门的解法。
   */
  bleed: number;
  /**
   * [S1] 我方反刺剩余回合（`thorns` 类技）：它每命中我一次就自伤
   * `tuning.combatThornsDamage`。
   *
   * 收益随**它出手的频度**放大（爱扑的穷奇吃亏最大，爱守的玄蟒完全不吃亏）——
   * 这与致盲「收益随它的伤害放大」是同一类设计：一件工具只在一类局面里最优。
   */
  thorns: number;
  /**
   * [S1] 我方明识剩余回合（`insight` 类技）：期间**读得出确切意图**。
   *
   * 它是 `tuning.combatIntentTags` 那几件洞察器官的**临时替身**：没有灵犀／夜瞳的 build
   * 可以花一个回合＋一份精气把「似要动手」换成「重击 · 预计受伤 11」。
   * 只改可见性，**不改任何结算**（同 P2 那条「信息 tag 不改结算」的测试盯着它）。
   */
  insight: number;
  /**
   * [M1-P2 ＋ S1] 技能冷却：`skillId` → 还要等几回合（0／缺键＝可用）。
   *
   * 键是 `combatSkills` 给的 `skillId`（器官技＝器官 id，组合技＝`syn:<id>`），
   * 不再只是器官 id —— 组合技也要各自冷却。
   */
  skillCooldowns: Record<string, number>;
  log: string[];
}

/**
 * [正本] 一世的完整状态。
 *
 * 引擎所有函数都按**约定式不可变**返回新对象：调用方不得依赖旧引用，也不得就地修改
 * 返回值（引擎不做 freeze，靠约定）。`rngState` 是唯一的随机源，同 seed + 同操作序列
 * 必然得到同一终态。
 *
 * 保留 flag：引擎自用的两个内部 flag 见 `SYS_FLAG_STARVING`／`SYS_FLAG_ASCEND_READY`，
 * 内容侧只读不写（`sys:` 前缀保留给引擎）。M1-P2 删掉了第三个（`sys:feint-primed`）——
 * 「诈」并入了扑眼与姿态体系。
 */
export interface TaleState {
  seed: number;
  rngState: number;
  year: number;
  season: Season;
  region: RegionId;
  /**
   * [2026-08-13] 这一世的天时（`PremiseDef.id`，取自 `content.skies`）—— 降世时掷出，一世不变。
   *
   * 存 id 而不存整个 def，也不存「已经算好的 tuning」：前者会让 `TaleState` 里带上一份
   * 内容对象的拷贝（内容改一个字，旧存档就与新内容说两套话），后者会把 34 个调参字段
   * 复制进每一帧状态。生效调参由 `lifeTuning(state, content)` 现算 —— **一份实现，处处同解**。
   */
  skyId: string;
  /** [2026-08-13] 这一世的出身（`PremiseDef.id`，取自 `content.origins`）。 */
  originId: string;
  stats: Stats;
  hunger: number;
  lifespanMax: number;
  essence: Record<EssenceType, number>;
  /** [0] 恒为神种器官 */
  organIds: string[];
  flags: string[];
  firedOnceIds: string[];
  combat: CombatState | null;
  /**
   * [M1-P1] 追猎中状态；非 null 时本季的行动**尚未收束** —— 界面须切到追猎屏并调
   * `stalkAct`，`performAction` 会拒绝。季推进与死亡判定推迟到追猎的终局那一步。
   */
  stalk: StalkState | null;
  records: LifeRecord[];
  /**
   * [2026-08-13] 本世亲手夺去的性命数 ＝ 搏杀取胜 ＋ 追猎得手 ＋ 内容标了 `takesLife` 的抉择。
   *
   * 为什么是一个字段而不是数记录：追猎得手**刻意不写 `LifeRecord`**（那会让一世几十次
   * 狩猎把列传的 8 条摘录全占满，见 `LifeRecord` 的记录纪律），所以数不出来。而这个数
   * 同时是两条道的判据：妖王要它够多，化灵要它恒为 0 —— 一条轴的两端，一个计数器。
   */
  livesTaken: number;
  /**
   * [S2] 本世到过的去处（`DestinationDef.id`，按第一次去的先后）。
   *
   * 在 `TaleState` 而不是只在客户端：界面上「此地已至」那一笔必须能从 state 重建
   * （同 `StalkState.windKnown` 那条教训 —— determinism 测试盯着「界面显示得出的东西
   * 必须在状态里」）。跨世那一份由客户端抄进 `Bloodline.knownDestinationIds`。
   */
  visitedDestinationIds: string[];
  /** [S2] 本世得到的秘藏（`TreasureDef.id`）。跨世那一份同上。 */
  foundTreasureIds: string[];
  alive: boolean;
  ending: EndingType | null;
  /**
   * [2026-08-13] 成道的那条道；`null` ＝ 未成道（含尚在世）。
   *
   * 与 `ending === "ascend"` 严格同步：成道则非 null，非成道则 null。列传结语、赞语、
   * 死亡演出、血统点都按它分道。
   */
  wayAchieved: WayId | null;
}

// ===== 调参与列传模板（B1 补全结构，B2 填数据） =====

/**
 * [B1 补全] 全部可调数值。初值见 `BASELINE_TUNING`（tuning.ts），逐项对应计划
 * 「数值基线」表；表里没有的项（狩猎食物量、器官技倍率等）是引擎实现必需的补全，
 * 已在字段注释里标明。
 */
export interface TaleTuning {
  // — 出生 —
  /** 初始 stats（神种 statMods 在此之上叠加） */
  initialStats: Stats;
  /** lifespanMax = lifespanBase + floor(ti / lifespanTiDivisor)，出生时定一次 */
  lifespanBase: number;
  lifespanTiDivisor: number;

  // — 饱食 —
  hungerInit: number;
  hungerMax: number;
  /** 每季固定消耗 */
  hungerPerSeason: number;
  /** 冬季（season 3）额外消耗 */
  winterHungerExtra: number;

  // — 精气与蜕变 —
  /** 任一型精气达此值解锁蛰伏；开奖后该型清零 */
  moltThreshold: number;
  /** 开奖候选数（按 affinity×该型精气加权不重复抽，再等权抽 1） */
  moltCandidateCount: number;

  // — 行动 —
  /**
   * [M1-P1 改] 「潜行更轻」的器官 tag 名（原「狩猎成功率加成」的 tag，语义随追猎屏改写）。
   * 持有它时潜行的警觉增益 ×`stalkQuietAlertMul`。
   */
  huntHunterTag: string;
  /** [补全] 猎物表：EnemyDef.id 列表，等权抽一；追猎得手即吞其 essence */
  huntPreyIds: string[];
  /** [补全] 追猎得手回饱食 */
  huntFoodGain: number;
  /** [补全] 休憩回饱食 */
  restHungerGain: number;
  /** [补全] 休憩清除的伤病 flag（计划「小回血」的落地形式：本模型无常驻 HP） */
  restHealFlags: string[];
  /** [补全] 每回合抽出事件的基础概率 */
  eventChanceBase: number;
  /** 探索行动对抽中概率的倍率 */
  exploreEventBonus: number;
  /**
   * [S2] 三档风险各是什么数 —— 「去处之间的差别」的全部数值来源。
   *
   * - `ambushChance`：**本季没撞上事件时**才掷的遇袭概率（同狩猎「要么撞上事，要么起追」
   *   的形状：两者占同一块中央舞台，不能并存）。摇到即从该处的 `denizens` 里挑一头开战。
   * - `travelCost`：这一季额外扣的饱食（远行的路费）。它是「深处的东西凭什么更值钱」的
   *   那一半 —— 没有它，越险的地方就只是白送。
   * - `eventMul`：在 `exploreEventBonus` 之上再乘一道。险地事更密（去都去了）。
   *
   * ⚠️ 三档必须**单调**（越险越贵、事越密、越容易遇袭），schema 测试钉着这一条：
   * 一处「更险但收益不变」的去处不是取舍，是陷阱。
   */
  explorePeril: Record<PerilTier, { ambushChance: number; travelCost: number; eventMul: number }>;

  // — 追猎（M1-P1）—
  //
  // 这一段的每个数都直接决定「一场追猎里玩家是不是在做判断」，所以逐项写清它在博弈里
  // 扮演什么角色。基线值的实测依据见 tale-content/src/tuning.ts 的追猎小节。

  /** 起手距离缺省值（步），对齐接口正本的 34；`EnemyDef.startDistance` 优先（8 头全都自带） */
  stalkStartDistance: number;
  /** 起手距离的抖动幅度：实际 = 基准 ±[0, jitter]，让同一头猎物每次的步数计划都要重算 */
  stalkStartDistanceJitter: number;
  /** 起手警觉缺省值；`EnemyDef.wariness` 优先 */
  stalkStartAlert: number;
  /**
   * [2026-08-13] 起手警觉的**全局加成**（缺省 0），加在 `EnemyDef.wariness` 之上。
   *
   * 为什么不能直接调 `stalkStartAlert`：八头猎物**全都**自带 `wariness`，缺省值一个都吃不到
   * —— 「兽潮之年猎物更警觉」若写成改缺省值，会是一条完全没有效果的天时（而且不会有测试变红）。
   */
  stalkAlertBonus: number;
  stalkStartAlertJitter: number;
  /** 一场追猎的动作预算（**含**最后那一扑）；扣到 0 仍未扑 ＝ 空手而归 */
  stalkStamina: number;
  /** 距离超过它 ＝ 彻底跟丢（等待时猎物走远的死线） */
  stalkLoseDistance: number;
  /** 警觉达到它 ＝ 受惊：逃走，或 `EnemyDef.retaliates` 的反扑 */
  stalkAlertMax: number;

  /** 潜行拉近的步数 */
  stalkCreepDistance: number;
  /** 持 `stalkSwiftTag` 时潜行额外拉近的步数（快一步 ＝ 少一个回合的警觉） */
  stalkCreepSwiftBonus: number;
  /** 疾足类 tag 名 */
  stalkSwiftTag: string;
  /** 潜行的基础警觉增益（再乘风向倍率与贴近倍率与静步倍率） */
  stalkCreepAlert: number;
  /** 距离 ≤ 它时警觉增益开始线性放大 —— 最后一步永远是最险的一步 */
  stalkNearDistance: number;
  /** 贴身（距离 0）时的警觉增益倍率 */
  stalkNearAlertMul: number;
  /** 持 `huntHunterTag` 时潜行的警觉增益倍率（<1 ＝ 更轻） */
  stalkQuietAlertMul: number;
  /** 风向对潜行警觉增益的倍率：逆风减半、侧风照旧、顺风翻倍 */
  stalkWindAlertMul: Record<WindDir, number>;
  /** 绕至上风的警觉代价（换来此后每一步都只涨一半） */
  stalkCircleAlert: number;
  /** 屏息一次压下的警觉 */
  stalkWaitAlertDrop: number;
  /** 屏息时猎物自行挪动的概率 */
  stalkWaitMoveChance: number;
  /** 挪动时**远离**（而非靠近）的概率 —— 屏息不是免费的 */
  stalkWaitMoveAwayChance: number;
  stalkWaitMoveMin: number;
  stalkWaitMoveMax: number;

  /**
   * 扑击命中率 = `stalkPounceBase − 距离×stalkPouncePerDistance − 警觉×stalkPouncePerAlert
   * + 猛×stalkPouncePerMeng`，再按 `minChance`／`maxChance` 夹紧。
   */
  stalkPounceBase: number;
  stalkPouncePerDistance: number;
  stalkPouncePerAlert: number;
  stalkPouncePerMeng: number;

  /** 持任一即看得见**精确警觉**（否则只有「未觉／有疑／欲遁」三档） */
  stalkAlertTags: string[];
  /** 持任一即看得清**风向**（否则风势难辨，只能靠绕行来确保上风） */
  stalkWindTags: string[];
  /** 附毒 tag：扑空转搏杀时敌人已带伤入场 */
  stalkVenomTag: string;
  /** 附毒时敌人起手血量倍率 */
  stalkVenomHpMul: number;

  // — 战斗 —
  /** 伤害 = combatDamageBase + floor(meng / combatDamageMengDivisor) ± combatDamageJitter */
  combatDamageBase: number;
  combatDamageMengDivisor: number;
  combatDamageJitter: number;
  /** [补全] 战胜额外回的饱食 */
  combatWinHungerGain: number;
  /**
   * [2026-08-13] 搏杀取胜吞得的精气倍率（缺省 1）。「兽潮」之年把它调高 —— 猛兽横行的
   * 年头难活，但杀一头的所得也更厚，于是「兽潮」不是单纯的负面天时。
   */
  combatWinEssenceMul: number;
  /** 逃跑成功率 = fleeBase + (ling − enemy.meng)×fleePerLingDiff − enemy.fleeBias×fleeBiasFactor */
  fleeBase: number;
  fleePerLingDiff: number;
  fleeBiasFactor: number;
  /** [补全] 器官技伤害倍率 */
  organSkillDamageMul: number;
  /** 所有概率的夹紧下限/上限（避免 0% 与 100% 的死局） */
  minChance: number;
  maxChance: number;

  // — 搏杀（M1-P2）—
  //
  // 这一组数决定「三个部位是否各有适用局面」。逐项写清它在博弈里扮演什么角色，因为
  // 「咬喉伤害最高」如果没有别的量把它压住，三颗按钮就退化成一颗（M0 的「战」换层皮）。
  // 复算工具：`pnpm -C packages/gen balance -- --lab combat --lives 400`。

  /** 咬喉／咬腿／扑眼的伤害倍率。喉高腿低眼极低 —— 低伤那两颗靠附带效果换回价值 */
  combatBiteMul: Record<BodyPart, number>;
  /** 打中**被护部位**的伤害倍率（正本：减半） */
  combatGuardDamageMul: number;
  /** 敌人意图＝`guard` 时，被护部位再乘这一档（它真的在守，不只是站着） */
  combatGuardIntentMul: number;
  /** 打中被护部位时招来反击的概率；`blind` 期间为 0（它看不见你） */
  combatGuardCounterChance: number;
  /** 反击的伤害倍率（按敌人的 meng 算） */
  combatCounterDamageMul: number;
  /** 三姿态的出伤／受伤倍率。切换占一回合，所以它是**跨回合**的选择，不是一次性技 */
  combatStanceMul: Record<Stance, { out: number; in: number }>;
  /** 各意图的受伤倍率：扑＝重击，咬＝常规，守／逃＝不出手 */
  combatIntentDamageMul: Record<EnemyIntentKind, number>;
  /** 意图抽取的缺省权重（`EnemyDef.intentBias` 优先） */
  combatIntentWeights: Record<EnemyIntentKind, number>;
  /** 敌人血量比例低于它才可能起「逃」意（血还满时逃走会让玩家白挨一顿莫名其妙） */
  combatFleeIntentHpRatio: number;
  /** 扑眼致盲的回合数 */
  combatBlindRounds: number;
  /** 致盲期间敌人打空的概率 */
  combatBlindMissChance: number;
  /** 致盲期间我方逃跑成功率的加成（它看不见你往哪去） */
  combatBlindFleeBonus: number;
  /** 咬腿迟滞的回合数 */
  combatSlowRounds: number;
  /** 迟滞期间敌人的出伤倍率 */
  combatSlowDamageMul: number;
  /**
   * 迟滞期间「扑」的**权重**倍率（不是排除）。
   *
   * 排除会让「咬腿→咬喉」的轮转彻底删掉扑这一档，而扑的预告是姿态那一整套决定的前提。
   * 实验台实测：全排除时只会咬腿一手对岩羊胜率 99.5%，三颗咬击按钮退化成一颗。
   */
  combatSlowPounceMul: number;
  /** `armor` 器官技给自己挂的护体回合数与受伤倍率 */
  combatWardRounds: number;
  combatWardDamageMul: number;
  /** 器官技缺省冷却（`CombatSkillDef.cooldown` 优先） */
  combatSkillCooldown: number;
  /** `heal` 器官技回的血量 */
  combatSkillHealAmount: number;
  /** `venom` 器官技附的迟滞回合数 */
  combatVenomSlowRounds: number;

  // — [S1] 技能池新增的四档效果 —
  //
  // 每一档的数都要回答同一个问题：**它凭什么值一个回合＋一份代价**。所以三条持续类的
  // 「总量」刻意压在「一次咬喉上下」：流血 3 合 ×2 ＝ 6，反刺 3 合 ×2 ＝ 6（若它每合都打），
  // 而咬喉一口 5〜7。技能不是「更强的咬」，是**在别的局面里更划算的咬**。

  /** `bleed` 流血持续回合数 */
  combatBleedRounds: number;
  /** `bleed` 每回合末敌人自己掉的血 */
  combatBleedDamage: number;
  /** `thorns` 反刺持续回合数 */
  combatThornsRounds: number;
  /** `thorns` 敌人每次命中我方时自伤的血 */
  combatThornsDamage: number;
  /** `insight` 明识持续回合数（期间读得出确切意图） */
  combatInsightRounds: number;

  // — [S1] 血脉（血统点的第二个去处）—

  /**
   * 「血脉」的价钱：花它让下一世**起手自带**一件已发现过的器官。
   *
   * ⚠️ 与别的调参不同，这一项在**转世屏**读（不在一世之内生效），所以天时／出身的
   * `PremiseTuningDelta` 白名单里没有它 —— 世道改不动跨世资产的价钱。
   * 一世产 3〜8 点（`bloodlineGain`），所以 4 点 ≈ 一世能买一件，与「解锁神种」并列可选。
   */
  bloodlineBoonCost: number;
  /**
   * 事件专属器官（`affinity` 为空、蛰伏池里永远开不出来的那些，今天只有龙涎）的血脉价钱。
   *
   * 贵一倍：它是那条稀有线的**全部回报**，若与常规器官同价，「垂死应龙」那条线的意义
   * 就被商店买断了。
   */
  bloodlineBoonRareCost: number;

  /** 持任一即**读得出敌人的确切意图**（否则只有「似要动手／按兵不动」两档） */
  combatIntentTags: string[];

  /*
   * — 四道门槛（2026-08-13）—
   *
   * 每条道的门槛全部满足时，引擎挂上对应的 `WAY_FLAGS[way]`，成道事件靠 `requiresFlags`
   * 入池（归山例外：它在寿终那一刻直接判）。
   *
   * M0/M1 的 `ascendMinYear`／`ascendMinOrgans` 已删 —— 登神现在按「灵德双修 ＋ 尝过神兽」
   * 判，不再看岁数与器官件数。留一个不再影响任何结算的旋钮比删掉危险（同 P2 删「诈」的理由）。
   *
   * 数值校准见 `packages/gen` 的 `--profile wayseek`（500 世，每世奔一条道）：
   * 目标是每条道各自 0.5〜5%、合计 8〜15%。
   */
  /** 登神：灵 ≥ 此值 */
  wayShenLing: number;
  /** 登神：德 ≥ 此值 */
  wayShenDe: number;
  /** 妖王：夺命数 ≥ 此值（`TaleState.livesTaken`，含追猎得手） */
  wayYaowangLives: number;
  /** 妖王：猛 ≥ 此值 */
  wayYaowangMeng: number;
  /** 归山：寿数 ≥ 此值（寿终那一刻判） */
  wayGuishanYear: number;
  /** 归山：德 ≥ 此值 */
  wayGuishanDe: number;
  /** 化灵：灵 ≥ 此值（另需一世不杀一命） */
  wayHualingLing: number;
  /** 「神兽」的敌人 tag —— 战胜带此 tag 的敌人即算尝过神兽（登神门槛之一） */
  wayDivineTag: string;
  /** 各道成道时额外的血统点（原「登神 +3」按道分开） */
  wayBloodline: Record<WayId, number>;

  // — 列传 —
  /** [补全] 列传中段最多摘录几条记录（birth 恒在其外） */
  chronicleMaxExcerpts: number;
}

/**
 * [B1 补全] 列传模板。正本写「结构由 B2 定」，但 B2 `import type` 自本包，
 * 结构只能落在这里；B2 按此形状填文案。
 *
 * 所有 `string` 字段支持 `{{key}}` 占位，可用 key 见 `composeChronicle` 的 JSDoc；
 * 未知占位保持原样输出（便于内容侧发现错别字）。
 */
export interface ChronicleTemplates {
  /** 列传标题，如 "{{seedName}}列传" */
  titleTemplate: string;
  /** 开篇：神种＋出生 */
  opening: string;
  /** 中段每条摘录一行，如 "{{year}}岁{{season}}，{{text}}" */
  middleLine: string;
  /** 结局四型各一段。`ascend` 那一条是**兜底** —— 成道恒有 `wayEndings` 里更具体的一段 */
  endings: Record<EndingType, string>;
  /**
   * [2026-08-13] 四条道各自的结语。
   *
   * 必填而不是可选：成道的 `ending` 一律是 `ascend`，若缺一条就会退回
   * `endings.ascend`（「白光贯顶，兽身褪如敝衣」）—— 一个归山的老兽读到这句是错的，
   * 而这类错**不会有任何测试变红**。四条都写才通过 typecheck。
   */
  wayEndings: Record<WayId, string>;
  /** 「赞曰」前缀（引擎不内置中文列传文案，此处由内容提供） */
  praisePrefix: string;
  /** 赞语变体，按数组顺序取第一个匹配；末项应为无条件兜底 */
  praise: ChroniclePraiseVariant[];
  /** 季节名，索引即 Season */
  seasonNames: [string, string, string, string];
}

/** [B1 补全] 赞语变体的匹配条件（按 de 与 ending 分支）。 */
export interface ChroniclePraiseVariant {
  id: string;
  /** state.stats.de ≥ minDe */
  minDe?: number;
  /** state.stats.de ≤ maxDe */
  maxDe?: number;
  /** 命中任一 ending 即可；缺省=不限 */
  endings?: EndingType[];
  /**
   * [2026-08-13] 命中任一道即可（`state.wayAchieved`）；缺省＝不限。
   *
   * 有它才能让「归山」的赞语褒扬而「登神」的赞语超然 —— 两者的 `ending` 都是 `ascend`，
   * 只按 ending 分支分不出来。未成道的一世 `wayAchieved` 为 null，声明了 `ways` 的变体
   * 一律不匹配。
   */
  ways?: WayId[];
  text: string;
}
