import { describe, expect, it } from "vitest";
import { mistGainFor } from "../src/render/groundMist.js";

// 镜像 particles.test.ts 的 fireflyGainFor 用例结构——同一类"白天基准/夜晚倍数"
// 昼夜插值断言，见 groundMist.ts mistGainFor 头部注释。
describe("mistGainFor — M2 A3「贴地流雾昼夜呼吸」", () => {
  it("at 白昼(0.25) the gain is 1.0 (baseline, no boost)", () => {
    expect(mistGainFor(0.25)).toBeCloseTo(1.0, 5);
  });

  it("at 夜(0.75) the gain is exactly 1.6× the 白昼 gain — brief 原话 night/dawn opacity ×1.6", () => {
    const day = mistGainFor(0.25);
    const night = mistGainFor(0.75);
    expect(night).toBeCloseTo(1.6, 5);
    expect(night / day).toBeCloseTo(1.6, 5);
  });

  it("黎明(0.0) sits strictly between day and night gain (partial boost, nightAmount=0.35 there)", () => {
    const dawn = mistGainFor(0.0);
    expect(dawn).toBeGreaterThan(1.0);
    expect(dawn).toBeLessThan(1.6);
  });

  it("never goes outside [1.0, 1.6] for any timeOfDay", () => {
    for (let t = 0; t < 1; t += 0.05) {
      const gain = mistGainFor(t);
      expect(gain).toBeGreaterThanOrEqual(1.0);
      expect(gain).toBeLessThanOrEqual(1.6);
    }
  });
});
