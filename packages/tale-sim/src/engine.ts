/**
 * 《食灵·列传》回合制确定性引擎。
 *
 * ## 不可变约定（CRITICAL，B2/B3 都靠它）
 * 所有导出函数都是**纯函数**：读入 `TaleState`，返回**新的** `TaleState`，绝不就地修改
 * 入参。调用方**不得依赖旧引用**（旧 state 仍然有效，但不再是「当前」状态），也不得
 * 就地修改返回值 —— 引擎不做 `Object.freeze`（省掉深冻结开销），靠约定。
 *
 * ## 确定性
 * 唯一随机源是 `TaleState.rngState`（mulberry32，见 rng.ts）。禁 `Date.now`／
 * `Math.random`／DOM。同一 seed ＋同一操作序列（行动/抉择/战斗指令）必然得到同一终态。
 *
 * ## 保留 flag
 * 引擎用两个 `sys:` 前缀 flag 承载 `TaleState` 里没有专用字段的状态（接口正本的
 * TaleState 无饿死计数器、无登神门槛位）。内容侧可以在 `requiresFlags` 里**读**它们，
 * 但不要在 `addFlags`／`removeFlags` 里写。
 *
 * （M0 的第三个 flag `sys:feint-primed` 已随 M1-P2 删除 —— 「诈」并入了扑眼与姿态体系。）
 */

import { createCursor, weightedPick, weightedSample, type RngCursor } from "./rng.js";
import {
  BODY_PART_NAMES,
  COMBAT_MESSAGES,
  ENGINE_MESSAGES,
  STALK_MESSAGES,
  cnNumeral,
  render,
} from "./messages.js";
import type {
  ActionId,
  BodyPart,
  ChronicleEntry,
  ChroniclePraiseVariant,
  ChronicleTemplates,
  CombatAct,
  CombatSkillCost,
  CombatSkillDef,
  CombatSkillEffect,
  DestinationDef,
  EffectDelta,
  EnemyDef,
  EnemyIntent,
  EnemyIntentKind,
  EndingType,
  EssenceType,
  EventChoice,
  ForgeCost,
  ForgePicks,
  ForgeSlot,
  ForgedSkill,
  HuntMode,
  LifePremise,
  LifeRecord,
  OrganDef,
  PartDef,
  PremiseDef,
  PremiseTuningDelta,
  PremiseTuningKey,
  Season,
  SeedDef,
  SigilDef,
  StalkAct,
  ApproachState,
  EncounterPhase,
  ClashState,
  EncounterOrigin,
  EncounterState,
  EnemyStageDef,
  Stance,
  Stats,
  SynergyDef,
  TaleEvent,
  TreasureDef,
  TaleState,
  TaleTuning,
  WayGate,
  WayGateId,
  WayId,
  WayProgress,
  WaysProgress,
  WindDir,
} from "./types.js";

// ===== 依赖注入 =====

/** 引擎的全部内容依赖。B2 的导出聚合成此对象（`TALE_CONTENT`）。 */
export interface TaleContent {
  events: TaleEvent[];
  organs: OrganDef[];
  seeds: SeedDef[];
  enemies: EnemyDef[];
  /**
   * [2026-08-13] 天时池（世道）—— 每世降生时按 `weight` 掷一个。**不得为空**：
   * 空池会让 `createLife` 抛错（同 `huntPreyIds`：一个静默失效的开局变量等于这一批没做）。
   */
  skies: PremiseDef[];
  /** [2026-08-13] 出身池（异相）—— 同上，不得为空。 */
  origins: PremiseDef[];
  /**
   * [S1] 器官组合表（异变）。**可以为空**（空表＝这一版没有组合可发现），与天时池不同：
   * 空的天时池会让 `createLife` 抛错，而空的组合表只是让图鉴显示「已知 0/0」。
   */
  synergies: SynergyDef[];
  /**
   * [M2-B2] 部件表（凝招的原料）。**可以为空**（空表＝这一版凝不了招，招式册只剩古法），
   * 同 `synergies` 而不同于 `skies`。
   *
   * 一件器官至多产出一件部件；查不到部件的器官就是「这件器官拆不出东西来」。
   */
  parts: PartDef[];
  /**
   * [S2] 探索去处表。**不得为空，且至少有一处无门槛**（`createLife` 不管，
   * `exploreDestinations` 也不管 —— 但 `performAction("explore")` 会因为无处可去而
   * 永远抛错）。内容侧的 schema 测试守着这两条：一个「探索按钮全灰」的版本
   * 不会有任何引擎测试变红。
   */
  destinations: DestinationDef[];
  /**
   * [S3] 世家印记表（血统点唯一能买到的永久数值加成）。**可以为空**（空表＝这一版不卖印记），
   * 同 `synergies` 而不同于 `skies`：空表只是让转世屏少一段货架，不会让任何一世开不了局。
   */
  sigils: SigilDef[];
  tuning: TaleTuning;
  /** 结构见 types.ts 的 ChronicleTemplates，composeChronicle 消费 */
  chronicleTemplates: ChronicleTemplates;
}

// ===== 返回值类型 =====

/** `performAction` 的结果。`pendingEvent` 非 null 时界面须先渲染事件卡并调 `resolveChoice`。 */
export interface TurnResult {
  state: TaleState;
  pendingEvent: TaleEvent | null;
  notices: string[];
  moltResult: MoltResult | null;
  /**
   * [S1] 这一步**新凑齐**的器官组合（`SynergyDef`，按 `content.synergies` 顺序）。
   *
   * 「新」＝这一步之前不满足、之后满足（引擎手上同时有两个状态，所以这个差集只能由它算；
   * 让界面自己前后比对等于把规则抄进客户端）。**是否播「首次发现」的大演出由客户端定** ——
   * 引擎不认识 `Bloodline`，第二世重新凑齐同一条组合时它照样报，客户端据图鉴决定演出规格。
   */
  newSynergies: SynergyDef[];
  /**
   * [S2] 这一步**新得到**的秘藏（`TreasureDef`，按 `content.destinations` 顺序）。
   *
   * 语义与 `newSynergies` 严格同形（差集、引擎算、演出规格由客户端按图鉴定）——
   * 两者是同一条设计的两半，形状不同只会让客户端写两套接线。
   */
  newTreasures: TreasureDef[];
}

/** [S2] `performAction` 的行动参数。探索用去处，狩猎用打法。 */
export interface ActionOptions {
  /**
   * 去哪一处（`DestinationDef.id`）。
   *
   * **`explore` 必填**（缺省／不认识／门槛未达一律抛错），别的行动**必须不填**
   * （填了也抛错）。刻意不做「不填就去兽径」的兜底：那会留下两套语义 ——
   * 一个忘了传目的地的调用点会静默退回旧行为，而那正是这一批要消灭的东西。
   */
  destinationId?: string;
  /**
   * [饥饿节奏批] 这一季**怎么猎**：`"stalk"` 进追猎屏（缺省）／`"quick"` 一次点击就了。
   *
   * 只属于 `hunt`（别的行动填了抛错，同 `destinationId` 那条纪律）。**这一位允许缺省**，
   * 而去处不允许 —— 分别在于缺省值的语义：`"stalk"` 就是这一批之前唯一存在的行为，
   * 漏传拿到的是原样而不是「第二套语义」。
   */
  huntMode?: HuntMode;
}

/**
 * [饥饿节奏批] 速猎按钮的只读预览。纯函数、零副作用、**不消耗任何抽取**。
 *
 * 存在的理由与 `stalkPreview` 逐字同形：**没有预览的按钮就是翻牌**（M1-P1 铁律）。
 * 而这一批新加的决定恰恰是「这一季走哪条狩猎路」——两颗按钮并排，玩家要能一眼比出
 * 「五息周旋换全额与余粮」和「一息了事换六成的肉、没有余粮」。
 */
export interface QuickHuntPreview {
  /** 得手率（已按 minChance／maxChance 夹紧） */
  chance: number;
  /** 得手回多少饱食（＝ 一趟追猎总值 × `quickHuntFoodMul`，已取整） */
  foodGain: number;
  /** 追猎得手**当场**回多少饱食 —— 摆在一起才比得出折扣 */
  stalkFoodGain: number;
  /**
   * 一趟追猎的**总值** ＝ 当场那一口 ＋ 缺省食余（`huntFoodGain + huntSurplusSeasons × huntSurplusGain`）。
   *
   * 报出来是因为界面要用它算「一次得手够几季」（饱食详情那一行）——
   * 让客户端自己把这三项乘加一遍，就是把引擎的公式抄进了 tale-client，
   * 而这一份抄本会在下一次调参时与 `quickHuntFoodOf` 分家。
   */
  stalkWorth: number;
  /** 精气折扣（0.5 ＝ 只得半份），界面据它写「半份精气」 */
  essenceMul: number;
  /** 追猎得手留下的食余季数（速猎恒为 0，这里报的是**对照**那一份的缺省值） */
  stalkSurplusSeasons: number;
  /** 食余每季回多少饱食 */
  surplusGain: number;
}

/**
 * 蛰伏开奖结果。`candidates` 是加权抽出的候选，`chosen` 是其中等权抽中的那个。
 *
 * ⚠️ `candidates`／`chosen` 是 `content.organs` 里那些对象的**只读引用**（不拷贝，
 * 因为 OrganDef 是纯静态定义）。界面渲染开奖卷轴时只读不写。
 */
export interface MoltResult {
  candidates: OrganDef[];
  chosen: OrganDef;
  essenceType: EssenceType;
}

/**
 * `resolveChoice` 的结果。
 *
 * `delta` 是被抽中分支**声明**的 effects（未夹紧的原始值，供界面做数值飘字）。它是
 * 内容对象的**深拷贝** —— 界面可以随便就地归一化它，不会污染 `TaleContent` 里那份
 * 事件数据（否则同种子同抉择的下一次结算就变了，直接击穿确定性承诺）。
 */
export interface ChoiceResult {
  state: TaleState;
  outcomeText: string;
  delta: EffectDelta;
  /** [S1] 这一次抉择（`addOrganId`）**新凑齐**的组合；语义同 `TurnResult.newSynergies` */
  newSynergies: SynergyDef[];
  /**
   * [S2] 这一次抉择（`findTreasureId`）**新得到**的秘藏；语义同 `TurnResult.newTreasures`。
   *
   * 秘藏事实上**只从这条路来**（秘藏挂在事件的某个结果分支上），`TurnResult` 那一份是
   * 为了两条路形状一致 —— 客户端一处接线接住两边。
   */
  newTreasures: TreasureDef[];
}

/**
 * 单个交锋回合的结果。`over` 非 null 时 `state.encounter` 已置 null。
 *
 * 四种收束（[M1-P2] `escaped` 是新加的）：
 * - `win` 打死它，吞精气回饱食；`dead` 被打死（ending＝slain）；`fled` **我方**逃脱。
 * - `escaped` **它**遁走了 —— 玩家什么也没得到。这条分支的存在让「咬腿」有了独一份的用处
 *   （迟滞拦得住要逃的敌人），也让「意图预告」有了真正的赌注：读错一次就丢一顿肉。
 */
export interface CombatTurn {
  state: TaleState;
  roundLog: string[];
  over: "win" | "fled" | "dead" | "escaped" | null;
}

/**
 * [M1-P1 正本] 单个追猎动作的结果。
 *
 * `over` 为 `caught`／`escaped`／`exhausted` 时 `state.encounter` 已置 null，**且本季在这一刻
 * 才收束**（季推进＋死亡判定都在这一步跑完，见 `closeSeason`）——「起追」那一次
 * `performAction` 只把猎物摆上来。
 * [M2-B1] `combat` ＝ **转进交锋阶段**（同一个 `encounter`，`phase` 变成 `clash`）——
 * 这一季**不收束**，遭遇还没打完。
 */
export interface StalkTurn {
  state: TaleState;
  roundLog: string[];
  over: "caught" | "escaped" | "exhausted" | "combat" | null;
}

/**
 * [M1-P1 正本 ＋ 补全] 追猎屏的只读预览。纯函数、零副作用，同一 state 调多少次都一样。
 *
 * ## 为什么是超集
 * 正本给的四个字段（`pounceChance`／`creepGain`／`alertVisible`／`windVisible`）**撑不起
 * P1 交付线自己的要求**：「动作按钮要显示预期效果（潜行会拉近多少、**警觉涨多少**）」。
 * 警觉增益要乘风向、贴近程度与静步 tag 三个系数 —— 让界面自己算等于把公式抄进
 * tale-client（破「客户端零游戏逻辑」），让界面不显示则等于按钮又变回翻牌。
 * 所以按正本的四个字段做**加法**：任何照正本写的消费方逐字可用，多出来的字段各自标了
 * `[P1 补]`，并在此说明它们为什么非有不可。
 */
export interface StalkPreview {
  /** [正本] 此刻扑击的命中率（已按 minChance／maxChance 夹紧） */
  pounceChance: number;
  /** [正本] 此刻潜行能拉近的步数（距离不足时就是剩下那点） */
  creepGain: number;
  /** [正本] 看得见**精确**警觉数值（否则界面只该给「未觉／有疑／欲遁」三档） */
  alertVisible: boolean;
  /** [正本] 看得清风向（否则界面只该给「风势难辨」） */
  windVisible: boolean;
  /** [P1 补] 潜行会涨多少警觉 —— 没有它，潜行按钮就是「点了才知道」 */
  creepAlertGain: number;
  /** [P1 补] 潜行之后再扑的命中率：让「再近一步值不值」是算得出来的，而不是赌的 */
  pounceChanceAfterCreep: number;
  /** [P1 补] 绕至上风的警觉代价 */
  circleAlertGain: number;
  /** [P1 补] 已在上风（此时绕行纯属白费一息；`windVisible` 为假时界面不该泄露它） */
  alreadyUpwind: boolean;
  /** [P1 补] 屏息一次能压下多少警觉（受 0 下限约束，已按当前警觉截断） */
  waitAlertDrop: number;
  /** [P1 补] 失手／受惊时猎物反扑而非逃走 —— 扑之前就该知道赌注有多大 */
  retaliates: boolean;
  /** [P1 补] 还剩几个动作（含这一次）；1 ＝ 此后再无力追 */
  staminaLeft: number;
  /**
   * [S3 补] 这一头**已入图鉴**（花血统点参透过它）—— `alertVisible` 的第二条来源。
   *
   * 单独报一位而不是并进 `alertVisible`：界面要说得出**为什么**读得出确数。
   * 「夜瞳读得出」与「历代所记，你认得它」是两句不同的话，而后者正是玩家花掉的那几点
   * 血统被兑现的一刻 —— 不写出来，这笔钱花得没有回响。
   */
  loreKnown: boolean;
}

/**
 * [M1-P2 正本] 搏杀屏的全部只读数（纯函数、零副作用、**不消耗任何抽取**）。
 *
 * ## 它和 `stalkPreview` 是同一件事
 * P1 验过的铁律：**没有预览的按钮就是翻牌**。搏杀有七八颗按钮，若每颗只写个名字，
 * 玩家就只能凭感觉点 —— 那就是 owner 说的「一直点点点」。所以每颗按钮按下去会发生什么
 * （伤多少、会不会招反击、附带什么、换姿态这一回合要挨多少）全部在这里算好。
 *
 * ## 伤害为什么是「中值」
 * `rollDamage` 带 ±`combatDamageJitter` 的抖动，预览报的是抖动为 0 的那个数，并同时给出
 * `damageJitter` —— 界面据此写「伤 6±1」。**不报抖动等于骗人**，只报期望值等于让玩家
 * 在第三回合发现账对不上（同 P1「潜行 +4 实扣 3.6」那条教训）。
 */
/**
 * 一个伤害数的**真实区间**。
 *
 * ## 为什么不是「中值 ± 抖动」
 * 抖动加在**乘倍率之前**、取整在**乘倍率之后**（`rollDamage`），所以
 * `round(jitter × mul)` 与真实跨度不是一回事。实测反例：base 4、倍率 0.4（咬喉打在守着的
 * 咽喉上、而它这一合又在守势）→ 「中值 1，抖动 round(1×0.4)=0」，而真跑是
 * `floor(3×0.4)=1`／`floor(4×0.4)=1`／`floor(5×0.4)=2` —— 三分之一的时候玩家挨的是
 * 按钮上写的**两倍**。code-reviewer 的 4000 场 fuzz 量到约 4% 的局面对不上账，且**全部**
 * 落在扑眼（×0.35）与咬腿（×0.7）这两颗低倍率按钮上 —— 正是整套重做最需要玩家信得过的两颗。
 *
 * 所以区间由**同一条算式**的两端算出来（`damageRange`），而不是把抖动常数乘一乘。
 * `min === max` 时界面写一个数，否则写「5〜7」。
 */
export interface DamageRange {
  /** 抖动为 0 那一掷（界面在区间退化成一点时显示它，排序/估算也用它） */
  mid: number;
  min: number;
  max: number;
}

export interface BitePreview {
  part: BodyPart;
  /** 这一咬的伤害区间（已含姿态、守备减半、守势加成） */
  damage: DamageRange;
  /** 打的正是它护着的部位 */
  guarded: boolean;
  /** [M2-B1] 打的正是**识破了的弱点** —— 无视守备减伤，且 ×`weaknessDamageMul` */
  weakPoint: boolean;
  /** 招来反击的概率；0 ＝ 不会（未打守备处／打的是弱点／它已瞎） */
  counterChance: number;
  /** 反击若中会挨多少（已含姿态、护体与体给的减伤） */
  counterDamage: DamageRange;
  /** [M2-B1] 这个部位**已经**累了几层伤（整场不消） */
  woundStacks: number;
  /**
   * [M2-B1] 这一咬还留不留得下一层伤。
   *
   * 落不下来只剩两种情形：**堆满了 `woundCap`**（那颗按钮此后只剩伤害，没有附带），
   * 以及**这一咬就把它打死了**（按 `damage.min` 判，宁可少许一件也不多许一件）。
   * 不报这一位，那颗按钮就在骗人 —— 而这恰好是「什么时候该换回收官」的信号。
   */
  woundLands: boolean;
  /** [M2-B1] 这一咬能攒到几点势（乘隙：咬中它没护着的地方多攒一点） */
  momentumGain: number;
  /** 这一咬能否拦住它这一回合的遁走（只有咬腿能，且它确实要走时才为真） */
  stopsFlee: boolean;
  /**
   * 咬完这一下之后，它这一回合若打中会挨多少 —— **附带效果当回合就生效**。
   *
   * 为什么非要单列这一位：咬腿的迟滞与扑眼的致盲都在**同一个回合内**削掉它这一下，
   * 而 `incomingDamage`（按当前状态算）看不出来。少了这一位，玩家会以为扑眼是「伤 1 的
   * 废按钮」，实际它这一手常常比咬喉少挨一半 —— 低伤那两颗的全部价值都在这儿。
   */
  incomingAfter: DamageRange;
  /** 咬完这一下之后它打空的概率（扑眼当回合就致盲） */
  incomingAfterMissChance: number;
}

export interface StancePreview {
  to: Stance;
  /** 已是这个姿态（界面不该给这颗按钮 —— 换到当前姿态只是白费一回合） */
  current: boolean;
  outMul: number;
  inMul: number;
  /** 换成这个姿态后，**这一回合**若它打中会挨多少（换姿态那一回合不出手） */
  incomingIfSwitch: DamageRange;
}

export interface CombatSkillPreview {
  /** 交给 `combatAct({ kind: "skill", skillId })` 的那个 id（器官技＝器官 id，凝成的＝`forge:<序号>`） */
  skillId: string;
  /** 器官技的来源器官；招式册里的为 null */
  organId: string | null;
  /** [S1 ＋ M2-B2] 从哪条古法习得的（`SynergyDef.id`）；器官技与自拟招为 null */
  synergyId: string | null;
  /**
   * [M2-B2] 招式册里的那一手（自拟招或古法）；器官技为 null。
   *
   * 界面据它打「凝」印、写出三件部件 —— 一颗自己拼出来的按钮必须看得出是自己拼的，
   * 否则凝招那一屏的所有决定在战斗屏上就消失了。
   */
  forged: ForgedSkill | null;
  name: string;
  desc: string;
  /** [S1] 附带效果（可多条；空数组＝纯伤害） */
  effects: CombatSkillEffect[];
  /** 这一回合**能不能使**＝冷却已好 **且** 付得起代价 */
  ready: boolean;
  /** 还要等几回合（0 ＝ 冷却已好） */
  cooldownLeft: number;
  /** 用掉之后要等几回合 */
  cooldown: number;
  /** [S1] 代价；null ＝ 无代价 */
  cost: CombatSkillCost | null;
  /**
   * [S1] 付得起代价（`hp` 类要求付完还活着 —— 自伤致死的按钮是陷阱，不是取舍）。
   *
   * 与 `cooldownLeft` 分开报是因为**不可用的原因不同**，而按钮上要写清是哪一个：
   * 「还需 2 合」是等得到的，「鳞之精气不足」是这一架里等不到的（得去猎）。
   */
  affordable: boolean;
  /** [M2-B1] 这一手要花几点势 */
  momentumCost: number;
  /** [M2-B1] 势够不够 —— 与冷却、代价并列的第三种「为什么按不了」 */
  hasMomentum: boolean;
  /** 伤害区间（`heal` 类与纯效果类恒为 0） */
  damage: DamageRange;
  /** [M2-B2] 这一手顺带断的部位（null ＝ 不断伤）—— 按钮上「断腿 1 → 2」那一行 */
  woundPart: BodyPart | null;
}

/**
 * [M2-B1] 「决杀」的预览 —— 攒够势才出得来的那一记。
 *
 * 它不是第四颗咬击：**吃掉全部的势**、伤害随攒到的势线性放大、且**无视守备减伤**。
 * 势没攒够时 `ready` 为假、`damage` 恒为 0，界面据此把它显示成一颗灰着的、写明
 * 「还差几点势」的按钮 —— 看得见的目标比看不见的按钮值钱。
 */
export interface FinisherPreview {
  /** 按下去会花掉多少势（＝当前全部的势） */
  momentumCost: number;
  /** 至少要攒到多少才按得动 */
  momentumNeeded: number;
  ready: boolean;
  damage: DamageRange;
  /**
   * [M2-B3] 势已经攒满了 —— **再攒也是白攒**（溢出的部分直接丢掉）。
   *
   * 它存在的理由是 B3 的克制矩阵量出来的一个空洞：决杀的倍率随势线性走
   * （`1.4 + 0.22×势`），而灵性 build 买到的正是**更高的上限**；可推荐链一到门槛
   * （4 点）就发，于是「上限 5」与「上限 9」打出来的是同一记决杀 ——
   * 灵在整张矩阵上的平均胜率与基础 build **只差 0.1 个点**。
   * 屏幕上与推荐链都要读得出「满没满」，「攒」才是一个真的动作。
   */
  atMax: boolean;
}

/**
 * [M2-B1] 四项属性**此刻**各自在做什么 —— owner 那句「好好展示积累的各项指标的作用」
 * 的落点。
 *
 * 全部是**数**，措辞归客户端（tale-client 零游戏逻辑：它只负责念，不重算公式）。
 * 每一项都能在屏幕上找到对应的一行，四项都不许只活在公式里：
 *
 * | 属性 | 它在这一屏上是什么 |
 * |---|---|
 * | 猛 | 咬击的基础伤害（`biteBase` 里 `mengBiteBonus` 那一份）、扑击命中的加成 |
 * | 体 | 交锋血上限（`hpMax`）与每次受伤的减免（`toughness`） |
 * | 灵 | 势的上限与起手势、看破弱点要几合、遁走成功率 |
 * | 德 | 闪避、暴击，以及**把它的退意抬高多少倍**（凶兽也敬三分） |
 */
export interface EncounterStats {
  meng: number;
  ti: number;
  ling: number;
  de: number;
  /** 一咬的基础伤害（未乘部位／姿态倍率） */
  biteBase: number;
  /** 其中猛贡献的那一份 */
  mengBiteBonus: number;
  /** 交锋血上限 ＝ round(体 × combatHpPerTi) */
  hpMax: number;
  /** 每次受伤减免（体给的） */
  toughness: number;
  momentumMax: number;
  /** 这场遭遇的起手势（灵给的，被扑个正着要扣） */
  momentumStart: number;
  /** 光靠「看」识破弱点需要几合（灵越高越少） */
  weaknessRoundsBase: number;
  fleeChance: number;
  dodgeChance: number;
  critChance: number;
  /** 德把它「逃」意的权重抬高的倍数 */
  enemyFleeMul: number;
  /** 接近阶段：猛给扑击命中率的加成 */
  pounceChanceBonus: number;
}

/**
 * [M2-B1] 遭遇屏的**公共**只读数 —— 接近与交锋两个阶段共用的那一套语汇。
 *
 * 见 `encounterPreview`。两个阶段各自的量仍归 `stalkPreview`／`combatPreview`。
 */
export interface EncounterPreview {
  enemyId: string;
  enemyName: string;
  enemyDesc: string;
  /**
   * [M2-B3] 这一头的头像该用谁的（`EnemyDef.artId ?? id`）—— 界面拼图路径时读它。
   *
   * 由引擎给而不是让客户端自己查表：`EncounterPreview` 已经在给 name／desc 这类
   * 「界面要念的东西」，再让客户端为一个字段单独遍历一次 `content.enemies`，
   * 就是把同一条查表写在两处。
   */
  enemyArtId: string;
  /**
   * [M2-B3] 这一头兽的三个部位**该怎么念**（喉与眼对所有兽都一样，腿走 `EnemyDef.legWord`）。
   *
   * 由引擎给而不是让客户端拿 `BODY_PART_NAMES` 自己查：那张表里的「后腿」在一条长着鸟翼的鱼
   * 身上是错的，而客户端若要正确地念就得先拿到 `EnemyDef` —— 那是把同一条查表写在两处。
   */
  partNames: Record<BodyPart, string>;
  origin: EncounterOrigin;
  phase: EncounterPhase;
  momentum: number;
  momentumMax: number;
  /** 每个交锋回合自涨多少势 */
  momentumPerRound: number;
  /** 决杀的势门槛 */
  finisherMomentum: number;
  wounds: Record<BodyPart, number>;
  woundCap: number;
  /** 腿伤已到「它再也走不掉」那一层 */
  legCrippled: boolean;
  /** 眼伤已到「它不再反击」那一层 */
  eyeRuined: boolean;
  stageIndex: number;
  stageCount: number;
  /** 当前行为段的名字（这头兽只有一段时为 null） */
  stageName: string | null;
  weaknessPart: BodyPart | null;
  weaknessName: string | null;
  weaknessFound: boolean;
  /** 光靠看还差几合识破（已识破／没有弱点时为 0） */
  weaknessRoundsLeft: number;
  /** 靠试还差几次咬中识破（同上） */
  weaknessHitsLeft: number;
  stats: EncounterStats;
  /**
   * [M2-B3] 食之所偏：吃下这一头，攒的是哪几件部件的本钱（顺序恒按 `EnemyDef.partBias`）。
   *
   * 见 `EnemyDef.partBias` 的注释：这是「去哪儿打什么」与「凝得出什么招」之间那条链
   * 唯一写在屏幕上的地方。空数组 ＝ 内容没给这一头写偏好（界面就不出这一行）。
   */
  partBias: readonly EnemyPartBias[];
  /** 整场遭遇的日志（两个阶段同一条） */
  log: string[];
}

/** [M2-B3] 「食之所偏」的一项 —— 数与判断都由引擎给，措辞归客户端。 */
export interface EnemyPartBias {
  partId: string;
  partName: string;
  /** 凝这一件起手要付的精气型（＝产出它的那件器官的 affinity） */
  essenceType: EssenceType;
  /** 产出它的那件器官**已经在身上**（于是这一件此刻就拼得进招式框） */
  owned: boolean;
}

export interface CombatPreview {
  /** 我方姿态 */
  stance: Stance;
  /** 敌人护着的部位（对谁都可见） */
  guardPart: BodyPart;
  /**
   * [M2-B3] 这一头兽的三个部位该怎么念（同 `EncounterPreview.partNames`，理由见那一处）。
   *
   * 交锋屏上「护 后腿」「它正护着后腿」两句读的就是它 —— 而蠃鱼没有后腿。
   */
  partNames: Record<BodyPart, string>;
  /** 敌人这一回合宣告的意图（**精确**值；无 `combatIntentTags` 时界面不该显示 kind 与 text） */
  intent: EnemyIntent;
  /** 读得出确切意图（洞察类器官／明识／[S3] 图鉴知识）—— 否则只该给 `intentClass` 那两档 */
  intentKnown: boolean;
  /**
   * [S3] 这一头**已入图鉴**（花血统点参透过它）—— `intentKnown` 的第三条来源。
   *
   * 与 `StalkPreview.loreKnown` 同一个理由：屏幕上要说得出**为什么**这一场读得出意图。
   * 三条来源在界面上是三句不同的话（器官／明识这一段／历代所记）。
   */
  loreKnown: boolean;
  /** 人人都读得出的粗档：`act` 要出手／`hold` 按兵不动（守与逃在这一档里分不出来） */
  intentClass: "act" | "hold";
  /** 三个部位，顺序恒为 喉→腿→眼 */
  bites: BitePreview[];
  /** 三种姿态，顺序恒为 伏低→正对→扑击（含当前姿态，`current` 为真） */
  stances: StancePreview[];
  /**
   * [S1] **技能池**：持有的全部器官技 ＋ 已凑齐的组合技，顺序恒为「器官技（按 `organIds`）
   * → 组合技（按 `content.synergies`）」。空数组＝这一世还没有技。
   *
   * S1 之前这里只有一件器官的技（`combatSkillOrgan` 是 `.find`），身上五件带技器官也只
   * 用得上一件 —— 「组合」的可能性为零。现在它是池子，界面把全部技（含冷却态与
   * 不可用原因）摆在同一屏。
   */
  skills: CombatSkillPreview[];
  /** [M2-B1] 决杀（攒够势才 `ready`） */
  finisher: FinisherPreview;
  /** [M2-B1] 当前势与上限 —— 界面的势条读它 */
  momentum: number;
  momentumMax: number;
  /** [M2-B1] 三处部位伤的层数（整场累积） */
  wounds: Record<BodyPart, number>;
  /** [M2-B1] 它当前行为段的名字（单段的兽为 null） */
  stageName: string | null;
  /** [M2-B1] 它的弱点在哪个部位（没有弱点为 null；**未识破时界面不该显示它**） */
  weaknessPart: BodyPart | null;
  weaknessFound: boolean;
  fleeChance: number;
  /** 它这一回合若打中，会挨多少（已含意图倍率、姿态、迟滞、护体） */
  incomingDamage: DamageRange;
  /** 它打空的概率（技能致盲 ＋ 每层眼伤） */
  incomingMissChance: number;
  /** [M2-B1] 德给的闪避概率（它打中了也可能被整下躲开） */
  dodgeChance: number;
  /** [M2-B1] 德给的暴击概率 */
  critChance: number;
  /** [M2-B1] 体给的受伤减免（已经算进上面所有的受伤区间里，这里同报一份供界面说明来源） */
  toughness: number;
  /** 期望受伤 ＝ `incomingDamage × (1 − 打空) × (1 − 闪避)` */
  incomingExpected: number;
  /**
   * 还撑得住几回合（**估**）：按「它常规出一手」算，不按这一回合的意图算。
   *
   * 用常规手而不是当前意图：它这回合守着不打，`roundsToLive` 不该跳成 99 —— 这个数要
   * 回答的是「我还能不能在这儿再耗两合」，那是跨回合的问题。它是「什么时候该逃」的依据。
   */
  roundsToLive: number;
  /** 还要几下能打死它（估，按当前最强的一咬算） */
  roundsToKill: number;
  /** [S1] 双方血量 —— 界面本来就从 `encounter.clash` 读，这里同报一份是为了让 `recommendCombatAct`
   *  只吃 `CombatPreview` 一个入参（「这一手打不打得死它」算不出来的话，推荐链就只能猜） */
  enemyHp: number;
  playerHp: number;
  /** [M2-B1] 交锋血上限 ＝ round(体 × combatHpPerTi) */
  playerHpMax: number;
  blind: number;
  slow: number;
  ward: number;
  /** [S1] 敌人流血剩余回合（每回合末它自己掉血） */
  bleed: number;
  /** [S1] 我方反刺剩余回合（它每命中我一次就自伤） */
  thorns: number;
  /** [S1] 我方明识剩余回合（期间 `intentKnown` 为真，哪怕没有洞察器官） */
  insight: number;
  /** 它这一回合真的会走掉（意图＝逃且未被迟滞）—— 不拦就什么都拿不到 */
  enemyWillFlee: boolean;
}

