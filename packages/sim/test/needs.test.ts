import { describe, expect, it } from "vitest";
import { QINGQIU_GRAYBOX, TUNING } from "@shiling/content";
import { createSim, getPlayer, spawnCreature } from "../src/sim.js";
import { createRng } from "../src/rng.js";
import { killCreature } from "../src/needs.js";

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

// Task 4 的延迟回调：现在 killCreature 已存在，锁定 id 单调不回收的保证
// （state.nextId 从不因生物/尸体移除而复用，见 state.ts 的 nextId 注释）。
describe("id uniqueness after creature removal", () => {
  it("spawnCreature does not reuse an id freed by killCreature", () => {
    const sim = createSim(5);
    const npc = sim.state.creatures.find((c) => c.id !== sim.state.playerId)!;
    const deadId = npc.id;
    killCreature(sim.state, npc);
    expect(sim.state.creatures.some((c) => c.id === deadId)).toBe(false);
    expect(sim.state.carcasses.some((c) => c.id === deadId)).toBe(true);

    const existingIds = new Set([
      ...sim.state.creatures.map((c) => c.id),
      ...sim.state.carcasses.map((c) => c.id),
    ]);
    const rng = createRng(5);
    const spawned = spawnCreature(sim.state, rng, sim.terrain, QINGQIU_GRAYBOX, "lingshu");
    expect(existingIds.has(spawned.id)).toBe(false);
  });
});
