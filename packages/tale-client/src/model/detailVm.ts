/**
 * 详情浮层的视图模型（纯）—— 属性／饱食／精气／器官／登神各一份「它有啥用」。
 *
 * ## 这一层存在的唯一理由
 * owner 验收 M1 的原话：「有点迷惑，每个属性值有啥用，进化能有啥好处，这些都不知道，
 * 所以只能乱点。」系统全在（四属性、四型精气、12 器官、登神四门槛），游戏一个字没讲 ——
 * 这是 3D 时代「功能存在≠玩家知道」那条教训的复发。修法照抄追猎屏已经验过的原则：
 * **每个可点的东西都摊开它的后果**，而且是用玩家**当前的数**摊开，不是讲公式。
 *
 * ## 三条纪律
 * 1. **讲结果，不讲风味**。「体＝血肉与寿数」读完等于没读；「搏杀起手 26 血，野雉一口 3〜5，
 *    能挨约 7 下」才回答了问题。
 * 2. **数一律从 `lifeTuning(state, content)` 与 `content` 数据推**，不在本文件写第二份常量
 *    —— 调参之后
 *    文案会跟着变，不会说谎。少数必须在客户端复算的算式（底伤、遁走成算）集中在本文件顶部
 *    那两个函数里，各自标了引擎正本的函数名，并有对账测试盯着（见 test/detailVm.test.ts）。
 * 3. **不剧透**。事件门槛只报**数目**（「全青丘 5 处抉择认它」——那是「进化有啥好处」的量），
 *    具名只列**本世已见过**的事（`records` 里 kind === "event" 的那些）；没见过的写
 *    「尚有未至之事」。
 */

import {
  SYS_FLAG_STARVING,
  lifeTuning,
  waysProgress,
  organIndex,
  type CombatSkillEffect,
  type EnemyDef,
  type EssenceType,
  type OrganDef,
  type TaleContent,
  type TaleState,
  type WayId,
  type TaleTuning,
} from "@shiling/tale-sim";
import {
  WAY_GATE_HOWTO,
  WAY_GATE_LABELS,
  WAY_LABELS,
  WAY_SCOPES,
  ESSENCE_LABELS,
  ESSENCE_ORDER,
  ORGAN_SLOT_LABELS,
  STAT_LABELS,
  STAT_ORDER,
  STAT_SCOPES,
  chanceCn,
  formatCountCn,
  formatSigned,
  type StatKey,
} from "./format.js";

// ===== 选中的那一处 =====

export type DetailSel =
  | { kind: "stat"; key: StatKey }
  | { kind: "hunger" }
  | { kind: "essence"; type: EssenceType }
  | { kind: "organ"; id: string }
  /** [2026-08-13] 从「登神」一条扩成四道：点哪条 tab 就看哪条 */
  | { kind: "way"; way: WayId };

/** 稳定 id：界面据此判断「再点一次同一处 ＝ 收起」，也是 `data-detail` 的值。 */
export function detailKey(sel: DetailSel): string {
  switch (sel.kind) {
    case "stat":
      return `stat:${sel.key}`;
    case "essence":
      return `essence:${sel.type}`;
    case "organ":
      return `organ:${sel.id}`;
    case "way":
      return `way:${sel.way}`;
    default:
      return sel.kind;
  }
}

export type DetailTone = "plain" | "gain" | "warn" | "dim";

export interface DetailRowVm {
  /** 两字小标题（「出手」「寿限」「食之可增」） */
  label: string;
  text: string;
  tone: DetailTone;
}

export interface DetailVm {
  key: string;
  title: string;
  /** 一句实例化的总结 —— 同时用作量表的悬停提示 */
  lede: string;
  rows: DetailRowVm[];
  /** 收尾一句：「怎么把它变高」或「按下去会发生什么」 */
  foot: string | null;
}

// ===== 必须在客户端复算的两条算式（引擎没有导出无上下文的推导，见报告） =====

/**
 * 空口一咬的底伤（抖动为 0 那一掷）。
 *
 * 引擎正本：`tale-sim/src/engine.ts` 的 `rollDamage`／`damageRange` ——
 * `combatDamageBase + floor(meng / combatDamageMengDivisor)`，再乘部位／姿态／守备倍率。
 * 常量全部来自 `tuning`，所以调参不会让这句话说谎；**算式形状**变了才会漂，
 * test/detailVm.test.ts 用 `combatPreview` 对账钉住这一点。
 */
export function baseBiteDamage(meng: number, t: TaleTuning): number {
  return t.combatDamageBase + Math.floor(meng / t.combatDamageMengDivisor);
}

/** 乘上一个倍率之后的落地伤害（`rollDamage` 的 `max(1, floor(base × mul))`）。 */
function scaledDamage(base: number, mul: number): number {
  if (mul <= 0) return 0;
  return Math.max(1, Math.floor(base * mul));
}

