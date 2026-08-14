/**
 * 生成事件的质量闸门 —— **全自动，不靠人眼**。
 *
 * 计划给了四道，这里逐道兑现，外加两道实测长出来的：
 *
 * | 闸门 | 拦的是什么 |
 * |---|---|
 * | ① schema ＋ id 白名单 ＋ 数值区间 | 结构不对、引用了不存在的器官／敌人／flag、数越界 |
 * | ② **严格占优** | 「看着像抉择、其实没得选」的假选项 —— AI 最容易犯的毛病 |
 * | ③ 长度与标点纪律 | 一句话交差、写成小说、半角标点、正文里的阿拉伯数字 |
 * | ④ 与手写事件去重 | 「又一条捡腐肉」 |
 * | ⑤ 前提呼应（母题词） | 「今年天时不好」这种放之四海皆准的句子 |
 * | ⑥ 具名专名与杀生一致性 | 白泽跑到生成事件里；文案写了吃活物而骨架没记这条命 |
 * | ⑦ [S2] 地方景物（去处景物词） | 「你在林子里走着」这种六处都成立的句子 |
 *
 * 每条问题都是**能直接递回给模型的人话**（重试就靠它们，同 P1 的做法）。
 */

import type { EventChoice, TaleContent, TaleEvent } from "@shiling/tale-sim";
import { longestSharedSpan } from "../validate.js";
import {
  BUDGET_KEYS,
  type BudgetKey,
  type EventDraft,
  type OutcomeSpec,
  type SlotSpec,
} from "./types.js";

// ===== 常量 =====

/** 事件卡上禁止出现的词。**不含「你」** —— 事件卡就是第二人称，那是它的固定人称。 */
const BANNED_WORDS = ["玩家", "系统", "属性值", "回合", "数值", "buff", "点数", "增益"];

/** 半角标点（技术内容之外一律全角）。 */
const HALFWIDTH_PUNCT = /[,.;:!?"']/u;

/**
 * 规格书自己的词 —— 它们**不是这个世界里的词**。
 *
 * 实测拿回来过一个叫「门槛前」的选项：那是规格书里「门槛」那一档的名字，被模型当成了
 * 文案抄回来。这类词在屏幕上读起来像 bug，而它们又都不是志怪散文里会出现的字。
 */
const SPEC_LEAK_WORDS = ["门槛", "选项", "骨架", "预算", "取舍", "权重", "抽中", "效果"];

/**
 * 正文里**允许出现的字符集**：汉字、中文标点、留白。
 *
 * 这一道是实测踩出来的：`gpt-5.4-mini` 在一条正文中间吐出了一串阿拉伯文
 * （「一口 تازه 裂开的洞」）。这类污染既不是标点问题也不是长度问题，别的判据一条都拦不住，
 * 而它出现在玩家眼前就是一块乱码。**白名单**而不是黑名单：外文、emoji、私用区、
 * 控制字符是列不完的。
 */
const ALLOWED_PROSE = /^[\p{Script=Han}\s，。！？；：、「」『』（）《》〔〕【】—…·～－]*$/u;

/**
 * 正文里不许写死岁数。
 *
 * 一条 `minYear: 8` 的事件可能在八岁触发，也可能在十五岁触发 —— 而实测拿回来过
 * 「你八岁那年学会了辨认痕迹」。手写的 51 条里一条都没有写岁数：**事件不知道自己
 * 什么时候会被抽到**，那是触发条件的事，不是正文的事。
 */
const AGE_CLAIM = /[一二三四五六七八九十百零两]+岁/u;

/**
 * 「这一支明写了杀生」的判据词。
 *
 * 刻意只收**不可能有第二种读法**的那几个：`takesLife` 同时是妖王（要够多）与化灵
 * （要恒为 0）两条道的判据，文案写了吃活物而骨架没记这条命，玩家读完一段吃活物的字
 * 之后仍会被告知「你还没夺过命」—— 那是这一批最难自查的一类错。
 * 反过来收得太宽（「咬断」「食」这类）会误伤「咬断绳索」「食其草」，一次假打回既花钱又多半更差。
 */
const KILL_PHRASES = ["食其肉", "饮其血", "夺其命", "取其性命", "咬死", "毙之", "杀之", "取其咽喉"];

export interface DraftLimits {
  titleMin: number;
  titleMax: number;
  bodyMin: number;
  bodyMax: number;
  labelMin: number;
  labelMax: number;
  outcomeMin: number;
  outcomeMax: number;
}

/**
 * 长度界限。
 *
 * 正文的 60〜150 是计划正本给的数；**手写 51 条实测落在 60〜91**（中位 67），所以上限
 * 留了很大余量 —— 它拦的是「写成小说」那种真事故，不是用来逼字数的（同 P1 的教训：
 * 卡得和 prompt 一样紧，会把只超三个字的好句子打回去，而那次重试既花钱又多半更差）。
 */
export const SCENARIO_LIMITS: DraftLimits = {
  titleMin: 2,
  titleMax: 6,
  bodyMin: 60,
  bodyMax: 150,
  labelMin: 2,
  labelMax: 8,
  outcomeMin: 14,
  outcomeMax: 70,
};

/** 与手写事件正文的最短「算撞车」片段（汉字数）。 */
export const SCENARIO_COPY_SPAN = 12;

// ===== 解析 =====

export interface ScenarioParseResult {
  drafts: EventDraft[];
  problems: string[];
}

/** 从模型回复里抠出 `{events:[…]}`（容错三档，同 P1 的 `parseDraft`）。 */
export function parseScenarioReply(raw: string): ScenarioParseResult {
  const text = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(text);
  const candidates = [fenced?.[1], text].filter((item): item is string => typeof item === "string");
  const braced = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  if (braced.length > 1) candidates.push(braced);

  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    const shaped = shapeReply(parsed);
    if (shaped !== null) return { drafts: shaped, problems: [] };
    return {
      drafts: [],
      problems: [
        "JSON 结构不对：要 {\"events\":[{id,title,body,choices:[{label,outcomes:[{text,effects}]}]}]}。",
      ],
    };
  }
  return { drafts: [], problems: ["没能解析出 JSON：只输出那个对象，不要围栏、不要解释。"] };
}

