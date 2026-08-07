import { describe, expect, it } from "vitest";
import { QINGQIU_GRAYBOX } from "@shiling/content";
import { createTerrain } from "../src/terrain.js";

describe("createTerrain", () => {
  const t = createTerrain(42, QINGQIU_GRAYBOX);
  it("is deterministic", () => {
    const t2 = createTerrain(42, QINGQIU_GRAYBOX);
    expect(t.heightAt(10.5, -33.2)).toBe(t2.heightAt(10.5, -33.2));
  });
  it("heights bounded by amplitude", () => {
    // W2：世界 size 240→480，采样范围随之翻倍（step 同比放大，覆盖同样的相对边界）。
    for (let i = -240; i <= 240; i += 14)
      expect(Math.abs(t.heightAt(i, -i))).toBeLessThanOrEqual(QINGQIU_GRAYBOX.hillAmp);
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
});