// ===== 保留 flag =====

/** 上一季饱食已 ≤0（再连续一季即饿死）。 */
export const SYS_FLAG_STARVING = "sys:starving";

/**
 * [2026-08-13] 「尝过神兽」—— 登神那条道的门槛之一。
 *
 * 两个来源，一份 flag：搏杀战胜带 `tuning.wayDivineTag` 的敌人（引擎自己记），
 * 或内容在某个 outcome 上写 `devourDivine: true`（「垂死应龙」那一类不经搏杀的因缘）。
 * 做成 `sys:` 保留 flag 而不是普通内容 flag：内容能**写**它（经 `devourDivine` 那道门），
 * 但不能 `removeFlags` 把它摘掉 —— 一桩已经发生的事迹不该被另一个事件抹掉。
 */
export const SYS_FLAG_DIVINE_EATEN = "sys:divine-eaten";

/**
 * [2026-08-13] 四条道各自的「已够格」flag。成道事件靠 `requiresFlags` 入池。
 *
 * 归山那一条也照挂 —— 它没有成道事件（在寿终那一刻直接判），但挂上之后
 * 「四条道的资格位」是同一套实现、同一处刷新（`refreshWayFlags`），没有例外分支。
 */
export const WAY_FLAGS: Record<WayId, string> = {
  shen: "sys:way-shen",
  yaowang: "sys:way-yaowang",
  guishan: "sys:way-guishan",
  hualing: "sys:way-hualing",
};

/**
 * 登神那条道的资格 flag。
 *
 * M0/M1 时它叫「登神门槛已满足」，值是 `sys:ascend-ready`；2026-08-13 起登神只是四条道
 * 之一，于是它就是 `WAY_FLAGS.shen`。名字保留是因为「天命」事件与既有测试都按这个名字
 * 引用它 —— 但**值变了**，内容里不要再写字面量。
 */
export const SYS_FLAG_ASCEND_READY = WAY_FLAGS.shen;

/** 四道的固定顺序（界面横带、`waysProgress().ways`、成道兜底选择都按它）。 */
export const WAY_ORDER: readonly WayId[] = ["shen", "yaowang", "guishan", "hualing"];

const ESSENCE_ORDER: readonly EssenceType[] = ["zu", "lin", "xue", "meng"];
const WINTER: Season = 3;
/** 部位的固定顺序（预览与界面按钮都靠它，别改） */
const BODY_PARTS: readonly BodyPart[] = ["throat", "leg", "eye"];
/** 姿态的固定顺序 */
const STANCES: readonly Stance[] = ["low", "square", "lunge"];
const INTENT_KINDS: readonly EnemyIntentKind[] = ["pounce", "bite", "guard", "flee"];

// ===== 通用小工具 =====

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

function clampStats(stats: Stats): Stats {
  return {
    meng: clamp(stats.meng, 0, 100),
    ling: clamp(stats.ling, 0, 100),
    ti: clamp(stats.ti, 0, 100),
    de: clamp(stats.de, 0, 100),
  };
}

function addStats(base: Stats, delta?: Partial<Stats>): Stats {
  if (!delta) return { ...base };
  return clampStats({
    meng: base.meng + (delta.meng ?? 0),
    ling: base.ling + (delta.ling ?? 0),
    ti: base.ti + (delta.ti ?? 0),
    de: base.de + (delta.de ?? 0),
  });
}

function addEssence(
  base: Record<EssenceType, number>,
  delta?: Partial<Record<EssenceType, number>>,
): Record<EssenceType, number> {
  if (!delta) return { ...base };
  const out = { ...base };
  for (const type of ESSENCE_ORDER) {
    out[type] = Math.max(0, out[type] + (delta[type] ?? 0));
  }
  return out;
}

function withoutFlags(flags: readonly string[], remove: readonly string[]): string[] {
  const drop = new Set(remove);
  return flags.filter((flag) => !drop.has(flag));
}

function withFlags(flags: readonly string[], add: readonly string[]): string[] {
  const out = [...flags];
  for (const flag of add) if (!out.includes(flag)) out.push(flag);
  return out;
}

/** `sys:` 前缀是引擎保留命名空间，内容侧只读不写。 */
const SYS_FLAG_PREFIX = "sys:";

/**
 * 过滤掉内容想写的 `sys:` flag。
 *
 * 不是洁癖：`addFlags: ["sys:starving"]` 会让玩家**一个饥荒季就饿死**（规格要求连续
 * 两季），`removeFlags: ["sys:starving"]` 则等于饿死免疫 —— 内容一个手误就能改掉规则。
 * 光靠注释约定挡不住 44 个手写事件，这里做成硬约束。
 */
function contentFlags(flags: readonly string[]): string[] {
  return flags.filter((flag) => !flag.startsWith(SYS_FLAG_PREFIX));
}

/** 深拷贝一个 EffectDelta，切断与 content 里那份事件数据的引用关系。 */
function cloneDelta(delta: EffectDelta): EffectDelta {
  const out: EffectDelta = { ...delta };
  if (delta.stats) out.stats = { ...delta.stats };
  if (delta.essence) out.essence = { ...delta.essence };
  if (delta.addFlags) out.addFlags = [...delta.addFlags];
  if (delta.removeFlags) out.removeFlags = [...delta.removeFlags];
  return out;
}

/** 浅拷贝 state 并把所有可变容器换成新实例，之后只改这个 draft。 */
function draftOf(state: TaleState): TaleState {
  return {
    ...state,
    stats: { ...state.stats },
    essence: { ...state.essence },
    organIds: [...state.organIds],
    flags: [...state.flags],
    firedOnceIds: [...state.firedOnceIds],
    // [S2] 两个新的可变容器 —— 漏拷会让「不改动入参」那条测试变红（同 M1-P2 的 intent）
    visitedDestinationIds: [...state.visitedDestinationIds],
    foundTreasureIds: [...state.foundTreasureIds],
    // [S3] 同上。`loreEnemyIds` 一世不变（降世时定），但照拷不误 —— 少一处「这个数组能不能改」的例外
    metEnemyIds: [...state.metEnemyIds],
    loreEnemyIds: [...state.loreEnemyIds],
    /*
     * [M2-B1] 一个遭遇位替掉了旧的 combat/stalk 两位。里面有五个可变容器要各拷一份
     * （日志／部位伤／接近／交锋／交锋里的 intent 与 skillCooldowns）—— 漏掉任何一个
     * 都会让「不改动入参」那条测试变红，而那正是这一层唯一的看门人。
     */
    encounter: state.encounter
      ? {
          ...state.encounter,
          wounds: { ...state.encounter.wounds },
          log: [...state.encounter.log],
          approach: state.encounter.approach ? { ...state.encounter.approach } : null,
          clash: state.encounter.clash
            ? {
                ...state.encounter.clash,
                intent: { ...state.encounter.clash.intent },
                skillCooldowns: { ...state.encounter.clash.skillCooldowns },
              }
            : null,
        }
      : null,
    records: [...state.records],
  };
}

// ===== 内容查询 =====

/**
 * 器官查表：`content.organs` ∪ 各神种自带的第 0 器官。
 *
 * ⚠️ 神种器官**只**存在于 `content.seeds[].organ`，在 `content.organs` 里查不到 ——
 * 任何「把 organIds 还原成 OrganDef」的地方都必须走这个并集，否则玩家的神种 tag
 * 会凭空消失。所以下面三个查询是**公开** API，B3 别自己重写。
 */
export function organIndex(content: TaleContent): Map<string, OrganDef> {
  const index = new Map<string, OrganDef>();
  for (const organ of content.organs) index.set(organ.id, organ);
  for (const seed of content.seeds) index.set(seed.organ.id, seed.organ);
  return index;
}

/** 当前持有的器官定义（顺序同 `state.organIds`，[0] 为神种器官）。查不到的 id 跳过。 */
export function ownedOrgans(state: TaleState, content: TaleContent): OrganDef[] {
  const index = organIndex(content);
  const owned: OrganDef[] = [];
  for (const id of state.organIds) {
    const organ = index.get(id);
    if (organ) owned.push(organ);
  }
  return owned;
}

/**
 * 当前持有的全部器官 tag 并集。
 * B3 渲染「不满足门槛的抉择置灰并显示原因」时用它算缺哪个 tag。
 */
export function ownedTags(state: TaleState, content: TaleContent): Set<string> {
  const tags = new Set<string>();
  for (const organ of ownedOrgans(state, content)) {
    for (const tag of organ.tags) tags.add(tag);
  }
  return tags;
}

/**
 * [S1] 已凑齐的器官组合（按 `content.synergies` 顺序）。
 *
 * 判据只有一条：配方里的每一件器官都在身上（`organIds`）。**不看是怎么来的** ——
 * 蛰伏开出来的、事件送的、血脉带来的，一样算。
 */
export function ownedSynergies(state: TaleState, content: TaleContent): SynergyDef[] {
  const owned = new Set(state.organIds);
  return content.synergies.filter((synergy) => synergy.organIds.every((id) => owned.has(id)));
}

/*
 * [S1 → M2-B2] `SYNERGY_SKILL_PREFIX`（`"syn:"`）已删。
 *
 * 组合技不再自己生成 `skillId`：它们降级成了**古法**，要经 `learnLore` 进招式册，
 * 拿到的是 `forge:<序号>`（`FORGE_SKILL_PREFIX`）。留着一个不再有人生成的 id 前缀，
 * 下一个人一定会拿它去查冷却表，然后困惑于为什么永远查不到 —— 同 `combatSkillOrgan`
 * 那次删除的理由。
 */

// ===== 探索去处（S2）=====

/**
 * [S2] 一处去处摊开给玩家看的**全部**东西 —— 按钮上那几行字的唯一来源。
 *
 * 沿用 M1 追猎屏的铁律：没有预览的按钮＝翻牌。所以这里既有「去得了吗、缺什么」，
 * 也有「去了大概会怎样」（遇事概率／遇袭概率／此地有什么／路费）。界面不许自己算
 * 任何一项 —— 那会让屏幕上的数与引擎的数在下一次调参时分家。
 */
export interface DestinationPreview {
  def: DestinationDef;
  /** 门槛已达（或本就无门槛） */
  unlocked: boolean;
  /** 还缺哪几件器官（已开启则空数组）—— 界面按 `organIndex` 翻成名字 */
  missingOrganIds: string[];
  /** 这一季在此地撞上一桩事的概率（已含天时／出身的调参与该处的 `eventMul`） */
  eventChance: number;
  /**
   * **没撞上事**时遇袭的概率（条件概率，不是每季的绝对值）。
   *
   * 界面必须照这个语义写字（「无事则约三成遇袭」），不能把它当成每季遇袭率 ——
   * 那是界面替引擎许一个它不保证的诺（legibility 批次那条 Critical 的形状）。
   */
  ambushChance: number;
  /** 此地的兽（按 `denizens` 权重降序）—— 「大概会遇到什么」 */
  ambushEnemies: EnemyDef[];
  /** 这一季净扣的饱食 ＝ 季耗（冬季加扣）＋ 此地路费 */
  hungerCost: number;
  /** 本世已到过此地 */
  visited: boolean;
  /** 本世已得此地秘藏（跨世那一份在 `Bloodline`，引擎不认识） */
  treasureFound: boolean;
  /**
   * [S3] 这一处是**靠图录**开的（门槛并没有凑齐）。
   *
   * 界面据它把「尚不得其门 —— 需 鳞甲、浮鳔」换成「图录在手 —— 此番不必其门」：
   * 两种「可去」在按钮上必须读得出分别，否则玩家会以为自己已经凑齐了那两件器官。
   */
  chartedOpen: boolean;
}

/** 去处查表（id → def）。 */
export function destinationById(content: TaleContent, id: string): DestinationDef | null {
  return content.destinations.find((destination) => destination.id === id) ?? null;
}

/**
 * [S2] 门槛已达？无门槛（兽径）恒为真。
 *
 * [S3] **图录**是第二条通路：这一世带着某处的图录，那一处不必其门也进得去
 * （`TaleState.chartedDestinationId`）。判据只有这一处 —— `resolveDestinationArg`、
 * `destinationPreview` 与界面的置灰全部经由它，所以「图录能进而按钮说不能」这种分家
 * 在结构上不可能发生。
 */
function destinationUnlocked(state: TaleState, destination: DestinationDef): boolean {
  if (state.chartedDestinationId === destination.id) return true;
  const owned = new Set(state.organIds);
  return destination.requiresOrganIds.every((id) => owned.has(id));
}

/**
 * [S2] 全部去处的预览，**含未开启的**（按 `content.destinations` 顺序，恒定不重排）。
 *
 * 未开启的照样返回：它们是**欲望展示位**（同 M1 的置灰抉择、S1 的置灰技能）。
 * 顺序恒按内容表，不因开启与否重排 —— 位置固定，玩家才记得住「第四格还差一件浮鳔」。
 */
export function exploreDestinations(state: TaleState, content: TaleContent): DestinationPreview[] {
  return content.destinations.map((destination) => destinationPreview(state, content, destination));
}

/**
 * [S2] 单处预览。
 *
 * @throws 传了不认识的 id（内容与界面对不上是 bug，不是可降级的输入）
 */
export function destinationPreview(
  state: TaleState,
  content: TaleContent,
  destination: DestinationDef | string,
): DestinationPreview {
  const def =
    typeof destination === "string" ? destinationById(content, destination) : destination;
  if (!def) throw new Error(`destinationPreview: 未知去处 ${String(destination)}`);
  const t = lifeTuning(state, content);
  const peril = t.explorePeril[def.peril];
  const owned = new Set(state.organIds);
  const seasonCost = t.hungerPerSeason + (state.season === WINTER ? t.winterHungerExtra : 0);
  const byWeight = [...def.denizens].sort((a, b) => b.weight - a.weight);
  const ambushEnemies: EnemyDef[] = [];
  for (const denizen of byWeight) {
    const enemy = enemyById(content, denizen.enemyId);
    if (enemy) ambushEnemies.push(enemy);
  }
  return {
    def,
    unlocked: destinationUnlocked(state, def),
    missingOrganIds: def.requiresOrganIds.filter((id) => !owned.has(id)),
    eventChance: exploreEventChance(t, def),
    ambushChance: ambushEnemies.length === 0 ? 0 : peril.ambushChance,
    ambushEnemies,
    hungerCost: seasonCost + peril.travelCost,
    visited: state.visitedDestinationIds.includes(def.id),
    treasureFound: state.foundTreasureIds.includes(def.treasure.id),
    // 「靠图录开的」＝ 带着这一处的图录，**且**门槛本来没凑齐（凑齐了就不是图录的功劳）
    chartedOpen:
      state.chartedDestinationId === def.id &&
      !def.requiresOrganIds.every((id) => owned.has(id)),
  };
}

/** 在某处探索时撞上事件的概率（预览与真跑共用一份算式 —— 预览不许自己再算一遍）。 */
function exploreEventChance(t: TaleTuning, def: DestinationDef): number {
  return clamp(t.eventChanceBase * t.exploreEventBonus * t.explorePeril[def.peril].eventMul, 0, 1);
}

/** [S2] 秘藏查表：全部去处的秘藏（按 `content.destinations` 顺序）。 */
export function allTreasures(content: TaleContent): TreasureDef[] {
  return content.destinations.map((destination) => destination.treasure);
}

/** [S2] 这一步**新得到**了哪些秘藏（差集，按 `content.destinations` 顺序）。 */
function newTreasuresBetween(
  before: TaleState,
  after: TaleState,
  content: TaleContent,
): TreasureDef[] {
  if (before.foundTreasureIds.length === after.foundTreasureIds.length) return [];
  const had = new Set(before.foundTreasureIds);
  return allTreasures(content).filter(
    (treasure) => after.foundTreasureIds.includes(treasure.id) && !had.has(treasure.id),
  );
}

/**
 * [S1] 这一步**新凑齐**了哪些组合（差集，按 `content.synergies` 顺序）。
 *
 * 只在「获得器官」那两条路径（蛰伏开奖／事件 `addOrganId`）之后调 —— 别处 organIds 不变，
 * 差集恒为空，白算一遍。
 */
function newSynergiesBetween(
  before: TaleState,
  after: TaleState,
  content: TaleContent,
): SynergyDef[] {
  if (before.organIds.length === after.organIds.length) return [];
  const had = new Set(ownedSynergies(before, content).map((synergy) => synergy.id));
  return ownedSynergies(after, content).filter((synergy) => !had.has(synergy.id));
}

/** [S1 ＋ M2-B2] 技能池里的一条：一个技 ＋ 它是从哪儿来的。 */
export interface CombatSkillEntry {
  /** 交给 `combatAct` 的 id（器官技＝器官 id，招式册里的＝`forge:<序号>`） */
  skillId: string;
  organId: string | null;
  /** [M2-B2] 这一手是**从哪条古法习得**的（`SynergyDef.id`）；自拟招与器官技为 null */
  synergyId: string | null;
  /** [M2-B2] 招式册里的那一手（自拟招或古法）；器官技为 null —— 界面据它打「凝」印 */
  forged: ForgedSkill | null;
  skill: CombatSkillDef;
}

/**
 * [S1 ＋ M2-B2] 这一世**全部可用的技**：器官技（按 `organIds` 顺序）＋ **招式册**里的那几手。
 *
 * ## 它替掉了 `combatSkillOrgan`
 * 那个函数是 `ownedOrgans(...).find(o => o.combatSkill)` —— **只取第一件**，而且取的是
 * `organIds` 顺序里碰巧最前的那件。身上五件带技器官也只用得上一件，于是「技能组合」
 * 在代码层面根本不存在。删掉而不是留着：留一个「只返回一件」的公开查询，下一个人
 * 一定会拿它去画技能栏，然后困惑为什么另外四件不见了。
 *
 * ## [M2-B2] 组合技**不再自动进池**
 * S1 的写法是「凑齐配方 ＝ 白拿一颗按钮」。B2 把那 10 条降级成**古法**：配方凑齐只是
 * 让它出现在招式册的货架上，要付精气、要占一个槽才用得上（`learnLore`）。
 * 理由是 owner 拍板的形态里「槽位上限是取舍不是白拿」—— 若古法照旧白拿，
 * 自拟招就永远只是「凑不齐古法时的将就」，而这一批的主张恰恰相反。
 * 发现那一刻的揭示演出照旧（`newSynergiesBetween` 一行未动）：先知道有这条古法，
 * 再决定要不要为它花精气。
 */
export function combatSkills(state: TaleState, content: TaleContent): CombatSkillEntry[] {
  const out: CombatSkillEntry[] = [];
  for (const organ of ownedOrgans(state, content)) {
    if (organ.combatSkill) {
      out.push({
        skillId: organ.id,
        organId: organ.id,
        synergyId: null,
        forged: null,
        skill: organ.combatSkill,
      });
    }
  }
  for (const forged of state.forgedSkills) {
    out.push({
      skillId: forged.id,
      organId: null,
      synergyId: forged.loreId,
      forged,
      skill: forged.skill,
    });
  }
  return out;
}

// ===== 凝招：部件拼装（M2-B2）=====

/**
 * [M2-B2] 招式框三个槽的**固定顺序** —— 界面从上到下就念这个。
 *
 * 顺序不是排版偏好：起手定这一手是什么、力道定它多重、附加定它顺带干什么 ——
 * 从「是什么」到「顺带什么」，玩家换槽时的思路也是这个方向。
 */
export const FORGE_SLOTS: readonly ForgeSlot[] = ["open", "force", "addon"];

/** [M2-B2] 招式册里那几手的 `skillId` 前缀 —— 器官 id 不许以它开头（schema 测试盯着）。 */
export const FORGE_SKILL_PREFIX = "forge:";

/**
 * [M2-B2] 十档效果各自的**单字**，拼默认名号用（「齿鬃蚀」＝ 齿起手、鬃力道、附毒）。
 *
 * 为什么要有默认名号：命名框若空着，凝招就多一次必点（还是打字那种最贵的点）。
 * 默认名号让「接受它」＝ 0 次点击，而想取名的人照样取得了 —— 同「速猎」那条：
 * 缺省要落在懒人路径上。
 */
const FORGE_EFFECT_CHAR: Record<CombatSkillEffect, string> = {
  venom: "蚀",
  bleed: "裂",
  stun: "顿",
  blind: "昧",
  armor: "护",
  thorns: "棘",
  brace: "拒",
  bolt: "遁",
  insight: "察",
  heal: "息",
};

/**
 * [M2-B2] 一个技在**这一世的属性**下打出来的伤害区间 —— 不需要在交锋中。
 *
 * `combatPreview.skills[].damage` 要 `clashOf(state)` 非空（它还要算姿态倍率），
 * 而招式册摆在主界面上，那时并没有一场架。伤害本身只跟属性与倍率有关，
 * 所以这一份单独开出来：**招式册里的每一手都要写得出伤**，否则玩家在四手之间挑一手时
 * 恰恰缺了最该看的那个数（这一条是 code review 抓出来的）。
 *
 * 与 `format.skillMulLine`（按倍率读）的分工：那一处用在**跨世**的图鉴与揭示演出上，
 * 那时没有「这一世的属性」可算；这里有。
 */
export function skillDamageRange(
  state: TaleState,
  content: TaleContent,
  skill: CombatSkillDef,
): DamageRange {
  const t = lifeTuning(state, content);
  if (!skillDealsDamage(skill, t)) return ZERO_DAMAGE;
  return damageRange(skillStatOf(skill, state.stats), t, skill.damageMul ?? t.organSkillDamageMul);
}

/** [M2-B2] 部件查表（id → def）。 */
export function partById(content: TaleContent, id: string): PartDef | null {
  return content.parts.find((part) => part.id === id) ?? null;
}

/**
 * [M2-B2] 这一世**手上有的部件**（顺序恒按 `content.parts`，含神种器官产出的那一件）。
 *
 * 顺序按内容表而不是按蜕变先后：位置固定，玩家才记得住「附加那一栏第三个是毒」——
 * 同 S2 去处那一排、S1 图鉴那一列的同一条。
 *
 * 判据只有一条：产出它的器官在身上。**不看是怎么来的** —— 蛰伏开出来的、事件送的、
 * 血脉带来的，一样算（同 `ownedSynergies`）。
 */
export function forgeParts(state: TaleState, content: TaleContent): PartDef[] {
  const owned = new Set(state.organIds);
  return content.parts.filter((part) => owned.has(part.organId));
}

/** [M2-B2] 这一世能放进某个槽的部件（顺序恒按 `content.parts`，不因可用与否重排）。 */
export function forgePartsForSlot(
  state: TaleState,
  content: TaleContent,
  slot: ForgeSlot,
): PartDef[] {
  return forgeParts(state, content).filter((part) => part[slot] !== undefined);
}

/**
 * [M2-B2] 一手招的**分量** —— 三档代价的唯一来源。
 *
 * 见 `TaleTuning` 里 forge 那一组的注释：单调公式让「严格占优」在结构上不可能
 * （更强必然更贵），而手写价目表做不到这一点。
 */
function forgePower(
  open: NonNullable<PartDef["open"]>,
  force: NonNullable<PartDef["force"]>,
  addon: NonNullable<PartDef["addon"]>,
  t: TaleTuning,
): number {
  return (
    forgeTotalMul(open, force) * t.forgePowerPerMul +
    (force.woundPart === null ? 0 : t.forgePowerWound) +
    (t.forgeEffectPower[addon.effect] ?? 0)
  );
}

/** [M2-B2] 一手招的**总系数** ＝ 起手给的 ＋ 力道追加的。这一手的伤害只由它一个数决定。 */
function forgeTotalMul(
  open: NonNullable<PartDef["open"]>,
  force: NonNullable<PartDef["force"]>,
): number {
  // 0.2 一格的两数相加会留二进制浮点尾巴（0.6+0.2 = 0.7999…），四舍到一位小数消掉它 ——
  // 否则同一副拼法的分量会随加法顺序差 0.0000001，而分量是**整数契约**（见 tuning 注释）
  return Math.round((open.damageMul + force.damageMul) * 10) / 10;
}

/**
 * [M2-B2] 分量 → 三档代价。精气型由起手那一件决定（整手招付一型，见 `ForgeCost`）。
 *
 * **精气价就是分量本身**（不缩放）—— 见 `TaleTuning` 里 forge 那一组的注释：任何缩放
 * 系数都会把两档不同的分量压到同一个价钱上，而「同价而处处不差」正是一条严格占优的
 * 拼法的定义。这一条是 `forgeDominance` 恒为 0 的结构性前提，不是随手写的。
 */
function forgeCostOf(power: number, essenceType: EssenceType, t: TaleTuning): ForgeCost {
  return {
    essenceType,
    essence: Math.max(1, Math.round(power)),
    momentum: clamp(Math.round(power / t.forgeMomentumPerPower), 1, t.forgeMomentumMax),
    cooldown: clamp(1 + Math.round(power / t.forgeCooldownPerPower), 1, t.forgeCooldownMax),
  };
}

/**
 * [M2-B2] 古法的分量：没有部件，所以按它自己那份 `CombatSkillDef` 反推
 * （系数 ＋ 每一档效果相加），再加 `forgeLoreSurcharge`。
 *
 * **同一条公式**是刻意的：古法与自拟招用两套定价，玩家就没法把两边放在一起比，
 * 而「要不要花这个槽」正是一道比较题。加价而不是乘一个倍率，理由见 tuning 那一节
 * （乘出来的小数要取整，而取整正是占优的来源）。
 *
 * ⚠️ 古法的**势与冷却照抄它自己声明的那一份**（不走公式）：它们是写死在内容里的成品，
 * 而那两个数（冷却 4〜6）正是「重手」的一半。只有精气价需要一条公式 —— S1 时组合技
 * 压根不要钱。
 */
function lorePower(skill: CombatSkillDef, t: TaleTuning): number {
  const mul = skill.damageMul ?? t.organSkillDamageMul;
  const effects = skill.effects ?? [];
  return (
    mul * t.forgePowerPerMul +
    (skill.woundPart === undefined ? 0 : t.forgePowerWound) +
    effects.reduce((sum, effect) => sum + (t.forgeEffectPower[effect] ?? 0), 0) +
    t.forgeLoreSurcharge
  );
}

/** [M2-B2] 古法的三档代价：精气走公式，势与冷却照抄成品自己声明的那一份。 */
function loreCostOf(synergy: SynergyDef, content: TaleContent, t: TaleTuning): ForgeCost {
  const skill = synergy.skill;
  return {
    essenceType: loreEssenceType(synergy, content),
    essence: Math.max(1, Math.round(lorePower(skill, t))),
    momentum: Math.max(0, Math.round(skill.momentum ?? t.encounterSkillMomentumCost)),
    cooldown: skill.cooldown ?? t.combatSkillCooldown,
  };
}

/**
 * [M2-B2] 古法习得之后付哪一型精气。
 *
 * 规则（不是价目表）：技本身若已声明精气代价就跟着它（读起来是同一件事的两面，
 * 同 S1「代价的精气型跟着 affinity 走」那条）；付血的那几条按**配方第一件器官**的
 * 部件精气型算。schema 测试钉住「每一条古法都算得出一个型」。
 */
function loreEssenceType(synergy: SynergyDef, content: TaleContent): EssenceType {
  const cost = synergy.skill.cost;
  if (cost?.kind === "essence") return cost.type;
  const firstOrgan = synergy.organIds[0];
  const part = content.parts.find((candidate) => candidate.organId === firstOrgan);
  return part?.essenceType ?? "meng";
}

/** [M2-B2] 三件部件 → 成品的 `CombatSkillDef`（结算只认它）。 */
function buildForgedSkillDef(
  name: string,
  open: NonNullable<PartDef["open"]>,
  force: NonNullable<PartDef["force"]>,
  addon: NonNullable<PartDef["addon"]>,
  cost: ForgeCost,
  desc: string,
): CombatSkillDef {
  return {
    name,
    desc,
    cooldown: cost.cooldown,
    effects: [addon.effect],
    ...(open.stat === undefined ? {} : { stat: open.stat }),
    damageMul: forgeTotalMul(open, force),
    ...(force.woundPart === null ? {} : { woundPart: force.woundPart }),
    momentum: cost.momentum,
    /*
     * **自拟招没有每次发招的 hp／精气代价** —— 它的钱在凝成那一刻一次付清（精气 ＋ 一个槽）。
     * 器官技是白拿的按钮，所以每次要付；凝成的招买断了，所以每次只付势与冷却。
     * 两种经济各管一头，屏幕上也读得出分别（招式册那一行写「已付 猛精气 18」）。
     */
  };
}

/** [M2-B2] 一句自动生成的描述 —— 招式册与按钮上那一行「这一手是什么」。 */
function forgedDesc(open: PartDef, force: PartDef, addon: PartDef): string {
  return `${open.name}起手、${force.name}发力、${addon.name}收尾 —— 你自己拼出来的一手。`;
}

/** [M2-B2] 默认名号：起手字 ＋ 力道字 ＋ 附加那一档的单字（「齿鬃蚀」）。 */
function defaultForgeNameOf(open: PartDef, force: PartDef, addon: PartDef): string {
  const tail = FORGE_EFFECT_CHAR[addon.addon?.effect ?? "venom"] ?? "击";
  return `${open.name}${force.name}${tail}`;
}

/** [M2-B2] 名号撞车时往后排（「齿鬃蚀」→「齿鬃蚀·二」）—— 招式册里两行同名读不出分别。 */
function uniqueForgeName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; i < 20; i += 1) {
    const candidate = `${base}·${cnNumeral(i)}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}·${taken.size}`;
}

/**
 * [M2-B2] 名号校验 —— 空则退回默认。
 *
 * 只许汉字（沿用 P2 那道字符集闸门的同一条理由：一个混进外文或半角标点的名字
 * 会在列传、按钮、招式册三处各难看一次），且不超过 `forgeNameMaxChars` 字。
 *
 * @throws 名字非法（界面该先拦，但引擎不许把一个坏名字写进状态）
 */
function normalizeForgeName(raw: string | undefined, fallback: string, t: TaleTuning): string {
  const name = (raw ?? "").trim();
  if (name === "") return fallback;
  if (!forgeNameValid(name, t)) {
    throw new Error(`凝招: 名号只许 ${t.forgeNameMaxChars} 字以内的汉字（「${name}」）`);
  }
  return name;
}