function shapeReply(value: unknown): EventDraft[] | null {
  if (typeof value !== "object" || value === null) return null;
  const list = (value as Record<string, unknown>).events;
  if (!Array.isArray(list)) return null;
  const drafts: EventDraft[] = [];
  for (const item of list) {
    const draft = shapeEvent(item);
    if (draft === null) return null;
    drafts.push(draft);
  }
  return drafts;
}

function shapeEvent(value: unknown): EventDraft | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.title !== "string" || typeof record.body !== "string") {
    return null;
  }
  if (!Array.isArray(record.choices)) return null;
  const choices: EventDraft["choices"] = [];
  for (const rawChoice of record.choices) {
    if (typeof rawChoice !== "object" || rawChoice === null) return null;
    const choice = rawChoice as Record<string, unknown>;
    if (typeof choice.label !== "string" || !Array.isArray(choice.outcomes)) return null;
    const outcomes: EventDraft["choices"][number]["outcomes"] = [];
    for (const rawOutcome of choice.outcomes) {
      if (typeof rawOutcome !== "object" || rawOutcome === null) return null;
      const outcome = rawOutcome as Record<string, unknown>;
      if (typeof outcome.text !== "string") return null;
      const effects: Partial<Record<BudgetKey, number>> = {};
      const rawEffects = outcome.effects;
      if (rawEffects !== undefined && rawEffects !== null) {
        if (typeof rawEffects !== "object") return null;
        for (const [key, amount] of Object.entries(rawEffects as Record<string, unknown>)) {
          // 未知键**不在这里丢掉** —— 它要留到校验层报出来，模型才知道自己添了字段
          if (typeof amount === "number") effects[key as BudgetKey] = amount;
          else return null;
        }
      }
      outcomes.push({ text: outcome.text.trim(), effects });
    }
    choices.push({ label: choice.label.trim(), outcomes });
  }
  return { id: record.id.trim(), title: record.title.trim(), body: record.body.trim(), choices };
}

// ===== 严格占优 =====

