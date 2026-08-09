import { describe, expect, it } from "vitest";
import { TUNING } from "@shiling/content";
import { createSim, getPlayer, DT } from "../src/sim.js";
import { createRng } from "../src/rng.js";
import { computeRollWeights, isDormancyEligible, rollOrgan } from "../src/dormancy.js";

const idle = { moveX: 0, moveZ: 0, sprint: false, interact: false, attack: false, carry: false, dormant: false };

/** 隔离生态：只留玩家，避免其它生物的 AI/随机数消费干扰蛰伏相关的确定性断言。 */
function isolate(sim: ReturnType<typeof createSim>): void {
  sim.state.creatures = sim.state.creatures.filter((c) => c.species === "youshou");
}

const FULL_TICKS = Math.round(TUNING.dormancySec * TUNING.tickHz);

describe("trigger condition matrix (isDormancyEligible / V edge)", () => {
  it("not eligible when not burrowed at all", () => {
    const sim = createSim(1);
    sim.state.homeNest = { spotId: 5, stash: 50 };
    sim.state.essence.zu = 80;
    expect(isDormancyEligible(sim.state)).toBe(false);
    sim.step({ ...idle, dormant: true });
    expect(sim.state.dormancy).toBeNull();
  });

  it("not eligible when burrowed but there is no home nest yet", () => {
    const sim = createSim(1);
    const p = getPlayer(sim.state);
    p.burrowId = 5; // 挖开的洞，但还没筑巢
    sim.state.essence.zu = 80;
    expect(isDormancyEligible(sim.state)).toBe(false);
    sim.step({ ...idle, dormant: true });
    expect(sim.state.dormancy).toBeNull();
  });

  it("not eligible when burrowed in a different burrow than home", () => {
    const sim = createSim(1);
    const p = getPlayer(sim.state);
    sim.state.homeNest = { spotId: 5, stash: 50 };
    p.burrowId = 6; // 别的洞，不是家
    sim.state.essence.zu = 80;
    expect(isDormancyEligible(sim.state)).toBe(false);
    sim.step({ ...idle, dormant: true });
    expect(sim.state.dormancy).toBeNull();
  });

  it("not eligible when in own nest but no essence has reached the threshold", () => {
    const sim = createSim(1);
    const p = getPlayer(sim.state);
    sim.state.homeNest = { spotId: 5, stash: 50 };
    p.burrowId = 5;
    sim.state.essence.zu = TUNING.essenceThreshold - 1; // 差一点
    expect(isDormancyEligible(sim.state)).toBe(false);
    sim.step({ ...idle, dormant: true });
    expect(sim.state.dormancy).toBeNull();
  });

  it("not eligible when essence is ready but stash is below dormancyStashCost", () => {
    const sim = createSim(1);
    const p = getPlayer(sim.state);
    sim.state.homeNest = { spotId: 5, stash: TUNING.dormancyStashCost - 1 };
    p.burrowId = 5;
    sim.state.essence.zu = 80;
    expect(isDormancyEligible(sim.state)).toBe(false);
    sim.step({ ...idle, dormant: true });
    expect(sim.state.dormancy).toBeNull();
  });

  it("eligible and triggers exactly on the V rising edge when all four conditions hold", () => {
    const sim = createSim(1);
    const p = getPlayer(sim.state);
    sim.state.homeNest = { spotId: 5, stash: TUNING.dormancyStashCost };
    p.burrowId = 5;
    p.needs.hunger = 100; // 顶格，避免 eating.ts 的家巢自动进食在"没按 V 的那一步"就先啃掉一点 stash
    sim.state.essence.zu = TUNING.essenceThreshold;
    expect(isDormancyEligible(sim.state)).toBe(true);
    sim.step(idle); // 没按 V：不触发
    expect(sim.state.dormancy).toBeNull();
    sim.step({ ...idle, dormant: true }); // 边沿
    expect(sim.state.dormancy).toEqual({ ticksLeft: FULL_TICKS });
  });

  // Part 0（B3 controller ruling，B4 落地）：蛰伏前必须饮足——thirst 39 不触发、40 触发。
  it("not eligible when thirst is one below dormancyThirstMin (39)", () => {
    const sim = createSim(1);
    const p = getPlayer(sim.state);
    sim.state.homeNest = { spotId: 5, stash: TUNING.dormancyStashCost };
    p.burrowId = 5;
    p.needs.hunger = 100;
    p.needs.thirst = TUNING.dormancyThirstMin - 1; // 39
    sim.state.essence.zu = TUNING.essenceThreshold;
    expect(isDormancyEligible(sim.state)).toBe(false);
    sim.step({ ...idle, dormant: true });
    expect(sim.state.dormancy).toBeNull();
  });

  it("eligible right at dormancyThirstMin (40)", () => {
    const sim = createSim(1);
    const p = getPlayer(sim.state);
    sim.state.homeNest = { spotId: 5, stash: TUNING.dormancyStashCost };
    p.burrowId = 5;
    p.needs.hunger = 100;
    p.needs.thirst = TUNING.dormancyThirstMin; // 40，边界——`<` 严格判定，恰好等于阈值应放行
    sim.state.essence.zu = TUNING.essenceThreshold;
    expect(isDormancyEligible(sim.state)).toBe(true);
    sim.step({ ...idle, dormant: true });
    expect(sim.state.dormancy).not.toBeNull();
  });

  it("holding V through a completed cycle does not immediately start a second one; release+press does", () => {
    const sim = createSim(1);
    isolate(sim);
    const p = getPlayer(sim.state);
    sim.state.homeNest = { spotId: 5, stash: 100 };
    p.burrowId = 5;
    sim.state.essence.zu = 200; // cap——开一次奖后仍 >=threshold，纯粹测边沿检测本身
    sim.step({ ...idle, dormant: true }); // 触发第一轮
    for (let i = 0; i < FULL_TICKS; i++) sim.step({ ...idle, dormant: true }); // 全程持续按住，不松手
    // 已经开过奖（ticksLeft 归零），但真正的解锁（state.dormancy 清回 null）故意延后一
    // tick——见 dormancy.ts 头部关于"完成那一 tick 里 eating.ts 会不会重复扣 stash"的
    // 注释（code review 2026-08-10 抓到的 double-feed bug 的修复方式）。
    expect(sim.state.dormancy).toEqual({ ticksLeft: 0 });
    expect(sim.state.lastEvolution).not.toBeNull();
    expect(sim.state.essence.zu).toBe(140); // 200-60，仍然达标——但：
    sim.step({ ...idle, dormant: true }); // 仍按住：这一步只走"延后解锁"分支，不重新判边沿
    expect(sim.state.dormancy).toBeNull(); // 解锁完成
    sim.step({ ...idle, dormant: true }); // 仍是同一次按住，不是新边沿
    expect(sim.state.dormancy).toBeNull(); // 不会立刻自动开始第二轮
    sim.step({ ...idle, dormant: false }); // 松开
    sim.step({ ...idle, dormant: true }); // 重新按下——新的边沿
    expect(sim.state.dormancy).not.toBeNull(); // 第二轮正常触发
  });
});

