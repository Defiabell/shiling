import { describe, expect, it } from "vitest";
import {
  SYS_FLAG_ASCEND_READY,
  SYS_FLAG_DIVINE_EATEN,
  createLife,
  eligibleChoiceIdxs,
  performAction,
  resolveChoice,
  type TaleEvent,
  type TaleState,
  clashOf,
} from "../src/index.js";
import {
  ENEMY_QIONG_QI,
  ENEMY_YE_ZHI,
  EVENT_MANDATE,
  EVENT_SPROUT,
  EVENT_THICKET,
  FIXTURE_CONTENT,
  FIXTURE_SEED_ID,
  ORGAN_GOU_CHI,
  ORGAN_JI_ZU,
  ORGAN_LIN_JIA,
  ORGAN_WU_MU,
  UNCLAMPED_CHANCE,
  contentWithoutEvents,
  makeContent,
  withOrgans,
  NEAR,
} from "./fixtures.js";

const CONTENT = contentWithoutEvents();
const SPROUT = FIXTURE_CONTENT.events.find((event) => event.id === EVENT_SPROUT)!;
const THICKET = FIXTURE_CONTENT.events.find((event) => event.id === EVENT_THICKET)!;
const MANDATE = FIXTURE_CONTENT.events.find((event) => event.id === EVENT_MANDATE)!;

function life(seed = 1): TaleState {
  return createLife(seed, FIXTURE_SEED_ID, CONTENT);
}

describe("eligibleChoiceIdxs 门槛过滤", () => {
  it("无 requires 的抉择恒可选", () => {
    expect(eligibleChoiceIdxs(life(), SPROUT, CONTENT)).toContain(0);
  });

  it("按 stats 门槛过滤（灵 20）", () => {
    const weak = life(); // ling 13
    expect(eligibleChoiceIdxs(weak, SPROUT, CONTENT)).not.toContain(1);
    const bright = { ...weak, stats: { ...weak.stats, ling: 20 } };
    expect(eligibleChoiceIdxs(bright, SPROUT, CONTENT)).toContain(1);
  });

  it("按 essenceMin 门槛过滤（足 30）", () => {
    const base = life();
    expect(eligibleChoiceIdxs(base, SPROUT, CONTENT)).not.toContain(2);
    const charged = { ...base, essence: { ...base.essence, zu: 30 } };
    expect(eligibleChoiceIdxs(charged, SPROUT, CONTENT)).toContain(2);
  });

  it("按 organTags 门槛过滤，任一 tag 命中即可", () => {
    const base = life();
    expect(eligibleChoiceIdxs(base, THICKET, CONTENT)).toEqual([0]);
    // 门槛写的是 ["night-eye","swift"]，雾目只有 night-eye，一个就够
    const seer = withOrgans(base, ORGAN_WU_MU);
    expect(eligibleChoiceIdxs(seer, THICKET, CONTENT)).toEqual([0, 1]);
    // 狩齿的 tag 是 hunter/fang，都不命中
    const biter = withOrgans(base, ORGAN_GOU_CHI);
    expect(eligibleChoiceIdxs(biter, THICKET, CONTENT)).toEqual([0]);
  });

  it("organTags 门槛认的是神种器官的 tag（解析必须走 organs ∪ seeds[].organ 并集）", () => {
    // 灵蕴神种自带 spirit-born，而神种器官不在 content.organs 里 ——
    // 漏了并集的实现会把这个门槛判成永远不满足
    const seedGated: TaleEvent = {
      id: "seed-tag-gate",
      trigger: { region: "any", weight: 1 },
      title: "神种门槛",
      body: "试。",
      choices: [
        {
          label: "以神识应之",
          requires: { organTags: ["spirit-born"] },
          outcomes: [{ weight: 1, text: "应。", effects: {} }],
        },
      ],
    };
    expect(eligibleChoiceIdxs(life(), seedGated, CONTENT)).toEqual([0]);
  });

  it("多门槛同时存在时全部满足才算过", () => {
    const event: TaleEvent = {
      id: "multi-gate",
      trigger: { region: "any", weight: 1 },
      title: "三关",
      body: "试炼。",
      choices: [
        {
          label: "全都要",
          requires: { stats: { ling: 20 }, organTags: ["night-eye"], essenceMin: { zu: 10 } },
          outcomes: [{ weight: 1, text: "过。", effects: {} }],
        },
      ],
    };
    const base = withOrgans(life(), ORGAN_WU_MU);
    expect(eligibleChoiceIdxs(base, event, CONTENT)).toEqual([]);
    const ling = { ...base, stats: { ...base.stats, ling: 20 } };
    expect(eligibleChoiceIdxs(ling, event, CONTENT)).toEqual([]);
    const full = { ...ling, essence: { ...ling.essence, zu: 10 } };
    expect(eligibleChoiceIdxs(full, event, CONTENT)).toEqual([0]);
  });
});

