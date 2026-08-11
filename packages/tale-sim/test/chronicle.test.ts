import { describe, expect, it } from "vitest";
import {
  bloodlineGain,
  composeChronicle,
  createLife,
  render,
  type EndingType,
  type LifeRecord,
  type TaleState,
} from "../src/index.js";
import {
  ENEMY_YE_ZHI,
  EVENT_MANDATE,
  EVENT_SPROUT,
  FIXTURE_SEED_ID,
  FIXTURE_SEED_ORGAN_ID,
  ORGAN_GOU_CHI,
  ORGAN_WU_MU,
  contentWithoutEvents,
} from "./fixtures.js";

const CONTENT = contentWithoutEvents();

/** 造一个「已经过完」的一世：给定结局、岁数与若干素材记录。 */
function finishedLife(options: {
  ending: EndingType;
  year?: number;
  de?: number;
  extraRecords?: LifeRecord[];
  organIds?: string[];
}): TaleState {
  const base = createLife(1, FIXTURE_SEED_ID, CONTENT);
  return {
    ...base,
    year: options.year ?? 7,
    stats: { ...base.stats, de: options.de ?? 5 },
    organIds: options.organIds ?? base.organIds,
    alive: false,
    ending: options.ending,
    records: [...base.records, ...(options.extraRecords ?? [])],
  };
}

const MOLT_RECORD: LifeRecord = {
  year: 2,
  season: 1,
  kind: "molt",
  text: "蛰伏一季，蜕生狩齿。",
  refId: ORGAN_GOU_CHI,
};
const KILL_RECORD: LifeRecord = {
  year: 3,
  season: 2,
  kind: "combat",
  text: "搏杀野雉，食其精气。",
  refId: ENEMY_YE_ZHI,
};
const RARE_EVENT_RECORD: LifeRecord = {
  year: 5,
  season: 3,
  kind: "event",
  text: "白光垂落，天命及身。",
  refId: EVENT_MANDATE,
};
const PLAIN_EVENT_RECORD: LifeRecord = {
  year: 6,
  season: 0,
  kind: "event",
  text: "食了一丛野蓂。",
  refId: EVENT_SPROUT,
};

describe("composeChronicle 前置", () => {
  it("一世未结束时抛错（活着 / ending 为空）", () => {
    const alive = createLife(1, FIXTURE_SEED_ID, CONTENT);
    expect(() => composeChronicle(alive, CONTENT)).toThrow(/尚未结束/);
    expect(() => composeChronicle({ ...alive, alive: false }, CONTENT)).toThrow(/尚未结束/);
  });
});

describe("composeChronicle 输出结构", () => {
  it("含出生、结局与「赞曰」三段", () => {
    const state = finishedLife({ ending: "oldage", extraRecords: [MOLT_RECORD] });
    const entry = composeChronicle(state, CONTENT);
    expect(entry.body).toContain("灵蕴神种降世"); // 出生（birth 记录原文）
    expect(entry.body).toContain("寿数既尽"); // 结局四型之一
    expect(entry.body).toContain("赞曰：");
  });

  it("标题与统计字段按 state 渲染", () => {
    const state = finishedLife({
      ending: "slain",
      year: 11,
      organIds: [FIXTURE_SEED_ORGAN_ID, ORGAN_GOU_CHI, ORGAN_WU_MU],
      extraRecords: [MOLT_RECORD, KILL_RECORD],
    });
    const entry = composeChronicle(state, CONTENT);
    expect(entry.title).toBe("灵蕴神种列传");
    expect(entry.ending).toBe("slain");
    expect(entry.years).toBe(11);
    expect(entry.organCount).toBe(3);
    expect(entry.body).toContain("凡历11岁");
    expect(entry.body).toContain("成器官3");
    expect(entry.body).toContain("蜕1");
    expect(entry.body).toContain("杀1");
  });

  it("四种结局各取自己那段", () => {
    const endings: Record<EndingType, string> = {
      starve: "终以饥馑不振",
      slain: "终为强兽所杀",
      oldage: "寿数既尽",
      ascend: "遂脱兽籍而列神班",
    };
    for (const [ending, snippet] of Object.entries(endings) as [EndingType, string][]) {
      const entry = composeChronicle(finishedLife({ ending }), CONTENT);
      expect(entry.body).toContain(snippet);
    }
  });

  it("中段摘录 molt / combat / once 事件，普通事件不入", () => {
    const state = finishedLife({
      ending: "oldage",
      extraRecords: [MOLT_RECORD, KILL_RECORD, RARE_EVENT_RECORD, PLAIN_EVENT_RECORD],
    });
    const entry = composeChronicle(state, CONTENT);
    expect(entry.body).toContain(MOLT_RECORD.text);
    expect(entry.body).toContain(KILL_RECORD.text);
    expect(entry.body).toContain(RARE_EVENT_RECORD.text);
    expect(entry.body).not.toContain(PLAIN_EVENT_RECORD.text);
  });

  it("中段行用 seasonNames 渲染季节", () => {
    const state = finishedLife({ ending: "oldage", extraRecords: [MOLT_RECORD] });
    const entry = composeChronicle(state, CONTENT);
    expect(entry.body).toContain("2岁夏，蛰伏一季，蜕生狩齿。");
  });

  it("摘录条数受 chronicleMaxExcerpts 限制（birth 不占额度）", () => {
    const many: LifeRecord[] = Array.from({ length: 6 }, (_, index) => ({
      year: index,
      season: 0,
      kind: "combat" as const,
      text: `杀敌第${index}次。`,
      refId: ENEMY_YE_ZHI,
    }));
    const capped = contentWithoutEvents({ tuning: { chronicleMaxExcerpts: 2 } });
    const entry = composeChronicle(
      finishedLife({ ending: "slain", extraRecords: many }),
      capped,
    );
    expect(entry.body).toContain("杀敌第0次。");
    expect(entry.body).toContain("杀敌第1次。");
    expect(entry.body).not.toContain("杀敌第2次。");
    // birth 仍在
    expect(entry.body).toContain("灵蕴神种降世");
  });

  it("找不到 birth 记录时用兜底神种名，不崩", () => {
    const state = finishedLife({ ending: "starve" });
    const orphan: TaleState = { ...state, records: [] };
    const entry = composeChronicle(orphan, CONTENT);
    expect(entry.title).toBe("无名神种列传");
  });
});

