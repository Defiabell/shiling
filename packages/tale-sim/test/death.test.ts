import { describe, expect, it } from "vitest";
import {
  SYS_FLAG_ASCEND_READY,
  SYS_FLAG_STARVING,
  combatAct,
  createLife,
  performAction,
  resolveChoice,
  stalkAct,
  type TaleState,
} from "../src/index.js";
import {
  ENEMY_QIONG_QI,
  ENEMY_YE_ZHI,
  EVENT_MANDATE,
  EVENT_THICKET,
  FIXTURE_CONTENT,
  FIXTURE_SEED_ID,
  ORGAN_GOU_CHI,
  ORGAN_JI_ZU,
  ORGAN_LIN_JIA,
  ORGAN_WU_MU,
  NEVER_POUNCE,
  UNCLAMPED_CHANCE,
  contentWithoutEvents,
  enterCombat,
  enterStalk,
  makeContent,
  withOrgans,
} from "./fixtures.js";

describe("饿死：必须连续两季", () => {
  const HARSH = contentWithoutEvents({ tuning: { hungerPerSeason: 60, winterHungerExtra: 0 } });

  it("第一季饱食归零只挂 starving，人还活着", () => {
    const life = createLife(1, FIXTURE_SEED_ID, HARSH);
    const { state } = performAction(life, "explore", HARSH);
    expect(state.hunger).toBe(0);
    expect(state.alive).toBe(true);
    expect(state.flags).toContain(SYS_FLAG_STARVING);
  });

  it("连续第二季仍归零才饿死", () => {
    const life = createLife(1, FIXTURE_SEED_ID, HARSH);
    const first = performAction(life, "explore", HARSH).state;
    const second = performAction(first, "explore", HARSH).state;
    expect(second.alive).toBe(false);
    expect(second.ending).toBe("starve");
    const last = second.records[second.records.length - 1];
    expect(last?.kind).toBe("death");
    expect(last?.text).toContain("饥馑连季");
  });

  it("中间缓过一季就重新计数，不会累加致死", () => {
    const forgiving = contentWithoutEvents({
      tuning: { hungerPerSeason: 60, winterHungerExtra: 0, restHungerGain: 70 },
    });
    const life = createLife(1, FIXTURE_SEED_ID, forgiving);
    const starving = performAction(life, "explore", forgiving).state;
    expect(starving.flags).toContain(SYS_FLAG_STARVING);

    const recovered = performAction(starving, "rest", forgiving).state;
    expect(recovered.hunger).toBeGreaterThan(0);
    expect(recovered.flags).not.toContain(SYS_FLAG_STARVING);

    const starvingAgain = performAction(recovered, "explore", forgiving).state;
    expect(starvingAgain.alive).toBe(true);
    expect(starvingAgain.flags).toContain(SYS_FLAG_STARVING);
  });

  it("饱食恰好为 0 也算「≤0」", () => {
    const exact = contentWithoutEvents({ tuning: { hungerPerSeason: 60 } });
    const life = createLife(1, FIXTURE_SEED_ID, exact);
    const state: TaleState = { ...life, hunger: 60, flags: [SYS_FLAG_STARVING] };
    expect(performAction(state, "explore", exact).state.ending).toBe("starve");
  });
});

describe("寿终（oldage）", () => {
  const CALM = contentWithoutEvents({ tuning: { hungerPerSeason: 0, winterHungerExtra: 0 } });

  it("year 超过 lifespanMax 即寿终", () => {
    const life = createLife(1, FIXTURE_SEED_ID, CALM);
    expect(life.lifespanMax).toBe(18);
    const old: TaleState = { ...life, year: 18, season: 3 };
    const { state } = performAction(old, "explore", CALM);
    expect(state.year).toBe(19);
    expect(state.alive).toBe(false);
    expect(state.ending).toBe("oldage");
    /*
     * [M1-P2] 寿终的旁白改成了**明确的失败**（原「寿数已尽，卧于旧穴不复起」是中性的，
     * owner 读完的反应是「没有再玩的欲望」）。这里钉住「未成器」这三个字：它是这一批
     * 结局重构的语义核心，改回中性措辞就该变红。
     */
    expect(state.records[state.records.length - 1]?.text).toContain("未成器");
  });

  it("year 恰等于 lifespanMax 还活着", () => {
    const life = createLife(1, FIXTURE_SEED_ID, CALM);
    const old: TaleState = { ...life, year: 17, season: 3 };
    const { state } = performAction(old, "explore", CALM);
    expect(state.year).toBe(18);
    expect(state.alive).toBe(true);
  });

  it("lifespan effects 延寿后不再寿终", () => {
    const life = createLife(1, FIXTURE_SEED_ID, CALM);
    const old: TaleState = { ...life, year: 18, season: 3, lifespanMax: 20 };
    expect(performAction(old, "explore", CALM).state.alive).toBe(true);
  });
});

