import { describe, expect, it } from "vitest";
import { ORGANS, ORGAN_LIST, SPECIES, TUNING } from "@shiling/content";
import { createSim, DT, getPlayer } from "../src/sim.js";
import { getModifiers, tickTemper } from "../src/organs.js";

const idle = { moveX: 0, moveZ: 0, sprint: false, interact: false, attack: false, carry: false, dormant: false };

describe("ORGANS content data", () => {
  it("has exactly 12 rollable organs in ORGAN_LIST, excluding the innate shenzhong", () => {
    expect(ORGAN_LIST).toHaveLength(12);
    expect(ORGAN_LIST.every((o) => o.slot !== "innate")).toBe(true);
  });
  it("ORGANS includes shenzhong on the innate slot", () => {
    expect(ORGANS.shenzhong).toBeDefined();
    expect(ORGANS.shenzhong!.slot).toBe("innate");
    expect(ORGANS.shenzhong!.effects.walkSpeedMult).toBe(1.05);
  });
});

describe("shenzhong innate pre-equip", () => {
  it("spawns with the innate slot pre-equipped at temper 50, and no other slot", () => {
    const sim = createSim(5);
    expect(sim.state.organs.innate).toEqual({ organId: "shenzhong", temper: 50 });
    expect(sim.state.organs.jaw).toBeUndefined();
    expect(sim.state.organs.limbs).toBeUndefined();
    expect(sim.state.organs.back).toBeUndefined();
    expect(sim.state.organs.skin).toBeUndefined();
    expect(sim.state.organs.tail).toBeUndefined();
    expect(sim.state.organs.sense).toBeUndefined();
  });
});

describe("getModifiers (aggregation + temper scaling formula)", () => {
  it("returns library defaults when organs is empty", () => {
    const sim = createSim(1);
    sim.state.organs = {};
    expect(getModifiers(sim.state)).toEqual({
      walkSpeedMult: 1, swimSpeedMult: 1, sprintFatigueMult: 1,
      attackDamageAdd: 0, damageTakenMult: 1, digSpeedMult: 1,
      eatSpeedMult: 1, senseRadiusAdd: 0, preyNoticeMult: 1,
    });
  });

  it("scales a multiplicative effect at full temper (100) to exactly the table value", () => {
    const sim = createSim(1);
    sim.state.organs = { back: { organId: "linjia", temper: 100 } }; // damageTakenMult .7
    // scale = temperScaleBase + temperScaleSpan*1 = 1.0 → effective = 1+(0.7-1)*1 = 0.7
    expect(getModifiers(sim.state).damageTakenMult).toBeCloseTo(0.7, 9);
  });

  it("scales a multiplicative effect at zero temper down to the base fraction", () => {
    const sim = createSim(1);
    sim.state.organs = { back: { organId: "linjia", temper: 0 } };
    // scale = temperScaleBase = 0.6 → effective = 1+(0.7-1)*0.6 = 0.82
    expect(getModifiers(sim.state).damageTakenMult).toBeCloseTo(0.82, 9);
  });

  it("scales an additive effect with the same formula shape (v*scale, not 1+(v-1)*scale)", () => {
    const sim = createSim(1);
    sim.state.organs = { back: { organId: "jibei", temper: 50 } }; // senseRadiusAdd +2, damageTakenMult .85
    const mods = getModifiers(sim.state);
    const scale = TUNING.temperScaleBase + TUNING.temperScaleSpan * 0.5; // 0.8
    expect(mods.senseRadiusAdd).toBeCloseTo(2 * scale, 9);
    expect(mods.damageTakenMult).toBeCloseTo(1 + (0.85 - 1) * scale, 9);
  });

  it("combines two organs sharing a multiplicative key by multiplying their effective values", () => {
    const sim = createSim(1); // innate shenzhong (walkSpeedMult 1.05, temper 50) already equipped
    sim.state.organs.back = { organId: "linjia", temper: 100 }; // also has walkSpeedMult .95
    const mods = getModifiers(sim.state);
    const shenzhongEff = 1 + (1.05 - 1) * (TUNING.temperScaleBase + TUNING.temperScaleSpan * 0.5);
    const linjiaEff = 1 + (0.95 - 1) * 1.0;
    expect(mods.walkSpeedMult).toBeCloseTo(shenzhongEff * linjiaEff, 9);
  });

  it("combines two organs sharing an additive key by summing their effective values", () => {
    const sim = createSim(1);
    sim.state.organs.back = { organId: "jibei", temper: 100 }; // senseRadiusAdd +2 full
    sim.state.organs.sense = { organId: "yetong", temper: 100 }; // senseRadiusAdd +6 full
    expect(getModifiers(sim.state).senseRadiusAdd).toBeCloseTo(2 + 6, 9);
  });

  it("silently ignores an unknown organId instead of throwing", () => {
    const sim = createSim(1);
    sim.state.organs.jaw = { organId: "does-not-exist", temper: 100 };
    expect(() => getModifiers(sim.state)).not.toThrow();
    expect(getModifiers(sim.state).attackDamageAdd).toBe(0);
  });
});

