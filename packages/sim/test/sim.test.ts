import { describe, expect, it } from "vitest";
import { createSim } from "../src/sim.js";

const IDLE = { moveX: 0, moveZ: 0, sprint: false, interact: false, attack: false, carry: false };

describe("createSim", () => {
  it("spawns player and world creatures", () => {
    const sim = createSim(1);
    const species = sim.state.creatures.map((c) => c.species).sort();
    expect(species.filter((s) => s === "lingshu")).toHaveLength(26);
    expect(species.filter((s) => s === "tanshou")).toHaveLength(4);
    expect(species.filter((s) => s === "youshou")).toHaveLength(1);
  });
  it("advances ticks", () => {
    const sim = createSim(1);
    sim.step(IDLE); sim.step(IDLE);
    expect(sim.state.tick).toBe(2);
  });
  it("same seed same layout", () => {
    const a = createSim(9), b = createSim(9);
    expect(a.state.creatures.map((c) => c.pos)).toEqual(b.state.creatures.map((c) => c.pos));
  });
  it("different seed different layout", () => {
    const a = createSim(9), b = createSim(10);
    expect(a.state.creatures.map((c) => c.pos)).not.toEqual(b.state.creatures.map((c) => c.pos));
  });
});
