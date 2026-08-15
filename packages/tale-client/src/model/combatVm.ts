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
  FORGE_SLOTS,
  combatPreview,
  recommendCombatAct,
  type BodyPart,
  type CombatAct,
  type CombatPreview,
  type CombatSkillCost,
  type CombatSkillPreview,
  type ClashState,
  type DamageRange,
  type EnemyDef,
  type ForgedSkill,
  type Stance,
  type TaleContent,
  type TaleState,
  clashOf,
} from "@shiling/tale-sim";
import { initiativeText } from "./beatVm.js";
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
  group: "bite" | "stance" | "skill" | "finisher" | "flee";
  /**
   * [S1 → M2-B2] 这一手的出处 —— 界面据它换印章与配色。
   *
   * `organ` 器官技（金印「技」）／`forged` 自己凝成的（朱砂「凝」）／`lore` 循古法习得的
   * （朱砂「古」）。玩家花了精气与一个槽换来的一手，若在按钮排里与白拿的器官技长得一样，
   * 凝招那一屏的所有决定在战斗屏上就消失了 —— 这是 S1「异」印那条的同一个理由。
   */
  origin: "organ" | "forged" | "lore";
}

export interface CombatVm {
  enemyName: string;
  enemyDesc: string;
  enemyTags: string[];
  /**
   * [S3] 「已入图鉴」的常驻小牌 —— 花血统点参透过这一头，所以这一场读得出它的意图。
   *
   * 与 `intentKnown` 分开一位：那一位说「读不读得出」，这一位说**凭什么**读得出。
   * 三个来源（器官／明识这一段／历代所记）在屏幕上是三句不同的话。
   */
  enemyLoreBadge: string | null;
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
  /**
   * [交锋节奏] **这一合谁先动** —— 出手之前就摆在屏上。
   *
   * 它不是一枚装饰徽章：受伤那几个数（咬完它能打我多少、换姿态这一合少挨多少、
   * 咬腿拦不拦得住）全都跟着它翻面，所以玩家必须先读到这一条，那几颗按钮上的账
   * 才读得懂。三个字段分开是因为屏幕上它们各占一格：印（谁）／标题（先手在谁）／
   * 依据（两个可以直接比的数）。
   */
  initiativeSide: "player" | "enemy";
  initiativeLabel: string;
  initiativeDetail: string;
  /** 场上生效的状态：「它半盲 2 合」「它迟滞 1 合」「护体 1 合」 */
  marks: string[];
  /** 「还撑得住约 3 合 · 它还需 4 下」—— 「什么时候该逃」的依据 */
  outlook: string;
  /** 撑不住两合了 */
  outlookHot: boolean;
  /** 引擎累积的回合日志（战斗结束那一刻 clashOf(state) 会被置 null，届时由调用方保留副本） */
  log: string[];
  actions: CombatActionVm[];
}

const PART_ACT: Record<BodyPart, { glyph: string; label: string; hint: string }> = {
  throat: { glyph: "喉", label: "咬喉", hint: "伤最重，收官的一口。" },
  leg: { glyph: "腿", label: "咬腿", hint: "伤轻，但它会慢下来 —— 也走不掉。" },
  eye: { glyph: "眼", label: "扑眼", hint: "几乎不伤，但它会有几合看不见你。" },
};

/**
 * [M2-B1] 部位伤在按钮上的一字读法（「腿伤 1 → 2」）。
 *
 * [M2-B3] 腿那一枚现在**跟着兽换**（`preview.partNames`，见 `EnemyDef.legWord`）：
 * 一条长着鸟翼的鱼没有「腿伤」。喉与眼对所有兽都是同一个字，所以这张表里那两个照旧。
 */
const WOUND_ZI: Record<BodyPart, string> = { throat: "喉", leg: "腿", eye: "眼" };

/** [M2-B3] 这一头兽的一字读法（腿走 `partNames`，其余照 `WOUND_ZI`）。 */
function woundZi(part: BodyPart, partNames: Record<BodyPart, string>): string {
  return part === "leg" ? partNames.leg : WOUND_ZI[part];
}

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
  // [S3] 「或以血统参透此兽」——读不出来的那一行要说得出**两条**出路（这一世长器官／历代攒知识），
  // 否则一个奔跨世积累的玩家永远不知道图鉴知识治的就是这一行
  act: "看得出它要出手，但看不出是虚是实 —— 灵犀、夜瞳之类的器官才读得清，或以血统参透此兽。",
  hold: "它没有要动的样子。是在守，还是要走？读不出来 —— 灵犀、夜瞳之类的器官才读得清，或以血统参透此兽。",
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
    case "finisher":
      return "finisher";
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
function skillEffectText(
  skill: CombatSkillPreview,
  /** [M2-B3] 这一头兽的部位说法（「断其翼根」而不是「断其后腿」） */
  partNames: Record<BodyPart, string>,
): string {
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
  // [M2-B2] 断伤：凝招力道槽那一件顺带断的部位（整场累积，与咬击那三颗共用一条线）
  if (skill.woundPart) parts.push(`断其${partNames[skill.woundPart]}`);
  parts.push(`冷却 ${skill.cooldown} 合`);
  // [M2-B1] 势是第三样价钱，与冷却、代价并排 —— 三样都写清才知道「现在按还是攒两合」
  if (skill.momentumCost > 0) parts.push(`耗势 ${skill.momentumCost}`);
  if (skill.cost) parts.push(costText(skill.cost));
  return parts.join(" · ");
}

