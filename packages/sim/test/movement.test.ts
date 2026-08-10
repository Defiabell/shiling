import { describe, expect, it } from "vitest";
import { createSim, DT, getPlayer } from "../src/sim.js";
import { moveCreature, isTerrainBlocked } from "../src/movement.js";
import { getModifiers } from "../src/organs.js";
import { SPECIES, TUNING } from "@shiling/content";
import type { Creature } from "../src/state.js";

const idle = { moveX: 0, moveZ: 0, sprint: false, interact: false, attack: false, carry: false, dormant: false };

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
    // M1 B2：玩家出生自带本命「神种」（walkSpeedMult 1.05，temper 50 起），移动速度不再
    // 是裸的 SPECIES.walkSpeed——预期值必须乘上 getModifiers 聚合后的 walkSpeedMult，
    // 而不是把这个乘数当成需要绕开的噪声（旧断言在这里机械更新，语义未被弱化：仍然是
    // "一步应该走多远"，只是走多远的公式现在包含器官加成）。
    const mods = getModifiers(sim.state);
    sim.step({ ...idle, moveX: 1, moveZ: 0 });
    const moved = Math.hypot(p.pos.x - start.x, p.pos.z - start.z);
    expect(moved).toBeCloseTo(SPECIES.youshou!.walkSpeed * mods.walkSpeedMult * DT, 3);
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

  // M1 B1（behaviorStats，consumed by B3 roll）
  it("accumulates behaviorStats.swimSec while locomotion is swim, even standing still", () => {
    const sim = createSim(3);
    let wx = 0, wz = 0, found = false;
    for (let x = -110; x <= 110 && !found; x += 3)
      for (let z = -110; z <= 110 && !found; z += 3)
        if (sim.terrain.isWater(x, z)) { wx = x; wz = z; found = true; }
    expect(found).toBe(true);
    findLandNear(sim, wx, wz);
    expect(sim.state.behaviorStats.swimSec).toBe(0);
    sim.step(idle); // 站进水里不动（moveCreature 的零输入分支也会同步 locomotion）
    expect(getPlayer(sim.state).locomotion).toBe("swim");
    expect(sim.state.behaviorStats.swimSec).toBeCloseTo(DT, 9);
    sim.step(idle);
    expect(sim.state.behaviorStats.swimSec).toBeCloseTo(DT * 2, 9);
  });
  it("does not accumulate swimSec while walking on land", () => {
    const sim = createSim(3);
    sim.step({ ...idle, moveX: 1, moveZ: 0 });
    sim.step({ ...idle, moveX: 1, moveZ: 0 });
    expect(sim.state.behaviorStats.swimSec).toBe(0);
  });
  it("accumulates behaviorStats.sprintSec only when sprint actually takes effect", () => {
    const sim = createSim(3);
    sim.step({ ...idle, moveZ: 1, sprint: true });
    expect(sim.state.behaviorStats.sprintSec).toBeCloseTo(DT, 9);
    sim.step({ ...idle, moveZ: 1, sprint: true });
    expect(sim.state.behaviorStats.sprintSec).toBeCloseTo(DT * 2, 9);
  });
  it("does not accumulate sprintSec when holding sprint while not moving", () => {
    const sim = createSim(3);
    sim.step({ ...idle, sprint: true }); // sprint 按住但 moveX/moveZ 均为 0
    expect(sim.state.behaviorStats.sprintSec).toBe(0);
  });
  it("does not accumulate sprintSec when fatigue is too low to actually sprint", () => {
    const sim = createSim(3);
    const p = getPlayer(sim.state);
    p.needs.fatigue = TUNING.minSprintFatigue; // 边界：`>` 严格判定，等于阈值时冲刺不生效
    sim.step({ ...idle, moveZ: 1, sprint: true });
    expect(sim.state.behaviorStats.sprintSec).toBe(0);
  });
  it("does not accumulate sprintSec while burrowed", () => {
    const sim = createSim(3);
    const p = getPlayer(sim.state);
    p.burrowId = 7; p.locomotion = "burrow";
    sim.step({ ...idle, moveZ: 1, sprint: true });
    expect(sim.state.behaviorStats.sprintSec).toBe(0);
  });
});