/**
 * [M2-B2] 这个名号收不收 —— **界面与引擎共用这一份判据**。
 *
 * 客户端拿它把「凝成」置灰并说明原因；引擎拿它兜底。各写一份的后果是屏幕上说得通、
 * 引擎却抛错（而抛错在这个项目里会打到控制台，E2E 的「0 报错」当场变红）。
 *
 * 只许汉字沿用 P2 那道字符集闸门的同一条理由：一个混进外文或半角标点的名字，
 * 在列传、按钮、招式册三处各难看一次。空名不走这里 —— 它退回默认名号。
 */
export function forgeNameValid(name: string, t: TaleTuning): boolean {
  const trimmed = name.trim();
  if (trimmed === "") return true;
  return [...trimmed].length <= t.forgeNameMaxChars && /^[一-鿿]+$/u.test(trimmed);
}

/** 内部：把三个 pick 解成部件定义，并逐条报错（界面先拦，引擎不许静默吞）。 */
function resolvePicks(
  state: TaleState,
  content: TaleContent,
  picks: ForgePicks,
): { open: PartDef; force: PartDef; addon: PartDef } {
  const owned = forgeParts(state, content);
  const take = (slot: ForgeSlot, id: string): PartDef => {
    const part = owned.find((candidate) => candidate.id === id);
    if (!part) throw new Error(`凝招: 身上没有这件部件 ${id}`);
    if (part[slot] === undefined) throw new Error(`凝招: ${part.name}放不进${FORGE_SLOT_NAMES[slot]}`);
    return part;
  };
  const open = take("open", picks.open);
  const force = take("force", picks.force);
  const addon = take("addon", picks.addon);
  if (open.id === force.id || open.id === addon.id || force.id === addon.id) {
    throw new Error("凝招: 同一件部件不能占两个槽");
  }
  return { open, force, addon };
}

/** 槽名（报错与界面共用一份，免得两处措辞分家）。 */
export const FORGE_SLOT_NAMES: Record<ForgeSlot, string> = {
  open: "起手",
  force: "力道",
  addon: "附加",
};

/**
 * [M2-B2] 凝不成／习不得的**原因代号**（措辞归客户端）。
 *
 * 分这么细是因为每一种对玩家的下一步完全不同：`essence` 是「去猎」，
 * `slots` 是「先忘掉一手」，`missing` 是「去蜕那件器官」，`learned` 是「已经有了」。
 * 一个笼统的「不可用」等于什么都没说（S1 那条：不可用的原因必须分得开）。
 */
export type ForgeBlock = "ok" | "essence" | "slots" | "missing" | "learned";

/**
 * [M2-B2] 拼装界面的**全部**只读数 —— 「每换一个部件，预览数值当场更新」的唯一来源。
 *
 * 沿用 M1 追猎屏的铁律（没有预览的按钮＝翻牌）：界面不许自己算任何一项，
 * 否则屏幕上的数与引擎的数会在下一次调参时分家。
 */
export interface ForgePreview {
  picks: ForgePicks;
  /** 成品（名号已填默认值）—— 效果、势、冷却都从它读 */
  skill: CombatSkillDef;
  /** 这一手在当前属性下打出来的伤害区间（系数与定额都算进去了） */
  damage: DamageRange;
  cost: ForgeCost;
  /** 力道那一件顺带断的部位（null ＝ 不断伤）—— 界面据它写「断腿一层」 */
  woundPart: BodyPart | null;
  /** 附加那一档效果 */
  effect: CombatSkillEffect;
  /** 按部件自动拟的名号（玩家不改就用它 —— 少一次必点） */
  defaultName: string;
  /** 这一型精气现有多少（界面画「猛 24 · 需 18」要它） */
  essenceHave: number;
  affordable: boolean;
  /** 招式册用掉几格／共几格 */
  slotsUsed: number;
  slotsMax: number;
  hasSlot: boolean;
  /** 两个条件都成立才凝得成 */
  ready: boolean;
  blocked: ForgeBlock;
}

/**
 * [M2-B2] 一条**古法**（现有的 10 条器官组合降级而来）在招式册里的样子。
 *
 * 古法是「成品」：配方凑齐即可**直接习得**，不必自己拼。它同时是新玩家的教学
 * （照着它看得懂三个槽在干什么）与「情理之中」的锚（`reveal` 那一句因果照旧）。
 * 但它**照样占一个槽、照样要付精气** —— 白拿的成品会让自拟招永远不划算。
 */
export interface LoreOption {
  synergyId: string;
  name: string;
  /** 配方器官（全部持有才习得得了） */
  organIds: readonly string[];
  /** 还差哪几件（空 ＝ 凑齐了） */
  missingOrganIds: string[];
  skill: CombatSkillDef;
  cost: ForgeCost;
  damage: DamageRange;
  essenceHave: number;
  /** 已经在招式册里了（同一条古法不许习得两次） */
  learned: boolean;
  ready: boolean;
  blocked: ForgeBlock;
}

/**
 * [M2-B2] 拼装界面的全部只读数（纯函数、不消耗抽取）。
 *
 * 界面每换一个部件就调它一次 —— 「摊开后果」这条铁律在这一批的落点就是：
 * **伤害区间、势、冷却、精气代价四项当场跟着变**，而它们只有这一处算式。
 *
 * @throws 部件不在身上、放错槽、或三槽有重样（界面该先拦住）
 */
export function forgePreview(
  state: TaleState,
  content: TaleContent,
  picks: ForgePicks,
): ForgePreview {
  const { open, force, addon } = resolvePicks(state, content, picks);
  const t = lifeTuning(state, content);
  const openPayload = open.open as NonNullable<PartDef["open"]>;
  const forcePayload = force.force as NonNullable<PartDef["force"]>;
  const addonPayload = addon.addon as NonNullable<PartDef["addon"]>;
  const cost = forgeCostOf(forgePower(openPayload, forcePayload, addonPayload, t), open.essenceType, t);
  const defaultName = uniqueForgeName(
    defaultForgeNameOf(open, force, addon),
    new Set(state.forgedSkills.map((entry) => entry.name)),
  );
  const skill = buildForgedSkillDef(
    defaultName,
    openPayload,
    forcePayload,
    addonPayload,
    cost,
    forgedDesc(open, force, addon),
  );
  const essenceHave = state.essence[cost.essenceType];
  const affordable = essenceHave >= cost.essence;
  const slotsUsed = state.forgedSkills.length;
  const hasSlot = slotsUsed < t.forgeSlots;
  return {
    picks,
    skill,
    damage: damageRange(
      skill.stat === "ling" ? state.stats.ling : state.stats.meng,
      t,
      skill.damageMul ?? t.organSkillDamageMul,
    ),
    cost,
    woundPart: forcePayload.woundPart,
    effect: addonPayload.effect,
    defaultName,
    essenceHave,
    affordable,
    slotsUsed,
    slotsMax: t.forgeSlots,
    hasSlot,
    ready: affordable && hasSlot,
    /*
     * 置灰的按钮必须说明原因，而两种原因对玩家的下一步完全不同：精气不够是「去猎」，
     * 槽满是「先忘掉一手」。这里只给**代号**，措辞归客户端 —— 引擎不写屏幕上的字
     * （同 `EncounterStats`：数由引擎给，话由界面说）。
     */
    blocked: !hasSlot ? "slots" : affordable ? "ok" : "essence",
  };
}

/**
 * [M2-B2] 凝成一手招 —— 扣精气、入册，**不掷任何骰**。
 *
 * 不掷骰是有意的：凝招是玩家自己拼出来的东西，掷骰会把「我算准了」变成「我运气好」。
 * 副作用是 `rngState` 一个字不动 —— 既存种子的剧本没有被这一批破坏。
 *
 * 它也**不推进季节**：凝招是随时可做的经营动作，做成一个「行动」会让它每次都吃掉一季
 * （而这一批的纪律是不许再推高点击与回合数）。
 *
 * @throws 部件不合法、精气不够、招式册已满、名号非法
 */
export function forgeSkill(
  state: TaleState,
  content: TaleContent,
  picks: ForgePicks,
  name?: string,
): TaleState {
  const preview = forgePreview(state, content, picks);
  if (!preview.hasSlot) throw new Error(`凝招: 招式册已满（${preview.slotsMax} 手）`);
  if (!preview.affordable) {
    throw new Error(
      `凝招: ${preview.cost.essenceType} 精气不足（需 ${preview.cost.essence}，现有 ${preview.essenceHave}）`,
    );
  }
  const t = lifeTuning(state, content);
  const taken = new Set(state.forgedSkills.map((entry) => entry.name));
  const finalName = uniqueForgeName(
    normalizeForgeName(name, preview.defaultName, t),
    taken,
  );
  const id = `${FORGE_SKILL_PREFIX}${state.forgeSeq}`;
  const forged: ForgedSkill = {
    id,
    name: finalName,
    parts: { ...picks },
    loreId: null,
    cost: preview.cost,
    skill: { ...preview.skill, name: finalName },
  };
  return {
    ...state,
    essence: addEssence(state.essence, { [preview.cost.essenceType]: -preview.cost.essence }),
    forgedSkills: [...state.forgedSkills, forged],
    forgeSeq: state.forgeSeq + 1,
    records: [
      ...state.records,
      {
        year: state.year,
        season: state.season,
        kind: "forge",
        text: render(ENGINE_MESSAGES.forge, { name: finalName, parts: forgePartNames(content, picks) }),
        refId: id,
      },
    ],
  };
}

/** 「齿、鬃、毒」—— 记录与界面共用一份措辞。 */
function forgePartNames(content: TaleContent, picks: ForgePicks): string {
  return FORGE_SLOTS.map((slot) => partById(content, picks[slot])?.name ?? "？").join("、");
}

/**
 * [M2-B2] 古法货架：**全部** 10 条（含配方没凑齐的）。
 *
 * 未凑齐的照样返回，且照写它是什么 —— 只有**已经发现过**的才列得出内容，
 * 那一位由客户端的图鉴（`Bloodline.knownSynergyIds`）把着（引擎不认识跨世资产）。
 * 顺序恒按 `content.synergies`，不因可否习得重排（同 S2 去处那条：位置固定才记得住）。
 */
export function loreOptions(state: TaleState, content: TaleContent): LoreOption[] {
  const t = lifeTuning(state, content);
  const owned = new Set(state.organIds);
  const learned = new Set(
    state.forgedSkills.map((entry) => entry.loreId).filter((id): id is string => id !== null),
  );
  const hasSlot = state.forgedSkills.length < t.forgeSlots;
  return content.synergies.map((synergy) => {
    const missingOrganIds = synergy.organIds.filter((id) => !owned.has(id));
    const cost = loreCostOf(synergy, content, t);
    const essenceHave = state.essence[cost.essenceType];
    const already = learned.has(synergy.id);
    const affordable = essenceHave >= cost.essence;
    const ready = missingOrganIds.length === 0 && !already && affordable && hasSlot;
    return {
      synergyId: synergy.id,
      name: synergy.name,
      organIds: synergy.organIds,
      missingOrganIds,
      skill: synergy.skill,
      cost,
      damage: damageRange(
        synergy.skill.stat === "ling" ? state.stats.ling : state.stats.meng,
        t,
        synergy.skill.damageMul ?? t.organSkillDamageMul,
      ),
      essenceHave,
      learned: already,
      ready,
      // 代号而不是措辞（同 `ForgePreview.blocked`）：五种原因对玩家的下一步各不相同
      blocked: already
        ? "learned"
        : missingOrganIds.length > 0
          ? "missing"
          : !hasSlot
            ? "slots"
            : affordable
              ? "ok"
              : "essence",
    };
  });
}

/**
 * [M2-B2] 直接习得一条古法（成品，不必自己拼）。
 *
 * 它与 `forgeSkill` 走同一条账：付精气、占一个槽、写一条 `forge` 记录。
 * 差别只在**这一手是谁想出来的** —— 古法带 `loreId`，界面据它打「古」印。
 *
 * @throws 不认识这条古法、配方没凑齐、已在册中、精气不够、招式册已满
 */
export function learnLore(
  state: TaleState,
  content: TaleContent,
  synergyId: string,
  name?: string,
): TaleState {
  const option = loreOptions(state, content).find((entry) => entry.synergyId === synergyId);
  if (!option) throw new Error(`习得古法: 未知古法 ${synergyId}`);
  if (option.blocked !== "ok") throw new Error(`习得古法: 此刻习不得（${option.blocked}）`);
  const t = lifeTuning(state, content);
  const taken = new Set(state.forgedSkills.map((entry) => entry.name));
  const finalName = uniqueForgeName(normalizeForgeName(name, option.name, t), taken);
  const id = `${FORGE_SKILL_PREFIX}${state.forgeSeq}`;
  const forged: ForgedSkill = {
    id,
    name: finalName,
    parts: null,
    loreId: synergyId,
    cost: option.cost,
    skill: { ...option.skill, name: finalName },
  };
  return {
    ...state,
    essence: addEssence(state.essence, { [option.cost.essenceType]: -option.cost.essence }),
    forgedSkills: [...state.forgedSkills, forged],
    forgeSeq: state.forgeSeq + 1,
    records: [
      ...state.records,
      {
        year: state.year,
        season: state.season,
        kind: "forge",
        text: render(ENGINE_MESSAGES.forgeLore, { name: finalName, lore: option.name }),
        refId: id,
      },
    ],
  };
}

/**
 * [M2-B2] 忘掉招式册里的一手，腾出槽位。**不退精气** —— 那是已经花掉的钱。
 *
 * 退钱会让「先凝一手顶着、回头再换」变成零成本，槽位上限也就不再是取舍。
 *
 * @throws 册中没有这一手
 */
export function forgetForgedSkill(state: TaleState, forgedId: string): TaleState {
  if (!state.forgedSkills.some((entry) => entry.id === forgedId)) {
    throw new Error(`遗忘: 册中没有这一手 ${forgedId}`);
  }
  return {
    ...state,
    forgedSkills: state.forgedSkills.filter((entry) => entry.id !== forgedId),
  };
}

/**
 * [M2-B2] 打开招式框时**预填**的那一套（付得起的里面分量最大的一手）；拼不出来时 null。
 *
 * 它是这一批的点击账里最要紧的一处设计：没有预填，凝一手招要点「开框 ＋ 三个槽 ＋ 凝成」
 * 五次；有了预填，接受缺省只要「开框 ＋ 凝成」两次。owner 的纪律是「凝招不得显著推高
 * 一世总点击」，而缺省必须落在懒人路径上（同「速猎」那一颗按钮的理由）。
 *
 * 挑法只读玩家看得见的东西（付得起 ＋ 分量最大），不读任何内部估值 ——
 * 它是**界面缺省**，不是「最优解」；玩家换掉它才是常态。
 *
 * ⚠️ **册里已有的那几副拼法排除在外**。没有这一条，缺省恒等于「分量最大的那一副」，
 * 于是打开招式框、凝成、再打开，四个槽会被同一手招填满 —— 实机跑出来正是
 * 「蕴鬃蚀／蕴鬃蚀·二／·三／·四」。四手一模一样的招既不是取舍，也让槽位上限失去意义。
 */
export function defaultForgePicks(state: TaleState, content: TaleContent): ForgePicks | null {
  const t = lifeTuning(state, content);
  const opens = forgePartsForSlot(state, content, "open");
  const forces = forgePartsForSlot(state, content, "force");
  const addons = forgePartsForSlot(state, content, "addon");
  const taken = new Set(
    state.forgedSkills
      .map((entry) => entry.parts)
      .filter((parts): parts is ForgePicks => parts !== null)
      .map((parts) => FORGE_SLOTS.map((slot) => parts[slot]).join("|")),
  );
  let best: { picks: ForgePicks; power: number; affordable: boolean } | null = null;
  for (const open of opens) {
    for (const force of forces) {
      if (force.id === open.id) continue;
      for (const addon of addons) {
        if (addon.id === open.id || addon.id === force.id) continue;
        if (taken.has([open.id, force.id, addon.id].join("|"))) continue;
        const power = forgePower(
          open.open as NonNullable<PartDef["open"]>,
          force.force as NonNullable<PartDef["force"]>,
          addon.addon as NonNullable<PartDef["addon"]>,
          t,
        );
        const cost = forgeCostOf(power, open.essenceType, t);
        const affordable = state.essence[open.essenceType] >= cost.essence;
        const picks: ForgePicks = { open: open.id, force: force.id, addon: addon.id };
        // 付得起的一律压过付不起的；同一档里挑分量最大的那一手
        if (
          best === null ||
          (affordable && !best.affordable) ||
          (affordable === best.affordable && power > best.power)
        ) {
          best = { picks, power, affordable };
        }
      }
    }
  }
  return best?.picks ?? null;
}

/** [M2-B2] 「现在该凝一手招了吗」的答案：习得一条古法，或按这三件部件凝一手。 */
export type ForgeIntent =
  | { kind: "lore"; synergyId: string }
  | { kind: "forge"; picks: ForgePicks };

/**
 * [M2-B2] 界面推荐的「该不该凝招」—— 与 `recommendCombatAct` 同一个定位：
 * **呈现层的建议**，纯函数、不消耗抽取、引擎自己不消费（删掉它引擎照跑）。
 *
 * 它在这里而不在客户端，理由与 S1 把推荐链上提的理由逐字相同：三个包
 * （客户端／`tale-content` 冒烟／`packages/gen` 实验台）都要「一个明理玩家会不会凝这一手」
 * 这个答案，而手抄三份的后果是**我自己的平衡数据在说谎**（实验台量的凝招节奏与玩家
 * 屏幕上被推荐的那一手不是同一个）。
 *
 * ## 两条链（每一条都只读玩家看得见的东西）
 * 1. **古法优先**：凑齐了配方、付得起、还有槽 —— 成品比自己拼的强（两档效果），
 *    而且它是这一批的教学锚。同时可得多条时挑伤害最高的那条。
 * 2. **自拟招**：`defaultForgePicks` 给的那一套，但要过一道「别花本钱」的闸 ——
 *    **付的那一型不得是当前存量最高的那一型**，因为那一型正是这一世下一次蜕变的本钱
 *    （`moltThreshold` 按单型判）。花掉它等于拿一件器官换一手招，而器官既给属性也给部件。
 *    唯一的例外是**离门槛还远**（不到一半）时：那时它是零钱不是本钱。
 *
 * 「不推荐」不等于「不许」：玩家照样凝得了（`forgeSkill` 只看精气与槽位）。
 * 这里回答的是「界面要不要提醒他」与「机器玩家会不会这么做」。
 */
export function recommendForge(state: TaleState, content: TaleContent): ForgeIntent | null {
  const t = lifeTuning(state, content);
  if (state.forgedSkills.length >= t.forgeSlots) return null;
  const lore = loreOptions(state, content)
    .filter((option) => option.ready)
    .sort((a, b) => b.damage.mid - a.damage.mid)[0];
  if (lore) return { kind: "lore", synergyId: lore.synergyId };
  const picks = defaultForgePicks(state, content);
  if (picks === null) return null;
  const preview = forgePreview(state, content, picks);
  if (!preview.ready) return null;
  const richest = ESSENCE_ORDER.reduce((top, type) =>
    state.essence[type] > state.essence[top] ? type : top,
  );
  const isSavings =
    preview.cost.essenceType === richest &&
    state.essence[richest] >= t.moltThreshold / 2;
  return isSavings ? null : { kind: "forge", picks };
}

/**
 * [M2-B2] 一手招在占优比较里的**向量**（分量越大越好的那些维度）。
 *
 * 维度选取的判据是「玩家读得到吗」：伤害区间在按钮上、效果在按钮上、断伤在按钮上，
 * 三档代价也在按钮上。读不到的东西不进向量 —— 一条玩家看不见的优势不构成「占优」。
 */
interface ForgeVector {
  label: string;
  /** 伤害（按若干参考属性各算一份 —— 见 `forgeDominance` 的注释） */
  damage: number[];
  effects: ReadonlySet<CombatSkillEffect>;
  woundLeg: number;
  woundEye: number;
  /** 代价：越小越好 */
  essence: number;
  essenceType: EssenceType;
  momentum: number;
  cooldown: number;
}

/** [M2-B2] 一条被判为严格占优的关系：`winner` 让 `loser` 从此没人会拼。 */
export interface ForgeDominancePair {
  winner: string;
  loser: string;
  why: string;
}

/**
 * [M2-B2] **严格占优闸门** —— 「有没有哪一种拼法让别的拼法从此没人会拼」。
 *
 * 手法沿用 P2 那道 AI 抉择闸门（`dominancePairs`）：把每一个候选摊成一个
 * **收益向量 ＋ 代价向量**，A 占优 B 当且仅当「A 的每一项收益都不低于 B、
 * 每一项代价都不高于 B，且至少有一项严格更好」。
 *
 * ## 三条判据上的讲究（都是这一批实测校准出来的）
 * 1. **伤害按多组参考属性各算一份**，全部满足才算占优。只按一组算的话，
 *    「灵犀起手（按灵）」在猛系参考下恒被判为劣 —— 而它对灵系 build 恰恰是唯一的输出手。
 *    一手招只在**所有** build 上都不如另一手，才谈得上「没人会拼」。
 * 2. **精气型不同的两手不可比**。付猛精气 18 与付鳞精气 18 是两笔不同的钱
 *    （而且它们各自还是不同器官线的蜕变本钱）—— 拿它们比大小是把四型精气当成一种货币。
 * 3. **效果按集合比**（⊇ 才算不低于）。十档效果各有各的局面，没有「更强的效果」这回事。
 *
 * 覆盖范围是**全枚举**：`content.parts` 里所有合法的三槽组合（含古法）两两互比，
 * 不抽样。判据、覆盖数与结论都由 `forgeDominanceReport` 报出来，写进交付报告。
 *
 * 它是**内容闸门**，引擎自己不消费它（删掉引擎照跑）—— 同 `recommendCombatAct` 的定位。
 */
export function forgeDominance(content: TaleContent, tuning?: TaleTuning): ForgeDominancePair[] {
  const t = tuning ?? content.tuning;
  const vectors = forgeVectors(content, t);
  const pairs: ForgeDominancePair[] = [];
  for (const a of vectors) {
    for (const b of vectors) {
      if (a === b) continue;
      const why = dominatesForge(a, b);
      if (why !== null) pairs.push({ winner: a.label, loser: b.label, why });
    }
  }
  return pairs;
}

/** [M2-B2] 闸门的覆盖数（报告里那一行「查了多少种拼法」）。 */
export function forgeDominanceReport(
  content: TaleContent,
  tuning?: TaleTuning,
): { combos: number; comparisons: number; pairs: ForgeDominancePair[] } {
  const t = tuning ?? content.tuning;
  const combos = forgeVectors(content, t).length;
  return {
    combos,
    comparisons: combos * (combos - 1),
    pairs: forgeDominance(content, t),
  };
}

/**
 * 参考属性组：占优必须在**每一组**上都成立。
 *
 * 三组分别是「刚降世」「猛系中期」「灵系后期」—— 覆盖 `damageMul`（随属性放大）
 * 与 `damageBonus`（定额）此消彼长的两端：属性低时定额占比大，属性高时系数占比大。
 * 只取一组会把「低属性一世也拼得出一手能打的招」这条设计判成占优。
 */
const FORGE_REF_STATS: readonly { meng: number; ling: number }[] = [
  { meng: 10, ling: 10 },
  { meng: 44, ling: 16 },
  { meng: 16, ling: 60 },
];

function forgeVectors(content: TaleContent, t: TaleTuning): ForgeVector[] {
  const out: ForgeVector[] = [];
  const opens = content.parts.filter((part) => part.open !== undefined);
  const forces = content.parts.filter((part) => part.force !== undefined);
  const addons = content.parts.filter((part) => part.addon !== undefined);
  for (const open of opens) {
    const openPayload = open.open as NonNullable<PartDef["open"]>;
    for (const force of forces) {
      if (force.id === open.id) continue;
      const forcePayload = force.force as NonNullable<PartDef["force"]>;
      for (const addon of addons) {
        if (addon.id === open.id || addon.id === force.id) continue;
        const addonPayload = addon.addon as NonNullable<PartDef["addon"]>;
        const cost = forgeCostOf(
          forgePower(openPayload, forcePayload, addonPayload, t),
          open.essenceType,
          t,
        );
        out.push({
          label: `${open.name}·${force.name}·${addon.name}`,
          damage: FORGE_REF_STATS.map(
            (stats) =>
              damageRange(
                openPayload.stat === "ling" ? stats.ling : stats.meng,
                t,
                forgeTotalMul(openPayload, forcePayload),
              ).mid,
          ),
          effects: new Set([addonPayload.effect]),
          woundLeg: forcePayload.woundPart === "leg" ? 1 : 0,
          woundEye: forcePayload.woundPart === "eye" ? 1 : 0,
          essence: cost.essence,
          essenceType: cost.essenceType,
          momentum: cost.momentum,
          cooldown: cost.cooldown,
        });
      }
    }
  }
  // 古法一并进比较池：一条定价过低的古法会让整片自拟招从此没人会拼，而那是同一种病
  for (const synergy of content.synergies) {
    const skill = synergy.skill;
    const cost = loreCostOf(synergy, content, t);
    out.push({
      label: `古法·${synergy.name}`,
      damage: FORGE_REF_STATS.map(
        (stats) =>
          damageRange(
            skill.stat === "ling" ? stats.ling : stats.meng,
            t,
            skill.damageMul ?? t.organSkillDamageMul,
          ).mid,
      ),
      effects: new Set(skill.effects ?? []),
      woundLeg: skill.woundPart === "leg" ? 1 : 0,
      woundEye: skill.woundPart === "eye" ? 1 : 0,
      essence: cost.essence,
      essenceType: cost.essenceType,
      momentum: cost.momentum,
      cooldown: cost.cooldown,
      /*
       * 古法**每次发招还要另付** hp／精气（`skill.cost`），而自拟招不必。那是一项
       * 只会让古法更贵的代价，闸门里不算它 —— 少算一项代价只会让闸门**更严**
       * （更容易判古法占优），不会漏报。
       */
    });
  }
  return out;
}

/** A 占优 B？返回一句人话的理由，或 null。 */
function dominatesForge(a: ForgeVector, b: ForgeVector): string | null {
  // 判据 2：付不同型精气的两手不可比
  if (a.essenceType !== b.essenceType) return null;
  // 判据 3：效果按集合比
  for (const effect of b.effects) if (!a.effects.has(effect)) return null;
  // 判据 1：每一组参考属性上伤害都不低
  for (let i = 0; i < a.damage.length; i += 1) {
    if ((a.damage[i] ?? 0) < (b.damage[i] ?? 0)) return null;
  }
  if (a.woundLeg < b.woundLeg || a.woundEye < b.woundEye) return null;
  if (a.essence > b.essence || a.momentum > b.momentum || a.cooldown > b.cooldown) return null;
  const better: string[] = [];
  if (a.damage.some((value, i) => value > (b.damage[i] ?? 0))) better.push("伤害更高");
  if (a.effects.size > b.effects.size) better.push("效果更多");
  if (a.woundLeg > b.woundLeg || a.woundEye > b.woundEye) better.push("多断一处");
  if (a.essence < b.essence) better.push("精气更省");
  if (a.momentum < b.momentum) better.push("势更省");
  if (a.cooldown < b.cooldown) better.push("冷却更短");
  return better.length === 0 ? null : better.join("、");
}

/**
 * [S1] 「血脉」的价钱：让下一世起手自带这一件器官要花几点血统。
 *
 * 规则（而不是一张手写价目表）：蛰伏池里开得出来的器官一律 `bloodlineBoonCost`，
 * **事件专属器官**（`affinity` 为空，永不进开奖池，今天只有龙涎）按 `bloodlineBoonRareCost`。
 * 让引擎给价而不是界面写死：价钱是规则的一部分，界面写一份就会与这里漂移。
 *
 * @throws 器官 id 不存在时抛错（内容 bug／脏存档要吵，不要静默按便宜的算）
 */
export function boonCost(organId: string, content: TaleContent): number {
  const organ = organIndex(content).get(organId);
  if (!organ) throw new Error(`boonCost: 未知器官 ${organId}`);
  const rare = Object.values(organ.affinity).every((weight) => (weight ?? 0) <= 0);
  return rare ? content.tuning.bloodlineBoonRareCost : content.tuning.bloodlineBoonCost;
}

/**
 * [S3] 「图录」的价钱：让下一世不必其门也进得去这一处，要花几点血统。
 *
 * 规则而不是手写价目表（同 `boonCost` 的理由）：`2 × 门槛件数 ＋ 风险档加价`。
 * **无门槛的去处恒返 0** —— 兽径本来就随时去得，一张走惯了的路的图卖不出钱，
 * 界面据此把它排除出货架（判据只有这一处，界面不再写第二条「兽径不卖」的 if）。
 *
 * @throws 去处 id 不存在时抛错（脏存档／内容改名要吵，不要静默按 0 算）
 */
export function chartCost(destinationId: string, content: TaleContent): number {
  const def = destinationById(content, destinationId);
  if (!def) throw new Error(`chartCost: 未知去处 ${destinationId}`);
  if (def.requiresOrganIds.length === 0) return 0;
  const t = content.tuning;
  return t.bloodlineChartPerGate * def.requiresOrganIds.length + (t.bloodlineChartPeril[def.peril] ?? 0);
}

/**
 * [S3] 「图鉴知识」的价钱：参透这一头异兽要花几点血统。
 *
 * `bloodlineLoreBase ＋ floor(meng / bloodlineLoreMengDivisor)` —— 越凶的兽，看清它
 * 越值钱也越贵。按 `meng` 而不是按 hp：玩家在屏幕上真正读不出来的是「它下一手要干什么」，
 * 而那一手有多疼由 `meng` 定。
 *
 * @throws 敌人 id 不存在时抛错（同 `boonCost`）
 */
export function loreCost(enemyId: string, content: TaleContent): number {
  const enemy = enemyById(content, enemyId);
  if (!enemy) throw new Error(`loreCost: 未知异兽 ${enemyId}`);
  const t = content.tuning;
  return t.bloodlineLoreBase + Math.floor(enemy.meng / Math.max(1, t.bloodlineLoreMengDivisor));
}

/** [S3] 世家印记查表（id → def）；不存在返回 null。 */
export function sigilById(content: TaleContent, id: string): SigilDef | null {
  return content.sigils.find((sigil) => sigil.id === id) ?? null;
}

function enemyById(content: TaleContent, id: string): EnemyDef | undefined {
  return content.enemies.find((enemy) => enemy.id === id);
}

function meetsStats(stats: Stats, required?: Partial<Stats>): boolean {
  if (!required) return true;
  return (
    stats.meng >= (required.meng ?? 0) &&
    stats.ling >= (required.ling ?? 0) &&
    stats.ti >= (required.ti ?? 0) &&
    stats.de >= (required.de ?? 0)
  );
}

// ===== 开局变量：天时与出身 =====

/** 天时／出身池查表；空池或悬空 id 是内容 bug，要吵不要静默降级。 */
function premisePool(pool: readonly PremiseDef[], kind: string): readonly PremiseDef[] {
  if (pool.length === 0) throw new Error(`createLife: content.${kind} 为空（开局变量必须有得掷）`);
  return pool;
}

/**
 * 掷这一世的天时与出身。**恒定消耗 2 次抽取，且必须是一世的头两次**
 * （`rollPremise` 就是按这条约定从一个 seed 数字复算同一结果的）。
 */
function drawPremise(cursor: RngCursor, content: TaleContent): LifePremise {
  const skies = premisePool(content.skies, "skies");
  const origins = premisePool(content.origins, "origins");
  const sky = weightedPick(cursor, skies, (item) => item.weight);
  const origin = weightedPick(cursor, origins, (item) => item.weight);
  if (!sky || !origin) throw new Error("createLife: 天时／出身抽取失败");
  return { sky, origin };
}

