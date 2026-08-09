import { describe, expect, it } from "vitest";
import { SPECIES, TUNING } from "@shiling/content";
import { createSim, getPlayer } from "../src/sim.js";
import { gainEssence } from "../src/essence.js";

const idle = { moveX: 0, moveZ: 0, sprint: false, interact: false, attack: false, carry: false };

describe("gainEssence (unit)", () => {
  it("adds meatEaten * essenceYieldPerMeat to the victim species' essence type", () => {
    const sim = createSim(1);
    gainEssence(sim.state, "lingshu", 10); // lingshu: zu, yield 0.5
    expect(sim.state.essence.zu).toBeCloseTo(10 * SPECIES.lingshu!.essenceYieldPerMeat, 6);
    expect(sim.state.essence.lin).toBe(0);
    expect(sim.state.essence.xue).toBe(0);
    expect(sim.state.essence.meng).toBe(0);
  });
  it("clamps at TUNING.essenceCap", () => {
    const sim = createSim(1);
    gainEssence(sim.state, "tanshou", 100000); // tanshou: meng
    expect(sim.state.essence.meng).toBe(TUNING.essenceCap);
  });
  it("unknown species is a silent no-op (does not throw, does not mutate essence)", () => {
    const sim = createSim(1);
    expect(() => gainEssence(sim.state, "does-not-exist", 10)).not.toThrow();
    expect(sim.state.essence).toEqual({ zu: 0, lin: 0, xue: 0, meng: 0 });
  });
  it("non-positive meatEaten is a no-op", () => {
    const sim = createSim(1);
    gainEssence(sim.state, "lingshu", 0);
    gainEssence(sim.state, "lingshu", -5);
    expect(sim.state.essence.zu).toBe(0);
  });
});

describe("essence via eating (integration)", () => {
  function isolate(sim: ReturnType<typeof createSim>) {
    sim.state.creatures = sim.state.creatures.filter((c) => c.species !== "tanshou");
  }

  it("eating a fresh carcass gains essence of the victim species", () => {
    const sim = createSim(41);
    isolate(sim);
    const p = getPlayer(sim.state);
    sim.state.carcasses.push({ id: 999, species: "lingshu", pos: { ...p.pos }, meat: 30 });
    const secs = 2;
    for (let i = 0; i < TUNING.tickHz * secs; i++) sim.step({ ...idle, interact: true });
    const eaten = TUNING.eatMeatPerSec * secs;
    expect(sim.state.essence.zu).toBeCloseTo(eaten * SPECIES.lingshu!.essenceYieldPerMeat, 1);
    // 只喂了 zu，其余三类保持 0——essence 桶按物种精确分账，不会串到别的类型。
    expect(sim.state.essence.lin).toBe(0);
    expect(sim.state.essence.xue).toBe(0);
    expect(sim.state.essence.meng).toBe(0);
  });

  it("repeated fresh eating clamps essence at essenceCap even over a long session", () => {
    const sim = createSim(41);
    isolate(sim);
    const p = getPlayer(sim.state);
    sim.state.carcasses.push({ id: 999, species: "lingshu", pos: { ...p.pos }, meat: 100000 });
    for (let i = 0; i < TUNING.tickHz * 120; i++) sim.step({ ...idle, interact: true });
    expect(sim.state.essence.zu).toBe(TUNING.essenceCap);
  });

  // 关键回归：巢中吃储粮（burrow 自动进食分支）必须获得零精气——精气随死亡消散，
  // 只有洞外吃鲜尸才养精，见 eating.ts/essence.ts 的设计权衡注释。
  it("eating stash inside the home nest burrow gains ZERO essence", () => {
    const sim = createSim(41);
    isolate(sim);
    const p = getPlayer(sim.state);
    sim.state.homeNest = { spotId: 42, stash: 40 };
    p.burrowId = 42;
    p.locomotion = "burrow";
    p.needs.hunger = 20;
    const secs = 3;
    for (let i = 0; i < TUNING.tickHz * secs; i++) sim.step(idle); // 全程不按任何键，纯自动进食
    // sanity：确认自动进食确实在发生（否则下面的"零精气"断言会是假阳性）。
    expect(sim.state.homeNest!.stash).toBeLessThan(40);
    expect(sim.state.essence).toEqual({ zu: 0, lin: 0, xue: 0, meng: 0 });
  });
});
