import { describe, expect, it } from "vitest";
import { TUNING } from "@shiling/content";
import { createSim, getPlayer } from "../src/sim.js";

const idle = { moveX: 0, moveZ: 0, sprint: false, interact: false, attack: false, carry: false, dormant: false };

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
    expect(sim.state.behaviorStats.digCount).toBe(0); // 未完成前不计数
    for (let i = 0; i < 4; i++) sim.step({ ...idle, interact: true });
    expect(spot.dug).toBe(true);
    expect(p.burrowId).toBe(spot.id);
    expect(p.locomotion).toBe("burrow");
    // M1 B1：挖点完成（spot.dug 翻转）那一 tick 计一次，多跑几个 tick 不会重复计数。
    expect(sim.state.behaviorStats.digCount).toBe(1);
  });
  it("movement cancels digging", () => {
    const sim = createSim(11);
    const { p, spot } = placeAtSpot(sim);
    sim.step({ ...idle, interact: true });
    sim.step({ moveX: 1, moveZ: 0, sprint: false, interact: false, attack: false, carry: false, dormant: false });
    expect(p.activity).not.toBe("digging");
    expect(spot.dug).toBe(false);
    expect(sim.state.behaviorStats.digCount).toBe(0); // 被打断，没有真正完成，不计数
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

// M1 B2：器官接入——装掘爪挖得快。
describe("organ modifier: digSpeedMult (装掘爪挖得快)", () => {
  /** 持续按住 interact 挖到 spot.dug 翻转为止，返回实际耗费的 tick 数（含安全上限防死循环）。 */
  function ticksToComplete(sim: ReturnType<typeof createSim>, spot: ReturnType<typeof placeAtSpot>["spot"]): number {
    const cap = Math.ceil(TUNING.digDurationSec * TUNING.tickHz) * 4; // 4x 安全余量
    for (let i = 0; i < cap; i++) {
      sim.step({ ...idle, interact: true });
      if (spot.dug) return i + 1;
    }
    throw new Error("dig never completed within safety cap");
  }

  it("juezhua at full temper measurably completes a dig spot faster than the unarmored baseline", () => {
    // ±2 tick 的窗口——digProgress 是逐 tick 浮点累加（+=DT*mult），累加误差可能让完成
    // 的那一 tick 早/晚一格（同 digging.test.ts 顶部那条既有测试的做法：只卡一个窗口，
    // 不断言精确的那一个 tick）。
    const nominalTicks = Math.ceil(TUNING.digDurationSec * TUNING.tickHz);

    const baseline = createSim(11);
    const { spot: baselineSpot } = placeAtSpot(baseline);
    const baselineTicks = ticksToComplete(baseline, baselineSpot);
    expect(baselineTicks).toBeGreaterThanOrEqual(nominalTicks - 2);
    expect(baselineTicks).toBeLessThanOrEqual(nominalTicks + 2);

    const sim = createSim(11);
    sim.state.organs.limbs = { organId: "juezhua", temper: 100 }; // 满淬炼 digSpeedMult 恰好 2
    const { p, spot } = placeAtSpot(sim);
    const buffedTicks = ticksToComplete(sim, spot);

    expect(spot.dug).toBe(true);
    expect(p.burrowId).toBe(spot.id);
    // digSpeedMult=2 应让有效时长恰好减半，同样留 ±2 tick 的离散化窗口。
    expect(buffedTicks).toBeGreaterThanOrEqual(nominalTicks / 2 - 2);
    expect(buffedTicks).toBeLessThanOrEqual(nominalTicks / 2 + 2);
    expect(buffedTicks).toBeLessThan(baselineTicks);
  });
});

// M1 postfix N1（叼运/筑巢/储粮）
describe("nest building", () => {
  /** 入洞（新按下沿）并断言真的进去了，返回 p/spot 供后续持续按住累积筑巢进度用。 */
  function enterOwnBurrow(sim: ReturnType<typeof createSim>) {
    const { p, spot } = placeAtSpot(sim);
    spot.dug = true;
    sim.step({ ...idle, interact: true });
    expect(p.burrowId).toBe(spot.id);
    return { p, spot };
  }

  it("holding E in a dug burrow for nestBuildSec builds a home nest without exiting", () => {
    const sim = createSim(11);
    const { p, spot } = enterOwnBurrow(sim);
    const ticksNeeded = Math.ceil(TUNING.nestBuildSec * TUNING.tickHz);
    for (let i = 0; i < ticksNeeded - 2; i++) sim.step({ ...idle, interact: true });
    expect(sim.state.homeNest).toBeNull();
    for (let i = 0; i < 4; i++) sim.step({ ...idle, interact: true });
    expect(sim.state.homeNest).toEqual({ spotId: spot.id, stash: 0 });
    expect(p.burrowId).toBe(spot.id); // 建成后仍留在洞里，没有被自动弹出/出洞
  });

  it("releasing E before nestBuildSec resets progress but does not exit the burrow (interruptible)", () => {
    const sim = createSim(11);
    const { p, spot } = enterOwnBurrow(sim);
    const halfTicks = Math.floor((TUNING.nestBuildSec / 2) * TUNING.tickHz);
    for (let i = 0; i < halfTicks; i++) sim.step({ ...idle, interact: true });
    sim.step(idle); // 松开：进度作废，但这次释放不是"新按下沿"，不会触发出洞
    expect(p.burrowId).toBe(spot.id);
    for (let i = 0; i < halfTicks; i++) sim.step({ ...idle, interact: true });
    expect(sim.state.homeNest).toBeNull(); // 打断过一次，累积进度不足以跨过 12s 门槛
  });

  it("building a new home nest converts the old stash into a dropped carcass at the old spot", () => {
    const sim = createSim(11);
    const p = getPlayer(sim.state);
    const oldSpot = sim.terrain.digSpots[0]!;
    const newSpot = sim.terrain.digSpots[1]!;
    oldSpot.dug = true;
    newSpot.dug = true;
    sim.state.homeNest = { spotId: oldSpot.id, stash: 50 };

    p.pos = { ...newSpot.pos };
    sim.step({ ...idle, interact: true }); // 入新洞
    expect(p.burrowId).toBe(newSpot.id);
    const ticksNeeded = Math.ceil(TUNING.nestBuildSec * TUNING.tickHz);
    for (let i = 0; i < ticksNeeded + 2; i++) sim.step({ ...idle, interact: true });

    expect(sim.state.homeNest).toEqual({ spotId: newSpot.id, stash: 0 });
    const dropped = sim.state.carcasses.find((c) => c.pos.x === oldSpot.pos.x && c.pos.z === oldSpot.pos.z);
    expect(dropped).toBeDefined();
    expect(dropped!.species).toBe("lingshu");
    expect(dropped!.meat).toBe(50);
  });

  it("rebuilding at the same (already-home) spot never re-accumulates or re-converts", () => {
    const sim = createSim(11);
    const { p, spot } = enterOwnBurrow(sim);
    sim.state.homeNest = { spotId: spot.id, stash: 30 };
    // postfix-9 Part 0：既然人在自己家的洞里会自动吃 stash（见 eating.ts），把 hunger 钉在
    // 100——decay 整场测试（~12.25s×0.35/s≈4.3）都掉不到 homeNestAutoEatHungerCap(95) 以下，
    // 自动进食全程不触发，stash 因此保持这条测试原本要验证的"未被清零/重建"语义不受干扰。
    p.needs.hunger = 100;
    const ticksNeeded = Math.ceil(TUNING.nestBuildSec * TUNING.tickHz);
    for (let i = 0; i < ticksNeeded + 5; i++) sim.step({ ...idle, interact: true });
    expect(sim.state.homeNest).toEqual({ spotId: spot.id, stash: 30 }); // 未被清零/重建
    expect(p.burrowId).toBe(spot.id); // 持续按住时只保留"出洞"语义，不会被误判成筑巢
  });

  it("cannot dig or build a nest while carrying a carcass (carry+burrow exclusion)", () => {
    const sim = createSim(11);
    const { p, spot } = placeAtSpot(sim);
    sim.state.carcasses.push({ id: 999, species: "lingshu", pos: { ...p.pos }, meat: 30 });
    sim.step({ ...idle, carry: true }); // 叼起
    expect(p.carryingCarcassId).toBe(999);
    const ticks = Math.ceil((TUNING.digDurationSec + 1) * TUNING.tickHz);
    for (let i = 0; i < ticks; i++) sim.step({ ...idle, interact: true });
    expect(spot.dug).toBe(false);
    expect(p.burrowId).toBeNull();
  });
});