/**
 * [M2-B2] 招式册那一手的出处行。
 *
 * 自拟招念三件部件 ＋ 凝成时已付的账；古法念它自己的描述（那是「情理之中」的一半）。
 */
function forgedFlavor(forged: ForgedSkill, content: TaleContent): string {
  if (forged.parts === null) return forged.skill.desc;
  const names = FORGE_SLOTS.map(
    (slot) => content.parts.find((part) => part.id === forged.parts?.[slot])?.name ?? "？",
  );
  return `${names.join("·")} —— 已付 ${ESSENCE_LABELS[forged.cost.essenceType]}精气 ${forged.cost.essence}`;
}

export function buildCombatVm(
  state: TaleState,
  combat: ClashState,
  content: TaleContent,
): CombatVm {
  const enemyId = state.encounter?.enemyId ?? "";
  const enemy: EnemyDef | undefined = content.enemies.find(
    (candidate) => candidate.id === enemyId,
  );
  const preview = combatPreview(state, content);
  const enemyHpMax = enemy?.hp ?? Math.max(1, combat.enemyHp);
  // [M2-B1] 血上限来自引擎（体 × combatHpPerTi），界面不再把 `stats.ti` 当血上限用
  const playerHpMax = Math.max(1, preview.playerHpMax);
  const known = preview.intentKnown;
  const recommended = recommendCombatActId(preview);

  const bites: CombatActionVm[] = preview.bites.map((bite) => {
    const meta = PART_ACT[bite.part];
    const parts = [`伤 ${damageText(bite.damage)}`];
    /*
     * [M2-B1] 附带那一栏从「它盲 2 合」换成**这一咬留下的第几层伤**。
     *
     * 分别不只是措辞：M1-P2 那两句说的是「买两个回合」，而现在说的是「这条线经营到哪一步」。
     * 满了就明说满了 —— 那正是「该换回收官」的信号（没有它，玩家会一直咬同一处）。
     */
    if (bite.woundLands) parts.push(`${woundZi(bite.part, preview.partNames)}伤 ${bite.woundStacks} → ${bite.woundStacks + 1}`);
    else if (bite.woundStacks > 0) parts.push(`${woundZi(bite.part, preview.partNames)}伤已满 ${bite.woundStacks}`);
    parts.push(`势 +${bite.momentumGain}`);
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
      warning: bite.weakPoint
        ? `破绽在此：伤 ×1.6，护也护不住。`
        : bite.stopsFlee
          ? "拦住它 —— 不然这顿肉就没了。"
          : bite.guarded
            ? `它正护着${preview.partNames[bite.part]}：伤减半${
                bite.counterChance > 0
                  ? `，${chanceCn(bite.counterChance)}会被反咬（${damageText(bite.counterDamage)}）`
                  : ""
              }`
            : null,
      highlight: recommended === `bite:${bite.part}`,
      enabled: true,
      disabledReason: null,
      group: "bite",
      origin: "organ",
      flavor: null,
    };
  });

  /*
   * [M2-B1] 决杀：势的兑现按钮。**攒不够时照样出按钮**（灰着，写明还差几点）——
   * 一个看不见的目标不会有人去攒，而这一颗正是「出招节奏」这件事在屏幕上的样子。
   *
   * [M2-B3] 够门槛之后还要分「**满没满**」两态。B3 把势的上限做成了灵性 build 的主要回报
   * （上限越高，同一记决杀越重），于是「现在发还是再攒一合」第一次成了一道真的题 ——
   * 而这一颗按钮原来在 4 点与 12 点上写的是同一句话。code-reviewer 抓到的正是这一处：
   * `atMax` 在引擎里算出来了、推荐链也用了，却没有一个字上屏。
   * 满了那一态明写「势已满 —— 再攒是白攒」（溢出的部分直接丢掉，这是玩家该知道的事实）。
   */
  const finisherVm: CombatActionVm = {
    id: "finisher",
    act: { kind: "finisher" },
    glyph: "决",
    label: "决杀",
    effect: preview.finisher.ready
      ? `伤 ${damageText(preview.finisher.damage)} · 耗尽全部势（${preview.finisher.momentumCost}）· 无视守备`
      : `攒够 ${preview.finisher.momentumNeeded} 点势可发 · 势越多这一记越重 · 无视守备`,
    warning: !preview.finisher.ready
      ? null
      : preview.finisher.atMax
        ? "势已满 —— 再攒是白攒。发完从零攒起。"
        : "再攒一合这一记更重（上限之内）。发完从零攒起。",
    highlight: recommended === "finisher",
    enabled: preview.finisher.ready,
    disabledReason: preview.finisher.ready
      ? null
      : `还差 ${preview.finisher.momentumNeeded - preview.momentum} 点势`,
    group: "finisher",
    origin: "organ",
    flavor: null,
  };

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
        origin: "organ",
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
    glyph: skill.forged === null ? "技" : skill.forged.loreId === null ? "凝" : "古",
    label: skill.name,
    effect: skillEffectText(skill, preview.partNames),
    warning: null,
    /*
     * [M2-B2] 招式册里的那几手多一行它的出处：
     * 自拟招写**三件部件与已付的精气**（「齿·鬃·毒 —— 已付 猛精气 18」），
     * 古法写它自己那句描述。凝招那一屏花掉的东西必须在战斗屏上读得回来，
     * 否则玩家下一次不会再去凝（同 S1 组合技那一行风味的理由）。
     */
    flavor: skill.forged === null ? null : forgedFlavor(skill.forged, content),
    highlight: recommended === `skill:${skill.skillId}`,
    enabled: skill.ready,
    /*
     * 不可用的**原因**三选一，顺序按「多快能解决」排：冷却（下一合就好）→ 势（打几合就攒到）
     * → 精气／血（这一架里等不到，得先去猎）。三者对玩家的下一步是完全不同的指示。
     */
    disabledReason:
      skill.cooldownLeft > 0
        ? `还需 ${skill.cooldownLeft} 合`
        : !skill.hasMomentum
          ? `势不足（需 ${skill.momentumCost}）`
          : skill.affordable || !skill.cost
            ? null
            : skill.cost.kind === "hp"
              ? `血不够（需 ${skill.cost.amount}）`
              : `${ESSENCE_LABELS[skill.cost.type]}精气不足（需 ${skill.cost.amount}）`,
    group: "skill",
    origin: skill.forged === null ? "organ" : skill.forged.loreId === null ? "forged" : "lore",
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
    origin: "organ",
    flavor: null,
  };

  const marks: string[] = [];
  if (preview.stageName) marks.push(preview.stageName);
  if (preview.blind > 0) marks.push(`它半盲 ${preview.blind} 合`);
  if (preview.slow > 0) marks.push(`它迟滞 ${preview.slow} 合`);
  if (preview.ward > 0) marks.push(`护体 ${preview.ward} 合`);
  // [S1] 三个新计数器同样要上屏：看不见的状态等于不存在（同 P1 四量那条纪律）
  if (preview.bleed > 0) marks.push(`它流血 ${preview.bleed} 合`);
  if (preview.thorns > 0) marks.push(`反刺 ${preview.thorns} 合`);
  if (preview.insight > 0) marks.push(`明识 ${preview.insight} 合`);
  /*
   * [交锋节奏] 硬受也要上屏（同上面那五枚：看不见的状态等于不存在）。
   *
   * 它与那五枚的分别在于**它不是按合数走的**：挡下一记就消耗掉。所以这一枚写的是
   * 「挡下它下一记」而不是「硬受 1 合」—— 后者会让玩家以为这一合它打两下也都免。
   */
  if (preview.brace > 0) marks.push("硬受 · 挡下它下一记");

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
    enemyName: enemy?.name ?? enemyId,
    enemyDesc: enemy?.desc ?? "",
    enemyTags: enemy?.tags ?? [],
    enemyLoreBadge: preview.loreKnown ? "已入图鉴" : null,
    enemyPortrait: enemy ? { kind: "image", src: enemyArt(enemy), aspect: "1 / 1" } : null,
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
    guardLabel: `护 ${preview.partNames[preview.guardPart]}`,
    intentLabel: known ? preview.intent.text : INTENT_CLASS_LABEL[preview.intentClass],
    intentDetail: intentDetail ?? INTENT_CLASS_HINT[preview.intentClass],
    // eslint 之外的自我提醒：上面那个 ?? 只在 known 为假时落到 HINT，两支都非空
    intentKnown: known,
    intentHot: known
      ? preview.intent.kind === "pounce" || preview.intent.kind === "flee"
      : preview.intentClass === "act",
    stanceLabel: STANCE_META[preview.stance].label,
    initiativeSide: preview.initiative.first,
    ...initiativeText(preview.initiative, preview.partNames.leg),
    marks,
    outlook: `还撑得住约 ${preview.roundsToLive} 合 · 它还需 ${preview.roundsToKill} 下`,
    outlookHot: preview.roundsToLive <= 2,
    log: state.encounter?.log ?? [],
    actions: [...bites, finisherVm, ...stances, ...skills, flee],
  };
}
