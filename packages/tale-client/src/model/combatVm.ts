/**
 * 搏杀屏视图模型（纯）。
 *
 * ## 这一层唯一的职责：把引擎给的数**如实**摆到玩家眼前
 * 与追猎屏同一条纪律（`stalkVm.ts`）：命中、伤害、反击概率、还撑得住几合，全部来自
 * `combatPreview`（引擎），界面**不复刻任何公式**。这里做的只有呈现决定 ——
 * 哪个数用汉字、哪一行标朱砂、警告写什么、以及**同一时刻只推荐一手**。
 *
 * ## 「读不出意图」时不许泄露意图（这一条最容易写错）
 * 洞察类器官（灵犀／夜瞳）给的是**知情权**：`preview.intentKnown` 为假时，界面只能给
 * 粗档「似要动手／按兵不动」。而 `incomingDamage`／`incomingAfter`／`incomingIfSwitch`
 * 这几个数**会反推出意图**（0 ＝ 它在守或要走，13 ＝ 重击），所以它们只在 `intentKnown`
 * 为真时才出现在屏幕上；否则改用倍率与定性说法。
 *
 * 于是「有没有洞察」在屏幕上是这样的差别：
 * - 有：「它压低身子，重心后坐 —— 这一顶会重」＋「预计受伤 11」＋ 每颗按钮的受伤账。
 * - 无：「似要动手」，你知道要挨打，但不知道多重、也分不出它是在守还是要走。
 * 这两件正是姿态与咬腿两个决定的前提 —— 信息本身就是器官奖励。
 *
 * ## [S1] 技能池：全部技摊在同一屏，每颗都摊开后果
 * `preview.skills` 现在是**池子**（器官技 ＋ 已凑齐的组合技），不再是「第一件带技器官」。
 * 每颗技能按钮上必须写清四件事：伤害区间／附带效果／冷却／**代价**，以及不可用时
 * 「为什么不可用」（还需几合 ＝ 等得到；精气不足 ＝ 这一架里等不到，得去猎）。
 * 没有预览的按钮就是翻牌 —— 这是追猎屏验过的铁律，技能池把它从 1 颗按钮扩到 5〜8 颗，
 * 铁律不打折。
 */

import {
  BODY_PART_NAMES,
  combatPreview,
  recommendCombatAct,
  type BodyPart,
  type CombatAct,
  type CombatPreview,
  type CombatSkillCost,
  type CombatSkillPreview,
  type CombatState,
  type DamageRange,
  type EnemyDef,
  type Stance,
  type TaleContent,
  type TaleState,
} from "@shiling/tale-sim";
import { ESSENCE_LABELS, SKILL_EFFECT_LABELS } from "./format.js";
import { enemyArt } from "../art/assets.js";
import { chanceCn as chanceCnOf, toPercent } from "./format.js";
import type { MediaAsset } from "./eventVm.js";

/**
 * 按钮 id ＝ 可放进 DOM 的字符串（`data-combat`）。
 *
 * 形如 `bite:throat`／`stance:low`／`skill:gou-chi`／`flee`。为什么不直接把 `CombatAct`
 * 塞进 DOM：E2E 与键盘要按 id 定位按钮，而 `CombatAct` 是对象。真正传给引擎的是
 * `CombatActionVm.act`（按钮自己带着），所以 id 只用于定位，不用于解析 —— **界面不做
 * 「id 字符串 → 指令」的反向解析**，那种解析迟早会与引擎的联合类型漂移。
 */
export type CombatActId = string;