/** 效果向量的维度（**全部「越大越好」**，所以占优判定只有一个方向）。 */
const VECTOR_DIMS: readonly BudgetKey[] = BUDGET_KEYS;

type EffectVector = Record<string, number>;

function vectorOf(choice: EventChoice): EffectVector {
  const total = choice.outcomes.reduce((sum, outcome) => sum + Math.max(0, outcome.weight), 0);
  const vector: EffectVector = {};
  for (const dim of VECTOR_DIMS) vector[dim] = 0;
  if (total <= 0) return vector;
  for (const outcome of choice.outcomes) {
    const share = Math.max(0, outcome.weight) / total;
    const effects = outcome.effects;
    for (const [stat, amount] of Object.entries(effects.stats ?? {})) {
      vector[`stat.${stat}`] = (vector[`stat.${stat}`] ?? 0) + share * (amount ?? 0);
    }
    for (const [type, amount] of Object.entries(effects.essence ?? {})) {
      vector[`essence.${type}`] = (vector[`essence.${type}`] ?? 0) + share * (amount ?? 0);
    }
    vector.hunger = (vector.hunger ?? 0) + share * (effects.hunger ?? 0);
    vector.lifespan = (vector.lifespan ?? 0) + share * (effects.lifespan ?? 0);
  }
  return vector;
}

/**
 * 「非数值那一半」的指纹 —— 两个抉择只有指纹相同才**可比**。
 *
 * ## 为什么不把开战／挂彩／取命也折进向量
 * 试过，会把手写内容判成坏内容。「山魈拦路」的「先发扑之」（必开战）与「缓步而退」
 * （三成六开战、七成得灵二）若按「开战＝负分」比，前者被判成严格劣势 —— 可先手扑击
 * 的价值（谁先出手）根本不在 `EffectDelta` 里，模型化就是错的。
 *
 * 而「取命」更是一条**两端都有人要**的轴：妖王要它够多，化灵要它恒为零。给它任何一个
 * 符号都会把另一条道的玩家判错。
 *
 * 所以指纹不同 ＝ 不可比，宁可漏报也不误伤 —— 而这**不会削弱这道闸门**：AI 的自由度
 * 只有数值（非数值那一半由骨架钉死），所以它能犯的错恰好全落在指纹相同的那些对子里。
 */
function fingerprintOf(choice: EventChoice): string {
  const total = choice.outcomes.reduce((sum, outcome) => sum + Math.max(0, outcome.weight), 0) || 1;
  const parts: string[] = [];
  let takesLife = 0;
  for (const outcome of choice.outcomes) {
    const share = Math.round((Math.max(0, outcome.weight) / total) * 1000) / 1000;
    const effects = outcome.effects;
    if (effects.startCombat !== undefined) parts.push(`sc:${effects.startCombat}@${share}`);
    for (const flag of effects.addFlags ?? []) parts.push(`af:${flag}@${share}`);
    for (const flag of effects.removeFlags ?? []) parts.push(`rf:${flag}@${share}`);
    if (effects.addOrganId !== undefined) parts.push(`og:${effects.addOrganId}@${share}`);
    // [S2] 秘藏进指纹：拿到一处秘藏与拿不到是**两种不同的东西**，把它们放进同一个
    // 数值向量里比大小，会把「掘出来（＋秘藏）」判成严格占优于「盖回去（＋德）」——
    // 而后者恰恰是这一批刻意留的那个出口（同 `startCombat`／`takesLife` 的理由）
    if (effects.findTreasureId !== undefined) parts.push(`tr:${effects.findTreasureId}@${share}`);
    if (effects.die !== undefined) parts.push(`die:${effects.die}@${share}`);
    if (effects.devourDivine === true) parts.push(`dv@${share}`);
    takesLife += share * (effects.takesLife ?? 0);
  }
  parts.push(`tl:${Math.round(takesLife * 100) / 100}`);
  return parts.sort().join("|");
}

/** 门槛也是价钱：有门槛的选项比没门槛的强是**设计**，不是 bug（手写内容处处如此）。 */
function gateOf(choice: EventChoice): string {
  return JSON.stringify(choice.requires ?? null);
}

