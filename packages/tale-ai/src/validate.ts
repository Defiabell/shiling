/**
 * 草稿解析与校验 —— 这一层是「AI 不许编造事实」的**机制兑现**，不是叮嘱。
 *
 * 校验不过就打回重生（`historian.ts` 带着逐条问题再问一次），重试用尽即回落模板版。
 * 所有判据都是纯函数、无网络，所以它们在 `pnpm test` 里跑得起来 —— 这条管线的正确性
 * 不依赖「跑一次看看」。
 */

import type { ChronicleDraft, LifeFacts } from "./types.js";

/** 传里禁止出现的词：游戏黑话与第二人称（列传是史官在写，不是界面在说话）。 */
const BANNED_WORDS = ["玩家", "系统", "属性", "回合", "数值", "buff", "你"];

/** 半角标点（技术内容之外一律全角，同仓库的中文标点纪律）。 */
const HALFWIDTH_PUNCT = /[,.;:!?"']/u;

export interface DraftLimits {
  openingMin: number;
  openingMax: number;
  middleMin: number;
  middleMax: number;
  closingMin: number;
  closingMax: number;
  praiseMin: number;
  praiseMax: number;
}

/**
 * 长度界限比 prompt 里写的**宽一档**（prompt 说六十至一百二十，这里放到四十至一百八）。
 *
 * 理由：界限是用来拦「一句话交差」与「写成小说」这两种真事故的，不是用来逼字数的。
 * 卡得和 prompt 一样紧会把只超三个字的好句子打回去 —— 那次重试既花钱又多半更差。
 */
export const DEFAULT_LIMITS: DraftLimits = {
  openingMin: 40,
  openingMax: 180,
  // 六字：史笔里「是岁大饥，遂殁」这类短句合法，而八字打回过一条只有七字的好句子
  middleMin: 6,
  middleMax: 80,
  closingMin: 25,
  closingMax: 150,
  praiseMin: 20,
  praiseMax: 120,
};

export interface ParseResult {
  draft: ChronicleDraft | null;
  problems: string[];
}

/**
 * 两段文字里最长的公共连续片段（≥ `minLen` 才报）。
 *
 * 用途只有一个：抓「照抄模板版」。prompt 把这一世的模板版当**反面锚**递进去（要求写得比它
 * 更像史书），而模型顺手把它的结语与赞语整句搬回来是实测出来的常事 —— 那等于这一批白做。
 * 朴素 DP 就够：两边都只有两三百字。
 */
export function longestSharedSpan(a: string, b: string, minLen: number): string | null {
  const x = [...a];
  const y = [...b];
  let bestLen = 0;
  let bestEnd = 0;
  let prev = new Array<number>(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i += 1) {
    const row = new Array<number>(y.length + 1).fill(0);
    for (let j = 1; j <= y.length; j += 1) {
      if (x[i - 1] === y[j - 1]) {
        row[j] = (prev[j - 1] ?? 0) + 1;
        if ((row[j] ?? 0) > bestLen) {
          bestLen = row[j] ?? 0;
          bestEnd = i;
        }
      }
    }
    prev = row;
  }
  return bestLen >= minLen ? x.slice(bestEnd - bestLen, bestEnd).join("") : null;
}

/**
 * 从模型回复里抠出 JSON。
 *
 * 容错三档：整段就是 JSON ／ 包在 ```json 围栏里 ／ 前后有闲话但中间有一对花括号。
 * 不用 `response_format`：网关后面挂着十几家模型，支持度不一，而这三档实测足够。
 */
export function parseDraft(raw: string): ParseResult {
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
    const shaped = shapeDraft(parsed);
    if (shaped) return { draft: shaped, problems: [] };
    return { draft: null, problems: ["JSON 结构不对：要 opening／middle／closing／praise 四个键，middle 是 {prefix,text} 数组。"] };
  }
  return { draft: null, problems: ["没能解析出 JSON：只输出那个对象，不要围栏、不要解释。"] };
}

function shapeDraft(value: unknown): ChronicleDraft | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const { opening, middle, closing, praise } = record;
  if (typeof opening !== "string" || typeof closing !== "string" || typeof praise !== "string") return null;
  if (!Array.isArray(middle)) return null;
  const lines: { prefix: string; text: string }[] = [];
  for (const item of middle) {
    if (typeof item !== "object" || item === null) return null;
    const line = item as Record<string, unknown>;
    if (typeof line.prefix !== "string" || typeof line.text !== "string") return null;
    lines.push({ prefix: line.prefix.trim(), text: line.text.trim() });
  }
  return { opening: opening.trim(), middle: lines, closing: closing.trim(), praise: praise.trim() };
}

/**
 * 把这一世的专名（神种／天时／出身／器官／兽／地名）从一段字里剔掉，只留句法骨架。
 *
 * 只用于「照抄」判定：两段话若只在专名上重合，那是**同一件事只能这么称呼**，不是抄。
 * 先按长度倒序剔，免得「穷奇」先吃掉「穷奇幼崽」的一半。
 */