export interface CombatActionVm {
  id: CombatActId;
  /** 真正要交给 `combatAct` 的指令 */
  act: CombatAct;
  /** 汉字印章 */
  glyph: string;
  label: string;
  /** 预期效果，如「伤 6±1 · 它护此处 → 减半 ＋ 五成反击」 */
  effect: string;
  /** 需要提醒的**后果**（咬腿能拦逃、打在守备处会被反咬、换姿态占一合）；无则 null */
  warning: string | null;
  /**
   * [S1] 风味一句（今天只有组合技有：它自己的描述）。
   *
   * 与 `warning` 分开是因为两者的语义不同：warning 是「按下去会有这个后果，注意」，
   * flavor 是「这一手是什么」。共用一个字段会让「有没有要提醒的事」变得没法判断
   * （code-reviewer 抓到的：同一套 `has-warn` 样式底下混了两种东西）。
   */
  flavor: string | null;
  /** 这一手是不是当前最该按的（金色呼吸） */
  highlight: boolean;
  enabled: boolean;
  disabledReason: string | null;
  group: "bite" | "stance" | "skill" | "flee";
  /**
   * [S1] 这一手是**组合技**（异变）—— 界面给它一枚朱砂「异」印。
   *
   * 玩家凑齐两件器官换来的一手，若在按钮排里与器官技长得一样，那次发现就白发现了。
   */
  synergy: boolean;
}

export interface CombatVm {
  enemyName: string;
  enemyDesc: string;
  enemyTags: string[];
  /**
   * 敌人头像（1:1 胸像）。内容库里查不到这个 id 时为 null —— 那是内容 bug，
   * 界面退回程序化占位，不去请求一个必然 404 的路径。
   */
  enemyPortrait: MediaAsset | null;
  enemyHp: number;
  enemyHpMax: number;
  enemyPercent: number;
  playerHp: number;
  playerHpMax: number;
  playerPercent: number;
  /** 玩家血量低于三成 → 界面转朱砂告急 */
  playerCritical: boolean;
  round: number;
  roundLabel: string;
  /** 「护 咽喉」—— 对谁都可见 */
  guardLabel: string;
  guardPart: BodyPart;
  /** 意图：读得出就是内容写的那句话，读不出只有粗档两字 */
  intentLabel: string;
  /**
   * 意图的第二行：读得出时是账（「重击 · 预计受伤 11」），读不出时是**为什么读不出**
   * （「是在守，还是要走？读不出来。」）。
   *
   * 不留空：P1 的第一条教训是「信息模糊是该有的 build 差异，信息无用不是」——
   * 一行空白只会让玩家以为界面坏了，一句「读不出来」才告诉他缺的是什么器官。
   */
  intentDetail: string;
  intentKnown: boolean;
  /** 重击或它要走 —— 界面转朱砂 */
  intentHot: boolean;
  /** 「正对」「伏低」「扑击」 */
  stanceLabel: string;
  /** 场上生效的状态：「它半盲 2 合」「它迟滞 1 合」「护体 1 合」 */
  marks: string[];
  /** 「还撑得住约 3 合 · 它还需 4 下」—— 「什么时候该逃」的依据 */
  outlook: string;
  /** 撑不住两合了 */
  outlookHot: boolean;
  /** 引擎累积的回合日志（战斗结束那一刻 state.combat 会被置 null，届时由调用方保留副本） */
  log: string[];
  actions: CombatActionVm[];
}

const PART_ACT: Record<BodyPart, { glyph: string; label: string; hint: string }> = {
  throat: { glyph: "喉", label: "咬喉", hint: "伤最重，收官的一口。" },
  leg: { glyph: "腿", label: "咬腿", hint: "伤轻，但它会慢下来 —— 也走不掉。" },
  eye: { glyph: "眼", label: "扑眼", hint: "几乎不伤，但它会有几合看不见你。" },
};

const STANCE_META: Record<Stance, { glyph: string; label: string }> = {
  low: { glyph: "伏", label: "伏低" },
  square: { glyph: "正", label: "正对" },
  lunge: { glyph: "扑", label: "扑击" },
};

/** 意图的粗档读法（没有洞察类器官时，这是屏幕上关于它的全部）。 */
const INTENT_CLASS_LABEL = {
  act: "似要动手",
  hold: "按兵不动",
} as const;

const INTENT_CLASS_HINT = {
  act: "看得出它要出手，但看不出是虚是实 —— 灵犀、夜瞳之类的器官才读得清。",
  hold: "它没有要动的样子。是在守，还是要走？读不出来。",
} as const;

const INTENT_KIND_TAG = {
  pounce: "重击",
  bite: "出手",
  guard: "守势",
  flee: "要走",
} as const;

