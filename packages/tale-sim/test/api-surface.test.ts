/**
 * 公开 API 面与「内容 ↔ 状态」边界的守卫测试。
 *
 * 这一批测的不是玩法，而是**交接契约**：B2/B3 会怎么误用引擎，以及引擎有没有把
 * 该守住的地方守住（保留 flag 命名空间、返回值不别名 content、器官解析必须走并集）。
 */
import { describe, expect, it } from "vitest";
import {
  SYS_FLAG_ASCEND_READY,
  SYS_FLAG_FEINT_PRIMED,
  SYS_FLAG_STARVING,
  combatSkillOrgan,
  createLife,
  organIndex,
  ownedOrgans,
  ownedTags,
  performAction,
  resolveChoice,
  type TaleEvent,
  type TaleState,
} from "../src/index.js";
import {
  FIXTURE_CONTENT,
  FIXTURE_SEED_ID,
  FIXTURE_SEED_ORGAN_ID,
  ORGAN_GOU_CHI,
  ORGAN_WU_MU,
  contentWithoutEvents,
  makeContent,
  withOrgans,
} from "./fixtures.js";

const CONTENT = contentWithoutEvents();

function life(seed = 1): TaleState {
  return createLife(seed, FIXTURE_SEED_ID, CONTENT);
}

/** 造一个只有一个抉择、effects 由调用方给定的事件。 */
function effectEvent(effects: TaleEvent["choices"][number]["outcomes"][number]["effects"]): TaleEvent {
  return {
    id: "probe",
    trigger: { region: "any", weight: 1 },
    title: "探针",
    body: "试。",
    choices: [{ label: "试", outcomes: [{ weight: 1, text: "如是。", effects }] }],
  };
}

describe("器官解析 API（B3 靠它渲染门槛原因与战斗第四按钮）", () => {
  it("神种器官只在 seeds[].organ 里，organIndex 取的是并集", () => {
    // 这是最容易被下游漏掉的坑：直接查 content.organs 会查不到神种器官
    expect(FIXTURE_CONTENT.organs.some((organ) => organ.id === FIXTURE_SEED_ORGAN_ID)).toBe(false);
    expect(organIndex(FIXTURE_CONTENT).get(FIXTURE_SEED_ORGAN_ID)?.name).toBe("灵蕴");
  });

  it("ownedOrgans 按 organIds 顺序返回定义，[0] 是神种器官", () => {
    const state = withOrgans(life(), ORGAN_GOU_CHI);
    const owned = ownedOrgans(state, CONTENT);
    expect(owned.map((organ) => organ.id)).toEqual([FIXTURE_SEED_ORGAN_ID, ORGAN_GOU_CHI]);
  });

  it("ownedOrgans 跳过查不到的 id 而不是抛错", () => {
    const state = withOrgans(life(), "ghost-organ");
    expect(ownedOrgans(state, CONTENT)).toHaveLength(1);
  });

  it("ownedTags 含神种器官的 tag（漏并集时这条会红）", () => {
    const tags = ownedTags(life(), CONTENT);
    expect(tags.has("spirit-born")).toBe(true);
    expect(tags.has("hunter")).toBe(false);
    expect(ownedTags(withOrgans(life(), ORGAN_GOU_CHI), CONTENT).has("hunter")).toBe(true);
  });

  it("combatSkillOrgan 与 combatAct 的 organ 前置条件严格一致", () => {
    expect(combatSkillOrgan(life(), CONTENT)).toBeNull();
    const armed = withOrgans(life(), ORGAN_WU_MU, ORGAN_GOU_CHI);
    expect(combatSkillOrgan(armed, CONTENT)?.id).toBe(ORGAN_GOU_CHI);
    expect(combatSkillOrgan(armed, CONTENT)?.combatSkill?.name).toBe("撕咬");
  });
});

