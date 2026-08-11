import { describe, expect, it } from "vitest";
import { bloodlineGain, composeChronicle, type TaleState } from "@shiling/tale-sim";
import {
  buildChronicleVm,
  buildDeathVm,
  composeDeathSummary,
  splitChronicleBody,
} from "../src/model/chronicleVm.js";
import { FIXTURE_CONTENT, newState, withPatch } from "./helpers.js";

function deadState(patch: Partial<TaleState> = {}): TaleState {
  const base = newState(77);
  return withPatch(base, {
    alive: false,
    ending: "starve",
    year: 11,
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
    const vm = buildChronicleVm(entry, bloodlineGain(state), FIXTURE_CONTENT);
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
    const vm = buildChronicleVm(entry, bloodlineGain(state), FIXTURE_CONTENT);
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
    const cub = buildChronicleVm(composeChronicle(state, FIXTURE_CONTENT), 0, FIXTURE_CONTENT);
    expect(cub.portrait.label).toBe("幼兽");
    expect(cub.portrait.src).toContain("portraits/self-1-cub");

    const grown = deadState({ organIds: [...state.organIds, "a", "b", "c"] });
    const vm = buildChronicleVm(composeChronicle(grown, FIXTURE_CONTENT), 0, FIXTURE_CONTENT);
    expect(vm.portrait.label).toBe("近神");
  });

  it("登神走另一套标签", () => {
    const state = deadState({ ending: "ascend" });
    const entry = composeChronicle(state, FIXTURE_CONTENT);
    const vm = buildChronicleVm(entry, bloodlineGain(state), FIXTURE_CONTENT);
    expect(vm.endingLabel).toBe("登神");
    expect(vm.closing).toContain("神班");
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
    const vm = buildDeathVm(deadState());
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
    expect(buildDeathVm(state).lastWords).toBe(buildDeathVm(state).epitaph);
  });
});
