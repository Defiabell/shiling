import { describe, expect, it } from "vitest";
import { QINGQIU_GRAYBOX } from "@shiling/content";
import { createTerrain, mountainCenterFor, mountainMaskAt, MOUNTAIN_AMP_MULT } from "../src/terrain.js";

describe("createTerrain", () => {
  const t = createTerrain(42, QINGQIU_GRAYBOX);
  it("is deterministic", () => {
    const t2 = createTerrain(42, QINGQIU_GRAYBOX);
    expect(t.heightAt(10.5, -33.2)).toBe(t2.heightAt(10.5, -33.2));
  });
  it("heights bounded by amplitude", () => {
    // W2：世界 size 240→480，采样范围随之翻倍（step 同比放大，覆盖同样的相对边界）。
    // M15 P3：硬边界从 hillAmp 放宽到 hillAmp×MOUNTAIN_AMP_MULT——新的权威边界值，
    // 不是随手放宽（见 terrain.ts 里 globalAmp/edgeSubtract 头部的解析论证），导入
    // 常量而不是在测试里抄一份 1.6 的魔法数字。
    const bound = QINGQIU_GRAYBOX.hillAmp * MOUNTAIN_AMP_MULT;
    for (let i = -240; i <= 240; i += 14)
      expect(Math.abs(t.heightAt(i, -i))).toBeLessThanOrEqual(bound);
  });
  it("has both land and water", () => {
    // W2：范围/步长同比 ×2（220→440 跨度，step 5→10），采样点数与旧世界基本一致。
    let water = 0, land = 0;
    for (let x = -220; x <= 220; x += 10)
      for (let z = -220; z <= 220; z += 10) t.isWater(x, z) ? water++ : land++;
    expect(water).toBeGreaterThan(20);
    expect(land).toBeGreaterThan(water); // 陆地为主
  });
  it("dig spots on land only, correct count", () => {
    expect(t.digSpots).toHaveLength(QINGQIU_GRAYBOX.digSpotCount);
    for (const d of t.digSpots) expect(t.isWater(d.pos.x, d.pos.z)).toBe(false);
  });
  it("interpolates smoothly (no cliffs between samples)", () => {
    const a = t.heightAt(5, 5), b = t.heightAt(5.1, 5);
    expect(Math.abs(a - b)).toBeLessThan(0.5);
  });

  // M15 P3：世界边缘（含四角，r > half）保证在水下——见 terrain.ts 里 edgeSubtract
  // 头部的解析论证重新推导：山地区振幅 ×1.6 之后，这条 M0 就有的保证靠把 edgeSubtract
  // 的计算基准从 hillAmp 换成新的 globalAmp 依然成立，且不依赖"山地区离边缘有多远"这个
  // 额外假设——四角 r=half×√2>half，smoothstep 在这里同样 clamp 到满值 1，走的是同一套
  // 数学。
  it("world rim stays underwater regardless of the new mountain-zone amplitude", () => {
    const half = QINGQIU_GRAYBOX.size / 2;
    const points: Array<[number, number]> = [
      [half, 0], [-half, 0], [0, half], [0, -half],
      [half, half], [half, -half], [-half, half], [-half, -half],
    ];
    for (const [x, z] of points) expect(t.isWater(x, z)).toBe(true);
  });

  // M15 P3：险峰山地区应该读出"更高更崎岖"——用高度标准差（粗糙度代理）和最大值分别
  // 与关于原点对称的对照区域（同一世界内几乎不可能自己也恰好长成山地）比较。
  it("mountain zone reads taller/rougher than a symmetric control region", () => {
    const center = mountainCenterFor(42, QINGQIU_GRAYBOX.size);
    const inZone: number[] = [];
    const outZone: number[] = [];
    for (let dx = -40; dx <= 40; dx += 5) {
      for (let dz = -40; dz <= 40; dz += 5) {
        inZone.push(t.heightAt(center.x + dx, center.z + dz));
        outZone.push(t.heightAt(-center.x - dx, -center.z - dz));
      }
    }
    const stdev = (arr: number[]): number => {
      const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
      return Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length);
    };
    expect(stdev(inZone)).toBeGreaterThan(stdev(outZone));
    expect(Math.max(...inZone)).toBeGreaterThan(Math.max(...outZone));
  });

  it("mountainMaskAt is 1 at the center and decays to 0 well beyond the outer radius", () => {
    const center = { x: 100, z: -100 };
    expect(mountainMaskAt(center.x, center.z, center)).toBe(1);
    expect(mountainMaskAt(center.x + 200, center.z, center)).toBe(0);
  });
});

describe("createTerrain springs (M15 P3)", () => {
  const t = createTerrain(42, QINGQIU_GRAYBOX);

  it("carves exactly 3 spring pools", () => {
    expect(t.springs).toHaveLength(3);
  });

  it("springs are at least 60m apart from each other", () => {
    for (let i = 0; i < t.springs.length; i++) {
      for (let j = i + 1; j < t.springs.length; j++) {
        const a = t.springs[i]!.pos, b = t.springs[j]!.pos;
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(60);
      }
    }
  });

  it("each spring's carved pool center reads as water", () => {
    for (const s of t.springs) expect(t.isWater(s.pos.x, s.pos.z)).toBe(true);
  });

  it("no spring sits in the mountain zone's steepest core", () => {
    const center = mountainCenterFor(42, QINGQIU_GRAYBOX.size);
    for (const s of t.springs) expect(mountainMaskAt(s.pos.x, s.pos.z, center)).toBeLessThanOrEqual(0.6);
  });

  it("is deterministic — same seed produces identical spring positions", () => {
    const t2 = createTerrain(42, QINGQIU_GRAYBOX);
    expect(t2.springs).toEqual(t.springs);
  });

  it("carving a spring bowl does not break the interpolation-smoothness guarantee", () => {
    const s = t.springs[0]!;
    const a = t.heightAt(s.pos.x, s.pos.z);
    const b = t.heightAt(s.pos.x + 0.1, s.pos.z);
    expect(Math.abs(a - b)).toBeLessThan(0.5);
  });
});
