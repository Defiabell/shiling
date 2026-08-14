/**
 * [S2] 探索去处的引擎侧专测。
 *
 * 这一批把「探索」从一颗按钮换成了「往哪走」的一次决定，新增的机制有五块，逐块钉：
 * 1. **参数契约**：探索必填去处、非探索不许填、未知／未开启一律抛错（不许有兜底语义）。
 * 2. **门槛**：`requiresOrganIds` 全部持有才开；未开启的照样出现在预览里（欲望展示位）。
 * 3. **路费与遇袭**：三档风险各一组数；遇袭是「本季没撞上事」才掷的**条件**概率。
 * 4. **独立事件池**：`trigger.destinations` 决定一条事件在哪几处入池。
 * 5. **秘藏**：`findTreasureId` 落账、差集、不重复记。
 *
 * 用的是 fixture 的两处去处（近野：无门槛无兽的常路；远地：要疾足的绝境，只有穷奇）——
 * 「够小、够极端」同 fixture 的一贯做法。
 */

import { describe, expect, it } from "vitest";
import {
  createLife,
  destinationById,
  destinationPreview,
  exploreDestinations,
  performAction,
  resolveChoice,
  type TaleContent,
  type TaleEvent,
  type TaleState,
  clashOf,
} from "../src/index.js";
import {
  DEST_FAR,
  DEST_NEAR,
  ENEMY_QIONG_QI,
  ENEMY_YE_ZHI,
  FIXTURE_DESTINATIONS,
  FIXTURE_SEED_ID,
  NEAR,
  ORGAN_JI_ZU,
  TREASURE_FAR,
  TREASURE_NEAR,
  contentWithoutEvents,
  makeContent,
} from "./fixtures.js";

const QUIET = contentWithoutEvents();

function life(content: TaleContent = QUIET, seed = 7): TaleState {
  return createLife(seed, FIXTURE_SEED_ID, content);
}

/** 身上多一件器官（只借 id，不叠 statMods —— 这一组测的是门槛不是数值）。 */
function withOrgans(state: TaleState, ...organIds: string[]): TaleState {
  return { ...state, organIds: [...state.organIds, ...organIds] };
}

describe("去处参数契约（一套语义，没有兜底）", () => {
  it("探索不给去处 → 抛错", () => {
    expect(() => performAction(life(), "explore", QUIET)).toThrow(/必须指定去处/);
  });

  it("探索给了不认识的去处 → 抛错", () => {
    expect(() => performAction(life(), "explore", QUIET, { destinationId: "dest-nope" })).toThrow(
      /未知去处/,
    );
  });

  it("门槛未达的去处 → 抛错（界面置灰是它的镜像，不是它的替代）", () => {
    expect(() => performAction(life(), "explore", QUIET, { destinationId: DEST_FAR })).toThrow(
      /尚未开启/,
    );
  });

  it("非探索行动带了去处 → 抛错（避免第二套语义悄悄长出来）", () => {
    expect(() => performAction(life(), "rest", QUIET, { destinationId: DEST_NEAR })).toThrow(
      /不接受去处参数/,
    );
  });

  it("门槛齐了就去得了", () => {
    const swift = withOrgans(life(), ORGAN_JI_ZU);
    expect(() => performAction(swift, "explore", QUIET, { destinationId: DEST_FAR })).not.toThrow();
  });
});