/**
 * 只读预览：**这个种子数会降生在什么世道里**。纯函数，与 `createLife` 掷出的逐字相同。
 *
 * 存在的理由是界面的：择神种那一屏在 `createLife` **之前**，而「这一世是大旱年」正是
 * 挑神种（与挑目标）时最该知道的一件事。界面自己掷会击穿确定性，所以引擎给一个预览口。
 *
 * ⚠️ 约定：天时与出身必须是一世的**头两次抽取**（见 `createLife`）。哪天在它们之前
 * 插入别的抽取，这个函数就会与实际降生的世道说两套话 —— determinism 测试盯着这一条。
 */
export function rollPremise(seedNum: number, content: TaleContent): LifePremise {
  return drawPremise(createCursor(seedNum >>> 0), content);
}

/** 按 id 还原这一世的开局前提。id 悬空是内容 bug（改过 id 的旧存档不该静默变成平年）。 */
export function premiseOf(state: TaleState, content: TaleContent): LifePremise {
  const sky = content.skies.find((item) => item.id === state.skyId);
  const origin = content.origins.find((item) => item.id === state.originId);
  if (!sky) throw new Error(`premiseOf: 未知天时 ${state.skyId}`);
  if (!origin) throw new Error(`premiseOf: 未知出身 ${state.originId}`);
  return { sky, origin };
}

const PREMISE_TUNING_KEYS: readonly PremiseTuningKey[] = [
  "hungerPerSeason",
  "winterHungerExtra",
  "moltThreshold",
  "huntFoodGain",
  "restHungerGain",
  "eventChanceBase",
  "stalkAlertBonus",
  "stalkStamina",
  "combatWinEssenceMul",
];

/** 把若干 `PremiseTuningDelta` 加到基线上（加法，见 `PremiseTuningDelta` 的注释）。 */
function tuningWithDeltas(base: TaleTuning, deltas: readonly (PremiseTuningDelta | undefined)[]): TaleTuning {
  let out: TaleTuning | null = null;
  for (const delta of deltas) {
    if (!delta) continue;
    for (const key of PREMISE_TUNING_KEYS) {
      const add = delta[key];
      if (add === undefined || add === 0) continue;
      out ??= { ...base };
      // 各项都有自然下限 0（每季倒扣饱食、负的蜕变阈值都不是「更难」而是坏掉）
      out[key] = Math.max(0, out[key] + add);
    }
  }
  return out ?? base;
}

/**
 * **这一世真正生效的调参** ＝ `content.tuning` ＋ 天时 ＋ 出身。
 *
 * ## 为什么每处都得走它
 * 引擎里任何一处漏用（继续读 `content.tuning`），后果都是「大旱之年在某一个环节上不旱」：
 * 界面说每季 −15 而实扣 −12，或者屏幕上写着灵气盛而蜕变阈值没降。这类分叉在运行时完全
 * 静默。所以纪律是：**引擎与界面凡是要读调参的地方，一律 `lifeTuning(state, content)`**，
 * `content.tuning` 只在没有 state 的场合（`createLife` 之前、schema 测试）出现。
 *
 * 无覆写时返回 `content.tuning` **本体**（不是拷贝）—— 平年的一世零额外分配，
 * 且 `t === content.tuning` 的既有断言仍成立。
 */
export function lifeTuning(state: TaleState, content: TaleContent): TaleTuning {
  const { sky, origin } = premiseOf(state, content);
  return tuningWithDeltas(content.tuning, [sky.tuningDelta, origin.tuningDelta]);
}

// ===== 四道 =====

/**
 * [2026-08-13] 四条道的当前进度 —— 主界面那条常驻横带、死亡屏的差距报告、成道资格 flag
 * 与血统结算**全部**共用这一个函数。
 *
 * ## 为什么必须是引擎的 API 而不是界面自己比大小
 * 界面自己比那几行，与 `refreshWayFlags` 就是**两份门槛**：哪天引擎给某条道加一条，
 * 进度条会照旧显示「全亮」而成道事件死活不入池，且没有任何测试会红（M1-P2 的
 * `ascendProgress` 就是为这条理由存在的，这里只是从一条道扩到四条）。
 */
export function waysProgress(state: TaleState, content: TaleContent): WaysProgress {
  const t = lifeTuning(state, content);
  const min = (id: WayGateId, have: number, need: number): WayGate => ({
    id,
    bound: "min",
    have,
    need,
    met: have >= need,
    short: Math.max(0, need - have),
  });
  /** `max` 类：have ≤ need 才算达成，`short` 读作「超出了多少」。 */
  const max = (id: WayGateId, have: number, need: number): WayGate => ({
    id,
    bound: "max",
    have,
    need,
    met: have <= need,
    short: Math.max(0, have - need),
  });
  const flag = (id: WayGateId, has: boolean): WayGate => min(id, has ? 1 : 0, 1);

  const gatesOf = (way: WayId): WayGate[] => {
    switch (way) {
      case "shen":
        return [
          min("ling", state.stats.ling, t.wayShenLing),
          min("de", state.stats.de, t.wayShenDe),
          flag("divine", state.flags.includes(SYS_FLAG_DIVINE_EATEN)),
        ];
      case "yaowang":
        return [
          min("lives", state.livesTaken, t.wayYaowangLives),
          min("meng", state.stats.meng, t.wayYaowangMeng),
        ];
      case "guishan":
        return [min("year", state.year, t.wayGuishanYear), min("de", state.stats.de, t.wayGuishanDe)];
      case "hualing":
        return [min("ling", state.stats.ling, t.wayHualingLing), max("nokill", state.livesTaken, 0)];
    }
  };

  const ways: WayProgress[] = WAY_ORDER.map((id) => {
    const gates = gatesOf(id);
    const metCount = gates.filter((gate) => gate.met).length;
    const ratio = (gate: WayGate): number =>
      gate.bound === "max" ? (gate.met ? 1 : 0) : gate.need <= 0 ? 1 : clamp(gate.have / gate.need, 0, 1);
    return {
      id,
      gates,
      metCount,
      ready: metCount === gates.length,
      closeness: gates.reduce((sum, gate) => sum + ratio(gate), 0) / gates.length,
      lost: gates.some((gate) => gate.bound === "max" && !gate.met),
    };
  });

  const readyIds = ways.filter((way) => way.ready).map((way) => way.id);
  /*
   * 「最接近的那条」先比达成门槛数、再比接近度、最后按固定顺序。**已闭的道不参与竞争**
   * ——「你最接近化灵」在夺过命之后是一句假话，而差距报告与横带缺省视图都指着它。
   */
  const contenders = ways.filter((way) => !way.lost);
  const ranked = (contenders.length > 0 ? contenders : ways).reduce((best, way) =>
    way.metCount !== best.metCount
      ? way.metCount > best.metCount
        ? way
        : best
      : way.closeness > best.closeness
        ? way
        : best,
  );
  return { ways, readyIds, ready: readyIds.length > 0, nearest: ranked.id };
}

/** 取某一条道的进度（`waysProgress` 的取值版；四条恒在，不会返回 undefined）。 */
export function wayProgress(state: TaleState, content: TaleContent, way: WayId): WayProgress {
  const found = waysProgress(state, content).ways.find((item) => item.id === way);
  if (!found) throw new Error(`wayProgress: 未知道 ${way}`);
  return found;
}

/**
 * 就地重算 draft 的四条道资格 flag。死亡时一律摘掉（免得列传/转世界面读到脏 flag）。
 *
 * 只对**本次调用新建的 draft**（或 createLife 刚造出来的对象）调用，never 对入参 state。
 * performAction 会在事件抽取**之前**再调一次，好让本回合刚够格（例如刚把德挣到 40）的
 * 成道事件当场入池，而不是白等一季。
 */
function refreshWayFlags(draft: TaleState, content: TaleContent): void {
  const ready = draft.alive ? new Set(waysProgress(draft, content).readyIds) : new Set<WayId>();
  for (const way of WAY_ORDER) {
    const flag = WAY_FLAGS[way];
    const has = draft.flags.includes(flag);
    if (ready.has(way) === has) continue;
    draft.flags = ready.has(way) ? withFlags(draft.flags, [flag]) : withoutFlags(draft.flags, [flag]);
  }
}

// ===== 出生 =====

/**
 * 造一世。
 *
 * ## [2026-08-13] 头两次抽取恒为天时与出身
 * 这个顺序是**接口的一部分**：`rollPremise(seedNum, content)` 就是靠它从一个种子数字复算
 * 出同一个世道（择神种那一屏据此提前显示「此世大旱」）。在它们之前插入任何别的抽取，
 * 预览就会与实际降生的世道说两套话。
 *
 * 落账顺序：神种 statMods → 出身 statMods → 按体质定寿限 → 出身 lifespanDelta。
 * 出身的属性修正排在神种之后（它是「这一胎生得如何」，比神种更晚发生的一件事），
 * 而寿限先按体质算再吃 `lifespanDelta` —— 否则「灵胎寿 −2」会被体质的整除吃掉一半。
 *
 * ## [S1] 「血脉」：起手自带的器官
 * `options.boonOrganIds` 里的器官在**神种之后、出身之前**落账（它们是「这一胎带来的东西」，
 * 与出身同一类）。刻意**不写 `molt` 记录**：`bloodlineGain` 数的就是 molt 记录数，写了
 * 等于每一世白拿一点血统，而这一件器官的钱已经在转世屏付过了。
 *
 * ## [S3] 另外三件跨世资产
 * - **世家印记**（`options.sigilIds`）的 `statMods` 落在**最前**（神种之前）：它是先祖传下来
 *   的底子，比这一胎更早。落最前还有一个可验证的好处 —— 它不掷骰，于是同一颗种子带不带
 *   印记，天时／出身与此后每一次抽取逐字相同（专测钉住）。
 * - **图录**（`options.chartedDestinationId`）只写进状态，由 `destinationUnlocked` 消费。
 * - **图鉴知识**（`options.loreEnemyIds`）同上，由 `stalkPreview`／`combatPreview` 消费。
 *   三者都**不写任何记录、不掷任何骰**。
 *
 * @param seedNum 种子数（同时作为 rngState 初值）
 * @param seedDefId 选中的神种 `SeedDef.id`
 * @param options.boonOrganIds [S1] 血脉带来的器官 id（重复／与神种同一件时自动跳过）
 * @param options.sigilIds [S3] 世家印记 id（未知 id 抛错，重复自动跳过）
 * @param options.loreEnemyIds [S3] 已参透的异兽 id（未知 id 抛错 —— 脏存档要吵）
 * @param options.chartedDestinationId [S3] 这一世的图录（未知 id 抛错）
 * @throws 神种 id 不存在、血脉器官 id 不存在、或天时／出身池为空时抛错（内容 bug 要吵）
 */
export function createLife(
  seedNum: number,
  seedDefId: string,
  content: TaleContent,
  options?: {
    boonOrganIds?: readonly string[];
    sigilIds?: readonly string[];
    loreEnemyIds?: readonly string[];
    chartedDestinationId?: string | null;
  },
): TaleState {
  const seed = content.seeds.find((candidate) => candidate.id === seedDefId);
  if (!seed) throw new Error(`createLife: 未知神种 ${seedDefId}`);
  const cursor = createCursor(seedNum >>> 0);
  const premise = drawPremise(cursor, content);
  const t = tuningWithDeltas(content.tuning, [premise.sky.tuningDelta, premise.origin.tuningDelta]);
  const index = organIndex(content);
  const organIds: string[] = [seed.organ.id];
  // [S3] 世家印记先落账（先祖的底子在这一胎之前），且**至多 sigilCap 枚**：判据只有这一处，
  // 界面的置灰是它的镜像。多给的静默截断而不是抛错 —— 上限是平衡阀不是契约，
  // 一份存了四枚的旧档不该让玩家开不了局
  const sigilIds: string[] = [];
  for (const id of options?.sigilIds ?? []) {
    const sigil = sigilById(content, id);
    if (!sigil) throw new Error(`createLife: 未知世家印记 ${id}`);
    if (sigilIds.includes(id)) continue;
    if (sigilIds.length >= content.tuning.sigilCap) break;
    sigilIds.push(id);
  }
  // 拷一份再叠：`t.initialStats` 是所有一世共享的那一份 tuning 对象
  let stats: Stats = { ...t.initialStats };
  let sigilHungerBonus = 0;
  for (const id of sigilIds) {
    const sigil = sigilById(content, id);
    stats = addStats(stats, sigil?.statMods);
    sigilHungerBonus += sigil?.hungerBonus ?? 0;
  }
  stats = addStats(stats, seed.organ.statMods);
  for (const id of options?.boonOrganIds ?? []) {
    const organ = index.get(id);
    if (!organ) throw new Error(`createLife: 未知血脉器官 ${id}`);
    if (organIds.includes(id)) continue;
    organIds.push(id);
    stats = addStats(stats, organ.statMods);
  }
  stats = addStats(stats, premise.origin.statMods);
  /*
   * [S3] 图鉴知识与图录：只校验与落账，不掷骰、不写记录。
   * 未知 id 抛错而不是静默丢掉 —— 一个「买了却不生效」的跨世资产是玩家永远查不出来的坑
   * （客户端的 `parseBloodline` 已经与内容对过账，走到这里还不认识就是真 bug）。
   */
  const loreEnemyIds: string[] = [];
  for (const id of options?.loreEnemyIds ?? []) {
    if (!enemyById(content, id)) throw new Error(`createLife: 未知图鉴异兽 ${id}`);
    if (!loreEnemyIds.includes(id)) loreEnemyIds.push(id);
  }
  const charted = options?.chartedDestinationId ?? null;
  if (charted !== null && !destinationById(content, charted)) {
    throw new Error(`createLife: 未知图录去处 ${charted}`);
  }
  const lifespan =
    t.lifespanBase + Math.floor(stats.ti / t.lifespanTiDivisor) + (premise.origin.lifespanDelta ?? 0);
  const state: TaleState = {
    seed: seedNum >>> 0,
    rngState: cursor.state,
    year: 0,
    season: 0,
    region: "qingqiu",
    skyId: premise.sky.id,
    originId: premise.origin.id,
    stats,
    // [S3] 「世家印记·食」那一枚加在这里（照样吃 hungerMax 的上限）
    hunger: clamp(t.hungerInit + sigilHungerBonus, 0, t.hungerMax),
    // [饥饿节奏批] 出生没有余粮 —— 食余只从「自己猎到的大猎物」来
    surplusSeasons: 0,
    lifespanMax: Math.max(1, lifespan),
    essence: { zu: 0, lin: 0, xue: 0, meng: 0 },
    organIds,
    // [M2-B2] 招式册一世一册（转世清空）——「这一副身子拼出了什么」不跨世
    forgedSkills: [],
    forgeSeq: 0,
    // 开局变量的专属事件线靠这些 flag 入池。走 contentFlags 过滤：内容侧写错一个
    // `sys:` 前缀不该在降世这一刻就改掉引擎规则（同 applyEffects 的理由）
    flags: contentFlags([...(premise.sky.flags ?? []), ...(premise.origin.flags ?? [])]),
    firedOnceIds: [],
    encounter: null,
    records: [
      {
        year: 0,
        season: 0,
        kind: "birth",
        text: render(ENGINE_MESSAGES.birth, { seedName: seed.name }),
        refId: seed.id,
      },
    ],
    livesTaken: 0,
    // [S2] 每一世从零开始「去过哪儿／得过什么」—— 跨世那一份在 `Bloodline`（图鉴是记录，
    // 不是解锁开关：上一世下过幽潭，不等于这一世的鳞甲长回来了）
    visitedDestinationIds: [],
    foundTreasureIds: [],
    // [S3] 每一世从零开始「见过哪些兽」；跨世那一份在 `Bloodline.knownEnemyIds`
    metEnemyIds: [],
    // [S3] 这两件是跨世资产的**投影**（转世屏付过钱了），所以随降世带进来
    loreEnemyIds: [...loreEnemyIds],
    chartedDestinationId: charted,
    alive: true,
    ending: null,
    wayAchieved: null,
  };
  refreshWayFlags(state, content);
  return state;
}

/**
 * 当前可选行动。死亡、战斗未结束、**或追猎未收束**时返回空数组（界面据此禁用行动面板）。
 * 「蛰伏」仅在任一型精气 ≥ 这一世生效的 `moltThreshold` 时出现（灵气盛之年门槛更低）。
 */
export function availableActions(state: TaleState, content: TaleContent): ActionId[] {
  if (!state.alive || state.encounter) return [];
  const threshold = lifeTuning(state, content).moltThreshold;
  const actions: ActionId[] = ["hunt", "explore", "rest"];
  if (ESSENCE_ORDER.some((type) => state.essence[type] >= threshold)) {
    actions.push("dormant");
  }
  return actions;
}

// ===== 回合：行动 =====

/**
 * [S3] 记一笔「照过面」（幂等，就地改 draft）。
 *
 * 起追与开战两处各调一次 —— 两处都算「见过它」，而两处又都可能是唯一的一次
 * （追猎失手它跑了、或者开战第一回合就被咬死）。抽成一个函数是因为漏掉任何一处的后果
 * 是**静默**的：图鉴上那一格永远是「？」，而玩家明明刚跟它打过一架。
 */
function noteMetEnemy(draft: TaleState, enemyId: string): void {
  if (draft.metEnemyIds.includes(enemyId)) return;
  draft.metEnemyIds = [...draft.metEnemyIds, enemyId];
}

// ===== 遭遇（M2-B1）=====
//
// 玩法正本：docs/plans/shiling/2026-08-14-liezhuan-m2-combat-core-plan.md 的「B1」。
//
// M1 留下的是**两个互斥的状态位**（`TaleState.stalk` 与 `TaleState.combat`）与**三条各摆
// 一套状态的入口**（起追／探索遇袭／事件冲突）。于是「一场遭遇」在代码里不存在：
// 接近阶段的四息与紧接着的血战互不知情（日志断成两截、潜到多近才失手对交锋毫无影响），
// 而探索撞上的冲突事件走的又是第三条路。M2-B1 把它们收成一条状态机：
//
//   一个位（`TaleState.encounter`）· 一个入口（`beginEncounter`）· 两个阶段（`phase`）
//   · 一条日志 · 一份势 · 一份部位伤 · 一套屏幕语汇。
//
// 三条来路的分别只剩 `origin`（谁先动的手），而它落在**起手势**上 —— 那正是「接近阶段
// 的取舍会不会影响交锋」这个问题的答案：潜到极近才失手的人，反扑时手上是有势的。

/** 一场遭遇开场时的空部位伤。 */
function noWounds(): Record<BodyPart, number> {
  return { throat: 0, leg: 0, eye: 0 };
}

/** [M2-B1] 势的上限：4 ＋ floor(灵/18)。灵性 build 攒得起更大的一手（灵的可见落点之一）。 */
function momentumMaxOf(stats: Stats, t: TaleTuning): number {
  return Math.max(1, t.encounterMomentumBase + Math.floor(stats.ling / t.encounterMomentumMaxPerLing));
}

/**
 * [M2-B1] 起手势：灵性给底，来路加减。
 *
 * `ambush`（它自暗处扑出）要扣 —— 被扑个正着的人没有势。这一条是「探索遇袭比事件冲突
 * 更难打」的**唯一**数值来源，而它写在屏幕的势条与开场那一行字上，不是背后的暗改。
 */
function startMomentumOf(stats: Stats, t: TaleTuning, origin: EncounterOrigin): number {
  const base = Math.floor(stats.ling / t.encounterMomentumStartPerLing);
  const penalty = origin === "ambush" ? t.encounterAmbushMomentumPenalty : 0;
  return clamp(base - penalty, 0, momentumMaxOf(stats, t));
}

/** [M2-B1] 交锋起手血 ＝ round(体 × combatHpPerTi)。与寿数公式解耦（见 tuning 注释）。 */
function combatHpOf(stats: Stats, t: TaleTuning): number {
  return Math.max(1, Math.round(stats.ti * t.combatHpPerTi));
}

/** [M2-B1] 体给的**减伤**（每 14 点体减 1）—— 体在交锋屏上的第二个落点。 */
function toughnessOf(stats: Stats, t: TaleTuning): number {
  return Math.max(0, Math.floor(stats.ti / t.combatToughnessPerTi));
}

/**
 * [M2-B3] 「腿」在这一头兽身上该叫什么（缺省「后腿」）。
 *
 * 见 `EnemyDef.legWord`：这一批之后名册里有鱼、鸟、蛇与带甲的东西，
 * 而 `BODY_PART_NAMES.leg` 那句写死的「后腿」在它们身上是错的。
 */
function legWordOf(enemy: EnemyDef): string {
  return enemy.legWord ?? BODY_PART_NAMES.leg;
}

/** [M2-B3] 部位名（腿走 `legWord`，喉与眼对所有兽都是同一个词）。 */
function bodyPartName(enemy: EnemyDef, part: BodyPart): string {
  return part === "leg" ? legWordOf(enemy) : BODY_PART_NAMES[part];
}

/** [M2-B3] 这一头兽的三个部位该怎么念 —— 两个 preview 都带这一份，客户端不再自己查表。 */
function partNamesOf(enemy: EnemyDef): Record<BodyPart, string> {
  return {
    throat: bodyPartName(enemy, "throat"),
    leg: bodyPartName(enemy, "leg"),
    eye: bodyPartName(enemy, "eye"),
  };
}

/** [M2-B1] 德给的闪避概率（整下躲开，不掉血）。 */
function dodgeChanceOf(stats: Stats, t: TaleTuning): number {
  return clamp(stats.de * t.combatDodgePerDe, 0, t.combatDodgeMax);
}

/** [M2-B1] 德给的暴击概率。 */
function critChanceOf(stats: Stats, t: TaleTuning): number {
  return clamp(stats.de * t.combatCritPerDe, 0, t.combatCritMax);
}

/**
 * [M2-B1] 按血线算它此刻在第几段（单向推进，取最后一个满足 `hp/max ≤ at` 的段）。
 *
 * 无 `stages` 的敌人恒为 0 段 —— 缺省即「一段到底」，与 M1-P2 的行为逐字相同。
 */
function stageIndexOf(enemy: EnemyDef, enemyHp: number): number {
  const stages = enemy.stages;
  if (!stages || stages.length === 0) return 0;
  const ratio = enemy.hp > 0 ? enemyHp / enemy.hp : 0;
  let index = 0;
  for (let i = 0; i < stages.length; i += 1) {
    if (ratio <= (stages[i]?.at ?? 1)) index = i;
  }
  return index;
}

function stageDefOf(enemy: EnemyDef, index: number): EnemyStageDef | undefined {
  return enemy.stages?.[index];
}

/**
 * [M2-B1] 敌人此刻的出伤倍率（行为段给的）。「暴怒」既打得更重，也是玩家该换伏低的信号。
 */
function stageDamageMulOf(enemy: EnemyDef, index: number): number {
  return stageDefOf(enemy, index)?.damageMul ?? 1;
}

/**
 * [M2-B1] 弱点此刻识不识得破 —— 三条路径，全部写在屏幕上。
 *
 * 1. **历代所记**：花过血统点参透此兽（`loreEnemyIds`），开场即知；
 * 2. **自己试出来**：咬中该部位 `weaknessRevealHits` 次；
 * 3. **看出来**：打满 `weaknessRevealRounds − floor(灵/weaknessRevealPerLing)` 合（下限 1）。
 *
 * 三条并列而不是二选一：第 1 条是跨世积累的兑现，第 3 条是灵性 build 的回报，
 * 第 2 条给什么都没有的 build 留一条笨办法 —— 一件只有某类 build 够得着的信息，
 * 对别的 build 就等于不存在（P1 那条「信息模糊是该有的 build 差异，信息无用不是」）。
 */
function weaknessRevealedNow(
  enemy: EnemyDef,
  state: TaleState,
  t: TaleTuning,
  now: { round: number; hits: number },
): boolean {
  if (!enemy.weakness) return false;
  if (state.loreEnemyIds.includes(enemy.id)) return true;
  if (now.hits >= t.weaknessRevealHits) return true;
  const need = Math.max(1, t.weaknessRevealRounds - Math.floor(state.stats.ling / t.weaknessRevealPerLing));
  return now.round >= need;
}

/**
 * [M2-B1] 开一场遭遇 —— **三条来路（起追／遇袭／事件）唯一的入口**。
 *
 * `origin === "hunt"` 从接近阶段开场（抽取顺序沿用 M1-P1：距离抖动 → 警觉抖动 → 风向 →
 * 开场旁白；猎物本身由调用方先抽好）；另两条直接进交锋（抽取顺序：守备 → 意图类型 →
 * 意图旁白，恒 3 次）。
 */
function beginEncounter(
  draft: TaleState,
  enemy: EnemyDef,
  origin: EncounterOrigin,
  cursor: RngCursor,
  t: TaleTuning,
  notices: string[],
): void {
  const encounter: EncounterState = {
    enemyId: enemy.id,
    origin,
    phase: origin === "hunt" ? "approach" : "clash",
    momentum: startMomentumOf(draft.stats, t, origin),
    momentumMax: momentumMaxOf(draft.stats, t),
    wounds: noWounds(),
    // 花过血统点参透的兽，它的软肋是**历代所记**，开场就写在屏幕上
    weaknessFound: enemy.weakness !== undefined && draft.loreEnemyIds.includes(enemy.id),
    weaknessHits: 0,
    stage: 0,
    log: [],
    approach: null,
    clash: null,
  };
  draft.encounter = encounter;
  // [S3] 起追／开战都算照面 —— 追丢了也数，第一回合就被咬死也数
  noteMetEnemy(draft, enemy.id);

  if (origin === "hunt") {
    const baseDistance = enemy.startDistance ?? t.stalkStartDistance;
    const distanceJitter = t.stalkStartDistanceJitter;
    const distance = Math.max(
      1,
      Math.round(baseDistance + (distanceJitter > 0 ? cursor.int(distanceJitter * 2 + 1) - distanceJitter : 0)),
    );
    // [2026-08-13] 加成而不是缺省值：八头猎物全都自带 wariness，改缺省值等于没改（见 tuning 注释）
    const baseAlert = (enemy.wariness ?? t.stalkStartAlert) + t.stalkAlertBonus;
    const alertJitter = t.stalkStartAlertJitter;
    const alertness = clamp(
      Math.round(baseAlert + (alertJitter > 0 ? cursor.int(alertJitter * 2 + 1) - alertJitter : 0)),
      0,
      t.stalkAlertMax,
    );
    const winds: readonly WindDir[] = ["into", "cross", "with"];
    const wind = winds[cursor.int(winds.length)] ?? "cross";
    const opening = render(pickFlavor(cursor, enemy.stalkFlavor?.begin, STALK_MESSAGES.begin), {
      enemy: enemy.name,
    });
    encounter.approach = {
      distance,
      alertness,
      stamina: t.stalkStamina,
      wind,
      // 起手不确知风向：有 stalkWindTags 器官的读得出来（见 stalkPreview），没有的只能绕一圈买确定
      windKnown: false,
      round: 0,
    };
    encounter.log.push(opening);
    notices.push(opening);
    return;
  }

  const opening = render(
    origin === "ambush" ? ENGINE_MESSAGES.encounterAmbush : ENGINE_MESSAGES.encounterEvent,
    { enemy: enemy.name },
  );
  encounter.log.push(opening);
  notices.push(opening);
  openClash(draft, enemy, cursor, t, encounter.log);
}

/**
 * [M2-B1] 摆开交锋阶段的起手状态（接近阶段转进来也走这一条）。
 *
 * 开场就要把**第一回合的守备与意图**摆出来 —— 玩家在按第一颗按钮之前就该读到
 * 「它护着咽喉、它要扑」。抽取顺序：守备 → 意图类型 → 意图旁白（恒 3 次，见 `rollFace`）。
 */
function openClash(
  draft: TaleState,
  enemy: EnemyDef,
  cursor: RngCursor,
  t: TaleTuning,
  log: string[],
  enemyHp: number = enemy.hp,
): void {
  const encounter = draft.encounter;
  if (!encounter) throw new Error("openClash: 当前不在遭遇中");
  const stage = stageIndexOf(enemy, enemyHp);
  const face = rollFace(cursor, enemy, t, {
    enemyHp,
    wounds: encounter.wounds,
    slow: 0,
    forcedGuard: false,
    stage,
    de: draft.stats.de,
  });
  encounter.phase = "clash";
  encounter.approach = null;
  encounter.stage = stage;
  encounter.clash = {
    enemyHp,
    playerHp: combatHpOf(draft.stats, t),
    round: 0,
    stance: "square",
    guardPart: face.guardPart,
    intent: face.intent,
    blind: 0,
    slow: 0,
    ward: 0,
    bleed: 0,
    thorns: 0,
    insight: 0,
    skillCooldowns: {},
  };
  if (encounter.weaknessFound && enemy.weakness) {
    log.push(
      render(enemy.weakness.text, {
        enemy: enemy.name,
        part: bodyPartName(enemy, enemy.weakness.part),
      }),
    );
  }
}

/**
 * 摇出「下一回合玩家会看到的那张脸」：它护哪儿、它打算干什么。
 *
 * **恒定消耗 3 次抽取**（守备 → 意图类型 → 意图旁白），`forcedGuard`（顿挫）也照抽不误 ——
 * 抽取次数随分支变化会让「同种子同操作＝同终态」变成一件要逐分支推演的事。
 *
 * ## 三条压在意图池上的规则
 * - **腿伤到 `woundLegNoFleeAt` 层就不出「逃」**（硬）：拖着断腿的兽走不掉。宣告了做不到的事
 *   就是骗人，而这套设计的全部本钱就是「屏幕上写的都算数」。血还厚时同样不出「逃」。
 * - **每层腿伤把「扑」的权重乘 `woundLegPounceMul`**（软，不排除）：全排除会让「咬腿→咬喉」
 *   的轮转彻底删掉扑这一档，而扑的预告正是姿态那一整套决定的前提（M1-P2 实测：
 *   只会咬腿一手对岩羊胜率 99.5%，等于一颗按钮通吃）。
 * - **[M2-B1] 德抬高「逃」的权重**（`combatEnemyFleePerDe`）：德高的兽，凶物也敬三分。
 *   这是德在交锋屏上三个落点里最不像数值的一个 —— 它改的是**它想不想跟你打**。
 *
 * [M2-B1] 守备与意图的偏好优先取**当前行为段**的（`EnemyDef.stages`），缺省沿用兽本身的。
 */
