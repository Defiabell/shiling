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
 */

import {
  BODY_PART_NAMES,
  combatPreview,
  type BodyPart,
  type DamageRange,
  type CombatAct,
  type CombatPreview,
  type CombatState,
  type EnemyDef,
  type Stance,
  type TaleContent,
  type TaleState,
} from "@shiling/tale-sim";
import { enemyArt } from "../art/assets.js";
import { toPercent } from "./format.js";
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
  /** 需要提醒的后果；无则 null */
  warning: string | null;
  /** 这一手是不是当前最该按的（金色呼吸） */
  highlight: boolean;
  enabled: boolean;
  disabledReason: string | null;
  group: "bite" | "stance" | "skill" | "flee";
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

/** 「五成」「三成五」——与 stalkVm 的 `chanceCn` 同一体例（那边是私有的，这里只需要整成档）。 */
const CN_DIGITS = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"] as const;
function chanceCn(chance: number): string {
  const tenths = Math.round(chance * 100);
  if (tenths >= 100) return "十成";
  if (tenths <= 0) return "无";
  const shi = Math.floor(tenths / 10);
  const yu = tenths % 10;
  const head = CN_DIGITS[shi] ?? "〇";
  return yu === 0 ? `${head}成` : `${head}成${CN_DIGITS[yu] ?? ""}`;
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

/**
 * 界面推荐的那一手 —— **同一时刻只推荐一手**（P1 踩过的坑：两颗按钮同时发金光等于没有推荐）。
 *
 * ## 这条链同时是「什么时候该逃」的答案
 * 它的第一版把逃排得很后（`roundsToLive <= 1`），200 世实测**战死率 33.5%**（M0 是 8.5%）
 * —— 因为「还能撑一合」的下一合往往是一记重击（扑是 2.2 倍），于是机器打手总是死在
 * 「再打一下就赢了」的幻觉里。这不是数值问题，是**推荐链在劝玩家送死**。改成
 * 「能一下打死就打，否则撑不过两合就走」。
 *
 * 优先级（每一条都有可见依据）：
 * 1. 这一下能打死它 → 打（逃掉＝没有精气，能赢就别走）。
 * 2. 撑不过两合且逃得掉 → 逃。
 * 3. 它要走（读不出意图时：粗档「按兵不动」也当它要走）→ 咬腿拦住。
 * 4. **它宣告了重击而它还看得见 → 扑眼**（致盲五成五让重击整个打空；读不出意图的 build
 *    做不到这一手，这就是洞察类器官的兑现）。
 * 5. 器官技好了 → 放（有冷却，早放早转）。
 * 6. 挨得凶而它还看得见 → 扑眼买两合。
 * 7. **是场长仗、而迟滞这一咬落得下来** → 咬腿钝它的势（附带效果不叠加，所以这是有节奏的）。
 * 8. 它在守、而迟滞还挂着（咬腿这一手落不下来）→ 那一合白送，用来换姿态。
 *    **顺序是量出来的**：把这一条排到第 7 条之前，岩羊的 seer 胜率 88.8%→87.8%、
 *    玄蟒的 seer+fang 67.5%→63.5% —— 守着的那一合你本来就不挨伤，拿去咬一口比换姿态划算，
 *    换姿态只在「这一口本来也没什么附带可捞」时才是最优。
 * 9. 否则挑当前伤害最高的那一咬（守备会把它从咬喉赶到别处）。
 *
 * 实验台里那套打法是这条链的镜像（`packages/gen` 的 `screenCombat`），
 * `tale-content` 的冒烟测试里还有一份 —— 改这里要同步三处（那两处都有注释指回来）。
 */
export function recommendCombatAct(preview: CombatPreview): CombatActId {
  const bestBite = [...preview.bites].sort((a, b) => b.damage.mid - a.damage.mid)[0];
  const bestId = `bite:${bestBite?.part ?? "throat"}`;
  if (preview.roundsToKill <= 1) return bestId;
  if (preview.roundsToLive <= 2 && preview.fleeChance >= 0.4) return "flee";
  // 读不出意图时「按兵不动」既可能是守也可能是逃 —— 拦一手的代价远小于丢掉整顿肉
  const mayFlee = preview.intentKnown ? preview.enemyWillFlee : preview.intentClass === "hold";
  if (mayFlee) return "bite:leg";
  /*
   * 它宣告了重击、而它还看得见 → **先把它弄瞎**。
   *
   * 这一条是洞察类器官在屏幕上的兑现：致盲有五成五让它这一下完全打空，而扑是 2.2 倍伤 ——
   * 花一记极轻的伤（1 点）换掉一次重击是明显的赚。读不出意图的 build **做不到这件事**，
   * 它只知道「似要动手」，于是只能挨。实验台上这一条就是 seer 与 bare 的差额来源。
   */
  if (preview.intentKnown && preview.intent.kind === "pounce" && preview.blind <= 0) {
    return "bite:eye";
  }
  const skill = preview.skills.find((item) => item.ready);
  if (skill) return `skill:${skill.organId}`;
  if (preview.roundsToLive <= 3 && preview.blind <= 0) return "bite:eye";
  // 长仗里先把它的势钝下来（附带效果不叠加，所以这一手有节奏：钝完就换回咬喉输出）
  const leg = preview.bites.find((bite) => bite.part === "leg");
  if (preview.roundsToKill >= 3 && leg?.riderLands === true) return "bite:leg";
  if (preview.intentKnown && preview.intent.kind === "guard") {
    const want: Stance = preview.roundsToLive <= 3 ? "low" : "lunge";
    if (preview.stance !== want) return `stance:${want}`;
  }
  return bestId;
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
  const recommended = recommendCombatAct(preview);

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
      };
    });

  const skills: CombatActionVm[] = preview.skills.map((skill) => {
    const tail =
      skill.effect === "heal"
        ? "回血"
        : skill.effect === "venom"
          ? "附毒·迟滞"
          : skill.effect === "stun"
            ? "顿挫·它下合只守"
            : skill.effect === "armor"
              ? "护体·受伤减半"
              : null;
    const parts = skill.effect === "heal" ? ["回血"] : [`伤 ${damageText(skill.damage)}`];
    if (tail && skill.effect !== "heal") parts.push(tail);
    parts.push(`冷却 ${skill.cooldown} 合`);
    return {
      id: `skill:${skill.organId}`,
      act: { kind: "skill", organId: skill.organId },
      glyph: "技",
      label: skill.name,
      effect: parts.join(" · "),
      warning: null,
      highlight: recommended === `skill:${skill.organId}`,
      enabled: skill.ready,
      disabledReason: skill.ready ? null : `还需 ${skill.cooldownLeft} 合`,
      group: "skill",
    };
  });

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
  };

  const marks: string[] = [];
  if (preview.blind > 0) marks.push(`它半盲 ${preview.blind} 合`);
  if (preview.slow > 0) marks.push(`它迟滞 ${preview.slow} 合`);
  if (preview.ward > 0) marks.push(`护体 ${preview.ward} 合`);

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