/**
 * 「五成」「三成五」—— 读法在 `format.chanceCn` 里只有一份（追猎屏、搏杀屏、属性详情共用）。
 *
 * 这里只指定 0 的说法：搏杀屏的「招反击」写「无」比「〇成」短且更像话。
 */
function chanceCn(chance: number): string {
  return chanceCnOf(chance, "无");
}

/**
 * 「6」或「5〜7」—— 有跨度就把**真实两端**写出来（预览不骗人）。
 *
 * 早先写的是「中值 ± 抖动」，而抖动加在乘倍率之前、取整在乘倍率之后 —— 那个 ± 算出来
 * 是假的（低倍率的按钮上会出现「伤 1」而真跑打 2）。区间由引擎按同一条算式给出，
 * 界面只负责念。
 */
function damageText(range: DamageRange): string {
  return range.min === range.max ? String(range.mid) : `${range.min}〜${range.max}`;
}

/** 按钮 id：`CombatAct` → `data-combat` 字符串。**唯一一处**做这个映射，反向解析不存在。 */
export function combatActId(act: CombatAct): CombatActId {
  switch (act.kind) {
    case "bite":
      return `bite:${act.part}`;
    case "stance":
      return `stance:${act.to}`;
    case "skill":
      return `skill:${act.skillId}`;
    case "flee":
      return "flee";
  }
}

/**
 * 界面推荐的那一手 —— **同一时刻只推荐一手**（P1 踩过的坑：两颗按钮同时发金光等于没有推荐）。
 *
 * ## [S1] 链本身搬到了 tale-sim
 * 它此前住在这里，于是同一条链在三处各有一份手抄镜像（这里／`tale-content` 冒烟／
 * `packages/gen` 实验台）—— P2 报告的遗留第 5 条。S1 把技能池从 1 颗扩到 5〜8 颗、
 * 链从 9 条长到 11 条，手抄的漂移就从「风险」变成「必然」，而漂移的后果是**实验台量的
 * 打法与玩家屏幕上金光指的那一手不是同一个**（我自己的平衡数据会说谎）。
 *
 * 所以链上提到 `recommendCombatAct`（tale-sim，纯函数、只吃 `CombatPreview`、引擎自己不
 * 消费）。这里只剩一件事：把它返回的 `CombatAct` 翻成按钮 id。呈现层的决定仍在呈现层 ——
 * 变的只是「这段代码住在哪个包」。
 */
export function recommendCombatActId(preview: CombatPreview): CombatActId {
  return combatActId(recommendCombatAct(preview));
}

/** [S1] 代价读法：「自伤 3」「鳞之精气 8」。付不起时按钮上还要说清缺哪一样。 */
function costText(cost: CombatSkillCost): string {
  return cost.kind === "hp" ? `自伤 ${cost.amount}` : `${ESSENCE_LABELS[cost.type]}精气 ${cost.amount}`;
}

/**
 * 一颗技能按钮的文案。
 *
 * 顺序刻意是「伤害 → 附带 → 冷却 → 代价」：前两项是收益，后两项是价钱。
 * 四项**恒在**（哪怕是 0 伤的纯效果技也写清它不出伤），因为这排按钮有五到八颗，
 * 少写一项就得靠玩家记住哪颗技是什么 —— 那正是「摸不着头脑」的来源。
 */
function skillEffectText(skill: CombatSkillPreview): string {
  /*
   * 伤害那一格**恒有**：出伤就报区间，不出伤就明说「不出伤」。
   *
   * 先前是「不出伤时省掉这一格」，实测（自己的单测）抓到的后果是：一颗写着
   * 「明识·数合读得出它的意图 · 冷却 3 合 · 鳞精气 8」的按钮，玩家读不出它到底顺带
   * 咬不咬一口 —— 而那正好决定「要不要在它血剩一口的时候按它」。省一个词换来一次歧义。
   */
  const parts: string[] = [
    skill.damage.mid > 0 ? `伤 ${damageText(skill.damage)}` : "不出伤",
  ];
  for (const effect of skill.effects) parts.push(SKILL_EFFECT_LABELS[effect]);
  parts.push(`冷却 ${skill.cooldown} 合`);
  if (skill.cost) parts.push(costText(skill.cost));
  return parts.join(" · ");
}