// M1 B2：器官接入——装疾足走得快。
describe("organ modifier: walkSpeedMult (装疾足走得快)", () => {
  it("walking with a full-temper jizu equipped is faster than the unarmored baseline", () => {
    const baseline = createSim(3);
    const start0 = { ...getPlayer(baseline.state).pos };
    baseline.step({ ...idle, moveX: 1, moveZ: 0 });
    const movedBaseline = Math.hypot(getPlayer(baseline.state).pos.x - start0.x, getPlayer(baseline.state).pos.z - start0.z);

    const sim = createSim(3);
    sim.state.organs.limbs = { organId: "jizu", temper: 100 }; // walkSpeedMult 满淬炼 1.15
    const p = getPlayer(sim.state);
    const start = { ...p.pos };
    const mods = getModifiers(sim.state);
    sim.step({ ...idle, moveX: 1, moveZ: 0 });
    const moved = Math.hypot(p.pos.x - start.x, p.pos.z - start.z);
    expect(moved).toBeCloseTo(SPECIES.youshou!.walkSpeed * mods.walkSpeedMult * DT, 3);
    expect(moved).toBeGreaterThan(movedBaseline);
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
      carryingCarcassId: null, carryHeld: false, nestProgress: 0, dormantHeld: false,
      hiddenTicks: 0,
      pitDigProgress: 0, snaredTicks: 0,
    };

    moveCreature(c, 1, 0, false, sim.terrain); // 朝水点方向走一步，应被挡在岸边

    expect(c.activity).toBe("idle");
    expect(c.pos.x).toBeCloseTo(landX, 9);
    expect(c.pos.z).toBeCloseTo(wz, 9);
    expect(c.locomotion).toBe("walk");
    expect(c.pos.y).toBeCloseTo(startY, 9);
  });
});

// M1 B4：水生锁定（SpeciesDef.aquatic=true，溪鱼 xiyu）——isTerrainBlocked 双向挡行的镜像半边。
describe("isTerrainBlocked (M1 B4 aquatic mirror)", () => {
  it("blocks an aquatic species stepping onto land, allows it in water; leaves non-aquatic species unaffected", () => {
    const sim = createSim(3);
    let landPt = { x: 0, z: 0 }, waterPt = { x: 0, z: 0 }, foundLand = false, foundWater = false;
    for (let x = -200; x <= 200 && !(foundLand && foundWater); x += 4) {
      for (let z = -200; z <= 200 && !(foundLand && foundWater); z += 4) {
        if (!foundLand && !sim.terrain.isWater(x, z)) { landPt = { x, z }; foundLand = true; }
        if (!foundWater && sim.terrain.isWater(x, z)) { waterPt = { x, z }; foundWater = true; }
      }
    }
    expect(foundLand && foundWater).toBe(true);

    const fishDef = SPECIES.xiyu!;
    expect(fishDef.aquatic).toBe(true);
    expect(isTerrainBlocked(fishDef, sim.terrain, landPt.x, landPt.z)).toBe(true); // 陆地是墙
    expect(isTerrainBlocked(fishDef, sim.terrain, waterPt.x, waterPt.z)).toBe(false); // 水域正常通行

    // 回归断言：既有的两类物种不受这条新分支影响。
    const landOnlyDef = SPECIES.lingshu!; // canSwim=false, aquatic=false
    expect(isTerrainBlocked(landOnlyDef, sim.terrain, waterPt.x, waterPt.z)).toBe(true); // 既有挡水行为不变
    expect(isTerrainBlocked(landOnlyDef, sim.terrain, landPt.x, landPt.z)).toBe(false);
    const amphibiousDef = SPECIES.tanshou!; // canSwim=true, aquatic=false：两边都不挡
    expect(isTerrainBlocked(amphibiousDef, sim.terrain, waterPt.x, waterPt.z)).toBe(false);
    expect(isTerrainBlocked(amphibiousDef, sim.terrain, landPt.x, landPt.z)).toBe(false);
  });
});

