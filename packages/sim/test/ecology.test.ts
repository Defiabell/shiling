import { describe, expect, it } from "vitest";
import { TUNING } from "@shiling/content";
import { createSim, getPlayer } from "../src/sim.js";

const idle = { moveX: 0, moveZ: 0, sprint: false, interact: false, attack: false, carry: false, dormant: false };

describe("headless ecology", () => {
  it("runs 10 sim-minutes without collapse or NaN", () => {
    const sim = createSim(2026);
    const p = getPlayer(sim.state);
    p.pos.x = -900; p.pos.z = -900; // 玩家旁观（clamp 到角落）
    p.needs.hunger = 100; p.needs.thirst = 100;
    for (let i = 0; i < TUNING.tickHz * 600; i++) {
      p.needs.hunger = 100; p.needs.thirst = 100; // 旁观者不死
      sim.step(idle);
    }
    for (const c of sim.state.creatures) {
      expect(Number.isFinite(c.pos.x)).toBe(true);
      expect(Number.isFinite(c.pos.y)).toBe(true);
      expect(Number.isFinite(c.pos.z)).toBe(true);
      expect(Math.abs(c.pos.x)).toBeLessThanOrEqual(sim.terrain.size / 2);
    }
    const lingshu = sim.state.creatures.filter((c) => c.species === "lingshu").length;
    expect(lingshu).toBeGreaterThan(0); // 苓鼠没有被灭绝
    expect(sim.state.creatures.some((c) => c.species === "tanshou")).toBe(true);
  });
  it("two sims with same seed and same inputs stay identical", () => {
    const a = createSim(7), b = createSim(7);
    for (let i = 0; i < TUNING.tickHz * 60; i++) { a.step(idle); b.step(idle); }
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
  });
});
