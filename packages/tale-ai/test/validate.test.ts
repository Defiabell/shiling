/**
 * 解析与校验 —— 「不许编造事实」的兑现处。
 *
 * 每一条断言都对应一种**实际会发生的模型失误**：包围栏、写阿拉伯数字、漏条、改前缀、
 * 顺手加一头没打过的兽。校验不过就打回重生，重试用尽才回落模板版。
 */

import { describe, expect, it } from "vitest";
import { COPY_SPAN_LIMIT, collectLifeFacts, longestSharedSpan, parseDraft, validateDraft } from "../src/index.js";
import { CONTENT, DEATH_RECORD, KILL_RECORD, MOLT_RECORD, finishedLife, goodDraft } from "./helpers.js";

const STATE = finishedLife({ ending: "slain", extraRecords: [MOLT_RECORD, KILL_RECORD, DEATH_RECORD] });
const FACTS = collectLifeFacts(STATE, CONTENT);
const PREFIXES = FACTS.excerpts.map((excerpt) => excerpt.prefix);
const PRAISE_PREFIX = CONTENT.chronicleTemplates.praisePrefix;

function check(
  mutate: (draft: ReturnType<typeof goodDraft>) => void = () => undefined,
  templateFrame: string[] = [],
): string[] {
  const draft = goodDraft(PREFIXES);
  mutate(draft);
  return validateDraft(draft, FACTS, PRAISE_PREFIX, templateFrame);
}

describe("parseDraft 容错", () => {
  it("裸 JSON、```json 围栏、前后带闲话三种都认", () => {
    const payload = JSON.stringify(goodDraft(PREFIXES));
    for (const raw of [payload, `\`\`\`json\n${payload}\n\`\`\``, `好的，这是列传：\n${payload}\n以上。`]) {
      const parsed = parseDraft(raw);
      expect(parsed.draft, raw.slice(0, 20)).not.toBeNull();
      expect(parsed.problems).toEqual([]);
    }
  });

  it("解析不出来时给的是能递回给模型的人话", () => {
    const parsed = parseDraft("这一世实在没什么好写的。");
    expect(parsed.draft).toBeNull();
    expect(parsed.problems.join("")).toMatch(/JSON/u);
  });

  it("键缺了／middle 不是数组 → 结构问题（而不是崩）", () => {
    expect(parseDraft(JSON.stringify({ opening: "甲", closing: "乙" })).draft).toBeNull();
    expect(parseDraft(JSON.stringify({ opening: "甲", middle: "乙", closing: "丙", praise: "丁" })).draft).toBeNull();
  });
});

describe("validateDraft 放行", () => {
  it("规矩的一稿零问题", () => {
    expect(check()).toEqual([]);
  });
});

describe("validateDraft 打回", () => {
  it("编年条数不对", () => {
    const problems = check((draft) => draft.middle.pop());
    expect(problems.join("")).toMatch(/条数/u);
  });

  it("前缀被改（时间线被编造）", () => {
    const problems = check((draft) => {
      const first = draft.middle[0];
      if (first) first.prefix = "十七岁冬";
    });
    expect(problems.join("")).toMatch(/前缀/u);
  });

  it("阿拉伯数字", () => {
    const problems = check((draft) => {
      draft.closing = `${draft.closing}凡历7岁。`;
    });
    expect(problems.join("")).toMatch(/阿拉伯数字/u);
  });

  it("半角标点", () => {
    const problems = check((draft) => {
      draft.praise = draft.praise.replace("。", ".");
    });
    expect(problems.join("")).toMatch(/半角标点/u);
  });

  it("编造了这一世没出现过的兽", () => {
    const other = CONTENT.enemies.find((enemy) => enemy.name !== "野雉")?.name ?? "";
    const problems = check((draft) => {
      draft.closing = `${draft.closing}又尝搏${other}而胜之。`;
    });
    expect(problems.join("")).toMatch(new RegExp(other, "u"));
    expect(problems.join("")).toMatch(/从未出现过/u);
  });

  it("真出现过的兽不误伤", () => {
    const problems = check((draft) => {
      draft.closing = "终为野雉所噬，血沃荒原，骨不得掩。狩齿犹在颌间，而无所用之。";
    });
    expect(problems).toEqual([]);
  });

  it("赞语自带「赞曰：」前缀（排版会重复）", () => {
    const problems = check((draft) => {
      draft.praise = `${PRAISE_PREFIX}${draft.praise}`;
    });
    expect(problems.join("")).toMatch(/赞曰/u);
  });

  it("游戏黑话与第二人称", () => {
    expect(check((draft) => (draft.praise = `${draft.praise}其属性猛而德薄。`)).join("")).toMatch(/属性/u);
    expect(check((draft) => (draft.praise = `${draft.praise}你终究没能走成。`)).join("")).toMatch(/你/u);
  });

  it("一句话交差与写成小说都拦得住", () => {
    expect(check((draft) => (draft.opening = "死了。")).join("")).toMatch(/太短/u);
    expect(check((draft) => (draft.closing = "山".repeat(400))).join("")).toMatch(/太长/u);
  });

  it("给没点名的那一年安上别处的兽名 → 打回（实测两次都安了「草狐」）", () => {
    const problems = check((draft) => {
      // 首条是出生记录，原文里没有任何兽名
      const line = draft.middle[0];
      if (line) line.text = "一口咬断野雉之喉，肉尚温，月色似为之暗。";
    });
    // 野雉这一世确实出现过（在白名单里），但不在这一条的记录原文里
    expect(problems.join("")).toMatch(/不许替它点名/u);
  });

  it("那一条记录原文里就有的名字不误伤", () => {
    const problems = check((draft) => {
      const index = FACTS.excerpts.findIndex((excerpt) => excerpt.text.includes("野雉"));
      const line = draft.middle[index];
      if (line) line.text = "与野雉相搏而胜之，遂食其精气，腹中始有暖意。";
    });
    expect(problems.join("")).not.toMatch(/不许替它点名/u);
  });

  it("模板占位符漏进正文", () => {
    const problems = check((draft) => {
      draft.opening = `${draft.opening}凡历{{years|cn}}岁。`;
    });
    expect(problems.join("")).toMatch(/占位符/u);
  });
});