describe("预览：未开启的照样返回，且说得出缺什么", () => {
  it("全部去处都在列表里，顺序恒按内容表", () => {
    const previews = exploreDestinations(life(), QUIET);
    expect(previews.map((preview) => preview.def.id)).toEqual([DEST_NEAR, DEST_FAR]);
  });

  it("未开启时 missingOrganIds 列出缺的那几件；开启后为空", () => {
    const bare = destinationPreview(life(), QUIET, DEST_FAR);
    expect(bare.unlocked).toBe(false);
    expect(bare.missingOrganIds).toEqual([ORGAN_JI_ZU]);

    const swift = destinationPreview(withOrgans(life(), ORGAN_JI_ZU), QUIET, DEST_FAR);
    expect(swift.unlocked).toBe(true);
    expect(swift.missingOrganIds).toEqual([]);
  });

  it("三个可读的量都报出来：遇事概率、遇袭概率、这一季的饱食账", () => {
    const t = QUIET.tuning;
    const near = destinationPreview(life(), QUIET, DEST_NEAR);
    // 常路：无兽 → 遇袭恒为 0（连概率骰都不掷，见 rollAmbush）
    expect(near.ambushChance).toBe(0);
    expect(near.ambushEnemies).toEqual([]);
    expect(near.hungerCost).toBe(t.hungerPerSeason + t.explorePeril.calm.travelCost);

    const far = destinationPreview(withOrgans(life(), ORGAN_JI_ZU), QUIET, DEST_FAR);
    expect(far.ambushChance).toBe(t.explorePeril.grim.ambushChance);
    expect(far.ambushEnemies.map((enemy) => enemy.id)).toEqual(["qiong-qi-you"]);
    expect(far.hungerCost).toBe(t.hungerPerSeason + t.explorePeril.grim.travelCost);
    // 绝境的事件乘子更高 —— 三档单调是 schema 测试守着的性质，这里只验它真的落到了预览上。
    // 拿一份**开着事件**的 content 量：`QUIET` 的 eventChanceBase 是 0，两处都会是 0
    const busy = makeContent();
    expect(destinationPreview(withOrgans(life(busy), ORGAN_JI_ZU), busy, DEST_FAR).eventChance)
      .toBeGreaterThan(destinationPreview(life(busy), busy, DEST_NEAR).eventChance);
  });

  it("未知 id 直接抛错（内容与界面对不上是 bug，不是可降级的输入）", () => {
    expect(() => destinationPreview(life(), QUIET, "dest-nope")).toThrow(/未知去处/);
  });

  it("到过之后 visited 为真（本世；跨世那一份在 Bloodline）", () => {
    const before = destinationPreview(life(), QUIET, DEST_NEAR);
    expect(before.visited).toBe(false);
    const after = performAction(life(), "explore", QUIET, NEAR).state;
    expect(destinationPreview(after, QUIET, DEST_NEAR).visited).toBe(true);
  });
});

describe("路费：远行要多付饱食", () => {
  it("常路只扣季耗；绝境额外扣路费", () => {
    const t = QUIET.tuning;
    const base = { ...life(), hunger: 90 };
    const near = performAction(base, "explore", QUIET, NEAR).state;
    expect(near.hunger).toBe(90 - t.hungerPerSeason);

    const swift = withOrgans(base, ORGAN_JI_ZU);
    const far = performAction(swift, "explore", QUIET, { destinationId: DEST_FAR }).state;
    expect(far.hunger).toBe(90 - t.hungerPerSeason - t.explorePeril.grim.travelCost);
  });

  it("路费不会把饱食扣成负数", () => {
    const starving = { ...withOrgans(life(), ORGAN_JI_ZU), hunger: 4 };
    const after = performAction(starving, "explore", QUIET, { destinationId: DEST_FAR }).state;
    expect(after.hunger).toBe(0);
  });

  it("到过的去处只记一次（图鉴是集合，不是流水）", () => {
    let state = life();
    for (let i = 0; i < 3; i += 1) {
      state = performAction(state, "explore", QUIET, NEAR).state;
    }
    expect(state.visitedDestinationIds).toEqual([DEST_NEAR]);
  });
});

