import { describe, expect, it } from "vitest";
import { bloodlineGain, composeChronicle, type TaleState } from "@shiling/tale-sim";
import {
  buildChronicleVm,
  composeAscendGap,
  buildDeathVm,
  composeDeathSummary,
  splitChronicleBody,
} from "../src/model/chronicleVm.js";
import { FIXTURE_CONTENT, newState, withPatch } from "./helpers.js";

/**
 * [2026-08-13] `livesTaken` 缺省 1（这一世打过一场架，见 records 里那条 combat）——
 * 缺省 0 会让「化灵」的不杀一命门槛在每个 fixture 一世里都达成，于是「最接近的那条道」
 * 恒为化灵，每条差距报告断言都在测一件与被测无关的事。
 */
function deadState(patch: Partial<TaleState> = {}): TaleState {
  const base = newState(77);
  return withPatch(base, {
    alive: false,
    ending: "starve",
    year: 11,
    livesTaken: 1,
    records: [
      ...base.records,
      { year: 2, season: 1, kind: "molt", text: "蛰伏一季，蜕生疾足。", refId: "ji-zu" },
      { year: 4, season: 0, kind: "combat", text: "搏杀野雉，食其精气。", refId: "ye-zhi" },
      { year: 11, season: 2, kind: "death", text: "饥馑连季，形销骨立而终。" },
    ],
    organIds: ["organ-ling-yun", "ji-zu"],
    ...patch,
  });
}

describe("splitChronicleBody", () => {
  it("按「赞曰：」把四段拆开", () => {
    const body = ["开篇一句。", "二岁夏，甲。", "四岁春，乙。", "终以饥馑不振。", "赞曰：生于青丘。"].join("\n");
    const parts = splitChronicleBody(body, "赞曰：");
    expect(parts.opening).toBe("开篇一句。");
    expect(parts.middle).toEqual(["二岁夏，甲。", "四岁春，乙。"]);
    expect(parts.closing).toBe("终以饥馑不振。");
    expect(parts.praise).toBe("生于青丘。");
  });

  it("只有两行时中段为空、不误吞开篇", () => {
    const parts = splitChronicleBody("开篇。\n赞曰：了。", "赞曰：");
    expect(parts.opening).toBe("开篇。");
    expect(parts.middle).toEqual([]);
    expect(parts.closing).toBe("");
    expect(parts.praise).toBe("了。");
  });

  it("没有赞语前缀时优雅降级，不丢内容", () => {
    const parts = splitChronicleBody("甲。\n乙。\n丙。", "赞曰：");
    expect(parts.praise).toBe("");
    expect(parts.opening).toBe("甲。");
    expect(parts.closing).toBe("丙。");
  });
});