const EPSILON = 1e-9;

/**
 * 找出严格占优的抉择对。
 *
 * 定义（计划正本原话）：某个抉择在**所有效果维度上不劣于**另一个，且**至少一维更优** ——
 * 那它就不是选择题。返回 `[强, 弱]` 的下标对。
 */
export function dominancePairs(event: TaleEvent): [number, number][] {
  const vectors = event.choices.map(vectorOf);
  const prints = event.choices.map(fingerprintOf);
  const gates = event.choices.map(gateOf);
  const pairs: [number, number][] = [];
  for (let a = 0; a < event.choices.length; a += 1) {
    for (let b = 0; b < event.choices.length; b += 1) {
      if (a === b) continue;
      if (prints[a] !== prints[b] || gates[a] !== gates[b]) continue;
      const va = vectors[a];
      const vb = vectors[b];
      if (va === undefined || vb === undefined) continue;
      let better = false;
      let worse = false;
      for (const dim of VECTOR_DIMS) {
        const diff = (va[dim] ?? 0) - (vb[dim] ?? 0);
        if (diff > EPSILON) better = true;
        if (diff < -EPSILON) worse = true;
      }
      if (better && !worse) pairs.push([a, b]);
    }
  }
  return pairs;
}

// ===== id 白名单（对**成品事件**的终审） =====

/**
 * 终审：这条事件引用的每一个 id 都必须在内容库里真实存在，且不许碰禁用字段。
 *
 * 结构上 AI 本来就没有写 id 的字段（全在骨架的 `fixed` 里），所以这一道是**第二把锁**：
 * 它挡的是「骨架自己写错了」与「将来有人放宽了 AI 的字段」两种情况。引擎在
 * `applyEffects` 里遇到未知 id 会直接抛错 —— 那一刻玩家的一世就断在事件卡上了。
 */
export function auditEvent(event: TaleEvent, content: TaleContent): string[] {
  const problems: string[] = [];
  const organIds = new Set([
    ...content.organs.map((organ) => organ.id),
    ...content.seeds.map((seed) => seed.organ.id),
  ]);
  const organTags = new Set([
    ...content.organs.flatMap((organ) => organ.tags),
    ...content.seeds.flatMap((seed) => seed.organ.tags),
  ]);
  const enemyIds = new Set(content.enemies.map((enemy) => enemy.id));
  const knownFlags = new Set([
    ...content.tuning.restHealFlags,
    ...content.events.flatMap((item) => [
      ...(item.trigger.requiresFlags ?? []),
      ...(item.trigger.forbidsFlags ?? []),
      ...item.choices.flatMap((choice) =>
        choice.outcomes.flatMap((outcome) => [
          ...(outcome.effects.addFlags ?? []),
          ...(outcome.effects.removeFlags ?? []),
        ]),
      ),
    ]),
    ...content.skies.flatMap((sky) => sky.flags ?? []),
    ...content.origins.flatMap((origin) => origin.flags ?? []),
  ]);

  for (const tag of event.trigger.requiresOrganTags ?? []) {
    if (!organTags.has(tag)) problems.push(`触发条件引用了不存在的器官 tag「${tag}」。`);
  }
  for (const [index, choice] of event.choices.entries()) {
    for (const tag of choice.requires?.organTags ?? []) {
      if (!organTags.has(tag)) problems.push(`抉择${index + 1}的门槛引用了不存在的器官 tag「${tag}」。`);
    }
    for (const outcome of choice.outcomes) {
      const effects = outcome.effects;
      if (effects.startCombat !== undefined && !enemyIds.has(effects.startCombat)) {
        problems.push(`抉择${index + 1}引用了不存在的敌人「${effects.startCombat}」。`);
      }
      if (effects.addOrganId !== undefined && !organIds.has(effects.addOrganId)) {
        problems.push(`抉择${index + 1}引用了不存在的器官「${effects.addOrganId}」。`);
      }
      for (const flag of [...(effects.addFlags ?? []), ...(effects.removeFlags ?? [])]) {
        if (!knownFlags.has(flag)) problems.push(`抉择${index + 1}引用了不存在的 flag「${flag}」。`);
      }
      // 生成内容一律不许直接决定生死与成道 —— 那是引擎与手写成道事件的事
      if (effects.die !== undefined) problems.push(`抉择${index + 1}写了 die，生成事件不许直接决定生死。`);
      if (effects.way !== undefined) problems.push(`抉择${index + 1}写了 way，生成事件不许发放成道。`);
      if (effects.devourDivine === true) {
        problems.push(`抉择${index + 1}写了 devourDivine，生成事件不许发放登神门槛。`);
      }
      /*
       * [S2] 秘藏同理：一处的秘藏是「到过才知道」的那件东西，图鉴按它计数，
       * 而生成事件是这一局临时长出来的 —— 让它发秘藏，等于让 AI 有权改跨世图鉴的分母。
       * 结构上它本来就填不了（骨架的 `fixed` 里没有这个字段），这一条是第二把锁。
       */
      if (effects.findTreasureId !== undefined) {
        problems.push(`抉择${index + 1}写了 findTreasureId，生成事件不许发放秘藏。`);
      }
    }
  }
  if (event.choices.length < 2) problems.push("事件至少要有两个抉择。");
  return problems;
}

