/**
 * 史官 prompt —— 把 `LifeFacts` 摊成「事实清单」，让模型只做一件事：把它写成史传。
 *
 * ## 三条构造纪律
 * 1. **事实全部预先汉字化**。prompt 里出现一个阿拉伯数字，输出里就会出现一片 —— 实测过。
 *    代码这边把「四岁」「猛三十二」都写好，模型不必做数字转换（那是它最容易出错的一步）。
 * 2. **风格锚取自真手写事件正文**（`content.events` 里挑几条），不另写一份「风格说明书」。
 *    说明书会漂，手写正文不会：它就是这个游戏的声音本身。
 * 3. **反面锚是这一世的模板版**。给正面范文会让所有列传向那一篇收敛（同一个模子换数字，
 *    正是这一批要消灭的东西）；给「读起来像填空题的那一版」并要求不得沿用其整句，
 *    压力方向是发散的，且它逐世不同。
 */

import { cnNumeral, type TaleContent } from "@shiling/tale-sim";
import type { ChatMessage } from "./gateway.js";
import type { ChronicleDraft, LifeFacts } from "./types.js";

/** 汉字数字：`cnNumeral` 只覆盖 0〜99，而属性上限是 100（夹紧值），补掉那一格。 */
function cn(value: number): string {
  return value === 100 ? "一百" : cnNumeral(value);
}

/**
 * 风格锚事件 id —— 四条手写正文，覆盖「取舍的重量／神异／死气／清冷」四种调子。
 *
 * 用 id 点名而不是随便取前四条：随便取会撞上同一池（狩猎池全在讲饱腹的代价），
 * 锚的方差不够，模型只学到一种腔调。内容里若改了 id，`fallbackAnchors` 兜底不至于空手。
 */
const ANCHOR_EVENT_IDS = [
  "qiu-hunt-fawn",
  "qiu-explore-yinglong",
  "qiu-explore-fox-grave",
  "qiu-explore-cicada",
] as const;

export function styleAnchors(content: TaleContent, limit = 4): string[] {
  const byId = new Map(content.events.map((event) => [event.id, event]));
  const picked = ANCHOR_EVENT_IDS.map((id) => byId.get(id)).filter(
    (event): event is NonNullable<typeof event> => event !== undefined,
  );
  const fallback = picked.length > 0 ? picked : content.events.slice(0, limit);
  return fallback.slice(0, limit).map((event) => event.body);
}

/**
 * 开篇的**起法**，按 `LifeFacts.variant`（＝这一局的 seed）轮转。
 *
 * 为什么要有这张表：只写「换一种起法」时，三篇传实测仍然收敛成同一句
 * 「常胎降于青丘，值某某」——模型自己找到了一个安全模板，而「三篇是否雷同」这一问
 * 首先看的就是第一句。给它一个**指定的切入角**，收敛就没了。
 *
 * 轮转键取 seed 而不是随机数：同一局重放必须得到同一篇（架构红线 1）。
 */
export const OPENING_ANGLES: readonly string[] = [
  "从**天时**起笔：先写这一年青丘是什么光景，再让食灵出现在这个光景里。",
  "从**结局**倒叙：第一句就点出它是怎么终的，再回头说它从哪来。",
  "从**出身的异相**起笔：先写它生下来与别的兽哪里不一样，再交代神种与天时。",
  "从**一世的总账**起笔：先把寿数、器官、蜕、杀这几个数摆出来，再说它是谁。",
  "从**一个具体的时刻**起笔：拈编年里最要紧的那一件事开头，再倒回降生。",
  "从**太史氏的口气**起笔：先下一句判语（这是一头什么样的兽），再用事实印证。",
];