function rollFace(
  cursor: RngCursor,
  enemy: EnemyDef,
  t: TaleTuning,
  now: {
    enemyHp: number;
    wounds: Record<BodyPart, number>;
    /** 技能挂的迟滞（`venom`／M1-P2 的咬腿）—— 与整场腿伤两条来源都会封掉「逃」 */
    slow: number;
    forcedGuard: boolean;
    stage: number;
    de: number;
  },
): { guardPart: BodyPart; intent: EnemyIntent } {
  const stage = stageDefOf(enemy, now.stage);
  const guardBias = stage?.guardBias ?? enemy.guardBias;
  const intentBias = stage?.intentBias ?? enemy.intentBias;
  const legWounds = now.wounds.leg;
  const guardPart =
    weightedPick(cursor, BODY_PARTS, (part) => guardBias?.[part] ?? 1) ?? "throat";
  const pool = INTENT_KINDS.filter((kind) => {
    if (kind === "flee") {
      return canFlee(t, now.slow, legWounds) && now.enemyHp <= enemy.hp * t.combatFleeIntentHpRatio;
    }
    return true;
  });
  const drawn =
    weightedPick(cursor, pool, (kind) => {
      const base = intentBias?.[kind] ?? t.combatIntentWeights[kind];
      if (kind === "pounce") {
        // 两条来源都压「扑」：技能挂的迟滞（一时）与整场累积的腿伤（一世）
        return (
          base *
          (now.slow > 0 ? t.combatSlowPounceMul : 1) *
          Math.pow(t.woundLegPounceMul, legWounds)
        );
      }
      if (kind === "flee") return base * (1 + now.de * t.combatEnemyFleePerDe);
      return base;
    }) ?? "bite";
  const kind: EnemyIntentKind = now.forcedGuard ? "guard" : drawn;
  const text = render(pickFlavor(cursor, enemy.combatFlavor?.intent?.[kind], COMBAT_MESSAGES.intent[kind]), {
    enemy: enemy.name,
  });
  return { guardPart, intent: { kind, text } };
}
// ===== 追猎（M1-P1）=====
//
// 玩法正本：docs/plans/shiling/2026-08-12-liezhuan-m1-playable-plan.md 的「P1 追猎屏」。
//
// 这一段替掉了 M0 的 `resolveHunt`（一次掷骰定成败）。为什么整段换掉而不是加参数：
// M0 的狩猎在**玩家点下去之前无法判断、也无法准备** —— 那不是决策，是翻牌。追猎把同一件
// 事拆成「四个可见的量 × 四个动作」，于是玩家可以形成计划（绕到上风再逼近）、跨回合执行它、
// 并因为判断失误（顺风硬冲）而失败。所有让人做判断的东西都必须看得见，这就是 `stalkPreview`
// 存在的理由，也是 `night-eye`／`insight` 给的是**信息**而不是数值加成的理由。

/** 追猎旁白抽变体。**恒定消耗一次抽取**（池为空时退回兜底池，消耗不变），确定性可推演。 */
function pickFlavor(
  cursor: RngCursor,
  specific: readonly string[] | undefined,
  fallback: readonly string[],
): string {
  const pool = specific && specific.length > 0 ? specific : fallback;
  return pool[cursor.int(pool.length)] ?? "";
}

/** 猎物表查表。空表／悬空 id 是内容 bug，要吵不要静默（同 M0：狩猎失效＝每一世饿死）。 */
function preyPool(content: TaleContent, t: TaleTuning): EnemyDef[] {
  const ids = t.huntPreyIds;
  if (ids.length === 0) {
    throw new Error("beginStalk: tuning.huntPreyIds 为空，狩猎无从起追（内容必须填猎物表）");
  }
  return ids.map((id) => {
    const enemy = enemyById(content, id);
    if (!enemy) throw new Error(`beginStalk: 猎物表里的未知敌人 ${id}`);
    return enemy;
  });
}

/**
 * [M2-B1] 当前遭遇的接近阶段（不在接近阶段时抛错）。
 *
 * 两个访问器（这个与 `clashOf`）是整套代码里**唯一**取子阶段的地方 —— 在别处写
 * `state.encounter?.approach!` 会让「阶段不对」这类错静默地变成 undefined 上的属性访问。
 */
export function approachOf(state: TaleState): ApproachState | null {
  const encounter = state.encounter;
  return encounter && encounter.phase === "approach" ? encounter.approach : null;
}

/** [M2-B1] 当前遭遇的交锋阶段；不在交锋阶段时为 null。 */
export function clashOf(state: TaleState): ClashState | null {
  const encounter = state.encounter;
  return encounter && encounter.phase === "clash" ? encounter.clash : null;
}

/** 当前遭遇的那头兽（不在遭遇中、或 id 失效时抛错）。 */
function encounterEnemy(state: TaleState, content: TaleContent, who: string): EnemyDef {
  const encounter = state.encounter;
  if (!encounter) throw new Error(`${who}: 当前不在遭遇中`);
  const enemy = enemyById(content, encounter.enemyId);
  if (!enemy) throw new Error(`${who}: 未知敌人 ${encounter.enemyId}`);
  return enemy;
}

function stalkPrey(state: TaleState, content: TaleContent): EnemyDef {
  if (!approachOf(state)) throw new Error("stalkPrey: 当前不在接近阶段");
  return encounterEnemy(state, content, "stalkPrey");
}

/** 逆风减半／侧风照旧／顺风翻倍。内容写坏（缺项）时退回 1，不静默把风向变成免费。 */
function windAlertMul(t: TaleTuning, wind: WindDir): number {
  return t.stalkWindAlertMul[wind] ?? 1;
}

/**
 * 贴近倍率：距离 ≥ `stalkNearDistance` 时为 1，贴身时为 `stalkNearAlertMul`，中间线性。
 *
 * 这是整套数值里最关键的一条曲线 —— 没有它，「潜行」就是匀速逼近，玩家算一次就够了；
 * 有了它，**最后一步永远是最险的一步**，于是「什么时候停下来扑」才成为一个真的问题。
 */
function nearAlertMul(t: TaleTuning, distance: number): number {
  if (t.stalkNearDistance <= 0) return 1;
  const closeness = clamp((t.stalkNearDistance - distance) / t.stalkNearDistance, 0, 1);
  return 1 + (t.stalkNearAlertMul - 1) * closeness;
}

/** 潜行能拉近的步数（疾足类 tag 加成；不会拉过头，最多到贴身）。 */
function creepDistanceGain(state: TaleState, t: TaleTuning, tags: Set<string>): number {
  const stalk = approachOf(state);
  const step = t.stalkCreepDistance + (tags.has(t.stalkSwiftTag) ? t.stalkCreepSwiftBonus : 0);
  return Math.max(0, Math.min(stalk?.distance ?? 0, step));
}

/**
 * 潜行的警觉增益 = 基础 × 风向 × 贴近（按**移动后**的距离算）× 静步。
 *
 * 取整用 `Math.round`：界面显示的就是这个数，玩家按它做计划 —— 显示 4 实际扣 3.6 会让
 * 「攒到多少就该扑」这类计划在第三步对不上账，那比数值不准更糟。
 */
function creepAlertGain(state: TaleState, t: TaleTuning, tags: Set<string>): number {
  const stalk = approachOf(state);
  if (!stalk) return 0;
  const after = Math.max(0, stalk.distance - creepDistanceGain(state, t, tags));
  const quiet = tags.has(t.huntHunterTag) ? t.stalkQuietAlertMul : 1;
  return Math.round(t.stalkCreepAlert * windAlertMul(t, stalk.wind) * nearAlertMul(t, after) * quiet);
}

/** 扑击命中率（正本公式）。距离与警觉各自都能把它压死，猛只是微调。 */
function pounceChanceAt(distance: number, alertness: number, meng: number, t: TaleTuning): number {
  const raw =
    t.stalkPounceBase -
    distance * t.stalkPouncePerDistance -
    alertness * t.stalkPouncePerAlert +
    meng * t.stalkPouncePerMeng;
  return clamp(raw, t.minChance, t.maxChance);
}

/**
 * 起追：抽一头具体的猎物，然后开一场 `origin: "hunt"` 的遭遇。
 *
 * 抽取顺序固定（改动即打破所有既存种子的剧本）：猎物 → 距离抖动 → 警觉抖动 → 风向 → 开场旁白。
 * 后四次抽取在 `beginEncounter` 里 —— 这里只负责「盯上哪一头」，因为**三条来路都要经过
 * 那个入口**（M2-B1：一个状态机，不是三处各摆一套状态）。
 *
 * 风向等权三选一：**没有 `stalkWindTags` 的玩家看不见它**，所以「先绕到上风再说」是那种
 * build 的标准开局（花一点体力买确定性）；看得见风向的 build 则省下这一步 —— 信息本身
 * 就是器官奖励，这条是它最直白的兑现。
 */
function beginStalk(
  draft: TaleState,
  cursor: RngCursor,
  content: TaleContent,
  t: TaleTuning,
  notices: string[],
): void {
  const pool = preyPool(content, t);
  const prey = pool[cursor.int(pool.length)];
  if (!prey) throw new Error("beginStalk: 猎物表抽取失败");
  beginEncounter(draft, prey, "hunt", cursor, t, notices);
}

/**
 * 接近阶段（追猎屏）要显示的全部只读数（纯函数）。
 *
 * @throws 不在接近阶段时抛错 —— 界面只该在 `encounter.phase === "approach"` 时问它
 */
export function stalkPreview(state: TaleState, content: TaleContent): StalkPreview {
  const stalk = approachOf(state);
  if (!stalk) throw new Error("stalkPreview: 当前不在接近阶段");
  const t = lifeTuning(state, content);
  const prey = stalkPrey(state, content);
  const tags = ownedTags(state, content);

  const creepGain = creepDistanceGain(state, t, tags);
  const meng = state.stats.meng;
  /*
   * 两处警觉增量都按上限截断（同 `waitAlertDrop` 的体例）：警觉快满时真实增幅会被
   * `clamp(…, 0, stalkAlertMax)` 削掉，预览若照原样报，就在最后一步上多说了 1〜2 点 ——
   * 「预览不骗人」这条不该留窄窗口例外，而那恰是玩家最盯着这个数的时候。
   */
  const headroom = Math.max(0, t.stalkAlertMax - stalk.alertness);
  const alertGain = Math.min(headroom, creepAlertGain(state, t, tags));

  // [S3] 「图鉴知识」是读得出确数的**第二条来源**：器官读的是这一刻，图鉴读的是历代
  const loreKnown = state.loreEnemyIds.includes(prey.id);

  return {
    pounceChance: pounceChanceAt(stalk.distance, stalk.alertness, meng, t),
    creepGain,
    alertVisible: loreKnown || t.stalkAlertTags.some((tag) => tags.has(tag)),
    loreKnown,
    // 器官读得出，或者自己刚绕过一圈 —— 两条都算「确知」
    windVisible: stalk.windKnown || t.stalkWindTags.some((tag) => tags.has(tag)),
    creepAlertGain: alertGain,
    pounceChanceAfterCreep: pounceChanceAt(
      stalk.distance - creepGain,
      Math.min(t.stalkAlertMax, stalk.alertness + alertGain),
      meng,
      t,
    ),
    circleAlertGain: Math.min(headroom, t.stalkCircleAlert),
    alreadyUpwind: stalk.wind === "into",
    waitAlertDrop: Math.min(stalk.alertness, t.stalkWaitAlertDrop),
    retaliates: prey.retaliates === true,
    staminaLeft: stalk.stamina,
  };
}

/**
 * 打一个**接近阶段**的动作（遭遇状态机的前半）。
 *
 * - `creep` 潜行：距离 −（疾足加成），警觉 +（顺风翻倍／逆风减半，且越近涨得越凶）。
 * - `circle` 绕至上风：风向重置为逆风，警觉 +小。**看不见风向的 build 用它买确定性。**
 * - `wait` 屏息：警觉 −，有概率猎物自行挪位（可能走远到跟丢）。
 * - `pounce` 扑击：按 `stalkPreview().pounceChance` 掷一次，成败即收束。
 *
 * 每个动作（**含扑击**）扣 1 点体力；扣到 0 而还没扑成 ＝ `exhausted`，空手而归。
 *
 * 收束时（`over` 非 null）这一步才跑季推进与死亡判定（`closeSeason`）—— 「起追」那一次
 * `performAction` 刻意没跑：否则饿到只剩一季的玩家会在**猎物到嘴之前**先饿死，而
 * 「饿了就去猎」正是这游戏唯一的正解，不能自带一条必死分支。
 *
 * ## [M2-B1] `over === "combat"` 现在是**转阶段**，不是另起一场
 * 它把同一个 `EncounterState` 的 `phase` 从 `approach` 换成 `clash`（日志接着写、部位伤与
 * 势带过去），并按**这一刻的警觉**结转一笔势：潜到极近、它还没起疑才失手的人，反扑时
 * 手上是有势的。这就是「接近阶段的取舍会不会影响交锋」这个问题的答案 ——
 * M1 那两个互斥状态位下，它的答案是「不会」。
 *
 * @throws 已死亡、不在接近阶段、或猎物 id 失效时抛错
 */
export function stalkAct(state: TaleState, act: StalkAct, content: TaleContent): StalkTurn {
  if (!state.alive) throw new Error("stalkAct: 已死亡");
  const current = approachOf(state);
  if (!current) throw new Error("stalkAct: 当前不在接近阶段");
  const prey = stalkPrey(state, content);

  const t = lifeTuning(state, content);
  const cursor = createCursor(state.rngState);
  const draft = draftOf(state);
  const roundLog: string[] = [];
  const records: LifeRecord[] = [];
  const tags = ownedTags(state, content);
  const flavor = prey.stalkFlavor;
  const say = (specific: readonly string[] | undefined, fallback: readonly string[], vars: Record<string, string | number> = {}): void => {
    roundLog.push(render(pickFlavor(cursor, specific, fallback), { enemy: prey.name, ...vars }));
  };

  let distance = current.distance;
  let alertness = current.alertness;
  let over: StalkTurn["over"] = null;
  let caught = false;
  /** [饥饿节奏批] 这一头留下几季食余（0 ＝ 没得手或这头留不下）—— 落账在 `closeSeason` 之后 */
  let surplusGranted = 0;

  switch (act) {
    case "creep": {
      const gain = creepDistanceGain(state, t, tags);
      const alertGain = creepAlertGain(state, t, tags);
      distance = Math.max(0, distance - gain);
      alertness = clamp(alertness + alertGain, 0, t.stalkAlertMax);
      say(flavor?.creep, STALK_MESSAGES.creep, { steps: gain });
      break;
    }
    case "circle": {
      alertness = clamp(alertness + t.stalkCircleAlert, 0, t.stalkAlertMax);
      say(flavor?.circle, STALK_MESSAGES.circle);
      break;
    }
    case "wait": {
      alertness = clamp(alertness - t.stalkWaitAlertDrop, 0, t.stalkAlertMax);
      // 抽取顺序固定：先掷「动不动」，动了再掷「往哪动、动多远」，最后才抽旁白。
      const stirs = cursor.next() < t.stalkWaitMoveChance;
      if (stirs) {
        const span = Math.max(0, t.stalkWaitMoveMax - t.stalkWaitMoveMin);
        const steps = t.stalkWaitMoveMin + cursor.int(span + 1);
        const away = cursor.next() < t.stalkWaitMoveAwayChance;
        distance = Math.max(0, distance + (away ? steps : -steps));
        say(flavor?.stir, STALK_MESSAGES.stir, { steps });
      } else {
        say(flavor?.wait, STALK_MESSAGES.wait);
      }
      break;
    }
    case "pounce": {
      const chance = pounceChanceAt(distance, alertness, draft.stats.meng, t);
      if (cursor.next() < chance) {
        caught = true;
        over = "caught";
        say(flavor?.catch, STALK_MESSAGES.catch);
      } else {
        say(flavor?.miss, STALK_MESSAGES.miss);
        over = prey.retaliates === true ? "combat" : "escaped";
      }
      break;
    }
  }

  // 风向重置放在动作之后：`circle` 的警觉代价按**旧**风向的世界观付，收益从下一步起兑现。
  const wind: WindDir = act === "circle" ? "into" : current.wind;
  // 亲手绕过一圈之后风向就是确知的（此后 stalkPreview 会如实告诉玩家「已在上风」，
  // 否则读不出风向的 build 会一圈接一圈地绕，把体力全耗在同一件已经做成的事上）
  const windKnown = current.windKnown || act === "circle";
  const stamina = current.stamina - 1;

  if (over === null) {
    if (alertness >= t.stalkAlertMax) {
      // 「警觉满」与「扑空」是同一条分支（正本）：小猎物遁走，大猎物回头。
      over = prey.retaliates === true ? "combat" : "escaped";
    } else if (distance > t.stalkLoseDistance) {
      over = "escaped";
    } else if (stamina <= 0) {
      over = "exhausted";
    }
  }

  if (over === "escaped") say(flavor?.escape, STALK_MESSAGES.escape);
  if (over === "exhausted") say(undefined, STALK_MESSAGES.exhausted);

  const encounter = draft.encounter;
  if (!encounter) throw new Error("stalkAct: draft 丢了遭遇状态");
  if (over === null) {
    encounter.approach = {
      distance,
      alertness,
      stamina,
      wind,
      windKnown,
      round: current.round + 1,
    };
    encounter.log = [...encounter.log, ...roundLog];
  } else {
    if (caught) {
      draft.hunger = clamp(draft.hunger + t.huntFoodGain, 0, t.hungerMax);
      draft.essence = addEssence(draft.essence, prey.essence);
      /*
       * [饥饿节奏批] 大猎物留下食余 —— 这一批的核心，也是**追猎独有**的那一份
       * （速猎「随手取一头」，没有拖回穴里的余粮）。
       *
       * 落账刻意排在 `closeSeason` **之后**（见下面那一行）：这一季的账已经由刚才那顿
       * +32 付过了，食余算的是**此后**几季。若在这里就落，收束时会当场吃掉一季 ——
       * 屏幕上写「够吃四季」而状态栏立刻显示三季，那是一次没人能解释的减一。
       */
      surplusGranted = Math.max(0, Math.round(prey.surplusSeasons ?? t.huntSurplusSeasons));
      // [2026-08-13] 得手就是夺了一命 —— 这一笔同时是妖王的进度与化灵的断门。
      // 它刻意**不写 LifeRecord**（见 LifeRecord 的记录纪律：一世几十次狩猎会把列传摘录占满），
      // 所以只有这个计数器记得住它。
      draft.livesTaken += 1;
      say(undefined, STALK_MESSAGES.feed);
      // 直接 push 而不走 `say`：那一句是**唯一**的一条（没有变体可抽），而 `say` 恒消耗
      // 一次抽取 —— 为一句没得选的话掷一次骰，会让「抽取次数随内容变化」多一个隐形来源
      if (surplusGranted > 0) {
        roundLog.push(render(ENGINE_MESSAGES.huntSurplus, { seasons: cnNumeral(surplusGranted) }));
      }
    }
    if (over === "combat") {
      say(flavor?.retaliate, STALK_MESSAGES.retaliate);
      /*
       * [M2-B1] 结转势：警觉每低 `encounterApproachMomentumPerAlert` 点多带一点。
       * 也就是说「悄悄逼到贴身才失手」与「顺风硬冲惊动了它才被顶回来」在交锋里不是同一个
       * 开局 —— 前者手上有两点势（够第一合就发一记控制技），后者只有灵性给的那点底。
       */
      const carried = Math.floor(
        Math.max(0, t.stalkAlertMax - alertness) / t.encounterApproachMomentumPerAlert,
      );
      if (carried > 0) {
        encounter.momentum = clamp(encounter.momentum + carried, 0, encounter.momentumMax);
        roundLog.push(ENGINE_MESSAGES.encounterCarry);
      }
      /*
       * 附毒：扑空那一下把毒蹭了进去，敌人带伤入场。落成起手血量折扣（而不是 `slow`
       * 那一族的计数器）——「它带着伤上来」是接近阶段的成果，该在血条上看得见。
       */
      const openingHp = tags.has(t.stalkVenomTag)
        ? Math.max(1, Math.round(prey.hp * t.stalkVenomHpMul))
        : prey.hp;
      if (openingHp < prey.hp) say(undefined, STALK_MESSAGES.venom);
      openClash(draft, prey, cursor, t, roundLog, openingHp);
    } else {
      // 接近阶段自己收束（得手／遁走／力尽）—— 遭遇到此为止
      draft.encounter = null;
    }
    /*
     * 本季到此才收束（起追那一次刻意没推进）。
     *
     * **转进交锋也照收**：那一季的账（这一扑成没成、有没有吃到）已经定了，交锋是这一季
     * 之内发生的事，不该再吃掉一季。若这一步饿死，`die` 会连整场遭遇一起清掉 ——
     * 与 M1 的行为逐字相同（那时是清 `combat`）。
     */
    closeSeason(draft, content, t, records, roundLog);
    if (draft.encounter) draft.encounter.log = [...draft.encounter.log, ...roundLog];
    // [饥饿节奏批] 食余从**下一季**起算，所以落在收束之后（理由见上面 `surplusGranted` 那段）。
    // 死了就不落：一条给尸体记的余粮只会在列传与存档里留下一个没有意义的数。
    if (draft.alive && surplusGranted > 0) {
      draft.surplusSeasons = Math.max(draft.surplusSeasons, surplusGranted);
    }
  }

  draft.records = [...state.records, ...records];
  draft.rngState = cursor.state;
  refreshWayFlags(draft, content);
  return { state: draft, roundLog, over };
}

/**
 * 季推进 ＋ 死亡判定，即回合结算顺序的第 3、4 步。
 *
 * 抽成函数是因为追猎把一个「回合」拆成了两段：`performAction("hunt")` 只把猎物摆上来
 * （刻意不推进季节，否则起追本身就白耗一季），真正的收束发生在 `stalkAct` 判出 `over`
 * 的那一步。两处必须走同一份季推进与死亡判定，否则「追猎中饿死」这类边界会两套行为。
 *
 * `records` 就地追加死亡记录（调用方负责最后并进 `draft.records`）；`notices` 就地追加
 * 食余那两句（追猎那一侧传的是 `roundLog`，两条路的字都落在同一条日志栏里）。
 */
function closeSeason(
  draft: TaleState,
  content: TaleContent,
  t: TaleTuning,
  records: LifeRecord[],
  notices: string[],
): void {
  const cost = t.hungerPerSeason + (draft.season === WINTER ? t.winterHungerExtra : 0);
  /*
   * [饥饿节奏批] 食余先抵一道 —— **这是这一批唯一改动的结算步骤**。
   *
   * 一次得手管的不再只是当季那一顿：`TaleState.surplusSeasons` 非零时，这一季自动补
   * `huntSurplusGain` 点饱食并减一，**不需要任何点击**（正本：倾向状态位而非要点的存粮）。
   * 加与减写成同一个表达式而不是「先加后减两次夹紧」：中间那次夹紧会在饱食接近上限时
   * 悄悄吃掉一部分余粮，而玩家手里的账（按钮上写 +8、每季 −12）会对不上。
   */
  const fed = draft.surplusSeasons > 0;
  if (fed) {
    draft.surplusSeasons -= 1;
    notices.push(ENGINE_MESSAGES.surplusFeed);
    // 吃完的那一季要当场说一句：否则下一季饱食突然开始掉，玩家只会觉得莫名其妙
    if (draft.surplusSeasons === 0) notices.push(ENGINE_MESSAGES.surplusGone);
  }
  draft.hunger = clamp(draft.hunger - cost + (fed ? t.huntSurplusGain : 0), 0, t.hungerMax);
  const nextSeason = ((draft.season + 1) % 4) as Season;
  if (nextSeason === 0) draft.year += 1;
  draft.season = nextSeason;

  if (draft.hunger <= 0) {
    if (draft.flags.includes(SYS_FLAG_STARVING)) {
      records.push(die(draft, "starve", ENGINE_MESSAGES.deathStarve));
    } else {
      draft.flags = withFlags(draft.flags, [SYS_FLAG_STARVING]);
    }
  } else {
    draft.flags = withoutFlags(draft.flags, [SYS_FLAG_STARVING]);
  }
  /*
   * [2026-08-13] 寿终那一刻的**一次判定**（不是两套并行逻辑）：
   * 「归山」门槛已备 → 寿终就是成道；不备 → 仍是「终未成器」的失败。
   *
   * owner 对 M0 的原话是「最后寿终正寝，让人没有再次玩的欲望」，M1-P2 的答法是把寿终
   * 写成明确的失败。这一批把同一件事补上另一半：**有一条道，它的胜利形式就是寿终**。
   * 于是「养一只长寿厚德的兽」不再是没目标地活着，而是在走一条路。
   */
  if (draft.alive && draft.year > draft.lifespanMax) {
    const guishan = wayProgress(draft, content, "guishan");
    if (guishan.ready) {
      records.push(die(draft, "ascend", ENGINE_MESSAGES.deathWay.guishan, undefined, "guishan"));
    } else {
      records.push(die(draft, "oldage", ENGINE_MESSAGES.deathOldage));
    }
  }
}

function resolveRest(draft: TaleState, t: TaleTuning, notices: string[]): void {
  draft.hunger = clamp(draft.hunger + t.restHungerGain, 0, t.hungerMax);
  notices.push(ENGINE_MESSAGES.rest);
  const healed = t.restHealFlags.filter((flag) => draft.flags.includes(flag));
  if (healed.length > 0) {
    draft.flags = withoutFlags(draft.flags, healed);
    notices.push(ENGINE_MESSAGES.restHeal);
  }
}

/**
 * 蛰伏开奖。
 *
 * 1. 取达阈值的精气型中数值最高的一型（并列时按 zu→lin→xue→meng 顺序）。
 * 2. 候选池 = `content.organs` 中**未持有**且对该型 `affinity > 0` 的器官；
 *    按 `affinity × 该型精气` 加权不重复抽 `moltCandidateCount` 个。
 * 3. 候选里等权抽 1 个开出（M0 不做玩家挑选）。
 * 4. 该型精气清零。
 *
 * 池为空（内容耗尽）时：不清零、不获得，仅一条 notice —— 让玩家白费一季，
 * 但不因引擎侧内容短缺没收已攒的精气。
 */
function resolveMolt(
  draft: TaleState,
  cursor: RngCursor,
  content: TaleContent,
  t: TaleTuning,
  notices: string[],
  records: LifeRecord[],
): MoltResult | null {
  const ripe = ESSENCE_ORDER.filter((type) => draft.essence[type] >= t.moltThreshold);
  const type = ripe.reduce(
    (best, candidate) => (draft.essence[candidate] > draft.essence[best] ? candidate : best),
    ripe[0] ?? "zu",
  );
  const owned = new Set(draft.organIds);
  const pool = content.organs.filter(
    (organ) => !owned.has(organ.id) && (organ.affinity[type] ?? 0) > 0,
  );
  if (pool.length === 0) {
    notices.push(ENGINE_MESSAGES.moltNoCandidate);
    return null;
  }
  const amount = draft.essence[type];
  const candidates = weightedSample(
    cursor,
    pool,
    (organ) => (organ.affinity[type] ?? 0) * amount,
    t.moltCandidateCount,
  );
  const chosen = candidates[cursor.int(candidates.length)];
  if (!chosen) {
    notices.push(ENGINE_MESSAGES.moltNoCandidate);
    return null;
  }
  draft.organIds = [...draft.organIds, chosen.id];
  draft.stats = addStats(draft.stats, chosen.statMods);
  draft.essence = { ...draft.essence, [type]: 0 };
  const text = render(ENGINE_MESSAGES.molt, { organ: chosen.name });
  notices.push(text);
  records.push({ year: draft.year, season: draft.season, kind: "molt", text, refId: chosen.id });
  return { candidates, chosen, essenceType: type };
}

// ===== 回合：事件抽取 =====

/**
 * @param destinationId 本回合探索去的是哪一处；非探索行动恒为 null。
 *   带 `trigger.destinations` 的事件只在它列出的那几处入池 —— 那就是「独立事件池」。
 */
function matchesTrigger(
  state: TaleState,
  event: TaleEvent,
  action: ActionId,
  tags: Set<string>,
  destinationId: string | null,
): boolean {
  const trigger = event.trigger;
  if (trigger.once && state.firedOnceIds.includes(event.id)) return false;
  if (trigger.region !== "any" && trigger.region !== state.region) return false;
  if (trigger.actions && !trigger.actions.includes(action)) return false;
  if (trigger.destinations && (destinationId === null || !trigger.destinations.includes(destinationId))) {
    return false;
  }
  if (trigger.minYear !== undefined && state.year < trigger.minYear) return false;
  if (trigger.maxYear !== undefined && state.year > trigger.maxYear) return false;
  if (trigger.seasons && !trigger.seasons.includes(state.season)) return false;
  if (trigger.requiresOrganTags && !trigger.requiresOrganTags.some((tag) => tags.has(tag))) {
    return false;
  }
  if (trigger.requiresFlags && !trigger.requiresFlags.every((flag) => state.flags.includes(flag))) {
    return false;
  }
  if (trigger.forbidsFlags?.some((flag) => state.flags.includes(flag))) return false;
  if (!meetsStats(state.stats, trigger.minStats)) return false;
  return true;
}

/**
 * [2026-08-13] 天时／出身对某个事件权重的乘子。
 *
 * 多条命中则**相乘**（大旱之年 ×2 的水泽之事若同时是奇遇，逆产的 ×1.6 也照乘）——
 * 相加会让「两条都关照到的事件」只按一条算，而这类事件恰是世道最该放大的那些。
 *
 * ⚠️ 只读 `event.trigger.tags`，**绝不改 `event.trigger.weight` 原值**：那是所有一世共享
 * 的同一份内容对象，改它等于污染 content 并击穿「同种子同操作＝同终态」。
 */
function eventWeightMul(event: TaleEvent, premise: LifePremise): number {
  const tags = event.trigger.tags;
  if (!tags || tags.length === 0) return 1;
  let mul = 1;
  for (const table of [premise.sky.eventWeightMul, premise.origin.eventWeightMul]) {
    if (!table) continue;
    for (const tag of tags) {
      const factor = table[tag];
      if (factor !== undefined && factor > 0) mul *= factor;
    }
  }
  return mul;
}

/**
 * 抽一桩事。
 *
 * [S2] 探索的概率与池子都按**去处**分叉：概率走 `exploreEventChance`（含该处的 `eventMul`），
 * 池子走 `trigger.destinations`。两处共用一份算式与一份判据，`destinationPreview` 报给
 * 玩家的就是这里真跑的数 —— 界面上的「遇事 七成」不是另算的。
 */
function drawEvent(
  draft: TaleState,
  cursor: RngCursor,
  content: TaleContent,
  t: TaleTuning,
  premise: LifePremise,
  action: ActionId,
  destination: DestinationDef | null,
): TaleEvent | null {
  const chance = destination
    ? exploreEventChance(t, destination)
    : clamp(t.eventChanceBase, 0, 1);
  if (cursor.next() >= chance) return null;
  const tags = ownedTags(draft, content);
  const destinationId = destination?.id ?? null;
  const pool = content.events.filter((event) =>
    matchesTrigger(draft, event, action, tags, destinationId),
  );
  return weightedPick(cursor, pool, (event) => event.trigger.weight * eventWeightMul(event, premise));
}

// ===== 回合：死亡 =====

/**
 * 落死亡：改 draft 的存活位并**返回**那条 death 记录（不直接写进 draft.records）——
 * 让调用方把它并进本次调用的 records 缓冲，death 记录才能稳定落在末条。
 */
function die(
  draft: TaleState,
  ending: EndingType,
  text: string,
  refId?: string,
  /** [2026-08-13] 成道时是哪条道；与 `ending === "ascend"` 严格同步（见下） */
  way?: WayId,
): LifeRecord {
  draft.alive = false;
  draft.ending = ending;
  // [M2-B1] 死亡覆盖整场遭遇（两个阶段一起清）：界面不会拿到「已死却还在追／还在打」的状态
  draft.encounter = null;
  draft.wayAchieved = ending === "ascend" ? (way ?? null) : null;
  return { year: draft.year, season: draft.season, kind: "death", text, refId };
}

