/**
 * 质量闸门 —— **每一条断言都对着一种实测见过的坏稿**。
 *
 * 这一层的存在理由是计划里那句「质量闸门必须是自动的，不靠人眼」：十六条事件一世一生成，
 * 没人有工夫逐条读。所以每一种坏法都必须能在 `pnpm test` 里被钉住，而不是靠下一次手测撞见。
 *
 * 最要紧的是「严格占优」那一组：它先在**手写 51 条**上校准（不许把人写的好内容判成坏内容），
 * 再在合成的坏例上验灵（真占优必须报出来）。一道只会返回「0 条」的闸门是装饰。
 */

import { describe, expect, it } from "vitest";
import { createLife, type TaleEvent } from "@shiling/tale-sim";
import { EVENTS, SEED_CHANG_TAI, TALE_CONTENT } from "@shiling/tale-content";
import {
  assembleEvent,
  auditEvent,
  buildSlots,
  dominancePairs,
  midpointDraft,
  parseScenarioReply,
  validateEventDraft,
  type EventDraft,
  type SlotSpec,
} from "../src/index.js";

const CONTENT = TALE_CONTENT;
const SLOTS: SlotSpec[] = buildSlots(createLife(20260813, SEED_CHANG_TAI, CONTENT), CONTENT).slots;

/** 取一个「三选项：贪／稳／德」的槽位 —— 那是最典型的一副骨架。 */
const SLOT = SLOTS.find((slot) => slot.choices.length === 3 && slot.echo.kind !== "none") ?? SLOTS[0]!;

/**
 * 一段合规正文。
 *
 * 末句**由槽位自己的母题词拼出来**，不是写死的：`SLOT` 是从这一世的骨架里挑的，
 * 它呼应哪一条前提取决于种子。写死一句「大旱」的正文，换个种子这份基线就自己红了 ——
 * 那种红不说明代码坏了，只说明测试写错了地方。
 */
const BODY =
  "沟底的石头一块块露出来，露出来的地方结着白痕。你把鼻子探进那点残余里，泥腥压过一切。" +
  "底下有什么在动，动得很慢，像是也快撑不住了。风从对面过来，带着一股说不清的味道。" +
  `这一带处处都是${SLOT.echo.keywords[0] ?? "旧"}的痕迹。`;

function draftOf(overrides: Partial<EventDraft> = {}): EventDraft {
  const base = midpointDraft(SLOT);
  return {
    id: base.id,
    title: "涸溪残影",
    body: BODY,
    choices: base.choices.map((choice, index) => ({
      label: ["探爪取之", "伏而不动", "退开让路"][index] ?? "远远绕开",
      outcomes: choice.outcomes.map((outcome, outcomeIdx) => ({
        text: ["泥水里那点东西被你按住了，凉的，还在抖。", "你把它留在原处，转身沿着干河床往上走。"][
          outcomeIdx
        ] ?? "你退开三十步，把那点残水留给它。",
        effects: outcome.effects,
      })),
    })),
    ...overrides,
  };
}

function check(draft: EventDraft, slot: SlotSpec = SLOT): string[] {
  return validateEventDraft(
    draft,
    assembleEvent(slot, draft),
    {
      slot,
      writtenTitles: EVENTS.map((event) => event.title),
      writtenBodies: EVENTS.map((event) => event.body),
      forbiddenNouns: ["白泽", "应龙", "穷奇", "夜瞳", "狩齿", "玄蟒"],
      premiseNames: ["大旱之年", "孤生"],
      accepted: [],
    },
    CONTENT,
  );
}

describe("解析容错", () => {
  it("整段就是 JSON", () => {
    expect(parseScenarioReply('{"events":[]}').drafts).toEqual([]);
  });

  it("包在代码围栏里也认", () => {
    const raw = '```json\n{"events":[{"id":"a","title":"b","body":"c","choices":[]}]}\n```';
    expect(parseScenarioReply(raw).drafts[0]?.id).toBe("a");
  });

  it("结构不对时报出人话（能直接递回给模型）", () => {
    expect(parseScenarioReply('{"events":"nope"}').problems[0]).toContain("JSON 结构不对");
  });

  it("完全不是 JSON 时不抛", () => {
    expect(parseScenarioReply("我先解释一下……").problems[0]).toContain("没能解析出 JSON");
  });

  it("effects 里的非数字当结构错处理（不许把 \"三十\" 静默吞掉）", () => {
    const raw = '{"events":[{"id":"a","title":"b","body":"c","choices":[{"label":"x","outcomes":[{"text":"y","effects":{"hunger":"三十"}}]}]}]}';
    expect(parseScenarioReply(raw).drafts).toEqual([]);
  });
});

