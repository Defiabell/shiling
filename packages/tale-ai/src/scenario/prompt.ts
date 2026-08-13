/**
 * 一世一剧本的 prompt —— 把**槽位规格**摊成模型看得懂的规格书。
 *
 * ## 与史官 prompt 的分工不同
 * 史官那边给的是「事实清单」（发生过什么），这边给的是「骨架」（允许发生什么）。
 * 所以这里最要紧的一段不是文风，而是**每个分支允许出现哪些字段、各自的区间** ——
 * 那一段写得含糊，回来的就是一堆越界值，每一条都得重试，钱和时间一起烧。
 *
 * ## 三条构造纪律（前两条继承自 P1，第三条是这一批新长出来的）
 * 1. **风格锚取自真手写事件正文**，不另写「风格说明书」：说明书会漂，手写正文不会。
 * 2. **数字在正文里一律汉字**；只有 `effects` 里的数是阿拉伯数字（那是机器读的字段）。
 *    这两件事必须在同一句话里说清，否则模型要么在正文里写「30 点饱食」，要么把
 *    `effects` 写成「三十」——两种都实测过。
 * 3. **去重对照表进 prompt**：手写事件的标题与一句梗概全给它，并明写「不得与其中任何一条
 *    撞题材」。机械去重（`validate.ts` 的最长公共片段）只挡得住抄字面，挡不住「又一条捡腐肉」。
 */

import { cnNumeral } from "@shiling/tale-sim";
import type { ChatMessage } from "../gateway.js";
import type { BudgetKey, ChoiceSpec, OutcomeSpec, SlotSpec } from "./types.js";

/** 预算键的人话名 —— 规格书里写「饱食」比写 `hunger` 好读，回复里仍用英文键。 */
const BUDGET_LABELS: Record<BudgetKey, string> = {
  "stat.meng": "猛（属性）",
  "stat.ling": "灵（属性）",
  "stat.ti": "体（属性）",
  "stat.de": "德（属性）",
  hunger: "饱食",
  lifespan: "寿元（岁）",
  "essence.zu": "足之精气",
  "essence.lin": "鳞之精气",
  "essence.xue": "穴之精气",
  "essence.meng": "猛之精气",
};

/**
 * 风格锚事件 id —— 四条手写正文，覆盖「取舍的重量／神异／死气／清冷」四种调子。
 *
 * 与史官用同一组（`prompt.ts` 的 `ANCHOR_EVENT_IDS`）：那四条是这个游戏的声音本身，
 * 两处该学的是同一种呼吸。内容改了 id 时 `fallback` 兜底不至于空手。
 */
const ANCHOR_EVENT_IDS = [
  "qiu-hunt-fawn",
  "qiu-explore-yinglong",
  "qiu-explore-fox-grave",
  "qiu-explore-cicada",
] as const;

export interface ScenarioPromptInput {
  /** 本批要写的槽位 */
  slots: readonly SlotSpec[];
  /** 少样本风格锚（手写事件的完整数据，含抉择与结果，让模型看清「一条事件长什么样」） */
  anchors: string[];
  /** 全部手写事件的「标题 ｜ 一句梗概」，去重对照用 */
  writtenDigest: string[];
  /** 这一世的前提（天时 ＋ 出身），每一批都要重申 —— 批之间没有共享记忆 */
  premiseBlock: string;
}