describe("moveCreature aquatic lock (fish can't beach, land creature unaffected)", () => {
  it("a water-locked creature (xiyu) attempting to swim onto land stays in water, falls back to idle", () => {
    const sim = createSim(3);
    const def = SPECIES.xiyu!;
    // 镜像上面 "moveCreature shore block (non-swimmer)" 的有界扫描，方向反过来找"水→陆"边界
    // （水点 landX-1步 处仍是水，landX 处已经是陆——沿 +x 方向游一步应正好撞墙）。
    const step = def.swimSpeed * DT;
    const half = sim.terrain.size / 2;
    let waterX = 0, wz = 0, found = false;
    outer: for (let z = -half; z <= half && !found; z += 10) {
      let prevWater = sim.terrain.isWater(-half, z);
      for (let x = -half + step; x <= half && !found; x += step) {
        const nowWaterHere = sim.terrain.isWater(x, z);
        if (prevWater && !nowWaterHere) { waterX = x - step; wz = z; found = true; break outer; }
        prevWater = nowWaterHere;
      }
    }
    expect(found).toBe(true);

    const c: Creature = {
      id: 998, species: "xiyu",
      pos: { x: waterX, y: sim.terrain.waterLevel, z: wz },
      yaw: 0, hp: def.maxHp,
      needs: { hunger: 80, thirst: 80, fatigue: 100 },
      locomotion: "swim", activity: "moving", // 故意预设为 moving，验证挡墙后会回落 idle
      aiState: "wander", targetId: null, attackCooldown: 0,
      feedingCarcassId: null, burrowId: null, satiatedTimer: 0,
      digProgress: 0, interactHeld: false,
      aiDirX: 1, aiDirZ: 0, aiTimer: 0,
      fleeTime: 0, fleeRecoverTime: 0,
      carryingCarcassId: null, carryHeld: false, nestProgress: 0, dormantHeld: false,
      hiddenTicks: 0,
      pitDigProgress: 0, snaredTicks: 0,
    };

    moveCreature(c, 1, 0, false, sim.terrain); // 朝陆地方向游一步，应被挡在水边

    expect(c.activity).toBe("idle");
    expect(c.pos.x).toBeCloseTo(waterX, 9);
    expect(c.pos.z).toBeCloseTo(wz, 9);
    expect(c.locomotion).toBe("swim"); // 仍然是"泡在水里"，不是"站上了岸"
    expect(c.pos.y).toBeCloseTo(sim.terrain.waterLevel, 9);
  });

  it("a non-aquatic amphibious creature (tanshou) is unaffected by the aquatic guard — free to swim onto land", () => {
    const sim = createSim(3);
    const def = SPECIES.tanshou!;
    expect(def.aquatic).toBe(false);
    let wx = 0, wz = 0, found = false;
    for (let x = -110; x <= 110 && !found; x += 3)
      for (let z = -110; z <= 110 && !found; z += 3)
        if (sim.terrain.isWater(x, z)) { wx = x; wz = z; found = true; }
    expect(found).toBe(true);

    const c: Creature = {
      id: 997, species: "tanshou",
      pos: { x: wx, y: sim.terrain.waterLevel, z: wz },
      yaw: 0, hp: def.maxHp,
      needs: { hunger: 80, thirst: 80, fatigue: 100 },
      locomotion: "swim", activity: "idle",
      aiState: "patrol", targetId: null, attackCooldown: 0,
      feedingCarcassId: null, burrowId: null, satiatedTimer: 0,
      digProgress: 0, interactHeld: false,
      aiDirX: 1, aiDirZ: 0, aiTimer: 0,
      fleeTime: 0, fleeRecoverTime: 0,
      carryingCarcassId: null, carryHeld: false, nestProgress: 0, dormantHeld: false,
      hiddenTicks: 0,
      pitDigProgress: 0, snaredTicks: 0,
    };
    moveCreature(c, 1, 0, false, sim.terrain); // 两栖物种：不该被新分支挡住，无论朝哪个方向都能移动
    expect(c.activity).toBe("moving");
  });
});
