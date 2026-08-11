/**
 * 内容冒烟测试 —— 用**真引擎**（tale-sim）把 `TALE_CONTENT` 跑 50 世。
 *
 * schema 测试只能证明数据自洽；能不能玩、玩起来是什么形状，只有真跑才知道。这里量三件事：
 *
 * | 指标 | 目标 | 为什么是这个数 |
 * |---|---|---|
 * | 事件触发覆盖率 | ≥80%（44 中 ≥36），且未触发集合只许是 `EXPECTED_MISSES` 那两条 | 触发不到的事件＝白写的内容 |
 * | 平均蜕变次数 | 2〜4 | 计划 B5 的平衡目标；器官 build 是核心玩法，一世只蜕 1 件就没得搭 |
 * | 饿死率 | ≤60% | 饥饿要真的能杀人，但不能让别的死法（战死／寿终）没机会出场 |
 *
 * ## 这里的「玩家」是谁
 * `decideAction`／`decideCombat` 是一个**明理但不作弊的玩家**：能蛰伏就蛰伏、饿了就猎、
 * 伤病歇两季、饱了就探；血少就逃。抉择则在**满足门槛的选项里等概率乱点** —— 刻意不挑最优，
 * 这样 50 世能把各分支（包括那些会死人的贪心选项）都踩到。
 *
 * 指标不达标时的修法（计划 B2 的纪律）：调 tuning 或事件 effects，**不改引擎**。
 *
 * ⚠️ 这份 50 世快照是**护栏而不是调参依据**：活过 8 岁这类比例在 n=50 上的方差有 ±10 个点
 * （B2 报告的 72% 与 B5 复测的 50% 是同策略同种子的同一件事）。调参看
 * `pnpm -C packages/gen balance`（默认 200 世，三种玩家画像）。
 */

import { describe, expect, it } from "vitest";
import {
  availableActions,
  bloodlineGain,
  combatAct,
  combatSkillOrgan,
  composeChronicle,
  createCursor,
  createLife,
  eligibleChoiceIdxs,
  performAction,
  resolveChoice,
  type ActionId,
  type ChronicleEntry,
  type EndingType,
  type TaleState,
} from "@shiling/tale-sim";
import { EVENTS, FLAG_MERCY, FLAG_SICK, FLAG_WOUND, SEED_CHANG_TAI, TALE_CONTENT } from "../src/index.js";

const CONTENT = TALE_CONTENT;
const LIFE_COUNT = 50;
/**
 * 允许在 50 世里一次都触发不到的事件。**每一条都必须有一条专门的可达性测试兜着**
 * （见文件末尾），否则「触发不到」与「写死了」在这份快照里长得一模一样。
 *
 * - `qiu-heaven-mandate`（天命）：登神出口，门槛 year≥15＋器官≥5＋ling≥60＋de≥40 就是要让
 *   登神率 <2%，靠 50 世撞不出来是**设计使然**。
 * - `qiu-rest-guest`（同穴之客）：需要「先放过幼弱（mercy）× 之后又休憩」这个二重条件，
 *   而休憩是四个行动里用得最少的那个（明理玩家只在伤病时歇，且每次伤病最多歇两季）。
 *   B5 实测：50／80／100／120 世都撞不到，200 世能撞到 —— 它是**难触发**而不是够不着。
 *   注：B5 之前它在这份快照里是「能触发」的，那是因为旧策略有无限休憩的 bug（见 decideAction），
 *   机器玩家一世要歇几十季 —— 覆盖率是被那条 bug 顶上去的。
 */
const EXPECTED_MISSES: readonly string[] = ["qiu-heaven-mandate", "qiu-rest-guest"];
/** 一世的操作上限（寿数 18〜20 岁≈80 回合，加战斗回合，600 足够宽） */
const MAX_STEPS = 600;

interface LifeSummary {
  seed: number;
  ending: EndingType;
  years: number;
  molts: number;
  kills: number;
  organCount: number;
  firedEventIds: string[];
  chronicle: ChronicleEntry;
  bloodline: number;
  steps: number;
}

