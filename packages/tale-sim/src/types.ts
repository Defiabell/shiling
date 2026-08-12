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
 */
export type CombatAct =
  | { kind: "bite"; part: BodyPart }
  | { kind: "stance"; to: Stance }
  | { kind: "skill"; organId: string }
  | { kind: "flee" };

/**
 * 接口正本里这个类型写作 `CombatAct2` —— 那个「2」是计划期的产物（当时它与旧的
 * `"fight"|"flee"|"feint"|"organ"` 字符串联合并存）。旧签名已按「兼容纪律」整批替换，
 * `CombatAct` 名下不存在 v1，留个「2」在公开 API 上是永久的疤。故正本名保留为别名，
 * 照正本写的消费方逐字可用。
 */
export type CombatAct2 = CombatAct;

/**
 * [M1-P2 正本] 器官技的附带效果（`OrganDef.combatSkill.effect`）。
 *
 * - `venom` 附毒：伤害 ＋ 给敌人挂迟滞（血凝）。
 * - `stun` 顿挫：伤害 ＋ 把敌人下一回合的意图压成 `guard`（它这一下打不出来）。
 * - `heal` 疗愈：回自身血量，不出伤。
 * - `armor` 护体：伤害 ＋ 给自己挂 `ward`（受伤减半若干回合）。
 */
export type CombatSkillEffect = "venom" | "stun" | "heal" | "armor";

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
/** [正本] 一世的四种收束方式。 */
export type EndingType = "starve" | "slain" | "oldage" | "ascend";
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
  /** 有则搏杀屏多出一颗技能按钮（M0 写的是「第四选项」，P2 起是一颗独立按钮） */
  combatSkill?: {
    name: string;
    desc: string;
    /**
     * [M1-P2 正本] 冷却回合数，缺省 `tuning.combatSkillCooldown`。
     *
     * 冷却是这颗按钮**存在的理由**：M0 的器官技是「每回合都能按的更强的战」，于是它把
     * 别的按钮全废了。有冷却之后「现在用还是留着收官」才是一道题。
     */
    cooldown?: number;
    /** [M1-P2 正本] 附带效果，缺省＝纯伤害 */
    effect?: CombatSkillEffect;
  };
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

/** [正本] 跨世血统资产。持久化（localStorage）归 tale-client。 */
export interface Bloodline {
  points: number;
  unlockedSeedIds: string[];
  chronicle: ChronicleEntry[];
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
  /** [M1-P2] 器官技冷却：`OrganDef.id` → 还要等几回合（0／缺键＝可用） */
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
  alive: boolean;
  ending: EndingType | null;
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
  /** 器官技缺省冷却（`OrganDef.combatSkill.cooldown` 优先） */
  combatSkillCooldown: number;
  /** `heal` 器官技回的血量 */
  combatSkillHealAmount: number;
  /** `venom` 器官技附的迟滞回合数 */
  combatVenomSlowRounds: number;
  /** 持任一即**读得出敌人的确切意图**（否则只有「似要动手／按兵不动」两档） */
  combatIntentTags: string[];

  // — 登神（M0 极简）—
  /** 四项全部满足时引擎挂上 SYS_FLAG_ASCEND_READY，「天命」事件靠 requiresFlags 入池 */
  ascendMinYear: number;
  ascendMinOrgans: number;
  ascendMinLing: number;
  ascendMinDe: number;

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
  /** 结局四型各一段 */
  endings: Record<EndingType, string>;
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
  text: string;
}
