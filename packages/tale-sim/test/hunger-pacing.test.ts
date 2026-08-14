/**
 * 食余与速猎（饥饿节奏批 2026-08-14）。
 *
 * ## 这份测试真正在守什么
 * owner 的原话是「饿得太快，要经常点击狩猎」。两条药都改了**一世的饱食经济**，所以最容易
 * 出的错不是崩，而是**账对不上**：屏幕上写「食余三季，每季 +9」，而实际结算多给一季、
 * 或在得手那一季就先吃掉一季 —— 那种错不会抛异常，只会让玩家觉得「这游戏的数字是随机的」
 * （同 M1-P1 追猎屏那条教训：预览不骗人是地基）。
 *
 * 四组：
 * 1. **食余的账**：从哪来、每季扣多少、扣几季、不累加、死了不留、速猎没有。
 * 2. **速猎的账**：一次点击就收束（不进追猎屏）、折扣是折扣、精气减半、不反噬、夺命照记。
 * 3. **两条路的分别**：同一颗种子跑两条路，差别恰好是「食余 ＋ 全额」——
 *    这一条是「速猎与追猎不能有一个严格占优」的可执行版。
 * 4. **参数契约**：非狩猎行动给了 `huntMode` 抛错；缺省是追猎（这一批之前唯一的行为）。
 */

import { describe, expect, it } from "vitest";
import {
  createLife,
  performAction,
  quickHuntPreview,
  stalkAct,
  type TaleContent,
  type TaleState,
  type TaleTuning,
  approachOf,
  clashOf,
} from "../src/index.js";
import {
  ALWAYS_POUNCE,
  ENEMY_YE_ZHI,
  FIXTURE_SEED_ID,
  NEAR,
  NEVER_POUNCE,
  UNCLAMPED_CHANCE,
  contentWithoutEvents,
  enterStalk,
  makeContent,
} from "./fixtures.js";

/** 速猎必中／必空：把得手率钉死，才能在不猜种子的前提下测两条分支。 */
const ALWAYS_QUICK: Partial<TaleTuning> = {
  ...UNCLAMPED_CHANCE,
  quickHuntChance: 1,
  quickHuntPerMeng: 0,
};
const NEVER_QUICK: Partial<TaleTuning> = {
  ...UNCLAMPED_CHANCE,
  quickHuntChance: 0,
  quickHuntPerMeng: 0,
};

const QUIET = contentWithoutEvents();

/** 起追 → 一扑到手（`ALWAYS_POUNCE` 打底），返回收束之后的状态。 */
function catchPrey(content: TaleContent, seed = 7): TaleState {
  const state = enterStalk(
    createLife(seed, FIXTURE_SEED_ID, content),
    ENEMY_YE_ZHI,
    { distance: 0, alertness: 0 },
    content,
  );
  return stalkAct(state, "pounce", content).state;
}