describe("基线：一份好稿", () => {
  it("按骨架填的中值草稿 ＋ 合规文案 → 零问题", () => {
    expect(check(draftOf())).toEqual([]);
  });
});

describe("① 数值区间与字段白名单", () => {
  it("越界报出区间", () => {
    const draft = draftOf();
    const first = draft.choices[0]?.outcomes[0];
    if (first) first.effects.hunger = 999;
    expect(check(draft).some((problem) => problem.includes("越界"))).toBe(true);
  });

  it("**添了一个本支没声明的键**要报（比越界更要紧：那是在自己发明作用域）", () => {
    const draft = draftOf();
    const first = draft.choices[0]?.outcomes[0];
    if (first) (first.effects as Record<string, number>)["lifespan"] = 2;
    expect(check(draft).some((problem) => problem.includes("不许出现的键"))).toBe(true);
  });

  it("小数要报", () => {
    const draft = draftOf();
    const first = draft.choices[0]?.outcomes[0];
    if (first) first.effects.hunger = 20.5;
    expect(check(draft).some((problem) => problem.includes("必须是整数"))).toBe(true);
  });
});

describe("② 严格占优", () => {
  it("**手写 51 条一条都不误伤** —— 闸门先要不冤枉人写的好内容", () => {
    const flagged = EVENTS.filter((event) => dominancePairs(event).length > 0);
    expect(flagged.map((event) => event.id)).toEqual([]);
  });

  it("真占优必须报出来：同形状的两个选项，一个每一维都不差还多给", () => {
    const event: TaleEvent = {
      id: "x",
      trigger: { region: "qingqiu", weight: 10 },
      title: "试",
      body: "试",
      choices: [
        { label: "甲", outcomes: [{ weight: 1, text: "", effects: { hunger: 16, stats: { ling: 3, de: 2 } } }] },
        { label: "乙", outcomes: [{ weight: 1, text: "", effects: { hunger: 4, stats: { ling: 1, de: 2 } } }] },
      ],
    };
    expect(dominancePairs(event)).toEqual([[0, 1]]);
  });

  it("各强一维就不是占优（那正是抉择该有的样子）", () => {
    const event: TaleEvent = {
      id: "x",
      trigger: { region: "qingqiu", weight: 10 },
      title: "试",
      body: "试",
      choices: [
        { label: "甲", outcomes: [{ weight: 1, text: "", effects: { hunger: 16 } }] },
        { label: "乙", outcomes: [{ weight: 1, text: "", effects: { stats: { de: 4 } } }] },
      ],
    };
    expect(dominancePairs(event)).toEqual([]);
  });

  it("门槛是价钱：带门槛的选项比裸选项强不算占优", () => {
    const event: TaleEvent = {
      id: "x",
      trigger: { region: "qingqiu", weight: 10 },
      title: "试",
      body: "试",
      choices: [
        {
          label: "甲",
          requires: { organTags: ["swift"] },
          outcomes: [{ weight: 1, text: "", effects: { hunger: 30 } }],
        },
        { label: "乙", outcomes: [{ weight: 1, text: "", effects: { hunger: 4 } }] },
      ],
    };
    expect(dominancePairs(event)).toEqual([]);
  });

  it("取命数不同即不可比（妖王要它多、化灵要它是零，一条轴两端都有人要）", () => {
    const event: TaleEvent = {
      id: "x",
      trigger: { region: "qingqiu", weight: 10 },
      title: "试",
      body: "试",
      choices: [
        { label: "甲", outcomes: [{ weight: 1, text: "", effects: { hunger: 30, takesLife: 1 } }] },
        { label: "乙", outcomes: [{ weight: 1, text: "", effects: { hunger: 4 } }] },
      ],
    };
    expect(dominancePairs(event)).toEqual([]);
  });

  it("骨架允许的区间里真的存在占优组合 —— 否则这道闸门是装饰", () => {
    const slot = SLOTS.find((s) => s.choices.some((c) => c.kind === "prudent") && s.choices.some((c) => c.kind === "virtue"));
    expect(slot).toBeDefined();
    if (!slot) return;
    const draft = midpointDraft(slot);
    const prudentIdx = slot.choices.findIndex((choice) => choice.kind === "prudent");
    const virtueIdx = slot.choices.findIndex((choice) => choice.kind === "virtue");
    // 稳档写满、德档写到最低：那就是「德档没人会点」
    const prudentEffects = draft.choices[prudentIdx]?.outcomes[0]?.effects as Record<string, number>;
    const virtueEffects = draft.choices[virtueIdx]?.outcomes[0]?.effects as Record<string, number>;
    for (const [key, span] of Object.entries(slot.choices[prudentIdx]?.outcomes[0]?.budget ?? {})) {
      if (span) prudentEffects[key] = span.max;
    }
    for (const key of Object.keys(virtueEffects)) virtueEffects[key] = 0;
    // 两边的德给成一样：德那一维不劣，稳档在别的维上多给，就是严格占优
    virtueEffects["stat.de"] = 2;
    prudentEffects["stat.de"] = 2;
    expect(dominancePairs(assembleEvent(slot, draft)).length).toBeGreaterThan(0);
  });
});