describe("tickTemper (用进增长)", () => {
  function findWater(sim: ReturnType<typeof createSim>): { x: number; z: number } {
    for (let x = -110; x <= 110; x += 3) {
      for (let z = -110; z <= 110; z += 3) {
        if (sim.terrain.isWater(x, z)) return { x, z };
      }
    }
    throw new Error("no water found");
  }

  it("grows a swim-trigger organ while locomotion is swim", () => {
    const sim = createSim(3);
    sim.state.organs.skin = { organId: "youyupi", temper: 50 }; // swimSpeedMult only → "swim" trigger
    const { x, z } = findWater(sim);
    const p = getPlayer(sim.state);
    p.pos.x = x; p.pos.z = z; p.pos.y = sim.terrain.heightAt(x, z);
    sim.step(idle); // moveCreature's zero-input branch still syncs locomotion to "swim"
    expect(getPlayer(sim.state).locomotion).toBe("swim");
    expect(sim.state.organs.skin!.temper).toBeCloseTo(50 + TUNING.temperGainPerSecUse * DT, 9);
  });

  it("does not grow a swim-trigger organ while walking on land", () => {
    const sim = createSim(3);
    sim.state.organs.skin = { organId: "youyupi", temper: 50 };
    sim.step({ ...idle, moveX: 1 });
    expect(sim.state.organs.skin!.temper).toBe(50);
  });

  it("grows a sprint-trigger organ while sprinting, deduping its two sprint-mapped keys into one contribution", () => {
    const sim = createSim(3);
    sim.state.organs.limbs = { organId: "jizu", temper: 50 }; // walkSpeedMult + sprintFatigueMult, both map to "sprint"
    sim.step({ ...idle, moveZ: 1, sprint: true });
    // 若没有去重，两个字段各贡献一次会是 2×temperGainPerSecUse*DT——这里精确断言只有一份。
    expect(sim.state.organs.limbs!.temper).toBeCloseTo(50 + TUNING.temperGainPerSecUse * DT, 9);
  });

  it("also grows linjia (back-slot, has a walkSpeedMult key too) while sprinting even with zero hits taken", () => {
    const sim = createSim(3);
    sim.state.organs.back = { organId: "linjia", temper: 50 };
    sim.step({ ...idle, moveZ: 1, sprint: true });
    expect(sim.state.organs.back!.temper).toBeCloseTo(50 + TUNING.temperGainPerSecUse * DT, 9);
  });

  it("does not grow a sprint-trigger organ when sprint is held but the player isn't actually moving", () => {
    const sim = createSim(3);
    sim.state.organs.limbs = { organId: "jizu", temper: 50 };
    sim.step({ ...idle, sprint: true }); // no moveX/moveZ
    expect(sim.state.organs.limbs!.temper).toBe(50);
  });

  it("grows a dig-trigger organ by a fixed amount exactly when the dig spot completes", () => {
    const sim = createSim(11);
    sim.state.organs.limbs = { organId: "juezhua", temper: 50 }; // digSpeedMult + attackDamageAdd
    const p = getPlayer(sim.state);
    const spot = sim.terrain.digSpots[0]!;
    p.pos = { ...spot.pos };
    for (let i = 0; i < Math.ceil(TUNING.digDurationSec * TUNING.tickHz); i++) {
      sim.step({ ...idle, interact: true });
      if (spot.dug) break;
    }
    expect(spot.dug).toBe(true);
    expect(sim.state.behaviorStats.digCount).toBe(1);
    expect(sim.state.organs.limbs!.temper).toBeCloseTo(50 + TUNING.temperGainDigComplete, 6);
  });

  it("grows a kill-trigger organ by a fixed amount exactly when the player kills a creature", () => {
    const sim = createSim(41);
    sim.state.creatures = sim.state.creatures.filter((c) => c.species !== "tanshou");
    sim.state.organs.jaw = { organId: "liehe", temper: 50 }; // attackDamageAdd only → "kill" trigger
    const p = getPlayer(sim.state);
    const shu = sim.state.creatures.find((c) => c.species === "lingshu")!;
    const dmgPerHit = SPECIES.youshou!.attackDamage + getModifiers(sim.state).attackDamageAdd;
    const hits = Math.ceil(SPECIES.lingshu!.maxHp / dmgPerHit);
    for (let h = 0; h < hits; h++) {
      shu.pos = { ...p.pos }; shu.pos.x += 1;
      sim.step({ ...idle, attack: true });
      for (let i = 0; i < TUNING.tickHz; i++) sim.step(idle); // 等冷却
    }
    expect(sim.state.behaviorStats.kills).toBe(1);
    expect(sim.state.organs.jaw!.temper).toBeCloseTo(50 + TUNING.temperGainKill, 6);
  });

  it("grows a hit-trigger organ by a fixed amount, visible one tick after the hit lands (documented ordering lag)", () => {
    const sim = createSim(31);
    sim.state.organs.back = { organId: "linjia", temper: 50 }; // damageTakenMult only relevant here
    const p = getPlayer(sim.state);
    const t = sim.state.creatures.find((c) => c.species === "tanshou")!;
    sim.state.creatures = sim.state.creatures.filter((c) => c.id === p.id || c.id === t.id); // 隔离，排除其它潭狩/苓鼠干扰
    t.pos = { ...p.pos }; t.pos.x += SPECIES.tanshou!.attackRange - 0.1;
    t.attackCooldown = 0;

    sim.step(idle); // 本 tick tickAi 在 tickTemper 之后跑，命中要到下一 tick 才能被 diff 出来
    expect(sim.state.organs.back!.temper).toBe(50);
    expect(sim.state.hitsTaken).toBe(1);

    sim.step(idle); // 冷却未到（attackCooldownSec=1s），这一 tick 不会再挨一次打
    expect(sim.state.hitsTaken).toBe(1);
    expect(sim.state.organs.back!.temper).toBeCloseTo(50 + TUNING.temperGainHitTaken, 6);
  });

  it("sums a discrete hit bonus with its own passive trickle in the same tick (distinct trigger kinds are not deduped)", () => {
    const sim = createSim(31);
    sim.state.organs.back = { organId: "jibei", temper: 50 }; // damageTakenMult(hit) + senseRadiusAdd(passive)
    const p = getPlayer(sim.state);
    const t = sim.state.creatures.find((c) => c.species === "tanshou")!;
    sim.state.creatures = sim.state.creatures.filter((c) => c.id === p.id || c.id === t.id);
    t.pos = { ...p.pos }; t.pos.x += SPECIES.tanshou!.attackRange - 0.1;
    t.attackCooldown = 0;

    sim.step(idle); // tick 1：本 tick 只有 passive 生效，命中要下一 tick 才可见
    const afterTick1 = sim.state.organs.back!.temper;
    expect(afterTick1).toBeCloseTo(50 + TUNING.temperGainPassivePerSec * DT, 9);

    sim.step(idle); // tick 2：hit 生效（叠加在这一 tick 自己的 passive 之上）
    expect(sim.state.hitsTaken).toBe(1);
    const afterTick2 = sim.state.organs.back!.temper;
    expect(afterTick2).toBeCloseTo(afterTick1 + TUNING.temperGainHitTaken + TUNING.temperGainPassivePerSec * DT, 9);
  });

  it("grows an eat-trigger organ while actively eating a fresh carcass", () => {
    const sim = createSim(41);
    sim.state.creatures = sim.state.creatures.filter((c) => c.species !== "tanshou");
    sim.state.organs.jaw = { organId: "lve", temper: 50 }; // eatSpeedMult only → "eat" trigger
    const p = getPlayer(sim.state);
    sim.state.carcasses.push({ id: 999, species: "lingshu", pos: { ...p.pos }, meat: 1000 });
    sim.step({ ...idle, interact: true });
    expect(sim.state.organs.jaw!.temper).toBeCloseTo(50 + TUNING.temperGainPerSecUse * DT, 9);
    const afterOneTick = sim.state.organs.jaw!.temper;
    sim.step(idle); // 松开 interact，不再进食
    expect(sim.state.organs.jaw!.temper).toBeCloseTo(afterOneTick, 9); // 不再继续增长
  });

  it("does NOT grow an eat-trigger organ while auto-eating from home nest stash (mirrors essence's fresh-vs-stash distinction)", () => {
    const sim = createSim(41);
    sim.state.organs.jaw = { organId: "lve", temper: 50 };
    const p = getPlayer(sim.state);
    sim.state.homeNest = { spotId: 42, stash: 40 };
    p.burrowId = 42; p.locomotion = "burrow";
    p.needs.hunger = 20;
    for (let i = 0; i < TUNING.tickHz * 2; i++) sim.step(idle);
    expect(sim.state.homeNest!.stash).toBeLessThan(40); // sanity：自动进食确实在发生
    expect(sim.state.organs.jaw!.temper).toBe(50); // 但 temper 未受影响
  });

  it("grows a passive-trigger organ every tick regardless of what the player is doing", () => {
    const sim = createSim(3);
    sim.state.organs.sense = { organId: "yetong", temper: 50 };
    sim.step(idle);
    expect(sim.state.organs.sense!.temper).toBeCloseTo(50 + TUNING.temperGainPassivePerSec * DT, 9);
  });

  it("clamps temper at 100, never exceeding it under continued passive growth", () => {
    const sim = createSim(3);
    sim.state.organs.sense = { organId: "yetong", temper: 99.99 };
    for (let i = 0; i < 50; i++) sim.step(idle);
    expect(sim.state.organs.sense!.temper).toBe(100);
  });

  it("is a no-op for slots the player has not equipped anything in", () => {
    const sim = createSim(3);
    expect(() => tickTemper(sim.state, idle)).not.toThrow();
  });
});