describe("遇袭：本季没撞上事才掷，且只摇此地的兽", () => {
  /** 遇袭必中的 content（概率钉死，不猜种子）。 */
  const AMBUSH = contentWithoutEvents({
    tuning: {
      explorePeril: {
        calm: { ambushChance: 1, travelCost: 0, eventMul: 1 },
        wary: { ambushChance: 1, travelCost: 6, eventMul: 1 },
        grim: { ambushChance: 1, travelCost: 0, eventMul: 1 },
      },
    },
  });

  it("此地无兽 → 一次都不遇袭（连概率骰都不掷）", () => {
    const after = performAction(life(AMBUSH), "explore", AMBUSH, NEAR);
    expect(clashOf(after.state)).toBeNull();
  });

  it("此地有兽 ＋ 概率拉满 → 当场开战，且对手来自该处的 denizens", () => {
    const swift = withOrgans(life(AMBUSH), ORGAN_JI_ZU);
    const after = performAction(swift, "explore", AMBUSH, { destinationId: DEST_FAR });
    expect(after.state.encounter?.enemyId).toBe("qiong-qi-you");
    expect(after.notices.join("")).toContain("远地");
    expect(after.notices.join("")).toContain("穷奇幼崽");
  });

  /**
   * **多头兽的加权挑选真的按权重走**（不是恒取第一头）。
   *
   * 这一条是 code-reviewer 指出的覆盖缺口：上面几条都把概率钉成 0 或 1，而 fixture 的
   * `DEST_FAR` 只有一头兽 —— 于是 `weightedPick(cursor, destination.denizens, ...)`
   * 那一行**从来没有在「多头且权重不同」的局面下跑过**，而真内容里有三处是那样
   * （古祠／秘窟／焦原）。一次把权重表写反（或按 id 排序）不会有任何测试变红。
   *
   * 判据是分布而不是某一次的结果：同一份 content 换 200 个种子，两头都摇得出来，
   * 且**权重大的那一头明显更多**。这样它抓得到「恒取第一头」「权重反了」两类错。
   */
  it("多头兽按权重摇（不是恒取第一头，也不是等概率）", () => {
    const TWO = contentWithoutEvents({
      destinations: FIXTURE_DESTINATIONS.map((destination) =>
        destination.id === DEST_FAR
          ? {
              ...destination,
              denizens: [
                { enemyId: ENEMY_QIONG_QI, weight: 80 },
                { enemyId: ENEMY_YE_ZHI, weight: 20 },
              ],
            }
          : destination,
      ),
      tuning: {
        explorePeril: {
          calm: { ambushChance: 1, travelCost: 0, eventMul: 1 },
          wary: { ambushChance: 1, travelCost: 6, eventMul: 1 },
          grim: { ambushChance: 1, travelCost: 0, eventMul: 1 },
        },
      },
    });
    const counts = new Map<string, number>();
    for (let seed = 0; seed < 200; seed += 1) {
      const swift = withOrgans(life(TWO, seed * 7919 + 13), ORGAN_JI_ZU);
      const enemyId = performAction(swift, "explore", TWO, { destinationId: DEST_FAR })
        .state.encounter?.enemyId;
      if (enemyId) counts.set(enemyId, (counts.get(enemyId) ?? 0) + 1);
    }
    const heavy = counts.get(ENEMY_QIONG_QI) ?? 0;
    const light = counts.get(ENEMY_YE_ZHI) ?? 0;
    expect(heavy + light).toBe(200);
    // 两头都摇得出来（不是恒取第一头）
    expect(light, "轻的那一头一次都没摇到").toBeGreaterThan(0);
    // 且重的那一头明显更多（权重反了会让这条红）
    expect(heavy).toBeGreaterThan(light * 2);
  });

  it("撞上事件那一季不掷遇袭（事件卡与搏杀屏占同一块舞台）", () => {
    /*
     * 事件必中 ＋ 遇袭必中：若两者能并存，`pendingEvent` 与 `combat` 会同时非空，
     * 而界面只有一块中央舞台 —— 那正是狩猎「要么撞上事，要么起追」要避免的形状。
     */
    const both = makeContent({
      tuning: {
        eventChanceBase: 1,
        exploreEventBonus: 1,
        explorePeril: {
          calm: { ambushChance: 1, travelCost: 0, eventMul: 1 },
          wary: { ambushChance: 1, travelCost: 6, eventMul: 1 },
          grim: { ambushChance: 1, travelCost: 0, eventMul: 1 },
        },
      },
    });
    const swift = withOrgans(life(both), ORGAN_JI_ZU);
    const turn = performAction(swift, "explore", both, { destinationId: DEST_FAR });
    expect(turn.pendingEvent).not.toBeNull();
    expect(clashOf(turn.state)).toBeNull();
  });
});

