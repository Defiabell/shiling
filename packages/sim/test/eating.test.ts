import { describe, expect, it } from "vitest";
import { TUNING, SPECIES } from "@shiling/content";
import { createSim, getPlayer } from "../src/sim.js";

const idle = { moveX: 0, moveZ: 0, sprint: false, interact: false };

describe("player hunting & eating", () => {
  function isolate(sim: ReturnType<typeof createSim>) {
    // 清掉潭狩避免干扰
    sim.state.creatures = sim.state.creatures.filter((c) => c.species !== "tanshou");
  }
  it("player attack kills lingshu into carcass", () => {
    const sim = createSim(41);
    isolate(sim);
    const p = getPlayer(sim.state);
    const shu = sim.state.creatures.find((c) => c.species === "lingshu")!;
    const hits = Math.ceil(SPECIES.lingshu!.maxHp / SPECIES.youshou!.attackDamage);
    for (let h = 0; h < hits; h++) {
      shu.pos = { ...p.pos }; shu.pos.x += 1; // 苓鼠会逃，测试里钉回攻击范围
      sim.step({ ...idle, interact: true });
      for (let i = 0; i < TUNING.tickHz; i++) sim.step(idle); // 等冷却
    }
    expect(sim.state.carcasses.some((c) => c.species === "lingshu")).toBe(true);
  });
  it("eating a carcass restores hunger over time and consumes meat", () => {
    const sim = createSim(41);
    isolate(sim);
    const p = getPlayer(sim.state);
    sim.state.carcasses.push({ id: 999, species: "lingshu", pos: { ...p.pos }, meat: 30 });
    p.needs.hunger = 20;
    const secs = 5;
    for (let i = 0; i < TUNING.tickHz * secs; i++) sim.step({ ...idle, interact: true });
    const eaten = TUNING.eatMeatPerSec * secs;
    expect(p.needs.hunger).toBeCloseTo(20 + eaten * TUNING.hungerPerMeat, 0);
    expect(sim.state.carcasses[0]!.meat).toBeCloseTo(30 - eaten, 0);
    expect(p.activity).toBe("eating");
  });
  it("moving interrupts eating; empty carcass disappears", () => {
    const sim = createSim(41);
    isolate(sim);
    const p = getPlayer(sim.state);
    sim.state.carcasses.push({ id: 999, species: "lingshu", pos: { ...p.pos }, meat: 2 });
    sim.step({ ...idle, interact: true });
    sim.step({ moveX: 1, moveZ: 0, sprint: false, interact: false });
    expect(p.activity).not.toBe("eating");
    for (let i = 0; i < TUNING.tickHz * 2; i++) sim.step({ ...idle, interact: true });
    expect(sim.state.carcasses.some((c) => c.id === 999)).toBe(false); // 2 肉早被吃光
  });
});