describe("照抄模板版", () => {
  // 模板版恒是**这一世自己的**那一篇，所以它的专名就是这一世的专名（校验按此设计）
  const templateOpening = "食灵者，无名，凭灵蕴神种降于青丘，值常年，常胎，托身幼兽。";

  it("整句搬模板版的开篇骨架 → 打回（实测最常见的一种失手）", () => {
    const problems = check((draft) => {
      draft.opening = `${templateOpening}其为兽也，猛薄而灵稍长，德无可称，一世未离此山。`;
    }, [templateOpening]);
    expect(problems.join("")).toMatch(/模板版的原句/u);
  });

  it("撞十几个字才算照抄，短撞不算（史笔本来就有套语）", () => {
    const problems = check((draft) => {
      draft.closing = `血沃荒原，骨不得掩。${draft.closing}`;
    }, ["终为强者所杀，血沃荒原，骨不得掩。"]);
    expect(problems.join("")).not.toMatch(/模板版的原句/u);
  });

  it("与模板版重合的那段其实是引擎旁白 → 放过（那是事实，不是抄）", () => {
    // 归山／妖王的结局段与引擎死亡旁白本就说同一句话（两处注释都写着「刻意对着写」）
    const echo = "青丘之兽尽伏于道左，自此山中之事，皆决于其一念";
    const state = finishedLife({
      ending: "ascend",
      way: "yaowang",
      extraRecords: [
        MOLT_RECORD,
        KILL_RECORD,
        { year: 9, season: 3, kind: "death", text: `${echo}。`, refId: undefined },
      ],
    });
    const facts = collectLifeFacts(state, CONTENT);
    const draft = goodDraft(facts.excerpts.map((excerpt) => excerpt.prefix));
    draft.closing = `至九岁，${echo}。是为兽王，山中无与之争者。`;
    const problems = validateDraft(draft, facts, PRAISE_PREFIX, [`凡夺命三。${echo}。太史氏谓之兽王。`]);
    expect(problems).toEqual([]);
  });

  it("重合的全是专名 → 放过（换谁写都得这么称呼）", () => {
    // 开篇必交代神种／天时／出身，那三个词是固定名词；剔掉专名后只剩「降于，值，」五个字
    const problems = check((draft) => {
      draft.opening = "灵蕴神种降于青丘，值常年，常胎，其身瘦小，目色如旧灰，一世未离此山。";
    }, ["食灵者，无名，凭灵蕴神种降于青丘，值常年，常胎，托身幼兽。"]);
    expect(problems.join("")).not.toMatch(/模板版的原句/u);
  });

  it("longestSharedSpan 按字符数报最长公共片段", () => {
    expect(longestSharedSpan("abcdefghijklmnop", "xxcdefghijklmnoyy", 10)).toBe("cdefghijklmno");
    expect(longestSharedSpan("甲乙丙丁", "丙丁戊己", 3)).toBeNull();
    expect(COPY_SPAN_LIMIT).toBeGreaterThan(10);
  });
});

describe("成败定性", () => {
  const ascended = collectLifeFacts(
    finishedLife({ ending: "ascend", way: "yaowang", extraRecords: [MOLT_RECORD, KILL_RECORD] }),
    CONTENT,
  );

  it("成道那一世被写成失败 → 打回（gpt-5.4-mini 实测犯过）", () => {
    const draft = goodDraft(ascended.excerpts.map((excerpt) => excerpt.prefix));
    draft.closing = "至十四岁而止，然寿终而未尽成道，得其势而不得其全，终有不甘，青丘亦无所称焉。";
    const problems = validateDraft(draft, ascended, PRAISE_PREFIX);
    expect(problems.join("")).toMatch(/是\*\*成了\*\*/u);
  });

  it("成道那一世正常写「成」不打回", () => {
    const draft = goodDraft(ascended.excerpts.map((excerpt) => excerpt.prefix));
    draft.closing = "至十四岁，青丘之兽皆伏。其道既立，山中之事一决于其念，是为兽王，无人敢与之争。";
    expect(validateDraft(draft, ascended, PRAISE_PREFIX)).toEqual([]);
  });

  it("未成道那一世写「终未成器」不打回（那正是它该说的话）", () => {
    const problems = check((draft) => {
      draft.closing = "终未成器，寿数既尽，殁于青丘之野，与草木同朽，四门在上而不得望焉。";
    });
    expect(problems).toEqual([]);
  });
});
