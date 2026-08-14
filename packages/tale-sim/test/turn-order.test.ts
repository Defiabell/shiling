import { describe, expect, it } from "vitest";
import {
  createLife,
  performAction,
  resolveChoice,
  stalkAct,
  type TaleState,
  approachOf,
  clashOf,
} from "../src/index.js";
import {
  EVENT_SPROUT,
  FIXTURE_SEED_ID,
  ORGAN_WU_MU,
  UNCLAMPED_CHANCE,
  contentWithoutEvents,
  makeContent,
  withOrgans,
  NEAR,
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
    const { state } = performAction(life, "explore", contentWithoutEvents(), NEAR);
    expect(state.hunger).toBe(60 - 12);
  });

  it("冬季额外扣 winterHungerExtra（按行动**所在**的季结算）", () => {
    const content = contentWithoutEvents();
    const life = createLife(1, FIXTURE_SEED_ID, content);
    const winter: TaleState = { ...life, season: 3 };
    const { state } = performAction(winter, "explore", content, NEAR);
    expect(state.hunger).toBe(60 - 12 - 6);
    // 结算完已跨到下一年的春天，但扣的是冬季的账
    expect(state.season).toBe(0);
    expect(state.year).toBe(1);
  });

  it("饱食不会被扣成负数", () => {
    const content = contentWithoutEvents({ tuning: { hungerPerSeason: 500 } });
    const life = createLife(1, FIXTURE_SEED_ID, content);
    const { state } = performAction(life, "explore", content, NEAR);
    expect(state.hunger).toBe(0);
  });

  /*
   * M1-P1：追猎把一个回合拆成「起追」与「收束」两段，季推进（步骤 3）只在**收束**那一步
   * 跑一次。这条同时钉住两个方向的错：起追就推进（追一头猎物白耗一季），或者收束时漏了推进
   * （一世永远停在同一个春天，且饥饿再也扣不动 —— 这类 bug 在界面上表现为「游戏变简单了」）。
   */
  it("追猎的季推进只在收束那一步跑，且只跑一次", () => {
    const quiet = contentWithoutEvents();
    const life = createLife(13, FIXTURE_SEED_ID, quiet);
    const started = performAction(life, "hunt", quiet).state;
    expect(approachOf(started)).not.toBeNull();
    expect(started.season).toBe(life.season);
    expect(started.hunger).toBe(life.hunger);

    // 一路潜行到收束（体力预算决定它必然收）
    let state = started;
    let guard = 0;
    while (approachOf(state) && guard < 20) {
      state = stalkAct(state, "creep", quiet).state;
      guard += 1;
    }
    expect(approachOf(state)).toBeNull();
    expect(state.season).toBe(1);
    expect(state.year).toBe(life.year);
    // 全程只扣了一季的饱食（收益另算：这一路只潜行没扑，必然空手）
    expect(state.hunger).toBe(life.hunger - 12);
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
      if (performAction(life, "explore", content, NEAR).pendingEvent) exploreHits += 1;
    }
    expect(restHits / runs).toBeGreaterThan(0.14);
    expect(restHits / runs).toBeLessThan(0.27);
    expect(exploreHits / runs).toBeGreaterThan(0.32);
    expect(exploreHits / runs).toBeLessThan(0.48);
  });

  /*
   * M1-P1：狩猎这一季**要么抽到事件、要么起追**，两者不并存（同一块中央舞台）。
   * 起追的那一季刻意不抽事件 —— 玩家此刻该盯着追猎屏，不该被别的事件插队。
   */
  it("起追的那一季不抽事件（事件与追猎二选一）", () => {
    const quiet = contentWithoutEvents();
    const started = performAction(createLife(13, FIXTURE_SEED_ID, quiet), "hunt", quiet);
    expect(approachOf(started.state)).not.toBeNull();
    expect(started.pendingEvent).toBeNull();

    const busy = makeContent({ tuning: { eventChanceBase: 1 } });
    const drawn = performAction(createLife(13, FIXTURE_SEED_ID, busy), "hunt", busy);
    expect(drawn.pendingEvent).not.toBeNull();
    expect(approachOf(drawn.state)).toBeNull();
  });

  it("once 事件在**结算后**才进 firedOnceIds，之后不再入池", () => {
    // 只留 once 的丛中窥影，狩猎行动触发
    const content = makeContent({
      events: [makeContent().events.find((event) => event.trigger.once === true)!],
      tuning: { ...UNCLAMPED_CHANCE, eventChanceBase: 1 },
    });
    // 带雾目才能选不开战的那个抉择（抉择 0 会 startCombat，之后不能再 performAction）
    const life = withOrgans(createLife(21, FIXTURE_SEED_ID, content), ORGAN_WU_MU);
    const first = performAction(life, "hunt", content);
    expect(first.pendingEvent).not.toBeNull();
    // 抽出但未结算 → 还没烧掉
    expect(first.state.firedOnceIds).toEqual([]);
    const resolved = resolveChoice(first.state, first.pendingEvent!, 1, content).state;
    expect(clashOf(resolved)).toBeNull();
    expect(resolved.firedOnceIds).toEqual([first.pendingEvent!.id]);
    expect(performAction(resolved, "hunt", content).pendingEvent).toBeNull();
  });

  it("未结算就进下一回合的 once 事件不会本世永久消失（还能重抽）", () => {
    const content = makeContent({
      events: [makeContent().events.find((event) => event.trigger.once === true)!],
      tuning: { ...UNCLAMPED_CHANCE, eventChanceBase: 1 },
    });
    const life = createLife(21, FIXTURE_SEED_ID, content);
    const dropped = performAction(life, "hunt", content);
    expect(dropped.pendingEvent).not.toBeNull();
    // 界面把事件丢了、直接又行动一次 —— 引擎无从强制，但至少不该吞掉稀有内容
    const again = performAction(dropped.state, "hunt", content);
    expect(again.pendingEvent?.id).toBe(dropped.pendingEvent?.id);
  });

  it("结算同一 once 事件两次不会写重复 id", () => {
    const content = makeContent({
      events: [makeContent().events.find((event) => event.trigger.once === true)!],
      tuning: { ...UNCLAMPED_CHANCE, eventChanceBase: 1 },
    });
    const event = content.events[0]!;
    const life = withOrgans(createLife(21, FIXTURE_SEED_ID, content), ORGAN_WU_MU);
    const once = resolveChoice(life, event, 1, content).state;
    const twice = resolveChoice(once, event, 1, content).state;
    expect(twice.firedOnceIds).toEqual([event.id]);
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
    const { state } = performAction(starving, "explore", content, NEAR);
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
