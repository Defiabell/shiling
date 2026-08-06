import { describe, expect, it } from "vitest";
import { TUNING, SPECIES } from "@shiling/content";
import { createSim, getPlayer } from "../src/sim.js";

const idle = { moveX: 0, moveZ: 0, sprint: false, interact: false };

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
});
