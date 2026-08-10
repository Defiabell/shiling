import { describe, expect, it } from "vitest";
import { TUNING } from "@shiling/content";
import { createSim, getPlayer, DT } from "../src/sim.js";
import { dist2d } from "../src/vec.js";
import { nearWater } from "../src/needs.js";

const idle = { moveX: 0, moveZ: 0, sprint: false, interact: false, attack: false, carry: false, dormant: false };

/**
 * 扫描出一个真正"开阔地"的陆地点：不在水域、离任何 dig spot 都超过 interactRange
 * 一截（+3m 安全余量）、且不会被 `nearWater` 判成"在水边"（M15 P3：地形改动新增了
 * 灵泉+险峰山地区，`isWater(x,z)` 本身为 false 不再足够——见 digging.ts 的 pit-dig
 * 分支，它与 needs.ts 的饮水判据抢的是同一份 `nearWater` 几何，直接复用生产代码里
 * 那份实现而不是自己重新估一个安全边距，才是真正对齐"这个点会不会被判成水边"的
 * 权威判据，不依赖"land margin 应该留多宽"这种容易随地形改动漂移的估算）。
 * `avoid`：已经用过的点列表，再扫描时顺便跳开（供"连续挖 4 个坑"的测试拿到 4 个
 * 互相隔开、都各自安全的坐标，而不是重复返回同一个点）。
 */
function findOpenGround(
  sim: ReturnType<typeof createSim>,
  avoid: { x: number; z: number }[] = [],
): { x: number; y: number; z: number } {
  const half = sim.terrain.size / 2;
  for (let x = -half + 5; x <= half - 5; x += 5) {
    for (let z = -half + 5; z <= half - 5; z += 5) {
      if (sim.terrain.isWater(x, z)) continue;
      const h = sim.terrain.heightAt(x, z);
      if (h <= sim.terrain.waterLevel + 1) continue; // 留够余量，避免贴着水线
      if (nearWater({ pos: { x, y: h, z } }, sim.terrain)) continue;
      if (sim.terrain.digSpots.some((s) => dist2d({ x, y: 0, z }, s.pos) <= TUNING.interactRange + 3)) continue;
      if (avoid.some((a) => dist2d({ x, y: 0, z }, { x: a.x, y: 0, z: a.z }) <= TUNING.interactRange + 1)) continue;
      return { x, y: h, z };
    }
  }
  throw new Error("findOpenGround: no safe open-ground point found; check world params/dig spot density");
}