describe("死亡覆盖未结算的东西", () => {
  it("死亡撤掉本回合抽出的事件，且不写 firedOnceIds", () => {
    const content = makeContent({
      events: [FIXTURE_CONTENT.events.find((event) => event.id === EVENT_THICKET)!],
      tuning: { ...UNCLAMPED_CHANCE, eventChanceBase: 1, hungerPerSeason: 200 },
    });
    const life = createLife(1, FIXTURE_SEED_ID, content);
    // 丛中窥影只在狩猎后入池；事件必抽 → 这一季不起追，照常走完五步后饿死
    const doomed: TaleState = { ...life, flags: [SYS_FLAG_STARVING] };
    const { state, pendingEvent } = performAction(doomed, "hunt", content);
    expect(state.alive).toBe(false);
    expect(pendingEvent).toBeNull();
    expect(state.firedOnceIds).toEqual([]);
  });

  /*
   * M1-P1：追猎的死亡判定在**收束**那一步（`closeSeason`）。所以「饿到只剩一季还去打猎」
   * 的一世现在会先把追猎打完 —— 扑中就活下来，扑空才饿死。这正是这套改动想要的：
   * 「饿了就去猎」是唯一的正解，它不该自带一条「还没见到猎物就先饿死」的分支。
   */
  it("追猎收束时才判死，且死亡清空追猎与战斗", () => {
    const content = contentWithoutEvents({
      tuning: { ...NEVER_POUNCE, hungerPerSeason: 200 },
    });
    const life = createLife(1, FIXTURE_SEED_ID, content);
    const doomed: TaleState = { ...life, flags: [SYS_FLAG_STARVING] };
    const started = performAction(doomed, "hunt", content).state;
    // 起追这一步不判死 —— 人还活着，追猎还在
    expect(started.alive).toBe(true);
    expect(started.stalk).not.toBeNull();

    // 反扑的猎物 ＋ 必失手：这一扑既该转搏杀、又该在同一步饿死 —— 死亡必须盖掉战斗
    const cornered = enterStalk(doomed, ENEMY_QIONG_QI, {}, content);
    const turn = stalkAct(cornered, "pounce", content);
    expect(turn.over).toBe("combat");
    expect(turn.state.alive).toBe(false);
    expect(turn.state.ending).toBe("starve");
    expect(turn.state.combat).toBeNull();
    expect(turn.state.stalk).toBeNull();
  });

  it("死后再行动直接抛错", () => {
    const content = contentWithoutEvents({ tuning: { hungerPerSeason: 200 } });
    const life = createLife(1, FIXTURE_SEED_ID, content);
    const dead = performAction(
      { ...life, flags: [SYS_FLAG_STARVING] },
      "explore",
      content,
    ).state;
    expect(() => performAction(dead, "explore", content)).toThrow(/已死亡/);
  });
});

describe("登神（ascend）", () => {
  const CONTENT = contentWithoutEvents();
  const MANDATE = FIXTURE_CONTENT.events.find((event) => event.id === EVENT_MANDATE)!;

  it("四项门槛齐备才挂 sys:ascend-ready", () => {
    const life = createLife(1, FIXTURE_SEED_ID, CONTENT);
    const nearly: TaleState = {
      ...withOrgans(life, ORGAN_GOU_CHI, ORGAN_WU_MU, ORGAN_LIN_JIA, ORGAN_JI_ZU),
      year: 15,
      stats: { meng: 10, ling: 60, ti: 20, de: 39 },
    };
    // de 差 1
    expect(performAction(nearly, "explore", CONTENT).state.flags).not.toContain(
      SYS_FLAG_ASCEND_READY,
    );
    const ready: TaleState = { ...nearly, stats: { ...nearly.stats, de: 40 } };
    expect(performAction(ready, "explore", CONTENT).state.flags).toContain(SYS_FLAG_ASCEND_READY);
  });

  it("选对分支即登神，flag 随死亡摘掉", () => {
    const life = createLife(1, FIXTURE_SEED_ID, CONTENT);
    const ready: TaleState = {
      ...withOrgans(life, ORGAN_GOU_CHI, ORGAN_WU_MU, ORGAN_LIN_JIA, ORGAN_JI_ZU),
      year: 15,
      stats: { meng: 10, ling: 60, ti: 20, de: 40 },
      flags: [SYS_FLAG_ASCEND_READY],
    };
    const { state } = resolveChoice(ready, MANDATE, 0, CONTENT);
    expect(state.ending).toBe("ascend");
    expect(state.alive).toBe(false);
    expect(state.flags).not.toContain(SYS_FLAG_ASCEND_READY);
  });

  it("辞而不受则继续活着，flag 仍在", () => {
    const life = createLife(1, FIXTURE_SEED_ID, CONTENT);
    const ready: TaleState = {
      ...withOrgans(life, ORGAN_GOU_CHI, ORGAN_WU_MU, ORGAN_LIN_JIA, ORGAN_JI_ZU),
      year: 15,
      stats: { meng: 10, ling: 60, ti: 20, de: 40 },
      flags: [SYS_FLAG_ASCEND_READY],
    };
    const { state } = resolveChoice(ready, MANDATE, 1, CONTENT);
    expect(state.alive).toBe(true);
    expect(state.flags).toContain(SYS_FLAG_ASCEND_READY);
  });
});

describe("横死（slain）经由战斗", () => {
  it("战斗致死写的是 slain，并记下击杀者", () => {
    const content = contentWithoutEvents({ tuning: { combatDamageJitter: 0 } });
    const life = createLife(1, FIXTURE_SEED_ID, content);
    const cornered = enterCombat(life, ENEMY_YE_ZHI, content, {
      enemyHp: 99,
      playerHp: 1,
      guardPart: "eye",
    });
    const { state, over } = combatAct(cornered, { kind: "bite", part: "throat" }, content);
    expect(over).toBe("dead");
    expect(state.ending).toBe("slain");
    expect(state.records[state.records.length - 1]?.refId).toBe(ENEMY_YE_ZHI);
  });
});