/**
 * 遁走成算（未被致盲时）。引擎正本：`fleeChanceOf`
 * ——「`fleeBase` ＋（灵 − 敌之猛）×`fleePerLingDiff` − 敌之 fleeBias×`fleeBiasFactor`」，
 * 按 `minChance`／`maxChance` 夹紧。同样有对账测试。
 */
export function fleeChanceAgainst(ling: number, enemy: EnemyDef, t: TaleTuning): number {
  const raw =
    t.fleeBase + (ling - enemy.meng) * t.fleePerLingDiff - enemy.fleeBias * t.fleeBiasFactor;
  return Math.min(t.maxChance, Math.max(t.minChance, raw));
}

// ===== 内容扫描：门槛在哪、精气从哪来、蜕形会出什么 =====

/** 本世已见过的事件 id（`records` 里 kind === "event" 的 refId）。不剧透的判据。 */
export function seenEventIds(state: TaleState): Set<string> {
  const seen = new Set<string>();
  for (const record of state.records) {
    if (record.kind === "event" && record.refId) seen.add(record.refId);
  }
  return seen;
}

export interface GateHit {
  eventId: string;
  eventTitle: string;
  /** 抉择门槛时是抉择原文；事件本身的门槛（`trigger.minStats`）时为 null */
  choiceLabel: string | null;
  need: number;
}

/** 某属性的全部门槛：抉择的 `requires.stats` ＋ 事件的 `trigger.minStats`。 */
export function statGates(content: TaleContent, key: StatKey): GateHit[] {
  const hits: GateHit[] = [];
  for (const event of content.events) {
    const triggerNeed = event.trigger.minStats?.[key];
    if (triggerNeed !== undefined) {
      hits.push({ eventId: event.id, eventTitle: event.title, choiceLabel: null, need: triggerNeed });
    }
    for (const choice of event.choices) {
      const need = choice.requires?.stats?.[key];
      if (need === undefined) continue;
      hits.push({ eventId: event.id, eventTitle: event.title, choiceLabel: choice.label, need });
    }
  }
  return hits.sort((a, b) => a.need - b.need);
}

/** 带某个 tag 的器官能开的抉择（`requires.organTags` 命中任一即可，同引擎语义）。 */
export function organTagGates(content: TaleContent, tags: readonly string[]): GateHit[] {
  const wanted = new Set(tags);
  const hits: GateHit[] = [];
  for (const event of content.events) {
    for (const choice of event.choices) {
      const need = choice.requires?.organTags;
      if (!need || !need.some((tag) => wanted.has(tag))) continue;
      hits.push({ eventId: event.id, eventTitle: event.title, choiceLabel: choice.label, need: 0 });
    }
  }
  return hits;
}

/** 某型精气的抉择门槛（`requires.essenceMin`）—— 蛰伏会清零，所以这是「攒还是蜕」那道题。 */
export function essenceGates(content: TaleContent, type: EssenceType): GateHit[] {
  const hits: GateHit[] = [];
  for (const event of content.events) {
    for (const choice of event.choices) {
      const need = choice.requires?.essenceMin?.[type];
      if (need === undefined) continue;
      hits.push({ eventId: event.id, eventTitle: event.title, choiceLabel: choice.label, need });
    }
  }
  return hits.sort((a, b) => a.need - b.need);
}

/**
 * 蛰伏开奖的候选池，按 affinity 从高到低。
 *
 * 规则与引擎的 `resolveMolt` 同源：**未持有** ＋ 对该型 `affinity > 0`。
 * （引擎没有把这个池子导出成只读推导，见报告「引擎待补」一节；这里只读内容数据，
 * 不复刻加权抽取本身 —— 界面只说「偏向哪几件」，不预言开出哪一件。）
 */
export function moltPool(state: TaleState, content: TaleContent, type: EssenceType): OrganDef[] {
  const owned = new Set(state.organIds);
  return content.organs
    .filter((organ) => !owned.has(organ.id) && (organ.affinity[type] ?? 0) > 0)
    .sort((a, b) => (b.affinity[type] ?? 0) - (a.affinity[type] ?? 0));
}

export interface EssenceSource {
  name: string;
  amount: number;
  /** 在猎场里（`tuning.huntPreyIds`）＝ 狩猎就能撞见；否则只能由事件引来 */
  huntable: boolean;
}

/**
 * 吃什么涨这一型 —— 从 `EnemyDef.essence` 反查，猎物在前。
 *
 * [2026-08-13] 收 `state` 只为了一件事：猎物表要问**这一世生效的**那份
 * （`lifeTuning`）。`huntPreyIds` 今天还不在 `PremiseTuningKey` 白名单里，所以现在两者同值 ——
 * 但这一批已经把饱食／蜕变／杀获都变成随天时不同的了，哪天猎物表也跟着变，
 * 「猎场里就有」这一行会静默指错，而不会有任何测试变红。一行的事，现在就对齐。
 */
