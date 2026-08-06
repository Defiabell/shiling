import { describe, expect, it } from "vitest";
import { TUNING } from "@shiling/content";
import { createSim, getPlayer } from "../src/sim.js";

const idle = { moveX: 0, moveZ: 0, sprint: false, interact: false };

describe("tickNeeds", () => {
  it("hunger and thirst decay over time", () => {
    const sim = createSim(5);
    const p = getPlayer(sim.state);
    const h0 = p.needs.hunger, t0 = p.needs.thirst;
    for (let i = 0; i < TUNING.tickHz * 10; i++) sim.step(idle); // 10 秒
    expect(p.needs.hunger).toBeCloseTo(h0 - TUNING.hungerDecayPerSec * 10, 1);
    expect(p.needs.thirst).toBeCloseTo(t0 - TUNING.thirstDecayPerSec * 10, 1);
  });
  it("fatigue recovers when idle", () => {
    const sim = createSim(5);
    const p = getPlayer(sim.state);
    p.needs.fatigue = 40;
    for (let i = 0; i < TUNING.tickHz * 5; i++) sim.step(idle);
    expect(p.needs.fatigue).toBeGreaterThan(40);
  });
  it("starvation drains hp and kills", () => {
    const sim = createSim(5);
    const p = getPlayer(sim.state);
    p.needs.hunger = 0; p.needs.thirst = 0; p.hp = 3;
    for (let i = 0; i < TUNING.tickHz * 5; i++) sim.step(idle);
    expect(sim.state.playerDead).toBe(true);
  });
  it("drinking near water restores thirst", () => {
    const sim = createSim(5);
    const p = getPlayer(sim.state);
    // 找水点并把玩家放进去
    outer: for (let x = -110; x <= 110; x += 3)
      for (let z = -110; z <= 110; z += 3)
        if (sim.terrain.isWater(x, z)) { p.pos.x = x; p.pos.z = z; break outer; }
    p.needs.thirst = 20;
    for (let i = 0; i < TUNING.tickHz * 2; i++) sim.step({ ...idle, interact: true });
    expect(p.needs.thirst).toBeGreaterThan(20 + TUNING.drinkPerSec * 1.5);
  });
});