describe("③ 长度、标点与用词纪律", () => {
  it("正文太短要报", () => {
    expect(check(draftOf({ body: "太短了。" })).some((p) => p.includes("正文太短"))).toBe(true);
  });

  it("半角标点要报", () => {
    expect(check(draftOf({ body: `${BODY.slice(0, -1)}, ` })).some((p) => p.includes("半角标点"))).toBe(true);
  });

  it("正文里的阿拉伯数字要报（effects 里的不算）", () => {
    expect(check(draftOf({ body: `${BODY}走了30步。` })).some((p) => p.includes("阿拉伯数字"))).toBe(true);
  });

  it("**混进外文字符**要报 —— gpt-5.4-mini 实测在正文中间吐过一串阿拉伯文", () => {
    const problems = check(draftOf({ body: BODY.replace("泥腥", "تازه泥腥") }));
    expect(problems.some((p) => p.includes("非中文字符"))).toBe(true);
  });

  it("**写死岁数**要报 —— 同一条事件可能在任何一年被撞上", () => {
    expect(check(draftOf({ body: `${BODY.slice(0, 60)}你三岁那年就记住了这条河床的形状，直到今天。` }))
      .some((p) => p.includes("写死了岁数"))).toBe(true);
  });

  it("**规格书的词漏进文案**要报 —— 实测拿回来过一个叫「门槛前」的选项", () => {
    const draft = draftOf();
    if (draft.choices[0]) draft.choices[0].label = "门槛前";
    expect(check(draft).some((p) => p.includes("规格书里的词"))).toBe(true);
  });

  it("游戏黑话要报，但「你」不算（事件卡就是第二人称）", () => {
    expect(check(draftOf({ body: `${BODY}属性值上涨。` })).some((p) => p.includes("禁用词"))).toBe(true);
    expect(check(draftOf()).some((p) => p.includes("「你」"))).toBe(false);
  });
});

describe("④ 去重", () => {
  it("与手写事件重名要报", () => {
    expect(check(draftOf({ title: "腐肉之宴" })).some((p) => p.includes("重名"))).toBe(true);
  });

  it("标题连着三个字一样也算撞（四字题里那已经不是巧合）", () => {
    expect(check(draftOf({ title: "腐肉之食" })).some((p) => p.includes("太像"))).toBe(true);
  });

  it("正文撞上手写事件的整句要报", () => {
    const carrion = EVENTS.find((event) => event.id === "qiu-hunt-carrion");
    expect(carrion).toBeDefined();
    const stolen = `${carrion?.body.slice(0, 40) ?? ""}${BODY}`;
    expect(check(draftOf({ body: stolen })).some((p) => p.includes("撞了"))).toBe(true);
  });

  it("标题不许用天时／出身的名字", () => {
    expect(check(draftOf({ title: "大旱之年" })).some((p) => p.includes("天时／出身的名字"))).toBe(true);
  });
});

