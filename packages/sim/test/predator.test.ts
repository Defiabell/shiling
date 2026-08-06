import { describe, expect, it } from "vitest";
import { TUNING, SPECIES } from "@shiling/content";
import { createSim, getPlayer } from "../src/sim.js";

const idle = { moveX: 0, moveZ: 0, sprint: false, interact: false };

describe("tanshou ai", () => {
  it("hunts and damages the player", () => {
    const sim = createSim(31);
    const p = getPlayer(sim.state);
    const t = sim.state.creatures.find((c) => c.species === "tanshou")!;
    t.pos = { ...p.pos }; t.pos.x += 5; // 进入感知圈
    const hp0 = p.hp;
    for (let i = 0; i < TUNING.tickHz * 6; i++) sim.step(idle);
    expect(p.hp).toBeLessThan(hp0);
  });
  it("kills lingshu and produces a carcass, then feeds", () => {
    const sim = createSim(31);
    const p = getPlayer(sim.state);
    p.pos.x = -900; p.pos.z = -900;
    const t = sim.state.creatures.find((c) => c.species === "tanshou")!;
    const shu = sim.state.creatures.find((c) => c.species === "lingshu")!;
    t.pos = { ...shu.pos }; t.pos.x += 2;
    let sawCarcass = false;
    for (let i = 0; i < TUNING.tickHz * 30; i++) {
      sim.step(idle);
      if (sim.state.carcasses.some((c) => c.species === "lingshu")) sawCarcass = true;
    }
    expect(sawCarcass).toBe(true);
    expect(t.aiState === "feed" || t.satiatedTimer > 0).toBe(true);
  });
  it("cannot see burrowed player", () => {
    const sim = createSim(31);
    const p = getPlayer(sim.state);
    const t = sim.state.creatures.find((c) => c.species === "tanshou")!;
    t.pos = { ...p.pos }; t.pos.x += 5;
    p.burrowId = 1; p.locomotion = "burrow";
    for (let i = 0; i < TUNING.tickHz * 3; i++) sim.step(idle);
    expect(p.hp).toBe(SPECIES.youshou!.maxHp);
  });
});
