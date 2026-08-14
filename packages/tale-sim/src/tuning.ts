import type { TaleTuning } from "./types.js";

/**
 * 计划「数值基线」表的落地初值。
 *
 * 归属说明：`tuning` 按计划归 tale-content 提供（`TALE_CONTENT.tuning`），这里给的是
 * **基线常量**，让 B2 直接 `{ ...BASELINE_TUNING, huntPreyIds: [...] }` 而不必从计划
 * 文档里手抄数字（抄一次就会漂移一次）。B4 平衡粗校时改 B2 的覆写值，或直接改这里。
 *
 * `huntPreyIds` 引用 EnemyDef.id，基线无法预知内容 id，故留空 —— **B2 必须填**。
 * 留空不会静默失效：第一次狩猎就会抛错（空猎物表＝狩猎永久失效＝每一世饿死，
 * 这种内容 bug 宁可当场吵）。
 */
export const BASELINE_TUNING: TaleTuning = {
  // 出生：meng 10／ling 10／ti 20／de 5，lifespanMax = 16 + floor(ti/10)
  initialStats: { meng: 10, ling: 10, ti: 20, de: 5 },
  lifespanBase: 16,
  lifespanTiDivisor: 10,

  // 饱食：初始 60／上限 100，每季 −12，冬季额外 −6
  hungerInit: 60,
  hungerMax: 100,
  hungerPerSeason: 12,
  winterHungerExtra: 6,

  // 蜕变：阈值 60，候选 3
  moltThreshold: 60,
  moltCandidateCount: 3,

  // 行动
  huntHunterTag: "hunter",
  huntPreyIds: [],
  huntFoodGain: 26,

  /*
   * [饥饿节奏批 2026-08-14] 食余与速猎 —— owner 的原话是「饿得太快，要经常点击狩猎」。
   *
   * 病因是两批各自正确的改动叠出来的：M1-P1 把狩猎做成 4〜5 次点击的追猎屏，S2 给探索加了
   * 路费（险地 +6／绝境 +12）。于是一次得手（+32，净 +20）连一趟绝境（−24）都付不起，
   * 而它要花五次点击 —— 狩猎退化成补给苦工。
   *
   * 两条药都下在**收益端**（正本要求：优先动收益而非消耗，保住「食」这个主题，
   * 也别把 S2 的路费体系调没）：
   *
   * 1. `huntSurplusSeasons`／`huntSurplusGain` ＝ 一次得手管更久（一头岩羊 ≈ 拖回去吃四季）。
   * 2. `quickHunt*` ＝ 一次点击的快路径，收益打折、**不留食余、不给全额精气**。
   *
   * 实测校准见 `tale-content/src/tuning.ts` 的覆写小节（复算：
   * `pnpm -C packages/gen balance --lives 500 --profile wayseek`，看「点击账」那一行）。
   */
  huntSurplusSeasons: 2,
  huntSurplusGain: 8,
  quickHuntChance: 0.78,
  quickHuntPerMeng: 0.004,
  quickHuntFoodMul: 0.6,
  quickHuntEssenceMul: 0.6,

  restHungerGain: 10,
  restHealFlags: [],
  eventChanceBase: 0.35,
  exploreEventBonus: 2,

  /*
   * 探索去处的三档风险（S2）。三列各自单调，且**每一列的差都要玩家读得出来**
   * （按钮上写的就是这三个数换算成的话），所以刻意拉开而不是微调：
   *
   * | 档 | 遇袭（无事时） | 路费（饱食） | 事件乘子 | 读起来是 |
   * |---|---|---|---|---|
   * | calm 常路 | 0.03 | 0 | 1.0 | 兽径：走惯了，出不了大事也没什么好东西 |
   * | wary 险地 | 0.18 | 6 | 1.15 | 幽潭／险峰／古祠：值得跑一趟 |
   * | grim 绝境 | 0.32 | 12 | 1.3 | 秘窟／焦原：三次里有一次要打一架 |
   *
   * 遇袭那一档看着高，但它是**条件概率**（先要没抽中事件）—— 绝境的 `eventMul` 又把
   * 「没抽中」压低，实际每季遇袭率约 0.32 × (1 − 0.35×2×1.3) ≈ 0.03〜0.1（受天时影响）。
   *
   * `calm` 的 0.03 是**隔离实验调下来的**（初值 0.06）：把它设成 0 再跑同一批 500 世
   * `cautious`，「活过 8 岁」差 1.8 个百分点 —— 兽径唯一的兽是草狐（meng 14），
   * 对一两岁的幼兽是致命的，而兽径的身份恰恰是「出不了大事」。
   * 复算工具：`pnpm -C packages/gen balance --lives 500 --profile cautious`。
   */
  explorePeril: {
    calm: { ambushChance: 0.03, travelCost: 0, eventMul: 1 },
    wary: { ambushChance: 0.18, travelCost: 6, eventMul: 1.15 },
    grim: { ambushChance: 0.32, travelCost: 12, eventMul: 1.3 },
  },

  /*
   * 追猎（M1-P1）。这组数被三条**手感**约束钉住，不是随手写的。**复算工具**：
   * `pnpm -C packages/gen balance -- --lab --lives 400`（追猎实验台：按打法×风向×build 拆表，
   * 末尾五条判据就是下面这三条的可执行版；括号里的数是它 400 场/格的实测值）：
   *
   * 1. 逆风稳扎稳打（绕风 → 潜行到贴身 → 扑）得手 **≥0.60**（实测 0.743，出手时均命中 0.73）。
   * 2. 顺风硬冲（不绕风、连潜到底）得手 **≤0.45**（实测 0.317，其中 0.52 是猎物直接跑掉）。
   * 3. 屏息一次值 **+0.096 命中率**（12 点警觉 × 0.008）；它是**补救**工具而非常规步骤 ——
   *    在顺风打坏的接近里值 +0.12 得手率（实测 0.317 → 0.439），在顺利的局面里几乎没收益。
   */
  stalkStartDistance: 34,
  stalkStartDistanceJitter: 4,
  stalkStartAlert: 15,
  stalkAlertBonus: 0,
  stalkStartAlertJitter: 3,
  stalkStamina: 6,
  stalkLoseDistance: 46,
  stalkAlertMax: 100,

  stalkCreepDistance: 12,
  stalkCreepSwiftBonus: 5,
  stalkSwiftTag: "swift",
  stalkCreepAlert: 8,
  stalkNearDistance: 16,
  stalkNearAlertMul: 2,
  stalkQuietAlertMul: 0.6,
  stalkWindAlertMul: { into: 0.5, cross: 1, with: 2 },
  stalkCircleAlert: 3,
  stalkWaitAlertDrop: 12,
  stalkWaitMoveChance: 0.3,
  stalkWaitMoveAwayChance: 0.55,
  stalkWaitMoveMin: 4,
  stalkWaitMoveMax: 10,

  stalkPounceBase: 0.95,
  stalkPouncePerDistance: 0.035,
  stalkPouncePerAlert: 0.008,
  stalkPouncePerMeng: 0.004,

  stalkAlertTags: ["night-eye", "insight"],
  stalkWindTags: ["night-eye", "insight", "far-sight"],
  stalkVenomTag: "venom",
  stalkVenomHpMul: 0.7,

  // 战斗：伤害 3 + floor(meng/8) ±1
  combatDamageBase: 3,
  combatDamageMengDivisor: 8,
  combatDamageJitter: 1,
  combatWinHungerGain: 18,
  // [M2-B1] 一头打赢的兽也是几季的口粮（尸体没有拖回穴里那么完整，所以打个七折）
  combatWinSurplusMul: 0.7,
  combatWinEssenceMul: 1,
  fleeBase: 0.5,
  fleePerLingDiff: 0.005,
  fleeBiasFactor: 0.01,
  organSkillDamageMul: 2,
  minChance: 0.05,
  maxChance: 0.95,

  /*
   * 搏杀（M1-P2）。这一组数被三条**手感**约束钉住（复算：
   * `pnpm -C packages/gen balance -- --lab combat --lives 400`，末尾判据是它们的可执行版）：
   *
   * 1. 三个部位各有**自己赢**的局面 —— 没有一个部位在所有敌人上都最优。
   * 2. 「照屏幕金光打」不比手写的最优启发式差（同 P1：界面的推荐就该是当前最好的打法）。
   * 3. 读得出意图（洞察类器官）比读不出**明显**更强 —— 差在存活，不在伤害。
   *
   * 为什么咬腿／扑眼的伤害倍率压得这么低：它们换回来的是**跨回合的控制**（拦逃／致盲），
   * 若伤害也不差，咬喉就没有存在的理由。低伤是它们的价格。
   */
  combatBiteMul: { throat: 1.6, leg: 0.7, eye: 0.35 },
  combatGuardDamageMul: 0.5,
  combatGuardIntentMul: 0.5,
  combatGuardCounterChance: 0.5,
  combatCounterDamageMul: 1,
  combatStanceMul: {
    low: { out: 0.75, in: 0.7 },
    square: { out: 1, in: 1 },
    lunge: { out: 1.35, in: 1.25 },
  },
  // 扑 2.2 倍是刻意的：一次重击要**大到值得为它花一个回合换姿态**，否则姿态系统只是装饰
  combatIntentDamageMul: { pounce: 2.2, bite: 1, guard: 0, flee: 0 },
  combatIntentWeights: { pounce: 26, bite: 46, guard: 18, flee: 10 },
  combatFleeIntentHpRatio: 0.5,
  combatBlindRounds: 2,
  combatBlindMissChance: 0.55,
  combatBlindFleeBonus: 0.2,
  combatSlowRounds: 2,
  // 0.6 太强了：配上「扑被压低」，只会咬腿一手对岩羊就有 99.5% 胜率（实验台实测）
  combatSlowDamageMul: 0.75,
  combatSlowPounceMul: 0.5,
  combatWardRounds: 2,
  combatWardDamageMul: 0.5,
  combatSkillCooldown: 3,
  combatSkillHealAmount: 8,
  combatVenomSlowRounds: 3,

  /*
   * [S1] 四档新效果。三条持续类的**总量**刻意压在「一口咬喉上下」（咬喉一口 5〜7）：
   *   流血 3 合 × 2 ＝ 6；反刺 3 合 × 2 ＝ 6（且要它每合都命中才收满）。
   * 技不是「更强的咬」，是**在别的局面里更划算的咬** —— 若总量明显超过咬喉，
   * 技能池就会变成「谁转好了按谁」，三颗咬击又退化成装饰（同 M1-P2 咬腿那条教训）。
   *
   * 明识 3 合：够读完「宣告 → 应对 → 结算」两个完整回合，但读不完一整场架 ——
   * 它是**买一段知情权**，不是把洞察器官白送。
   */
  combatBleedRounds: 3,
  combatBleedDamage: 2,
  combatThornsRounds: 3,
  combatThornsDamage: 2,
  combatInsightRounds: 3,

  /*
   * [M2-B1] 势。一场架 5〜10 合，自涨 1／合、乘隙 +1、没挨伤 +1 —— 打得好的一场大约
   * 每合净涨 1.7 点，于是「攒两合发一记 2 点的技」与「攒四合发一记决杀」是两条真的能排
   * 出来的节奏，而不是「转好了就按」。上限 4＋floor(灵/18) 压着上界：灵 54 的化灵 build
   * 上限 7，猛系 build 通常只有 4〜5 —— 灵性 build 攒得起更大的一手，这是它的可见回报。
   *
   * 起手势 floor(灵/14)：一个灵 28 的 build 开场就有 2 点，够在第一合发一记控制技；
   * 被扑个正着（探索遇袭）扣 2 —— 那正是「它先动了手」在数值上的样子。
   */
  encounterMomentumBase: 4,
  encounterMomentumMaxPerLing: 18,
  encounterMomentumStartPerLing: 14,
  encounterAmbushMomentumPenalty: 2,
  // 接近阶段的成果结转：警觉压得越低（潜得越隐蔽）才失手，转交锋时手上越有势
  encounterApproachMomentumPerAlert: 26,
  encounterMomentumPerRound: 1,
  encounterMomentumOpenGuard: 1,
  encounterMomentumUnhurt: 1,
  encounterSkillMomentumCost: 2,
  /*
   * 决杀：4 点势起，倍率 1.4 + 0.22×势 —— 攒到 6 点是 2.72 倍，比咬喉（1.6）重七成，
   * 且**无视守备减伤**。它是「势」这一位存在的证明：一记攒出来的大招，而不是又一颗按钮。
   */
  encounterFinisherMomentum: 4,
  encounterFinisherMul: 1.4,
  encounterFinisherPerMomentum: 0.22,

  /*
   * [M2-B1] 部位伤整场累积。三层封顶是防「一手通吃」的闸门（M1-P2 实测：可无限续的迟滞
   * 让只咬腿一手对岩羊胜率 99.5%）。三层腿伤 ＝ 它出伤只剩 0.9³ ≈ 0.73、扑的权重只剩
   * 0.7³ ≈ 0.34，且**第一层就再也逃不掉**；三层眼伤 ＝ 它三成六打空，两层起不再反击。
   *
   * ⚠️ 这三个数**第一版开得太大**（0.86／0.65／0.2）：实验台实测把玄蟒（M1-P2 时 bare build
   * 只有 20% 胜率的那堵墙）推到 97.3%，因为「先堆满六层伤再收官」把它的出伤压到两成六 ——
   * 一条压倒性的通解。收到现在这一档之后玄蟒回到 85% 上下（它仍比 M1-P2 好打，那是
   * 「一场架 5〜10 合」这件事本身带来的：血更厚的双方给了玩家更多经营的余地）。
   * **咬喉不留伤** —— 那一档是爆发（×1.6），若它还白拿一条持续线，三颗咬击就又退化成
   * 「挑伤害最高那颗」。
   * 每一层都要一个回合去咬，而咬腿咬眼的伤害只有 0.7／0.35 —— 经营这两条线的价钱就是
   * 「这几合我没在放血」，于是「什么时候转回收官」才是一道题。
   */
  woundCap: 3,
  woundLegDamageMul: 0.9,
  woundLegPounceMul: 0.7,
  // 1 层就封死「逃」：M1-P2 的「咬腿拦逃」是全库最好读的一条机制，不该退化成「咬两口才拦得住」
  woundLegNoFleeAt: 1,
  woundEyeMissChance: 0.12,
  woundEyeNoCounterAt: 2,

  /*
   * [M2-B1] 弱点。三条识破路径的相对早晚是刻意的：图鉴知识（花过血统点的）开场就知道，
   * 灵性高的第 2 合看出来，谁都可以靠「咬中该处两次」试出来 —— 于是它既是**跨世积累**
   * 的兑现，也是**这一场**打得好的回报，还给不带任何洞察的 build 留了一条笨办法。
   */
  weaknessDamageMul: 1.6,
  weaknessRevealRounds: 4,
  weaknessRevealPerLing: 16,
  weaknessRevealHits: 2,

  /*
   * [M2-B1] 四属性的落点，逐条都上屏（客户端的「四相」盘）。
   *
   * 体 ×1.6 是把交锋血量从寿数公式里解耦出来的那一步：拉长回合数需要更厚的血，而
   * `lifespanMax = 16 + floor(ti/10)` 不该跟着动。体 26 → 42 血，正好扛得住 5〜10 合。
   * 每 14 点体减 1 点受伤：体 26 减 1、体 42 减 3 —— 数小是有意的，它是**看得见的**加成，
   * 不是隐形的免伤墙。
   *
   * 德此前在搏杀屏上一个字都读不到（只在事件门槛里）。三条落点合起来就是「气运」：
   * 闪避（整下躲开）、暴击、以及**凶兽也敬三分**（抬高它的退意权重）。德 44 的归山 build
   * ＝ 闪避 17.6%、暴击 8.8%、它的逃意翻倍 —— 一个德高的兽打架不靠硬，靠「它不太想跟你打」。
   *
   * **没有「敌人出伤倍率」这个旋钮**：中途试过（0.62〜1.0 各扫过一遍 500 世），到 1.0 时
   * 四条护栏与回合数分布与 0.9 几乎一样（战死 28.4% vs 26.2%、每场 6.2 vs 6.3 合）——
   * 也就是说「一场架 5〜10 合」这件事已经由**双方血量**决定完了（敌人 ×1.8、我方 ×1.6），
   * 那个倍率只是一个不影响结论的旋钮。留着它比删掉危险（下一个人会去调它，然后困惑于
   * 为什么护栏不动），所以删了。要调敌人的疼痛感，动 `combatIntentDamageMul` 或内容的 meng。
   */
  combatHpPerTi: 1.6,
  combatToughnessPerTi: 14,
  combatDodgePerDe: 0.004,
  combatDodgeMax: 0.3,
  combatCritPerDe: 0.002,
  combatCritMax: 0.25,
  combatCritMul: 1.5,
  combatEnemyFleePerDe: 0.02,

  // [S1] 血脉：一世产 3〜8 点血统，4 点 ≈ 一世能买一件；事件专属器官（龙涎）翻倍
  bloodlineBoonCost: 4,
  bloodlineBoonRareCost: 8,

  /*
   * [S3] 另外三类消费的价钱。定价依据（复算脚本：`pnpm -C packages/gen balance --lives 500`
   * 报表里的「平均血统点」那一行，`cautious` 实测 4.73／世）：
   *
   * - **图录** ＝ 2×门槛件数 ＋ 风险档（calm 1／wary 1／grim 2）：险峰 3、古祠 3、焦原 4、
   *   幽潭 5、秘窟 6；兽径无门槛，`chartCost` 恒返 0（不上货架 —— 一张走惯了的路的图卖不出钱）。
   *   数的依据是「一份图录 ≈ 一件血脉」：两者都是一世一次，且都在回答「这一世我要干什么」。
   * - **图鉴知识** ＝ 2 ＋ floor(猛/10)：野雉／文鳐／穴鼠 2、岩羊／草狐 3、山魈／玄蟒 4、
   *   穷奇幼崽 5，八头合计 **25 点**。永久，所以总量刻意做成「五世才买得完一半」。
   * - **世家印记** 每枚 4（见 `sigils.ts`，共四枚），上限 2 枚 ＝ **8 点**。
   *
   * 一次性消费合计 13（神种）＋ 25（知识）＋ 8（印记）＝ **46 点** ≈ 十世；
   * 之后每一世仍有「血脉 4〜8 ＋ 图录 3〜6」可花，且两者相加恒大于一世的产出 ——
   * 「血统点无处可花」这件事从此结构上不可能发生（S3 交付线第 4 条）。
   */
  bloodlineChartPerGate: 2,
  bloodlineChartPeril: { calm: 1, wary: 1, grim: 2 },
  bloodlineLoreBase: 2,
  bloodlineLoreMengDivisor: 10,
  /*
   * 印记上限 **2**（不是 3）—— 这个数是量出来的，不是拍的。完整实测表在 `sigils.ts` 头注：
   * `cautious` 画像不带印记的成道率是 **14.2%**（20000 世），而护栏是 ≤15% ——
   * 永久加成的总预算只有 **0.8 个点**。三枚 +1 要花掉 1.0 个点（15.3% ✗），
   * 两枚 +1 落在 0.1〜0.7（14.3〜14.9% ✓）。
   * ⚠️ 复核必须用 **20000 世**并把 C(n,2) **全对扫一遍**：4000 世的 se 是 0.56 个点，
   * 十对读数散在 14.4〜15.1，分不出真假（我们据此差点调错了一次「食」的数值）。
   */
  sigilCap: 2,

  combatIntentTags: ["insight", "night-eye"],

  /*
   * 四道门槛（2026-08-13）。基线值＝计划正本那张表，**实测校准归内容层**
   * （`tale-content/src/tuning.ts` 的覆写小节写了每一项为什么从基线挪开，及 500 世实测）。
   *
   * 三条道刻意共用同一批属性但要求不同的组合，这样「奔哪条道」才真的改变一世怎么过：
   * 登神要灵与德**同时**够（且尝过神兽），妖王要杀与猛，归山要寿与德，化灵要极高的灵
   * **加上**一世不杀 —— 最后这一条是唯一改变操作序列的（不能靠狩猎活着）。
   */
  wayShenLing: 60,
  wayShenDe: 40,
  wayYaowangLives: 20,
  wayYaowangMeng: 70,
  wayGuishanYear: 25,
  wayGuishanDe: 60,
  wayHualingLing: 90,
  wayDivineTag: "divine",
  // 成道的血统点按道分：越难、越改玩法的道给得越多（化灵最难，归山最稳）
  wayBloodline: { shen: 4, yaowang: 4, guishan: 3, hualing: 5 },

  chronicleMaxExcerpts: 8,
};
