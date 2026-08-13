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
import { BODY_PART_NAMES, COMBAT_MESSAGES, ENGINE_MESSAGES, STALK_MESSAGES, render } from "./messages.js";
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
  LifePremise,
  LifeRecord,
  OrganDef,
  PremiseDef,
  PremiseTuningDelta,
  PremiseTuningKey,
  Season,
  SeedDef,
  StalkAct,
  StalkState,
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
   * [S2] 探索去处表。**不得为空，且至少有一处无门槛**（`createLife` 不管，
   * `exploreDestinations` 也不管 —— 但 `performAction("explore")` 会因为无处可去而
   * 永远抛错）。内容侧的 schema 测试守着这两条：一个「探索按钮全灰」的版本
   * 不会有任何引擎测试变红。
   */
  destinations: DestinationDef[];
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

/** [S2] `performAction` 的行动参数。今天只有探索需要它。 */
export interface ActionOptions {
  /**
   * 去哪一处（`DestinationDef.id`）。
   *
   * **`explore` 必填**（缺省／不认识／门槛未达一律抛错），别的行动**必须不填**
   * （填了也抛错）。刻意不做「不填就去兽径」的兜底：那会留下两套语义 ——
   * 一个忘了传目的地的调用点会静默退回旧行为，而那正是这一批要消灭的东西。
   */
  destinationId?: string;
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
 * 单个战斗回合的结果。`over` 非 null 时 `state.combat` 已置 null。
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
 * `over` 非 null 时 `state.stalk` 已置 null，**且本季在这一刻才收束**（季推进＋死亡判定
 * 都在这一步跑完，见 `closeSeason`）——「起追」那一次 `performAction` 只把猎物摆上来。
 * `combat` ＝ 转入搏杀（`state.combat` 非 null）。
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
  /** 招来反击的概率；0 ＝ 不会（未打守备处，或它已被致盲） */
  counterChance: number;
  /** 反击若中会挨多少（已含姿态与护体） */
  counterDamage: DamageRange;
  /** 附带效果：咬腿＝迟滞，扑眼＝致盲，咬喉＝无 */
  rider: "blind" | "slow" | null;
  /** 附带效果持续几回合 */
  riderRounds: number;
  /**
   * 这一咬的附带效果**这一次落不落得下来**。
   *
   * 已经在生效的效果不叠加（见 `combatAct`），所以「它已经瞎着的时候再扑眼」只是一记
   * 极轻的伤。不报这一位，那颗按钮就在骗人 —— 而这恰好是「什么时候该换回咬喉」的信号。
   *
   * 另一种落不下来的情形是**这一咬就把它打死了**（`combatAct` 只在 `enemyHp > 0` 时挂效果）：
   * 按最坏情况（`damage.min`）判，宁可少许一件也不多许一件。
   */
  riderLands: boolean;
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
  /** 交给 `combatAct({ kind: "skill", skillId })` 的那个 id（器官技＝器官 id，组合技＝`syn:<id>`） */
  skillId: string;
  /** 器官技的来源器官；组合技为 null */
  organId: string | null;
  /** [S1] 组合技的来源组合（`SynergyDef.id`）；器官技为 null —— 界面据它打「异变」印记 */
  synergyId: string | null;
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
  /** 伤害区间（`heal` 类与纯效果类恒为 0） */
  damage: DamageRange;
}

export interface CombatPreview {
  /** 我方姿态 */
  stance: Stance;
  /** 敌人护着的部位（对谁都可见） */
  guardPart: BodyPart;
  /** 敌人这一回合宣告的意图（**精确**值；无 `combatIntentTags` 时界面不该显示 kind 与 text） */
  intent: EnemyIntent;
  /** 读得出确切意图（洞察类器官）—— 否则只该给 `intentClass` 那两档 */
  intentKnown: boolean;
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
  fleeChance: number;
  /** 它这一回合若打中，会挨多少（已含意图倍率、姿态、迟滞、护体） */
  incomingDamage: DamageRange;
  /** 它打空的概率（致盲期间才 >0） */
  incomingMissChance: number;
  /** 期望受伤 ＝ `incomingDamage × (1 − 打空概率)` */
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
  /** [S1] 双方血量 —— 界面本来就从 `state.combat` 读，这里同报一份是为了让 `recommendCombatAct`
   *  只吃 `CombatPreview` 一个入参（「这一手打不打得死它」算不出来的话，推荐链就只能猜） */
  enemyHp: number;
  playerHp: number;
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
    combat: state.combat
      ? {
          ...state.combat,
          // [M1-P2] intent 与 skillCooldowns 是新的可变容器，漏拷会让「不改动入参」那条测试变红
          intent: { ...state.combat.intent },
          skillCooldowns: { ...state.combat.skillCooldowns },
          log: [...state.combat.log],
        }
      : null,
    stalk: state.stalk ? { ...state.stalk, log: [...state.stalk.log] } : null,
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

/** [S1] 组合技的 `skillId` 前缀 —— 器官 id 不许以它开头（内容 schema 测试盯着这条）。 */
export const SYNERGY_SKILL_PREFIX = "syn:";

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
}

/** 去处查表（id → def）。 */
export function destinationById(content: TaleContent, id: string): DestinationDef | null {
  return content.destinations.find((destination) => destination.id === id) ?? null;
}