export function essenceSources(
  state: TaleState,
  content: TaleContent,
  type: EssenceType,
): EssenceSource[] {
  const prey = new Set(lifeTuning(state, content).huntPreyIds);
  return content.enemies
    .map((enemy) => ({
      name: enemy.name,
      amount: enemy.essence[type] ?? 0,
      huntable: prey.has(enemy.id),
    }))
    .filter((source) => source.amount > 0)
    .sort((a, b) => Number(b.huntable) - Number(a.huntable) || b.amount - a.amount);
}

/** 还没长出来的、能加这一属性的器官（「怎么把它变高」那一行）。 */
function organsThatRaise(state: TaleState, content: TaleContent, key: StatKey): OrganDef[] {
  const owned = new Set(state.organIds);
  return content.organs
    .filter((organ) => !owned.has(organ.id) && (organ.statMods?.[key] ?? 0) > 0)
    .sort((a, b) => (b.statMods?.[key] ?? 0) - (a.statMods?.[key] ?? 0));
}

/** 内容库里最弱与最凶的两头兽 —— 用来把「血量／遁走」这类抽象数落到具体对手上。 */
function weakestAndFiercest(content: TaleContent): { weak: EnemyDef | null; fierce: EnemyDef | null } {
  const sorted = [...content.enemies].sort((a, b) => a.meng - b.meng);
  return { weak: sorted[0] ?? null, fierce: sorted[sorted.length - 1] ?? null };
}

// ===== 文案小工具 =====

function joinNames(names: readonly string[], max: number): string {
  return names.slice(0, max).join("、");
}

/** 「全青丘 5 处抉择认它　你已够 2 处」＋已见过的一条具名例子。 */
function gateSummary(
  hits: readonly GateHit[],
  have: number,
  label: string,
  seen: ReadonlySet<string>,
): { text: string; tone: DetailTone } | null {
  if (hits.length === 0) return null;
  const met = hits.filter((hit) => have >= hit.need);
  const unmet = hits.filter((hit) => have < hit.need);
  const parts = [`全青丘 ${hits.length} 处抉择认${label}`, `你已够 ${met.length} 处`];
  const next = unmet[0];
  if (next) parts.push(`下一档 ${label} ${next.need}（还差 ${next.need - have}）`);
  const example = [...unmet, ...met].find((hit) => seen.has(hit.eventId) && hit.choiceLabel);
  if (example) parts.push(`如「${example.eventTitle}」里那条「${example.choiceLabel}」`);
  return { text: parts.join("　·　"), tone: unmet.length > 0 ? "plain" : "gain" };
}

function row(label: string, text: string, tone: DetailTone = "plain"): DetailRowVm {
  return { label, text, tone };
}

// ===== 属性 =====

/** 属性环的悬停提示 ＝ 详情的第一行（同一句，别两处各写一版）。 */
export function statLede(state: TaleState, content: TaleContent, key: StatKey): string {
  const t = lifeTuning(state, content);
  const value = Math.round(state.stats[key]);
  const label = STAT_LABELS[key];
  switch (key) {
    case "meng": {
      const base = baseBiteDamage(value, t);
      const pounce = Math.round(value * t.stalkPouncePerMeng * 100);
      return `${label} ${value}　出手底伤 ${base}　·　扑击命中 +${pounce}%`;
    }
    case "ti":
      return `${label} ${value}　搏杀起手血量 ${value}　·　寿限 ${state.lifespanMax} 岁`;
    case "ling": {
      const { weak } = weakestAndFiercest(content);
      const flee = weak ? chanceCn(fleeChanceAgainst(value, weak, t)) : "—";
      return `${label} ${value}　遁走成算 ${flee}（对${weak?.name ?? "兽"}）　·　登神需 ${t.wayShenLing}／化灵需 ${t.wayHualingLing}`;
    }
    default:
      return `${label} ${value}　登神需 ${t.wayShenDe}／归山需 ${t.wayGuishanDe}　·　不进搏杀的账`;
  }
}