describe("buildChronicleVm", () => {
  it("吃引擎真产出的列传，四段都非空", () => {
    const state = deadState();
    const entry = composeChronicle(state, FIXTURE_CONTENT);
    const vm = buildChronicleVm(entry, bloodlineGain(state, FIXTURE_CONTENT), FIXTURE_CONTENT, state);
    expect(vm.title).toBe("灵蕴神种列传");
    expect(vm.opening).toContain("青丘");
    expect(vm.middle.length).toBeGreaterThan(0);
    expect(vm.closing).toBe("终以饥馑不振，殒于青丘。");
    expect(vm.praisePrefix).toBe("赞曰：");
    expect(vm.praise.length).toBeGreaterThan(0);
    // 拆出来的赞语不该还带着前缀
    expect(vm.praise.startsWith("赞曰")).toBe(false);
  });

  it("结局元信息（中文标签／墓志／汉字岁数／血统点）齐全", () => {
    const state = deadState();
    const entry = composeChronicle(state, FIXTURE_CONTENT);
    const vm = buildChronicleVm(entry, bloodlineGain(state, FIXTURE_CONTENT), FIXTURE_CONTENT, state);
    expect(vm.endingLabel).toBe("饿殍");
    expect(vm.epitaph).toContain("饥馑");
    expect(vm.yearsCn).toBe("十一");
    expect(vm.organCount).toBe(2);
    // 卷轴元信息与正文同一套数字体例（汉字）——同屏不并置两种
    expect(vm.organCountCn).toBe("二");
    // 一次蜕变 + 满 10 岁一次 = 2
    expect(vm.bloodlineGain).toBe(2);
  });

  it("卷轴带「其形」画像，阶段按终局器官数取", () => {
    const state = deadState();
    const cub = buildChronicleVm(composeChronicle(state, FIXTURE_CONTENT), 0, FIXTURE_CONTENT, state);
    expect(cub.portrait.label).toBe("幼兽");
    expect(cub.portrait.src).toContain("portraits/self-1-cub");

    const grown = deadState({ organIds: [...state.organIds, "a", "b", "c"] });
    const vm = buildChronicleVm(composeChronicle(grown, FIXTURE_CONTENT), 0, FIXTURE_CONTENT, grown);
    expect(vm.portrait.label).toBe("近神");
  });

  /**
   * [2026-08-13] 成道的 `ending` 一律是 `ascend`，门楣二字报的是**哪条道**。
   * 四条道各一套标签与墓志 —— 归山那一句尤其不能与登神共用（一个白光贯顶，一个卧于旧穴）。
   */
  it("成道按道换标签与墓志，四条互不串味", () => {
    const marks = {
      shen: ["登神", "神班"],
      yaowang: ["妖王", "山中之事"],
      guishan: ["归山", "山中之兽皆来送之"],
      hualing: ["化灵", "风过而散"],
    } as const;
    for (const [way, [label, closing]] of Object.entries(marks)) {
      const state = deadState({ ending: "ascend", wayAchieved: way as keyof typeof marks });
      const entry = composeChronicle(state, FIXTURE_CONTENT);
      const vm = buildChronicleVm(entry, bloodlineGain(state, FIXTURE_CONTENT), FIXTURE_CONTENT, state);
      expect(vm.endingLabel, `${way} 的门楣`).toBe(label);
      expect(vm.closing, `${way} 的结语`).toContain(closing);
      expect(vm.epitaph.length).toBeGreaterThan(0);
    }
  });
});

describe("composeDeathSummary", () => {
  it("全汉字数字，一句话说完一世", () => {
    expect(composeDeathSummary(11, 2, 1, 3)).toBe("凡历十一岁，成器官二，蜕一，杀三。");
  });

  it("零值换措辞，不出现「蜕〇」这种机器话", () => {
    expect(composeDeathSummary(0, 1, 0, 0)).toBe("凡历初岁，成器官一，未尝蜕形，未尝杀生。");
  });

  it("只缺一项时只换那一项", () => {
    expect(composeDeathSummary(4, 2, 1, 0)).toBe("凡历四岁，成器官二，蜕一，未尝杀生。");
  });
});

describe("buildDeathVm", () => {
  it("摘出死亡原句与三项统计", () => {
    const vm = buildDeathVm(deadState(), FIXTURE_CONTENT);
    expect(vm.endingLabel).toBe("饿殍");
    expect(vm.lastWords).toBe("饥馑连季，形销骨立而终。");
    expect(vm.yearsCn).toBe("十一");
    expect(vm.organCount).toBe(2);
    expect(vm.killCount).toBe(1);
    expect(vm.moltCount).toBe(1);
    expect(vm.summary).toBe("凡历十一岁，成器官二，蜕一，杀一。");
  });

  it("缺 death 记录时退回墓志，不给空白", () => {
    const state = deadState({ records: [] });
    expect(buildDeathVm(state, FIXTURE_CONTENT).lastWords).toBe(buildDeathVm(state, FIXTURE_CONTENT).epitaph);
  });
});