function stripNouns(text: string, facts: LifeFacts): string {
  const nouns = [
    facts.seedName,
    facts.skyName,
    facts.originName,
    ...facts.allowedNouns,
    // 唯一的地名，且是每一篇传都躲不开的那个词
    "青丘",
  ]
    .filter((noun) => noun.length > 0)
    .sort((a, b) => b.length - a.length);
  let out = text;
  for (const noun of nouns) out = out.split(noun).join("");
  return out;
}

/**
 * 逐条校验。返回的每条问题都是**能直接递回给模型的人话**（重试就靠它们）。
 */
/** 与模板版的最短「算照抄」片段（汉字数）。 */
export const COPY_SPAN_LIMIT = 14;

/**
 * 「这段字其实是事实本身」的判据长度。
 *
 * 六字。定这个数是实测出来的：妖王那一世的引擎旁白是「……自此山中之事，由你说了算。」，
 * 模板结局段是「……自此山中之事，皆决于其一念。」，两者真正重合的只有「自此山中之事，」
 * **七个字** —— 阈值定八就差一个字，于是一整篇写得很好的成道传被判成照抄、回落成模板版
 * （实测连着发生两次）。六字仍然够specific：中文里六个字连着一样已经不是巧合。
 */
const FACT_ECHO_LIMIT = 6;

/**
 * 「剔掉专名后仍算照抄」的骨架长度。
 *
 * 与 `FACT_ECHO_LIMIT` 分开定：那一个管「这段字是不是事实本身」，这一个管「剩下的句法
 * 还有多少是模板的」。一度共用一个常量，于是把前者从八调到六时，后者跟着变松/变紧，
 * 两个判据互相牵动 —— 那种耦合过一次就够了。
 */
const COPY_SKELETON_LIMIT = 8;