describe("resolveChoice 结算", () => {
  it("不合法下标抛错（不满足门槛 / 越界）", () => {
    expect(() => resolveChoice(life(), SPROUT, 1, CONTENT)).toThrow(/不满足门槛或不存在/);
    expect(() => resolveChoice(life(), SPROUT, 99, CONTENT)).toThrow(/不满足门槛或不存在/);
  });

  it("已死亡时抛错", () => {
    expect(() => resolveChoice({ ...life(), alive: false }, SPROUT, 0, CONTENT)).toThrow(
      /已死亡/,
    );
  });

  it("落账 hunger / essence / stats", () => {
    const base = { ...life(), essence: { zu: 30, lin: 0, xue: 0, meng: 0 } };
    const { state, delta } = resolveChoice(base, SPROUT, 2, CONTENT);
    expect(delta.essence?.zu).toBe(-30);
    expect(state.essence.zu).toBe(0);
    expect(state.stats.meng).toBe(base.stats.meng + 3);
  });

  it("essence 不会被扣成负数", () => {
    const base = { ...life(), essence: { zu: 30, lin: 0, xue: 0, meng: 0 } };
    const drain = makeContent({
      events: [
        {
          ...SPROUT,
          choices: [
            {
              label: "抽干",
              outcomes: [{ weight: 1, text: "尽。", effects: { essence: { zu: -999 } } }],
            },
          ],
        },
      ],
    });
    const { state } = resolveChoice(base, drain.events[0]!, 0, drain);
    expect(state.essence.zu).toBe(0);
  });

  it("写一条 event 记录，refId 指向事件，text 为被抽中的 outcome", () => {
    const { state, outcomeText } = resolveChoice(life(), SPROUT, 0, CONTENT);
    const record = state.records[state.records.length - 1];
    expect(record?.kind).toBe("event");
    expect(record?.refId).toBe(EVENT_SPROUT);
    expect(record?.text).toBe(outcomeText);
  });

  it("startCombat 落账为战斗状态", () => {
    const { state } = resolveChoice(life(), THICKET, 0, CONTENT);
    expect(state.encounter?.enemyId).toBe(ENEMY_YE_ZHI);
    expect(clashOf(state)?.enemyHp).toBe(6);
    expect(clashOf(state)?.playerHp).toBe(state.stats.ti);
    expect(state.encounter?.log.join("")).toContain("野雉");
  });

  it("die 落账为对应结局并把 death 记录放末条", () => {
    const ready: TaleState = {
      ...life(),
      year: 15,
      stats: { meng: 10, ling: 60, ti: 20, de: 40 },
    };
    const { state } = resolveChoice(ready, MANDATE, 0, CONTENT);
    expect(state.alive).toBe(false);
    expect(state.ending).toBe("ascend");
    expect(state.records[state.records.length - 1]?.kind).toBe("death");
    expect(state.records[state.records.length - 1]?.text).toContain("登神位");
  });

  it("addOrganId 加器官并写 molt 记录；已持有则整体跳过", () => {
    const giver = makeContent({
      events: [
        {
          ...SPROUT,
          choices: [
            {
              label: "受之",
              outcomes: [
                { weight: 1, text: "得器官。", effects: { addOrganId: ORGAN_GOU_CHI } },
              ],
            },
          ],
        },
      ],
    });
    const event = giver.events[0]!;
    const base = life();
    const first = resolveChoice(base, event, 0, giver).state;
    expect(first.organIds).toContain(ORGAN_GOU_CHI);
    expect(first.stats.meng).toBe(base.stats.meng + 6);
    expect(first.records[first.records.length - 1]?.kind).toBe("molt");

    const again = resolveChoice(first, event, 0, giver).state;
    expect(again.organIds.filter((id) => id === ORGAN_GOU_CHI)).toHaveLength(1);
    expect(again.stats.meng).toBe(first.stats.meng);
    expect(again.records[again.records.length - 1]?.kind).toBe("event");
  });

  it("addFlags / removeFlags 去重且不误伤", () => {
    const flagger = makeContent({
      events: [
        {
          ...SPROUT,
          choices: [
            {
              label: "记之",
              outcomes: [
                {
                  weight: 1,
                  text: "记下。",
                  effects: { addFlags: ["met-baize", "met-baize"], removeFlags: ["hungry-ghost"] },
                },
              ],
            },
          ],
        },
      ],
    });
    const base = { ...life(), flags: ["hungry-ghost", "keep-me"] };
    const { state } = resolveChoice(base, flagger.events[0]!, 0, flagger);
    expect(state.flags).toEqual(["keep-me", "met-baize"]);
  });

  it("lifespan 增减落在 lifespanMax 上", () => {
    const ready: TaleState = {
      ...life(),
      year: 15,
      stats: { meng: 10, ling: 60, ti: 20, de: 40 },
    };
    const before = ready.lifespanMax;
    const { state } = resolveChoice(ready, MANDATE, 1, CONTENT);
    expect(state.lifespanMax).toBe(before + 2);
    expect(state.alive).toBe(true);
  });

  it("未知器官 / 未知敌人的 effects 直接抛错（内容 bug 要吵）", () => {
    const broken = makeContent({
      events: [
        {
          ...SPROUT,
          choices: [
            { label: "坏器官", outcomes: [{ weight: 1, text: "?", effects: { addOrganId: "nope" } }] },
            { label: "坏敌人", outcomes: [{ weight: 1, text: "?", effects: { startCombat: "nope" } }] },
          ],
        },
      ],
    });
    expect(() => resolveChoice(life(), broken.events[0]!, 0, broken)).toThrow(/未知器官/);
    expect(() => resolveChoice(life(), broken.events[0]!, 1, broken)).toThrow(/未知敌人/);
  });

  it("outcomes 加权分布贴合权重（70/30）", () => {
    let good = 0;
    const runs = 1500;
    for (let seed = 0; seed < runs; seed += 1) {
      const { delta } = resolveChoice(life(seed * 7907 + 1), SPROUT, 0, CONTENT);
      if (delta.hunger !== undefined) good += 1;
    }
    expect(good / runs).toBeGreaterThan(0.65);
    expect(good / runs).toBeLessThan(0.75);
  });

  it("不改动入参 state", () => {
    const base = life();
    const snapshot = structuredClone(base);
    resolveChoice(base, SPROUT, 0, CONTENT);
    expect(base).toEqual(snapshot);
  });
});