/**
 * 执行一个行动，走完固定的五步结算。
 *
 * 结算顺序（计划「回合结算顺序」节，固定不可变更）：
 * 1. 行动本体（探索／休憩／蛰伏开奖；**狩猎见 1'**）
 * 2. 事件抽取（步骤 1 已开战则跳过 —— 打起来了就没心思看别的）
 * 1'. 狩猎且本季没抽到事件 → `beginStalk` 起追，并**就此早退**（见下）
 * 3. 季推进：扣饱食（冬季加扣）→ 季 +1 → 跨年
 * 4. 死亡判定：饱食 ≤0 连续两季 → starve；year > lifespanMax → oldage
 * 5. records 追加（步骤 1-4 攒下的记录一次性并入，各条按产生时的岁/季打戳）
 *
 * 步骤 4 判定出死亡时会撤掉本回合抽出的事件（`pendingEvent` 返回 null）并清空 `combat`
 * 与 `stalk` —— 死亡覆盖一切未结算的东西，界面不会拿到「已死却还要选抉择」的状态。
 *
 * ## M1-P1 改动：一个狩猎回合被拆成两段
 * 狩猎不再当场结算食物。它要么撞上一桩狩猎事件（12 条 `actions:["hunt"]` 的内容仍旧入池），
 * 要么起追 —— 后者返回时 `state.encounter` 非空（`phase === "approach"`）、`pendingEvent`
 * 为 null，**且这一季尚未推进**（步骤 3〜5 全部推迟到遭遇收束那一步，共用 `closeSeason`）。
 * 客户端据 `state.encounter.phase` 切到遭遇屏的对应阶段；`availableActions` 在遭遇未收束时
 * 返回空数组。
 *
 * ## S2 改动：探索必须说清「往哪走」
 * `performAction(state, "explore", content, { destinationId })` —— 去处**必填**。
 * 一个探索回合于是变成：落路费（`explorePeril.travelCost`）→ 记「到过此地」→ 抽此地的事
 * → **没撞上事才掷遇袭**（同狩猎「要么撞上事，要么起追」的形状：事件卡与搏杀屏
 * 占同一块中央舞台，不能并存）。遇袭从该处的 `denizens` 里加权摇一头。
 *
 * ⚠️ **调用方纪律**：拿到非 null 的 `pendingEvent` 后必须先 `resolveChoice` 再进下一个
 * 回合。`TaleState` 没有承载未决事件的字段，引擎无从强制；直接再调 performAction 不会
 * 报错，事件会被静默丢掉。`once` 事件的 id 记在 `resolveChoice` 而不是抽取时，所以丢掉
 * 的稀有事件只是下一季可能重抽，不会本世永久消失。
 *
 * @throws 已死亡、战斗未结束、追猎未收束、该行动当前不可用、
 *   或去处参数不合规（探索没给／给了不认识的／门槛未达／非探索行动给了）时抛错
 */
export function performAction(
  state: TaleState,
  action: ActionId,
  content: TaleContent,
  options: ActionOptions = {},
): TurnResult {
  if (!state.alive) throw new Error("performAction: 已死亡，不能行动");
  if (state.encounter) {
    throw new Error(
      `performAction: 遭遇未收束（${state.encounter.phase}），先调 ${
        state.encounter.phase === "approach" ? "stalkAct" : "combatAct"
      }`,
    );
  }
  if (!availableActions(state, content).includes(action)) {
    throw new Error(`performAction: 当前不可执行行动 ${action}`);
  }
  const destination = resolveDestinationArg(state, content, action, options.destinationId);
  const huntMode = resolveHuntModeArg(action, options.huntMode);

  const premise = premiseOf(state, content);
  const t = tuningWithDeltas(content.tuning, [premise.sky.tuningDelta, premise.origin.tuningDelta]);
  const cursor = createCursor(state.rngState);
  const draft = draftOf(state);
  const notices: string[] = [];
  const records: LifeRecord[] = [];
  let moltResult: MoltResult | null = null;

  // 1. 行动本体（`hunt` 例外：起追要等事件抽取之后，见步骤 2 之后的「1'」）
  switch (action) {
    case "hunt":
      break;
    case "explore":
      resolveTravel(draft, t, destination as DestinationDef, notices);
      break;
    case "rest":
      resolveRest(draft, t, notices);
      break;
    case "dormant":
      moltResult = resolveMolt(draft, cursor, content, t, notices, records);
      break;
  }

  // 2. 事件抽取（先刷新四道资格 flag，让本回合刚够格的成道事件当场入池，不白等一季）
  refreshWayFlags(draft, content);
  const drawn = draft.encounter ? null : drawEvent(draft, cursor, content, t, premise, action, destination);

  /*
   * 2'. 探索：**本季没撞上事，才掷遇袭。**
   *
   * 排在事件抽取之后的理由与狩猎那一条同形（见下方 1'）：事件卡与搏杀屏占同一块中央
   * 舞台。若遇袭掷在前面，险地那三成会先把此地的事件池挡掉三成 —— 而「深处的东西」
   * 恰恰只在事件里，等于越险越看不到好东西。
   */
  if (action === "explore" && !drawn && destination) {
    rollAmbush(draft, cursor, content, t, destination, notices);
  }

  /*
   * 1'. 狩猎：**本季没撞上事，才起追。**
   *
   * 为什么把它排在事件抽取之后（而不是当作步骤 1 的行动本体）：内容库里有 12 条
   * `actions: ["hunt"]` 的狩猎事件（「丛中窥影」那一类），若狩猎一律直接起追，这 12 条
   * 就再也没有入池的机会 —— 一个玩法改动静默弄死四分之一的内容池，而且不会有任何测试变红。
   * 事件卡与追猎屏又占用同一块中央舞台，不能并存。于是这一季**要么撞上一桩事，要么起追**：
   * 前者是「狩猎路上遇见了别的东西」，后者是「盯上了一头具体的猎物」，两条都算狩猎。
   */
  if (action === "hunt" && !drawn) {
    /*
     * [饥饿节奏批] 两条狩猎路在这里分叉，且**只在这里**分叉：事件抽取（上面那一步）对
     * 两条路逐字相同 —— 12 条 `actions:["hunt"]` 的狩猎事件对速猎照样入池。
     * 若速猎绕开事件池，「一次点击」就会顺带买断四分之一的内容，而那不是玩家付的价钱。
     */
    if (huntMode === "quick") resolveQuickHunt(draft, cursor, content, t, notices);
    else beginStalk(draft, cursor, content, t, notices);
  }

  /*
   * 1.5 起追早退：`beginStalk` 只把猎物摆上来，这一季**刻意不推进**（否则光是起追就白耗
   * 一季），也不抽事件（玩家此刻该盯着遭遇屏，不该被别的事件插队）。季推进与死亡判定推迟到
   * 接近阶段收束的那一步，由同一个 `closeSeason` 兑现。
   *
   * ⚠️ **只有接近阶段早退**。探索遇袭起的是 `phase === "clash"` 的遭遇，那一季照常收束
   * （交锋是这一季**之内**发生的事，不该再吃掉一季）—— 与 M1 的行为逐字相同。
   */
  if (draft.encounter?.phase === "approach") {
    draft.records = [...state.records, ...records];
    draft.rngState = cursor.state;
    // 起追这一步不可能获得器官或秘藏，所以两个差集恒为空（省两次全表扫描）
    return {
      state: draft,
      pendingEvent: null,
      notices,
      moltResult: null,
      newSynergies: [],
      newTreasures: [],
    };
  }

  closeSeason(draft, content, t, records, notices);

  // 5. records 追加
  draft.records = [...state.records, ...records];
  draft.rngState = cursor.state;

  refreshWayFlags(draft, content);
  return {
    state: draft,
    pendingEvent: draft.alive ? drawn : null,
    notices,
    moltResult,
    newSynergies: newSynergiesBetween(state, draft, content),
    // 秘藏只从事件的结果分支来，这一步恒为空 —— 留着是为了两条路形状一致（见字段注释）
    newTreasures: newTreasuresBetween(state, draft, content),
  };
}

/**
 * [S2] 校验并解析「去哪一处」这个参数。
 *
 * 四条全部抛错而不是兜底，理由是同一条：**兜底会留下第二套语义**。
 * 尤其是「不填就去兽径」—— 一个漏改的调用点会静默退回 S2 之前的行为，
 * 而那种退化不会有任何测试变红（`performAction` 照样返回一个合法的回合）。
 */
function resolveDestinationArg(
  state: TaleState,
  content: TaleContent,
  action: ActionId,
  destinationId: string | undefined,
): DestinationDef | null {
  if (action !== "explore") {
    if (destinationId !== undefined) {
      throw new Error(`performAction: ${action} 不接受去处参数（去处只属于探索）`);
    }
    return null;
  }
  if (destinationId === undefined) {
    throw new Error("performAction: explore 必须指定去处（destinationId）");
  }
  const destination = destinationById(content, destinationId);
  if (!destination) throw new Error(`performAction: 未知去处 ${destinationId}`);
  if (!destinationUnlocked(state, destination)) {
    throw new Error(`performAction: 去处 ${destinationId} 尚未开启`);
  }
  return destination;
}

/**
 * [饥饿节奏批] 校验「怎么猎」这个参数。
 *
 * 与 `resolveDestinationArg` **一处不同形**：这里缺省合法（缺省 ＝ 追猎 ＝ 这一批之前
 * 唯一存在的行为），而去处缺省抛错。分别在于漏传的后果：漏传去处会静默退回 S2 之前的
 * 世界（第二套语义），漏传打法拿到的就是原样。非狩猎行动填了照样抛错 —— 那种调用一定是
 * 写错了，而静默吞掉一个写错的参数比抛错危险（`--tune` 那条教训）。
 */
function resolveHuntModeArg(action: ActionId, huntMode: HuntMode | undefined): HuntMode {
  if (action !== "hunt") {
    if (huntMode !== undefined) {
      throw new Error(`performAction: ${action} 不接受狩猎打法参数（huntMode 只属于狩猎）`);
    }
    return "stalk";
  }
  return huntMode ?? "stalk";
}

/**
 * [饥饿节奏批] 速猎：一次点击就了的那条路。**恒定消耗两次抽取**（挑猎物 ＋ 成败）。
 *
 * 与追猎的分别，逐条都是玩家在按钮上读得到的：
 * - 得手率一次掷定，**不进追猎屏**（没有距离／警觉／风向那四个量可算）；
 * - 食与精气各打一道折（`quickHuntFoodMul`／`quickHuntEssenceMul`）；
 * - **不留食余**（那是「盯上一头拖回穴里」才有的东西）；
 * - **不会反噬**：随手一扑惊不动大猎物，扑空就是扑空 —— 所以它也换不到搏杀那份精气。
 *
 * 夺命照记（`livesTaken`）：随手取的也是一条命，妖王的进度与化灵的断门在这里与追猎同解。
 */
function resolveQuickHunt(
  draft: TaleState,
  cursor: RngCursor,
  content: TaleContent,
  t: TaleTuning,
  notices: string[],
): void {
  const pool = preyPool(content, t);
  const prey = pool[cursor.int(pool.length)];
  if (!prey) throw new Error("resolveQuickHunt: 猎物表抽取失败");
  // [S3] 照过面就算见过 —— 与起追那一处同解（追丢了也数，何况这是扑到了眼前的一头）
  noteMetEnemy(draft, prey.id);
  if (cursor.next() >= quickHuntChanceOf(draft.stats.meng, t)) {
    notices.push(render(ENGINE_MESSAGES.quickHuntMiss, { enemy: prey.name }));
    return;
  }
  draft.hunger = clamp(draft.hunger + quickHuntFoodOf(t), 0, t.hungerMax);
  draft.essence = addEssence(draft.essence, scaleEssence(prey.essence, t.quickHuntEssenceMul));
  draft.livesTaken += 1;
  notices.push(render(ENGINE_MESSAGES.quickHuntCatch, { enemy: prey.name }));
}

function quickHuntChanceOf(meng: number, t: TaleTuning): number {
  return clamp(t.quickHuntChance + meng * t.quickHuntPerMeng, t.minChance, t.maxChance);
}

/**
 * 速猎得手回多少饱食 ＝ **一趟追猎总收益**的 `quickHuntFoodMul`（正本建议 55〜65%）。
 *
 * 「总收益」含食余（`huntFoodGain + huntSurplusSeasons × huntSurplusGain`），不是只按当场
 * 那一口折算 —— 后者会让速猎随着食余变强而**相对越来越差**：食余是这一批把收益从「当场」
 * 挪到「此后几季」的那一半，而速猎打的折该打在整趟的价值上，否则两颗按钮的价钱不同源，
 * 调一次食余就要手动去追一次速猎的数（那种要靠人记住的耦合迟早会漂）。
 */
function stalkWorthOf(t: TaleTuning): number {
  return t.huntFoodGain + t.huntSurplusSeasons * t.huntSurplusGain;
}

function quickHuntFoodOf(t: TaleTuning): number {
  return Math.round(stalkWorthOf(t) * t.quickHuntFoodMul);
}

/** 按倍率折算一份精气（向下取整：折扣就该是折扣，四舍五入会让 0.5 倍偶尔比一半还多）。 */
function scaleEssence(
  essence: Partial<Record<EssenceType, number>>,
  mul: number,
): Partial<Record<EssenceType, number>> {
  const out: Partial<Record<EssenceType, number>> = {};
  for (const type of ESSENCE_ORDER) {
    const value = essence[type];
    if (value === undefined) continue;
    out[type] = Math.floor(value * mul);
  }
  return out;
}

/**
 * [饥饿节奏批] 速猎按钮要显示的那几个数（纯函数、零副作用、不消耗抽取）。
 *
 * 界面**不许自己算**这几个数：得手率是 `quickHuntChance + 猛×quickHuntPerMeng` 再夹紧，
 * 食是 `huntFoodGain × quickHuntFoodMul` 再取整 —— 两条公式抄进 tale-client 就破了
 * 「客户端零游戏逻辑」，而不显示则按钮又变回翻牌（M1-P1 铁律）。
 */
export function quickHuntPreview(state: TaleState, content: TaleContent): QuickHuntPreview {
  const t = lifeTuning(state, content);
  return {
    chance: quickHuntChanceOf(state.stats.meng, t),
    foodGain: quickHuntFoodOf(t),
    stalkFoodGain: t.huntFoodGain,
    stalkWorth: stalkWorthOf(t),
    essenceMul: t.quickHuntEssenceMul,
    stalkSurplusSeasons: t.huntSurplusSeasons,
    surplusGain: t.huntSurplusGain,
  };
}

/**
 * [S2] 动身：落路费、记「到过此地」、给一句此地的旁白。
 *
 * **不掷任何骰** —— 路费与记档都是确定的，掷骰只发生在事件抽取与遇袭那两处。
 * 「到过此地」记在第一次去的那一刻而不是收束时：一世走到一半刷新页面，去过的地方
 * 不该白去（跨世那一份由客户端从这里抄进 `Bloodline`）。
 */
function resolveTravel(
  draft: TaleState,
  t: TaleTuning,
  destination: DestinationDef,
  notices: string[],
): void {
  const cost = t.explorePeril[destination.peril].travelCost;
  if (cost > 0) draft.hunger = clamp(draft.hunger - cost, 0, t.hungerMax);
  if (!draft.visitedDestinationIds.includes(destination.id)) {
    draft.visitedDestinationIds = [...draft.visitedDestinationIds, destination.id];
  }
  notices.push(render(ENGINE_MESSAGES.explore, { place: destination.name }));
}

/**
 * [S2] 遇袭：从此地的 `denizens` 加权摇一头开战。
 *
 * **恒定消耗一次抽取**（概率掷骰），命中才多消耗一次（加权挑兽）—— 与 `drawEvent`
 * 同一种形状。空 `denizens`（兽径之外没有第二处这样）直接连概率骰都不掷：一处摇不出
 * 敌人的地方掷一次骰再丢掉，只会让「抽取次数随内容变化」多一个隐形来源。
 */
function rollAmbush(
  draft: TaleState,
  cursor: RngCursor,
  content: TaleContent,
  t: TaleTuning,
  destination: DestinationDef,
  notices: string[],
): void {
  if (destination.denizens.length === 0) return;
  if (cursor.next() >= t.explorePeril[destination.peril].ambushChance) return;
  const picked = weightedPick(cursor, destination.denizens, (denizen) => denizen.weight);
  const enemy = picked ? enemyById(content, picked.enemyId) : null;
  if (!enemy) return;
  notices.push(render(ENGINE_MESSAGES.exploreAmbush, { place: destination.name, enemy: enemy.name }));
  // [M2-B1] 与起追、事件冲突走同一个入口 —— 分别只在 `origin`（它先动的手，所以起手势要扣）
  beginEncounter(draft, enemy, "ambush", cursor, t, notices);
}

// ===== 事件抉择 =====

function meetsChoiceRequirement(
  state: TaleState,
  choice: EventChoice,
  tags: Set<string>,
): boolean {
  const requires = choice.requires;
  if (!requires) return true;
  if (!meetsStats(state.stats, requires.stats)) return false;
  if (requires.organTags && requires.organTags.length > 0) {
    if (!requires.organTags.some((tag) => tags.has(tag))) return false;
  }
  if (requires.essenceMin) {
    for (const type of ESSENCE_ORDER) {
      const need = requires.essenceMin[type];
      if (need !== undefined && state.essence[type] < need) return false;
    }
  }
  return true;
}

/**
 * 当前满足门槛的抉择下标。
 *
 * `content` 必填 —— `EventChoice.requires.organTags` 要靠它把 `organIds` 解析成 tag
 * （神种器官只存在于 `seeds[].organ`，见 `organIndex`）。接口正本原为两参，2026-08-11
 * 仲裁后已改成三参必填：漏传是 typecheck 失败，而不是某类抉择被静默置灰成死内容。
 */
export function eligibleChoiceIdxs(
  state: TaleState,
  event: TaleEvent,
  content: TaleContent,
): number[] {
  const tags = ownedTags(state, content);
  const idxs: number[] = [];
  event.choices.forEach((choice, idx) => {
    if (meetsChoiceRequirement(state, choice, tags)) idxs.push(idx);
  });
  return idxs;
}

/**
 * 落账一个 `EffectDelta`。
 *
 * 应用顺序固定：stats → hunger → lifespan → essence → addOrganId → flags →
 * startCombat → die。（stats 先落账，所以同一 delta 里加了 ti 又开战时，
 * `playerHp` 用的是加成后的 ti。）
 *
 * 不产 notices —— `ChoiceResult`（接口正本）没有 notices 槽位，效果的可见痕迹全部落在
 * `records`（获得器官 → molt、死亡 → death）与 state 本身（开战 → `combat` 非 null）。
 *
 * @throws `addOrganId`／`startCombat` 引用的 id 不存在时抛错（内容 bug 要吵）
 */
function applyEffects(
  draft: TaleState,
  effects: EffectDelta,
  content: TaleContent,
  t: TaleTuning,
  records: LifeRecord[],
  cursor: RngCursor,
): void {
  if (effects.stats) draft.stats = addStats(draft.stats, effects.stats);
  if (effects.hunger !== undefined) {
    draft.hunger = clamp(draft.hunger + effects.hunger, 0, t.hungerMax);
  }
  if (effects.lifespan !== undefined) {
    draft.lifespanMax = Math.max(0, draft.lifespanMax + effects.lifespan);
  }
  if (effects.essence) draft.essence = addEssence(draft.essence, effects.essence);
  if (effects.addOrganId !== undefined) {
    const organ = organIndex(content).get(effects.addOrganId);
    if (!organ) throw new Error(`applyEffects: 未知器官 ${effects.addOrganId}`);
    // 已持有则整体跳过：不重复加 statMods，也不写记录（什么都没发生）。
    if (!draft.organIds.includes(organ.id)) {
      draft.organIds = [...draft.organIds, organ.id];
      draft.stats = addStats(draft.stats, organ.statMods);
      records.push({
        year: draft.year,
        season: draft.season,
        kind: "molt",
        text: render(ENGINE_MESSAGES.organGained, { organ: organ.name }),
        refId: organ.id,
      });
    }
  }
  if (effects.addFlags) draft.flags = withFlags(draft.flags, contentFlags(effects.addFlags));
  if (effects.removeFlags) {
    draft.flags = withoutFlags(draft.flags, contentFlags(effects.removeFlags));
  }
  if (effects.startCombat !== undefined) {
    const enemy = enemyById(content, effects.startCombat);
    if (!enemy) throw new Error(`applyEffects: 未知敌人 ${effects.startCombat}`);
    /*
     * [M2-B1] 事件撞上的冲突不再是另一条代码路径：同一个 `beginEncounter`，只是 origin 不同。
     * 这里不收 `notices`（抉择那一步的旁白是 `outcomeText`），开场那一句落进遭遇自己的日志。
     */
    beginEncounter(draft, enemy, "event", cursor, t, []);
  }
  // [2026-08-13] 两桩「事迹」：内容明写了取命／尝神兽的分支，落到两条道的判据上
  if (effects.takesLife !== undefined && effects.takesLife > 0) {
    draft.livesTaken += Math.floor(effects.takesLife);
  }
  if (effects.devourDivine === true) {
    draft.flags = withFlags(draft.flags, [SYS_FLAG_DIVINE_EATEN]);
  }
  /*
   * [S2] 秘藏：只记「发现」这一位，收益照常写在同一个 EffectDelta 的别的字段里。
   *
   * 未知 id **抛错**（与 `addOrganId`／`startCombat` 同待遇）：一条写错了秘藏 id 的
   * 内容会让图鉴上那一格永远是「？」，而玩家明明已经把它拿到手了 —— 那种失效是静默的。
   */
  if (effects.findTreasureId !== undefined) {
    const treasure = allTreasures(content).find((item) => item.id === effects.findTreasureId);
    if (!treasure) throw new Error(`applyEffects: 未知秘藏 ${effects.findTreasureId}`);
    if (!draft.foundTreasureIds.includes(treasure.id)) {
      draft.foundTreasureIds = [...draft.foundTreasureIds, treasure.id];
      records.push({
        year: draft.year,
        season: draft.season,
        kind: "event",
        text: render(ENGINE_MESSAGES.treasureFound, { treasure: treasure.name }),
        refId: treasure.id,
      });
    }
  }
  if (effects.die !== undefined) {
    /*
     * 成道由哪条道兑现：内容显式写的 `way` 优先；没写就取「已够格且最接近的那条」。
     * 兜底不是宽容而是必要 —— 三个成道事件各自的 `requiresFlags` 已经保证了对应的道够格，
     * 而 `wayAchieved` 为 null 的 ascend 会让列传退回泛用结语（那正是这一批要消灭的错）。
     */
    const way =
      effects.die === "ascend"
        ? (effects.way ?? pickAchievedWay(draft, content))
        : undefined;
    records.push(die(draft, effects.die, deathText(effects.die, way), undefined, way));
  }
}

/** 成道时没显式声明道 → 取已够格的那条（多条则按 `WAY_ORDER`），全都不够格则取最接近的。 */
function pickAchievedWay(draft: TaleState, content: TaleContent): WayId {
  const progress = waysProgress(draft, content);
  return progress.readyIds[0] ?? progress.nearest;
}

/** 事件直接判定的死亡用哪句旁白（战斗致死走 combatAct，那里带击杀者名字）。 */
function deathText(ending: EndingType, way?: WayId): string {
  switch (ending) {
    case "starve":
      return ENGINE_MESSAGES.deathStarve;
    case "oldage":
      return ENGINE_MESSAGES.deathOldage;
    // [2026-08-13] 成道四条各有各的走法：登神是白光贯顶，妖王是众兽伏首，两句不能混用
    case "ascend":
      return way === undefined ? ENGINE_MESSAGES.deathAscend : ENGINE_MESSAGES.deathWay[way];
    case "slain":
      return ENGINE_MESSAGES.deathSlainGeneric;
  }
}

/**
 * 结算一次事件抉择：加权抽一个 outcome，落账其 effects。
 *
 * 记录顺序：先写 outcome 本身的 `event` 记录，再写 effects 派生的记录
 * （获得器官的 `molt`、死亡的 `death`），保证 `death` 恒为末条。
 *
 * @param choiceIdx 必须在 `eligibleChoiceIdxs(state, event, content)` 内
 * @throws 已死亡、下标不合法、或 outcomes 为空时抛错
 */
export function resolveChoice(
  state: TaleState,
  event: TaleEvent,
  choiceIdx: number,
  content: TaleContent,
): ChoiceResult {
  if (!state.alive) throw new Error("resolveChoice: 已死亡，不能再作抉择");
  if (!eligibleChoiceIdxs(state, event, content).includes(choiceIdx)) {
    throw new Error(`resolveChoice: 抉择 ${choiceIdx} 不满足门槛或不存在（事件 ${event.id}）`);
  }
  const choice = event.choices[choiceIdx];
  if (!choice) throw new Error(`resolveChoice: 抉择 ${choiceIdx} 不存在（事件 ${event.id}）`);

  const cursor = createCursor(state.rngState);
  const outcome = weightedPick(cursor, choice.outcomes, (candidate) => candidate.weight);
  if (!outcome) throw new Error(`resolveChoice: 抉择 ${choiceIdx} 没有 outcomes（事件 ${event.id}）`);

  const draft = draftOf(state);
  // once 事件在**结算时**才烧掉 id（而不是 performAction 抽出时）：这样界面若因为
  // 刷新/误操作丢了未结算的稀有事件，它下一季还能再抽出来，而不是本世永久消失。
  if (event.trigger.once && !draft.firedOnceIds.includes(event.id)) {
    draft.firedOnceIds = [...draft.firedOnceIds, event.id];
  }
  const records: LifeRecord[] = [
    {
      year: draft.year,
      season: draft.season,
      kind: "event",
      text: outcome.text,
      refId: event.id,
    },
  ];
  applyEffects(draft, outcome.effects, content, lifeTuning(state, content), records, cursor);
  draft.records = [...state.records, ...records];
  draft.rngState = cursor.state;
  refreshWayFlags(draft, content);

  return {
    state: draft,
    outcomeText: outcome.text,
    delta: cloneDelta(outcome.effects),
    newSynergies: newSynergiesBetween(state, draft, content),
    newTreasures: newTreasuresBetween(state, draft, content),
  };
}

// ===== 交锋（M1-P2 重做 · M2-B1 加深）=====
//
// 玩法正本：M1-P2 见 `2026-08-12-liezhuan-m1-playable-plan.md`；M2-B1 见
// `2026-08-14-liezhuan-m2-combat-core-plan.md` 的「B1」。
//
// M0 的战斗是四选一（战／逃／诈／器官技），而「战」在任何局面下都不比别的差 —— 于是它
// 事实上是一颗按钮，剩下三颗是装饰。M1-P2 把它拆成「三个部位 × 三种姿态 × 带冷却的技」，
// 并给敌人加了两个玩家出手前就看得见的量（护着哪儿、这一回合打算干什么）。
//
// M2-B1 要回答的是下一个问题：**一场架凭什么值 5〜10 个回合**。M1-P2 的架 2〜5 合，
// 12 件器官、10 条组合、四项属性根本没有足够的回合去表达；而拉长回合若只是双方血更厚，
// 那就是把同一道题重复十次。所以拉长的同时加了三条**跨回合**的经营线：
//
//   势     每合自涨、乘隙与不挨伤多涨 —— 强招（技与决杀）的唯一货币，出招节奏成为决策。
//   部位伤 咬出来的伤**整场不消**：拆它的腿（追不上也走不掉）／废它的眼（打不中也不反击）
//          ／放它的血（每合自己掉）。三颗咬击于是从「三种一次性工具」变成三条路线。
//   行为段 它血过半会换打法（`EnemyDef.stages`），且各有一处**可被识破的弱点**。
//
// 再加上四项属性各自接到一个玩家读得到的量上（猛＝伤害／体＝血与减伤／灵＝势与识破／
// 德＝闪避、暴击与它的退意）—— 这一条是 owner 那句「好好展示积累的各项指标的作用」的
// 直接兑现，落在 `encounterPreview().stats` 上，界面逐项念，不藏在公式里。

function rollDamage(cursor: RngCursor, meng: number, t: TaleTuning, multiplier: number): number {
  const base = t.combatDamageBase + Math.floor(meng / t.combatDamageMengDivisor);
  const jitter = t.combatDamageJitter;
  const swing = jitter > 0 ? cursor.int(jitter * 2 + 1) - jitter : 0;
  return Math.max(1, Math.floor((base + swing) * multiplier));
}

/**
 * 一个伤害数的真实区间 —— **走 `rollDamage` 的同一条算式**，只是把 swing 换成三端。
 *
 * 抖动是均匀的，所以最小/最大就在 `swing = ∓jitter` 两端（`floor` 单调）。倍率为 0
 * （它这一合不出手）时整段是 0，不能被 `Math.max(1, …)` 顶成 1。
 */
function damageRange(meng: number, t: TaleTuning, multiplier: number): DamageRange {
  if (multiplier <= 0) return { mid: 0, min: 0, max: 0 };
  const base = t.combatDamageBase + Math.floor(meng / t.combatDamageMengDivisor);
  const jitter = Math.max(0, t.combatDamageJitter);
  const at = (swing: number): number => Math.max(1, Math.floor((base + swing) * multiplier));
  return { mid: at(0), min: at(-jitter), max: at(jitter) };
}

const ZERO_DAMAGE: DamageRange = { mid: 0, min: 0, max: 0 };

/**
 * [M2-B1] 我方受伤的**减免**（体给的），落在区间的三端上。
 *
 * 与倍率分开处理是刻意的：倍率是「这一下有多重」，减免是「这身皮有多厚」——
 * 后者对轻伤的相对保护更大，那正是「体」该有的手感。下限仍是 1（它打中了就该疼），
 * 但整段为 0（它这合不出手）时不被顶成 1。
 */
function softenRange(range: DamageRange, toughness: number): DamageRange {
  if (toughness <= 0 || range.max <= 0) return range;
  const soften = (value: number): number => (value <= 0 ? 0 : Math.max(1, value - toughness));
  return { mid: soften(range.mid), min: soften(range.min), max: soften(range.max) };
}

/**
 * [M2-B1] 我方出手的总倍率：部位 × 姿态 × 守备 × 弱点。
 *
 * **识破的弱点无视守备减伤**：它护得住的地方不是它护不住的地方 —— 若弱点还要吃减半，
 * 「识破」这件事在守备正好压在弱点上的那一合就白识破了，而那恰是玩家最想用它的时候。
 */
function biteMultiplier(
  t: TaleTuning,
  part: BodyPart,
  stance: Stance,
  guarded: boolean,
  guardIntent: boolean,
  weakPoint: boolean,
): number {
  const stanceOut = t.combatStanceMul[stance]?.out ?? 1;
  const guardMul =
    guarded && !weakPoint ? t.combatGuardDamageMul * (guardIntent ? t.combatGuardIntentMul : 1) : 1;
  const weakMul = weakPoint ? t.weaknessDamageMul : 1;
  return (t.combatBiteMul[part] ?? 1) * stanceOut * guardMul * weakMul;
}

/** [M2-B1] 决杀的伤害倍率：攒了几点势就有多重（消耗全部势）。 */
function finisherMultiplier(t: TaleTuning, stance: Stance, momentum: number): number {
  const stanceOut = t.combatStanceMul[stance]?.out ?? 1;
  return (t.encounterFinisherMul + momentum * t.encounterFinisherPerMomentum) * stanceOut;
}

/**
 * 我方受伤的总倍率：意图 × 行为段 × 姿态 × 迟滞 × 腿伤 × 护体。0 ＝ 它这一回合不出手。
 *
 * [M2-B1] 「一场架 5〜10 合」这件事**不靠把敌人的伤害调废**：拉长的是双方的耐打
 * （敌人血量 ×1.8 在内容里、我方血量 `combatHpPerTi` 在这里），伤害公式一个字没动 ——
 * 否则猛的成长会跟着变废，而那是四项属性里最直白的一项。
 */