describe("abort path (fuel runs out mid-sleep)", () => {
  it("aborts without rolling once stash is exhausted, keeping essence and organs untouched", () => {
    const sim = createSim(1);
    const p = getPlayer(sim.state);
    sim.state.homeNest = { spotId: 5, stash: 0.01 }; // 远不够撑完 45 秒——直接构造"已在蛰伏"绕开触发门槛，只测中断本身
    p.burrowId = 5;
    sim.state.essence.zu = 80;
    sim.state.dormancy = { ticksLeft: 10 };

    sim.step(idle); // 第一 tick：stash(0.01)>0，被喂养扣到 0
    expect(sim.state.dormancy).not.toBeNull();
    expect(sim.state.homeNest!.stash).toBe(0);

    sim.step(idle); // 第二 tick：顶部 stash<=0 判定为真 → 中断
    expect(sim.state.dormancy).toBeNull();
    expect(sim.state.lastEvolution).toBeNull();
    expect(sim.state.essence.zu).toBe(80); // 精气原样保留，未被扣（入场费只在真正开奖那一刻扣）
    expect(sim.state.organs.jaw).toBeUndefined();
    expect(sim.state.organs.limbs).toBeUndefined();
  });
});

describe("completion (full-length dormancy)", () => {
  it("completes after dormancySec, equips a rolled organ into an empty slot, and records lastEvolution", () => {
    const sim = createSim(41);
    isolate(sim);
    const p = getPlayer(sim.state);
    sim.state.homeNest = { spotId: 42, stash: 100 };
    p.burrowId = 42;
    p.locomotion = "burrow";
    sim.state.essence = { zu: 0, lin: 90, xue: 0, meng: 0 };

    sim.step({ ...idle, dormant: true });
    for (let i = 0; i < FULL_TICKS; i++) sim.step(idle);

    // 已经开过奖（ticksLeft 归零），但真正解锁（state.dormancy 清回 null）延后一 tick——
    // 见 dormancy.ts 头部注释：这是修复"完成那一 tick 里 eating.ts 会重复扣 stash"
    // 的 double-feed bug（code review 2026-08-10）的方式。这里刻意检查"刚开完奖那一刻"
    // 而不多走那额外一 tick，避免被解锁后紧接着的正常巢中自动进食（1x，非蛰伏期间的
    // 1.5x）污染下面对 stash 的精确断言。
    expect(sim.state.dormancy).toEqual({ ticksLeft: 0 });
    const evo = sim.state.lastEvolution;
    expect(evo).not.toBeNull();
    expect(evo!.replacedId).toBeNull(); // 该槽此前是空的（只有 innate 预装）
    expect(sim.state.organs[evo!.slot]?.organId).toBe(evo!.organId);
    const temper = sim.state.organs[evo!.slot]!.temper;
    expect(temper).toBeGreaterThanOrEqual(20);
    expect(temper).toBeLessThanOrEqual(50);
    expect(sim.state.essence.lin).toBe(90 - TUNING.essenceThreshold); // 主导精气(lin)被扣 60
    // 精确断言（而不是宽松的 toBeLessThan(100)）：900 tick 的蛰伏喂养消耗 + 完成扣费，两项
    // 都是可推导的精确值——code review 2026-08-10 指出宽松断言曾经掩盖过一次真实的
    // double-feed bug（同一 tick 被 eating.ts 的自动进食多扣了一份），这里改成精确核算，
    // 任何回归都会在这条断言上直接失败，不再需要靠数量级判断。
    const feedTotal = (TUNING.hungerDecayPerSec * TUNING.dormancyHungerDecayMult * DT * FULL_TICKS) / TUNING.hungerPerMeat;
    const expectedStash = 100 - feedTotal - TUNING.dormancyStashCost;
    expect(sim.state.homeNest!.stash).toBeCloseTo(expectedStash, 6);
    expect(evo!.tick).toBe(sim.state.tick);
  });

  it("does not double-feed on the completion tick even though eating.ts's own guard would otherwise fire (regression for the code-review-caught double-feed bug)", () => {
    // 专门复现 code review 2026-08-10 抓到的那个 bug：完成那一 tick 如果 state.dormancy
    // 立即清空，eating.ts 的家巢自动进食分支会在同一 tick 里对 stash 再吃一口。这里把
    // stash 卡得刚好只够撑完 45 秒的喂养 + 完成扣费，一分不多——如果 double-feed 复发，
    // 下面的 stash 断言会先于其它断言精确地失败（差值正好是 eatMeatPerSec*DT）。
    const sim = createSim(7);
    isolate(sim);
    const p = getPlayer(sim.state);
    const feedTotal = (TUNING.hungerDecayPerSec * TUNING.dormancyHungerDecayMult * DT * FULL_TICKS) / TUNING.hungerPerMeat;
    const stash = feedTotal + TUNING.dormancyStashCost; // 刚好够用，一点富余都没有
    sim.state.homeNest = { spotId: 9, stash };
    p.burrowId = 9;
    p.locomotion = "burrow";
    p.needs.hunger = 100; // 顶格：确保下面若真的 double-feed，一定是因为 bug 本身，不是因为
    // hunger 已经到 homeNestAutoEatHungerCap 而被 eating.ts 自己的守卫挡住（那样反而会
    // 制造一个假阴性，掩盖住这个回归）。
    sim.state.essence.xue = 80;

    sim.step({ ...idle, dormant: true });
    for (let i = 0; i < FULL_TICKS; i++) sim.step(idle);

    expect(sim.state.dormancy).toEqual({ ticksLeft: 0 }); // 已开奖，未解锁
    expect(sim.state.homeNest!.stash).toBeCloseTo(0, 6); // 精确耗尽，没有被多扣一份
    expect(sim.state.lastEvolution).not.toBeNull();
  });

  it("player input fed during ACTIVE dormancy has zero effect — movement/attack/carry/interact are true no-ops", () => {
    const sim = createSim(3);
    isolate(sim);
    const p = getPlayer(sim.state);
    sim.state.homeNest = { spotId: 12, stash: 100 };
    p.burrowId = 12;
    p.locomotion = "burrow";
    p.pos = { x: 5, y: 0, z: 5 };
    sim.state.essence.zu = 80;
    sim.state.carcasses.push({ id: 999, species: "lingshu", pos: { ...p.pos }, meat: 30 }); // 够近，若锁没生效会被吃掉

    sim.step({ ...idle, dormant: true }); // 触发
    expect(sim.state.dormancy).not.toBeNull();

    const posBefore = { ...p.pos };
    const hpBefore = p.hp;
    const carcassMeatBefore = sim.state.carcasses[0]!.meat;
    // 全键位拉满，模拟"睡着了但手指还按在键盘上"的极端输入——蛰伏中理应对这些全部免疫。
    sim.step({ moveX: 1, moveZ: 1, sprint: true, interact: true, attack: true, carry: true, dormant: true });

    expect(p.pos).toEqual(posBefore); // 没有移动
    expect(p.hp).toBe(hpBefore); // 没有触发任何伤害交互
    expect(p.carryingCarcassId).toBeNull(); // 没有叼起
    expect(sim.state.carcasses[0]!.meat).toBe(carcassMeatBefore); // 没有被吃掉
    expect(p.activity).toBe("idle"); // 未被 eating/digging 系统改写
  });

  it("records the previously-equipped organ id as replacedId when the rolled slot was already occupied", () => {
    const sim = createSim(41);
    const p = getPlayer(sim.state);
    sim.state.essence = { zu: 80, lin: 0, xue: 0, meng: 0 };
    // 预先把六个可替换槽全部占满——无论最终 roll 落到哪个槽，那个槽此前必然"已被占用"。
    const before: Record<string, string> = {
      jaw: "liehe", limbs: "jizu", back: "linjia", skin: "youyupi", tail: "qiwei", sense: "yetong",
    };
    for (const [slot, organId] of Object.entries(before)) {
      (sim.state.organs as Record<string, { organId: string; temper: number }>)[slot] = { organId, temper: 50 };
    }
    const rng = createRng(123);
    rollOrgan(sim.state, rng);
    const evo = sim.state.lastEvolution!;
    expect(evo).not.toBeNull();
    expect(evo.replacedId).toBe(before[evo.slot]);
    expect(sim.state.organs[evo.slot]!.organId).toBe(evo.organId);
    void p;
  });
});

