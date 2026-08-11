import { describe, expect, it } from "vitest";
import { eligibleChoiceIdxs, type TaleEvent } from "@shiling/tale-sim";
import { buildEventCardVm, describeOrganTag, describeRequirements } from "../src/model/eventVm.js";
import { FIXTURE_CONTENT, newState, withPatch } from "./helpers.js";

const SPROUT = FIXTURE_CONTENT.events.find((event) => event.id === "qiu-spring-sprout") as TaleEvent;
const THICKET = FIXTURE_CONTENT.events.find((event) => event.id === "qiu-hunt-thicket") as TaleEvent;

describe("describeOrganTag", () => {
  it("把 tag 翻成器官名，多枚用「／」连", () => {
    expect(describeOrganTag("night-eye", FIXTURE_CONTENT)).toBe("雾目");
    expect(describeOrganTag("hunter", FIXTURE_CONTENT)).toBe("狩齿");
  });

  it("神种自带器官也算数（它只存在于 seeds[].organ）", () => {
    expect(describeOrganTag("spirit-born", FIXTURE_CONTENT)).toBe("灵蕴");
  });

  it("无人提供的 tag 原样回显，便于发现内容 bug", () => {
    expect(describeOrganTag("no-such-tag", FIXTURE_CONTENT)).toBe("no-such-tag");
  });
});

describe("describeRequirements", () => {
  it("属性门槛：未满足给「今 N」，满足给 null", () => {
    const state = newState(); // ling = 13
    const choice = SPROUT.choices[1]!; // 需 ling 20
    const unmet = describeRequirements(state, choice, FIXTURE_CONTENT);
    expect(unmet).toHaveLength(1);
    expect(unmet[0]).toMatchObject({ kind: "stat", label: "灵 20", shortfall: "今 13", met: false });

    const strong = withPatch(state, { stats: { ...state.stats, ling: 40 } });
    expect(describeRequirements(strong, choice, FIXTURE_CONTENT)[0]).toMatchObject({
      shortfall: null,
      met: true,
    });
  });

  it("精气门槛：说清是哪一型、还差多少", () => {
    const state = newState();
    const choice = SPROUT.choices[2]!; // 需 zu 30
    const [requirement] = describeRequirements(state, choice, FIXTURE_CONTENT);
    expect(requirement).toMatchObject({
      kind: "essence",
      label: "足之精气 30",
      shortfall: "今 0",
      met: false,
    });
  });

  it("器官 tag 门槛：任一命中即算满足，文案列出全部可选器官", () => {
    const state = newState();
    const choice = THICKET.choices[1]!; // 需 night-eye 或 swift
    const [unmet] = describeRequirements(state, choice, FIXTURE_CONTENT);
    expect(unmet).toMatchObject({ kind: "organ", label: "须具 雾目／疾足", shortfall: "尚未蜕生" });

    const withEye = withPatch(state, { organIds: [...state.organIds, "wu-mu"] });
    expect(describeRequirements(withEye, choice, FIXTURE_CONTENT)[0]?.met).toBe(true);
  });

  it("无门槛的抉择给空数组", () => {
    expect(describeRequirements(newState(), SPROUT.choices[0]!, FIXTURE_CONTENT)).toEqual([]);
  });
});

describe("buildEventCardVm", () => {
  it("enabled 与引擎 eligibleChoiceIdxs 逐条一致（口径不许自己另算）", () => {
    const state = withPatch(newState(), {
      organIds: ["organ-ling-yun", "ji-zu"],
      essence: { zu: 44, lin: 0, xue: 0, meng: 0 },
    });
    for (const event of [SPROUT, THICKET]) {
      const eligible = new Set(eligibleChoiceIdxs(state, event, FIXTURE_CONTENT));
      const vm = buildEventCardVm(state, event, FIXTURE_CONTENT);
      expect(vm.choices.map((choice) => choice.enabled)).toEqual(
        event.choices.map((_, idx) => eligible.has(idx)),
      );
    }
  });

  it("置灰抉择带可读的原因摘要", () => {
    const vm = buildEventCardVm(newState(), SPROUT, FIXTURE_CONTENT);
    expect(vm.choices[1]?.enabled).toBe(false);
    expect(vm.choices[1]?.deniedSummary).toBe("灵 20（今 13）");
    expect(vm.choices[2]?.deniedSummary).toBe("足之精气 30（今 0）");
    // 满足的那条不该带原因
    expect(vm.choices[0]?.enabled).toBe(true);
    expect(vm.choices[0]?.deniedSummary).toBe("");
  });

  it("正文按换行拆段，插图缺省时不编造 media", () => {
    const vm = buildEventCardVm(newState(), SPROUT, FIXTURE_CONTENT);
    expect(vm.paragraphs.length).toBeGreaterThanOrEqual(1);
    expect(vm.paragraphs.join("")).not.toContain("\n");
    expect(vm.media).toBeNull();
  });

  it("有 illustration 时给出 public/art 下的图片资源描述", () => {
    const withArt: TaleEvent = { ...SPROUT, illustration: "qiu-spring-sprout.webp" };
    const vm = buildEventCardVm(newState(), withArt, FIXTURE_CONTENT);
    expect(vm.media).toEqual({ kind: "image", src: "/art/qiu-spring-sprout.webp" });
  });

  it("全部抉择都不可选时标 deadlocked（内容缺兜底的可见信号）", () => {
    const locked: TaleEvent = { ...SPROUT, choices: [SPROUT.choices[1]!, SPROUT.choices[2]!] };
    expect(buildEventCardVm(newState(), locked, FIXTURE_CONTENT).deadlocked).toBe(true);
    expect(buildEventCardVm(newState(), SPROUT, FIXTURE_CONTENT).deadlocked).toBe(false);
  });
});
