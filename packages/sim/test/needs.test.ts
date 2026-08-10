import { describe, expect, it } from "vitest";
import { QINGQIU_GRAYBOX, SPECIES, TUNING } from "@shiling/content";
import { createSim, getPlayer, spawnCreature } from "../src/sim.js";
import { createRng } from "../src/rng.js";
import { killCreature } from "../src/needs.js";

const idle = { moveX: 0, moveZ: 0, sprint: false, interact: false, attack: false, carry: false, dormant: false };

describe("tickNeeds", () => {
  it("hunger and thirst decay over time", () => {
    const sim = createSim(5);
    const p = getPlayer(sim.state);
    // W2（世界扩大到 480、tanshou 2→4）：这个纯衰减测试只关心衰减公式本身，与生物
    // 交互无关——挪去地图角落隔离，避免碰巧被路过的潭狩咬中（死亡后 tickCreatureNeeds
    // 对 dead 生物直接 return，衰减会提前停止，让这条断言产生假阴性）。
    p.pos.x = -900; p.pos.z = -900; // clamp 到世界边界角落
    const h0 = p.needs.hunger, t0 = p.needs.thirst;
    for (let i = 0; i < TUNING.tickHz * 10; i++) sim.step(idle); // 10 秒
    expect(p.needs.hunger).toBeCloseTo(h0 - TUNING.hungerDecayPerSec * 10, 1);
    expect(p.needs.thirst).toBeCloseTo(t0 - TUNING.thirstDecayPerSec * 10, 1);
  });
  it("fatigue recovers when idle", () => {
    const sim = createSim(5);
    const p = getPlayer(sim.state);
    p.needs.fatigue = 40;
    for (let i = 0; i < TUNING.tickHz * 5; i++) sim.step(idle);
    expect(p.needs.fatigue).toBeGreaterThan(40);
  });
  it("starvation drains hp and kills", () => {
    const sim = createSim(5);
    const p = getPlayer(sim.state);
    p.needs.hunger = 0; p.needs.thirst = 0; p.hp = 3;
    for (let i = 0; i < TUNING.tickHz * 5; i++) sim.step(idle);
    expect(sim.state.playerDead).toBe(true);
  });
  it("drinking near water restores thirst", () => {
    const sim = createSim(5);
    const p = getPlayer(sim.state);
    // 找水点并把玩家放进去
    outer: for (let x = -110; x <= 110; x += 3)
      for (let z = -110; z <= 110; z += 3)
        if (sim.terrain.isWater(x, z)) { p.pos.x = x; p.pos.z = z; break outer; }
    p.needs.thirst = 20;
    for (let i = 0; i < TUNING.tickHz * 2; i++) sim.step({ ...idle, interact: true });
    expect(p.needs.thirst).toBeGreaterThan(20 + TUNING.drinkPerSec * 1.5);
  });

  // 回归测试（键位拆分 W2 新语义，见 eating.ts/needs.ts 顶部注释）：撕咬(左键=attack)与
  // 饮水/进食(E=interact)从同一个字段拆成两个独立字段后，饮水守卫只看 input.attack 是否
  // 按下，不再看"范围内是否存在攻击目标"。这里拆成两个测试覆盖新语义的两侧：
  it("holding attack (LMB) blocks drinking at the water's edge even while also holding E", () => {
    const sim = createSim(41);
    sim.state.creatures = sim.state.creatures.filter((c) => c.species !== "tanshou"); // 隔离潭狩干扰
    const p = getPlayer(sim.state);
    const shu = sim.state.creatures.find((c) => c.species === "lingshu")!;

    // 找水点并把玩家放进去（同上一个测试的手法）
    outer: for (let x = -110; x <= 110; x += 3)
      for (let z = -110; z <= 110; z += 3)
        if (sim.terrain.isWater(x, z)) { p.pos.x = x; p.pos.z = z; break outer; }

    p.needs.thirst = 50;
    const t0 = p.needs.thirst;

    // 持续 hold 左键(attack)+E(interact) 1 秒；每 tick 前把苓鼠钉在玩家攻击范围内（否则苓鼠
    // 受伤/游走的 AI 会把它带离攻击范围，干扰本测试要验证的"目标始终在场"前提）。同时按
    // 住两个键是刻意构造的重叠场景：验证 needs.ts 的饮水守卫只看 input.attack，不管 E 是否
    // 也按住。
    for (let i = 0; i < TUNING.tickHz; i++) {
      shu.pos = { x: p.pos.x + 0.5, y: p.pos.y, z: p.pos.z };
      sim.step({ ...idle, interact: true, attack: true });
    }

    expect(shu.activity).not.toBe("dead"); // 冷却 1s 内最多命中一次，25 HP 苓鼠应仍存活
    // 举着左键：口渴只受衰减影响，全程不应有一次饮水回复叠加进来。
    expect(p.needs.thirst).toBeCloseTo(t0 - TUNING.thirstDecayPerSec * 1, 1);
  });

  it("holding E only (no attack) drinks at the water's edge even with prey in range — new key-split semantics", () => {
    const sim = createSim(41);
    sim.state.creatures = sim.state.creatures.filter((c) => c.species !== "tanshou");
    const p = getPlayer(sim.state);
    const shu = sim.state.creatures.find((c) => c.species === "lingshu")!;

    outer: for (let x = -110; x <= 110; x += 3)
      for (let z = -110; z <= 110; z += 3)
        if (sim.terrain.isWater(x, z)) { p.pos.x = x; p.pos.z = z; break outer; }

    p.needs.thirst = 50;
    const t0 = p.needs.thirst;

    // 猎物仍然摆在攻击范围内，但这次全程只按 E（attack 恒为 false，来自 idle）——键位拆分
    // 前的旧语义会让"范围内有攻击目标"挡住饮水；拆分后不再挡，用户意图已经由按键本身
    // 明确表达（只按 E 就是想喝水，不是想打架）。
    for (let i = 0; i < TUNING.tickHz; i++) {
      shu.pos = { x: p.pos.x + 0.5, y: p.pos.y, z: p.pos.z };
      sim.step({ ...idle, interact: true });
    }

    expect(p.needs.thirst).toBeGreaterThan(t0); // 饮水生效
  });

  // M15 P3（山海经地形与地标——灵泉滋养）：站在灵泉里饮水应叠加加成（drinkPerSec×
  // springDrinkMult + hp regen，封顶 maxHp）；离所有灵泉都足够远的普通水域饮水则
  // 只有基础速率、无 hp regen。两个测试都先过滤掉潭狩——避免罕见的"1 秒内恰好被咬中"
  // 干扰 hp 的精确断言（同 needs.test.ts 上面"holding attack"两个测试同一惯例）。
  it("spirit spring bonus: drink rate ×springDrinkMult + hp regen while drinking inside springRadius", () => {
    const sim = createSim(5);
    sim.state.creatures = sim.state.creatures.filter((c) => c.species !== "tanshou");
    const p = getPlayer(sim.state);
    const spring = sim.terrain.springs[0]!;
    p.pos.x = spring.pos.x;
    p.pos.z = spring.pos.z;
    p.needs.thirst = 20;
    p.hp = 10;
    const maxHp = SPECIES.youshou!.maxHp;
    for (let i = 0; i < TUNING.tickHz; i++) sim.step({ ...idle, interact: true }); // 1s
    expect(p.needs.thirst).toBeCloseTo(20 + TUNING.drinkPerSec * TUNING.springDrinkMult, 0);
    expect(p.hp).toBeCloseTo(Math.min(maxHp, 10 + TUNING.springHpPerSec), 1);
  });

  it("no spring bonus while drinking away from every spring", () => {
    const sim = createSim(5);
    sim.state.creatures = sim.state.creatures.filter((c) => c.species !== "tanshou");
    const p = getPlayer(sim.state);
    outer: for (let x = -220; x <= 220; x += 4) {
      for (let z = -220; z <= 220; z += 4) {
        if (!sim.terrain.isWater(x, z)) continue;
        const farFromAllSprings = sim.terrain.springs.every(
          (s) => Math.hypot(x - s.pos.x, z - s.pos.z) > TUNING.springRadius + 1,
        );
        if (farFromAllSprings) {
          p.pos.x = x;
          p.pos.z = z;
          break outer;
        }
      }
    }
    p.needs.thirst = 20;
    p.hp = 10;
    for (let i = 0; i < TUNING.tickHz; i++) sim.step({ ...idle, interact: true }); // 1s
    expect(p.needs.thirst).toBeCloseTo(20 + TUNING.drinkPerSec, 0); // 仅基础速率，无灵泉加成
    expect(p.hp).toBe(10); // 无 hp regen
  });
});

// Task 4 的延迟回调：现在 killCreature 已存在，锁定 id 单调不回收的保证
// （state.nextId 从不因生物/尸体移除而复用，见 state.ts 的 nextId 注释）。
describe("id uniqueness after creature removal", () => {
  it("spawnCreature does not reuse an id freed by killCreature", () => {
    const sim = createSim(5);
    const npc = sim.state.creatures.find((c) => c.id !== sim.state.playerId)!;
    const deadId = npc.id;
    killCreature(sim.state, npc);
    expect(sim.state.creatures.some((c) => c.id === deadId)).toBe(false);
    expect(sim.state.carcasses.some((c) => c.id === deadId)).toBe(true);

    const existingIds = new Set([
      ...sim.state.creatures.map((c) => c.id),
      ...sim.state.carcasses.map((c) => c.id),
    ]);
    const rng = createRng(5);
    const spawned = spawnCreature(sim.state, rng, sim.terrain, QINGQIU_GRAYBOX, "lingshu");
    expect(existingIds.has(spawned.id)).toBe(false);
  });
});