/** 事实清单（user 消息的正文）。导出是为了让测试与实验台能逐字读它。 */
export function factsBlock(facts: LifeFacts): string {
  const organLine =
    facts.organs.length === 0
      ? "无"
      : facts.organs.map((organ) => `${organ.name}〔${organ.slotLabel}〕`).join("、");
  const wayLine =
    facts.way !== null
      ? `已成${facts.wayLabel}之道（${facts.nearestWay.total}事既备）`
      : facts.nearestWay.shortfalls.length === 0
        ? `最近${facts.nearestWay.label}，诸事既备而未及成道`
        : `最近${facts.nearestWay.label}，备${cn(facts.nearestWay.met)}事于${cn(facts.nearestWay.total)}，${facts.nearestWay.shortfalls.join("、")}`;

  const lines = [
    "【本世前提】",
    `神种：${facts.seedName} —— ${facts.seedDesc}`,
    `天时：${facts.skyName} —— ${facts.skyDesc}`,
    `出身：${facts.originName} —— ${facts.originDesc}`,
    "",
    "【一世总账】",
    `寿：${facts.years > 0 ? `${cn(facts.years)}岁` : "未及一岁"}　器官：${cn(facts.organs.length)}（${organLine}）　蜕：${cn(facts.moltCount)}　搏杀取胜：${cn(facts.killCount)}　亲手夺命：${cn(facts.livesTaken)}`,
    `猛${cn(facts.stats.meng)}　灵${cn(facts.stats.ling)}　体${cn(facts.stats.ti)}　德${cn(facts.stats.de)}`,
    `收束：${facts.endingLabel}${facts.killerName === null ? "" : `（死于${facts.killerName}之口）`}`,
    `引擎旁白（死时那一句，可化用不可照抄）：${facts.deathText}`,
    `成道进度：${wayLine}`,
    /*
     * 这一行是**给收束与赞语的定性**，不是补充信息。
     * 实测（gpt-5.4-mini）：一世明明成了妖王之道，收束却写成「寿终而未尽成道……终有不甘」
     * ——模型把「十四岁就死了」读成了失败。成与败是这篇传的立场，读者刚打完这一世，
     * 立场错了整篇就废了，所以由代码判定后直接写死在事实里。
     */
    facts.way !== null
      ? `【定性：这一世是**成了**】走通了${facts.wayLabel}之道。收束与赞语必须以「成」立论 —— 不许写成寿数未尽的遗憾、不许说未成道、不许惋惜其短命。${facts.wayLabel === "归山" ? "归山本就是寿终而成，「卧于旧穴而化」是圆满不是失败。" : ""}`
      : `【定性：这一世是**败了**】未走通任何一条道。收束要写出「差在哪」，让人不甘；不许写成圆满，也不许说它成了道。`,
  ];
  if (facts.moltNames.length > 0) lines.push(`本世蜕出：${facts.moltNames.join("、")}`);
  if (facts.killedNames.length > 0) lines.push(`本世搏杀取胜者：${facts.killedNames.join("、")}`);

  lines.push(
    "",
    "【编年 —— 逐条改写成史笔，前缀原样带回，条数与顺序不变】",
    /*
     * 前缀用「前缀「三岁秋」」这种带引号的写法，而不是行首编号 ＋ 前缀。
     * 实测（gpt-5.4-mini）：写成「一．初岁春 ｜ …」时模型会把序号也当成前缀的一部分带回来
     * （吐出「一．初岁春」），白白吃掉一次重试。序号对模型没有用处 —— 顺序由行序表达。
     */
    /*
     * 没点名的那几条**当场标出来**。只在铁律里写一句「原文没点名的你也不许点名」不够 ——
     * 实测模型仍会给「一口咬断。肉是暖的」补一个别的年份才出现的兽名（连着两次都补「草狐」，
     * 而那一季吃的是月兔）。把警告贴在那一条旁边，命中率立竿见影。
     */
    ...facts.excerpts.map((excerpt) => {
      const named = facts.catalogNouns.some((noun) => excerpt.text.includes(noun));
      return `前缀「${excerpt.prefix}」｜${excerpt.text}${named ? "" : "　⟪此条原文未点名，你也不许替它安上任何兽名／器官名⟫"}`;
    }),
    "",
    "【可用专名 —— 传中只准出现这些器官名／兽名／神种名，别的一个字也不许添】",
    facts.allowedNouns.length > 0 ? facts.allowedNouns.join("、") : "（无）",
  );
  return lines.join("\n");
}

