import { describe, expect, it } from "vitest";
import { TUNING, SPECIES } from "@shiling/content";
import { createSim, getPlayer } from "../src/sim.js";
import { getModifiers } from "../src/organs.js";

const idle = { moveX: 0, moveZ: 0, sprint: false, interact: false, attack: false, carry: false, dormant: false };

describe("tanshou ai", () => {
  it("hunts and damages the player", () => {
    const sim = createSim(31);
    const p = getPlayer(sim.state);
    const t = sim.state.creatures.find((c) => c.species === "tanshou")!;
    t.pos = { ...p.pos }; t.pos.x += 5; // 进入感知圈
    const hp0 = p.hp;
    for (let i = 0; i < TUNING.tickHz * 6; i++) sim.step(idle);
    expect(p.hp).toBeLessThan(hp0);
  });
  it("kills lingshu and produces a carcass, then feeds", () => {
    const sim = createSim(31);
    const p = getPlayer(sim.state);
    p.pos.x = -900; p.pos.z = -900;
    const t = sim.state.creatures.find((c) => c.species === "tanshou")!;
    const shu = sim.state.creatures.find((c) => c.species === "lingshu")!;
    t.pos = { ...shu.pos }; t.pos.x += 2;
    let sawCarcass = false;
    for (let i = 0; i < TUNING.tickHz * 30; i++) {
      sim.step(idle);
      if (sim.state.carcasses.some((c) => c.species === "lingshu")) sawCarcass = true;
    }
    expect(sawCarcass).toBe(true);
    expect(t.aiState === "feed" || t.satiatedTimer > 0).toBe(true);
  });
  it("cannot see burrowed player", () => {
    const sim = createSim(31);
    const p = getPlayer(sim.state);
    const t = sim.state.creatures.find((c) => c.species === "tanshou")!;
    t.pos = { ...p.pos }; t.pos.x += 5;
    p.burrowId = 1; p.locomotion = "burrow";
    for (let i = 0; i < TUNING.tickHz * 3; i++) sim.step(idle);
    expect(p.hp).toBe(SPECIES.youshou!.maxHp);
  });
  it("drops an active hunt target and returns to patrol when the player burrows mid-hunt", () => {
    const sim = createSim(31);
    const p = getPlayer(sim.state);
    const t = sim.state.creatures.find((c) => c.species === "tanshou")!;
    // W2（世界扩大、种群密度调整后）：只留玩家和这一只潭狩，隔离掉其它苓鼠/潭狩——
    // 4 秒的观察窗口里，新世界更高的野生生物总数偶尔会有别的猎物游荡进这只潭狩的
    // senseRadius，导致它在玩家入洞后的下一 tick 又立刻抓到新目标重新进入 "hunt"，
    // 这跟本测试要验证的"目标入洞后必须放弃"是两回事，隔离掉避免假阳性。
    sim.state.creatures = sim.state.creatures.filter((c) => c.id === p.id || c.id === t.id);
    t.pos = { ...p.pos }; t.pos.x += 5; // 进入感知圈，先追一段，确认真的在猎杀
    for (let i = 0; i < TUNING.tickHz; i++) sim.step(idle);
    const hpAtBurrow = p.hp;
    expect(hpAtBurrow).toBeLessThan(SPECIES.youshou!.maxHp); // 前 1 秒确实已咬中过
    p.burrowId = 1; p.locomotion = "burrow"; // 追击途中入洞
    for (let i = 0; i < TUNING.tickHz * 3; i++) sim.step(idle);
    expect(p.hp).toBe(hpAtBurrow); // 入洞后不再掉血
    expect(t.aiState).toBe("patrol"); // 潭狩已放弃目标回到巡猎
  });
  it("two tanshou contesting the same low-hp lingshu in one tick do not double-kill or crash", () => {
    const sim = createSim(31);
    const p = getPlayer(sim.state);
    p.pos.x = -900; p.pos.z = -900; // 玩家挪远，不参与竞争
    const tanshous = sim.state.creatures.filter((c) => c.species === "tanshou");
    const t1 = tanshous[0]!;
    const t2 = tanshous[1]!;
    const shu = sim.state.creatures.find((c) => c.species === "lingshu")!;
    shu.hp = 1; // 一击必杀，制造两只潭狩同一 tick 锁定同一猎物的极端竞争场景
    t1.pos = { ...shu.pos };
    t2.pos = { ...shu.pos };
    t1.aiState = "hunt"; t1.targetId = shu.id; t1.attackCooldown = 0;
    t2.aiState = "hunt"; t2.targetId = shu.id; t2.attackCooldown = 0;

    expect(() => sim.step(idle)).not.toThrow();

    const lingshuCarcasses = sim.state.carcasses.filter((c) => c.species === "lingshu");
    expect(lingshuCarcasses.length).toBe(1); // 只产出一具尸体，没有重复 push

    const states = [t1.aiState, t2.aiState].sort();
    expect(states).toEqual(["feed", "patrol"]); // 得手的一方进食，另一方安全恢复回 patrol
  });

  // M1 B2：器官接入——装鳞甲挨咬掉血少。单 tick 精确断言，避免 temper 用进（挨打+3/tick）
  // 在多 tick 观察窗口里悄悄把 mult 拉高造成断言漂移——满淬炼(100)本身也已顶格不会再涨。
  it("organ modifier: damageTakenMult reduces the hit taken from tanshou when wearing full-temper linjia (装鳞甲挨咬掉血少)", () => {
    function setupOneHit(sim: ReturnType<typeof createSim>) {
      const p = getPlayer(sim.state);
      const t = sim.state.creatures.find((c) => c.species === "tanshou")!;
      sim.state.creatures = sim.state.creatures.filter((c) => c.id === p.id || c.id === t.id); // 隔离
      t.pos = { ...p.pos }; t.pos.x += SPECIES.tanshou!.attackRange - 0.1; // 进入攻击范围
      t.attackCooldown = 0; // 保证第一 tick 立即出手
      return p;
    }

    const baseline = createSim(31);
    const pBaseline = setupOneHit(baseline);
    const hp0Baseline = pBaseline.hp;
    baseline.step(idle);
    const lossBaseline = hp0Baseline - pBaseline.hp;
    expect(lossBaseline).toBeCloseTo(SPECIES.tanshou!.attackDamage, 6);

    const sim = createSim(31);
    sim.state.organs.back = { organId: "linjia", temper: 100 }; // 满淬炼 damageTakenMult 恰好 0.7
    const mods = getModifiers(sim.state);
    const p = setupOneHit(sim);
    const hp0 = p.hp;
    sim.step(idle);
    const loss = hp0 - p.hp;
    expect(loss).toBeCloseTo(SPECIES.tanshou!.attackDamage * mods.damageTakenMult, 6);
    expect(loss).toBeLessThan(lossBaseline);
  });
});
