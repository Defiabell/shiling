import { describe, expect, it } from "vitest";
import { approachOf, availableActions, createLife, performAction, stalkAct } from "../src/index.js";
import {
  ALWAYS_POUNCE,
  ENEMY_QIONG_QI,
  ENEMY_YE_ZHI,
  FIXTURE_CONTENT,
  FIXTURE_SEED_ID,
  UNCLAMPED_CHANCE,
  contentWithoutEvents,
  enterCombat,
  enterStalk,
  makeContent,
  NEAR,
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

  it("死亡、战斗中、追猎中一律无可选行动", () => {
    const life = createLife(1, FIXTURE_SEED_ID, FIXTURE_CONTENT);
    expect(availableActions({ ...life, alive: false }, FIXTURE_CONTENT)).toEqual([]);
    expect(availableActions(enterCombat(life, ENEMY_YE_ZHI), FIXTURE_CONTENT)).toEqual([]);
    expect(availableActions(enterStalk(life, ENEMY_YE_ZHI), FIXTURE_CONTENT)).toEqual([]);
  });
});

describe("performAction 前置校验", () => {
  const life = createLife(1, FIXTURE_SEED_ID, FIXTURE_CONTENT);

  it("已死亡时抛错", () => {
    expect(() => performAction({ ...life, alive: false }, "rest", FIXTURE_CONTENT)).toThrow(
      /已死亡/,
    );
  });

  it("交锋未收束时抛错", () => {
    expect(() =>
      performAction(enterCombat(life, ENEMY_YE_ZHI), "rest", FIXTURE_CONTENT),
    ).toThrow(/遭遇未收束（clash）/);
  });

  it("行动当前不可用时抛错（精气不够却要蛰伏）", () => {
    expect(() => performAction(life, "dormant", FIXTURE_CONTENT)).toThrow(/不可执行行动/);
  });

  it("接近阶段未收束时抛错（遭遇把一个回合拆成两段，中途不许换行动）", () => {
    expect(() =>
      performAction(enterStalk(life, ENEMY_YE_ZHI), "rest", FIXTURE_CONTENT),
    ).toThrow(/遭遇未收束（approach）/);
  });
});

describe("狩猎 → 起追（M1-P1：一个回合被拆成两段）", () => {
  const QUIET = contentWithoutEvents();

  it("没抽到事件就起追：摆出猎物与四个量，且**这一季还没推进**", () => {
    const life = createLife(3, FIXTURE_SEED_ID, QUIET);
    const { state, pendingEvent, notices } = performAction(life, "hunt", QUIET);

    expect(pendingEvent).toBeNull();
    expect(approachOf(state)).not.toBeNull();
    expect(QUIET.tuning.huntPreyIds).toContain(state.encounter?.enemyId);
    expect(approachOf(state)?.stamina).toBe(QUIET.tuning.stalkStamina);
    expect(approachOf(state)?.round).toBe(0);
    expect(["into", "cross", "with"]).toContain(approachOf(state)?.wind);
    // 季推进与饱食消耗推迟到追猎收束那一步 —— 否则饿到只剩一季的玩家会在猎物到嘴前先饿死
    expect(state.season).toBe(life.season);
    expect(state.year).toBe(life.year);
    expect(state.hunger).toBe(life.hunger);
    // 开场旁白进 notices，也进 stalk.log（界面两处都要读得到）
    expect(notices.length).toBeGreaterThan(0);
    expect(state.encounter?.log).toEqual([notices[0]]);
    // 追猎未收束 → 行动面板整体压住
    expect(availableActions(state, QUIET)).toEqual([]);
  });

  /*
   * 这一条守着一个**会静默弄死四分之一内容池**的坑：内容库有 12 条 `actions:["hunt"]`
   * 的狩猎事件，若「狩猎一律直接起追」，它们再也不会入池，而没有任何别的测试会变红。
   */
  it("撞上狩猎事件的那一季不起追（事件卡与追猎屏占同一块舞台）", () => {
    const busy = makeContent({ tuning: { eventChanceBase: 1 } });
    const { state, pendingEvent } = performAction(createLife(3, FIXTURE_SEED_ID, busy), "hunt", busy);
    expect(pendingEvent).not.toBeNull();
    expect(approachOf(state)).toBeNull();
    // 这一季照常收束（该扣的饱食扣了）
    expect(state.hunger).toBe(60 - 12);
  });

  it("扑中才回饱食与精气，且季消耗在收益之后结算", () => {
    const content = contentWithoutEvents({ tuning: ALWAYS_POUNCE });
    const life = createLife(3, FIXTURE_SEED_ID, content);
    const stalking = enterStalk(life, ENEMY_YE_ZHI, {}, content);
    const turn = stalkAct(stalking, "pounce", content);

    expect(turn.over).toBe("caught");
    expect(approachOf(turn.state)).toBeNull();
    // 60 + 26（huntFoodGain）− 12（春季消耗）
    expect(turn.state.hunger).toBe(74);
    expect(turn.state.essence.zu).toBe(12);
    expect(turn.state.essence.xue).toBe(4);
    // 收束这一步才推进季
    expect(turn.state.season).toBe(1);
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

  it("猎物表有多个时会等权轮到不同猎物", () => {
    const twoPrey = contentWithoutEvents({
      tuning: { ...UNCLAMPED_CHANCE, huntPreyIds: [ENEMY_YE_ZHI, ENEMY_QIONG_QI] },
    });
    const seen = new Set<string>();
    for (let seed = 0; seed < 40; seed += 1) {
      const life = createLife(seed, FIXTURE_SEED_ID, twoPrey);
      const { state } = performAction(life, "hunt", twoPrey);
      if (approachOf(state)) seen.add(state.encounter!.enemyId);
    }
    expect(seen).toEqual(new Set([ENEMY_YE_ZHI, ENEMY_QIONG_QI]));
  });

  it("饱食不超上限", () => {
    const feast = contentWithoutEvents({ tuning: { ...ALWAYS_POUNCE, huntFoodGain: 500 } });
    const life = createLife(3, FIXTURE_SEED_ID, feast);
    const turn = stalkAct(enterStalk(life, ENEMY_YE_ZHI, {}, feast), "pounce", feast);
    expect(turn.state.hunger).toBe(100 - 12);
  });
});

describe("探索与休憩", () => {
  it("探索去常路：只给旁白（带去处名），本身不改数值", () => {
    const life = createLife(5, FIXTURE_SEED_ID, NO_EVENTS);
    const { state, notices } = performAction(life, "explore", NO_EVENTS, NEAR);
    // [S2] 旁白带去处名：一世每季都在选一处，日志里不写去了哪儿就复盘不出因果
    expect(notices.join("")).toContain("近野");
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