describe("trigger 匹配", () => {
  /** 只放一个事件、必抽事件的 content：抽中与否直接反映 trigger 是否匹配。 */
  function soloContent(event: TaleEvent) {
    return makeContent({
      events: [event],
      tuning: { ...UNCLAMPED_CHANCE, eventChanceBase: 1, huntPreyIds: [] },
    });
  }

  it("actions 限定了触发行动", () => {
    const content = soloContent({ ...SPROUT, trigger: { region: "any", actions: ["rest"], weight: 1 } });
    expect(performAction(life(), "rest", content).pendingEvent).not.toBeNull();
    expect(performAction(life(), "explore", content, NEAR).pendingEvent).toBeNull();
  });

  it("minYear / maxYear 限定岁数区间", () => {
    const content = soloContent({
      ...SPROUT,
      trigger: { region: "any", minYear: 3, maxYear: 5, weight: 1 },
    });
    expect(performAction({ ...life(), year: 2 }, "rest", content).pendingEvent).toBeNull();
    expect(performAction({ ...life(), year: 4 }, "rest", content).pendingEvent).not.toBeNull();
    expect(performAction({ ...life(), year: 6 }, "rest", content).pendingEvent).toBeNull();
  });

  it("seasons 限定季节", () => {
    const content = soloContent({
      ...SPROUT,
      trigger: { region: "any", seasons: [2, 3], weight: 1 },
    });
    expect(performAction({ ...life(), season: 1 }, "rest", content).pendingEvent).toBeNull();
    expect(performAction({ ...life(), season: 2 }, "rest", content).pendingEvent).not.toBeNull();
  });

  it("requiresOrganTags 任一命中即可", () => {
    const content = soloContent({
      ...SPROUT,
      trigger: { region: "any", requiresOrganTags: ["armor", "night-eye"], weight: 1 },
    });
    expect(performAction(life(), "rest", content).pendingEvent).toBeNull();
    expect(
      performAction(withOrgans(life(), ORGAN_WU_MU), "rest", content).pendingEvent,
    ).not.toBeNull();
  });

  it("requiresFlags 要求**全部**命中；forbidsFlags 命中任一即排除", () => {
    const content = soloContent({
      ...SPROUT,
      trigger: { region: "any", requiresFlags: ["a", "b"], forbidsFlags: ["z"], weight: 1 },
    });
    expect(performAction({ ...life(), flags: ["a"] }, "rest", content).pendingEvent).toBeNull();
    expect(
      performAction({ ...life(), flags: ["a", "b"] }, "rest", content).pendingEvent,
    ).not.toBeNull();
    expect(
      performAction({ ...life(), flags: ["a", "b", "z"] }, "rest", content).pendingEvent,
    ).toBeNull();
  });

  it("minStats 逐项要求达标", () => {
    const content = soloContent({
      ...SPROUT,
      trigger: { region: "any", minStats: { ling: 20, de: 10 }, weight: 1 },
    });
    const base = life();
    expect(
      performAction({ ...base, stats: { ...base.stats, ling: 20 } }, "rest", content).pendingEvent,
    ).toBeNull();
    expect(
      performAction({ ...base, stats: { ...base.stats, ling: 20, de: 10 } }, "rest", content)
        .pendingEvent,
    ).not.toBeNull();
  });

  it("成道出口靠引擎挂的 sys:way-* flag 生效（登神：灵德齐备且尝过神兽）", () => {
    const content = soloContent(MANDATE);
    const t = content.tuning;
    // 灵德都够，但没尝过神兽 → 门槛不齐，天命不入池
    const notYet: TaleState = {
      ...life(),
      // year 15 是 fixture 那张卡自己 trigger 上的 minYear（与引擎的四道门槛无关）
      year: 15,
      stats: { meng: 10, ling: t.wayShenLing, ti: 20, de: t.wayShenDe },
    };
    expect(notYet.flags).not.toContain(SYS_FLAG_ASCEND_READY);
    expect(performAction(notYet, "rest", content).pendingEvent).toBeNull();

    const ready: TaleState = { ...notYet, flags: [...notYet.flags, SYS_FLAG_DIVINE_EATEN] };
    const turn = performAction(ready, "rest", content);
    expect(turn.state.flags).toContain(SYS_FLAG_ASCEND_READY);
    expect(turn.pendingEvent?.id).toBe(EVENT_MANDATE);
  });

  /*
   * [2026-08-14 死局修复] **一条抉择都点不开的事件不许抽出来。**
   *
   * 抽出来就是一个死局：界面拿到非 null 的 `pendingEvent` 会把行动面板整排锁死
   * （引擎自己立的「先 resolveChoice 再进下一回合」那条纪律），而卡片上没有一颗按得动的
   * 抉择 —— 屏幕上一条路都没有，`resolveChoice` 也无从被调用。
   */
  describe("点不开的事件不入池", () => {
    /** 唯一一条抉择要灵 9999 —— 谁都够不着。 */
    const unopenable: TaleEvent = {
      ...SPROUT,
      id: "unopenable",
      choices: [
        {
          label: "非人所能",
          requires: { stats: { ling: 9999 } },
          outcomes: [{ weight: 1, text: "不可能。", effects: {} }],
        },
      ],
    };

    it("池子里只有它时，抽不出任何事件", () => {
      const content = soloContent(unopenable);
      for (let seed = 0; seed < 40; seed += 1) {
        expect(performAction(life(seed * 31 + 1), "rest", content).pendingEvent).toBeNull();
      }
    });

    it("与一条点得开的并列时，恒抽到点得开的那条", () => {
      const content = makeContent({
        // 权重压倒性地偏向点不开的那条：不过滤就几乎每次都抽到它
        events: [{ ...unopenable, trigger: { region: "any", weight: 99 } }, SPROUT],
        tuning: { ...UNCLAMPED_CHANCE, eventChanceBase: 1, huntPreyIds: [] },
      });
      for (let seed = 0; seed < 40; seed += 1) {
        expect(performAction(life(seed * 17 + 5), "rest", content).pendingEvent?.id).toBe(SPROUT.id);
      }
    });

    it("门槛够得着时它照常入池（过滤问的是**此刻**够不够）", () => {
      const reachable: TaleEvent = {
        ...unopenable,
        choices: [
          {
            label: "灵者可为",
            requires: { stats: { ling: 20 } },
            outcomes: [{ weight: 1, text: "成了。", effects: {} }],
          },
        ],
      };
      const content = soloContent(reachable);
      const base = life();
      expect(performAction(base, "rest", content).pendingEvent).toBeNull();
      expect(
        performAction({ ...base, stats: { ...base.stats, ling: 20 } }, "rest", content).pendingEvent
          ?.id,
      ).toBe(reachable.id);
    });
  });

  it("按 trigger.weight 加权抽取", () => {
    const heavy: TaleEvent = { ...SPROUT, id: "heavy", trigger: { region: "any", weight: 90 } };
    const light: TaleEvent = { ...SPROUT, id: "light", trigger: { region: "any", weight: 10 } };
    const content = makeContent({
      events: [heavy, light],
      tuning: { eventChanceBase: 1 },
    });
    let heavyHits = 0;
    const runs = 1200;
    for (let seed = 0; seed < runs; seed += 1) {
      const drawn = performAction(life(seed * 7717 + 3), "rest", content).pendingEvent;
      if (drawn?.id === "heavy") heavyHits += 1;
    }
    expect(heavyHits / runs).toBeGreaterThan(0.85);
    expect(heavyHits / runs).toBeLessThan(0.95);
  });

  it("穷奇能被事件拉进战斗（enemy 引用走 content.enemies）", () => {
    const content = makeContent({
      events: [
        {
          ...SPROUT,
          choices: [
            {
              label: "迎之",
              outcomes: [{ weight: 1, text: "来了。", effects: { startCombat: ENEMY_QIONG_QI } }],
            },
          ],
        },
      ],
    });
    const { state } = resolveChoice(life(), content.events[0]!, 0, content);
    expect(state.encounter?.enemyId).toBe(ENEMY_QIONG_QI);
    expect(clashOf(state)?.enemyHp).toBe(40);
  });
});
