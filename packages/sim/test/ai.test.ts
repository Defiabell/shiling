import { describe, expect, it } from "vitest";
import { TUNING } from "@shiling/content";
import { createSim, getPlayer } from "../src/sim.js";
import { dist2d } from "../src/vec.js";

const idle = { moveX: 0, moveZ: 0, sprint: false, interact: false, attack: false, carry: false };

describe("lingshu ai", () => {
  it("flees when player is near", () => {
    const sim = createSim(21);
    const p = getPlayer(sim.state);
    const shu = sim.state.creatures.find((c) => c.species === "lingshu")!;
    p.pos = { ...shu.pos }; p.pos.x += 3; // 进入感知圈
    const d0 = dist2d(p.pos, shu.pos);
    for (let i = 0; i < TUNING.tickHz * 3; i++) sim.step(idle);
    expect(shu.aiState).toBe("flee");
    expect(dist2d(p.pos, shu.pos)).toBeGreaterThan(d0);
  });
  it("grazes when hungry and recovers hunger", () => {
    const sim = createSim(21);
    const p = getPlayer(sim.state);
    p.pos.x = -900; p.pos.z = -900; // 玩家挪出感知范围（clamp 到边界也足够远）
    const shu = sim.state.creatures.find((c) => c.species === "lingshu")!;
    shu.needs.hunger = 30;
    for (let i = 0; i < TUNING.tickHz * 8; i++) sim.step(idle);
    expect(shu.needs.hunger).toBeGreaterThan(30);
  });
  it("does not flee from burrowed player", () => {
    const sim = createSim(21);
    const p = getPlayer(sim.state);
    const shu = sim.state.creatures.find((c) => c.species === "lingshu")!;
    p.pos = { ...shu.pos }; p.pos.x += 3;
    p.burrowId = 1; p.locomotion = "burrow";
    sim.step(idle);
    expect(shu.aiState).not.toBe("flee");
  });

  // M0.5 postfix-3（狩猎不可行修复）：graze 分心——吃草时警觉性降低，威胁检测
  // 半径 ×grazeDistractionFactor（0.55）。senseRadius=10 时缩水到 5.5m，7m 落在
  // 5.5~10 之间，理应不触发 flee；拉近到 4m（低于缩水后的阈值）才应该惊动。
  it("graze distraction: eating shrinks the threat-sense radius so a mid-range player goes unnoticed", () => {
    const sim = createSim(21);
    sim.state.creatures = sim.state.creatures.filter((c) => c.species !== "tanshou"); // 隔离潭狩
    const p = getPlayer(sim.state);
    const shu = sim.state.creatures.find((c) => c.species === "lingshu")!;
    shu.aiState = "graze";
    shu.needs.hunger = 50; // 低于 90，饥饿状态机不会把它切回 wander
    p.pos = { ...shu.pos }; p.pos.x += 7; // 7m：介于 10×0.55=5.5 与 10 之间

    for (let i = 0; i < TUNING.tickHz * 2; i++) sim.step(idle);
    expect(shu.aiState).toBe("graze"); // 分心生效：满感知半径本该在 7m 触发 flee，缩水后不会

    p.pos.x = shu.pos.x + 4; // 拉近到 4m，低于缩水后的 5.5m 阈值
    sim.step(idle);
    expect(shu.aiState).toBe("flee"); // 足够近时分心也挡不住，仍会惊动
  });

  // M0.5 postfix-3：逃跑耐力——连续 flee 超过 fleeFatigueThresholdSec 后单 tick
  // 位移应显著小于疲态前（doFlee 按 fleeFatigueSpeedMult=0.65 缩放速度）。直接
  // 摆 fleeTime 隔离测 doFlee 的速度响应，不依赖真实追出 5 秒（省时、确定性更强，
  // 与 predator.test.ts 里直接摆 aiState/targetId 的做法同风格）。
  it("flee speed drops once fleeTime exceeds the fatigue threshold", () => {
    const sim = createSim(21);
    sim.state.creatures = sim.state.creatures.filter((c) => c.species !== "tanshou"); // 隔离潭狩
    const p = getPlayer(sim.state);
    const shu = sim.state.creatures.find((c) => c.species === "lingshu")!;
    p.pos = { ...shu.pos }; p.pos.x += 3; // 进入感知圈，驱动 flee

    shu.aiState = "flee";
    shu.fleeTime = 0;
    const beforeFresh = { ...shu.pos };
    sim.step(idle);
    const freshDist = dist2d(beforeFresh, shu.pos);

    shu.aiState = "flee"; // 保持 flee（此时玩家仍在感知圈内，实际上不设也会自然维持）
    shu.fleeTime = TUNING.fleeFatigueThresholdSec + 0.1; // 已连续逃跑超过阈值
    const beforeFatigued = { ...shu.pos };
    sim.step(idle);
    const fatiguedDist = dist2d(beforeFatigued, shu.pos);

    expect(fatiguedDist).toBeLessThan(freshDist * 0.8); // 显著更慢（理论值 ×0.65）
  });
});