describe("食余：一次得手管更久", () => {
  it("追猎得手落账，季数取自 EnemyDef.surplusSeasons（缺省吃 tuning）", () => {
    const three = contentWithoutEvents({
      tuning: ALWAYS_POUNCE,
      enemies: QUIET.enemies.map((enemy) =>
        enemy.id === ENEMY_YE_ZHI ? { ...enemy, surplusSeasons: 3 } : enemy,
      ),
    });
    expect(catchPrey(three).surplusSeasons).toBe(3);

    // 不声明就吃 tuning 的缺省（fixture 野雉没写这一位）
    const fallback = contentWithoutEvents({
      tuning: { ...ALWAYS_POUNCE, huntSurplusSeasons: 5 },
    });
    expect(catchPrey(fallback).surplusSeasons).toBe(5);
  });

  it("**得手那一季不吃余粮** —— 屏幕上写几季就是几季", () => {
    // 收束时 `closeSeason` 会跑一次；若食余在那之前落账，这里会读到 2 而不是 3
    const content = contentWithoutEvents({
      tuning: { ...ALWAYS_POUNCE, huntSurplusSeasons: 3 },
    });
    expect(catchPrey(content).surplusSeasons).toBe(3);
  });

  it("此后每季自动 +gain 并减一，不需要任何点击", () => {
    const content = contentWithoutEvents({
      tuning: { ...ALWAYS_POUNCE, huntSurplusSeasons: 2, huntSurplusGain: 9, hungerPerSeason: 12, winterHungerExtra: 0 },
    });
    let state = catchPrey(content);
    const hunger0 = state.hunger;
    expect(state.surplusSeasons).toBe(2);

    // 一季休憩：−12 季耗 ＋10 休憩 ＋9 食余
    const t = content.tuning;
    state = performAction(state, "rest", content).state;
    expect(state.surplusSeasons).toBe(1);
    expect(state.hunger).toBe(
      Math.min(t.hungerMax, hunger0 - t.hungerPerSeason + t.restHungerGain + t.huntSurplusGain),
    );

    // 再一季：吃完最后一份
    state = performAction(state, "rest", content).state;
    expect(state.surplusSeasons).toBe(0);

    // 第三季就没得吃了：净额回落到「休憩 − 季耗」
    const before = state.hunger;
    state = performAction(state, "rest", content).state;
    expect(state.hunger).toBe(
      Math.min(t.hungerMax, before - t.hungerPerSeason + t.restHungerGain),
    );
  });

  it("吃余粮那一季给一句旁白，吃完那一季再补一句「见了底」", () => {
    const content = contentWithoutEvents({
      tuning: { ...ALWAYS_POUNCE, huntSurplusSeasons: 1 },
    });
    const state = catchPrey(content);
    const turn = performAction(state, "rest", content);
    expect(turn.notices.some((line) => line.includes("旧肉"))).toBe(true);
    expect(turn.notices.some((line) => line.includes("见了底"))).toBe(true);
  });

  it("**不累加**：连着两次得手取较大的那一份，不叠成六季", () => {
    const content = contentWithoutEvents({
      tuning: { ...ALWAYS_POUNCE, huntSurplusSeasons: 3 },
    });
    let state = catchPrey(content);
    expect(state.surplusSeasons).toBe(3);
    // 手工再追一场：余粮仍是 3（取 max），不是 3+3−1
    state = enterStalk(state, ENEMY_YE_ZHI, { distance: 0, alertness: 0 }, content);
    state = stalkAct(state, "pounce", content).state;
    expect(state.surplusSeasons).toBe(3);
  });

  it("食余抵扣不吃「先加后减」的亏：贴着上限时也只按净额算", () => {
    const content = contentWithoutEvents({
      tuning: {
        ...ALWAYS_POUNCE,
        huntSurplusSeasons: 2,
        huntSurplusGain: 9,
        hungerPerSeason: 12,
        winterHungerExtra: 0,
        restHungerGain: 0,
      },
    });
    const caught = catchPrey(content);
    // 贴着上限起步：若实现是「先加 9 夹紧、再减 12」，这里会读到 max−12（多亏 9 点）
    const full = { ...caught, hunger: content.tuning.hungerMax };
    const after = performAction(full, "rest", content).state;
    expect(after.hunger).toBe(content.tuning.hungerMax - 12 + 9);
  });

  it("死在收束那一刻就不落食余（尸体不需要余粮）", () => {
    const content = contentWithoutEvents({
      tuning: { ...NEVER_POUNCE, huntSurplusSeasons: 4, hungerPerSeason: 200 },
    });
    // 扑空 → 猎物遁走 → 收束时饿死
    const state = enterStalk(
      { ...createLife(3, FIXTURE_SEED_ID, content), hunger: 1 },
      ENEMY_YE_ZHI,
      { distance: 0, alertness: 0 },
      content,
    );
    const first = stalkAct(state, "pounce", content).state;
    expect(first.surplusSeasons).toBe(0);
  });

  it("降世时没有余粮（食余只从自己猎到的大猎物来）", () => {
    expect(createLife(9, FIXTURE_SEED_ID, QUIET).surplusSeasons).toBe(0);
  });
});

