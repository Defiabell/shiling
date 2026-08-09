import { describe, expect, it } from "vitest";
import { TUNING, SPECIES } from "@shiling/content";
import { createSim, getPlayer } from "../src/sim.js";

const idle = { moveX: 0, moveZ: 0, sprint: false, interact: false, attack: false, carry: false };

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
    expect(sim.state.behaviorStats.kills).toBe(0);
    for (let h = 0; h < hits; h++) {
      shu.pos = { ...p.pos }; shu.pos.x += 1; // 苓鼠会逃，测试里钉回攻击范围
      sim.step({ ...idle, attack: true });
      for (let i = 0; i < TUNING.tickHz; i++) sim.step(idle); // 等冷却
    }
    expect(sim.state.carcasses.some((c) => c.species === "lingshu")).toBe(true);
    // M1 B1（behaviorStats.kills，consumed by B3 roll）：玩家亲手打死的一击计一次，
    // 不会因为后续追加的空转 tick（等冷却）重复计数。
    expect(sim.state.behaviorStats.kills).toBe(1);
  });
  // M1 B1：NPC 互杀（潭狩猎杀苓鼠）不计入玩家的 behaviorStats.kills——凶手必须是玩家。
  it("NPC kills (tanshou hunting lingshu) do not count toward player behaviorStats.kills", () => {
    const sim = createSim(21);
    const p = getPlayer(sim.state);
    p.pos.x = -900; p.pos.z = -900; // 玩家旁观，不参与
    const tanshou = sim.state.creatures.find((c) => c.species === "tanshou")!;
    const shu = sim.state.creatures.find((c) => c.species === "lingshu")!;
    tanshou.pos = { ...shu.pos }; // 拉近距离，加速相遇
    for (let i = 0; i < TUNING.tickHz * 30 && shu.activity !== "dead"; i++) {
      p.needs.hunger = 100; p.needs.thirst = 100; // 旁观者不死
      sim.step(idle);
    }
    // sanity：先确认这只苓鼠真的被潭狩咬死了（前置条件成立），否则下面的"kills 仍为 0"
    // 断言会是假阳性——两者根本没打起来也会通过。
    expect(shu.activity).toBe("dead");
    expect(sim.state.behaviorStats.kills).toBe(0);
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
    sim.step({ moveX: 1, moveZ: 0, sprint: false, interact: false, attack: false, carry: false });
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

// postfix-9 Part 0（controller ruling on postfix-8 的"储粮进食触达性"待跟进项）：
// 洞外"持续按住 E 吃 stash"整套路径已移除，替换成"人在自己家的洞里就自动吃"——不需要
// 任何按键。见 eating.ts 文件头"家巢自动进食"一节。这里直接摆 p.burrowId/locomotion
// 到 burrow 态（不必真的走完整套挖洞流程），因为该分支只认 p.burrowId ===
// state.homeNest.spotId 这一个条件，不查 terrain.digSpots。
describe("home nest auto-eat (postfix-9 Part 0)", () => {
  function isolate(sim: ReturnType<typeof createSim>) {
    sim.state.creatures = sim.state.creatures.filter((c) => c.species !== "tanshou");
  }
  function enterHomeBurrow(p: ReturnType<typeof getPlayer>, spotId: number): void {
    p.burrowId = spotId;
    p.locomotion = "burrow";
  }

  it("auto-eats from stash while resting inside the home nest burrow — no button needed", () => {
    const sim = createSim(41);
    isolate(sim);
    const p = getPlayer(sim.state);
    sim.state.homeNest = { spotId: 42, stash: 40 };
    enterHomeBurrow(p, 42);
    p.needs.hunger = 20;
    const secs = 3;
    for (let i = 0; i < TUNING.tickHz * secs; i++) sim.step(idle); // 全程不按任何键
    const eaten = TUNING.eatMeatPerSec * secs;
    expect(sim.state.homeNest!.stash).toBeCloseTo(40 - eaten, 0);
    expect(p.needs.hunger).toBeCloseTo(20 + eaten * TUNING.hungerPerMeat, 0);
  });

  it("auto-eat stops once stash is fully depleted (does not go negative)", () => {
    const sim = createSim(41);
    isolate(sim);
    const p = getPlayer(sim.state);
    sim.state.homeNest = { spotId: 42, stash: 2 }; // 2 肉，eatMeatPerSec*DT=0.2/tick，10 tick 吃完
    enterHomeBurrow(p, 42);
    p.needs.hunger = 20;
    for (let i = 0; i < TUNING.tickHz * 3; i++) sim.step(idle); // 3s，远超吃完 2 肉所需的 0.5s
    expect(sim.state.homeNest!.stash).toBeCloseTo(0, 5);
    // 吃完 2 肉后 stash=0，guard 不再满足——剩余时间只有自然衰减，hunger 会从吃完那一刻
    // 的峰值往下掉，最终仍明显高于起点（20），但不会无限制地继续攀升。
    expect(p.needs.hunger).toBeGreaterThan(20);
    expect(p.needs.hunger).toBeCloseTo(22.5, 0);
  });

  it("auto-eat stops once hunger reaches homeNestAutoEatHungerCap (does not fire at/above the threshold)", () => {
    const sim = createSim(41);
    isolate(sim);
    const p = getPlayer(sim.state);
    sim.state.homeNest = { spotId: 42, stash: 40 };
    enterHomeBurrow(p, 42);
    p.needs.hunger = TUNING.homeNestAutoEatHungerCap; // 恰好在阈值上，guard 用 `<` 严格判定
    sim.step(idle);
    expect(sim.state.homeNest!.stash).toBe(40); // 这一 tick 没有吃——guard 拦住了
  });

  it("auto-eat converges to a plateau near the hunger cap without unbounded stash consumption", () => {
    const sim = createSim(41);
    isolate(sim);
    const p = getPlayer(sim.state);
    sim.state.homeNest = { spotId: 42, stash: 1000 };
    enterHomeBurrow(p, 42);
    p.needs.hunger = 50;
    for (let i = 0; i < TUNING.tickHz * 30; i++) sim.step(idle); // 30s，足够爬升+触顶震荡
    expect(p.needs.hunger).toBeGreaterThanOrEqual(TUNING.homeNestAutoEatHungerCap - 1);
    expect(p.needs.hunger).toBeLessThanOrEqual(TUNING.homeNestAutoEatHungerCap + 1);
    // 30s 若完全不设上限本可吃掉 120 stash；触顶后大部分 tick 都在"衰减→重新低于阈值→
    // 补一口"的窄幅震荡里，实际消耗远少于这个量。
    expect(sim.state.homeNest!.stash).toBeLessThan(1000);
    expect(sim.state.homeNest!.stash).toBeGreaterThan(900);
  });

  it("does not auto-eat while burrowed somewhere that isn't the home nest", () => {
    const sim = createSim(41);
    isolate(sim);
    const p = getPlayer(sim.state);
    sim.state.homeNest = { spotId: 42, stash: 40 };
    enterHomeBurrow(p, 99); // 另一个洞，不是家
    p.needs.hunger = 20;
    for (let i = 0; i < TUNING.tickHz; i++) sim.step(idle);
    expect(sim.state.homeNest!.stash).toBe(40); // 未被动用
  });

  it("does not auto-eat while burrowed if the player has no home nest yet", () => {
    const sim = createSim(41);
    isolate(sim);
    const p = getPlayer(sim.state);
    enterHomeBurrow(p, 7);
    p.needs.hunger = 20;
    for (let i = 0; i < TUNING.tickHz; i++) sim.step(idle);
    expect(p.needs.hunger).toBeLessThan(20); // 只有自然衰减，没有任何回复
  });

  it("a physical carcass at the burrow position has no effect — burrowed auto-eat only ever touches stash", () => {
    const sim = createSim(41);
    isolate(sim);
    const p = getPlayer(sim.state);
    sim.state.homeNest = { spotId: 42, stash: 40 };
    enterHomeBurrow(p, 42);
    p.needs.hunger = 20;
    sim.state.carcasses.push({ id: 999, species: "lingshu", pos: { ...p.pos }, meat: 30 });
    for (let i = 0; i < TUNING.tickHz; i++) sim.step(idle);
    expect(sim.state.carcasses.find((c) => c.id === 999)!.meat).toBe(30); // 尸体完全未被动用
    expect(sim.state.homeNest!.stash).toBeLessThan(40); // 存粮正常在被自动消耗
  });
});