function incomingMultiplier(
  t: TaleTuning,
  intentKind: EnemyIntentKind,
  stance: Stance,
  slow: number,
  legWounds: number,
  ward: number,
  stageMul: number,
): number {
  const intentMul = t.combatIntentDamageMul[intentKind] ?? 1;
  if (intentMul <= 0) return 0;
  return (
    intentMul *
    stageMul *
    (t.combatStanceMul[stance]?.in ?? 1) *
    (slow > 0 ? t.combatSlowDamageMul : 1) *
    Math.pow(t.woundLegDamageMul, legWounds) *
    (ward > 0 ? t.combatWardDamageMul : 1)
  );
}

/**
 * 反击的总倍率（预览与真跑共用这一份 —— M1-P2 时它在两处各抄了一遍）。
 *
 * 反击也是「受伤」，所以同样吃姿态与护体；**不吃迟滞与腿伤**（反口是本能，不用起势）。
 */
function counterMultiplier(t: TaleTuning, stance: Stance, ward: number): number {
  return (
    t.combatCounterDamageMul *
    (t.combatStanceMul[stance]?.in ?? 1) *
    (ward > 0 ? t.combatWardDamageMul : 1)
  );
}

/**
 * [M2-B1] 它此刻打空的概率：技能致盲 ＋ 每层眼伤。
 *
 * 上界是 1 而不是 `maxChance`：`combatBlindMissChance` 是内容可以调成 1 的「必空」档
 * （测试的 `ALWAYS_MISS` 正是这么用的），拿全局概率夹紧去截它等于让那一档说话不算数。
 */
function enemyMissChanceOf(t: TaleTuning, blind: number, eyeWounds: number): number {
  return clamp(fromBlindMiss(t, blind) + eyeWounds * t.woundEyeMissChance, 0, 1);
}

function fromBlindMiss(t: TaleTuning, blind: number): number {
  return blind > 0 ? t.combatBlindMissChance : 0;
}

/** [M2-B1] 它还反不反击（技能致盲、或眼伤到了那一层就不再反口）。 */
function canCounter(t: TaleTuning, blind: number, eyeWounds: number): boolean {
  return blind <= 0 && eyeWounds < t.woundEyeNoCounterAt;
}

/** [M2-B1] 它还走不走得掉（腿伤到那一层就走不掉了）。 */
function canFlee(t: TaleTuning, slow: number, legWounds: number): boolean {
  return slow <= 0 && legWounds < t.woundLegNoFleeAt;
}

/** 逃跑成功率（正本公式 ＋ [M1-P2] 致盲加成：它看不见你往哪去）。 */
function fleeChanceOf(
  state: TaleState,
  enemy: EnemyDef,
  t: TaleTuning,
  blind: number,
  eyeWounds: number,
): number {
  return clamp(
    t.fleeBase +
      (state.stats.ling - enemy.meng) * t.fleePerLingDiff -
      enemy.fleeBias * t.fleeBiasFactor +
      (blind > 0 || eyeWounds > 0 ? t.combatBlindFleeBonus : 0),
    t.minChance,
    t.maxChance,
  );
}

/**
 * [M2-B1] 咬这个部位留不留**整场伤**：只有腿与眼留。
 *
 * 咬喉刻意不留 —— 它是**爆发**那一档（伤害 ×1.6，收官用）。若它也带一条持续线，
 * 三颗咬击就又退化成「挑伤害最高那颗」（M1-P2 立三种工具时踩过的那个坑：
 * 高伤的那颗若还白拿附带，另两颗的低伤就不是价钱而是纯亏）。
 */
function woundOf(part: BodyPart): BodyPart | null {
  return part === "throat" ? null : part;
}

/**
 * [S1] 一个技的代价此刻付不付得起。
 *
 * `hp` 类要求**付完还活着**（自伤 3 而只剩 3 血的按钮是陷阱，不是取舍）；
 * `essence` 类看这一型精气够不够。
 */
function canAfford(cost: CombatSkillCost | undefined, playerHp: number, state: TaleState): boolean {
  if (!cost) return true;
  if (cost.kind === "hp") return playerHp - cost.amount > 0;
  return state.essence[cost.type] >= cost.amount;
}

/** [S1] 一个技的伤害倍率：数据写了就用它，否则吃 `organSkillDamageMul`；再乘当前姿态。 */
function skillDamageMul(skill: CombatSkillDef, t: TaleTuning, stance: Stance): number {
  const base = skill.damageMul ?? t.organSkillDamageMul;
  return base * (t.combatStanceMul[stance]?.out ?? 1);
}

/** [S1] 一个技按哪个属性出伤（缺省猛；灵性技按灵 —— 灵系 build 的输出手）。 */
function skillStatOf(skill: CombatSkillDef, stats: Stats): number {
  return skill.stat === "ling" ? stats.ling : stats.meng;
}

function skillEffectsOf(skill: CombatSkillDef): CombatSkillEffect[] {
  return [...(skill.effects ?? [])];
}

/** [M2-B1] 这一手技要花几点势。 */
function skillMomentumOf(skill: CombatSkillDef, t: TaleTuning): number {
  return Math.max(0, Math.round(skill.momentum ?? t.encounterSkillMomentumCost));
}

/**
 * [S1] 这个技出不出伤 —— 判据是**数据写的 `damageMul === 0`**，不是从 effect 反推。
 *
 * 先前的写法是「`heal` 类不出伤」，那条规则一到组合技就站不住：「穿地」是从土下窜出来
 * 咬一口**并且**躲开它那一下（`brace` ＋ 伤害），「溃咬」是伤害 ＋ 附毒。效果与出伤是
 * 两件正交的事，谁不出伤该由内容自己说。
 *
 * 之所以不能靠 `damageMul: 0` 顺着算式自然算成 0：`rollDamage` 有 `Math.max(1, …)` 兜底
 * （伤害不许是 0），所以 0 倍率会打出 1 点伤 —— 界面写「不出伤」而真跑掉 1 血，
 * 正是这一批要消灭的那类谎。所以这里是显式分支。
 */
function skillDealsDamage(skill: CombatSkillDef, t: TaleTuning): boolean {
  return (skill.damageMul ?? t.organSkillDamageMul) > 0;
}

/**
 * [M2-B1] **遭遇屏的公共只读数** —— 接近与交锋两个阶段共用的那一套语汇。
 *
 * 它是「一套 UI 语汇」这条交付线的落点：同一张卡的头（名号／来路／行为段／弱点）、
 * 势条、部位伤牌、四相盘、整场日志，两个阶段读的都是这一个函数；中段（四量／指令网格）
 * 才随 `phase` 换。没有它，两个阶段就只是长得像的两块屏。
 *
 * @throws 不在遭遇中、或敌人 id 失效时抛错
 */
export function encounterPreview(state: TaleState, content: TaleContent): EncounterPreview {
  const encounter = state.encounter;
  if (!encounter) throw new Error("encounterPreview: 当前不在遭遇中");
  const enemy = encounterEnemy(state, content, "encounterPreview");
  const t = lifeTuning(state, content);
  const clash = encounter.clash;
  const stage = stageDefOf(enemy, encounter.stage);
  const weakness = enemy.weakness ?? null;
  const lingRounds = Math.max(
    1,
    t.weaknessRevealRounds - Math.floor(state.stats.ling / t.weaknessRevealPerLing),
  );

  return {
    enemyId: enemy.id,
    enemyName: enemy.name,
    enemyDesc: enemy.desc,
    enemyArtId: enemy.artId ?? enemy.id,
    partNames: partNamesOf(enemy),
    origin: encounter.origin,
    phase: encounter.phase,
    momentum: encounter.momentum,
    momentumMax: encounter.momentumMax,
    momentumPerRound: t.encounterMomentumPerRound,
    finisherMomentum: t.encounterFinisherMomentum,
    wounds: { ...encounter.wounds },
    woundCap: t.woundCap,
    legCrippled: encounter.wounds.leg >= t.woundLegNoFleeAt,
    eyeRuined: encounter.wounds.eye >= t.woundEyeNoCounterAt,
    stageIndex: encounter.stage,
    stageCount: enemy.stages?.length ?? 1,
    stageName: stage?.name ?? null,
    weaknessPart: weakness?.part ?? null,
    weaknessName: weakness?.name ?? null,
    weaknessFound: encounter.weaknessFound,
    /*
     * 「还差几合看得出来」也要上屏：一个数字在那儿倒数，玩家才知道「再撑两合就看出来了」
     * 是一条真的出路（而不是又一件不知何时发生的事）。已识破或这头兽没有弱点时为 0。
     */
    weaknessRoundsLeft:
      weakness === null || encounter.weaknessFound
        ? 0
        : Math.max(0, lingRounds - (clash?.round ?? 0)),
    weaknessHitsLeft:
      weakness === null || encounter.weaknessFound
        ? 0
        : Math.max(0, t.weaknessRevealHits - encounter.weaknessHits),
    stats: {
      meng: state.stats.meng,
      ti: state.stats.ti,
      ling: state.stats.ling,
      de: state.stats.de,
      biteBase: t.combatDamageBase + Math.floor(state.stats.meng / t.combatDamageMengDivisor),
      mengBiteBonus: Math.floor(state.stats.meng / t.combatDamageMengDivisor),
      hpMax: combatHpOf(state.stats, t),
      toughness: toughnessOf(state.stats, t),
      momentumMax: encounter.momentumMax,
      momentumStart: startMomentumOf(state.stats, t, encounter.origin),
      weaknessRoundsBase: lingRounds,
      fleeChance: fleeChanceOf(state, enemy, t, clash?.blind ?? 0, encounter.wounds.eye),
      dodgeChance: dodgeChanceOf(state.stats, t),
      critChance: critChanceOf(state.stats, t),
      enemyFleeMul: 1 + state.stats.de * t.combatEnemyFleePerDe,
      pounceChanceBonus: state.stats.meng * t.stalkPouncePerMeng,
    },
    partBias: enemyPartBias(state, content, enemy),
    log: [...encounter.log],
  };
}

/**
 * [M2-B3] 「食之所偏」查表：把 `EnemyDef.partBias` 的 id 换成屏幕念得出来的三项。
 *
 * 悬空 id **抛错**而不是跳过（同 `findTreasureId` 那条）：一条指向不存在部件的偏好
 * 会让屏幕上少一件东西，而少的那一件不会有任何测试变红。
 */
function enemyPartBias(
  state: TaleState,
  content: TaleContent,
  enemy: EnemyDef,
): readonly EnemyPartBias[] {
  const owned = new Set(state.organIds);
  return (enemy.partBias ?? []).map((partId) => {
    const part = partById(content, partId);
    if (!part) throw new Error(`enemyPartBias: 敌人 ${enemy.id} 的未知部件 ${partId}`);
    return {
      partId: part.id,
      partName: part.name,
      essenceType: part.essenceType,
      owned: owned.has(part.organId),
    };
  });
}

/**
 * 交锋屏要显示的全部只读数（纯函数、不消耗抽取）。
 *
 * @throws 不在交锋阶段、或敌人 id 失效时抛错 —— 界面只该在 `phase === "clash"` 时问它
 */
export function combatPreview(state: TaleState, content: TaleContent): CombatPreview {
  const encounter = state.encounter;
  const combat = clashOf(state);
  if (!encounter || !combat) throw new Error("combatPreview: 当前不在交锋阶段");
  const enemy = encounterEnemy(state, content, "combatPreview");
  const t = lifeTuning(state, content);
  const tags = ownedTags(state, content);
  const meng = state.stats.meng;
  const guardIntent = combat.intent.kind === "guard";
  const wounds = encounter.wounds;
  const stageMul = stageDamageMulOf(enemy, encounter.stage);
  const toughness = toughnessOf(state.stats, t);
  const weakPart = encounter.weaknessFound ? (enemy.weakness?.part ?? null) : null;

  const bites: BitePreview[] = BODY_PARTS.map((part) => {
    const guarded = part === combat.guardPart;
    const weakPoint = weakPart === part;
    const mul = biteMultiplier(t, part, combat.stance, guarded, guardIntent, weakPoint);
    const counterMul = counterMultiplier(t, combat.stance, combat.ward);
    const damage = damageRange(meng, t, mul);
    /*
     * [M2-B1] 部位伤当回合就生效（且**每一咬都留一层**，直到 `woundCap`），所以
     * 「咬完之后它这一下能打我多少」按咬完的状态算。落不下来只剩两种情形：
     * 已经堆满上限，以及**这一咬就把它打死了**（后者按 `damage.min` 判，宁可少许一件
     * 也不多许一件 —— `combatAct` 只在存活时记伤）。
     */
    const survives = combat.enemyHp - damage.min > 0;
    const stacks = wounds[part];
    // 咬喉不留伤（`woundOf` 那条），所以它那颗按钮上恒不写「伤 N → N+1」
    const woundLands = woundOf(part) !== null && survives && stacks < t.woundCap;
    const legAfter = part === "leg" && woundLands ? wounds.leg + 1 : wounds.leg;
    const eyeAfter = part === "eye" && woundLands ? wounds.eye + 1 : wounds.eye;
    const afterMul = incomingMultiplier(
      t,
      combat.intent.kind,
      combat.stance,
      combat.slow,
      legAfter,
      combat.ward,
      stageMul,
    );
    return {
      part,
      damage,
      guarded,
      weakPoint,
      counterChance:
        guarded && !weakPoint && canCounter(t, combat.blind, wounds.eye) ? t.combatGuardCounterChance : 0,
      counterDamage: softenRange(damageRange(enemy.meng, t, counterMul), toughness),
      woundStacks: stacks,
      woundLands,
      /*
       * 乘隙：咬中它**没护着**的地方多攒一点势。这一位把「避开守备」从「少挨一半伤」
       * 升成「少挨一半伤 ＋ 攒出下一记大招」—— 于是读守备这件事在长仗里有了复利。
       */
      momentumGain:
        t.encounterMomentumPerRound + (guarded ? 0 : t.encounterMomentumOpenGuard),
      stopsFlee:
        part === "leg" &&
        combat.intent.kind === "flee" &&
        canFlee(t, combat.slow, wounds.leg) &&
        survives,
      incomingAfter: softenRange(damageRange(enemy.meng, t, afterMul), toughness),
      incomingAfterMissChance: enemyMissChanceOf(t, combat.blind, eyeAfter),
    };
  });

  const stances: StancePreview[] = STANCES.map((to) => {
    const mul = incomingMultiplier(
      t,
      combat.intent.kind,
      to,
      combat.slow,
      wounds.leg,
      combat.ward,
      stageMul,
    );
    return {
      to,
      current: to === combat.stance,
      outMul: t.combatStanceMul[to]?.out ?? 1,
      inMul: t.combatStanceMul[to]?.in ?? 1,
      incomingIfSwitch: softenRange(damageRange(enemy.meng, t, mul), toughness),
    };
  });

  const skills: CombatSkillPreview[] = combatSkills(state, content).map((entry) => {
    const skill = entry.skill;
    const cooldown = skill.cooldown ?? t.combatSkillCooldown;
    const cooldownLeft = Math.max(0, combat.skillCooldowns[entry.skillId] ?? 0);
    const affordable = canAfford(skill.cost, combat.playerHp, state);
    const momentumCost = skillMomentumOf(skill, t);
    const hasMomentum = encounter.momentum >= momentumCost;
    return {
      skillId: entry.skillId,
      organId: entry.organId,
      synergyId: entry.synergyId,
      forged: entry.forged,
      name: skill.name,
      desc: skill.desc,
      effects: skillEffectsOf(skill),
      // 三个条件都要满足才叫「能使」；不可用的**原因**分开报（见各自的字段注释）
      ready: cooldownLeft <= 0 && affordable && hasMomentum,
      cooldownLeft,
      cooldown,
      cost: skill.cost ?? null,
      affordable,
      momentumCost,
      hasMomentum,
      damage: skillDealsDamage(skill, t)
        ? damageRange(skillStatOf(skill, state.stats), t, skillDamageMul(skill, t, combat.stance))
        : ZERO_DAMAGE,
      woundPart: skill.woundPart ?? null,
    };
  });

  const incomingMul = incomingMultiplier(
    t,
    combat.intent.kind,
    combat.stance,
    combat.slow,
    wounds.leg,
    combat.ward,
    stageMul,
  );
  const incomingDamage = softenRange(damageRange(enemy.meng, t, incomingMul), toughness);
  const missChance = enemyMissChanceOf(t, combat.blind, wounds.eye);
  const dodgeChance = dodgeChanceOf(state.stats, t);
  // roundsToLive 用「它常规出一手」而不是这一回合的意图：它守着不打时这个数不该跳成 99
  const typicalMul = incomingMultiplier(
    t,
    "bite",
    combat.stance,
    combat.slow,
    wounds.leg,
    combat.ward,
    stageMul,
  );
  const typical =
    softenRange(damageRange(enemy.meng, t, typicalMul), toughness).mid *
    (1 - missChance) *
    (1 - dodgeChance);
  const finisherReady = encounter.momentum >= t.encounterFinisherMomentum;
  const finisher: FinisherPreview = {
    momentumCost: encounter.momentum,
    momentumNeeded: t.encounterFinisherMomentum,
    ready: finisherReady,
    damage: finisherReady
      ? damageRange(meng, t, finisherMultiplier(t, combat.stance, encounter.momentum))
      : ZERO_DAMAGE,
    atMax: encounter.momentum >= encounter.momentumMax,
  };
  const bestBite = Math.max(
    ...bites.map((bite) => bite.damage.mid),
    finisherReady ? finisher.damage.mid : 0,
  );
  const loreKnown = state.loreEnemyIds.includes(enemy.id);
  const bleedPerRound = combat.bleed > 0 ? t.combatBleedDamage : 0;

  return {
    stance: combat.stance,
    guardPart: combat.guardPart,
    partNames: partNamesOf(enemy),
    intent: combat.intent,
    // [S1] 「明识」是洞察器官的临时替身；[S3] 「图鉴知识」是它的跨世替身 —— 三个来源，一个判据
    intentKnown:
      combat.insight > 0 ||
      loreKnown ||
      t.combatIntentTags.some((tag) => tags.has(tag)),
    loreKnown,
    intentClass:
      combat.intent.kind === "guard" || combat.intent.kind === "flee" ? "hold" : "act",
    bites,
    stances,
    skills,
    finisher,
    momentum: encounter.momentum,
    momentumMax: encounter.momentumMax,
    wounds: { ...wounds },
    stageName: stageDefOf(enemy, encounter.stage)?.name ?? null,
    weaknessPart: enemy.weakness?.part ?? null,
    weaknessFound: encounter.weaknessFound,
    fleeChance: fleeChanceOf(state, enemy, t, combat.blind, wounds.eye),
    incomingDamage,
    incomingMissChance: missChance,
    dodgeChance,
    critChance: critChanceOf(state.stats, t),
    toughness,
    incomingExpected:
      Math.round(incomingDamage.mid * (1 - missChance) * (1 - dodgeChance) * 10) / 10,
    roundsToLive: typical <= 0 ? 99 : Math.min(99, Math.ceil(combat.playerHp / typical)),
    roundsToKill:
      bestBite + bleedPerRound <= 0
        ? 99
        : Math.min(99, Math.ceil(combat.enemyHp / (bestBite + bleedPerRound))),
    enemyHp: combat.enemyHp,
    playerHp: combat.playerHp,
    /** 交锋血上限（体 × combatHpPerTi）—— 界面画血条要它，不该再拿 `stats.ti` 顶替 */
    playerHpMax: combatHpOf(state.stats, t),
    blind: combat.blind,
    slow: combat.slow,
    ward: combat.ward,
    bleed: combat.bleed,
    thorns: combat.thorns,
    insight: combat.insight,
    enemyWillFlee: combat.intent.kind === "flee" && canFlee(t, combat.slow, wounds.leg),
  };
}

/**
 * [S1] 界面推荐的那一手 —— **同一时刻只推荐一手**（P1 踩过的坑：两颗按钮同时发金光
 * 等于没有推荐）。纯函数，只吃 `CombatPreview`（＝玩家屏幕上看得见的那些数），
 * **不读 `TaleState`、不消耗抽取、引擎自己也不消费它**。
 *
 * ## 它为什么在 tale-sim 里（这是一处有意的归属变更）
 * M1-P2 把它放在 `tale-client`，于是同一条链在**三处**各有一份手抄镜像
 * （客户端／`tale-content` 冒烟／`packages/gen` 实验台），P2 报告的遗留第 5 条就是这件事。
 * S1 把技能池从 1 颗按钮扩到 5〜8 颗，这条链随之从 9 条长到 11 条 —— 三份手抄的漂移
 * 就不再是「风险」而是「必然」，而且漂移的**后果是我自己的平衡数据在说谎**
 * （实验台量的打法与玩家屏幕上金光指的那一手不是同一个）。
 *
 * 它仍然是**呈现层的建议**，不是规则：引擎的任何结算都不看它，删掉它引擎照样跑。
 * 放在这里唯一的理由是「三个包都 import 得到 tale-sim」。
 *
 * ## 优先级链（每一条都有玩家看得见的依据）
 * 1. 这一手打得死它（按最坏情况 `damage.min` 判）→ 打最重的那一手（技与**决杀**都算）。
 * 2. 撑不过两合 → 保命：`bolt`（必定脱身）＞ 逃（掷骰）＞ `brace` ＞ `heal`。
 * 3. 它要走而拦得住 → 咬腿（否则整顿肉白丢）。
 * 4. 它宣告重击 → `brace` 硬吃；没有则扑眼（眼伤当合就让它多半打空）。
 * 5. 读不出意图、有 `insight` 技、且这是场长仗 → 先买知情权。
 * 6. 长仗且持续类（`bleed`／`venom`／`thorns`）还没挂上 → 挂它。
 * 7. [M2-B1] **决杀已攒够、且比最强的一咬重** → 发它（势的兑现时刻）。
 * 8. 伤害类技比最强的一咬更重 → 放技。
 * 9. 挨得凶而眼伤还没堆满 → 扑眼买回合。
 * 10. 长仗、而腿伤还没到「它再也走不掉」那一层 → 咬腿把它的势钝下来。
 * 11. 它在守（那一合本来就不挨伤）→ 换姿态。
 * 12. 否则挑当前伤害最高的那一咬（守备会把它从咬喉赶到别处；识破的弱点会盖过守备）。
 *
 * **自伤类技的安全阀**：代价 ≥ 当前血量一半的技一律不推荐（除了第 1 条那种能收官的）——
 * `ready` 只保证「付完还活着」，而推荐一手让玩家剩 1 血的按钮是在劝他送死（同 P2 那条
 * 「推荐链在劝玩家送死」的教训：那一版把逃排晚一格，战死率从 8.5% 飙到 33.5%）。
 */
export function recommendCombatAct(preview: CombatPreview): CombatAct {
  const bites = [...preview.bites].sort((a, b) => b.damage.mid - a.damage.mid);
  const bestBite = bites[0];
  const bestBiteAct: CombatAct = { kind: "bite", part: bestBite?.part ?? "throat" };
  const finisherAct: CombatAct = { kind: "finisher" };
  const skillAct = (skill: CombatSkillPreview): CombatAct => ({
    kind: "skill",
    skillId: skill.skillId,
  });
  /** 自伤过半的技此刻不该被推荐（收官那一条例外，见第 1 条） */
  const affordableNow = (skill: CombatSkillPreview): boolean =>
    !(skill.cost?.kind === "hp" && skill.cost.amount * 2 >= preview.playerHp);
  const ready = preview.skills.filter((skill) => skill.ready);
  const usable = ready.filter(affordableNow);
  const withEffect = (effect: CombatSkillEffect): CombatSkillPreview | undefined =>
    usable.find((skill) => skill.effects.includes(effect));
  const hardest = [...usable]
    .filter((skill) => skill.damage.mid > 0)
    .sort((a, b) => b.damage.mid - a.damage.mid)[0];

  // 1. 收官：技、决杀与咬一起比，取「最坏情况也打得死」的那一手（这里不管自伤过半 —— 打完就结束了）
  const lethalSkill = [...ready]
    .filter((skill) => skill.damage.min >= preview.enemyHp)
    .sort((a, b) => b.damage.mid - a.damage.mid)[0];
  if (preview.finisher.ready && preview.finisher.damage.min >= preview.enemyHp) return finisherAct;
  if (lethalSkill) return skillAct(lethalSkill);
  if (bestBite && bestBite.damage.min >= preview.enemyHp) return bestBiteAct;
  if (preview.roundsToKill <= 1) return bestBiteAct;

  /*
   * 2. 撑不过两合 —— 保命的四条。
   *
   * 排序按「它把**这场架**了结到什么程度」，不是按「这一合有多确定」：
   * `bolt` 必定脱身（威胁归零）＞ 逃（掷骰，但同样是了结）＞ `brace`（把这一下归零，
   * 只是把死推迟一合，不解决问题）＞ `heal`（回 8 血，可能盖不住一记重击）。
   */
  if (preview.roundsToLive <= 2) {
    const bolt = withEffect("bolt");
    if (bolt) return skillAct(bolt);
    if (preview.fleeChance >= 0.4) return { kind: "flee" };
    const brace = withEffect("brace");
    if (brace) return skillAct(brace);
    const heal = withEffect("heal");
    if (heal) return skillAct(heal);
  }

  // 3. 它要走：读不出意图时「按兵不动」既可能是守也可能是逃 —— 拦一手的代价远小于丢掉整顿肉
  const legBite = preview.bites.find((bite) => bite.part === "leg");
  const mayFlee = preview.intentKnown ? preview.enemyWillFlee : preview.intentClass === "hold";
  if (mayFlee && legBite?.stopsFlee !== false) return { kind: "bite", part: "leg" };

  /*
   * 4. 它宣告重击：硬吃（免伤，确定）→ **伏低** → 弄瞎。
   *
   * [M2-B1] 中间那一格是这一批加的，而且是被实验台逼出来的：部位伤温和化之后（每层眼伤
   * 只买一成二的打空），拿一整合去扑眼换不回一记 2.2 倍的扑，于是「读得出意图」的 build
   * 反而比读不出的更弱 —— M1-P2 踩过同一个坑（「信息被误用了」）。**伏低把这一记压成
   * 1.54 倍，而且换姿态只花这一合、此后整场都算数** —— 那才是知情权该换来的东西。
   * 只在「撑不住四合」时换：局面宽裕时伏低的 ×0.75 出伤会把架拖长。
   */
  const eyeBite = preview.bites.find((bite) => bite.part === "eye");
  if (preview.intentKnown && preview.intent.kind === "pounce") {
    const brace = withEffect("brace");
    if (brace) return skillAct(brace);
    // 已经站在扑击姿态上（受伤 ×1.25）而它要来一记 2.2 倍的 —— 先把身子压下去
    if (preview.stance === "lunge") return { kind: "stance", to: "low" };
    if (eyeBite?.woundLands === true) return { kind: "bite", part: "eye" };
  }

  // 5. 读不出意图而买得到：知情权在长仗里每一合都用得上（这是「明识」存在的全部理由）
  if (!preview.intentKnown && preview.roundsToKill >= 3) {
    const insight = withEffect("insight");
    if (insight) return skillAct(insight);
  }

  // 6. 长仗里先挂持续类（已经挂着的不重复挂 —— 那是白费一个回合）
  if (preview.roundsToKill >= 3) {
    if (preview.bleed <= 0) {
      const bleed = withEffect("bleed");
      if (bleed) return skillAct(bleed);
    }
    if (preview.slow <= 0) {
      const venom = withEffect("venom");
      if (venom) return skillAct(venom);
    }
    if (preview.thorns <= 0) {
      const thorns = withEffect("thorns");
      if (thorns) return skillAct(thorns);
    }
  }

  /*
   * 7. [M2-B1] 决杀：攒够了、且这一记比最强的一咬更重就发。
   *
   * 排在伤害技之前是因为它**消耗的是攒来的势**，而势会随着回合继续涨 —— 留着不发等于
   * 让上限吃掉后面几合的进项（势有上限，溢出的部分是白攒的）。这一条就是「出招节奏」
   * 这件事在链上的样子：前几合咬没护着的地方攒势，攒满一记打出去，再从头攒。
   */
  if (preview.finisher.ready && preview.finisher.damage.mid > (bestBite?.damage.mid ?? 0)) {
    /*
     * [M2-B3] **攒满了才发** —— 这一条是 B1 那句「留着不发等于让上限吃掉后面几合的进项」
     * 的修正版。B1 写它的时候上限（4＋floor(灵/18)）对绝大多数 build 就等于门槛（4），
     * 于是「一到门槛就发」与「攒满才发」是同一件事；B3 把上限做成灵的主要回报之后，
     * 两者分了家：一到门槛就发的话，上限 5 与上限 9 打出来是同一记决杀，
     * 而克制矩阵实测到的正是这个 —— 灵系 build 的平均胜率与基础 build 只差 0.1 个点。
     *
     * 现在的规矩是「势满则发」，另加两条不许再等的出口：这一记**打得死**（收官那一档
     * 已在第 1 条拦掉，这里兜的是 mid 够、min 不够那一档），或者**再拖就没命了**。
     * 溢出的势是白攒的，所以「满」是唯一不必再等的时刻。
     */
    if (preview.finisher.atMax || preview.roundsToLive <= 2 || preview.roundsToKill <= 2) {
      return finisherAct;
    }
  }

  // 8. 伤害类技比最强的一咬更重就放它（技有冷却，早放早转）
  if (hardest && hardest.damage.mid > (bestBite?.damage.mid ?? 0)) return skillAct(hardest);

  // 9. 挨得凶而眼伤还堆得上去 → 扑眼买回合
  if (preview.roundsToLive <= 3 && eyeBite?.woundLands === true) return { kind: "bite", part: "eye" };

  /*
   * 10. 长仗里把它的势钝下来。
   *
   * [M2-B1] 判据从「迟滞这一口落不落得下来」换成「腿伤还没到**它再也走不掉**那一层」——
   * 部位伤整场累积之后，前两层腿伤买的是「它逃不掉且扑不动」这件一劳永逸的事，
   * 而第三层的边际收益（出伤再 ×0.86）不值一个回合。
   */
  if (preview.roundsToKill >= 3 && legBite?.woundLands === true && preview.wounds.leg < 2) {
    return { kind: "bite", part: "leg" };
  }

  /*
   * 11. 它在守：那一合本来就不挨伤，拿去换姿态。
   *
   * **顺序是量出来的**（M1-P2）：把这一条排到咬腿之前，岩羊的 seer 胜率 88.8%→87.8%、
   * 玄蟒的 seer+fang 67.5%→63.5% —— 守着的那一合拿去咬一口比换姿态划算，
   * 换姿态只在「这一口本来也没什么附带可捞」时才是最优。
   */
  if (preview.intentKnown && preview.intent.kind === "guard") {
    /*
     * [M2-B1] 换哪个姿态从「还撑得住几合」换成**两个数的比较**。
     *
     * 扑击姿态出伤 ×1.35 但受伤也 ×1.25 —— 只有在「我杀得比它快」的局面里才划算。
     * 旧判据（`roundsToLive <= 3` 才伏低）在一场 8〜10 合的长仗里会让读得出意图的 build
     * **一路站在扑击姿态上挨打**，实验台量到的后果是它比读不出的还危险（1200 场：
     * 死亡率 13.7% vs 13.6%，胜率反而低 14 个点）。信息被误用了 —— 同 M1-P2 那条教训。
     */
    const want: Stance = preview.roundsToLive >= preview.roundsToKill + 2 ? "lunge" : "low";
    if (preview.stance !== want) return { kind: "stance", to: want };
  }
  return bestBiteAct;
}