/** [S2] 门槛已达？无门槛（兽径）恒为真。 */
function destinationUnlocked(state: TaleState, destination: DestinationDef): boolean {
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

/** [S1] 技能池里的一条：一个技 ＋ 它是从哪儿来的。 */
export interface CombatSkillEntry {
  /** 交给 `combatAct` 的 id（器官技＝器官 id，组合技＝`syn:<synergyId>`） */
  skillId: string;
  organId: string | null;
  synergyId: string | null;
  skill: CombatSkillDef;
}

/**
 * [S1] 这一世**全部可用的技**：器官技（按 `organIds` 顺序）＋ 已凑齐的组合技。
 *
 * ## 它替掉了 `combatSkillOrgan`
 * 那个函数是 `ownedOrgans(...).find(o => o.combatSkill)` —— **只取第一件**，而且取的是
 * `organIds` 顺序里碰巧最前的那件。身上五件带技器官也只用得上一件，于是「技能组合」
 * 在代码层面根本不存在。删掉而不是留着：留一个「只返回一件」的公开查询，下一个人
 * 一定会拿它去画技能栏，然后困惑为什么另外四件不见了。
 */
export function combatSkills(state: TaleState, content: TaleContent): CombatSkillEntry[] {
  const out: CombatSkillEntry[] = [];
  for (const organ of ownedOrgans(state, content)) {
    if (organ.combatSkill) {
      out.push({ skillId: organ.id, organId: organ.id, synergyId: null, skill: organ.combatSkill });
    }
  }
  for (const synergy of ownedSynergies(state, content)) {
    out.push({
      skillId: `${SYNERGY_SKILL_PREFIX}${synergy.id}`,
      organId: null,
      synergyId: synergy.id,
      skill: synergy.skill,
    });
  }
  return out;
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
 * @param seedNum 种子数（同时作为 rngState 初值）
 * @param seedDefId 选中的神种 `SeedDef.id`
 * @param options.boonOrganIds [S1] 血脉带来的器官 id（重复／与神种同一件时自动跳过）
 * @throws 神种 id 不存在、血脉器官 id 不存在、或天时／出身池为空时抛错（内容 bug 要吵）
 */
export function createLife(
  seedNum: number,
  seedDefId: string,
  content: TaleContent,
  options?: { boonOrganIds?: readonly string[] },
): TaleState {
  const seed = content.seeds.find((candidate) => candidate.id === seedDefId);
  if (!seed) throw new Error(`createLife: 未知神种 ${seedDefId}`);
  const cursor = createCursor(seedNum >>> 0);
  const premise = drawPremise(cursor, content);
  const t = tuningWithDeltas(content.tuning, [premise.sky.tuningDelta, premise.origin.tuningDelta]);
  const index = organIndex(content);
  const organIds: string[] = [seed.organ.id];
  let stats = addStats(t.initialStats, seed.organ.statMods);
  for (const id of options?.boonOrganIds ?? []) {
    const organ = index.get(id);
    if (!organ) throw new Error(`createLife: 未知血脉器官 ${id}`);
    if (organIds.includes(id)) continue;
    organIds.push(id);
    stats = addStats(stats, organ.statMods);
  }
  stats = addStats(stats, premise.origin.statMods);
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
    hunger: clamp(t.hungerInit, 0, t.hungerMax),
    lifespanMax: Math.max(1, lifespan),
    essence: { zu: 0, lin: 0, xue: 0, meng: 0 },
    organIds,
    // 开局变量的专属事件线靠这些 flag 入池。走 contentFlags 过滤：内容侧写错一个
    // `sys:` 前缀不该在降世这一刻就改掉引擎规则（同 applyEffects 的理由）
    flags: contentFlags([...(premise.sky.flags ?? []), ...(premise.origin.flags ?? [])]),
    firedOnceIds: [],
    combat: null,
    stalk: null,
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
  if (!state.alive || state.combat || state.stalk) return [];
  const threshold = lifeTuning(state, content).moltThreshold;
  const actions: ActionId[] = ["hunt", "explore", "rest"];
  if (ESSENCE_ORDER.some((type) => state.essence[type] >= threshold)) {
    actions.push("dormant");
  }
  return actions;
}

// ===== 回合：行动 =====

/**
 * 打一场架的起手状态。playerHp 每场重置为 ti（本模型无跨战常驻 HP）。
 *
 * [M1-P2] 开战就要把**第一回合的守备与意图**摆出来 —— 玩家在按第一颗按钮之前就该读到
 * 「它护着咽喉、它要扑」。抽取顺序：守备 → 意图类型 → 意图旁白（恒 3 次，见 `rollFace`）。
 */
function beginCombat(
  draft: TaleState,
  enemy: EnemyDef,
  cursor: RngCursor,
  t: TaleTuning,
): void {
  const face = rollFace(cursor, enemy, t, {
    enemyHp: enemy.hp,
    slow: 0,
    forcedGuard: false,
  });
  draft.combat = {
    enemyId: enemy.id,
    enemyHp: enemy.hp,
    playerHp: draft.stats.ti,
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
    log: [render(ENGINE_MESSAGES.combatStart, { enemy: enemy.name })],
  };
}

/**
 * 摇出「下一回合玩家会看到的那张脸」：它护哪儿、它打算干什么。
 *
 * **恒定消耗 3 次抽取**（守备 → 意图类型 → 意图旁白），`forcedGuard`（顿挫）也照抽不误 ——
 * 抽取次数随分支变化会让「同种子同操作＝同终态」变成一件要逐分支推演的事。
 *
 * 两条排除规则（都不是洁癖）：
 * - 迟滞（`slow > 0`）时不出「扑」也不出「逃」：腿被咬伤的兽扑不起来、也走不掉。宣告了
 *   做不到的事就是**骗人**，而这套设计的全部本钱就是「屏幕上写的都算数」。
 * - 血还厚时不出「逃」：满血遁走会让玩家白挨一顿莫名其妙的空。
 */
function rollFace(
  cursor: RngCursor,
  enemy: EnemyDef,
  t: TaleTuning,
  now: { enemyHp: number; slow: number; forcedGuard: boolean },
): { guardPart: BodyPart; intent: EnemyIntent } {
  const guardPart =
    weightedPick(cursor, BODY_PARTS, (part) => enemy.guardBias?.[part] ?? 1) ?? "throat";
  const pool = INTENT_KINDS.filter((kind) => {
    if (kind === "flee") {
      return now.slow <= 0 && now.enemyHp <= enemy.hp * t.combatFleeIntentHpRatio;
    }
    return true;
  });
  const drawn =
    weightedPick(cursor, pool, (kind) => {
      const base = enemy.intentBias?.[kind] ?? t.combatIntentWeights[kind];
      // 迟滞压低「扑」的权重而**不排除**它：腿伤了还是扑得起来，只是没那么频（而且伤害
      // 已经吃了 combatSlowDamageMul 的折）。全排除会让「咬腿→咬喉」的轮转**彻底删掉**
      // 扑这一档，而扑的预告正是姿态那一整套决定的前提 —— 实验台上量到的就是这个
      // （只会咬腿一手对岩羊胜率 99.5%，等于一颗按钮通吃）。
      return kind === "pounce" && now.slow > 0 ? base * t.combatSlowPounceMul : base;
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

function stalkPrey(state: TaleState, content: TaleContent): EnemyDef {
  const stalk = state.stalk;
  if (!stalk) throw new Error("stalkPrey: 当前不在追猎中");
  const prey = enemyById(content, stalk.preyId);
  if (!prey) throw new Error(`stalkPrey: 未知猎物 ${stalk.preyId}`);
  return prey;
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
  const stalk = state.stalk;
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
  const stalk = state.stalk;
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
 * 起追：摆好一头具体的猎物与四个量。
 *
 * 抽取顺序固定（改动即打破所有既存种子的剧本）：猎物 → 距离抖动 → 警觉抖动 → 风向 → 开场旁白。
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

  const baseDistance = prey.startDistance ?? t.stalkStartDistance;
  const distanceJitter = t.stalkStartDistanceJitter;
  const distance = Math.max(
    1,
    Math.round(baseDistance + (distanceJitter > 0 ? cursor.int(distanceJitter * 2 + 1) - distanceJitter : 0)),
  );
  // [2026-08-13] 加成而不是缺省值：八头猎物全都自带 wariness，改缺省值等于没改（见 tuning 注释）
  const baseAlert = (prey.wariness ?? t.stalkStartAlert) + t.stalkAlertBonus;
  const alertJitter = t.stalkStartAlertJitter;
  const alertness = clamp(
    Math.round(baseAlert + (alertJitter > 0 ? cursor.int(alertJitter * 2 + 1) - alertJitter : 0)),
    0,
    t.stalkAlertMax,
  );
  const winds: readonly WindDir[] = ["into", "cross", "with"];
  const wind = winds[cursor.int(winds.length)] ?? "cross";
  const opening = render(pickFlavor(cursor, prey.stalkFlavor?.begin, STALK_MESSAGES.begin), {
    enemy: prey.name,
  });

  draft.stalk = {
    preyId: prey.id,
    distance,
    alertness,
    stamina: t.stalkStamina,
    wind,
    // 起手不确知风向：有 stalkWindTags 器官的读得出来（见 stalkPreview），没有的只能绕一圈买确定
    windKnown: false,
    round: 0,
    log: [opening],
  };
  notices.push(opening);
}

/**
 * 追猎屏要显示的全部只读数（纯函数）。
 *
 * @throws 不在追猎中时抛错 —— 界面只该在 `state.stalk` 非 null 时问它
 */
export function stalkPreview(state: TaleState, content: TaleContent): StalkPreview {
  const stalk = state.stalk;
  if (!stalk) throw new Error("stalkPreview: 当前不在追猎中");
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

  return {
    pounceChance: pounceChanceAt(stalk.distance, stalk.alertness, meng, t),
    creepGain,
    alertVisible: t.stalkAlertTags.some((tag) => tags.has(tag)),
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
 * 打一个追猎动作。
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
 * @throws 已死亡、不在追猎中、或猎物 id 失效时抛错
 */
export function stalkAct(state: TaleState, act: StalkAct, content: TaleContent): StalkTurn {
  if (!state.alive) throw new Error("stalkAct: 已死亡");
  const current = state.stalk;
  if (!current) throw new Error("stalkAct: 当前不在追猎中");
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

  if (over === null) {
    draft.stalk = {
      preyId: current.preyId,
      distance,
      alertness,
      stamina,
      wind,
      windKnown,
      round: current.round + 1,
      log: [...current.log, ...roundLog],
    };
  } else {
    draft.stalk = null;
    if (caught) {
      draft.hunger = clamp(draft.hunger + t.huntFoodGain, 0, t.hungerMax);
      draft.essence = addEssence(draft.essence, prey.essence);
      // [2026-08-13] 得手就是夺了一命 —— 这一笔同时是妖王的进度与化灵的断门。
      // 它刻意**不写 LifeRecord**（见 LifeRecord 的记录纪律：一世几十次狩猎会把列传摘录占满），
      // 所以只有这个计数器记得住它。
      draft.livesTaken += 1;
      say(undefined, STALK_MESSAGES.feed);
    }
    if (over === "combat") {
      say(flavor?.retaliate, STALK_MESSAGES.retaliate);
      beginCombat(draft, prey, cursor, t);
      // 附毒：扑空那一下把毒蹭了进去，敌人带伤入场。M0 的 CombatState 没有「持续中毒」
      // 的字段（那是 P2 战斗重做要加的 blind／slow 那一族），所以 P1 落成起手血量折扣 ——
      // 是真效果、可测，且不用先斩 P2 的接口。
      if (tags.has(t.stalkVenomTag) && draft.combat) {
        draft.combat.enemyHp = Math.max(1, Math.round(draft.combat.enemyHp * t.stalkVenomHpMul));
        say(undefined, STALK_MESSAGES.venom);
      }
    }
    // 本季到此才收束（起追那一次刻意没推进）
    closeSeason(draft, content, t, records);
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
 * `records` 就地追加死亡记录（调用方负责最后并进 `draft.records`）。
 */
function closeSeason(
  draft: TaleState,
  content: TaleContent,
  t: TaleTuning,
  records: LifeRecord[],
): void {
  const cost = t.hungerPerSeason + (draft.season === WINTER ? t.winterHungerExtra : 0);
  draft.hunger = clamp(draft.hunger - cost, 0, t.hungerMax);
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
  draft.combat = null;
  // 追猎同战斗：死亡覆盖一切未收束的子系统，界面不会拿到「已死却还在追」的状态
  draft.stalk = null;
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
 * 要么起追 —— 后者返回时 `state.stalk` 非空、`pendingEvent` 为 null，**且这一季尚未推进**
 * （步骤 3〜5 全部推迟到 `stalkAct` 判出 `over` 的那一步，两处共用 `closeSeason`）。
 * 客户端据 `state.stalk` 切到追猎屏；`availableActions` 在追猎未收束时返回空数组。
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
  if (state.combat) throw new Error("performAction: 战斗未结束，先调 combatAct");
  if (state.stalk) throw new Error("performAction: 追猎未收束，先调 stalkAct");
  if (!availableActions(state, content).includes(action)) {
    throw new Error(`performAction: 当前不可执行行动 ${action}`);
  }
  const destination = resolveDestinationArg(state, content, action, options.destinationId);

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
  const drawn = draft.combat ? null : drawEvent(draft, cursor, content, t, premise, action, destination);

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
  if (action === "hunt" && !drawn) beginStalk(draft, cursor, content, t, notices);

  // 1.5 起追早退：`beginStalk` 只把猎物摆上来，这一季**刻意不推进**（否则光是起追就白耗
  // 一季），也不抽事件（玩家此刻该盯着追猎屏，不该被别的事件插队）。季推进与死亡判定推迟到
  // `stalkAct` 判出 `over` 的那一步，由同一个 `closeSeason` 收束。
  if (draft.stalk) {
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

  closeSeason(draft, content, t, records);

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
  beginCombat(draft, enemy, cursor, t);
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
    beginCombat(draft, enemy, cursor, t);
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

// ===== 搏杀（M1-P2 重做）=====
//
// 玩法正本：docs/plans/shiling/2026-08-12-liezhuan-m1-playable-plan.md 的「P2 搏杀屏重做」。
//
// M0 的战斗是四选一（战／逃／诈／器官技），而「战」在任何局面下都不比别的差 —— 于是它
// 事实上是一颗按钮，剩下三颗是装饰。P2 把它拆成「三个部位 × 三种姿态 × 一个带冷却的技」，
// 并给敌人加了**两个玩家出手前就看得见的量**（护着哪儿、这一回合打算干什么）。
//
// 三个部位刻意做成**三种工具而不是三档伤害**：
//   咬喉 高伤，收官；被护住则减半 ＋ 招反击。
//   咬腿 低伤 ＋ 迟滞：拦得住要逃的敌人（否则它带走整顿肉），也压得住下一回合的重击。
//   扑眼 极低伤 ＋ 致盲：收益随**敌人的伤害**放大 —— 打穷奇值，打野雉不值。
// 于是「哪个最优」的答案随敌人、随血线、随它的意图变化，这正是「有得选」的定义。
//
// 「诈」按计划移除：它的两半（骗过一次攻击／攒一次重击）分别由扑眼与扑击姿态承担，
// 而且都变成了可见的、跨回合的东西，不再是一次背后掷骰。

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

/** 我方出手的总倍率：部位 × 姿态 × （被护住则减半，它还在守势则再减一档）。 */
function biteMultiplier(
  t: TaleTuning,
  part: BodyPart,
  stance: Stance,
  guarded: boolean,
  guardIntent: boolean,
): number {
  const stanceOut = t.combatStanceMul[stance]?.out ?? 1;
  const guardMul = guarded ? t.combatGuardDamageMul * (guardIntent ? t.combatGuardIntentMul : 1) : 1;
  return (t.combatBiteMul[part] ?? 1) * stanceOut * guardMul;
}

/** 我方受伤的总倍率：意图 × 姿态 × 迟滞 × 护体。0 ＝ 它这一回合不出手。 */
function incomingMultiplier(
  t: TaleTuning,
  intentKind: EnemyIntentKind,
  stance: Stance,
  slow: number,
  ward: number,
): number {
  const intentMul = t.combatIntentDamageMul[intentKind] ?? 1;
  if (intentMul <= 0) return 0;
  return (
    intentMul *
    (t.combatStanceMul[stance]?.in ?? 1) *
    (slow > 0 ? t.combatSlowDamageMul : 1) *
    (ward > 0 ? t.combatWardDamageMul : 1)
  );
}

/** 逃跑成功率（正本公式 ＋ [M1-P2] 致盲加成：它看不见你往哪去）。 */
function fleeChanceOf(
  state: TaleState,
  enemy: EnemyDef,
  t: TaleTuning,
  blind: number,
): number {
  return clamp(
    t.fleeBase +
      (state.stats.ling - enemy.meng) * t.fleePerLingDiff -
      enemy.fleeBias * t.fleeBiasFactor +
      (blind > 0 ? t.combatBlindFleeBonus : 0),
    t.minChance,
    t.maxChance,
  );
}

/** 咬这个部位会附带什么。 */
function riderOf(part: BodyPart, t: TaleTuning): { rider: "blind" | "slow" | null; rounds: number } {
  if (part === "eye") return { rider: "blind", rounds: t.combatBlindRounds };
  if (part === "leg") return { rider: "slow", rounds: t.combatSlowRounds };
  return { rider: null, rounds: 0 };
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
 * 搏杀屏要显示的全部只读数（纯函数、不消耗抽取）。
 *
 * @throws 不在战斗中、或敌人 id 失效时抛错 —— 界面只该在 `state.combat` 非 null 时问它
 */
export function combatPreview(state: TaleState, content: TaleContent): CombatPreview {
  const combat = state.combat;
  if (!combat) throw new Error("combatPreview: 当前不在战斗中");
  const enemy = enemyById(content, combat.enemyId);
  if (!enemy) throw new Error(`combatPreview: 未知敌人 ${combat.enemyId}`);
  const t = lifeTuning(state, content);
  const tags = ownedTags(state, content);
  const meng = state.stats.meng;
  const guardIntent = combat.intent.kind === "guard";

  const bites: BitePreview[] = BODY_PARTS.map((part) => {
    const guarded = part === combat.guardPart;
    const mul = biteMultiplier(t, part, combat.stance, guarded, guardIntent);
    const { rider, rounds } = riderOf(part, t);
    // 反击也是「受伤」，所以同样吃姿态与护体（不吃迟滞：反口是本能，不用起势）
    const counterMul =
      t.combatCounterDamageMul *
      (t.combatStanceMul[combat.stance]?.in ?? 1) *
      (combat.ward > 0 ? t.combatWardDamageMul : 1);
    const damage = damageRange(meng, t, mul);
    /*
     * 附带效果当回合就生效（且不叠加），所以「咬完之后它这一下能打我多少」按咬完的状态算。
     * 还要减掉两种落不下来的情形：已经在生效（不叠加），以及**这一咬就把它打死了**
     * —— 后者按 `damage.min` 判，宁可少许一件也不多许一件（`combatAct` 只在存活时挂效果）。
     */
    const survives = combat.enemyHp - damage.min > 0;
    const riderLands =
      survives && ((rider === "slow" && combat.slow <= 0) || (rider === "blind" && combat.blind <= 0));
    const slowAfter = rider === "slow" && riderLands ? t.combatSlowRounds : combat.slow;
    const blindAfter = rider === "blind" && riderLands ? t.combatBlindRounds : combat.blind;
    const afterMul = incomingMultiplier(t, combat.intent.kind, combat.stance, slowAfter, combat.ward);
    return {
      part,
      damage,
      guarded,
      counterChance: guarded && combat.blind <= 0 ? t.combatGuardCounterChance : 0,
      counterDamage: damageRange(enemy.meng, t, counterMul),
      rider,
      riderRounds: rounds,
      riderLands,
      stopsFlee:
        part === "leg" && combat.intent.kind === "flee" && combat.slow <= 0 && survives,
      incomingAfter: damageRange(enemy.meng, t, afterMul),
      incomingAfterMissChance: blindAfter > 0 ? t.combatBlindMissChance : 0,
    };
  });

  const stances: StancePreview[] = STANCES.map((to) => {
    const mul = incomingMultiplier(t, combat.intent.kind, to, combat.slow, combat.ward);
    return {
      to,
      current: to === combat.stance,
      outMul: t.combatStanceMul[to]?.out ?? 1,
      inMul: t.combatStanceMul[to]?.in ?? 1,
      incomingIfSwitch: damageRange(enemy.meng, t, mul),
    };
  });

  const skills: CombatSkillPreview[] = combatSkills(state, content).map((entry) => {
    const skill = entry.skill;
    const cooldown = skill.cooldown ?? t.combatSkillCooldown;
    const cooldownLeft = Math.max(0, combat.skillCooldowns[entry.skillId] ?? 0);
    const affordable = canAfford(skill.cost, combat.playerHp, state);
    return {
      skillId: entry.skillId,
      organId: entry.organId,
      synergyId: entry.synergyId,
      name: skill.name,
      desc: skill.desc,
      effects: skillEffectsOf(skill),
      // 两个条件都要满足才叫「能使」；不可用的**原因**分开报（见字段注释）
      ready: cooldownLeft <= 0 && affordable,
      cooldownLeft,
      cooldown,
      cost: skill.cost ?? null,
      affordable,
      damage: skillDealsDamage(skill, t)
        ? damageRange(skillStatOf(skill, state.stats), t, skillDamageMul(skill, t, combat.stance))
        : ZERO_DAMAGE,
    };
  });

  const incomingMul = incomingMultiplier(t, combat.intent.kind, combat.stance, combat.slow, combat.ward);
  const incomingDamage = damageRange(enemy.meng, t, incomingMul);
  const missChance = combat.blind > 0 ? t.combatBlindMissChance : 0;
  // roundsToLive 用「它常规出一手」而不是这一回合的意图：它守着不打时这个数不该跳成 99
  const typicalMul = incomingMultiplier(t, "bite", combat.stance, combat.slow, combat.ward);
  const typical = damageRange(enemy.meng, t, typicalMul).mid * (1 - missChance);
  const bestBite = Math.max(...bites.map((bite) => bite.damage.mid));

  return {
    stance: combat.stance,
    guardPart: combat.guardPart,
    intent: combat.intent,
    // [S1] 「明识」是洞察器官的临时替身：读得出意图的两个来源，一个判据
    intentKnown: combat.insight > 0 || t.combatIntentTags.some((tag) => tags.has(tag)),
    intentClass:
      combat.intent.kind === "guard" || combat.intent.kind === "flee" ? "hold" : "act",
    bites,
    stances,
    skills,
    fleeChance: fleeChanceOf(state, enemy, t, combat.blind),
    incomingDamage,
    incomingMissChance: missChance,
    incomingExpected: Math.round(incomingDamage.mid * (1 - missChance) * 10) / 10,
    roundsToLive: typical <= 0 ? 99 : Math.min(99, Math.ceil(combat.playerHp / typical)),
    roundsToKill: bestBite <= 0 ? 99 : Math.min(99, Math.ceil(combat.enemyHp / bestBite)),
    enemyHp: combat.enemyHp,
    playerHp: combat.playerHp,
    blind: combat.blind,
    slow: combat.slow,
    ward: combat.ward,
    bleed: combat.bleed,
    thorns: combat.thorns,
    insight: combat.insight,
    enemyWillFlee: combat.intent.kind === "flee" && combat.slow <= 0,
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
 * 1. 这一手打得死它（按最坏情况 `damage.min` 判）→ 打最重的那一手（**技也算**）。
 * 2. 撑不过两合 → 保命：`bolt`（必定脱身）＞ 逃（掷骰）＞ `heal` ＞ `brace`。
 * 3. 它要走 → 咬腿拦住（否则整顿肉白丢）。
 * 4. 它宣告重击而它还看得见 → `brace` 硬吃那一下；没有则扑眼（致盲五成五让它整个打空）。
 * 5. 读不出意图、有 `insight` 技、且这是场长仗 → 先买知情权（后面每一合都用得上）。
 * 6. 长仗且持续类（`bleed`／`venom`／`thorns`）还没挂上 → 挂它（越早挂收得越满）。
 * 7. 伤害类技比最强的一咬更重 → 放技。
 * 8. 挨得凶而它还看得见 → 扑眼买两合。
 * 9. 长仗、而咬腿的迟滞这一口落得下来 → 咬腿钝它的势。
 * 10. 它在守（那一合本来就不挨伤）→ 换姿态。
 * 11. 否则挑当前伤害最高的那一咬（守备会把它从咬喉赶到别处）。
 *
 * **自伤类技的安全阀**：代价 ≥ 当前血量一半的技一律不推荐（除了第 1 条那种能收官的）——
 * `ready` 只保证「付完还活着」，而推荐一手让玩家剩 1 血的按钮是在劝他送死（同 P2 那条
 * 「推荐链在劝玩家送死」的教训：那一版把逃排晚一格，战死率从 8.5% 飙到 33.5%）。
 */
export function recommendCombatAct(preview: CombatPreview): CombatAct {
  const bites = [...preview.bites].sort((a, b) => b.damage.mid - a.damage.mid);
  const bestBite = bites[0];
  const bestBiteAct: CombatAct = { kind: "bite", part: bestBite?.part ?? "throat" };
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

  // 1. 收官：技与咬一起比，取「最坏情况也打得死」的那一手（这里不管自伤过半 —— 打完就结束了）
  const lethalSkill = [...ready]
    .filter((skill) => skill.damage.min >= preview.enemyHp)
    .sort((a, b) => b.damage.mid - a.damage.mid)[0];
  if (lethalSkill) return skillAct(lethalSkill);
  if (bestBite && bestBite.damage.min >= preview.enemyHp) return bestBiteAct;
  if (preview.roundsToKill <= 1) return bestBiteAct;

  /*
   * 2. 撑不过两合 —— 保命的四条。
   *
   * 排序按「它把**这场架**了结到什么程度」，不是按「这一合有多确定」：
   * `bolt` 必定脱身（威胁归零）＞ 逃（掷骰，但同样是了结）＞ `brace`（把这一下归零，
   * 只是把死推迟一合，不解决问题）＞ `heal`（回 8 血，可能盖不住一记 2.2 倍的扑）。
   * code-reviewer 提过把 `brace` 提到逃之前（按「确定性」排），但那会让一个必死的局面
   * 多耗一合再死 —— 保命的目的是**活着离开**，不是活得久一点。
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
  const mayFlee = preview.intentKnown ? preview.enemyWillFlee : preview.intentClass === "hold";
  if (mayFlee) return { kind: "bite", part: "leg" };

  // 4. 它宣告重击：硬吃（免伤）优先于弄瞎（五成五打空）—— 前者是确定的
  if (preview.intentKnown && preview.intent.kind === "pounce") {
    const brace = withEffect("brace");
    if (brace) return skillAct(brace);
    if (preview.blind <= 0) return { kind: "bite", part: "eye" };
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

  // 7. 伤害类技比最强的一咬更重就放它（技有冷却，早放早转）
  if (hardest && hardest.damage.mid > (bestBite?.damage.mid ?? 0)) return skillAct(hardest);

  // 8. 挨得凶而它还看得见 → 扑眼买两合
  if (preview.roundsToLive <= 3 && preview.blind <= 0) return { kind: "bite", part: "eye" };

  // 9. 长仗里把它的势钝下来（附带效果不叠加，所以这一手有节奏：钝完就换回咬喉输出）
  const leg = preview.bites.find((bite) => bite.part === "leg");
  if (preview.roundsToKill >= 3 && leg?.riderLands === true) return { kind: "bite", part: "leg" };

  /*
   * 10. 它在守：那一合本来就不挨伤，拿去换姿态。
   *
   * **顺序是量出来的**：把这一条排到第 9 条之前，岩羊的 seer 胜率 88.8%→87.8%、
   * 玄蟒的 seer+fang 67.5%→63.5% —— 守着的那一合拿去咬一口比换姿态划算，
   * 换姿态只在「这一口本来也没什么附带可捞」时才是最优。
   */
  if (preview.intentKnown && preview.intent.kind === "guard") {
    const want: Stance = preview.roundsToLive <= 3 ? "low" : "lunge";
    if (preview.stance !== want) return { kind: "stance", to: want };
  }
  return bestBiteAct;
}

/**
 * 打一个搏杀回合。
 *
 * ## 一个回合的固定顺序（不可变更）
 * 1. 玩家动作（咬／换姿态／技／逃）；咬中被护部位可能招来**即时反击**。
 *    [S1] 技先付代价（自伤／精气）再结算效果；`bolt` 那一档当场判 `fled`。
 * 2. 敌人血尽 → `win`（吞精气回饱食，写一条 combat 记录），到此结束。
 * 3. 敌人按**已宣告的意图**动作：扑／咬（致盲期间可能打空）／守（不出手）／
 *    逃（未被迟滞则 `escaped`，玩家什么也拿不到）。
 *    [S1] 它这一下命中我方时，若挂着反刺（`thorns`）它自伤一记；`brace` 让这一下伤害归零。
 * 4. 玩家血尽 → `dead`（ending＝slain）。
 * 5. [S1] 流血（`bleed`）在回合**末**结算 —— 它守着不动也照掉。掉光了算 `win`。
 * 6. 计数器各减一（致盲／迟滞／护体／流血／反刺／明识／技能冷却）。
 * 7. 摇下一回合的守备与意图（`rollFace`，恒 3 次抽取）—— **玩家下一次出手前就看得见**。
 *
 * 反刺与流血刻意排在两处不同的地方：反刺是**对它出手的惩罚**（跟着它那一下走），
 * 流血是**独立于出手的损耗**（跟着回合走）。两者若并到一处，「它爱守」这类敌人就分不出
 * 该用哪一个了。
 *
 * ## 抽取顺序（改它就是破坏所有既存种子的剧本）
 * 咬：伤害抖动 →（被护住**且它没瞎**时）反击掷骰 → 反击伤害抖动 → 旁白；
 *   （瞎着的敌人不会反口，所以那一掷**不抽** —— 与下面敌人段的「致盲才抽打空掷骰」对称）
 * 姿态：旁白；技：（出伤时）伤害抖动 → 每条落地的效果各一次旁白；逃：成败掷骰。
 * 敌人段：（致盲时）打空掷骰 → 伤害抖动 → 旁白。
 * ⚠️ **`brace` 那一回合少抽一次**：硬受挡下的那一下走单句旁白（`combatBraceHold`），
 * 不进变体池。同 M1-P2「被致盲的敌人不抽反击掷骰」那条例外 —— 抽取次数是玩家动作的
 * 纯函数（同种子同操作仍恒等），但它是个**例外**，写在这里免得下一个人按「恒定次数」推演。
 * 回合末的流血与反刺**不抽**（它们的旁白也是单句）。收尾：`rollFace` 的 3 次。
 *
 * `over` 非 null 时 `state.combat` 置 null —— 界面要自己累加每次返回的 `roundLog`
 * （战斗进行中也可以读 `state.combat.log` 拿累积日志，但结束那一刻它就没了）。
 *
 * @throws 已死亡、不在战斗中、敌人 id 失效、技不存在／未持有／还在冷却／**付不起代价**、
 *         或换成当前已在的姿态（那只是白费一回合，界面靠 `combatPreview.stances[].current` 挡住）
 */
export function combatAct(state: TaleState, act: CombatAct, content: TaleContent): CombatTurn {
  if (!state.alive) throw new Error("combatAct: 已死亡");
  const current = state.combat;
  if (!current) throw new Error("combatAct: 当前不在战斗中");
  const enemy = enemyById(content, current.enemyId);
  if (!enemy) throw new Error(`combatAct: 未知敌人 ${current.enemyId}`);

  const t = lifeTuning(state, content);
  const cursor = createCursor(state.rngState);
  const draft = draftOf(state);
  const roundLog: string[] = [];
  const records: LifeRecord[] = [];
  const say = (pool: readonly string[], vars: Record<string, string | number> = {}): void => {
    roundLog.push(render(pickFlavor(cursor, undefined, pool), { enemy: enemy.name, ...vars }));
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
  let over: CombatTurn["over"] = null;
  let forcedGuard = false;
  /** [S1] `brace`：这一回合它那一手的伤害归零（只管当下这一下，不留计数器） */
  let bracing = false;
  const guardIntent = current.intent.kind === "guard";

  // — 1. 玩家动作 —
  switch (act.kind) {
    case "bite": {
      const guarded = act.part === current.guardPart;
      const mul = biteMultiplier(t, act.part, stance, guarded, guardIntent);
      const dmg = rollDamage(cursor, draft.stats.meng, t, mul);
      enemyHp -= dmg;
      if (guarded) {
        // 反击掷骰在旁白**之前**：顺序固定才推演得动（见本函数 JSDoc 的抽取顺序）
        const countered = blind <= 0 && cursor.next() < t.combatGuardCounterChance;
        const counterDmg = countered
          ? rollDamage(
              cursor,
              enemy.meng,
              t,
              t.combatCounterDamageMul *
                (t.combatStanceMul[stance]?.in ?? 1) *
                (ward > 0 ? t.combatWardDamageMul : 1),
            )
          : 0;
        say(COMBAT_MESSAGES.biteGuarded, { dmg, part: BODY_PART_NAMES[act.part] });
        if (countered) {
          playerHp -= counterDmg;
          say(COMBAT_MESSAGES.counter, { dmg: counterDmg });
        }
      } else {
        say(COMBAT_MESSAGES.bite[act.part], { dmg });
      }
      /*
       * 附带效果只在它还活着、**且当前没在生效**时才落地。
       *
       * 「不叠加」这一条是实验台逼出来的：可以每回合续上的话，只会咬腿一手就能把敌人
       * 永久压在 0.6 倍出伤上 —— 对岩羊胜率 99.5%，三颗咬击按钮退化成一颗。不许续之后
       * 「咬腿开局 → 咬喉输出 → 快掉了再咬一次腿」的**轮转**才是最优解，那才叫有得选。
       */
      if (enemyHp > 0) {
        if (act.part === "eye" && blind <= 0) {
          blind = t.combatBlindRounds;
          say(COMBAT_MESSAGES.blinded);
        } else if (act.part === "leg" && slow <= 0) {
          slow = t.combatSlowRounds;
          say(COMBAT_MESSAGES.slowed);
        }
      }
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
       */
      if (!canAfford(skill.cost, playerHp, state)) {
        throw new Error(`combatAct: ${skill.name}的代价此刻付不起`);
      }
      const cost = skill.cost;
      if (cost?.kind === "hp") {
        playerHp -= cost.amount;
        roundLog.push(render(ENGINE_MESSAGES.combatSkillToll, { skill: skill.name, dmg: cost.amount }));
      } else if (cost?.kind === "essence") {
        draft.essence = addEssence(draft.essence, { [cost.type]: -cost.amount });
      }

      const effects = skill.effects ?? [];
      if (skillDealsDamage(skill, t)) {
        const dmg = rollDamage(
          cursor,
          skillStatOf(skill, draft.stats),
          t,
          skillDamageMul(skill, t, stance),
        );
        enemyHp -= dmg;
        roundLog.push(
          render(ENGINE_MESSAGES.combatSkillHit, { skill: skill.name, enemy: enemy.name, dmg }),
        );
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
            playerHp = Math.min(draft.stats.ti, playerHp + t.combatSkillHealAmount);
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
            // 位移类：不掷骰的遁走。它的价钱是精气（见内容表），所以「必定脱身」不是白拿的
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
      // ＋1 是因为本回合末尾统一减一：写 cooldown+1 才让「冷却 3」真的等 3 个回合
      cooldowns[entry.skillId] = (skill.cooldown ?? t.combatSkillCooldown) + 1;
      break;
    }
    case "flee": {
      if (cursor.next() < fleeChanceOf(draft, enemy, t, blind)) {
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
   * [S1] 抽成闭包是因为**现在有两个地方能打死它**：玩家出手（步骤 2）与回合末的流血
   * （步骤 5）。两处各写一份的话，「被流血放倒的那头兽」会漏掉精气、饱食、夺命数与
   * combat 记录 —— 而那正是「妖王」那条道的判据，漏了不会有任何测试变红。
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
        if (slow > 0) {
          // 咬腿把它的退路断了 —— 这条分支是「咬腿」独一份用处的兑现
          say(COMBAT_MESSAGES.fleeBlocked);
        } else {
          /*
           * 它走成了。**即使它正流着血、且这一合末就会流干，也照样是 escaped**
           * （流血在步骤 5 结算，而这里是步骤 3）—— 有意如此：拦逃的工具是**咬腿**
           * （迟滞），不是「挂个持续伤害等它自己倒下」。若流血能追着跑掉的兽结算，
           * 「咬腿拦逃」这条 M1-P2 立起来的用处就被一个无关的效果绕开了。
           */
          over = "escaped";
          say(COMBAT_MESSAGES.enemyFled);
        }
        break;
      default: {
        const missed = blind > 0 && cursor.next() < t.combatBlindMissChance;
        if (missed) {
          say(COMBAT_MESSAGES.enemyMiss);
        } else {
          const mul = incomingMultiplier(t, current.intent.kind, stance, slow, ward);
          // [S1] `brace`（硬受）：这一下的伤害归零。抖动照抽 —— 抽取次数不随分支变化
          const rolled = rollDamage(cursor, enemy.meng, t, mul);
          const dmg = bracing ? 0 : rolled;
          playerHp -= dmg;
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
   * 顺序刻意是「先判我方死、再结算流血」：同一回合两边都归零时**死亡优先**（死了就是死了，
   * 不存在「我倒下的同时它也失血而亡，于是我赢了」）。流血在回合末结算是它与迟滞的分界：
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

  // — 6. 计数器各减一（先让这一回合吃满效果，再衰减）—
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

  const round = current.round + 1;
  if (over === "dead") {
    records.push(
      die(draft, "slain", render(ENGINE_MESSAGES.deathSlain, { enemy: enemy.name }), enemy.id),
    );
  }
  if (over === null) {
    // — 7. 下一回合的脸（玩家出手前就看得见）—
    const face = rollFace(cursor, enemy, t, { enemyHp, slow, forcedGuard });
    draft.combat = {
      enemyId: current.enemyId,
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
      log: [...current.log, ...roundLog],
    };
  } else {
    draft.combat = null;
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
