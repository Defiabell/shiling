import { describe, expect, it } from "vitest";
import { TUNING, SPECIES } from "@shiling/content";
import { createSim, getPlayer } from "../src/sim.js";
import { getModifiers } from "../src/organs.js";

const idle = { moveX: 0, moveZ: 0, sprint: false, interact: false, attack: false, carry: false };

function isolate(sim: ReturnType<typeof createSim>) {
  // 清掉潭狩避免干扰（同 eating.test.ts 的手法）。
  sim.state.creatures = sim.state.creatures.filter((c) => c.species !== "tanshou");
}

describe("carrying", () => {
  it("C picks up a nearby carcass", () => {
    const sim = createSim(41);
    isolate(sim);
    const p = getPlayer(sim.state);
    sim.state.carcasses.push({ id: 999, species: "lingshu", pos: { ...p.pos }, meat: 30 });
    sim.step({ ...idle, carry: true });
    expect(p.carryingCarcassId).toBe(999);
  });

  it("carried carcass follows the player each tick, offset in front and at player height", () => {
    const sim = createSim(41);
    isolate(sim);
    const p = getPlayer(sim.state);
    sim.state.carcasses.push({ id: 999, species: "lingshu", pos: { ...p.pos }, meat: 30 });
    sim.step({ ...idle, carry: true }); // 叼起
    sim.step({ ...idle, moveX: 1, moveZ: 0 }); // 边走边叼
    const carcass = sim.state.carcasses.find((c) => c.id === 999)!;
    expect(carcass.pos.y).toBeCloseTo(p.pos.y, 6);
    const dist = Math.hypot(carcass.pos.x - p.pos.x, carcass.pos.z - p.pos.z);
    expect(dist).toBeGreaterThan(0); // 在下巴前方，不是精确重合于脚下
    expect(dist).toBeLessThanOrEqual(TUNING.interactRange); // 仍落在"附近有尸体"判定范围内
  });

  it("C again drops the carcass at the current (ground-aligned) position", () => {
    const sim = createSim(41);
    isolate(sim);
    const p = getPlayer(sim.state);
    sim.state.carcasses.push({ id: 999, species: "lingshu", pos: { ...p.pos }, meat: 30 });
    sim.step({ ...idle, carry: true }); // 叼起
    sim.step(idle); // 松开（边沿检测：不松开无法触发第二次动作）
    sim.step({ ...idle, carry: true }); // 放下
    expect(p.carryingCarcassId).toBeNull();
    const carcass = sim.state.carcasses.find((c) => c.id === 999)!;
    expect(carcass.pos.y).toBeCloseTo(sim.terrain.heightAt(carcass.pos.x, carcass.pos.z), 6);
  });

  it("holding C without releasing does not re-trigger drop (edge-triggered toggle)", () => {
    const sim = createSim(41);
    isolate(sim);
    const p = getPlayer(sim.state);
    sim.state.carcasses.push({ id: 999, species: "lingshu", pos: { ...p.pos }, meat: 30 });
    sim.step({ ...idle, carry: true }); // 叼起
    sim.step({ ...idle, carry: true }); // 继续按住，不应该触发放下
    expect(p.carryingCarcassId).toBe(999);
  });

  it("carrying slows movement by carrySpeedMult", () => {
    const sim = createSim(41);
    isolate(sim);
    const p = getPlayer(sim.state);
    sim.state.carcasses.push({ id: 999, species: "lingshu", pos: { ...p.pos }, meat: 30 });
    sim.step({ ...idle, carry: true }); // 叼起（本 tick movePlayer 先跑，carryingCarcassId 尚未生效）
    const start = { ...p.pos };
    // M1 B2：本命「神种」自带 walkSpeedMult，与 carrySpeedMult 乘法叠加——机械更新
    // 预期值把这个乘数也算进去（见 movement.test.ts 同款注释）。
    const organMult = getModifiers(sim.state).walkSpeedMult;
    sim.step({ ...idle, moveX: 0, moveZ: 1 });
    const moved = Math.hypot(p.pos.x - start.x, p.pos.z - start.z);
    const expected = SPECIES.youshou!.walkSpeed * TUNING.carrySpeedMult * organMult * (1 / TUNING.tickHz);
    expect(moved).toBeCloseTo(expected, 3);
  });

  it("attack is ignored while carrying (J/attack has no effect)", () => {
    const sim = createSim(41);
    isolate(sim);
    const p = getPlayer(sim.state);
    sim.state.carcasses.push({ id: 999, species: "lingshu", pos: { ...p.pos }, meat: 30 });
    sim.step({ ...idle, carry: true }); // 叼起
    const shu = sim.state.creatures.find((c) => c.species === "lingshu")!;
    const hp0 = shu.hp;
    for (let i = 0; i < TUNING.tickHz * 2; i++) {
      shu.pos = { x: p.pos.x + 1, y: p.pos.y, z: p.pos.z }; // 钉在攻击范围内
      sim.step({ ...idle, attack: true });
    }
    expect(shu.hp).toBe(hp0); // 两秒内攻击本应至少命中一次，但叼着东西时应完全不判定
    expect(p.activity).not.toBe("attacking");
  });

  it("cannot pick up while burrowed", () => {
    const sim = createSim(41);
    isolate(sim);
    const p = getPlayer(sim.state);
    p.burrowId = 1;
    p.locomotion = "burrow";
    sim.state.carcasses.push({ id: 999, species: "lingshu", pos: { ...p.pos }, meat: 30 });
    sim.step({ ...idle, carry: true });
    expect(p.carryingCarcassId).toBeNull();
  });

  it("cannot pick up while digging", () => {
    const sim = createSim(41);
    isolate(sim);
    const p = getPlayer(sim.state);
    const spot = sim.terrain.digSpots[0]!;
    p.pos = { ...spot.pos };
    sim.state.carcasses.push({ id: 999, species: "lingshu", pos: { ...p.pos }, meat: 30 });
    sim.step({ ...idle, interact: true }); // 开始挖掘
    expect(p.activity).toBe("digging");
    sim.step({ ...idle, interact: true, carry: true });
    expect(p.carryingCarcassId).toBeNull();
  });

  it("cannot enter or dig a burrow while carrying (carry+burrow exclusion)", () => {
    const sim = createSim(41);
    isolate(sim);
    const p = getPlayer(sim.state);
    const spot = sim.terrain.digSpots[0]!;
    p.pos = { ...spot.pos };
    sim.state.carcasses.push({ id: 999, species: "lingshu", pos: { ...p.pos }, meat: 30 });
    sim.step({ ...idle, carry: true }); // 叼起
    expect(p.carryingCarcassId).toBe(999);
    const ticks = Math.ceil((TUNING.digDurationSec + 1) * TUNING.tickHz);
    for (let i = 0; i < ticks; i++) sim.step({ ...idle, interact: true });
    expect(spot.dug).toBe(false);
    expect(p.burrowId).toBeNull();
  });

  it("depositing into stash caps at nestStashCap; overflow drops as a carcass with the remaining meat", () => {
    const sim = createSim(41);
    isolate(sim);
    const p = getPlayer(sim.state);
    const spot = sim.terrain.digSpots[0]!;
    spot.dug = true;
    sim.state.homeNest = { spotId: spot.id, stash: TUNING.nestStashCap - 10 };
    p.pos = { ...spot.pos };
    sim.state.carcasses.push({ id: 999, species: "lingshu", pos: { ...p.pos }, meat: 30 });
    sim.step({ ...idle, carry: true }); // 叼起
    sim.step(idle); // 松开
    sim.step({ ...idle, carry: true }); // 放下=在巢穴附近存粮
    expect(sim.state.homeNest!.stash).toBe(TUNING.nestStashCap);
    const carcass = sim.state.carcasses.find((c) => c.id === 999);
    expect(carcass).toBeDefined();
    expect(carcass!.meat).toBeCloseTo(20, 6); // 30 里存进 10，溢出 20 照常掉落
  });

  it("depositing fully into stash (no overflow) removes the carcass entirely", () => {
    const sim = createSim(41);
    isolate(sim);
    const p = getPlayer(sim.state);
    const spot = sim.terrain.digSpots[0]!;
    spot.dug = true;
    sim.state.homeNest = { spotId: spot.id, stash: 0 };
    p.pos = { ...spot.pos };
    sim.state.carcasses.push({ id: 999, species: "lingshu", pos: { ...p.pos }, meat: 30 });
    sim.step({ ...idle, carry: true });
    sim.step(idle);
    sim.step({ ...idle, carry: true });
    expect(sim.state.homeNest!.stash).toBe(30);
    expect(sim.state.carcasses.some((c) => c.id === 999)).toBe(false);
  });

  it("dropping without a nearby home nest just places the carcass at the current position (no stash change)", () => {
    const sim = createSim(41);
    isolate(sim);
    const p = getPlayer(sim.state);
    const spot = sim.terrain.digSpots[0]!;
    spot.dug = true;
    sim.state.homeNest = { spotId: spot.id, stash: 5 };
    p.pos.x = -900; p.pos.z = -900; // 远离巢穴
    sim.state.carcasses.push({ id: 999, species: "lingshu", pos: { ...p.pos }, meat: 30 });
    sim.step({ ...idle, carry: true });
    sim.step(idle);
    sim.step({ ...idle, carry: true });
    expect(sim.state.homeNest!.stash).toBe(5); // 未变化
    const carcass = sim.state.carcasses.find((c) => c.id === 999)!;
    expect(carcass.meat).toBe(30); // 尸体原样掉落，没有被存粮逻辑动过
  });
});
