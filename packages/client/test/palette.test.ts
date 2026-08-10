import { describe, expect, it } from "vitest";
import {
  DAYNIGHT_KEYFRAMES,
  findDayNightBracket,
  groundLuminance,
  interpolateDayNight,
  PALETTE,
} from "../src/render/palette.js";

const DAWN = DAYNIGHT_KEYFRAMES[0]!;
const DAY = DAYNIGHT_KEYFRAMES[1]!;
const DUSK = DAYNIGHT_KEYFRAMES[2]!;
const NIGHT = DAYNIGHT_KEYFRAMES[3]!;

describe("findDayNightBracket", () => {
  it("exactly at a keyframe's own t, alpha is 0 and a is that keyframe", () => {
    const { a, alpha } = findDayNightBracket(0.25);
    expect(a.name).toBe("白昼");
    expect(alpha).toBe(0);
  });

  it("wraps across the night→dawn boundary (t just past 0.75 towards 1.0/0.0)", () => {
    const { a, b } = findDayNightBracket(0.9);
    expect(a.name).toBe("夜");
    expect(b.name).toBe("黎明");
  });

  it("normalizes an out-of-range timeOfDay the same way sim wraps it", () => {
    const inRange = findDayNightBracket(0.1);
    const wrapped = findDayNightBracket(1.1);
    expect(wrapped).toEqual(inRange);
  });

  it("midpoint between two keyframes lands near alpha=0.5", () => {
    const { alpha } = findDayNightBracket(0.375); // 白昼(0.25)与黄昏(0.5)之间的中点
    expect(alpha).toBeCloseTo(0.5, 5);
  });
});

describe("interpolateDayNight", () => {
  it("at the 黄昏 keyframe's own t, resolves to exactly the static PALETTE baseline (zero drift)", () => {
    const kf = interpolateDayNight(0.5);
    expect(kf.sunColor).toBe(PALETTE.sunColor);
    expect(kf.sunIntensity).toBe(PALETTE.sunIntensity);
    expect(kf.hemiSky).toBe(PALETTE.hemiSky);
    expect(kf.hemiGround).toBe(PALETTE.hemiGround);
    expect(kf.hemiIntensity).toBe(PALETTE.hemiIntensity);
    expect(kf.fogColor).toBe(PALETTE.fog);
    expect(kf.skyTop).toBe(PALETTE.skyTop);
    expect(kf.skyHorizon).toBe(PALETTE.skyHorizon);
    expect(kf.skyGlow).toBe(PALETTE.skyGlow);
  });

  it("at each keyframe's own t, resolves to exactly that keyframe (no smoothstep bleed at the anchor point)", () => {
    for (const kf of DAYNIGHT_KEYFRAMES) {
      const resolved = interpolateDayNight(kf.t);
      expect(resolved.nightAmount).toBe(kf.nightAmount);
      expect(resolved.sunColor).toBe(kf.sunColor);
      // M2 A4：天空远景（skyscape.ts）新增的四个字段与既有 8 个字段共用同一套
      // lerp 机制（见 palette.ts interpolateDayNight 头注），在锚点处同样不该有
      // smoothstep 渗色。
      expect(resolved.mountainInk).toBe(kf.mountainInk);
      expect(resolved.cloudTint).toBe(kf.cloudTint);
      expect(resolved.celestialColor).toBe(kf.celestialColor);
      expect(resolved.celestialSize).toBe(kf.celestialSize);
    }
  });

  it("nightAmount is monotonically non-decreasing from 白昼 to 夜 (the meaningful half of the cycle)", () => {
    const samples = [0.25, 0.35, 0.45, 0.5, 0.6, 0.75].map((t) => interpolateDayNight(t).nightAmount);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!).toBeGreaterThanOrEqual(samples[i - 1]!);
    }
  });
});

describe("groundLuminance — M0.5「一团黑泥」教训的量化护栏", () => {
  it("夜不低于白昼地面亮度的 40%", () => {
    const day = groundLuminance(DAY);
    const night = groundLuminance(NIGHT);
    expect(night / day).toBeGreaterThanOrEqual(0.4);
  });

  it("四个关键帧亮度排序符合直觉：白昼最亮，夜最暗，黎明/黄昏居中", () => {
    const lum = (kf: typeof DAWN) => groundLuminance(kf);
    expect(lum(DAY)).toBeGreaterThan(lum(DUSK));
    expect(lum(DAY)).toBeGreaterThan(lum(DAWN));
    expect(lum(DAY)).toBeGreaterThan(lum(NIGHT));
    expect(lum(NIGHT)).toBeLessThan(lum(DUSK));
    expect(lum(NIGHT)).toBeLessThan(lum(DAWN));
  });
});
