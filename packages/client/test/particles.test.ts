import { describe, expect, it } from "vitest";
import { fireflyGainFor } from "../src/render/particles.js";

describe("fireflyGainFor — M1 B5「夜里萤火 gain ×2」", () => {
  it("at 白昼(0.25) the gain is 0.5", () => {
    expect(fireflyGainFor(0.25)).toBeCloseTo(0.5, 5);
  });

  it("at 夜(0.75) the gain is exactly 2× the 白昼 gain (1.0)", () => {
    const day = fireflyGainFor(0.25);
    const night = fireflyGainFor(0.75);
    expect(night).toBeCloseTo(1.0, 5);
    expect(night / day).toBeCloseTo(2, 5);
  });

  it("never goes outside [0.5, 1.0] for any timeOfDay", () => {
    for (let t = 0; t < 1; t += 0.05) {
      const gain = fireflyGainFor(t);
      expect(gain).toBeGreaterThanOrEqual(0.5);
      expect(gain).toBeLessThanOrEqual(1.0);
    }
  });
});