// ===== 逐条校验 =====

export interface ValidateContext {
  slot: SlotSpec;
  /** 手写事件的标题（去重） */
  writtenTitles: readonly string[];
  /** 手写事件正文（去重） */
  writtenBodies: readonly string[];
  /** 不许出现的具名专名（器官名／兽名／神种名，减去本槽位允许的那几个） */
  forbiddenNouns: readonly string[];
  /**
   * 这一世天时／出身的名字 —— **不许当标题**。
   *
   * 实测拿回来过一条题为《兽潮》的事件：那四个字此刻正印在降世屏与状态栏上，
   * 拿它当标题等于把「这一局的世道」和「这一桩事」说成同一件东西。
   */
  premiseNames: readonly string[];
  /** 本批之前已经收下的生成事件（自去重） */
  accepted: readonly TaleEvent[];
  limits?: DraftLimits;
}

/**
 * 校验一条草稿。返回空数组＝合格。
 *
 * @param assembled 由 `assembleEvent(slot, draft)` 拼好的成品（占优与 id 白名单查它）
 */
export function validateEventDraft(
  draft: EventDraft,
  assembled: TaleEvent,
  context: ValidateContext,
  content: TaleContent,
): string[] {
  const limits = context.limits ?? SCENARIO_LIMITS;
  const slot = context.slot;
  const problems: string[] = [];
  const where = `【${slot.id}】`;

  // — ① 结构 —
  if (draft.id !== slot.id) {
    problems.push(`${where}id 必须逐字照抄「${slot.id}」，你写的是「${draft.id}」。`);
  }
  if (draft.choices.length !== slot.choices.length) {
    problems.push(
      `${where}选项应有 ${slot.choices.length} 个，你写了 ${draft.choices.length} 个 —— 条数与顺序都不得改。`,
    );
  }
  slot.choices.forEach((choiceSpec, index) => {
    const choiceDraft = draft.choices[index];
    if (choiceDraft === undefined) return;
    if (choiceDraft.outcomes.length !== choiceSpec.outcomes.length) {
      problems.push(
        `${where}选项${index + 1}应有 ${choiceSpec.outcomes.length} 个结果，你写了 ${choiceDraft.outcomes.length} 个。`,
      );
    }
  });

  // — ③ 长度 —
  const segments: { label: string; text: string; min: number; max: number }[] = [
    { label: "标题", text: draft.title, min: limits.titleMin, max: limits.titleMax },
    { label: "正文", text: draft.body, min: limits.bodyMin, max: limits.bodyMax },
    ...draft.choices.map((choice, index) => ({
      label: `选项${index + 1}的字面`,
      text: choice.label,
      min: limits.labelMin,
      max: limits.labelMax,
    })),
    ...draft.choices.flatMap((choice, index) =>
      choice.outcomes.map((outcome, outcomeIdx) => ({
        label: `选项${index + 1}结果${outcomeIdx + 1}`,
        text: outcome.text,
        min: limits.outcomeMin,
        max: limits.outcomeMax,
      })),
    ),
  ];
  for (const segment of segments) {
    const length = [...segment.text].length;
    if (length < segment.min) {
      problems.push(`${where}${segment.label}太短（${length} 字，至少 ${segment.min} 字）。`);
    }
    if (length > segment.max) {
      problems.push(`${where}${segment.label}太长（${length} 字，至多 ${segment.max} 字）。`);
    }
  }

  // — ③ 标点与用词纪律（只查散文，不查 effects 里的数）—
  const prose = segments.map((segment) => segment.text).join("\n");
  if (/[0-9]/u.test(prose)) {
    problems.push(`${where}正文／文案里出现了阿拉伯数字 —— 那里的数字一律汉字（effects 里的才用阿拉伯数字）。`);
  }
  const halfwidth = HALFWIDTH_PUNCT.exec(prose);
  if (halfwidth) problems.push(`${where}出现了半角标点「${halfwidth[0]}」—— 标点一律中文全角。`);
  if (prose.includes("{{") || prose.includes("}}")) problems.push(`${where}出现了模板占位符。`);
  for (const word of BANNED_WORDS) {
    if (prose.includes(word)) problems.push(`${where}出现了禁用词「${word}」。`);
  }
  for (const word of SPEC_LEAK_WORDS) {
    if (prose.includes(word)) {
      problems.push(`${where}把规格书里的词「${word}」写进了文案 —— 那不是这个世界里的词。`);
    }
  }
  for (const segment of segments) {
    if (ALLOWED_PROSE.test(segment.text)) continue;
    const stray = [...segment.text].filter((char) => !ALLOWED_PROSE.test(char));
    problems.push(
      `${where}${segment.label}里混进了非中文字符「${stray.slice(0, 8).join("")}」—— 全篇只准出现汉字与中文标点。`,
    );
  }
  const ageClaim = AGE_CLAIM.exec(prose);
  if (ageClaim) {
    problems.push(
      `${where}写死了岁数「${ageClaim[0]}」—— 这条事件可能在任何一年触发，正文不许说它发生在哪一岁。`,
    );
  }

  // — ⑥ 具名专名 —
  const named = [...new Set(context.forbiddenNouns.filter((noun) => prose.includes(noun)))];
  if (named.length > 0) {
    problems.push(
      `${where}出现了具名的兽／器／神：${named.join("、")} —— 生成事件不许点名它们，改用泛称（「山中之物」「那东西」）。`,
    );
  }

  // — ⑤ 前提呼应 —
  if (slot.echo.kind !== "none" && slot.echo.keywords.length > 0) {
    const hit = slot.echo.keywords.some((keyword) => draft.body.includes(keyword));
    if (!hit) {
      problems.push(
        `${where}正文没有呼应这一世的${slot.echo.kind === "sky" ? "天时" : "出身"}「${slot.echo.name}」—— 要写出它的一个具体情节，正文里至少出现下列字词之一：${slot.echo.keywords.join("、")}。`,
      );
    }
  }

  /*
   * — ⑦ [S2] 地方景物 —
   *
   * 与⑤同一种闸门、同一个理由：「写出该地的具体景物」若只靠 prompt 叮嘱，拿回来的是
   * 「你在林中走着」这种六处都成立的句子。S2 的验收标准恰恰是「那一处读起来是不是
   * 另一个地方」，所以这一条必须是**可判定**的性质，而不是一句愿望。
   *
   * 与⑤的一处不同：这条只对**探索槽位**生效（`slot.place` 非空）。狩猎／休憩／季候那些
   * 槽位与去处无关，硬要求它们写出某处的景物只会逼模型硬凑。
   */
  if (slot.place && slot.place.scenery.length > 0) {
    const hit = slot.place.scenery.some((word) => draft.body.includes(word));
    if (!hit) {
      problems.push(
        `${where}正文没有写出「${slot.place.name}」的景物 —— 要写别处写不出来的那种细节，正文里至少出现下列字词之一：${slot.place.scenery.join("、")}。`,
      );
    }
  }

  // — ① 数值区间 —
  slot.choices.forEach((choiceSpec, choiceIdx) => {
    const choiceDraft = draft.choices[choiceIdx];
    if (choiceDraft === undefined) return;
    choiceSpec.outcomes.forEach((outcomeSpec, outcomeIdx) => {
      const outcomeDraft = choiceDraft.outcomes[outcomeIdx];
      if (outcomeDraft === undefined) return;
      problems.push(
        ...budgetProblems(outcomeSpec, outcomeDraft.effects, `${where}选项${choiceIdx + 1}结果${outcomeIdx + 1}`),
      );
      // — ⑥ 杀生一致性 —
      const kills = (outcomeSpec.fixed.takesLife ?? 0) > 0;
      const phrase = KILL_PHRASES.find((item) => outcomeDraft.text.includes(item));
      if (!kills && phrase !== undefined) {
        problems.push(
          `${where}选项${choiceIdx + 1}结果${outcomeIdx + 1}写了「${phrase}」，但这一支的骨架并不取命 —— 换个不涉杀生的写法。`,
        );
      }
    });
  });

  // — ② 严格占优 —
  for (const [strong, weak] of dominancePairs(assembled)) {
    problems.push(
      `${where}选项${strong + 1}在每一样上都不比选项${weak + 1}差、还至少有一样更好 —— 那不是取舍，选项${weak + 1}没人会点。让它们各强在不同的地方。`,
    );
  }

  // — ① id 白名单终审 —
  problems.push(...auditEvent(assembled, content).map((problem) => `${where}${problem}`));

  // — ④ 去重 —
  problems.push(...dedupeProblems(draft, context, where));

  return [...new Set(problems)];
}

