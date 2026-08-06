import { describe, expect, it } from "vitest";
import { createRng } from "../src/rng.js";

describe("createRng", () => {
  it("is deterministic per seed", () => {
    const a = createRng(42), b = createRng(42);
    const seqA = [a.next(), a.next(), a.next()];
    const seqB = [b.next(), b.next(), b.next()];
    expect(seqA).toEqual(seqB);
  });
  it("differs across seeds", () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next());
  });
  it("range and int stay in bounds", () => {
    const r = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.range(2, 5);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThan(5);
      const n = r.int(3);
      expect([0, 1, 2]).toContain(n);
    }
  });
});