/**
 * 打一个**交锋阶段**的回合（遭遇状态机的后半）。
 *
 * ## 一个回合的固定顺序（不可变更）
 * 1. 玩家动作（咬／换姿态／技／**决杀**／逃）；咬中被护部位可能招来**即时反击**。
 *    [S1] 技先付代价（自伤／精气／[M2-B1] **势**）再结算效果；`bolt` 那一档当场判 `fled`。
 *    [M2-B1] 每一咬都留下一层**整场不消**的部位伤（到 `woundCap` 封顶）。
 * 2. 敌人血尽 → `win`（吞精气回饱食、[M2-B1] 留食余，写一条 combat 记录），到此结束。
 * 3. 敌人按**已宣告的意图**动作：扑／咬（致盲与眼伤期间可能打空、[M2-B1] 德还可能整下闪开）／
 *    守（不出手）／逃（腿伤未到那一层则 `escaped`，玩家什么也拿不到）。
 *    [S1] 它这一下命中我方时，若挂着反刺（`thorns`）它自伤一记；`brace` 让这一下伤害归零。
 * 4. 玩家血尽 → `dead`（ending＝slain）。
 * 5. [S1] 流血（`bleed`）在回合**末**结算 —— 它守着不动也照掉。掉光了算 `win`。
 * 6. 计数器各减一（致盲／迟滞／护体／流血／反刺／明识／技能冷却）。
 *    **部位伤不减** —— 那正是它与这一族计数器的分界。
 * 7. [M2-B1] 结算这一回合攒到的**势**（自涨 ＋ 乘隙 ＋ 它没伤到我）。
 * 8. [M2-B1] 按血线推进**行为段**（换了就宣告一句），并判**弱点**识不识得破。
 * 9. 摇下一回合的守备与意图（`rollFace`，恒 3 次抽取）—— **玩家下一次出手前就看得见**。
 *
 * 反刺与流血刻意排在两处不同的地方：反刺是**对它出手的惩罚**（跟着它那一下走），
 * 流血是**独立于出手的损耗**（跟着回合走）。两者若并到一处，「它爱守」这类敌人就分不出
 * 该用哪一个了。
 *
 * ## 抽取顺序（改它就是破坏所有既存种子的剧本）
 * 咬／决杀：**暴击掷骰**（恒抽，德为 0 也抽）→ 伤害抖动 →（被护住**且它还反得了口**时）
 *   反击掷骰 → 反击伤害抖动 → 旁白；
 * 姿态：旁白；技：（出伤时）暴击掷骰 → 伤害抖动 → 每条落地的效果各一次旁白；逃：成败掷骰。
 * 敌人段（它真的出手时）：打空掷骰（**恒抽**）→ 闪避掷骰（**恒抽**）→ 伤害抖动 → 旁白。
 * ⚠️ **`brace` 那一回合少抽一次**：硬受挡下的那一下走单句旁白（`combatBraceHold`），
 * 不进变体池。回合末的流血、喉伤、反刺、势、行为段与弱点**都不抽**（旁白都是单句）。
 * 收尾：`rollFace` 的 3 次。
 *
 * 「恒抽」那两处是 M2-B1 改的：M1-P2 在 `blind <= 0` 时短路不抽，于是抽取次数随**状态**
 * 而不只是随**动作**变化 —— 加了眼伤与闪避两个来源之后，那种短路会让「同种子同操作」
 * 的推演要先在脑子里跑一遍状态机。
 *
 * `over` 非 null 时 `state.encounter` 置 null —— 界面要自己累加每次返回的 `roundLog`
 * （遭遇进行中也可以读 `state.encounter.log` 拿累积日志，但结束那一刻它就没了）。
 *
 * @throws 已死亡、不在交锋阶段、敌人 id 失效、技不存在／未持有／还在冷却／**付不起代价或势**、
 *         势不够而按了决杀、或换成当前已在的姿态
 */
export function combatAct(state: TaleState, act: CombatAct, content: TaleContent): CombatTurn {
  if (!state.alive) throw new Error("combatAct: 已死亡");
  const encounter = state.encounter;
  const current = clashOf(state);
  if (!encounter || !current) throw new Error("combatAct: 当前不在交锋阶段");
  const enemy = encounterEnemy(state, content, "combatAct");

  const t = lifeTuning(state, content);
  const cursor = createCursor(state.rngState);
  const draft = draftOf(state);
  const roundLog: string[] = [];
  const records: LifeRecord[] = [];
  /*
   * [M2-B3] `{{leg}}` 也恒给：**「腿」这个部位在不同的兽身上不是同一个词**。
   *
   * 这一批把鱼／鸟／蛇／带甲的东西都放进了可打的名册，于是引擎那句写死的「后腿」
   * 当场在实机里读成「蠃鱼的后腿已经拖在地上」—— 一条长着鸟翼的鱼没有后腿。
   * 措辞归内容（`EnemyDef.legWord`），缺省仍是「后腿」，引擎只负责把它填进去。
   */
  const say = (pool: readonly string[], vars: Record<string, string | number> = {}): void => {
    roundLog.push(
      render(pickFlavor(cursor, undefined, pool), {
        enemy: enemy.name,
        leg: legWordOf(enemy),
        ...vars,
      }),
    );
  };

  let enemyHp = current.enemyHp;
  let playerHp = current.playerHp;
  let stance = current.stance;
  let blind = current.blind;
  let slow = current.slow;
  let ward = current.ward;
  let bleed = current.bleed;
  let thorns = current.thorns;
  let insight = current.insight;
  const cooldowns: Record<string, number> = { ...current.skillCooldowns };
  const wounds: Record<BodyPart, number> = { ...encounter.wounds };
  let momentum = encounter.momentum;
  let weaknessHits = encounter.weaknessHits;
  let over: CombatTurn["over"] = null;
  let forcedGuard = false;
  /** [S1] `brace`：这一回合它那一手的伤害归零（只管当下这一下，不留计数器） */
  let bracing = false;
  /** [M2-B1] 这一合我咬中了它没护着的地方 —— 乘隙，多攒一点势 */
  let openHit = false;
  /** [M2-B1] 这一合它没伤到我（守／逃／打空／闪开／硬受）—— 多攒一点势 */
  let unhurt = true;
  const guardIntent = current.intent.kind === "guard";
  const stageMul = stageDamageMulOf(enemy, encounter.stage);
  const toughness = toughnessOf(draft.stats, t);
  const critChance = critChanceOf(draft.stats, t);
  const dodgeChance = dodgeChanceOf(draft.stats, t);
  const weakPart = encounter.weaknessFound ? (enemy.weakness?.part ?? null) : null;

  /** [M2-B1] 一记我方伤害：暴击掷骰（恒抽）→ 伤害抖动。德给的暴击是「气运」的一半。 */
  const strike = (stat: number, multiplier: number): { dmg: number; crit: boolean } => {
    const crit = cursor.next() < critChance;
    const dmg = rollDamage(cursor, stat, t, multiplier * (crit ? t.combatCritMul : 1));
    return { dmg, crit };
  };

  /** [M2-B1] 记一层部位伤（整场不消，到 `woundCap` 封顶），并报「这一层刚好触发了什么」。 */
  const addWound = (part: BodyPart | null): void => {
    if (part === null || enemyHp <= 0) return;
    const before = wounds[part];
    if (before >= t.woundCap) return;
    wounds[part] = before + 1;
    if (part === "leg") {
      if (wounds.leg === t.woundLegNoFleeAt) say(COMBAT_MESSAGES.legCrippled);
      else say(COMBAT_MESSAGES.slowed);
    } else if (part === "eye") {
      if (wounds.eye === t.woundEyeNoCounterAt) say(COMBAT_MESSAGES.eyeRuined);
      else say(COMBAT_MESSAGES.blinded);
    }
  };

  // — 1. 玩家动作 —
  switch (act.kind) {
    case "bite": {
      const guarded = act.part === current.guardPart;
      const weakPoint = weakPart === act.part;
      const mul = biteMultiplier(t, act.part, stance, guarded, guardIntent, weakPoint);
      const { dmg, crit } = strike(draft.stats.meng, mul);
      enemyHp -= dmg;
      if (act.part === enemy.weakness?.part) weaknessHits += 1;
      if (!guarded || weakPoint) openHit = true;
      if (guarded && !weakPoint) {
        // 反击掷骰在旁白**之前**：顺序固定才推演得动（见本函数 JSDoc 的抽取顺序）
        const countered =
          canCounter(t, blind, wounds.eye) && cursor.next() < t.combatGuardCounterChance;
        const counterDmg = countered
          ? Math.max(
              1,
              rollDamage(cursor, enemy.meng, t, counterMultiplier(t, stance, ward)) - toughness,
            )
          : 0;
        say(COMBAT_MESSAGES.biteGuarded, { dmg, part: bodyPartName(enemy, act.part) });
        if (countered) {
          playerHp -= counterDmg;
          unhurt = false;
          say(COMBAT_MESSAGES.counter, { dmg: counterDmg });
        }
      } else {
        say(COMBAT_MESSAGES.bite[act.part], { dmg });
      }
      if (crit) roundLog.push(COMBAT_MESSAGES.crit[0] ?? "");
      addWound(woundOf(act.part));
      break;
    }
    case "finisher": {
      /*
       * [M2-B1] 决杀 —— 势的兑现时刻。
       *
       * 三件事让它不是「又一颗更强的咬」：① 它**吃掉全部的势**（发完从零攒起）；
       * ② 伤害随攒到的势线性放大（攒 6 点比攒 4 点重四成）；③ **无视守备减伤**
       * —— 它是「等它露出破绽」的反面：攒够了就不必等破绽。
       */
      if (momentum < t.encounterFinisherMomentum) {
        throw new Error(`combatAct: 决杀需要 ${t.encounterFinisherMomentum} 点势（现有 ${momentum}）`);
      }
      const spent = momentum;
      momentum = 0;
      const { dmg, crit } = strike(draft.stats.meng, finisherMultiplier(t, stance, spent));
      enemyHp -= dmg;
      openHit = true;
      // 决杀**不推进「咬中同一处几次」那条识破路径**：它无视守备、也不挑部位，
      // 那一记谈不上「在试它哪儿软」—— 弱点仍要靠三颗咬击或看满几合去识破。
      say(COMBAT_MESSAGES.finisher, { dmg });
      if (crit) roundLog.push(COMBAT_MESSAGES.crit[0] ?? "");
      break;
    }
    case "stance": {
      if (act.to === stance) throw new Error(`combatAct: 已是「${act.to}」姿态`);
      stance = act.to;
      say(COMBAT_MESSAGES.stance[act.to]);
      break;
    }
    case "skill": {
      const entry = combatSkills(state, content).find(
        (candidate) => candidate.skillId === act.skillId,
      );
      if (!entry) throw new Error(`combatAct: 没有这个技 ${act.skillId}`);
      const skill = entry.skill;
      const left = Math.max(0, cooldowns[entry.skillId] ?? 0);
      if (left > 0) throw new Error(`combatAct: ${skill.name}还要等${left}合`);
      /*
       * [S1] 代价先付，且付不起就抛错 —— 不做「打个折照样能放」的兜底。
       * 屏幕上写了「精气 −8」而实际不扣，就是这一批最不该出现的那种谎。
       * [M2-B1] 势是第三样代价，同待遇。
       */
      const momentumCost = skillMomentumOf(skill, t);
      if (momentum < momentumCost) {
        throw new Error(`combatAct: ${skill.name}要 ${momentumCost} 点势（现有 ${momentum}）`);
      }
      if (!canAfford(skill.cost, playerHp, state)) {
        throw new Error(`combatAct: ${skill.name}的代价此刻付不起`);
      }
      momentum -= momentumCost;
      const cost = skill.cost;
      if (cost?.kind === "hp") {
        playerHp -= cost.amount;
        roundLog.push(render(ENGINE_MESSAGES.combatSkillToll, { skill: skill.name, dmg: cost.amount }));
      } else if (cost?.kind === "essence") {
        draft.essence = addEssence(draft.essence, { [cost.type]: -cost.amount });
      }

      const effects = skill.effects ?? [];
      if (skillDealsDamage(skill, t)) {
        const { dmg, crit } = strike(
          skillStatOf(skill, draft.stats),
          skillDamageMul(skill, t, stance),
        );
        enemyHp -= dmg;
        roundLog.push(
          render(ENGINE_MESSAGES.combatSkillHit, { skill: skill.name, enemy: enemy.name, dmg }),
        );
        if (crit) roundLog.push(COMBAT_MESSAGES.crit[0] ?? "");
      } else {
        roundLog.push(render(ENGINE_MESSAGES.combatSkillUse, { skill: skill.name, enemy: enemy.name }));
      }

      /*
       * 效果逐条落地。**给自己的效果不看它死没死**（护体、明识、疗愈、硬受、脱身都是自己
       * 身上的事），**给它的效果只在它还活着时落**（给一具尸体挂迟滞是没有意义的日志噪音）。
       * 顺序按 `effects` 数组 —— 组合技的两条效果因此有稳定的旁白顺序。
       */
      for (const effect of effects) {
        switch (effect) {
          case "heal":
            playerHp = Math.min(combatHpOf(draft.stats, t), playerHp + t.combatSkillHealAmount);
            say(COMBAT_MESSAGES.healed);
            break;
          case "armor":
            ward = Math.max(ward, t.combatWardRounds);
            say(COMBAT_MESSAGES.warded);
            break;
          case "thorns":
            thorns = Math.max(thorns, t.combatThornsRounds);
            say(COMBAT_MESSAGES.thorned);
            break;
          case "insight":
            insight = Math.max(insight, t.combatInsightRounds);
            say(COMBAT_MESSAGES.insighted);
            break;
          case "brace":
            bracing = true;
            say(COMBAT_MESSAGES.braced);
            break;
          case "bolt":
            // 位移类：不掷骰的遁走。它的价钱是精气与势（见内容表），所以「必定脱身」不是白拿的
            over = "fled";
            say(COMBAT_MESSAGES.bolted);
            break;
          case "venom":
            if (enemyHp > 0) {
              slow = Math.max(slow, t.combatVenomSlowRounds);
              say(COMBAT_MESSAGES.venomed);
            }
            break;
          case "bleed":
            if (enemyHp > 0) {
              bleed = Math.max(bleed, t.combatBleedRounds);
              say(COMBAT_MESSAGES.bleeding);
            }
            break;
          case "blind":
            if (enemyHp > 0) {
              blind = Math.max(blind, t.combatBlindRounds);
              say(COMBAT_MESSAGES.blinded);
            }
            break;
          case "stun":
            if (enemyHp > 0) {
              forcedGuard = true;
              say(COMBAT_MESSAGES.stunned);
            }
            break;
        }
      }
      /*
       * [M2-B2] 断伤 —— 凝招力道槽的第二样东西：这一手顺带记一层部位伤。
       * 挂在效果之后是因为它跟着**伤害**走（`addWound` 自己会在它已死时退出），
       * 而效果里有几档是给自己的（护体、明识），两者不该共用一个位置。
       */
      if (skill.woundPart !== undefined) addWound(woundOf(skill.woundPart));
      // ＋1 是因为本回合末尾统一减一：写 cooldown+1 才让「冷却 3」真的等 3 个回合
      cooldowns[entry.skillId] = (skill.cooldown ?? t.combatSkillCooldown) + 1;
      break;
    }
    case "flee": {
      if (cursor.next() < fleeChanceOf(draft, enemy, t, blind, wounds.eye)) {
        over = "fled";
        roundLog.push(ENGINE_MESSAGES.combatFleeOk);
      } else {
        roundLog.push(ENGINE_MESSAGES.combatFleeFail);
      }
      break;
    }
  }

  /**
   * 取胜的战利品与记账。
   *
   * [S1] 抽成闭包是因为**有两个地方能打死它**：玩家出手（步骤 2）与回合末的流血（步骤 5）。
   * 各写一份的话，「被流血放倒的那头兽」会漏掉精气、饱食、夺命数与 combat 记录 ——
   * 而那正是「妖王」那条道的判据，漏了不会有任何测试变红。
   */
  const winSpoils = (): void => {
    over = "win";
    // [2026-08-13] 兽潮之年杀获更厚（`combatWinEssenceMul`）——「难活但杀一头值更多」
    const essenceMul = t.combatWinEssenceMul;
    draft.essence = addEssence(
      draft.essence,
      essenceMul === 1
        ? enemy.essence
        : Object.fromEntries(
            Object.entries(enemy.essence).map(([type, amount]) => [
              type,
              Math.round((amount ?? 0) * essenceMul),
            ]),
          ),
    );
    draft.hunger = clamp(draft.hunger + t.combatWinHungerGain, 0, t.hungerMax);
    /*
     * [M2-B1] 打赢也留食余 —— 这一批点击账的主要抵消项（饥饿节奏批的遗留 3）。
     * 一场硬仗换来此后几季不必出猎，正好抵掉「一场架从 3 合变成 7 合」多出来的点击。
     */
    const surplus = Math.max(
      0,
      Math.round((enemy.surplusSeasons ?? t.huntSurplusSeasons) * t.combatWinSurplusMul),
    );
    if (surplus > 0) {
      draft.surplusSeasons = Math.max(draft.surplusSeasons, surplus);
      roundLog.push(render(ENGINE_MESSAGES.combatWinSurplus, { seasons: cnNumeral(surplus) }));
    }
    // [2026-08-13] 搏杀取胜也是夺了一命；战胜神兽另记一笔（登神门槛之一）
    draft.livesTaken += 1;
    if (enemy.tags.includes(t.wayDivineTag)) {
      draft.flags = withFlags(draft.flags, [SYS_FLAG_DIVINE_EATEN]);
    }
    roundLog.push(render(ENGINE_MESSAGES.combatWin, { enemy: enemy.name }));
    records.push({
      year: draft.year,
      season: draft.season,
      kind: "combat",
      text: render(ENGINE_MESSAGES.combatWinRecord, { enemy: enemy.name }),
      refId: enemy.id,
    });
  };

  // — 2. 它死了 —
  if (over === null && enemyHp <= 0) winSpoils();

  // — 3. 它按宣告的意图动作（逃跑成功的那一回合它不追）—
  if (over === null) {
    switch (current.intent.kind) {
      case "guard":
        say(COMBAT_MESSAGES.enemyHold);
        break;
      case "flee":
        if (!canFlee(t, slow, wounds.leg)) {
          // 拦住它的退路 —— 这条分支是「咬腿」独一份用处的兑现（一时的迟滞或整场的断腿）
          say(COMBAT_MESSAGES.fleeBlocked);
        } else {
          /*
           * 它走成了。**即使它正流着血、且这一合末就会流干，也照样是 escaped**
           * （失血在步骤 5 结算，而这里是步骤 3）—— 有意如此：拦逃的工具是**咬腿**，
           * 不是「挂个持续伤害等它自己倒下」。
           */
          over = "escaped";
          say(COMBAT_MESSAGES.enemyFled);
        }
        break;
      default: {
        // 打空与闪避两掷**恒抽**（见 JSDoc 的抽取顺序）：抽取次数只随动作变，不随状态变
        const missRoll = cursor.next();
        const dodgeRoll = cursor.next();
        const missed = missRoll < enemyMissChanceOf(t, blind, wounds.eye);
        const dodged = !missed && dodgeRoll < dodgeChance;
        const mul = incomingMultiplier(
          t,
          current.intent.kind,
          stance,
          slow,
          wounds.leg,
          ward,
          stageMul,
        );
        // 抖动照抽 —— 抽取次数不随分支变化
        const rolled = Math.max(1, rollDamage(cursor, enemy.meng, t, mul) - toughness);
        if (missed) {
          say(COMBAT_MESSAGES.enemyMiss);
        } else if (dodged) {
          say(COMBAT_MESSAGES.dodge);
        } else {
          // [S1] `brace`（硬受）：这一下的伤害归零
          const dmg = bracing ? 0 : rolled;
          playerHp -= dmg;
          if (dmg > 0) unhurt = false;
          if (bracing) {
            roundLog.push(render(ENGINE_MESSAGES.combatBraceHold, { enemy: enemy.name }));
          } else {
            say(
              current.intent.kind === "pounce" ? COMBAT_MESSAGES.enemyPounce : COMBAT_MESSAGES.enemyBite,
              { dmg },
            );
          }
          /*
           * [S1] 反刺：**它命中了才扎得着**（硬受挡下的那一下不算 —— 它没碰到你）。
           * 单句旁白、不抽变体，所以这一段不消耗抽取。
           */
          if (thorns > 0 && !bracing && dmg > 0) {
            enemyHp -= t.combatThornsDamage;
            roundLog.push(
              render(ENGINE_MESSAGES.combatThornsPrick, {
                enemy: enemy.name,
                dmg: t.combatThornsDamage,
              }),
            );
          }
          if (playerHp <= 0) over = "dead";
        }
        break;
      }
    }
  }

  /*
   * — 4.5／5. 反刺或流血把它放倒 —
   *
   * 顺序刻意是「先判我方死、再结算失血」：同一回合两边都归零时**死亡优先**（死了就是死了，
   * 不存在「我倒下的同时它也失血而亡，于是我赢了」）。失血在回合末结算是它与迟滞的分界：
   * 它守着不动也照掉。
   */
  if (over === null && enemyHp <= 0) winSpoils();
  if (over === null && bleed > 0) {
    enemyHp -= t.combatBleedDamage;
    roundLog.push(
      render(ENGINE_MESSAGES.combatBleedTick, { enemy: enemy.name, dmg: t.combatBleedDamage }),
    );
    if (enemyHp <= 0) winSpoils();
  }

  // — 6. 计数器各减一（先让这一回合吃满效果，再衰减）。**部位伤不减** —
  blind = Math.max(0, blind - 1);
  slow = Math.max(0, slow - 1);
  ward = Math.max(0, ward - 1);
  bleed = Math.max(0, bleed - 1);
  thorns = Math.max(0, thorns - 1);
  insight = Math.max(0, insight - 1);
  for (const id of Object.keys(cooldowns)) {
    const left = Math.max(0, (cooldowns[id] ?? 0) - 1);
    if (left === 0) delete cooldowns[id];
    else cooldowns[id] = left;
  }

  // — 7. [M2-B1] 这一回合攒到的势 —
  momentum = clamp(
    momentum +
      t.encounterMomentumPerRound +
      (openHit ? t.encounterMomentumOpenGuard : 0) +
      (unhurt ? t.encounterMomentumUnhurt : 0),
    0,
    encounter.momentumMax,
  );

  const round = current.round + 1;
  if (over === "dead") {
    records.push(
      die(draft, "slain", render(ENGINE_MESSAGES.deathSlain, { enemy: enemy.name }), enemy.id),
    );
  }

  const draftEncounter = draft.encounter;
  if (over === null && draftEncounter) {
    // — 8. [M2-B1] 行为段与弱点：两件「它变了／我看懂了」的事，都要当场宣告 —
    const nextStage = stageIndexOf(enemy, enemyHp);
    if (nextStage > encounter.stage) {
      const def = stageDefOf(enemy, nextStage);
      roundLog.push(
        render(def?.text ?? ENGINE_MESSAGES.encounterStage, { enemy: enemy.name }),
      );
    }
    const foundNow =
      encounter.weaknessFound ||
      weaknessRevealedNow(enemy, draft, t, { round, hits: weaknessHits });
    if (foundNow && !encounter.weaknessFound && enemy.weakness) {
      roundLog.push(
        render(enemy.weakness.text, {
          enemy: enemy.name,
          part: bodyPartName(enemy, enemy.weakness.part),
        }),
      );
    }

    // — 9. 下一回合的脸（玩家出手前就看得见）—
    const face = rollFace(cursor, enemy, t, {
      enemyHp,
      wounds,
      slow,
      forcedGuard,
      stage: nextStage,
      de: draft.stats.de,
    });
    draftEncounter.momentum = momentum;
    draftEncounter.wounds = wounds;
    draftEncounter.weaknessFound = foundNow;
    draftEncounter.weaknessHits = weaknessHits;
    draftEncounter.stage = nextStage;
    draftEncounter.log = [...encounter.log, ...roundLog];
    draftEncounter.clash = {
      enemyHp,
      playerHp,
      round,
      stance,
      guardPart: face.guardPart,
      intent: face.intent,
      blind,
      slow,
      ward,
      bleed,
      thorns,
      insight,
      skillCooldowns: cooldowns,
    };
  } else {
    draft.encounter = null;
  }
  draft.records = [...state.records, ...records];
  draft.rngState = cursor.state;

  refreshWayFlags(draft, content);
  return { state: draft, roundLog, over };
}

// ===== 一世收束 =====

function pickPraise(
  variants: readonly ChroniclePraiseVariant[],
  de: number,
  ending: EndingType,
  way: WayId | null,
): ChroniclePraiseVariant | undefined {
  const matched = variants.find(
    (variant) =>
      (variant.minDe === undefined || de >= variant.minDe) &&
      (variant.maxDe === undefined || de <= variant.maxDe) &&
      (variant.endings === undefined || variant.endings.includes(ending)) &&
      // 声明了 ways 的变体只匹配那几条道；未成道（way 为 null）一律不匹配
      (variant.ways === undefined || (way !== null && variant.ways.includes(way))),
  );
  // 内容侧应把无条件兜底放在末项；没匹配上时退到末项而不是抛错 ——
  // 一世刚结束正是玩家最不该吃到崩溃的时刻。B2 的 schema 测试负责保证兜底存在。
  return matched ?? variants[variants.length - 1];
}

/**
 * 生成列传。
 *
 * 结构：`opening` → 中段摘录若干行（birth 恒为第一行，其后取 molt／combat／once 事件
 * 记录的前 `tuning.chronicleMaxExcerpts` 条）→ `endings[ending]` → `praisePrefix` ＋赞语。
 *
 * 模板可用占位：`seedName` `years` `season` `organCount` `moltCount` `killCount`
 * `meng` `ling` `ti` `de` `text`（`season`/`text` 仅 `middleLine` 有意义）。
 *
 * @throws 一世尚未结束（`alive` 为真或 `ending` 为 null）时抛错
 */
export function composeChronicle(state: TaleState, content: TaleContent): ChronicleEntry {
  if (state.alive || state.ending === null) {
    throw new Error("composeChronicle: 一世尚未结束，无从作传");
  }
  const tpl = content.chronicleTemplates;
  const ending = state.ending;
  const birth = state.records.find((record) => record.kind === "birth");
  const seed = content.seeds.find((candidate) => candidate.id === birth?.refId);
  const onceEventIds = new Set(
    content.events.filter((event) => event.trigger.once).map((event) => event.id),
  );
  const moltCount = state.records.filter((record) => record.kind === "molt").length;
  const killCount = state.records.filter((record) => record.kind === "combat").length;

  const vars: Record<string, string | number> = {
    seedName: seed?.name ?? "无名神种",
    years: state.year,
    organCount: state.organIds.length,
    moltCount,
    killCount,
    /** [2026-08-13] 夺命数（含追猎得手）—— 妖王的结语要报它，化灵的结语要报它是〇 */
    livesTaken: state.livesTaken,
    /** [2026-08-13] 天时／出身的名字：一世的开局前提该进得了传 */
    skyName: content.skies.find((item) => item.id === state.skyId)?.name ?? "",
    originName: content.origins.find((item) => item.id === state.originId)?.name ?? "",
    meng: state.stats.meng,
    ling: state.stats.ling,
    ti: state.stats.ti,
    de: state.stats.de,
  };

  const excerpts = state.records
    .filter(
      (record) =>
        record.kind === "molt" ||
        record.kind === "combat" ||
        // [M2-B2] 凝招进摘录：一世自己拼出来的那一手是这一世最像「传」的东西
        record.kind === "forge" ||
        (record.kind === "event" && record.refId !== undefined && onceEventIds.has(record.refId)),
    )
    .slice(0, Math.max(0, lifeTuning(state, content).chronicleMaxExcerpts));

  const lines: string[] = [render(tpl.opening, vars)];
  for (const record of birth ? [birth, ...excerpts] : excerpts) {
    lines.push(
      render(tpl.middleLine, {
        ...vars,
        year: record.year,
        season: tpl.seasonNames[record.season],
        text: record.text,
      }),
    );
  }
  /*
   * [2026-08-13] 成道的结语按**道**取，不按 ending 取：四条道的 `ending` 都是 `ascend`，
   * 而一个归山的老兽读到「白光贯顶，兽身褪如敝衣」是错的。`wayEndings` 是必填的
   * （见 ChronicleTemplates），所以这里没有兜底分支要写。
   */
  lines.push(
    render(
      ending === "ascend" && state.wayAchieved !== null
        ? tpl.wayEndings[state.wayAchieved]
        : tpl.endings[ending],
      vars,
    ),
  );
  const praise = pickPraise(tpl.praise, state.stats.de, ending, state.wayAchieved);
  lines.push(tpl.praisePrefix + (praise ? render(praise.text, vars) : ""));

  return {
    title: render(tpl.titleTemplate, vars),
    body: lines.join("\n"),
    ending,
    years: state.year,
    organCount: state.organIds.length,
  };
}

/**
 * 一世结算的血统点：蜕变 +1／每满 10 岁 +1／登神 +3／**[M1-P2] 每达成一条登神门槛 +1**。
 *
 * 「蜕变」计 `molt` 记录数（含事件直接赠予的器官）。前三项的数值写在接口正本的函数注释里，
 * 是接口的一部分，故不吃 tuning。
 *
 * ## 为什么加第四项（计划 P2「血统结算按距登神多近加权」）
 * 原来的三项只认**寿数**：一个活到十八岁、攒了五件器官、灵性六十的一世，与一个活到十八岁
 * 什么都没干的一世，血统点几乎一样 —— 于是「往登神走」这条路在跨世层面**没有回报**，
 * 玩家死后没有任何理由觉得「这一世比上一世更接近了」。按达成的门槛条数给分，让「差一点」
 * 也算数：那正是死亡屏差距报告想让玩家记住的那句「我差两件器官」。
 *
 * 因此签名从一参变两参（门槛数值在 `content.tuning`）—— 与 `waysProgress` 同一份判据。
 *
 * ## [2026-08-13] 四道改了后两项
 * - 成道那一笔从固定 +3 换成 `tuning.wayBloodline[way]`：四条道的难度不一样（化灵要一世
 *   不杀，归山只要活得久而厚德），同一个 +3 会让「哪条道都一样」，而这一批的全部目的
 *   就是让四条道不一样。
 * - 门槛那一笔按**最接近的那条道**算，而不是四条求和：求和会让门槛互相搭便车（化灵的
 *   「不杀一命」在降世那一刻就是达成的，于是每一世白拿一分），也会把「差一点」稀释掉。
 *   按最接近的那条算，读法才与死亡屏那句差距报告一致 —— 你差的是**你正在走的那条道**上的两件事。
 *
 * ⚠️ 成道那一世因此**两笔都拿**：`wayBloodline[way]` ＋ 那条道的全部门槛数（它刚刚全备，
 * 所以 `nearest.metCount` 就是它的门槛条数）。这是有意的 —— 走通一条道该比「差一条」明显多拿，
 * 而不是只多拿一个固定值。不是漏算。
 */
export function bloodlineGain(state: TaleState, content: TaleContent): number {
  const molts = state.records.filter((record) => record.kind === "molt").length;
  const decades = Math.floor(state.year / 10);
  const progress = waysProgress(state, content);
  const wayBonus =
    state.wayAchieved === null ? 0 : lifeTuning(state, content).wayBloodline[state.wayAchieved];
  const nearest = progress.ways.find((way) => way.id === progress.nearest);
  return molts + decades + wayBonus + (nearest?.metCount ?? 0);
}