/**
 * 明理但不作弊的行动策略。
 *
 * ⚠️ B5 修正的一处**策略陷阱**（不是数值问题，是这个机器玩家自己的 bug）：原版写「带伤就休」，
 * 而 `restHealFlags` 只治 `sick` 不治 `wound`（内容侧刻意的分工）。于是一旦挂上 `wound`，
 * 休憩既治不好伤、又把饱食顶在门槛之上让「饿了就猎」永不触发 —— 机器玩家陷入**无限休憩**：
 * 不猎不探、拿不到精气、一世零蜕变。这条 bug 让「一世未蜕形」虚高到 40%，也压低了寿数与
 * 覆盖率。修法：**每次伤病最多歇两季**（不是「连续两季」——那样会退化成睡两季干一季的循环，
 * 一世一半回合在休憩），歇过还没好就带着伤过日子，内容里有专门的疗伤事件。
 */
function decideAction(
  state: TaleState,
  actions: readonly ActionId[],
  roll: () => number,
  restsThisInjury: number,
): ActionId {
  if (actions.includes("dormant")) return "dormant";
  if (state.hunger <= 50) return "hunt";
  if (isHurt(state) && restsThisInjury < 2) return "rest";
  if (state.hunger >= 70) return "explore";
  return roll() < 0.5 ? "hunt" : "explore";
}

function isHurt(state: TaleState): boolean {
  return state.flags.includes(FLAG_WOUND) || state.flags.includes(FLAG_SICK);
}

/** 战斗策略：血过半就打（有器官技先用），掉到三成以下就逃，开场偶尔诈一手。 */
function decideCombat(
  state: TaleState,
  roll: () => number,
): "fight" | "flee" | "feint" | "organ" {
  const combat = state.combat;
  if (!combat) throw new Error("decideCombat: 不在战斗中");
  if (combat.playerHp <= state.stats.ti * 0.35) return "flee";
  if (combat.round === 0 && roll() < 0.3) return "feint";
  return combatSkillOrgan(state, CONTENT) ? "organ" : "fight";
}

function runLife(seed: number): LifeSummary {
  // 策略自己的随机源与引擎的 rngState 分开，互不污染（同 seed 仍完全可复现）
  const cursor = createCursor(seed ^ 0x5f3759df);
  const roll = (): number => cursor.next();
  const fired = new Set<string>();

  let state = createLife(seed, SEED_CHANG_TAI, CONTENT);
  let steps = 0;
  let restsThisInjury = 0;

  while (state.alive && steps < MAX_STEPS) {
    steps += 1;
    if (state.combat) {
      state = combatAct(state, decideCombat(state, roll), CONTENT).state;
      continue;
    }
    if (!isHurt(state)) restsThisInjury = 0;
    const actions = availableActions(state, CONTENT);
    const action = decideAction(state, actions, roll, restsThisInjury);
    if (action === "rest") restsThisInjury += 1;
    const turn = performAction(state, action, CONTENT);
    state = turn.state;
    const event = turn.pendingEvent;
    if (!event || !state.alive) continue;

    const eligible = eligibleChoiceIdxs(state, event, CONTENT);
    // 一张所有抉择都点不了的事件卡会让界面卡死 —— schema 测试已静态拦过，这里再动态兜一次
    expect(eligible.length, `事件 ${event.id} 在真跑中无可选抉择`).toBeGreaterThan(0);
    const pick = eligible[Math.floor(roll() * eligible.length)];
    state = resolveChoice(state, event, pick ?? 0, CONTENT).state;
    fired.add(event.id);
  }

  expect(state.alive, `seed ${seed} 跑满 ${MAX_STEPS} 步仍未收束`).toBe(false);
  expect(state.ending).not.toBeNull();

  return {
    seed,
    ending: state.ending as EndingType,
    years: state.year,
    molts: state.records.filter((record) => record.kind === "molt").length,
    kills: state.records.filter((record) => record.kind === "combat").length,
    organCount: state.organIds.length,
    firedEventIds: [...fired],
    chronicle: composeChronicle(state, CONTENT),
    bloodline: bloodlineGain(state),
    steps,
  };
}

const LIVES: LifeSummary[] = Array.from({ length: LIFE_COUNT }, (_, index) =>
  runLife(1000 + index * 7919),
);

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rateOf(ending: EndingType): number {
  return LIVES.filter((life) => life.ending === ending).length / LIVES.length;
}