describe("roll determinism (same seed, same organ)", () => {
  function runToCompletion(seed: number, essence: { zu: number; lin: number; xue: number; meng: number }) {
    const sim = createSim(seed);
    isolate(sim);
    const p = getPlayer(sim.state);
    sim.state.homeNest = { spotId: 42, stash: 100 };
    p.burrowId = 42;
    p.locomotion = "burrow";
    sim.state.essence = { ...essence };
    sim.step({ ...idle, dormant: true });
    for (let i = 0; i < FULL_TICKS; i++) sim.step(idle);
    return sim.state.lastEvolution;
  }

  it("two identical sims (same seed, same setup, same input sequence) roll the identical organ", () => {
    const essence = { zu: 0, lin: 90, xue: 0, meng: 0 };
    const a = runToCompletion(777, essence);
    const b = runToCompletion(777, essence);
    expect(a).toEqual(b);
  });

  it("different seeds can roll different organs — the rng draw genuinely participates in the outcome", () => {
    const essence = { zu: 30, lin: 30, xue: 60, meng: 30 }; // 多种精气都有份，权重不被单一亲和垂直碾压
    const results = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      results.add(runToCompletion(seed, essence)!.organId);
    }
    expect(results.size).toBeGreaterThan(1);
  });
});

describe("computeRollWeights (five-factor weight math)", () => {
  it("weight is exactly affinity·essence when no behavior bias applies and the slot is empty", () => {
    const sim = createSim(1);
    sim.state.essence = { zu: 0, lin: 0, xue: 0, meng: 100 };
    const weights = computeRollWeights(sim.state);
    // linjia: lin .7 meng .3 → 0.3*100=30；effects 含 walkSpeedMult→"sprint" 类，sprintSec=0→bias=1，不影响这条断言。
    expect(weights.linjia).toBeCloseTo(30, 9);
    // liehe: meng 1，effects=attackDamageAdd→"kill" 类，kills=0→bias=1。
    expect(weights.liehe).toBeCloseTo(100, 9);
    // 与 meng 无亲和的器官权重恒为 0。
    expect(weights.jizu).toBe(0);
    expect(weights.youyupi).toBe(0);
  });

  it("swim bias scales matching organs (youyupi/qiwei) but not an unrelated one (lve) sharing the same essence", () => {
    const sim = createSim(1);
    sim.state.essence = { zu: 0, lin: 100, xue: 0, meng: 0 };
    sim.state.behaviorStats.swimSec = 300; // bias = 1+300/300 = 2
    const weights = computeRollWeights(sim.state);
    expect(weights.youyupi).toBeCloseTo(100 * 2, 9); // lin 1, swimSpeedMult only
    expect(weights.qiwei).toBeCloseTo(100 * 2, 9); // lin 1, swimSpeedMult only
    expect(weights.lve).toBeCloseTo(50, 9); // lin .5, eatSpeedMult（无匹配类别，bias=1）
    expect(weights.linjia).toBeCloseTo(70, 9); // lin .7, walkSpeedMult→"sprint" 类，sprintSec=0→bias=1
  });

  it("occupied-slot penalty multiplies weight by rollOccupiedSlotPenalty, only for the occupied slot", () => {
    const sim = createSim(1);
    sim.state.essence = { zu: 0, lin: 100, xue: 0, meng: 0 };
    sim.state.behaviorStats.swimSec = 300;
    sim.state.organs.skin = { organId: "taiwenpi", temper: 50 }; // 占用 youyupi 所在的 skin 槽
    const weights = computeRollWeights(sim.state);
    expect(weights.youyupi).toBeCloseTo(100 * 2 * TUNING.rollOccupiedSlotPenalty, 9); // skin 槽被占，打折
    expect(weights.qiwei).toBeCloseTo(100 * 2, 9); // tail 槽未被占，不受影响
  });

  it("multi-key organs (juezhua: digSpeedMult+attackDamageAdd → dig+kill) multiply both matching bias categories", () => {
    const sim = createSim(1);
    sim.state.essence = { zu: 0, lin: 0, xue: 100, meng: 0 };
    sim.state.behaviorStats.digCount = 20; // dig bias = 1+20/20 = 2
    sim.state.behaviorStats.kills = 15; // kill bias = 1+15/15 = 2
    const weights = computeRollWeights(sim.state);
    expect(weights.juezhua).toBeCloseTo(100 * 1 * (2 * 2), 9); // xue 1 × dig(2) × kill(2)
  });

  it("same-category multi-key organs (jizu: walkSpeedMult+sprintFatigueMult, both map to 'sprint') apply the bias factor ONCE, not squared", () => {
    // 回归覆盖：behaviorBiasFor 内部用 Set<BiasKind> 去重（同一类别内的多个字段只算一次
    // ——镜像 organs.ts tickTemper 的去重惯例），但 juezhua 那条测试的两个字段分属两个
    // 不同类别（dig+kill），从未真正验证过"同一类别内两个字段不会被平方"这件事——
    // jizu 的 walkSpeedMult 和 sprintFatigueMult 都映射到同一个 "sprint" 类别，是这
    // 条去重逻辑真正会生效的候选（code review 2026-08-10 指出的覆盖缺口）。
    const sim = createSim(1);
    sim.state.essence = { zu: 100, lin: 0, xue: 0, meng: 0 };
    sim.state.behaviorStats.sprintSec = 300; // bias = 1+300/300 = 2
    const weights = computeRollWeights(sim.state);
    // 若没有去重，两个字段各贡献一次会算成 100×(2×2)=400；正确答案是只算一次 100×2=200。
    expect(weights.jizu).toBeCloseTo(100 * 2, 9);
  });

  it("zero essence sum yields all-zero weights", () => {
    const sim = createSim(1);
    sim.state.essence = { zu: 0, lin: 0, xue: 0, meng: 0 };
    const weights = computeRollWeights(sim.state);
    for (const w of Object.values(weights)) expect(w).toBe(0);
  });
});