describe("composeChronicle 赞语变体", () => {
  it("登神走 ascend 专属赞语", () => {
    const entry = composeChronicle(finishedLife({ ending: "ascend", de: 5 }), CONTENT);
    expect(entry.body).toContain("此其所以为神也");
  });

  it("德高（de≥40）走厚德赞语", () => {
    const entry = composeChronicle(finishedLife({ ending: "oldage", de: 55 }), CONTENT);
    expect(entry.body).toContain("其德厚");
  });

  it("德薄（de≤4）走暴行赞语", () => {
    const entry = composeChronicle(finishedLife({ ending: "slain", de: 2 }), CONTENT);
    expect(entry.body).toContain("其行暴");
  });

  it("都不匹配时走末项兜底", () => {
    const entry = composeChronicle(finishedLife({ ending: "starve", de: 20 }), CONTENT);
    expect(entry.body).toContain("兽之常也");
  });

  it("praise 全都不匹配也退到末项而不是抛错", () => {
    const picky = contentWithoutEvents({
      chronicleTemplates: {
        ...CONTENT.chronicleTemplates,
        praise: [{ id: "impossible", minDe: 200, text: "不可能之赞。" }],
      },
    });
    const entry = composeChronicle(finishedLife({ ending: "oldage", de: 5 }), picky);
    expect(entry.body).toContain("不可能之赞。");
  });
});

describe("render 占位替换", () => {
  it("已知占位替换，未知占位原样保留", () => {
    expect(render("{{a}}与{{b}}", { a: "甲", b: 2 })).toBe("甲与2");
    expect(render("{{a}}与{{missing}}", { a: "甲" })).toBe("甲与{{missing}}");
  });
});

describe("bloodlineGain 三来源", () => {
  it("什么都没做则为 0", () => {
    expect(bloodlineGain(finishedLife({ ending: "starve", year: 3 }))).toBe(0);
  });

  it("每次蜕变 +1", () => {
    const state = finishedLife({
      ending: "starve",
      year: 3,
      extraRecords: [MOLT_RECORD, { ...MOLT_RECORD, year: 3 }],
    });
    expect(bloodlineGain(state)).toBe(2);
  });

  it("每满 10 岁 +1", () => {
    expect(bloodlineGain(finishedLife({ ending: "oldage", year: 9 }))).toBe(0);
    expect(bloodlineGain(finishedLife({ ending: "oldage", year: 10 }))).toBe(1);
    expect(bloodlineGain(finishedLife({ ending: "oldage", year: 25 }))).toBe(2);
  });

  it("登神 +3，其余结局无此项", () => {
    expect(bloodlineGain(finishedLife({ ending: "ascend", year: 3 }))).toBe(3);
    expect(bloodlineGain(finishedLife({ ending: "slain", year: 3 }))).toBe(0);
  });

  it("三来源叠加", () => {
    const state = finishedLife({
      ending: "ascend",
      year: 21,
      extraRecords: [MOLT_RECORD, { ...MOLT_RECORD, year: 4 }, { ...MOLT_RECORD, year: 9 }],
    });
    // 3 蜕变 ＋ 2 个十年 ＋ 3 登神
    expect(bloodlineGain(state)).toBe(8);
  });

  it("击杀不计入血统点（正本只认蜕变/岁数/登神）", () => {
    const state = finishedLife({
      ending: "slain",
      year: 5,
      extraRecords: [KILL_RECORD, { ...KILL_RECORD, year: 4 }],
    });
    expect(bloodlineGain(state)).toBe(0);
  });

  it("事件赠予的器官也算蜕变（同为 molt 记录）", () => {
    const state = finishedLife({
      ending: "oldage",
      year: 2,
      extraRecords: [
        { year: 1, season: 0, kind: "molt", text: "身内又生狩齿。", refId: ORGAN_GOU_CHI },
      ],
    });
    expect(bloodlineGain(state)).toBe(1);
  });
});
