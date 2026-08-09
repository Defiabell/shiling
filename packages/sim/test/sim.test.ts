import { describe, expect, it } from "vitest";
import { TUNING } from "@shiling/content";
import { createSim, DT } from "../src/sim.js";

const IDLE = { moveX: 0, moveZ: 0, sprint: false, interact: false, attack: false, carry: false, dormant: false };

describe("createSim", () => {
  it("spawns player and world creatures", () => {
    const sim = createSim(1);
    const species = sim.state.creatures.map((c) => c.species).sort();
    expect(species.filter((s) => s === "lingshu")).toHaveLength(26);
    expect(species.filter((s) => s === "tanshou")).toHaveLength(4);
    expect(species.filter((s) => s === "youshou")).toHaveLength(1);
    // M1 B4：新物种 spawn 数——xiyu 10, xuehuan 8（见 content/world.ts QINGQIU_GRAYBOX.spawns）。
    expect(species.filter((s) => s === "xiyu")).toHaveLength(10);
    expect(species.filter((s) => s === "xuehuan")).toHaveLength(8);
  });
  // M1 B4：水生锁定物种必须出生在水里，否则 moveCreature 的挡水守卫会把它永远钉在陆地上。
  it("spawns aquatic species (xiyu) in water, never on land", () => {
    const sim = createSim(1);
    const fish = sim.state.creatures.filter((c) => c.species === "xiyu");
    expect(fish).toHaveLength(10);
    for (const f of fish) {
      expect(sim.terrain.isWater(f.pos.x, f.pos.z)).toBe(true);
      expect(f.locomotion).toBe("swim");
    }
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

// M1 B1：昼夜时钟。
describe("timeOfDay clock", () => {
  it("starts at 0.3 (spawn = mid-morning)", () => {
    const sim = createSim(1);
    expect(sim.state.timeOfDay).toBeCloseTo(0.3, 9);
  });
  it("advances by DT/dayLengthSec per tick", () => {
    const sim = createSim(1);
    sim.step(IDLE);
    expect(sim.state.timeOfDay).toBeCloseTo(0.3 + DT / TUNING.dayLengthSec, 9);
    sim.step(IDLE);
    expect(sim.state.timeOfDay).toBeCloseTo(0.3 + 2 * (DT / TUNING.dayLengthSec), 9);
  });
  it("wraps around to stay within [0,1) across a full day-night cycle", () => {
    const sim = createSim(1);
    const ticksPerDay = TUNING.tickHz * TUNING.dayLengthSec;
    for (let i = 0; i < ticksPerDay; i++) {
      sim.step(IDLE);
      expect(sim.state.timeOfDay).toBeGreaterThanOrEqual(0);
      expect(sim.state.timeOfDay).toBeLessThan(1);
    }
    // 恰好走完一整个昼夜循环（ticksPerDay 个 tick）之后应回到起点附近（浮点误差内）。
    expect(sim.state.timeOfDay).toBeCloseTo(0.3, 5);
  });
});