function statDetail(state: TaleState, content: TaleContent, key: StatKey): DetailVm {
  const t = lifeTuning(state, content);
  const value = Math.round(state.stats[key]);
  const label = STAT_LABELS[key];
  const seen = seenEventIds(state);
  const rows: DetailRowVm[] = [];

  if (key === "meng") {
    const base = baseBiteDamage(value, t);
    const bites = [
      `咬喉 ${scaledDamage(base, t.combatBiteMul.throat)}`,
      `咬腿 ${scaledDamage(base, t.combatBiteMul.leg)}`,
      `扑眼 ${scaledDamage(base, t.combatBiteMul.eye)}`,
    ].join(" · ");
    rows.push(row("出手", `空口一咬 ${base}　—— ${bites}（守备处再减半）`, "gain"));
    const per = Math.round(0.1 / t.stalkPouncePerMeng);
    rows.push(
      row(
        "扑击",
        `命中率里带 +${Math.round(value * t.stalkPouncePerMeng * 100)}%（猛每 +${per} 多一成）`,
      ),
    );
    rows.push(row("不管", "警觉、风向、意图都读不出来 —— 那是器官的事，不是猛的事", "dim"));
  }

  if (key === "ti") {
    const { weak, fierce } = weakestAndFiercest(content);
    rows.push(row("血量", `每场搏杀起手 ${value} 血（不跨场，打完就回满）`, "gain"));
    if (weak && fierce) {
      const light = scaledDamage(baseBiteDamage(weak.meng, t), t.combatIntentDamageMul.bite);
      const heavy = scaledDamage(baseBiteDamage(fierce.meng, t), t.combatIntentDamageMul.pounce);
      rows.push(
        row(
          "挨得住",
          `${weak.name}常规一口 ${light} → 约 ${Math.ceil(value / Math.max(1, light))} 下；` +
            `${fierce.name}一扑 ${heavy} → 只 ${Math.ceil(value / Math.max(1, heavy))} 下`,
          "warn",
        ),
      );
    }
    rows.push(
      row(
        "寿限",
        `${state.lifespanMax} 岁 —— 出生时按体定（${t.lifespanBase}＋体／${t.lifespanTiDivisor}），` +
          "此后再长体也不加寿；只有抉择里的「寿元」改得动它",
      ),
    );
  }

  if (key === "ling") {
    const { weak, fierce } = weakestAndFiercest(content);
    const per = Math.round(0.1 / t.fleePerLingDiff);
    const flees = [weak, fierce]
      .filter((enemy): enemy is EnemyDef => enemy !== null)
      .map((enemy) => `对${enemy.name} ${chanceCn(fleeChanceAgainst(value, enemy, t))}`)
      .join(" · ");
    rows.push(row("遁走", `${flees}　（灵每 +${per} 多一成）`, "gain"));
    const infoOrgans = new Set([...t.stalkAlertTags, ...t.stalkWindTags, ...t.combatIntentTags]);
    const names: string[] = [];
    for (const organ of organIndex(content).values()) {
      if (organ.tags.some((tag) => infoOrgans.has(tag)) && !names.includes(organ.name)) {
        names.push(organ.name);
      }
    }
    if (names.length > 0) {
      rows.push(row("不管", `读得出警觉／风向／敌意的是${joinNames(names, 3)}这类器官，不是灵`, "dim"));
    }
  }

  if (key === "de") {
    // 「不进搏杀的账」已在第一行（`statLede`，同时是环上的悬停提示）说过，这里不重复
    const praise = content.chronicleTemplates.praise.find((variant) => variant.minDe !== undefined);
    if (praise?.minDe !== undefined) {
      rows.push(row("列传", `德 ≥${praise.minDe} 时，你这一篇的赞语会换一段`, "dim"));
    }
  }

  /*
   * [2026-08-13] 成道门槛：口径一律问引擎（`waysProgress`），界面不自己比大小。
   *
   * 从「只报登神那一条」改成**报所有认这个属性的道**：猛只有妖王认，德有登神与归山两条认，
   * 灵有登神与化灵两条认。玩家点开「德」时最该知道的正是「这个数同时决定两条道」——
   * 那是「这一世该奔哪条」的第一现场。
   */
  const claimants = waysProgress(state, content).ways.flatMap((way) =>
    way.gates
      .filter((gate) => gate.id === key)
      .map((gate) => ({ way: way.id, gate })),
  );
  for (const { way, gate } of claimants) {
    rows.push(
      row(
        WAY_LABELS[way],
        gate.met
          ? `${WAY_GATE_LABELS[gate.id]} ${gate.have}／${gate.need}　已足`
          : `${WAY_GATE_LABELS[gate.id]} ${gate.have}／${gate.need}　尚差 ${gate.short}`,
        gate.met ? "gain" : "warn",
      ),
    );
  }

  const gates = gateSummary(statGates(content, key), value, label, seen);
  if (gates) rows.push(row("抉择", gates.text, gates.tone));

  const raisers = organsThatRaise(state, content, key);
  const foot =
    raisers.length > 0
      ? `涨${label}的路：蜕出${raisers
          .slice(0, 3)
          .map((organ) => `${organ.name}（${formatSigned(organ.statMods?.[key] ?? 0)}）`)
          .join("、")}，或抉择里选那些长${label}的分支。`
      : `已无器官可再长${label} —— 只剩抉择。`;

  return {
    key: detailKey({ kind: "stat", key }),
    title: `${label}　${value}`,
    lede: `${STAT_SCOPES[key]}。${statLede(state, content, key)}`,
    rows,
    foot,
  };
}