describe("⑤ 前提呼应", () => {
  it("正文一个母题词都没有 → 打回，并把词表递回去", () => {
    const bland = "林子里安静得很。你走了很久，什么也没遇见，脚下的土松软，踩上去没有声音。走到坡顶时，天已经黑了下来，四下无人。";
    const problems = check(draftOf({ body: bland }));
    expect(problems.some((p) => p.includes("没有呼应这一世的"))).toBe(true);
  });

  it("`none` 档的槽位不做这项要求", () => {
    const plainSlot = SLOTS.find((slot) => slot.echo.kind === "none");
    expect(plainSlot).toBeDefined();
    if (!plainSlot) return;
    const base = midpointDraft(plainSlot);
    const draft: EventDraft = {
      id: base.id,
      title: "空谷余响",
      body: "林子里安静得很。你走了很久，什么也没遇见，脚下的土松软，踩上去没有声音。走到坡顶时，天已经黑了下来，四下无人。",
      choices: base.choices.map((choice) => ({
        label: "缓步而前",
        outcomes: choice.outcomes.map((outcome) => ({
          text: "你在坡顶站了一会儿，把这一带的形状记进心里，然后往回走。",
          effects: outcome.effects,
        })),
      })),
    };
    expect(check(draft, plainSlot).some((p) => p.includes("没有呼应"))).toBe(false);
  });
});

describe("⑥ 具名专名与杀生一致性", () => {
  it("点名了不该点的兽／器要报", () => {
    expect(check(draftOf({ body: `${BODY.slice(0, 50)}你看见白泽站在对岸的石上，四只眼睛一齐看过来，没有说话。` }))
      .some((p) => p.includes("具名的兽"))).toBe(true);
  });

  it("骨架不取命而文案写了杀生要报（化灵之道的本钱就在这里）", () => {
    const slot = SLOTS.find((s) =>
      s.choices.some((c) => c.outcomes.every((o) => (o.fixed.takesLife ?? 0) === 0)),
    );
    expect(slot).toBeDefined();
    if (!slot) return;
    const idx = slot.choices.findIndex((c) => c.outcomes.every((o) => (o.fixed.takesLife ?? 0) === 0));
    const base = midpointDraft(slot);
    const draft: EventDraft = {
      id: base.id,
      title: "石下微光",
      body: BODY,
      choices: base.choices.map((choice, index) => ({
        label: "探爪取之",
        outcomes: choice.outcomes.map((outcome) => ({
          text: index === idx ? "你一口食其肉，连骨头都嚼碎了咽下去，血从嘴角淌到爪上。" : "你把它留在原处，转身走开了。",
          effects: outcome.effects,
        })),
      })),
    };
    expect(check(draft, slot).some((p) => p.includes("并不取命"))).toBe(true);
  });
});

describe("① id 白名单终审（auditEvent 在校验里也跑一遍）", () => {
  /*
   * 这三个字段在结构上 AI 根本填不了（`FixedEffects` 与预算表里都没有它们），
   * 所以下面这条是**第二把锁**的对抗测试：将来若有人放宽了 AI 的字段、或者骨架自己写错，
   * 生成内容就有权发放成道门槛了 —— 那是架构红线 2「机制沙箱」被击穿的样子。
   */
  it("生成事件不许直接决定生死、不许发放成道门槛", () => {
    const event: TaleEvent = {
      id: "x",
      trigger: { region: "qingqiu", weight: 10 },
      title: "试",
      body: "试",
      choices: [
        { label: "甲", outcomes: [{ weight: 1, text: "", effects: { die: "ascend", way: "shen" } }] },
        { label: "乙", outcomes: [{ weight: 1, text: "", effects: { devourDivine: true } }] },
      ],
    };
    const problems = auditEvent(event, CONTENT);
    expect(problems.some((p) => p.includes("不许直接决定生死"))).toBe(true);
    expect(problems.some((p) => p.includes("不许发放成道"))).toBe(true);
    expect(problems.some((p) => p.includes("登神门槛"))).toBe(true);
  });

  it("骨架写错一个敌人 id 也拦得住 —— 引擎遇到未知 id 会当场抛错", () => {
    const broken: SlotSpec = {
      ...SLOT,
      choices: SLOT.choices.map((choice, index) =>
        index === 0
          ? {
              ...choice,
              outcomes: choice.outcomes.map((outcome) => ({
                ...outcome,
                fixed: { ...outcome.fixed, startCombat: "no-such-enemy" },
              })),
            }
          : choice,
      ),
    };
    expect(check(draftOf(), broken).some((p) => p.includes("不存在的敌人"))).toBe(true);
  });
});