export const SYSTEM_PROMPT = [
  "你是《食灵·列传》的太史氏。青丘有兽名食灵，凭神种降世，历劫而死，你为它作传。",
  "读者是刚打完这一世的玩家：他记得自己做过的每一件事，所以传里每一句都要对得上，且要让他读出自己没读出来的意思。",
  "",
  "## 体例",
  "· 史记列传笔法：文言与白话相杂，短句为主，叙事在前、判语在后。不要小说腔，不要抒情长句，不要形容词堆叠。",
  "· 数字一律汉字（三岁、二器、十七），**绝不出现阿拉伯数字**。标点一律中文全角。",
  "· 主角**无名**，称「食灵」「其」「兽」，不得起名、不得称「你」「我」。",
  "· 全篇不出现「玩家」「系统」「属性」「回合」「数值」等游戏词。",
  "",
  "## 结构（四段，缺一不可）",
  "· 开篇：交代神种、出身、天时、一世总账（寿数／器官／蜕／杀）与四属性之偏。要一口气读完，六十至一百二十字。",
  "· 中段：给定的编年逐条改写。每条前缀（如「三岁秋」）原样带回，条数、顺序都不得改。每条二十至五十字，写那一年那一季发生的那件事本身，不要提前剧透结局。",
  "· 收束：这一世怎么终的。四十至一百字。寿终而未成道是**失败**，要写得让人不甘；成道则按其道分口吻（登神超脱、妖王权柄、归山全寿、化灵无迹）。",
  "· 赞曰：太史氏的判语，三十至八十字。要有立场——褒、贬、惜、讥皆可，但必须是这一世独有的话，不能换个名字放在别的传里也成立。",
  "",
  "## 铁律",
  "· **只准写给定事实**。给定之外的兽、人、地、器、神，一个也不许出现；给定的事也不许改年份、改数目、改死因。",
  "· 「可用专名」之外的器官名与兽名一律禁止 —— 宁可写「山中之物」「爪牙」这类泛称。",
  "· **原文没点名的，你也不许替它点名**。编年某条只说「一口咬断」而没说咬的是什么，就照旧不说；给它安一个「可用专名」里的兽同样是编造 —— 那个名字属于别的年份。",
  "· 不许照抄示例与模板版的整句（连着十几个字一样就算照抄，会被打回重写）。",
  /*
   * 这一条是**实测打出来的**：12 世里有 5 世的开篇原样搬了模板版那句「食灵者，无名，凭…
   * 降于青丘，值…」——那是模板的填空骨架，恰恰是这一批要消灭的东西。它同时还是
   * 「三篇互不雷同」的死穴：起句一样，后面写得再好也像同一篇。
   */
  "· **开篇尤其不许套模板版的起句骨架**（「某某者，无名，凭某某降于某地，值某某」这一路）。换一种起法：从天时起笔、从出身起笔、从死法倒叙、从某一年的一件事起笔皆可 —— 每一篇都该有自己的第一句。",
  "",
  "## 输出",
  "只输出一个 JSON 对象，不要代码围栏、不要解释：",
  '{"opening":"…","middle":[{"prefix":"初岁春","text":"…"}],"closing":"…","praise":"…"}',
  "praise 里**不要**写「赞曰：」三字，那是排版加的。",
].join("\n");

export interface PromptInput {
  facts: LifeFacts;
  /** 手写事件正文（语感锚） */
  anchors: string[];
  /** 这一世的模板版列传正文（反面锚 —— 要求写得比它更像史书，且不得沿用其整句） */
  templateBody: string;
}

export function openingAngle(facts: LifeFacts): string {
  return OPENING_ANGLES[facts.variant % OPENING_ANGLES.length] ?? OPENING_ANGLES[0] ?? "";
}

export function buildMessages(input: PromptInput): ChatMessage[] {
  const anchorBlock = input.anchors.map((text, index) => `${cn(index + 1)}．${text}`).join("\n");
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        "【语感锚 —— 本作手写正文，学它的呼吸与句长，不要抄它的句子】",
        anchorBlock,
        "",
        "【模板版（这一世的，读起来像填空题）—— 你要写得比它更像史书，且不得沿用其中任何整句】",
        input.templateBody,
        "",
        factsBlock(input.facts),
        "",
        `【本篇起法（这一篇专属，别的传另有起法）】${openingAngle(input.facts)}`,
        "",
        "现在作传。只输出那个 JSON 对象。",
      ].join("\n"),
    },
  ];
}

/** 校验打回后的纠正消息：把上一稿与逐条问题原样递回去，比重述规则有效。 */
export function retryMessages(base: ChatMessage[], raw: string, problems: string[]): ChatMessage[] {
  return [
    ...base,
    { role: "assistant", content: raw },
    {
      role: "user",
      content: [
        "上一稿不合格，逐条问题如下：",
        ...problems.map((problem, index) => `${cn(index + 1)}．${problem}`),
        "",
        "按同样的体例重写一遍，修掉上列全部问题，其余部分不必刻意保留。仍然只输出那个 JSON 对象。",
      ].join("\n"),
    },
  ];
}

/**
 * 把草稿拼成列传正文 —— **结构由代码定**（开篇／中段／收束／赞曰），AI 只提供各段文字。
 *
 * 拼法与 `composeChronicle` 完全一致（行分隔、`praisePrefix` 前缀），所以客户端的
 * `splitChronicleBody` 不必知道这一篇是谁写的：AI 版与模板版在卷轴上走同一条排版路径。
 */
export function assembleBody(draft: ChronicleDraft, praisePrefix: string): string {
  return [
    draft.opening,
    ...draft.middle.map((line) => `${line.prefix}，${line.text}`),
    draft.closing,
    praisePrefix + draft.praise,
  ].join("\n");
}
