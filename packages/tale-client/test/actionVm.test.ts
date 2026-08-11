import { describe, expect, it } from "vitest";
import { buildActionVms } from "../src/model/actionVm.js";
import { FIXTURE_CONTENT, newState, withPatch } from "./helpers.js";

const T = FIXTURE_CONTENT.tuning;

describe("buildActionVms", () => {
  it("四个行动恒在（蛰伏不可用时置灰而不是隐藏）", () => {
    const vms = buildActionVms(newState(), FIXTURE_CONTENT);
    expect(vms.map((vm) => vm.id)).toEqual(["hunt", "explore", "rest", "dormant"]);
  });

  it("蛰伏置灰时说清还差多少精气（差多少来自最高的一型）", () => {
    const state = withPatch(newState(), { essence: { zu: 18, lin: 4, xue: 0, meng: 0 } });
    const dormant = buildActionVms(state, FIXTURE_CONTENT)[3]!;
    expect(dormant.enabled).toBe(false);
    expect(dormant.highlight).toBe(false);
    expect(dormant.disabledReason).toBe(`尚需足之精气 ${T.moltThreshold - 18}`);
  });

  it("任一精气达阈值 → 蛰伏点亮并高亮", () => {
    const state = withPatch(newState(), {
      essence: { zu: 0, lin: T.moltThreshold, xue: 0, meng: 0 },
    });
    const dormant = buildActionVms(state, FIXTURE_CONTENT)[3]!;
    expect(dormant.enabled).toBe(true);
    expect(dormant.highlight).toBe(true);
    expect(dormant.disabledReason).toBeNull();
  });

  it("战斗中四个行动全灰，理由一律是「战事未了」", () => {
    const base = newState();
    const state = withPatch(base, {
      combat: { enemyId: "ye-zhi", enemyHp: 6, playerHp: 20, round: 0, log: [] },
    });
    const vms = buildActionVms(state, FIXTURE_CONTENT);
    expect(vms.every((vm) => !vm.enabled)).toBe(true);
    expect(vms.map((vm) => vm.disabledReason)).toEqual([
      "战事未了",
      "战事未了",
      "战事未了",
      "战事未了",
    ]);
  });

  it("精气已满却在打架时，蛰伏说「战事未了」而不是「尚需…0」", () => {
    const base = newState();
    const state = withPatch(base, {
      essence: { zu: T.moltThreshold + 5, lin: 0, xue: 0, meng: 0 },
      combat: { enemyId: "ye-zhi", enemyHp: 6, playerHp: 20, round: 0, log: [] },
    });
    const dormant = buildActionVms(state, FIXTURE_CONTENT)[3]!;
    expect(dormant.enabled).toBe(false);
    expect(dormant.highlight).toBe(false);
    expect(dormant.disabledReason).toBe("战事未了");
  });

  it("死后全灰，理由是「已殁」", () => {
    const state = withPatch(newState(), { alive: false, ending: "starve" });
    const vms = buildActionVms(state, FIXTURE_CONTENT);
    expect(vms.every((vm) => !vm.enabled)).toBe(true);
    expect(vms[0]?.disabledReason).toBe("已　殁");
  });
});
