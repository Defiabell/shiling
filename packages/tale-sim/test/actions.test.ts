import { describe, expect, it } from "vitest";
import { availableActions, createLife, performAction } from "../src/index.js";
import {
  ENEMY_QIONG_QI,
  ENEMY_YE_ZHI,
  FIXTURE_CONTENT,
  FIXTURE_SEED_ID,
  ORGAN_GOU_CHI,
  UNCLAMPED_CHANCE,
  contentWithoutEvents,
  enterCombat,
  makeContent,
  withOrgans,
} from "./fixtures.js";

const NO_EVENTS = contentWithoutEvents();

describe("availableActions", () => {
  it("常态给狩猎/探索/休憩，不给蛰伏", () => {
    const life = createLife(1, FIXTURE_SEED_ID, FIXTURE_CONTENT);
    expect(availableActions(life, FIXTURE_CONTENT)).toEqual(["hunt", "explore", "rest"]);
  });

  it("任一型精气达阈值后解锁蛰伏", () => {
    const life = createLife(1, FIXTURE_SEED_ID, FIXTURE_CONTENT);
    const ripe = { ...life, essence: { ...life.essence, zu: 60 } };
    expect(availableActions(ripe, FIXTURE_CONTENT)).toContain("dormant");
    const almost = { ...life, essence: { ...life.essence, zu: 59 } };
    expect(availableActions(almost, FIXTURE_CONTENT)).not.toContain("dormant");
  });

  it("死亡或战斗中一律无可选行动", () => {
    const life = createLife(1, FIXTURE_SEED_ID, FIXTURE_CONTENT);
    expect(availableActions({ ...life, alive: false }, FIXTURE_CONTENT)).toEqual([]);
    expect(availableActions(enterCombat(life, ENEMY_YE_ZHI), FIXTURE_CONTENT)).toEqual([]);
  });
});

describe("performAction 前置校验", () => {
  const life = createLife(1, FIXTURE_SEED_ID, FIXTURE_CONTENT);

  it("已死亡时抛错", () => {
    expect(() => performAction({ ...life, alive: false }, "rest", FIXTURE_CONTENT)).toThrow(
      /已死亡/,
    );
  });

  it("战斗未结束时抛错", () => {
    expect(() =>
      performAction(enterCombat(life, ENEMY_YE_ZHI), "rest", FIXTURE_CONTENT),
    ).toThrow(/战斗未结束/);
  });

  it("行动当前不可用时抛错（精气不够却要蛰伏）", () => {
    expect(() => performAction(life, "dormant", FIXTURE_CONTENT)).toThrow(/不可执行行动/);
  });
});

describe("狩猎", () => {
  const alwaysHit = contentWithoutEvents({
    tuning: { ...UNCLAMPED_CHANCE, huntBase: 1, huntPerMeng: 0, huntHunterTagBonus: 0 },
  });
  const alwaysMiss = contentWithoutEvents({
    tuning: {
      ...UNCLAMPED_CHANCE,
      huntBase: 0,
      huntPerMeng: 0,
      huntHunterTagBonus: 0,
      huntFailCombatChance: 0,
    },
  });

  it("成功则回饱食并吞得猎物精气", () => {
    const life = createLife(3, FIXTURE_SEED_ID, alwaysHit);
    const { state, notices } = performAction(life, "hunt", alwaysHit);
    // 60 + 26（huntFoodGain）− 12（春季消耗）
    expect(state.hunger).toBe(74);
    expect(state.essence.zu).toBe(12);
    expect(state.essence.xue).toBe(4);
    expect(notices.join("")).toContain("猎得野雉");
  });

  it("失败则无所得（仅扣季消耗），不开战", () => {
    const life = createLife(3, FIXTURE_SEED_ID, alwaysMiss);
    const { state, notices } = performAction(life, "hunt", alwaysMiss);
    expect(state.hunger).toBe(48);
    expect(state.essence).toEqual({ zu: 0, lin: 0, xue: 0, meng: 0 });
    expect(state.combat).toBeNull();
    expect(notices.join("")).toContain("空腹而返");
  });

  it("失败且掷中遭遇概率则转入战斗，起手血量 = ti", () => {
    const ambush = contentWithoutEvents({
      tuning: {
        ...UNCLAMPED_CHANCE,
        huntBase: 0,
        huntPerMeng: 0,
        huntHunterTagBonus: 0,
        huntFailCombatChance: 1,
      },
    });
    const life = createLife(3, FIXTURE_SEED_ID, ambush);
    const { state, notices } = performAction(life, "hunt", ambush);
    expect(state.combat).not.toBeNull();
    expect(state.combat?.enemyId).toBe(ENEMY_YE_ZHI);
    expect(state.combat?.enemyHp).toBe(6);
    expect(state.combat?.playerHp).toBe(state.stats.ti);
    expect(state.combat?.round).toBe(0);
    expect(notices.join("")).toContain("盯上");
  });

  it("猎物表为空直接抛错（不伪装成「今天没猎到」）", () => {
    const barren = contentWithoutEvents({ tuning: { huntPreyIds: [] } });
    const life = createLife(3, FIXTURE_SEED_ID, barren);
    expect(() => performAction(life, "hunt", barren)).toThrow(/huntPreyIds 为空/);
  });

  it("猎物表引用了不存在的敌人也抛错", () => {
    const dangling = contentWithoutEvents({ tuning: { huntPreyIds: ["no-such-beast"] } });
    const life = createLife(3, FIXTURE_SEED_ID, dangling);
    expect(() => performAction(life, "hunt", dangling)).toThrow(/未知敌人 no-such-beast/);
  });

  it("hunter tag 的加成真的进了成功率", () => {
    // huntBase 0 ＋ tag 加成 1：没 tag 必失手，有 tag 必得手。
    const tagDecides = contentWithoutEvents({
      tuning: {
        ...UNCLAMPED_CHANCE,
        huntBase: 0,
        huntPerMeng: 0,
        huntHunterTagBonus: 1,
        huntFailCombatChance: 0,
      },
    });
    const bare = createLife(9, FIXTURE_SEED_ID, tagDecides);
    expect(performAction(bare, "hunt", tagDecides).state.essence.zu).toBe(0);
    const fanged = withOrgans(bare, ORGAN_GOU_CHI);
    expect(performAction(fanged, "hunt", tagDecides).state.essence.zu).toBe(12);
  });

  it("meng 也进成功率（huntPerMeng）", () => {
    const mengDecides = contentWithoutEvents({
      tuning: {
        ...UNCLAMPED_CHANCE,
        huntBase: 0,
        huntPerMeng: 0.05, // meng 20 → 1.0
        huntHunterTagBonus: 0,
        huntFailCombatChance: 0,
      },
    });
    const weak = createLife(11, FIXTURE_SEED_ID, mengDecides);
    expect(performAction(weak, "hunt", mengDecides).state.essence.zu).toBe(0);
    const strong = { ...weak, stats: { ...weak.stats, meng: 20 } };
    expect(performAction(strong, "hunt", mengDecides).state.essence.zu).toBe(12);
  });

  it("饱食不超上限", () => {
    const feast = contentWithoutEvents({
      tuning: { ...UNCLAMPED_CHANCE, huntBase: 1, huntFoodGain: 500 },
    });
    const life = createLife(3, FIXTURE_SEED_ID, feast);
    const { state } = performAction(life, "hunt", feast);
    expect(state.hunger).toBe(100 - 12);
  });
});