// ===== 饱食 =====

export function hungerLede(state: TaleState, content: TaleContent): string {
  const t = lifeTuning(state, content);
  const value = Math.round(state.hunger);
  return `饱食 ${value}／${t.hungerMax}　每季 −${t.hungerPerSeason}（冬 −${t.hungerPerSeason + t.winterHungerExtra}）`;
}

function hungerDetail(state: TaleState, content: TaleContent): DetailVm {
  const t = lifeTuning(state, content);
  const value = Math.round(state.hunger);
  const perSeason = t.hungerPerSeason;
  const winter = perSeason + t.winterHungerExtra;
  const starving = state.flags.includes(SYS_FLAG_STARVING);
  const seasonsLeft = Math.floor(value / Math.max(1, perSeason));
  const huntEvery = Math.max(1, Math.floor(t.huntFoodGain / Math.max(1, perSeason)));

  return {
    key: "hunger",
    title: `饱食　${value}／${t.hungerMax}`,
    lede: hungerLede(state, content),
    rows: [
      row("出", `每季 −${perSeason}，冬季 −${winter}（行动不额外扣）`, "warn"),
      row(
        "进",
        `追猎得手 +${t.huntFoodGain}　·　搏杀取胜 +${t.combatWinHungerGain}　·　休憩 +${t.restHungerGain}`,
        "gain",
      ),
      row(
        "还够",
        starving
          ? "已空腹一季 —— 再一季不进食就是饿殍"
          : `以每季 −${perSeason} 算，还够 ${seasonsLeft} 季`,
        starving ? "warn" : "plain",
      ),
      row("饿死", "落到 0 之后再空一季即死；不是当场死，还有一季可救", "dim"),
    ],
    foot: `一次得手够 ${huntEvery} 季 —— 所以每 ${huntEvery} 季至少要猎一次，余下的季才拿去探索或蛰伏。`,
  };
}

// ===== 精气 =====

export function essenceLede(state: TaleState, content: TaleContent, type: EssenceType): string {
  const t = lifeTuning(state, content);
  const value = Math.round(state.essence[type]);
  const label = ESSENCE_LABELS[type];
  const short = Math.max(0, t.moltThreshold - value);
  return `${label}之精气 ${value}／${t.moltThreshold}　${short === 0 ? "已可蛰伏" : `尚差 ${short}`}`;
}

function essenceDetail(state: TaleState, content: TaleContent, type: EssenceType): DetailVm {
  const t = lifeTuning(state, content);
  const value = Math.round(state.essence[type]);
  const label = ESSENCE_LABELS[type];
  const ripe = value >= t.moltThreshold;
  const pool = moltPool(state, content, type);
  const sources = essenceSources(state, content, type);
  const huntable = sources.filter((source) => source.huntable);
  const foes = sources.filter((source) => !source.huntable);
  const seen = seenEventIds(state);
  const rows: DetailRowVm[] = [];

  rows.push(
    row(
      "蜕形",
      pool.length > 0
        ? `攒满 ${t.moltThreshold} 可蛰伏，蜕一枚偏此型的器官　候选偏向：${joinNames(
            pool.map((organ) => organ.name),
            t.moltCandidateCount,
          )}`
        : "此型已无可蜕（该长的都长齐了）",
      ripe ? "gain" : "plain",
    ),
  );
  rows.push(
    row(
      "食之可增",
      huntable.length > 0
        ? `${huntable.map((source) => `${source.name} +${source.amount}`).join(" · ")}（猎场里就有）`
        : "猎场四头猎物都不主此型 —— 只能从搏杀与凶险抉择里来",
      huntable.length > 0 ? "gain" : "warn",
    ),
  );
  if (foes.length > 0) {
    rows.push(
      row("搏杀可增", `${foes.map((source) => `${source.name} +${source.amount}`).join(" · ")}（事件引来）`),
    );
  }
  const gates = gateSummary(essenceGates(content, type), value, `${label}之精气`, seen);
  if (gates) rows.push(row("抉择", `${gates.text}　—— 蛰伏会把此型清零，攒着别急`, gates.tone));
  rows.push(row("代价", "蛰伏占一整季（那一季不进食），开奖后此型清零", "dim"));

  return {
    key: detailKey({ kind: "essence", type }),
    title: `${label}之精气　${value}／${t.moltThreshold}`,
    lede: essenceLede(state, content, type),
    rows,
    /*
     * 收尾这一句是整条链的复述，措辞有一条硬规矩：**不许点名会开出哪一件**。
     * 引擎的 `resolveMolt` 是「按 affinity×精气加权抽 `moltCandidateCount` 件，再在这几件里
     * 等权抽一」——写成「→ 蜕出坚喙」的话，多数时候玩家读到的那个名字**不是**他最后拿到的
     * 那件，而这一批存在的全部理由就是让屏幕上的话算数。所以只报「偏向哪几件」。
     */
    foot: ripe
      ? `已够了 —— 按下方「蛰伏」即以${label}之精气蜕形。`
      : huntable.length > 0
        ? `路子：猎${joinNames(
            huntable.map((source) => source.name),
            2,
          )} → ${label}满 ${t.moltThreshold} → 蛰伏 → 蜕一枚偏${label}的器官（候选偏向 ${
            pool.length > 0
              ? pool.slice(0, t.moltCandidateCount).map((organ) => organ.name).join("／")
              : "此型已无可蜕"
          }）。`
        : null,
  };
}

