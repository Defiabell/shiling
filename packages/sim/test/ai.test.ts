import { describe, expect, it } from "vitest";
import { TUNING } from "@shiling/content";
import { createSim, getPlayer } from "../src/sim.js";
import { dist2d } from "../src/vec.js";

const idle = { moveX: 0, moveZ: 0, sprint: false, interact: false };

describe("lingshu ai", () => {
  it("flees when player is near", () => {
    const sim = createSim(21);
    const p = getPlayer(sim.state);
    const shu = sim.state.creatures.find((c) => c.species === "lingshu")!;
    p.pos = { ...shu.pos }; p.pos.x += 3; // 进入感知圈
    const d0 = dist2d(p.pos, shu.pos);
    for (let i = 0; i < TUNING.tickHz * 3; i++) sim.step(idle);
    expect(shu.aiState).toBe("flee");
    expect(dist2d(p.pos, shu.pos)).toBeGreaterThan(d0);
  });
  it("grazes when hungry and recovers hunger", () => {
    const sim = createSim(21);
    const p = getPlayer(sim.state);
    p.pos.x = -900; p.pos.z = -900; // 玩家挪出感知范围（clamp 到边界也足够远）
    const shu = sim.state.creatures.find((c) => c.species === "lingshu")!;
    shu.needs.hunger = 30;
    for (let i = 0; i < TUNING.tickHz * 8; i++) sim.step(idle);
    expect(shu.needs.hunger).toBeGreaterThan(30);
  });
  it("does not flee from burrowed player", () => {
    const sim = createSim(21);
    const p = getPlayer(sim.state);
    const shu = sim.state.creatures.find((c) => c.species === "lingshu")!;
    p.pos = { ...shu.pos }; p.pos.x += 3;
    p.burrowId = 1; p.locomotion = "burrow";
    sim.step(idle);
    expect(shu.aiState).not.toBe("flee");
  });
});
