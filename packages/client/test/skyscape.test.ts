import { describe, expect, it } from "vitest";
import { celestialElevation, celestialWorldPos, cloudGainFor, starVisibilityFor } from "../src/render/skyscape.js";

const CELESTIAL_ORBIT_RADIUS = 380; // 镜像 skyscape.ts 同名私有常量——测试只断言不变量，不需要 import 私有常量本身

describe("celestialWorldPos — 大圆不变量（code review 补充）", () => {
  it("x²+y²+z² 对任意 t 恒等于 CELESTIAL_ORBIT_RADIUS²（真的是字面意义的一个大圆，不是椭圆/漂移轨道）", () => {
    for (let t = 0; t < 1; t += 0.03) {
      const { x, y, z } = celestialWorldPos(t);
      expect(Math.sqrt(x * x + y * y + z * z)).toBeCloseTo(CELESTIAL_ORBIT_RADIUS, 5);
    }
  });

  it("传入 out 参数时原地写入并原样返回同一个对象引用（零分配契约）", () => {
    const out = { x: 0, y: 0, z: 0 };
    const result = celestialWorldPos(0.25, out);
    expect(result).toBe(out);
    expect(out.y).toBeCloseTo(CELESTIAL_ORBIT_RADIUS, 5); // 白昼正午应在天顶
  });
});

// celestialElevation 是本批唯一"数学是否真的对"需要显式证明的部分——见 skyscape.ts
// 该函数头部注释：同一条连续公式必须在 t=0.25(白昼/正午) 与 t=0.75(夜/子夜) 都给出
// 仰角 1（天顶），在 t=0(黎明) 与 t=0.5(黄昏) 都给出 0（地平线）。
describe("celestialElevation — M2 A4「日月轮同一条大圆公式」", () => {
  it("黎明(t=0) 与黄昏(t=0.5) 都落在地平线（仰角 0）", () => {
    expect(celestialElevation(0)).toBeCloseTo(0, 10);
    expect(celestialElevation(0.5)).toBeCloseTo(0, 10);
  });

  it("白昼(t=0.25，太阳正午) 与 夜(t=0.75，月轮子夜) 都在天顶（仰角 1）——同一条公式，不分支", () => {
    expect(celestialElevation(0.25)).toBeCloseTo(1, 10);
    expect(celestialElevation(0.75)).toBeCloseTo(1, 10);
  });

  it("处处非负（|sin| 折叠下半圆，日月轮永远不会跑到地平线以下）", () => {
    for (let t = 0; t < 1; t += 0.02) {
      expect(celestialElevation(t)).toBeGreaterThanOrEqual(0);
      expect(celestialElevation(t)).toBeLessThanOrEqual(1);
    }
  });
});

describe("cloudGainFor — M2 A4「云海昼夜增益」", () => {
  it("at 白昼(0.25) the gain is 1.0（近白基准）", () => {
    expect(cloudGainFor(0.25)).toBeCloseTo(1.0, 5);
  });

  it("at 夜(0.75) the gain is exactly 0.35——brief 原话 night very dim", () => {
    expect(cloudGainFor(0.75)).toBeCloseTo(0.35, 5);
  });

  it("黎明(0.0) sits strictly between night and day gain", () => {
    const dawn = cloudGainFor(0.0);
    expect(dawn).toBeLessThan(1.0);
    expect(dawn).toBeGreaterThan(0.35);
  });

  it("never goes outside [0.35, 1.0] for any timeOfDay", () => {
    for (let t = 0; t < 1; t += 0.05) {
      const gain = cloudGainFor(t);
      expect(gain).toBeGreaterThanOrEqual(0.35);
      expect(gain).toBeLessThanOrEqual(1.0);
    }
  });
});

describe("starVisibilityFor — M2 A4「星河/银河 night-only 淡入淡出」", () => {
  it("白昼(0.25) 完全不可见", () => {
    expect(starVisibilityFor(0.25)).toBe(0);
  });

  it("夜(0.75) 完全可见", () => {
    expect(starVisibilityFor(0.75)).toBeCloseTo(1, 5);
  });

  it("黎明(0.0, nightAmount=0.35) 落在收紧阈值(0.4)之下，视为不可见——不是直接复用 nightAmount", () => {
    expect(starVisibilityFor(0.0)).toBe(0);
  });

  it("黄昏(0.5, nightAmount=0.65) 已经过了阈值下限，部分可见但未满", () => {
    const dusk = starVisibilityFor(0.5);
    expect(dusk).toBeGreaterThan(0);
    expect(dusk).toBeLessThan(1);
  });

  it("never pops outside [0,1] and stays within range across the full cycle", () => {
    for (let t = 0; t < 1; t += 0.02) {
      const v = starVisibilityFor(t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
