import { describe, expect, it } from "vitest";
import { createCursor, nextRandom, weightedPick, weightedSample } from "../src/index.js";

describe("mulberry32 纯函数式 RNG", () => {
  it("同一 rngState 恒得同一抽取结果", () => {
    expect(nextRandom(12345)).toEqual(nextRandom(12345));
    expect(nextRandom(0)).toEqual(nextRandom(0));
  });

  it("抽取值落在 [0,1)", () => {
    let state = 99;
    for (let i = 0; i < 500; i += 1) {
      const draw = nextRandom(state);
      expect(draw.value).toBeGreaterThanOrEqual(0);
      expect(draw.value).toBeLessThan(1);
      state = draw.rngState;
    }
  });

  it("状态会推进（不是原地打转）", () => {
    const first = nextRandom(7);
    const second = nextRandom(first.rngState);
    expect(second.rngState).not.toBe(first.rngState);
    expect(second.value).not.toBe(first.value);
  });

  it("从同一中途状态续跑得到同一序列", () => {
    const cursorA = createCursor(4242);
    const cursorB = createCursor(4242);
    for (let i = 0; i < 10; i += 1) cursorA.next();
    for (let i = 0; i < 10; i += 1) cursorB.next();
    expect(cursorA.state).toBe(cursorB.state);
    const resumedA = createCursor(cursorA.state);
    const resumedB = createCursor(cursorB.state);
    expect([resumedA.next(), resumedA.next()]).toEqual([resumedB.next(), resumedB.next()]);
  });

  it("cursor.int 落在 [0, n)，且 n<=0 时不消耗抽取", () => {
    const cursor = createCursor(1);
    for (let i = 0; i < 200; i += 1) {
      const value = cursor.int(5);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(5);
    }
    const before = cursor.state;
    expect(cursor.int(0)).toBe(0);
    expect(cursor.state).toBe(before);
  });

  it("weightedPick 的分布贴合权重", () => {
    const items = ["a", "b"] as const;
    const weights: Record<string, number> = { a: 9, b: 1 };
    const cursor = createCursor(20260811);
    const counts: Record<string, number> = { a: 0, b: 0 };
    for (let i = 0; i < 4000; i += 1) {
      const picked = weightedPick(cursor, items, (item) => weights[item] ?? 0);
      if (picked) counts[picked] = (counts[picked] ?? 0) + 1;
    }
    expect((counts.a ?? 0) / 4000).toBeGreaterThan(0.85);
    expect((counts.a ?? 0) / 4000).toBeLessThan(0.95);
  });

  it("weightedPick 空数组返回 null；总权重为 0 时退化等权而不是返回 null", () => {
    const cursor = createCursor(5);
    expect(weightedPick(cursor, [], () => 1)).toBeNull();
    const picked = weightedPick(cursor, ["x", "y"], () => 0);
    expect(["x", "y"]).toContain(picked);
  });

  it("weightedSample 抽出不重复的 k 个，k 超出长度时给全部", () => {
    const cursor = createCursor(31337);
    const pool = ["a", "b", "c", "d"];
    const three = weightedSample(cursor, pool, () => 1, 3);
    expect(three).toHaveLength(3);
    expect(new Set(three).size).toBe(3);
    const all = weightedSample(cursor, pool, () => 1, 99);
    expect(new Set(all).size).toBe(4);
  });

  it("weightedSample 高权重项的入选率显著更高", () => {
    const cursor = createCursor(777);
    const pool = ["heavy", "light1", "light2", "light3"];
    const weights: Record<string, number> = { heavy: 90, light1: 1, light2: 1, light3: 1 };
    let heavyIn = 0;
    let light1In = 0;
    const runs = 2000;
    for (let i = 0; i < runs; i += 1) {
      const sample = weightedSample(cursor, pool, (item) => weights[item] ?? 0, 2);
      if (sample.includes("heavy")) heavyIn += 1;
      if (sample.includes("light1")) light1In += 1;
    }
    expect(heavyIn / runs).toBeGreaterThan(0.9);
    expect(light1In / runs).toBeLessThan(0.5);
  });
});