describe("速猎：一次点击的快路径", () => {
  it("不进追猎屏、这一季当场收束（季推进跑了一次）", () => {
    const content = contentWithoutEvents({ tuning: ALWAYS_QUICK });
    const state = createLife(11, FIXTURE_SEED_ID, content);
    const turn = performAction(state, "hunt", content, { huntMode: "quick" });
    expect(approachOf(turn.state)).toBeNull();
    expect(turn.state.season).toBe(1);
  });

  it("得手：饱食按折扣、精气减半、夺命照记、**不留食余**", () => {
    const content = contentWithoutEvents({
      tuning: { ...ALWAYS_QUICK, quickHuntFoodMul: 0.5, quickHuntEssenceMul: 0.5 },
    });
    const t = content.tuning;
    const state = { ...createLife(11, FIXTURE_SEED_ID, content), hunger: 40 };
    const turn = performAction(state, "hunt", content, { huntMode: "quick" });
    // fixture 野雉：essence { zu: 12, xue: 4 } → 半份 6 / 2
    expect(turn.state.essence.zu).toBe(6);
    expect(turn.state.essence.xue).toBe(2);
    /*
     * **手算的字面量，不是把引擎的算式抄一遍**：基线 `huntFoodGain` 26 ＋ 缺省食余 2 季 × 8
     * ＝ 一趟追猎总值 42，折一半 ＝ 21；这一季再扣 12 季耗 → 40 ＋ 21 − 12 ＝ 49。
     * 抄算式的期望值会连系数写反一起抄过去（P1 那条「自证式断言」的教训）。
     */
    expect(t.huntFoodGain).toBe(26);
    expect(t.huntSurplusSeasons).toBe(2);
    expect(t.huntSurplusGain).toBe(8);
    expect(t.hungerPerSeason).toBe(12);
    expect(turn.state.hunger).toBe(49);
    expect(turn.state.livesTaken).toBe(1);
    expect(turn.state.surplusSeasons).toBe(0);
  });

  it("失手：什么都不给，但这一季照样过去了", () => {
    const content = contentWithoutEvents({ tuning: NEVER_QUICK });
    const state = { ...createLife(11, FIXTURE_SEED_ID, content), hunger: 40 };
    const turn = performAction(state, "hunt", content, { huntMode: "quick" });
    expect(turn.state.essence.zu).toBe(0);
    expect(turn.state.livesTaken).toBe(0);
    expect(turn.state.hunger).toBe(40 - content.tuning.hungerPerSeason);
    expect(turn.state.season).toBe(1);
  });

  it("**不会反噬**：会反扑的猎物在速猎里也不开战（那是追猎屏才有的赌注）", () => {
    const content = contentWithoutEvents({
      tuning: NEVER_QUICK,
      enemies: QUIET.enemies.map((enemy) =>
        enemy.id === ENEMY_YE_ZHI ? { ...enemy, retaliates: true } : enemy,
      ),
    });
    for (let seed = 0; seed < 30; seed += 1) {
      const turn = performAction(
        createLife(seed, FIXTURE_SEED_ID, content),
        "hunt",
        content,
        { huntMode: "quick" },
      );
      expect(clashOf(turn.state)).toBeNull();
    }
  });

  it("照面照记（图鉴不该因为走了快路就漏一头）", () => {
    const content = contentWithoutEvents({ tuning: NEVER_QUICK });
    const turn = performAction(createLife(5, FIXTURE_SEED_ID, content), "hunt", content, {
      huntMode: "quick",
    });
    expect(turn.state.metEnemyIds).toContain(ENEMY_YE_ZHI);
  });

  it("狩猎事件对速猎照样入池（一次点击买不断四分之一的内容池）", () => {
    // 事件必中的 content：速猎那一季应该拿到事件、而不是当场结算
    const content = makeContent({ tuning: { ...ALWAYS_QUICK, eventChanceBase: 1 } });
    const turn = performAction(createLife(2, FIXTURE_SEED_ID, content), "hunt", content, {
      huntMode: "quick",
    });
    expect(turn.pendingEvent).not.toBeNull();
    // 撞上事件的那一季不结算狩猎（同追猎「要么撞上事，要么起追」）
    expect(turn.state.livesTaken).toBe(0);
  });

  it("预览与真跑对账：按钮上写的得手率与折扣就是引擎用的那一份", () => {
    const content = contentWithoutEvents({ tuning: { quickHuntChance: 0.5, quickHuntPerMeng: 0.01 } });
    const state = createLife(4, FIXTURE_SEED_ID, content);
    const preview = quickHuntPreview(state, content);
    const t = content.tuning;
    expect(preview.chance).toBeCloseTo(
      Math.min(t.maxChance, 0.5 + state.stats.meng * 0.01),
      10,
    );
    // 同上：手算字面量。总值 26 ＋ 2×8 ＝ 42，×0.6 ＝ 25.2 → 25
    expect(preview.stalkWorth).toBe(42);
    expect(preview.foodGain).toBe(25);
    expect(preview.stalkFoodGain).toBe(t.huntFoodGain);
    expect(preview.stalkSurplusSeasons).toBe(t.huntSurplusSeasons);
    expect(preview.surplusGain).toBe(t.huntSurplusGain);
  });

  it("得手率按 min/maxChance 夹紧（猛再高也不是必得）", () => {
    const content = contentWithoutEvents({ tuning: { quickHuntChance: 2 } });
    const state = createLife(4, FIXTURE_SEED_ID, content);
    expect(quickHuntPreview(state, content).chance).toBe(content.tuning.maxChance);
  });
});

