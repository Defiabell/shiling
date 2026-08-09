import { describe, expect, it } from "vitest";
import { createSim, DT, getPlayer } from "../src/sim.js";
import { moveCreature } from "../src/movement.js";
import { SPECIES } from "@shiling/content";
import type { Creature } from "../src/state.js";

const idle = { moveX: 0, moveZ: 0, sprint: false, interact: false, attack: false, carry: false };

function findLandNear(sim: ReturnType<typeof createSim>, x: number, z: number) {
  // 把玩家硬放到指定点（测试用）
  const p = getPlayer(sim.state);
  p.pos.x = x; p.pos.z = z; p.pos.y = sim.terrain.heightAt(x, z);
  return p;
}

describe("movePlayer", () => {
  it("moves at walk speed and snaps to ground", () => {
    const sim = createSim(3);
    const p = getPlayer(sim.state);
    const start = { ...p.pos };
    sim.step({ ...idle, moveX: 1, moveZ: 0 });
    const moved = Math.hypot(p.pos.x - start.x, p.pos.z - start.z);
    expect(moved).toBeCloseTo(SPECIES.youshou!.walkSpeed * DT, 3);
    expect(p.pos.y).toBeCloseTo(sim.terrain.heightAt(p.pos.x, p.pos.z), 6);
  });
  it("sprint is faster and drains fatigue", () => {
    const sim = createSim(3);
    const p = getPlayer(sim.state);
    const f0 = p.needs.fatigue;
    const start = { ...p.pos };
    sim.step({ ...idle, moveX: 0, moveZ: 1, sprint: true });
    const moved = Math.hypot(p.pos.x - start.x, p.pos.z - start.z);
    expect(moved).toBeGreaterThan(SPECIES.youshou!.walkSpeed * DT * 1.5);
    expect(p.needs.fatigue).toBeLessThan(f0);
  });
  it("switches to swim in water", () => {
    const sim = createSim(3);
    // 找一个水点，把玩家放到旁边一步之遥再走进去
    let wx = 0, wz = 0, found = false;
    for (let x = -110; x <= 110 && !found; x += 3)
      for (let z = -110; z <= 110 && !found; z += 3)
        if (sim.terrain.isWater(x, z)) { wx = x; wz = z; found = true; }
    expect(found).toBe(true);
    const p = findLandNear(sim, wx, wz);
    sim.step(idle);
    expect(p.locomotion).toBe("swim");
    expect(p.pos.y).toBeCloseTo(sim.terrain.waterLevel, 6);
  });
  it("stays inside world bounds", () => {
    const sim = createSim(3);
    const p = getPlayer(sim.state);
    for (let i = 0; i < 20 * 120; i++) sim.step({ ...idle, moveX: 1, moveZ: 0 });
    expect(Math.abs(p.pos.x)).toBeLessThanOrEqual(sim.terrain.size / 2);
  });
});

describe("moveCreature shore block (non-swimmer)", () => {
  it("blocked at shore falls back to idle instead of staying stuck in moving", () => {
    const sim = createSim(3);
    const def = SPECIES.lingshu!;
    expect(def.canSwim).toBe(false);
    const step = def.walkSpeed * DT; // 一步的位移量，用作扫描分辨率上限，保证跨过的岸线必然在一步之内
    const half = sim.terrain.size / 2;

    // 有界扫描：沿若干条 z 线，以 <=一步的分辨率扫 x 轴，找一对相邻采样点从陆地跨到水域，
    // 不依赖不确定终止条件的循环（避免像早期版本那样在贴地地图边缘无界搜索导致死循环）。
    let landX = 0, wz = 0, found = false;
    outer: for (let z = -half; z <= half && !found; z += 10) {
      let prevWater = sim.terrain.isWater(-half, z);
      for (let x = -half + step; x <= half && !found; x += step) {
        const nowWaterHere = sim.terrain.isWater(x, z);
        if (!prevWater && nowWaterHere) { landX = x - step; wz = z; found = true; break outer; }
        prevWater = nowWaterHere;
      }
    }
    expect(found).toBe(true);

    const startY = sim.terrain.heightAt(landX, wz);
    const c: Creature = {
      id: 999, species: "lingshu",
      pos: { x: landX, y: startY, z: wz },
      yaw: 0, hp: def.maxHp,
      needs: { hunger: 80, thirst: 80, fatigue: 100 },
      locomotion: "walk", activity: "moving", // 故意预设为 moving，验证挡水后会回落 idle
      aiState: "idle", targetId: null, attackCooldown: 0,
      feedingCarcassId: null, burrowId: null, satiatedTimer: 0,
      digProgress: 0, interactHeld: false,
      aiDirX: 0, aiDirZ: 1, aiTimer: 0,
      fleeTime: 0, fleeRecoverTime: 0,
      carryingCarcassId: null, carryHeld: false, nestProgress: 0,
    };

    moveCreature(c, 1, 0, false, sim.terrain); // 朝水点方向走一步，应被挡在岸边

    expect(c.activity).toBe("idle");
    expect(c.pos.x).toBeCloseTo(landX, 9);
    expect(c.pos.z).toBeCloseTo(wz, 9);
    expect(c.locomotion).toBe("walk");
    expect(c.pos.y).toBeCloseTo(startY, 9);
  });
});