export function validateDraft(
  draft: ChronicleDraft,
  facts: LifeFacts,
  praisePrefix: string,
  /**
   * 这一世模板版的**开篇／收束／赞语**三段（不含中段）。
   *
   * 刻意不查中段：中段是引擎写的记录原句，AI 的活儿就是贴着它改写，撞上十几个字很正常
   * （「搏杀岩羊，食其精气」这类），查它只会把忠实的稿子打回去。而结局段与赞语是模板
   * **自己的文案**，撞上就是照抄。
   */
  templateFrame: string[] = [],
  limits: DraftLimits = DEFAULT_LIMITS,
): string[] {
  const problems: string[] = [];
  const segments: { label: string; text: string; min: number; max: number }[] = [
    { label: "开篇", text: draft.opening, min: limits.openingMin, max: limits.openingMax },
    { label: "收束", text: draft.closing, min: limits.closingMin, max: limits.closingMax },
    { label: "赞语", text: draft.praise, min: limits.praiseMin, max: limits.praiseMax },
    ...draft.middle.map((line, index) => ({
      label: `编年第${index + 1}条`,
      text: line.text,
      min: limits.middleMin,
      max: limits.middleMax,
    })),
  ];

  for (const segment of segments) {
    const length = [...segment.text].length;
    if (length < segment.min) problems.push(`${segment.label}太短（${length} 字，至少 ${segment.min} 字）。`);
    if (length > segment.max) problems.push(`${segment.label}太长（${length} 字，至多 ${segment.max} 字）。`);
  }

  // — 编年：条数、顺序、前缀必须与给定事实逐条对上（时间线因此不可能被编造）—
  const expected = facts.excerpts.map((excerpt) => excerpt.prefix);
  if (draft.middle.length !== expected.length) {
    problems.push(`编年应有 ${expected.length} 条，你写了 ${draft.middle.length} 条 —— 条数与顺序都不得改。`);
  }
  draft.middle.forEach((line, index) => {
    const want = expected[index];
    if (want !== undefined && line.prefix !== want) {
      problems.push(`编年第${index + 1}条的前缀应为「${want}」，你写的是「${line.prefix}」—— 前缀必须原样带回。`);
    }
  });

  const whole = [draft.opening, ...draft.middle.map((line) => line.text), draft.closing, draft.praise].join("\n");

  if (/[0-9]/u.test(whole)) problems.push("传里出现了阿拉伯数字 —— 数字一律汉字。");
  const halfwidth = HALFWIDTH_PUNCT.exec(whole);
  if (halfwidth) problems.push(`传里出现了半角标点「${halfwidth[0]}」—— 标点一律中文全角。`);
  if (whole.includes("{{") || whole.includes("}}")) problems.push("传里出现了模板占位符。");
  if (draft.praise.startsWith(praisePrefix)) problems.push(`赞语不要带「${praisePrefix}」前缀，那是排版加的。`);

  for (const word of BANNED_WORDS) {
    if (whole.includes(word)) problems.push(`传里出现了禁用词「${word}」。`);
  }

  /*
   * — 照抄模板版 —
   *
   * 有一类命中要放过：**引擎旁白与模板版说的本来就是同一句话**。归山与妖王的结局段
   * （`wayEndings`）与引擎的死亡旁白是「同一个时刻的两种结果，措辞刻意对着写」（见
   * tale-content/chronicle.ts 与 tale-sim/messages.ts 的注释），而那句旁白是我们**亲手
   * 递给模型的事实**。此时它写出相近的字是在写事，不是在抄模板 —— 打回它等于自相矛盾，
   * 而实测里这恰好把一整篇成道的好稿打成了模板版。
   */
  const factsEcho = stripNouns(
    [facts.deathText, ...facts.excerpts.map((excerpt) => excerpt.text)].join("\n"),
    facts,
  );
  for (const segment of templateFrame) {
    const shared = longestSharedSpan(whole, segment, COPY_SPAN_LIMIT);
    if (shared === null) continue;
    /*
     * 两侧都先剔专名再比：专名会把重合撑长（「凭灵蕴神种降」六个字里有四个是神种名），
     * 于是「照抄了模板开篇」会被误判成「只是在复述出生那条记录」而放过 —— 实测踩到过。
     */
    const skeleton = stripNouns(shared, facts);
    const echo = longestSharedSpan(skeleton, factsEcho, FACT_ECHO_LIMIT);
    // 只有当**重合的一多半**都是事实原句时才算「在写事」；否则那只是模板句子的尾巴恰好
    // 也出现在记录里（模板开篇的结尾「托身幼兽。」就是出生那条记录的结尾），不该据此放行
    if (echo !== null && [...echo].length * 2 >= [...skeleton].length) continue;
    /*
     * 再放过一类：**重合的其实全是专名**。开篇要交代神种、天时、出身，而那三个词是固定的
     * 名词，「降于青丘，值灵气盛，孤生」这十四个字里有九个字是它们 —— 换谁来写都得这么写，
     * 判成照抄就是在罚它把事说对（实测把一整篇成道的稿子罚成了模板版）。
     * 判据：把专名从重合片段里剔掉，剩下的**句法骨架**还够长，才是真的在抄。
     */
    if ([...skeleton].length < COPY_SKELETON_LIMIT) continue;
    problems.push(`「${shared}」是模板版的原句，照抄不算作传 —— 同一件事换你自己的说法。`);
    break;
  }

  /*
   * — 成败定性 —
   *
   * 成道那一世**不许被写成失败**。这不是文风偏好，是事实错误：玩家刚走通一条道，
   * 传里却写「未尽成道，终有不甘」（gpt-5.4-mini 实测原话），读到的是史官在否认刚发生的事。
   * 只查这一个方向：反向（败了写成成了）没有同样干净的判据 ——「离归山尚差二事」这类
   * 正当句子里也有「归山」「道」，硬查会把好稿打回去，而一次假打回既花钱又多半更差。
   */
  if (facts.way !== null) {
    const denial = /未(能|尝|及|尽)?[成得](道|其道|器)|不得成道|终未成器|功亏一篑/u.exec(whole);
    if (denial) {
      problems.push(
        `这一世走通了${facts.wayLabel}之道，是**成了** —— 传里却写「${denial[0]}」。收束与赞语必须以「成」立论。`,
      );
    }
  }

  /*
   * — 编年逐条的专名核对 —
   *
   * 全篇白名单挡不住这一类：某年那条记录只写「一口咬断。肉是暖的」（没点名），模型顺手
   * 补上一个**别的年份**才出现过的兽名（实测两次都补了「草狐」，而那一季吃的是月兔）。
   * 那个名字在白名单里，所以上面那条查不出来 —— 但它把两件事接错了年份，是货真价实的编造。
   *
   * 判据：中段某条里出现的目录专名，必须在**它自己那条记录**的原文里出现过。
   * 只在条数对得上时查（条数不对时上面已经打回，再报一遍只会淹没真正的问题）。
   */
  if (draft.middle.length === expected.length) {
    draft.middle.forEach((line, index) => {
      const source = facts.excerpts[index];
      if (source === undefined) return;
      const stray = facts.catalogNouns.filter(
        (noun) => line.text.includes(noun) && !source.text.includes(noun),
      );
      if (stray.length > 0) {
        problems.push(
          `编年第${index + 1}条原文没提到${stray.join("、")}，你不许替它点名 —— 那个名字属于别的年份。`,
        );
      }
    });
  }

  // — 编造检查：目录里的专名一旦出现，就必须是这一世真出现过的 —
  const allowed = new Set(facts.allowedNouns);
  const invented = [...new Set(facts.catalogNouns.filter((noun) => whole.includes(noun) && !allowed.has(noun)))];
  if (invented.length > 0) {
    problems.push(
      `传里出现了这一世从未出现过的专名：${invented.join("、")} —— 只准写「可用专名」里的名字，别的用泛称。`,
    );
  }

  return problems;
}
