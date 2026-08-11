import { describe, expect, it } from "vitest";
import { createLife, performAction, type TaleState } from "../src/index.js";
import {
  ENEMY_YE_ZHI,
  EVENT_SPROUT,
  FIXTURE_SEED_ID,
  UNCLAMPED_CHANCE,
  contentWithoutEvents,
  makeContent,
} from "./fixtures.js";

/** 不扣饱食的 content：测季推进/记录时不想被饿死打断。 */
const FREE_SEASONS = contentWithoutEvents({
  tuning: { hungerPerSeason: 0, winterHungerExtra: 0 },
});

describe("回合结算顺序：季推进", () => {
  it("季按 春→夏→秋→冬 走，跨冬进年", () => {
    let state = createLife(1, FIXTURE_SEED_ID, FREE_SEASONS);
    const seasons: number[] = [state.season];
    const years: number[] = [state.year];
    for (let i = 0; i < 4; i += 1) {
      state = performAction(state, "rest", FREE_SEASONS).state;
      seasons.push(state.season);
      years.push(state.year);
    }
    expect(seasons).toEqual([0, 1, 2, 3, 0]);
    expect(years).toEqual([0, 0, 0, 0, 1]);
  });

  it("非冬季只扣 hungerPerSeason", () => {
    const life = createLife(1, FIXTURE_SEED_ID, contentWithoutEvents());
    const { state } = performAction(life, "explore", contentWithoutEvents());
    expect(state.hunger).toBe(60 - 12);
  });

  it("冬季额外扣 winterHungerExtra（按行动**所在**的季结算）", () => {
    const content = contentWithoutEvents();
    const life = createLife(1, FIXTURE_SEED_ID, content);
    const winter: TaleState = { ...life, season: 3 };
    const { state } = performAction(winter, "explore", content);
    expect(state.hunger).toBe(60 - 12 - 6);
    // 结算完已跨到下一年的春天，但扣的是冬季的账
    expect(state.season).toBe(0);
    expect(state.year).toBe(1);
  });

  it("饱食不会被扣成负数", () => {
    const content = contentWithoutEvents({ tuning: { hungerPerSeason: 500 } });
    const life = createLife(1, FIXTURE_SEED_ID, content);
    const { state } = performAction(life, "explore", content);
    expect(state.hunger).toBe(0);
  });
});

describe("回合结算顺序：事件抽取", () => {
  it("eventChanceBase=1 必出事件，=0 必不出", () => {
    const always = makeContent({ tuning: { eventChanceBase: 1 } });
    const never = makeContent({ tuning: { eventChanceBase: 0 } });
    expect(
      performAction(createLife(7, FIXTURE_SEED_ID, always), "rest", always).pendingEvent?.id,
    ).toBe(EVENT_SPROUT);
    expect(
      performAction(createLife(7, FIXTURE_SEED_ID, never), "rest", never).pendingEvent,
    ).toBeNull();
  });

  it("探索行动把抽中概率乘上 exploreEventBonus", () => {
    const content = makeContent({ tuning: { eventChanceBase: 0.2, exploreEventBonus: 2 } });
    let restHits = 0;
    let exploreHits = 0;
    const runs = 600;
    for (let seed = 0; seed < runs; seed += 1) {
      const life = createLife(seed * 977 + 1, FIXTURE_SEED_ID, content);
      if (performAction(life, "rest", content).pendingEvent) restHits += 1;
      if (performAction(life, "explore", content).pendingEvent) exploreHits += 1;
    }
    expect(restHits / runs).toBeGreaterThan(0.14);
    expect(restHits / runs).toBeLessThan(0.27);
    expect(exploreHits / runs).toBeGreaterThan(0.32);
    expect(exploreHits / runs).toBeLessThan(0.48);
  });

  it("步骤 1 就开战的回合不再抽事件", () => {
    const ambush = makeContent({
      tuning: {
        ...UNCLAMPED_CHANCE,
        eventChanceBase: 1,
        huntBase: 0,
        huntPerMeng: 0,
        huntHunterTagBonus: 0,
        huntFailCombatChance: 1,
      },
    });
    const { state, pendingEvent } = performAction(
      createLife(13, FIXTURE_SEED_ID, ambush),
      "hunt",
      ambush,
    );
    expect(state.combat?.enemyId).toBe(ENEMY_YE_ZHI);
    expect(pendingEvent).toBeNull();
  });

  it("once 事件抽出即进 firedOnceIds，之后不再入池", () => {
    // 只留 once 的丛中窥影，狩猎行动触发
    const content = makeContent({
      events: [makeContent().events.find((event) => event.trigger.once === true)!],
      tuning: { ...UNCLAMPED_CHANCE, eventChanceBase: 1, huntBase: 1 },
    });
    const life = createLife(21, FIXTURE_SEED_ID, content);
    const first = performAction(life, "hunt", content);
    expect(first.pendingEvent).not.toBeNull();
    expect(first.state.firedOnceIds).toEqual([first.pendingEvent!.id]);
    const second = performAction(first.state, "hunt", content);
    expect(second.pendingEvent).toBeNull();
  });
});

describe("回合结算顺序：records 与打戳", () => {
  it("本回合的记录追加在既有记录之后，既有记录不动", () => {
    const content = contentWithoutEvents({
      tuning: { hungerPerSeason: 0, winterHungerExtra: 0 },
    });
    const life = createLife(1, FIXTURE_SEED_ID, content);
    const ripe: TaleState = { ...life, essence: { ...life.essence, zu: 60 } };
    const { state } = performAction(ripe, "dormant", content);
    expect(state.records.slice(0, 1)).toEqual(life.records);
    expect(state.records).toHaveLength(2);
    expect(state.records[1]?.kind).toBe("molt");
  });

  it("行动产生的记录打的是**行动所在**的岁/季，不是推进后的", () => {
    const content = contentWithoutEvents({
      tuning: { hungerPerSeason: 0, winterHungerExtra: 0 },
    });
    const life = createLife(1, FIXTURE_SEED_ID, content);
    const winterRipe: TaleState = {
      ...life,
      season: 3,
      year: 4,
      essence: { ...life.essence, zu: 60 },
    };
    const { state } = performAction(winterRipe, "dormant", content);
    expect(state.records[1]?.year).toBe(4);
    expect(state.records[1]?.season).toBe(3);
    expect(state.year).toBe(5);
    expect(state.season).toBe(0);
  });

  it("死亡记录打的是推进后的岁/季，且恒为末条", () => {
    const content = contentWithoutEvents({ tuning: { hungerPerSeason: 100 } });
    const life = createLife(1, FIXTURE_SEED_ID, content);
    const starving: TaleState = { ...life, flags: ["sys:starving"], season: 3, year: 2 };
    const { state } = performAction(starving, "explore", content);
    const last = state.records[state.records.length - 1];
    expect(last?.kind).toBe("death");
    expect(last?.year).toBe(3);
    expect(last?.season).toBe(0);
  });

  it("rngState 每回合都推进", () => {
    const life = createLife(1, FIXTURE_SEED_ID, FREE_SEASONS);
    const next = performAction(life, "hunt", FREE_SEASONS).state;
    expect(next.rngState).not.toBe(life.rngState);
    expect(next.seed).toBe(life.seed);
  });
});