function budgetProblems(
  spec: OutcomeSpec,
  filled: Partial<Record<BudgetKey, number>>,
  where: string,
): string[] {
  const problems: string[] = [];
  for (const [key, amount] of Object.entries(filled) as [BudgetKey, number][]) {
    const span = spec.budget[key];
    if (span === undefined) {
      problems.push(
        `${where}的 effects 里出现了本支不许出现的键「${key}」—— 只准填规格里列出的那几个。`,
      );
      continue;
    }
    if (!Number.isInteger(amount)) {
      problems.push(`${where}的「${key}」写成了 ${amount} —— 必须是整数。`);
      continue;
    }
    if (amount < span.min || amount > span.max) {
      problems.push(
        `${where}的「${key}」＝${amount} 越界 —— 允许的区间是 ${span.min} 〜 ${span.max}。`,
      );
    }
  }
  return problems;
}

/** ④ 与手写事件、以及本世已收下的生成事件去重。 */
function dedupeProblems(draft: EventDraft, context: ValidateContext, where: string): string[] {
  const problems: string[] = [];
  const title = [...draft.title];

  const collide = (titles: readonly string[], label: string): void => {
    for (const other of titles) {
      if (other === draft.title) {
        problems.push(`${where}标题「${draft.title}」与${label}重名 —— 换一个。`);
        return;
      }
      // 四字标题里连着三个字一样已经不是巧合
      const shared = longestSharedSpan(draft.title, other, Math.min(3, title.length));
      if (shared !== null && [...shared].length >= 3) {
        problems.push(`${where}标题「${draft.title}」与${label}「${other}」太像 —— 换一个题材。`);
        return;
      }
    }
  };
  for (const name of context.premiseNames) {
    if (name.length > 0 && draft.title.includes(name)) {
      problems.push(`${where}标题「${draft.title}」用了这一世天时／出身的名字「${name}」—— 换一个只属于这桩事的题。`);
    }
  }
  collide(context.writtenTitles, "已有事件");
  collide(
    context.accepted.map((event) => event.title),
    "本批已写的事件",
  );

  for (const body of [...context.writtenBodies, ...context.accepted.map((event) => event.body)]) {
    const shared = longestSharedSpan(draft.body, body, SCENARIO_COPY_SPAN);
    if (shared !== null) {
      problems.push(`${where}正文里「${shared}」与已有事件撞了 —— 同一件事换你自己的说法，或者干脆换个题材。`);
      break;
    }
  }
  return problems;
}