describe("两条狩猎路的分别（谁也不该严格占优）", () => {
  it("同一头猎物：追猎给全额 ＋ 整份精气 ＋ 食余，速猎给折扣且没有余粮", () => {
    const content = contentWithoutEvents({
      tuning: { ...ALWAYS_POUNCE, ...ALWAYS_QUICK, huntSurplusSeasons: 3 },
    });
    const t = content.tuning;
    const base = { ...createLife(21, FIXTURE_SEED_ID, content), hunger: 30 };

    const stalked = stalkAct(
      enterStalk(base, ENEMY_YE_ZHI, { distance: 0, alertness: 0 }, content),
      "pounce",
      content,
    ).state;
    const quick = performAction(base, "hunt", content, { huntMode: "quick" }).state;

    // 食：全额 vs 折扣
    expect(stalked.hunger - 30 + t.hungerPerSeason).toBe(t.huntFoodGain);
    // 手算：总值 26 ＋ 3×8 ＝ 50（这份 content 把食余季数覆写成 3），×0.6 ＝ 30
    expect(quick.hunger - 30 + t.hungerPerSeason).toBe(30);
    // 精气：整份 vs 半份
    expect(quick.essence.zu).toBeLessThan(stalked.essence.zu);
    // 食余：只有追猎有
    expect(stalked.surplusSeasons).toBe(3);
    expect(quick.surplusSeasons).toBe(0);
    // 夺命：两条路都算（化灵的断门对两条路同解）
    expect(stalked.livesTaken).toBe(1);
    expect(quick.livesTaken).toBe(1);
  });

  it("速猎便宜在**点击**：追猎那一季还没收束，速猎已经翻篇了", () => {
    const content = contentWithoutEvents({ tuning: { ...ALWAYS_POUNCE, ...ALWAYS_QUICK } });
    const state = createLife(31, FIXTURE_SEED_ID, content);
    // 追猎：起追那一次 performAction 不推进季，玩家还要在追猎屏上按好几次
    const stalking = performAction(state, "hunt", content).state;
    expect(approachOf(stalking)).not.toBeNull();
    expect(stalking.season).toBe(0);
    // 速猎：一次点击，这一季就了
    const quick = performAction(state, "hunt", content, { huntMode: "quick" }).state;
    expect(approachOf(quick)).toBeNull();
    expect(quick.season).toBe(1);
  });
});

