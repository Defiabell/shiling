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

  // 回归测试（Finding 1）：水边且攻击范围内有活着的猎物时，攻击必须压过饮水——包括冷却中的
  // tick（一秒 20 个 tick 里最多 1 个能真正出手，其余 19 个在冷却）。修复前 needs.ts 的饮水
  // 守卫完全没接"是否存在攻击目标"，会在这些 tick 里把 activity 覆写成 "drinking" 并回复
  // 口渴，等于水边战斗白嫖饮水。
  it("attacking a living target in range wins over drinking at the water's edge, even on cooldown ticks", () => {
    const sim = createSim(41);
    sim.state.creatures = sim.state.creatures.filter((c) => c.species !== "tanshou"); // 隔离潭狩干扰
    const p = getPlayer(sim.state);
    const shu = sim.state.creatures.find((c) => c.species === "lingshu")!;

    // 找水点并把玩家放进去（同上一个测试的手法）
    outer: for (let x = -110; x <= 110; x += 3)
      for (let z = -110; z <= 110; z += 3)
        if (sim.terrain.isWater(x, z)) { p.pos.x = x; p.pos.z = z; break outer; }

    p.needs.thirst = 50;
    const t0 = p.needs.thirst;

    // 持续 hold interact 1 秒；每 tick 前把苓鼠钉在玩家攻击范围内（否则苓鼠受伤/游走的 AI
    // 会把它带离攻击范围，干扰本测试要验证的"目标始终在场"前提）。
    for (let i = 0; i < TUNING.tickHz; i++) {
      shu.pos = { x: p.pos.x + 0.5, y: p.pos.y, z: p.pos.z };
      sim.step({ ...idle, interact: true });
    }

    expect(shu.activity).not.toBe("dead"); // 冷却 1s 内最多命中一次，25 HP 苓鼠应仍存活
    // 攻击压过饮水：口渴只受衰减影响，全程不应有一次饮水回复叠加进来。
    expect(p.needs.thirst).toBeCloseTo(t0 - TUNING.thirstDecayPerSec * 1, 1);
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