// ===== 器官 =====

/**
 * 一个 tag 在战术层的**实际后果**。
 *
 * 判据是 `tuning` 里那几张 tag 表（`stalkAlertTags`／`stalkWindTags`／`stalkSwiftTag`……），
 * 不是本文件写死的 tag → 文案映射：调参把某个 tag 从表里挪走，这句话会跟着消失。
 * 表里没有的 tag（armor、dig、swim 之类）的用处**全在事件门槛上**，由下面「解开的抉择」
 * 那一行回答 —— 那正是 owner 问的「进化能有啥好处」。
 */
export function tagEffects(tags: readonly string[], t: TaleTuning): string[] {
  const out: string[] = [];
  const has = (tag: string): boolean => tags.includes(tag);
  if (tags.some((tag) => t.stalkAlertTags.includes(tag))) {
    out.push("追猎时读得出精确警觉（否则只有「未觉／有疑／欲遁」三档）");
  }
  if (tags.some((tag) => t.stalkWindTags.includes(tag))) {
    out.push("追猎时看得清风向（否则「风势难辨」，只能靠绕行买确定）");
  }
  if (has(t.stalkSwiftTag)) {
    out.push(`潜行每步多近 ${t.stalkCreepSwiftBonus} 步（少一个回合＝少一次涨警觉）`);
  }
  if (has(t.huntHunterTag)) {
    out.push(`潜行的动静只有 ${Math.round(t.stalkQuietAlertMul * 10)} 成（警觉涨得更慢）`);
  }
  if (has(t.stalkVenomTag)) {
    out.push(`扑空转搏杀时它已带伤（起手只剩 ${Math.round(t.stalkVenomHpMul * 10)} 成血）`);
  }
  if (tags.some((tag) => t.combatIntentTags.includes(tag))) {
    out.push("搏杀时读得出敌人确切意图（否则只有「似要动手／按兵不动」两档）");
  }
  return out;
}

/**
 * 战斗技那一行的后果（数全从 tuning 与技的数据来，界面不写第二份）。
 *
 * [S1] 效果是**数组**（一个技可以同时附两条），倍率与代价也归数据，所以这一行现在是
 * 「伤害 ×N（按猛／按灵）· 效果一 · 效果二 · 冷却 · 代价」。器官详情里的这一行与
 * 搏杀屏按钮上的那一行说的是同一件事，读法刻意一致。
 */
function skillEffectText(organ: OrganDef, t: TaleTuning): string {
  const skill = organ.combatSkill;
  if (!skill) return "";
  const cooldown = skill.cooldown ?? t.combatSkillCooldown;
  const mul = skill.damageMul ?? t.organSkillDamageMul;
  const parts: string[] = [];
  parts.push(mul <= 0 ? "不出伤" : `伤 ×${mul}${skill.stat === "ling" ? "（按灵算）" : ""}`);
  for (const effect of skill.effects ?? []) parts.push(SKILL_EFFECT_DETAIL[effect](t));
  parts.push(`冷却 ${cooldown} 合`);
  if (skill.cost) {
    parts.push(
      skill.cost.kind === "hp"
        ? `代价 自伤 ${skill.cost.amount}`
        : `代价 ${ESSENCE_LABELS[skill.cost.type]}之精气 ${skill.cost.amount}`,
    );
  }
  return `${skill.name}　${parts.join(" · ")}`;
}

/**
 * 十档效果各自的「实际账」—— 每一句都把 tuning 里的数实例化出来。
 *
 * 与按钮上的短读法（`format.SKILL_EFFECT_LABELS`）分工：那边一行要塞五颗按钮，只能写
 * 结论；这里是点开来看的详情，写得出「出伤只剩 75%，且扑不起来、逃不掉」这种账。
 */