describe("sys: 保留 flag 命名空间", () => {
  it("内容写不进 sys: flag（否则一季就能饿死，规格要求两季）", () => {
    const event = effectEvent({ addFlags: [SYS_FLAG_STARVING, "legit-flag"] });
    const { state } = resolveChoice(life(), event, 0, CONTENT);
    expect(state.flags).toEqual(["legit-flag"]);
  });

  it("内容也删不掉 sys: flag（否则等于饿死免疫）", () => {
    const event = effectEvent({ removeFlags: [SYS_FLAG_STARVING, "doomed"] });
    const base: TaleState = { ...life(), flags: [SYS_FLAG_STARVING, "doomed"] };
    const { state } = resolveChoice(base, event, 0, CONTENT);
    expect(state.flags).toEqual([SYS_FLAG_STARVING]);
  });

  it("三个保留 flag 都在 sys: 命名空间下", () => {
    for (const flag of [SYS_FLAG_STARVING, SYS_FLAG_ASCEND_READY, SYS_FLAG_FEINT_PRIMED]) {
      expect(flag.startsWith("sys:")).toBe(true);
    }
  });

  it("内容篡改 sys:starving 也改不了「连续两季」规则", () => {
    const harsh = contentWithoutEvents({ tuning: { hungerPerSeason: 60 } });
    const cheat = effectEvent({ addFlags: [SYS_FLAG_STARVING] });
    const cheated = resolveChoice(createLife(1, FIXTURE_SEED_ID, harsh), cheat, 0, harsh).state;
    const first = performAction(cheated, "explore", harsh).state;
    expect(first.alive).toBe(true); // 第一季只挂旗
    expect(performAction(first, "explore", harsh).state.ending).toBe("starve");
  });
});

describe("返回值不别名 content（消费方改返回值不能污染内容数据）", () => {
  it("ChoiceResult.delta 是深拷贝", () => {
    const content = makeContent({
      events: [effectEvent({ hunger: 8, stats: { meng: 1 }, essence: { zu: 6 }, addFlags: ["x"] })],
    });
    const event = content.events[0]!;
    const source = event.choices[0]!.outcomes[0]!.effects;

    const first = resolveChoice(life(), event, 0, content);
    expect(first.delta).not.toBe(source);
    expect(first.delta.stats).not.toBe(source.stats);
    expect(first.delta.essence).not.toBe(source.essence);
    expect(first.delta.addFlags).not.toBe(source.addFlags);

    // 界面「归一化」一下飘字数据 —— 不该影响下一次结算
    first.delta.hunger = 999;
    if (first.delta.stats) first.delta.stats.meng = 999;
    first.delta.addFlags?.push("polluted");

    const second = resolveChoice(life(), event, 0, content);
    expect(second.delta.hunger).toBe(8);
    expect(second.delta.stats?.meng).toBe(1);
    expect(second.delta.addFlags).toEqual(["x"]);
    expect(second.state.hunger).toBe(first.state.hunger);
    expect(second.state.stats).toEqual(first.state.stats);
  });

  it("引擎自身从不写 content（跑完一世后内容对象逐字未变）", () => {
    const content = makeContent({ tuning: { eventChanceBase: 0.6 } });
    const before = structuredClone(content);
    let state = createLife(20260811, FIXTURE_SEED_ID, content);
    for (let i = 0; i < 30 && state.alive; i += 1) {
      if (state.combat) break;
      state = performAction(state, "hunt", content).state;
    }
    expect(content).toEqual(before);
  });
});

describe("illustrationBrief（B2 撰写 / B4 消费，引擎只搬运）", () => {
  it("字段随事件数据原样流转，引擎不读不改", () => {
    const withBrief = FIXTURE_CONTENT.events.find((event) => event.illustrationBrief);
    expect(withBrief?.illustrationBrief).toContain("水墨");
    // 摘掉 trigger 门槛，只验证字段随事件一路传到 pendingEvent
    const content = makeContent({
      tuning: { eventChanceBase: 1 },
      events: [{ ...withBrief!, trigger: { region: "any", weight: 1 } }],
    });
    const drawn = performAction(life(5), "rest", content).pendingEvent;
    expect(drawn?.illustrationBrief).toBe(withBrief?.illustrationBrief);
  });
});
