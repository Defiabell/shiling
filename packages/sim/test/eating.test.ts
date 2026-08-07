import { describe, expect, it } from "vitest";
import { TUNING, SPECIES } from "@shiling/content";
import { createSim, getPlayer } from "../src/sim.js";

const idle = { moveX: 0, moveZ: 0, sprint: false, interact: false, attack: false };

describe("player hunting & eating", () => {
  function isolate(sim: ReturnType<typeof createSim>) {
    // 清掉潭狩避免干扰
    sim.state.creatures = sim.state.creatures.filter((c) => c.species !== "tanshou");
  }
  // 键位拆分（W2）：撕咬现在读 input.attack（左键），不再是 interact（E）。
  it("player attack kills lingshu into carcass", () => {
    const sim = createSim(41);
    isolate(sim);
    const p = getPlayer(sim.state);
    const shu = sim.state.creatures.find((c) => c.species === "lingshu")!;
    const hits = Math.ceil(SPECIES.lingshu!.maxHp / SPECIES.youshou!.attackDamage);
    for (let h = 0; h < hits; h++) {
      shu.pos = { ...p.pos }; shu.pos.x += 1; // 苓鼠会逃，测试里钉回攻击范围
      sim.step({ ...idle, attack: true });
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
    sim.step({ moveX: 1, moveZ: 0, sprint: false, interact: false, attack: false });
    expect(p.activity).not.toBe("eating");
    for (let i = 0; i < TUNING.tickHz * 2; i++) sim.step({ ...idle, interact: true });
    expect(sim.state.carcasses.some((c) => c.id === 999)).toBe(false); // 2 肉早被吃光
  });

  // 回归测试：早退路径必须把残留的 "eating" 降级回 "idle"，否则 needs.ts 的饥饿衰减
  // 会被永久冻结（此前的 bug）。
  it("releasing interact while stationary lets hunger decay resume (activity must not freeze at 'eating')", () => {
    const sim = createSim(41);
    isolate(sim);
    const p = getPlayer(sim.state);
    sim.state.carcasses.push({ id: 998, species: "lingshu", pos: { ...p.pos }, meat: 30 });
    p.needs.hunger = 50;
    sim.step({ ...idle, interact: true }); // 吃一口
    expect(p.activity).toBe("eating");
    sim.step(idle); // 松开 interact，原地不动
    expect(p.activity).not.toBe("eating"); // activity 必须被降级，不能停留在 "eating"
    const hungerAfterRelease = p.needs.hunger;
    for (let i = 0; i < TUNING.tickHz * 2; i++) sim.step(idle); // 静置 2 秒
    expect(p.needs.hunger).toBeLessThan(hungerAfterRelease); // 饥饿衰减必须恢复，不能被冻结
  });

  // 回归测试：needs.ts 的衰减抵消只能作用于进食者自己（在 eating.ts 的公式里），不能变成
  // 按 activity 全局特判——否则会悄悄把苓鼠 graze 的净回复速率从 0.45/s buff 到 0.8/s。
  it("lingshu graze net hunger rate is grazeHungerPerSec minus hungerDecayPerSec (no unscoped decay-skip buff)", () => {
    const sim = createSim(21);
    const p = getPlayer(sim.state);
    p.pos.x = -900; p.pos.z = -900; // 玩家挪出感知范围，避免苓鼠因玩家而进入 flee
    sim.state.creatures = sim.state.creatures.filter((c) => c.species !== "tanshou"); // 隔离潭狩
    const shu = sim.state.creatures.find((c) => c.species === "lingshu")!;
    shu.needs.hunger = 30;
    const secs = 5;
    for (let i = 0; i < TUNING.tickHz * secs; i++) sim.step(idle);
    const netPerSec = (shu.needs.hunger - 30) / secs;
    expect(netPerSec).toBeCloseTo(TUNING.grazeHungerPerSec - TUNING.hungerDecayPerSec, 1); // ≈0.45/s
  });
});