const SKILL_EFFECT_DETAIL: Record<CombatSkillEffect, (t: TaleTuning) => string> = {
  stun: () => "它下一合只守得住（等于偷一个回合）",
  venom: (t) =>
    `给它挂迟滞 ${t.combatVenomSlowRounds} 合：出伤只剩 ${Math.round(t.combatSlowDamageMul * 100)}%，且扑不起来、逃不掉`,
  bleed: (t) => `给它挂流血 ${t.combatBleedRounds} 合：每合末自损 ${t.combatBleedDamage}（它守着不动也照掉）`,
  blind: (t) =>
    `蒙其目 ${t.combatBlindRounds} 合：它 ${Math.round(t.combatBlindMissChance * 100)}% 打空，也不再反咬`,
  armor: (t) => `给自己挂护体 ${t.combatWardRounds} 合：受伤减半`,
  thorns: (t) => `反刺 ${t.combatThornsRounds} 合：它每命中你一次自伤 ${t.combatThornsDamage}`,
  brace: () => "这一合硬受：它那一手伤害归零",
  bolt: () => "必定脱身（不掷骰）—— 但这一架的精气与饱食都没有",
  insight: (t) => `明识 ${t.combatInsightRounds} 合：读得出它的确切意图（不必有灵犀）`,
  heal: (t) => `回 ${t.combatSkillHealAmount} 血`,
};

function organDetail(state: TaleState, content: TaleContent, id: string): DetailVm | null {
  const organ = organIndex(content).get(id);
  if (!organ) return null;
  const t = lifeTuning(state, content);
  const seen = seenEventIds(state);
  const isSeed = state.organIds[0] === id;
  const mods = STAT_ORDER.filter((key) => (organ.statMods?.[key] ?? 0) !== 0).map(
    (key) => `${STAT_LABELS[key]} ${formatSigned(organ.statMods?.[key] ?? 0)}`,
  );
  const rows: DetailRowVm[] = [];

  rows.push(row("形貌", organ.desc, "dim"));
  if (mods.length > 0) {
    rows.push(row("已加", `${mods.join(" · ")}（蜕生那一刻就加上了，不再变）`, "gain"));
  }
  if (organ.combatSkill) {
    rows.push(row("战技", skillEffectText(organ, t), "gain"));
    rows.push(row("技效", organ.combatSkill.desc, "dim"));
  }
  for (const effect of tagEffects(organ.tags, t)) rows.push(row("战术", effect, "gain"));

  /*
   * 「它让你能选哪些原本锁着的抉择」—— 这一行是整块详情的灵魂：它是「进化能有啥好处」
   * 唯一直观的兑现。**数目**照报（那是这枚器官的分量），**具名只列本世见过的事**。
   */
  const gates = organTagGates(content, organ.tags);
  if (gates.length > 0) {
    const seenHits = gates.filter((hit) => seen.has(hit.eventId));
    const named = seenHits
      .slice(0, 3)
      .map((hit) => `「${hit.choiceLabel}」（${hit.eventTitle}）`)
      .join("、");
    rows.push(
      row(
        "解开",
        `全青丘 ${gates.length} 处抉择只认它这一门　${
          named.length > 0 ? `你见过的：${named}` : "你还没撞见过 —— 尚有未至之事"
        }`,
        "gain",
      ),
    );
  } else {
    rows.push(row("解开", "暂无抉择认它这一门 —— 它的价值全在上面那几行", "dim"));
  }

  const affinity = ESSENCE_ORDER.filter((type) => (organ.affinity[type] ?? 0) > 0);
  return {
    key: detailKey({ kind: "organ", id }),
    title: `${ORGAN_SLOT_LABELS[organ.slot]}　${organ.name}`,
    lede: isSeed
      ? `神种自带，一世之始。${mods.length > 0 ? mods.join(" · ") : "无属性加成"}`
      : `${ORGAN_SLOT_LABELS[organ.slot]}位　${mods.length > 0 ? mods.join(" · ") : "无属性加成"}`,
    rows,
    foot: isSeed
      ? "神种是这一世的第一枚器官，转世时可换。"
      : affinity.length > 0
        ? `从${affinity.map((type) => ESSENCE_LABELS[type]).join("／")}之精气的蛰伏里开出来。`
        : "不入蛰伏的开奖池 —— 只能由那桩事送到你身上。",
  };
}

// ===== 四道 =====

/**
 * 一条道的详情浮层（点横带上那条 tab 打开）。
 *
 * 常驻横带只给「差多少」，这里给**怎么长**（`WAY_GATE_HOWTO`）＋这条道**怎么收束** ——
 * 后者是四条道最容易被误解的地方：归山不是「活着就行」，是寿终那一刻门槛必须已备；
 * 化灵不是「少杀」，是**一条都不能**。
 */