describe("50 世冒烟", () => {
  it("每一世都能跑到收束，不抛错、不空转", () => {
    expect(LIVES.length).toBe(LIFE_COUNT);
    for (const life of LIVES) {
      expect(life.steps).toBeGreaterThan(1);
      expect(life.steps).toBeLessThan(MAX_STEPS);
      expect(life.years).toBeGreaterThanOrEqual(0);
      expect(life.bloodline).toBeGreaterThanOrEqual(0);
    }
  });

  it("事件触发覆盖率 ≥80%，且只许白名单那两条够不到", () => {
    const fired = new Set(LIVES.flatMap((life) => life.firedEventIds));
    const missing = EVENTS.filter((event) => !fired.has(event.id)).map((event) => event.id);
    const coverage = fired.size / EVENTS.length;
    // 失败时把够不到的事件列名打出来，好直接去改 trigger
    expect(
      coverage,
      `覆盖 ${fired.size}/${EVENTS.length}；未触发：${missing.join("、") || "无"}`,
    ).toBeGreaterThanOrEqual(0.8);
    // 计划的硬指标是 80%，但实际已经 43/44 —— 只留 80% 这一条断言，等于给「以后某次内容
    // 改动悄悄弄死 7 个事件」留了 20% 的藏身空间（那类 bug 引用完整性测试查不出来）。
    // 所以再压一道白名单：允许触发不到的只有那两条，各有专门的可达性测试兜着。
    // 比集合不比顺序 —— `missing` 跟着 EVENTS 的排列走，白名单不该被内容的排序左右。
    expect([...missing].sort(), `除 ${EXPECTED_MISSES.join("、")} 外不该有触发不到的事件`).toEqual(
      [...EXPECTED_MISSES].sort(),
    );
  });

  it("平均蜕变次数落在 2〜4", () => {
    const avg = mean(LIVES.map((life) => life.molts));
    expect(avg, `平均蜕变 ${avg.toFixed(2)} 次`).toBeGreaterThanOrEqual(2);
    expect(avg, `平均蜕变 ${avg.toFixed(2)} 次`).toBeLessThanOrEqual(4);
  });

  it("饿死率 ≤60%，且死法不止一种", () => {
    const starve = rateOf("starve");
    expect(starve, `饿死率 ${(starve * 100).toFixed(0)}%`).toBeLessThanOrEqual(0.6);
    const endings = new Set(LIVES.map((life) => life.ending));
    expect(endings.size, `死法只有 ${[...endings].join("、")}`).toBeGreaterThanOrEqual(2);
  });

  it("战斗与器官系统真的在运转（有击杀、有多器官的一世）", () => {
    expect(LIVES.some((life) => life.kills > 0)).toBe(true);
    // 神种器官恒占 organIds[0]，所以 ≥4 意味着至少蜕出 3 件
    expect(LIVES.some((life) => life.organCount >= 4)).toBe(true);
  });

  it("每一世都生成得出列传，且没有漏填的占位", () => {
    for (const life of LIVES) {
      expect(life.chronicle.title.length).toBeGreaterThan(0);
      expect(life.chronicle.body).not.toMatch(/\{\{\w+\}\}/);
      expect(life.chronicle.body).toContain("赞曰：");
      // 中段至少有出生那一行
      expect(life.chronicle.body.split("\n").length).toBeGreaterThanOrEqual(4);
    }
  });

  /**
   * 「天命」是 44 事件里唯一在 50 世里**触发不到**的一条 —— 这是设计使然：登神门槛
   * （year≥15 且器官≥5 且 ling≥60 且 de≥40）就是要让登神率 <2%（计划 B5 目标）。
   * 所以不去放宽它的 trigger，而是在这里**证明它够得着**：一旦门槛真的满足，它必须入池，
   * 且「应命而升」必须真的收束成 ascend。否则登神线就是一条谁都走不到的死内容。
   */
  it("登神线可达：门槛满足后「天命」入池且能升", () => {
    const born = createLife(20260811, SEED_CHANG_TAI, CONTENT);
    const ready: TaleState = {
      ...born,
      year: 15,
      lifespanMax: 30,
      hunger: 90,
      stats: { ...born.stats, ling: 60, de: 40 },
      organIds: [...born.organIds, "wu-mu", "ling-xi", "ji-zu", "lin-jia"],
    };
    // 事件必抽，其余一切照真内容 —— 「天命」得在完整事件池里竞争出来
    const forced = { ...CONTENT, tuning: { ...CONTENT.tuning, eventChanceBase: 1 } };

    let state = ready;
    let mandate = null as ReturnType<typeof performAction>["pendingEvent"];
    for (let turn = 0; turn < 60 && state.alive; turn += 1) {
      // 一直「休憩」：净回 2 点饱食，不会饿死；抽出的其他事件**故意不结算**——
      // 引擎的 once id 是在 resolveChoice 才烧掉的，丢掉未决事件不会污染 firedOnceIds，
      // 而结算它们会因为某些贪心分支扣德（de −10 一下就掉到 40 以下）把登神门槛打掉。
      const result = performAction(state, "rest", forced);
      state = result.state;
      if (result.pendingEvent?.id === "qiu-heaven-mandate") {
        mandate = result.pendingEvent;
        break;
      }
    }

    expect(mandate, "门槛满足后 200 回合内仍抽不到「天命」").not.toBeNull();
    if (!mandate) return;
    const ascendIdx = mandate.choices.findIndex((choice) => choice.label === "应命而升");
    expect(eligibleChoiceIdxs(state, mandate, forced)).toContain(ascendIdx);
    const after = resolveChoice(state, mandate, ascendIdx, forced).state;
    expect(after.alive).toBe(false);
    expect(after.ending).toBe("ascend");
    expect(composeChronicle(after, forced).body).toContain("神班");
  });

  /**
   * 「同穴之客」可达性：mercy flag ＋ 休憩 这个二重条件一旦成立，它必须能入池且结算得下去。
   *
   * 与「天命」那条同一个套路：白名单里的每条事件都得有人证明它不是死内容。
   */
  it("同穴之客可达：放过幼弱之后休憩，它必须入池", () => {
    const born = createLife(20260812, SEED_CHANG_TAI, CONTENT);
    const merciful: TaleState = { ...born, hunger: 90, flags: [...born.flags, FLAG_MERCY] };
    // 事件必抽，其余照真内容 —— 它得在完整休憩池里竞争出来
    const forced = { ...CONTENT, tuning: { ...CONTENT.tuning, eventChanceBase: 1 } };

    let state = merciful;
    let guest = null as ReturnType<typeof performAction>["pendingEvent"];
    for (let turn = 0; turn < 80 && state.alive; turn += 1) {
      const result = performAction(state, "rest", forced);
      state = result.state;
      if (result.pendingEvent?.id === "qiu-rest-guest") {
        guest = result.pendingEvent;
        break;
      }
    }

    expect(guest, "带 mercy 连休 80 季仍抽不到「同穴之客」").not.toBeNull();
    if (!guest) return;
    const eligible = eligibleChoiceIdxs(state, guest, forced);
    expect(eligible.length).toBeGreaterThan(0);
    const after = resolveChoice(state, guest, eligible[0] ?? 0, forced).state;
    expect(after.records.some((record) => record.refId === "qiu-rest-guest")).toBe(true);
  });

  it("打印一份平衡快照（不断言，给 B4／B5 调参看）", () => {
    const byEnding = (["starve", "slain", "oldage", "ascend"] as const)
      .map((ending) => `${ending} ${(rateOf(ending) * 100).toFixed(0)}%`)
      .join(" / ");
    const fired = new Set(LIVES.flatMap((life) => life.firedEventIds));
    const missing = EVENTS.filter((event) => !fired.has(event.id)).map((event) => event.id);
    console.log(
      [
        `[tale-content 冒烟] ${LIFE_COUNT} 世`,
        `结局：${byEnding}`,
        `平均寿数 ${mean(LIVES.map((life) => life.years)).toFixed(1)} 岁`,
        `平均蜕变 ${mean(LIVES.map((life) => life.molts)).toFixed(2)}`,
        `平均击杀 ${mean(LIVES.map((life) => life.kills)).toFixed(2)}`,
        `平均血统点 ${mean(LIVES.map((life) => life.bloodline)).toFixed(2)}`,
        `活过 8 岁 ${((LIVES.filter((life) => life.years >= 8).length / LIFE_COUNT) * 100).toFixed(0)}%`,
        `事件覆盖 ${fired.size}/${EVENTS.length}`,
        `未触发：${missing.join("、") || "无"}`,
      ].join("｜"),
    );
    expect(true).toBe(true);
  });
});
