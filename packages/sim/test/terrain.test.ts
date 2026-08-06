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
    for (let i = -120; i <= 120; i += 7)
      expect(Math.abs(t.heightAt(i, -i))).toBeLessThanOrEqual(QINGQIU_GRAYBOX.hillAmp);
  });
  it("has both land and water", () => {
    let water = 0, land = 0;
    for (let x = -110; x <= 110; x += 5)
      for (let z = -110; z <= 110; z += 5) t.isWater(x, z) ? water++ : land++;
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