/**
 * [M1-P2] 差距报告 —— 结局重构的目的：让人合上这一世时想的是「我差两件器官」，
 * 而不是「哦，死了」。
 */
describe("composeAscendGap / 差距报告（2026-08-13 起按最接近的那条道报）", () => {
  it("只列没达成的门槛，用「差多少」而不是「有多少」", () => {
    const state = deadState({ organIds: ["organ-ling-yun"] });
    const { gap, gapItems, way } = composeAscendGap(state, FIXTURE_CONTENT);
    // 一世 11 岁、ling 13、de 5、夺过一命 —— 最接近的是归山（寿 11／25）
    expect(way).toBe("guishan");
    expect(gap.startsWith("离归山：")).toBe(true);
    expect(gapItems).toHaveLength(2);
    expect(gapItems[0]).toBe("寿数差十四岁");
    expect(gapItems[1]?.startsWith("德行差")).toBe(true);
    expect(gap).not.toContain("／");
  });

  it("达成的门槛不出现在差距里（已经做到的事不该再念一遍）", () => {
    const base = deadState();
    const state = withPatch(base, { year: FIXTURE_CONTENT.tuning.wayGuishanYear });
    const { gapItems, met, way } = composeAscendGap(state, FIXTURE_CONTENT);
    expect(way).toBe("guishan");
    expect(met).toBe(1);
    expect(gapItems.map((item) => item.slice(0, 2))).toEqual(["德行"]);
  });

  it("成道那一世报的是**成的那条**，且换成确认句", () => {
    const base = deadState({ ending: "ascend", wayAchieved: "guishan" });
    const state = withPatch(base, {
      year: FIXTURE_CONTENT.tuning.wayGuishanYear,
      stats: { ...base.stats, de: FIXTURE_CONTENT.tuning.wayGuishanDe },
    });
    const { gap, gapItems, way } = composeAscendGap(state, FIXTURE_CONTENT);
    expect(way).toBe("guishan");
    expect(gapItems).toEqual([]);
    expect(gap).toContain("归山诸事既备");
  });

  /**
   * 「不杀一命」这条道的差距报告读法是**已夺几命**，而不是「差几条命」——
   * 那不是努力能补上的差距，是这条道已经关了。
   */
  it("一世不杀的那一世报的是化灵（它是唯一还够得着的那条）", () => {
    const state = deadState({ livesTaken: 0, records: [] });
    const { gap, way, total } = composeAscendGap(state, FIXTURE_CONTENT);
    expect(way).toBe("hualing");
    expect(gap.startsWith("离化灵：")).toBe(true);
    expect(total).toBe(2);
  });

  it("死亡屏与列传卷轴读的是同一份差距（两屏不许各说一套）", () => {
    const state = deadState();
    const death = buildDeathVm(state, FIXTURE_CONTENT);
    const scroll = buildChronicleVm(
      composeChronicle(state, FIXTURE_CONTENT),
      0,
      FIXTURE_CONTENT,
      state,
    );
    expect(scroll.ascendGap).toBe(death.gap);
    expect(scroll.ascendMet).toBe(death.ascendMet);
    expect(scroll.gapWay).toBe(death.gapWay);
    expect(death.ascendTotal).toBe(2);
  });

  it("寿终的墓志改成了明确的失败（不再是「卧于旧穴而化」那种圆满话）", () => {
    const vm = buildDeathVm(deadState({ ending: "oldage" }), FIXTURE_CONTENT);
    expect(vm.epitaph).toContain("未成器");
  });

  it("而寿终**同时**归山成道时，墓志改成褒扬（oldage 的语义分叉）", () => {
    const vm = buildDeathVm(
      deadState({ ending: "ascend", wayAchieved: "guishan" }),
      FIXTURE_CONTENT,
    );
    expect(vm.endingLabel).toBe("归山");
    expect(vm.epitaph).not.toContain("未成器");
    expect(vm.epitaph).toContain("寿数既满");
  });
});