const WAY_CLOSING: Record<WayId, string> = {
  shen: "门槛齐备后「天命」会来找你 —— 那一卡上选「应命而升」才算成。",
  yaowang: "门槛齐备后众兽会来伏首 —— 受了那一礼才算成。",
  guishan: "没有事件来找你 —— 寿终那一刻门槛已备就是成道，不备就是「终未成器」。",
  hualing: "门槛齐备后会「形解」—— 任其散去才算成。夺过一命这条道就永远关了。",
};

function wayDetail(state: TaleState, content: TaleContent, wayId: WayId): DetailVm {
  const progress = waysProgress(state, content);
  const way = progress.ways.find((item) => item.id === wayId);
  if (!way) throw new Error(`wayDetail: 未知道 ${wayId}`);
  const rows = way.gates.map((gate) => {
    /*
     * `max` 类门槛（不杀一命）**没有 have／need 那个读法**：`0／0　已足` 在屏幕上读成
     * 「零比零」，而它要说的是「这一世还没夺过命，这条门还开着」。实机抄字时撞到的。
     */
    const text =
      gate.bound === "max"
        ? gate.met
          ? "未夺一命　这条门还开着"
          : `已夺 ${gate.have} 命　—— ${WAY_GATE_HOWTO[gate.id]}`
        : gate.met
          ? `${gate.have}／${gate.need}　已足`
          : `${gate.have}／${gate.need}　尚差 ${gate.short}　—— ${WAY_GATE_HOWTO[gate.id]}`;
    return row(
      WAY_GATE_LABELS[gate.id],
      text,
      gate.met ? "gain" : gate.bound === "max" ? "warn" : "plain",
    );
  });
  const label = WAY_LABELS[wayId];
  return {
    key: detailKey({ kind: "way", way: wayId }),
    title: `${label}　${formatCountCn(way.metCount)}／${formatCountCn(way.gates.length)}`,
    lede: way.lost
      ? `${label}已闭 —— ${WAY_SCOPES[wayId]}，而这一世已经破了那一条`
      : way.ready
        ? `${label}诸事既备 —— ${WAY_SCOPES[wayId]}`
        : `${WAY_SCOPES[wayId]}。今备 ${way.metCount} 事`,
    rows,
    foot: way.lost
      ? "这一世走不到了。换一世从头来，它是四条道里最难、也最不一样的一条。"
      : WAY_CLOSING[wayId],
  };
}

// ===== 出口 =====

export function buildDetailVm(
  state: TaleState,
  content: TaleContent,
  sel: DetailSel,
): DetailVm | null {
  switch (sel.kind) {
    case "stat":
      return statDetail(state, content, sel.key);
    case "hunger":
      return hungerDetail(state, content);
    case "essence":
      return essenceDetail(state, content, sel.type);
    case "organ":
      return organDetail(state, content, sel.id);
    case "way":
      return wayDetail(state, content, sel.way);
    default:
      return null;
  }
}

/**
 * 蛰伏按钮的预览（交付内容 D）——「按下去会发生什么」。
 *
 * 达阈值时报**哪一型**会被拿去蜕形：与引擎 `resolveMolt` 同一条挑选规则（达阈值者中数值
 * 最高的一型，并列按 zu→lin→xue→meng）。任一型达阈值时「全局最高」必然就是「达阈值者中
 * 最高」（比它大的那一型也必然达阈值），所以这里直接取全局最高，与引擎同解。
 */
export function moltPreviewText(state: TaleState, content: TaleContent): string {
  const t = lifeTuning(state, content);
  const best = ESSENCE_ORDER.reduce(
    (top, type) => (state.essence[type] > state.essence[top] ? type : top),
    ESSENCE_ORDER[0] ?? "zu",
  );
  const label = ESSENCE_LABELS[best];
  const pool = moltPool(state, content, best);
  const ripe = state.essence[best] >= t.moltThreshold;
  if (!ripe) {
    const need = Math.max(0, t.moltThreshold - Math.round(state.essence[best]));
    const sources = essenceSources(state, content, best).filter((source) => source.huntable);
    const how =
      sources.length > 0
        ? `　猎${joinNames(
            sources.map((source) => source.name),
            2,
          )}可增`
        : "　只能从搏杀与凶险抉择里来";
    return `尚需${label}之精气 ${need}　满则蜕一器官${how}`;
  }
  if (pool.length === 0) return `以${label}之精气蜕形　此型已无可蜕（会白费一季）`;
  return `以${label}之精气蜕形　候选偏向 ${pool
    .slice(0, t.moltCandidateCount)
    .map((organ) => organ.name)
    .join("／")}`;
}