describe("huntMode 参数契约", () => {
  it("缺省 ＝ 追猎（这一批之前唯一存在的行为）", () => {
    const state = createLife(13, FIXTURE_SEED_ID, QUIET);
    expect(performAction(state, "hunt", QUIET).state.encounter?.approach).not.toBeNull();
    expect(performAction(state, "hunt", QUIET, {}).state.encounter?.approach).not.toBeNull();
    expect(performAction(state, "hunt", QUIET, { huntMode: "stalk" }).state.encounter?.approach).not.toBeNull();
  });

  it("非狩猎行动给了 huntMode 抛错（同去处那条纪律：写错的参数不许被静默吞掉）", () => {
    const state = createLife(13, FIXTURE_SEED_ID, QUIET);
    expect(() => performAction(state, "rest", QUIET, { huntMode: "quick" })).toThrow(/huntMode/);
    expect(() =>
      performAction(state, "explore", QUIET, { ...NEAR, huntMode: "stalk" }),
    ).toThrow(/huntMode/);
  });

  it("速猎也是确定性的：同种子同参数，两次跑出逐字相同的状态", () => {
    const content = contentWithoutEvents({ tuning: { quickHuntChance: 0.5 } });
    for (const seed of [1, 77, 20260814]) {
      const state = createLife(seed, FIXTURE_SEED_ID, content);
      const a = performAction(state, "hunt", content, { huntMode: "quick" });
      const b = performAction(state, "hunt", content, { huntMode: "quick" });
      expect(a.state).toEqual(b.state);
      expect(a.notices).toEqual(b.notices);
    }
  });

  it("速猎不改动入参（纯函数纪律）", () => {
    const content = contentWithoutEvents({ tuning: ALWAYS_QUICK });
    const state = createLife(8, FIXTURE_SEED_ID, content);
    const snapshot = JSON.stringify(state);
    performAction(state, "hunt", content, { huntMode: "quick" });
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

/**
 * [饥饿节奏批] 速猎的 **golden 字面量**回归。
 *
 * 为什么单开一条：`determinism.test.ts` 那两条 golden 的机器玩家从不传 `huntMode`，
 * 于是速猎这条新分支**一次都没被 golden 盖到** —— 而它恰恰会消耗抽取（挑猎物 ＋ 成败各一次）。
 * 「同一进程跑两遍相等」对纯函数是恒真的，抓不到「把两次 `cursor.next()` 调换」这类漂移，
 * 只有跨版本的字面量能抓（同 `determinism.test.ts` 头注写的那条理由）。
 *
 * 这里钉的是**抽取序列**：连打三次速猎之后的 `rngState` 与四个可观察量。
 * 改动速猎的抽取顺序／次数时这条必红，届时要么改回去，要么确认是有意的破坏性变更再重掷。
 */
describe("速猎的 golden（抽取序列）", () => {
  it("同种子连打三次速猎 → 终态逐字锁定", () => {
    const content = contentWithoutEvents();
    const golden = [
      { seed: 20260814, rngState: 2987615573, hunger: 88, zu: 21, xue: 6, lives: 3 },
      { seed: 7, rngState: 2967354766, hunger: 88, zu: 21, xue: 6, lives: 3 },
    ] as const;
    for (const expected of golden) {
      let state = createLife(expected.seed, FIXTURE_SEED_ID, content);
      for (let i = 0; i < 3; i += 1) {
        state = performAction(state, "hunt", content, { huntMode: "quick" }).state;
      }
      expect({
        seed: expected.seed,
        rngState: state.rngState,
        hunger: state.hunger,
        zu: state.essence.zu,
        xue: state.essence.xue,
        lives: state.livesTaken,
      }).toEqual(expected);
    }
  });
});