describe("独立事件池：trigger.destinations 决定在哪几处入池", () => {
  const NEAR_ONLY: TaleEvent = {
    id: "ev-near",
    trigger: { region: "qingqiu", actions: ["explore"], destinations: [DEST_NEAR], weight: 100 },
    title: "近野之事",
    body: "只在近野撞得上。",
    choices: [{ label: "看看", outcomes: [{ weight: 1, text: "看了。", effects: {} }] }],
  };
  const FAR_ONLY: TaleEvent = {
    ...NEAR_ONLY,
    id: "ev-far",
    trigger: { region: "qingqiu", actions: ["explore"], destinations: [DEST_FAR], weight: 100 },
    title: "远地之事",
  };
  /** 不声明去处的事件（季候本身的事）—— 哪一处都撞得上。 */
  const ANYWHERE: TaleEvent = {
    ...NEAR_ONLY,
    id: "ev-any",
    trigger: { region: "qingqiu", weight: 100 },
    title: "何处皆然",
  };
  const POOL = makeContent({
    events: [NEAR_ONLY, FAR_ONLY],
    tuning: { eventChanceBase: 1, exploreEventBonus: 1 },
  });

  it("去近野只抽得到近野那一条", () => {
    const turn = performAction(life(POOL), "explore", POOL, NEAR);
    expect(turn.pendingEvent?.id).toBe("ev-near");
  });

  it("去远地只抽得到远地那一条", () => {
    const swift = withOrgans(life(POOL), ORGAN_JI_ZU);
    const turn = performAction(swift, "explore", POOL, { destinationId: DEST_FAR });
    expect(turn.pendingEvent?.id).toBe("ev-far");
  });

  it("不声明去处的事件在哪一处都入池，也在别的行动之后入池", () => {
    const mixed = makeContent({
      events: [ANYWHERE],
      tuning: { eventChanceBase: 1, exploreEventBonus: 1 },
    });
    expect(performAction(life(mixed), "explore", mixed, NEAR).pendingEvent?.id).toBe("ev-any");
    expect(performAction(life(mixed), "rest", mixed).pendingEvent?.id).toBe("ev-any");
  });

  it("此地没有任何事件 → 这一季就是空手（不会串到别处的池子）", () => {
    const onlyFar = makeContent({
      events: [FAR_ONLY],
      tuning: { eventChanceBase: 1, exploreEventBonus: 1 },
    });
    expect(performAction(life(onlyFar), "explore", onlyFar, NEAR).pendingEvent).toBeNull();
  });
});