export const SCENARIO_SYSTEM_PROMPT = [
  "你是《食灵·列传》的内容作者。这是一款山海经志怪题材的图文事件流游戏：玩家扮演青丘的一头「食灵」幼兽，每一季选一个行动，路上撞见事件，在两三个选项之间做取舍，一世而终。",
  "现在有人已经把这一世要发生的几桩事的**骨架**搭好了（触发条件、每个选项落什么账、数值区间都定死了）。你的活儿只有两样：**编出那个故事**，**在给定区间里挑几个数**。",
  "",
  "## 文风（照着少样本学，不要另起一路）",
  "· 第二人称。称玩家为「你」，这是事件卡的固定人称（与列传不同，那里才用「其」）。",
  "· 短句为主，白描。写具体的东西：气味、声音、光、泥、血、温度。不要抒情，不要形容词堆叠，不要解释道理。",
  "· 正文六十至一百五十字，一至两段。结尾常常悬在半空（「它太直了，直得不像山里长出来的。可肉香是真的。」），把判断留给玩家。",
  "· 标题两到六字，文言体（「丛中窥影」「腐肉之宴」「月下白兔」）。",
  "· 选项字面二到八字，是**动作**不是评论（「取其咽喉」「掩鼻而去」「远远绕开」「以甲当之」）。",
  /*
   * 这一条是实测打出来的：`gpt-5.4-mini` 把每一条的三个选项都写成了「贪X／稳X／让X」
   * ——十六条事件一眼看过去是同一个模子。而「能不能分辨哪些是 AI 写的」这一问，
   * 玩家最先看到的就是那三颗按钮。
   */
  "· **选项字面不许用固定的构词法**。不要每条事件都写成「贪某／稳某／让某」这种同一个模子；每一条的三颗按钮都该是那一桩事里具体的三个动作。",
  "· 正文里**不许写死岁数**（「你三岁那年……」）：同一条事件可能在任何一年被撞上。",
  "· 全篇只准出现汉字与中文标点，不许混进任何外文、拉丁字母或符号。",
  "· 结果文案二十至六十字，写那一下发生了什么，同样是白描。",
  "· **正文与文案里的数字一律汉字**（三步、半刻、一整夜），绝不出现阿拉伯数字；标点一律中文全角。",
  "· 不出现「玩家」「系统」「属性」「回合」「数值」这类游戏词 —— 事件卡上只有那头兽眼前的世界。",
  "",
  "## 铁律",
  "· **不许写给定骨架之外的任何机制**：不许在文案里承诺「从此每年多一次狩猎」这类持续效果，不许写玩家获得了某件器官，不许写玩家死了或成道了。落账只有 effects 那几个数。",
  "· **不许出现具名的兽、人、神、器**（白泽、应龙、穷奇、山魈、玄蟒、狩齿、夜瞳……都不行），除非骨架在某个分支里明写了它。要提就用泛称：「山中之物」「那东西」「一头没见过的兽」。",
  "· **每个选项都必须是真选项**。不许出现「在所有方面都不比别的选项差、还至少有一样更好」的选项 —— 那不是取舍，是送分。让不同选项各强在不同的地方（这个多食，那个多德；这个稳当，那个赌大的）。",
  "· **不许与已有事件撞题材**（清单在下面）。同一件事换个说法不算新的一世。",
  /*
   * 这一条是实测打出来的：母题给「人留下的东西」，模型顺手写成了「把藏在草下那人拖出来，
   * 松口时他已经没了气」。人的那条线在内容库里挂着 `hunted` flag（被人记恨，猎人循迹而来），
   * 生成事件碰不到那个 flag —— 于是杀了一个人却什么后果都没有，故事与机制当场脱节。
   */
  "· **人只以痕迹出现**：绳、碗、火塘、烟、断篱、脚印。不许写与人当面遭遇，更不许写杀人 —— 那条线已经有专门的事件在管。",
  "· 标题不许直接用天时／出身的名字（「兽潮」「大旱之年」「孤生」这些），那是屏幕上另有一处在写的东西。",
  "· effects 里**只准出现规格里列出的键**，值必须是整数且落在给定区间内。可以不写某个键（等于零），但不许添键、不许越界。",
  "",
  "## 输出",
  "只输出一个 JSON 对象，不要代码围栏、不要解释：",
  '{"events":[{"id":"…","title":"…","body":"…","choices":[{"label":"…","outcomes":[{"text":"…","effects":{"hunger":24,"essence.zu":12}}]}]}]}',
  "id 必须逐字照抄规格里的那一个。choices 的条数与顺序、每个 choice 里 outcomes 的条数与顺序，都必须与规格完全一致。",
  "effects 里的数是给机器读的，**用阿拉伯数字**（这是唯一的例外，正文与文案里仍然一律汉字）。",
].join("\n");

/** 一条前提的规格块（天时 ＋ 出身）。每批都重申一次 —— 批与批之间没有共享上下文。 */
export function premiseBlock(sky: { name: string; effect: string; desc: string }, origin: { name: string; effect: string; desc: string }): string {
  return [
    "【这一世的前提 —— 十六条事件都长在它上面】",
    `天时：${sky.name} —— ${sky.desc}（机制：${sky.effect}）`,
    `出身：${origin.name} —— ${origin.desc}（机制：${origin.effect}）`,
  ].join("\n");
}

function rangeText(min: number, max: number): string {
  return min === max ? `恒为 ${min}` : `${min} 〜 ${max}`;
}

function outcomeBlock(outcome: OutcomeSpec, index: number, total: number): string[] {
  const lines: string[] = [];
  const share = total > 1 ? `（抽中权重 ${outcome.weight}）` : "";
  lines.push(`    结果之${cnNumeral(index + 1)}${share}：${outcome.brief}`);
  const fixed: string[] = [];
  if (outcome.fixed.startCombat !== undefined) {
    fixed.push("这一支**当场转入搏杀**（由骨架落账，你只写到「打起来了」为止，不要写谁赢）");
  }
  if (outcome.fixed.takesLife !== undefined && outcome.fixed.takesLife > 0) {
    fixed.push(
      `这一支**取了 ${outcome.fixed.takesLife} 条命**——文案里必须看得出是从活物身上下来的`,
    );
  }
  if (outcome.fixed.addFlags && outcome.fixed.addFlags.length > 0) {
    // 具体是哪一种身体状态写在 `brief` 里（见 slots.ts 的 `FLAG_LABELS`）——
    // 只说「挂彩」会让模型写出与状态栏对不上的外伤
    fixed.push("这一支会让你落下上面那种身体状态（骨架已落账，文案要写出来）");
  }
  if (fixed.length > 0) lines.push(`      · ${fixed.join("；")}`);
  const budget = Object.entries(outcome.budget)
    .map(([key, span]) =>
      span === undefined ? "" : `${key}（${BUDGET_LABELS[key as BudgetKey]}）${rangeText(span.min, span.max)}`,
    )
    .filter((item) => item.length > 0);
  lines.push(
    budget.length > 0
      ? `      · 可填字段：${budget.join("　")}`
      : "      · 可填字段：无（effects 写成空对象 {}）",
  );
  return lines;
}