describe("探索与休憩", () => {
  it("探索只给旁白，本身不改数值", () => {
    const life = createLife(5, FIXTURE_SEED_ID, NO_EVENTS);
    const { state, notices } = performAction(life, "explore", NO_EVENTS);
    expect(notices.join("")).toContain("旧径");
    expect(state.hunger).toBe(60 - 12);
    expect(state.stats).toEqual(life.stats);
    expect(state.essence).toEqual(life.essence);
  });

  it("休憩回饱食", () => {
    const life = createLife(5, FIXTURE_SEED_ID, NO_EVENTS);
    const { state } = performAction(life, "rest", NO_EVENTS);
    expect(state.hunger).toBe(60 + 10 - 12);
  });

  it("休憩清掉 restHealFlags 里的伤病 flag", () => {
    const healer = contentWithoutEvents({ tuning: { restHealFlags: ["wounded"] } });
    const life = createLife(5, FIXTURE_SEED_ID, healer);
    const hurt = { ...life, flags: ["wounded", "met-baize"] };
    const { state, notices } = performAction(hurt, "rest", healer);
    expect(state.flags).toEqual(["met-baize"]);
    expect(notices.join("")).toContain("旧创渐合");
  });

  it("没有伤病 flag 时不发愈合旁白", () => {
    const healer = contentWithoutEvents({ tuning: { restHealFlags: ["wounded"] } });
    const life = createLife(5, FIXTURE_SEED_ID, healer);
    const { notices } = performAction(life, "rest", healer);
    expect(notices.join("")).not.toContain("旧创渐合");
  });

  it("猎物表有多个时会等权轮到不同猎物", () => {
    const twoPrey = contentWithoutEvents({
      tuning: { ...UNCLAMPED_CHANCE, huntBase: 1, huntPreyIds: [ENEMY_YE_ZHI, ENEMY_QIONG_QI] },
    });
    const seen = new Set<string>();
    for (let seed = 0; seed < 40; seed += 1) {
      const life = createLife(seed, FIXTURE_SEED_ID, twoPrey);
      const { state } = performAction(life, "hunt", twoPrey);
      seen.add(state.essence.meng > 0 ? "qiong-qi" : "ye-zhi");
    }
    expect(seen.size).toBe(2);
  });
});

describe("不可变约定", () => {
  it("performAction 不改动入参 state", () => {
    const rich = makeContent({ tuning: { eventChanceBase: 1 } });
    const life = createLife(42, FIXTURE_SEED_ID, rich);
    const snapshot = structuredClone(life);
    performAction(life, "hunt", rich);
    expect(life).toEqual(snapshot);
  });
});