describe("秘藏：只记发现，收益照常写在同一笔 effects 里", () => {
  const TREASURE_EVENT: TaleEvent = {
    id: "ev-treasure",
    trigger: { region: "qingqiu", actions: ["explore"], destinations: [DEST_NEAR], weight: 100 },
    title: "近野之秘",
    body: "土下埋着一样东西。",
    choices: [
      {
        label: "掘出来",
        outcomes: [
          {
            weight: 1,
            text: "掘出来了。",
            effects: { findTreasureId: TREASURE_NEAR, essence: { zu: 12 } },
          },
        ],
      },
      { label: "不动它", outcomes: [{ weight: 1, text: "走了。", effects: {} }] },
    ],
  };
  const CONTENT = makeContent({
    events: [TREASURE_EVENT],
    tuning: { eventChanceBase: 1, exploreEventBonus: 1 },
  });

  function drawTreasure(): { state: TaleState; event: TaleEvent } {
    const turn = performAction(life(CONTENT), "explore", CONTENT, NEAR);
    expect(turn.pendingEvent?.id).toBe("ev-treasure");
    return { state: turn.state, event: turn.pendingEvent as TaleEvent };
  }

  it("落账进 foundTreasureIds，并作为差集报给客户端", () => {
    const { state, event } = drawTreasure();
    const result = resolveChoice(state, event, 0, CONTENT);
    expect(result.state.foundTreasureIds).toEqual([TREASURE_NEAR]);
    expect(result.newTreasures.map((treasure) => treasure.id)).toEqual([TREASURE_NEAR]);
    // 收益照常落（这一位只是「这一桩算不算发现」的钩子）
    expect(result.state.essence.zu).toBeGreaterThan(state.essence.zu);
  });

  it("写一条 event 记录（列传里看得见「秘藏到手」）", () => {
    const { state, event } = drawTreasure();
    const result = resolveChoice(state, event, 0, CONTENT);
    const record = result.state.records.find((item) => item.refId === TREASURE_NEAR);
    expect(record?.kind).toBe("event");
    expect(record?.text).toContain("近野之秘");
  });

  it("没选那一支就什么也不记", () => {
    const { state, event } = drawTreasure();
    const result = resolveChoice(state, event, 1, CONTENT);
    expect(result.state.foundTreasureIds).toEqual([]);
    expect(result.newTreasures).toEqual([]);
  });

  it("不重复记（图鉴是集合）", () => {
    const { state, event } = drawTreasure();
    const once = resolveChoice(state, event, 0, CONTENT).state;
    // 手工把 `once` 事件的记号抹掉，模拟同一件秘藏第二次撞上
    const again = resolveChoice({ ...once, firedOnceIds: [] }, event, 0, CONTENT);
    expect(again.state.foundTreasureIds).toEqual([TREASURE_NEAR]);
    expect(again.newTreasures).toEqual([]);
  });

  it("写错秘藏 id 直接抛错（静默失效的图鉴格子比崩溃更难查）", () => {
    const broken = makeContent({
      events: [
        {
          ...TREASURE_EVENT,
          choices: [
            {
              label: "掘出来",
              outcomes: [{ weight: 1, text: "掘出来了。", effects: { findTreasureId: "nope" } }],
            },
          ],
        },
      ],
      tuning: { eventChanceBase: 1, exploreEventBonus: 1 },
    });
    const turn = performAction(life(broken), "explore", broken, NEAR);
    expect(() => resolveChoice(turn.state, turn.pendingEvent as TaleEvent, 0, broken)).toThrow(
      /未知秘藏/,
    );
  });

  it("远地那件秘藏与近野那件互不相干（每处一件）", () => {
    expect(destinationById(QUIET, DEST_NEAR)?.treasure.id).toBe(TREASURE_NEAR);
    expect(destinationById(QUIET, DEST_FAR)?.treasure.id).toBe(TREASURE_FAR);
  });
});

describe("确定性：探索这一支照样是纯函数", () => {
  it("同种子同去处 → 同终态；换去处 → 不同终态", () => {
    const AMBUSH = contentWithoutEvents({
      tuning: {
        explorePeril: {
          calm: { ambushChance: 0.5, travelCost: 0, eventMul: 1 },
          wary: { ambushChance: 0.5, travelCost: 6, eventMul: 1 },
          grim: { ambushChance: 0.5, travelCost: 12, eventMul: 1 },
        },
      },
    });
    const swift = withOrgans(life(AMBUSH, 31337), ORGAN_JI_ZU);
    const a = performAction(swift, "explore", AMBUSH, NEAR).state;
    const b = performAction(swift, "explore", AMBUSH, NEAR).state;
    expect(a).toEqual(b);
    const far = performAction(swift, "explore", AMBUSH, { destinationId: DEST_FAR }).state;
    expect(far.hunger).not.toBe(a.hunger);
  });

  it("不改动入参（两个新数组也要深拷）", () => {
    const before = life();
    const snapshot = JSON.parse(JSON.stringify(before)) as TaleState;
    performAction(before, "explore", QUIET, NEAR);
    expect(before).toEqual(snapshot);
  });
});