describe("pit trap digging (M15 P1 反制包)", () => {
  it("holding E on open ground (no dig spot/water/carcass nearby) digs a pit after pitDigSec, then releasing E stays idle without starting a second one", () => {
    const sim = createSim(11);
    const p = getPlayer(sim.state);
    p.pos = { ...findOpenGround(sim) };
    const ticksNeeded = Math.ceil(TUNING.pitDigSec * TUNING.tickHz);
    for (let i = 0; i < ticksNeeded - 2; i++) sim.step({ ...idle, interact: true });
    expect(sim.state.pits.length).toBe(0);
    expect(p.activity).toBe("digging");
    // ±2 tick 窗口（同 digging.test.ts 顶部既有测试的做法）：pitDigProgress 是逐 tick
    // 浮点累加（+=DT），累加误差可能让完成的那一 tick 早/晚一格，不断言精确的那一个 tick。
    for (let i = 0; i < 4; i++) sim.step({ ...idle, interact: true });
    expect(sim.state.pits.length).toBe(1);
    expect(sim.state.pits[0]!.armed).toBe(true);
    expect(dist2d(p.pos, sim.state.pits[0]!.pos)).toBeLessThan(0.01);
    sim.step(idle); // 松开 E：不再继续挖第二个坑，落回 idle（不像挖点完成会转入洞——陷坑没有"洞"）
    expect(p.activity).toBe("idle");
    expect(sim.state.pits.length).toBe(1); // 仍只有一个，没有被松开这一下额外触发第二次
  });

  it("E near a dig spot digs the spot, not a pit — dig spot wins within its interactRange", () => {
    const sim = createSim(11);
    const p = getPlayer(sim.state);
    const spot = sim.terrain.digSpots[0]!;
    p.pos = { ...spot.pos };
    const ticksNeeded = Math.ceil(TUNING.digDurationSec * TUNING.tickHz);
    for (let i = 0; i < ticksNeeded + 2; i++) sim.step({ ...idle, interact: true });
    expect(spot.dug).toBe(true);
    expect(sim.state.pits.length).toBe(0); // 挖点赢了，从未进入陷坑 fallback 分支
  });

  it("open ground but a carcass is nearby: E goes to eating, not pit-digging (carcass outranks the fallback)", () => {
    const sim = createSim(11);
    const p = getPlayer(sim.state);
    const ground = findOpenGround(sim);
    p.pos = { ...ground };
    sim.state.carcasses.push({ id: 999, species: "lingshu", pos: { ...ground }, meat: 30 });
    const ticksNeeded = Math.ceil(TUNING.pitDigSec * TUNING.tickHz);
    for (let i = 0; i < ticksNeeded + 2; i++) sim.step({ ...idle, interact: true });
    expect(sim.state.pits.length).toBe(0);
    expect(p.activity).toBe("eating");
  });

  it("digging a pit is a net fatigue drain (2x fatigueWalkRecoverPerSec), unlike normal digging's idle-rate recovery", () => {
    const sim = createSim(11);
    const p = getPlayer(sim.state);
    p.pos = { ...findOpenGround(sim) };
    p.needs.fatigue = 50;
    sim.step({ ...idle, interact: true });
    // 净效果推导见 digging.ts 的 tickPitDig 头部注释：本函数先扣掉
    // "fatigueRecoverPerSec + pitDigFatigueDrainMult×fatigueWalkRecoverPerSec"，
    // tickNeeds 稍后再加回 fatigueRecoverPerSec（挖陷坑复用 activity="digging"，落在
    // tickNeeds 的空闲恢复分支）——两者相加，净值恰好是耗损
    // pitDigFatigueDrainMult×fatigueWalkRecoverPerSec。
    const expectedNet = -TUNING.pitDigFatigueDrainMult * TUNING.fatigueWalkRecoverPerSec * DT;
    expect(p.needs.fatigue).toBeCloseTo(50 + expectedNet, 6);
    expect(expectedNet).toBeLessThan(0); // 明确是净耗损，不是净恢复
  });

  it("movement cancels pit-digging progress (mirrors dig-spot digging's interrupt semantics)", () => {
    const sim = createSim(11);
    const p = getPlayer(sim.state);
    p.pos = { ...findOpenGround(sim) };
    sim.step({ ...idle, interact: true });
    expect(p.pitDigProgress).toBeGreaterThan(0);
    sim.step({ moveX: 1, moveZ: 0, sprint: false, interact: false, attack: false, carry: false, dormant: false });
    expect(p.pitDigProgress).toBe(0);
    expect(sim.state.pits.length).toBe(0);
  });

  it("max 3 pits: digging a 4th removes the oldest (FIFO)", () => {
    const sim = createSim(11);
    const p = getPlayer(sim.state);
    const ticksNeeded = Math.ceil(TUNING.pitDigSec * TUNING.tickHz);
    const spots: { x: number; y: number; z: number }[] = [];
    const dugIdsInOrder: number[] = [];
    for (let n = 0; n < 4; n++) {
      const ground = findOpenGround(sim, spots);
      spots.push(ground);
      p.pos = { ...ground };
      for (let i = 0; i < ticksNeeded + 2; i++) sim.step({ ...idle, interact: true });
      const newId = sim.state.pits.find((pit) => !dugIdsInOrder.includes(pit.id))!.id;
      dugIdsInOrder.push(newId);
    }
    expect(dugIdsInOrder.length).toBe(4);
    expect(sim.state.pits.length).toBe(TUNING.maxPits);
    expect(sim.state.pits.some((pit) => pit.id === dugIdsInOrder[0])).toBe(false); // 最旧的一个已被移除
    // 剩下的三个恰好是第 2/3/4 挖的那三个。
    const remainingIds = sim.state.pits.map((pit) => pit.id).sort();
    expect(remainingIds).toEqual([...dugIdsInOrder.slice(1)].sort());
  });

  it("tanshou snared by an armed pit: movement frozen for pitSnareSec, then resumes with aiState untouched", () => {
    const sim = createSim(31);
    const p = getPlayer(sim.state);
    const t = sim.state.creatures.find((c) => c.species === "tanshou")!;
    sim.state.creatures = sim.state.creatures.filter((c) => c.id === p.id || c.id === t.id); // 隔离，排除干扰
    p.pos.x = -900; p.pos.z = -900; // 玩家远离，不参与，也不会被这只潭狩发现
    t.aiState = "patrol";
    t.targetId = null;
    sim.state.pits.push({ id: 1, pos: { ...t.pos }, armed: true });

    sim.step(idle); // 潭狩就站在陷坑上：本 tick 内 tickAi 先跑一小步 doWander，
    // 随后 tickPitSnares（排在 tickAi 之后）判定仍在 pitTriggerRadius 内并触发。
    const N = Math.round(TUNING.pitSnareSec * TUNING.tickHz);
    expect(t.snaredTicks).toBe(N);
    expect(t.aiState).toBe("patrol"); // aiState 未被强改
    expect(sim.state.pits.length).toBe(0); // 触发即消耗

    const frozenPos = { x: t.pos.x, z: t.pos.z };
    for (let i = 0; i < N - 1; i++) {
      sim.step(idle);
      expect(t.pos.x).toBeCloseTo(frozenPos.x, 9);
      expect(t.pos.z).toBeCloseTo(frozenPos.z, 9);
    }
    expect(t.snaredTicks).toBe(1); // 还剩最后一个 tick 未消耗

    sim.step(idle); // 这一 tick 内 snaredTicks 递减到 0——同一 tick 内 moveCreature 的
    // 早退判据已经读到新值，位移在这一 tick 就恢复（不必等到下一 tick）。
    expect(t.snaredTicks).toBe(0);
    expect(t.aiState).toBe("patrol"); // 全程未被强改——脱身后从原状态（patrol/doWander）继续
    const moved = t.pos.x !== frozenPos.x || t.pos.z !== frozenPos.z;
    expect(moved).toBe(true);
  });

  it("player and prey standing on an armed pit do not trigger it — only tanshou can be snared", () => {
    const sim = createSim(11);
    const p = getPlayer(sim.state);
    const shu = sim.state.creatures.find((c) => c.species === "lingshu")!;
    const pitPos = { ...p.pos };
    sim.state.pits.push({ id: 1, pos: { ...pitPos }, armed: true });
    shu.pos = { ...pitPos }; // 猎物也踩在陷坑正中心

    sim.step(idle);

    expect(sim.state.pits.length).toBe(1); // 未被消耗
    expect(sim.state.pits[0]!.armed).toBe(true);
    expect(p.snaredTicks).toBe(0);
    expect(shu.snaredTicks).toBe(0);
  });

  it("ecology 8 seeds still healthy — pits never get created in a headless run with idle input, so tanshou can never be snared by them", () => {
    // 生态不变量本身由 ecology.test.ts 独立覆盖（headless run 用不到玩家输入，
    // state.pits 永远是空数组——本批新增的分支只可能由真实玩家按 E 触发）；这里只
    // 补一条最小的结构性断言：一局从未挖过陷坑的 sim，state.pits 恒为空，不会有任何
    // 潭狩被意外定身。
    const sim = createSim(2026);
    for (let i = 0; i < TUNING.tickHz * 30; i++) sim.step(idle);
    expect(sim.state.pits.length).toBe(0);
    for (const c of sim.state.creatures) expect(c.snaredTicks).toBe(0);
  });
});
