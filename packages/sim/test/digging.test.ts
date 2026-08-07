import { describe, expect, it } from "vitest";
import { TUNING } from "@shiling/content";
import { createSim, getPlayer } from "../src/sim.js";

const idle = { moveX: 0, moveZ: 0, sprint: false, interact: false, attack: false };

function placeAtSpot(sim: ReturnType<typeof createSim>) {
  const p = getPlayer(sim.state);
  const spot = sim.terrain.digSpots[0]!;
  p.pos = { ...spot.pos };
  return { p, spot };
}

describe("digging", () => {
  it("digging a spot takes digDurationSec then enters burrow", () => {
    const sim = createSim(11);
    const { p, spot } = placeAtSpot(sim);
    const ticksNeeded = Math.ceil(TUNING.digDurationSec * TUNING.tickHz);
    for (let i = 0; i < ticksNeeded - 2; i++) sim.step({ ...idle, interact: true });
    expect(spot.dug).toBe(false);
    expect(p.activity).toBe("digging");
    for (let i = 0; i < 4; i++) sim.step({ ...idle, interact: true });
    expect(spot.dug).toBe(true);
    expect(p.burrowId).toBe(spot.id);
    expect(p.locomotion).toBe("burrow");
  });
  it("movement cancels digging", () => {
    const sim = createSim(11);
    const { p, spot } = placeAtSpot(sim);
    sim.step({ ...idle, interact: true });
    sim.step({ moveX: 1, moveZ: 0, sprint: false, interact: false, attack: false });
    expect(p.activity).not.toBe("digging");
    expect(spot.dug).toBe(false);
  });
  it("interact toggles exit from burrow", () => {
    const sim = createSim(11);
    const { p, spot } = placeAtSpot(sim);
    spot.dug = true;
    sim.step({ ...idle, interact: true });          // 入洞
    expect(p.burrowId).toBe(spot.id);
    sim.step(idle);                                  // 松开
    sim.step({ ...idle, interact: true });          // 出洞
    expect(p.burrowId).toBeNull();
    expect(p.locomotion).toBe("walk");
  });
});