export function buildCombatVm(
  state: TaleState,
  combat: CombatState,
  content: TaleContent,
): CombatVm {
  const enemy: EnemyDef | undefined = content.enemies.find(
    (candidate) => candidate.id === combat.enemyId,
  );
  const preview = combatPreview(state, content);
  const enemyHpMax = enemy?.hp ?? Math.max(1, combat.enemyHp);
  const playerHpMax = Math.max(1, state.stats.ti);
  const known = preview.intentKnown;
  const recommended = recommendCombatActId(preview);

  const bites: CombatActionVm[] = preview.bites.map((bite) => {
    const meta = PART_ACT[bite.part];
    const parts = [`伤 ${damageText(bite.damage)}`];
    if (bite.rider === "slow") parts.push(`它迟滞 ${bite.riderRounds} 合`);
    if (bite.rider === "blind") parts.push(`它盲 ${bite.riderRounds} 合`);
    /*
     * 受伤那一栏只在读得出意图时给数 —— 给了就等于把意图告诉玩家（0 ＝ 它在守或要走）。
     * 读不出时改说定性的那半句，仍然有用：「它会看不见你」这件事与意图无关。
     */
    if (known) {
      if (bite.incomingAfterMissChance > 0) {
        parts.push(`它这下 ${chanceCn(bite.incomingAfterMissChance)}打空`);
      }
      parts.push(`受伤 ${damageText(bite.incomingAfter)}`);
    } else if (bite.incomingAfterMissChance > 0) {
      parts.push(`它这下多半打空`);
    }
    return {
      id: `bite:${bite.part}`,
      act: { kind: "bite", part: bite.part },
      glyph: meta.glyph,
      label: meta.label,
      effect: parts.join(" · "),
      warning: bite.stopsFlee
        ? "拦住它 —— 不然这顿肉就没了。"
        : bite.guarded
          ? `它正护着${BODY_PART_NAMES[bite.part]}：伤减半${
              bite.counterChance > 0
                ? `，${chanceCn(bite.counterChance)}会被反咬（${damageText(bite.counterDamage)}）`
                : ""
            }`
          : null,
      highlight: recommended === `bite:${bite.part}`,
      enabled: true,
      disabledReason: null,
      group: "bite",
      synergy: false,
      flavor: null,
    };
  });

  /*
   * 当前姿态**不出按钮**：换成已在的姿态只是白费一回合，引擎那边直接抛错。
   * 这与追猎屏「已在上风时那颗按钮写明这一息是白费的」是同一条纪律的两种落法 ——
   * 那边是一颗常在的按钮，这边少一颗按钮反而更省一次误点（搏杀屏按钮本来就多）。
   */
  const stances: CombatActionVm[] = preview.stances
    .filter((item) => !item.current)
    .map((item) => {
      const meta = STANCE_META[item.to];
      const parts = [`出伤 ×${item.outMul}`, `受伤 ×${item.inMul}`];
      if (known) parts.push(`这合受伤 ${damageText(item.incomingIfSwitch)}`);
      return {
        id: `stance:${item.to}`,
        act: { kind: "stance", to: item.to },
        glyph: meta.glyph,
        label: meta.label,
        effect: parts.join(" · "),
        warning: "换姿态占一合 —— 这一合不出手。",
        highlight: recommended === `stance:${item.to}`,
        enabled: true,
        disabledReason: null,
        group: "stance",
        synergy: false,
        flavor: null,
      };
    });

  /*
   * [S1] 技能池：全部技（器官技 ＋ 组合技）平铺在同一排按钮里。
   *
   * 不可用时**说清是哪一种不可用**：「还需 2 合」等得到，「鳞精气不足 8」这一架里等不到
   * （得先去猎），两者对玩家的下一步是完全不同的指示。冷却与代价同时缺时先报冷却
   * （它是马上会变的那一个）。
   */
  const skills: CombatActionVm[] = preview.skills.map((skill) => ({
    id: `skill:${skill.skillId}`,
    act: { kind: "skill", skillId: skill.skillId },
    glyph: skill.synergyId === null ? "技" : "异",
    label: skill.name,
    effect: skillEffectText(skill),
    warning: null,
    // 组合技多一行它自己的描述（「咬住不松，把腺里的东西全挤进伤口」）—— 那次发现值得被记住
    flavor: skill.synergyId === null ? null : skill.desc,
    highlight: recommended === `skill:${skill.skillId}`,
    enabled: skill.ready,
    disabledReason:
      skill.cooldownLeft > 0
        ? `还需 ${skill.cooldownLeft} 合`
        : skill.affordable || !skill.cost
          ? null
          : skill.cost.kind === "hp"
            ? `血不够（需 ${skill.cost.amount}）`
            : `${ESSENCE_LABELS[skill.cost.type]}精气不足（需 ${skill.cost.amount}）`,
    group: "skill",
    synergy: skill.synergyId !== null,
  }));

  const flee: CombatActionVm = {
    id: "flee",
    act: { kind: "flee" },
    glyph: "遁",
    label: "遁走",
    effect: `成 ${chanceCn(preview.fleeChance)}${preview.blind > 0 ? " · 它半盲，好走" : ""}`,
    warning: "走得脱也吃不到 —— 精气与饱食都没有。",
    highlight: recommended === "flee",
    enabled: true,
    disabledReason: null,
    group: "flee",
    synergy: false,
    flavor: null,
  };

  const marks: string[] = [];
  if (preview.blind > 0) marks.push(`它半盲 ${preview.blind} 合`);
  if (preview.slow > 0) marks.push(`它迟滞 ${preview.slow} 合`);
  if (preview.ward > 0) marks.push(`护体 ${preview.ward} 合`);
  // [S1] 三个新计数器同样要上屏：看不见的状态等于不存在（同 P1 四量那条纪律）
  if (preview.bleed > 0) marks.push(`它流血 ${preview.bleed} 合`);
  if (preview.thorns > 0) marks.push(`反刺 ${preview.thorns} 合`);
  if (preview.insight > 0) marks.push(`明识 ${preview.insight} 合`);

  const intentDetail = known
    ? [
        INTENT_KIND_TAG[preview.intent.kind],
        preview.incomingDamage.mid > 0 ? `预计受伤 ${damageText(preview.incomingDamage)}` : "这合不出手",
        preview.incomingMissChance > 0 ? `${chanceCn(preview.incomingMissChance)}打空` : null,
      ]
        .filter((part): part is string => part !== null)
        .join(" · ")
    : null;

  return {
    enemyName: enemy?.name ?? combat.enemyId,
    enemyDesc: enemy?.desc ?? "",
    enemyTags: enemy?.tags ?? [],
    enemyPortrait: enemy ? { kind: "image", src: enemyArt(enemy.id), aspect: "1 / 1" } : null,
    enemyHp: Math.max(0, combat.enemyHp),
    enemyHpMax,
    enemyPercent: toPercent(combat.enemyHp / enemyHpMax),
    playerHp: Math.max(0, combat.playerHp),
    playerHpMax,
    playerPercent: toPercent(combat.playerHp / playerHpMax),
    playerCritical: combat.playerHp / playerHpMax < 0.3,
    round: combat.round,
    roundLabel: `第 ${combat.round + 1} 合`,
    guardPart: preview.guardPart,
    guardLabel: `护 ${BODY_PART_NAMES[preview.guardPart]}`,
    intentLabel: known ? preview.intent.text : INTENT_CLASS_LABEL[preview.intentClass],
    intentDetail: intentDetail ?? INTENT_CLASS_HINT[preview.intentClass],
    // eslint 之外的自我提醒：上面那个 ?? 只在 known 为假时落到 HINT，两支都非空
    intentKnown: known,
    intentHot: known
      ? preview.intent.kind === "pounce" || preview.intent.kind === "flee"
      : preview.intentClass === "act",
    stanceLabel: STANCE_META[preview.stance].label,
    marks,
    outlook: `还撑得住约 ${preview.roundsToLive} 合 · 它还需 ${preview.roundsToKill} 下`,
    outlookHot: preview.roundsToLive <= 2,
    log: combat.log,
    actions: [...bites, ...stances, ...skills, flee],
  };
}
