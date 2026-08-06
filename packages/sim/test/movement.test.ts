import { describe, expect, it } from "vitest";
import { createSim, DT, getPlayer } from "../src/sim.js";
import { SPECIES } from "@shiling/content";

const idle = { moveX: 0, moveZ: 0, sprint: false, interact: false };

function findLandNear(sim: ReturnType<typeof createSim>, x: number, z: number) {
  // 把玩家硬放到指定点（测试用）
  const p = getPlayer(sim.state);
  p.pos.x = x; p.pos.z = z; p.pos.y = sim.terrain.heightAt(x, z);
  return p;
}

describe("movePlayer", () => {
  it("moves at walk speed and snaps to ground", () => {
    const sim = createSim(3);
    const p = getPlayer(sim.state);
    const start = { ...p.pos };
    sim.step({ ...idle, moveX: 1, moveZ: 0 });
    const moved = Math.hypot(p.pos.x - start.x, p.pos.z - start.z);
    expect(moved).toBeCloseTo(SPECIES.youshou!.walkSpeed * DT, 3);
    expect(p.pos.y).toBeCloseTo(sim.terrain.heightAt(p.pos.x, p.pos.z), 6);
  });
  it("sprint is faster and drains fatigue", () => {
    const sim = createSim(3);
    const p = getPlayer(sim.state);
    const f0 = p.needs.fatigue;
    const start = { ...p.pos };
    sim.step({ ...idle, moveX: 0, moveZ: 1, sprint: true });
    const moved = Math.hypot(p.pos.x - start.x, p.pos.z - start.z);
    expect(moved).toBeGreaterThan(SPECIES.youshou!.walkSpeed * DT * 1.5);
    expect(p.needs.fatigue).toBeLessThan(f0);
  });
  it("switches to swim in water", () => {
    const sim = createSim(3);
    // 找一个水点，把玩家放到旁边一步之遥再走进去
    let wx = 0, wz = 0, found = false;
    for (let x = -110; x <= 110 && !found; x += 3)
      for (let z = -110; z <= 110 && !found; z += 3)
        if (sim.terrain.isWater(x, z)) { wx = x; wz = z; found = true; }
    expect(found).toBe(true);
    const p = findLandNear(sim, wx, wz);
    sim.step(idle);
    expect(p.locomotion).toBe("swim");
    expect(p.pos.y).toBeCloseTo(sim.terrain.waterLevel, 6);
  });
  it("stays inside world bounds", () => {
    const sim = createSim(3);
    const p = getPlayer(sim.state);
    for (let i = 0; i < 20 * 120; i++) sim.step({ ...idle, moveX: 1, moveZ: 0 });
    expect(Math.abs(p.pos.x)).toBeLessThanOrEqual(sim.terrain.size / 2);
  });
});