describe("uniform fallback (zero weight sum)", () => {
  it("rollOrgan still equips something instead of throwing when all weights are zero", () => {
    const sim = createSim(1);
    sim.state.essence = { zu: 0, lin: 0, xue: 0, meng: 0 }; // 正常触发路径下不会发生，此处直接构造极端输入
    const rng = createRng(99);
    expect(() => rollOrgan(sim.state, rng)).not.toThrow();
    const evo = sim.state.lastEvolution!;
    expect(evo).not.toBeNull();
    expect(sim.state.organs[evo.slot]?.organId).toBe(evo.organId);
  });
});

describe("ecology unaffected by dormancy", () => {
  it("a player completing a full dormancy cycle mid-run does not disturb NPC population dynamics", () => {
    const sim = createSim(2026); // 与 ecology.test.ts 同一个 seed，复用同一条已验证稳定的生态基线
    const p = getPlayer(sim.state);
    sim.state.homeNest = { spotId: 999, stash: 100 };
    p.burrowId = 999;
    p.locomotion = "burrow";
    sim.state.essence.zu = 80;

    sim.step({ ...idle, dormant: true }); // 触发
    const totalTicks = TUNING.tickHz * 120; // 120 sim-秒，覆盖完整的 45 秒蛰伏 + 之后一段background 时间
    for (let i = 0; i < totalTicks; i++) sim.step(idle);

    expect(sim.state.lastEvolution).not.toBeNull(); // 蛰伏确实完整跑完一轮并开了奖
    for (const c of sim.state.creatures) {
      expect(Number.isFinite(c.pos.x)).toBe(true);
      expect(Number.isFinite(c.pos.y)).toBe(true);
      expect(Number.isFinite(c.pos.z)).toBe(true);
    }
    const lingshu = sim.state.creatures.filter((c) => c.species === "lingshu").length;
    expect(lingshu).toBeGreaterThan(0); // 苓鼠没有被灭绝
    expect(sim.state.creatures.some((c) => c.species === "tanshou")).toBe(true);
  });
});
