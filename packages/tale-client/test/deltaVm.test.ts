import { describe, expect, it } from "vitest";
import { diffFloaters, gainedEssenceTypes } from "../src/model/deltaVm.js";
import { newState, withPatch } from "./helpers.js";

describe("diffFloaters", () => {
  it("属性升降各给一条，符号用 +／全角减号", () => {
    const prev = newState();
    const next = withPatch(prev, { stats: { ...prev.stats, meng: prev.stats.meng + 6, de: prev.stats.de - 2 } });
    const floaters = diffFloaters(prev, next);
    expect(floaters).toContainEqual({ anchor: "stat:meng", text: "猛 +6", tone: "gain" });
    expect(floaters).toContainEqual({ anchor: "stat:de", text: "德 −2", tone: "loss" });
  });

  it("季耗范围内的饱食下降不飘（背景噪音），超出才飘", () => {
    const prev = newState();
    const seasonal = withPatch(prev, { hunger: prev.hunger - 12 });
    expect(diffFloaters(prev, seasonal, { ignoreHungerDrop: 12 })).toEqual([]);

    const bitten = withPatch(prev, { hunger: prev.hunger - 30 });
    expect(diffFloaters(prev, bitten, { ignoreHungerDrop: 12 })).toContainEqual({
      anchor: "hunger",
      text: "饱食 −30",
      tone: "loss",
    });
  });

  it("饱食上升永远飘（吃到东西是正反馈，不能被门槛吃掉）", () => {
    const prev = newState();
    const fed = withPatch(prev, { hunger: prev.hunger + 4 });
    expect(diffFloaters(prev, fed, { ignoreHungerDrop: 12 })).toContainEqual({
      anchor: "hunger",
      text: "饱食 +4",
      tone: "gain",
    });
  });

  it("精气飘字带类型（渲染层据此取色）", () => {
    const prev = newState();
    const next = withPatch(prev, { essence: { ...prev.essence, lin: 20 } });
    expect(diffFloaters(prev, next)).toContainEqual({
      anchor: "essence:lin",
      text: "鳞 +20",
      tone: "essence",
      essence: "lin",
    });
  });

  it("寿元变化锚在时间那一格；减寿算不祥", () => {
    const prev = newState();
    const longer = withPatch(prev, { lifespanMax: prev.lifespanMax + 2 });
    expect(diffFloaters(prev, longer)).toContainEqual({ anchor: "when", text: "寿元 +2", tone: "gain" });
    const shorter = withPatch(prev, { lifespanMax: prev.lifespanMax - 3 });
    expect(diffFloaters(prev, shorter)).toContainEqual({ anchor: "when", text: "寿元 −3", tone: "omen" });
  });

  it("毫无变化时不产任何飘字", () => {
    const state = newState();
    expect(diffFloaters(state, state)).toEqual([]);
  });
});

describe("gainedEssenceTypes", () => {
  it("只报增加的那几型", () => {
    const prev = withPatch(newState(), { essence: { zu: 10, lin: 5, xue: 0, meng: 0 } });
    const next = withPatch(prev, { essence: { zu: 22, lin: 5, xue: 0, meng: 3 } });
    expect(gainedEssenceTypes(prev, next)).toEqual(["zu", "meng"]);
  });

  it("清零（蜕变消耗）不算获得", () => {
    const prev = withPatch(newState(), { essence: { zu: 60, lin: 0, xue: 0, meng: 0 } });
    const next = withPatch(prev, { essence: { zu: 0, lin: 0, xue: 0, meng: 0 } });
    expect(gainedEssenceTypes(prev, next)).toEqual([]);
  });
});