function choiceBlock(choice: ChoiceSpec, index: number): string[] {
  const gate =
    choice.gateHint === undefined
      ? ""
      : `（只有长出了这样东西才点得开：${choice.gateHint}——选项字面与文案都要让人看出凭的正是它，但**不许写出器官的名字**）`;
  const lines = [`  选项${cnNumeral(index + 1)}：${choice.brief}${gate}`];
  for (const [outcomeIdx, outcome] of choice.outcomes.entries()) {
    lines.push(...outcomeBlock(outcome, outcomeIdx, choice.outcomes.length));
  }
  return lines;
}

export function slotBlock(slot: SlotSpec): string {
  const lines = [
    `── 槽位 ${slot.id} ──`,
    `场合：${slot.actionLabel}　时机：${slot.timing}`,
    `母题（必须落在这个切入角上）：${slot.motif}`,
  ];
  if (slot.echo.kind !== "none") {
    lines.push(
      `**必须呼应这一世的${slot.echo.kind === "sky" ? "天时" : "出身"}「${slot.echo.name}」**：${slot.echo.brief}`,
      `　要写出它的一个**具体情节**（不是「今年天时不好」这种放之四海皆准的句子）。正文里至少要出现下列字词之一：${slot.echo.keywords.join("、")}`,
    );
  }
  for (const [index, choice] of slot.choices.entries()) {
    lines.push(...choiceBlock(choice, index));
  }
  return lines.join("\n");
}

/** 手写事件的少样本（完整一条，含抉择与结果）—— 让模型看清「一条事件长什么样」。 */
export function styleAnchor(event: {
  title: string;
  body: string;
  choices: readonly { label: string; outcomes: readonly { text: string }[] }[];
}): string {
  const choices = event.choices
    .map((choice) => `  ・${choice.label} → ${choice.outcomes.map((outcome) => outcome.text).join(" ／ ")}`)
    .join("\n");
  return `《${event.title}》\n${event.body}\n${choices}`;
}

export function styleAnchors(
  events: readonly {
    id: string;
    title: string;
    body: string;
    choices: readonly { label: string; outcomes: readonly { text: string }[] }[];
  }[],
  limit = 4,
): string[] {
  const byId = new Map(events.map((event) => [event.id, event]));
  const picked = ANCHOR_EVENT_IDS.map((id) => byId.get(id)).filter(
    (event): event is NonNullable<typeof event> => event !== undefined,
  );
  const source = picked.length > 0 ? picked : events.slice(0, limit);
  return source.slice(0, limit).map(styleAnchor);
}

/** 去重对照：每条手写事件一行「标题 ｜ 前二十字」。 */
export function writtenDigest(events: readonly { title: string; body: string }[]): string[] {
  return events.map((event) => `${event.title}｜${[...event.body].slice(0, 20).join("")}…`);
}

export function buildScenarioMessages(input: ScenarioPromptInput): ChatMessage[] {
  return [
    { role: "system", content: SCENARIO_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        "【少样本 —— 本作手写事件的原样，学它的呼吸、句长与取舍的重量，不要抄它的字】",
        input.anchors.join("\n\n"),
        "",
        input.premiseBlock,
        "",
        "【已有事件（不得与其中任何一条撞题材）】",
        input.writtenDigest.join("\n"),
        "",
        `【本批要写 ${input.slots.length} 条，逐条按骨架填】`,
        input.slots.map(slotBlock).join("\n\n"),
        "",
        "现在写。只输出那个 JSON 对象。",
      ].join("\n"),
    },
  ];
}

/**
 * 校验打回后的重问 —— **只重问没过的那几条，且不带上一稿**。
 *
 * P1 史官那边是「把上一稿与逐条问题原样递回去」，这一批刻意不这么做，理由是尺寸：
 * 一批四条事件的回复有三四千 token，把它塞回对话再要求「合格的那几条也照原样输出一遍」，
 * 等于为了修一条正文短了三个字而重跑整批 —— 实机第一轮里，三批都是这样卡进预算的
 * （一发 60〜85s，两发就到 170s）。
 *
 * 换成「拿剩下的槽位重新出一份规格书 ＋ 逐条问题」之后，重试的输入与输出都只有原来的
 * 四分之一到二分之一。问题本身自带槽位 id 与具体判据，**自足**，不需要上一稿当上下文。
 */
export function retryScenarioMessages(base: ChatMessage[], problems: string[]): ChatMessage[] {
  const tail = base[base.length - 1];
  if (tail === undefined) return base;
  return [
    ...base.slice(0, -1),
    {
      role: tail.role,
      content: [
        tail.content,
        "",
        "⚠️ 上一稿这几条没过，逐条问题如下 —— 这一次必须全部避开：",
        ...problems.map((problem, index) => `${cnNumeral(index + 1)}．${problem}`),
      ].join("\n"),
    },
  ];
}
