import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  availableActions,
  combatAct,
  composeChronicle,
  createLife,
  eligibleChoiceIdxs,
  performAction,
  resolveChoice,
  type ActionId,
  type TaleContent,
  type TaleState,
} from "../src/index.js";
import {
  FIXTURE_CONTENT,
  FIXTURE_SEED_ID,
  contentWithoutEvents,
  makeContent,
} from "./fixtures.js";

/** 事件多一点的 content：让确定性回归尽量把各条分支都走到。 */
const BUSY = makeContent({ tuning: { eventChanceBase: 0.6 } });

const COMBAT_SCRIPT = ["fight", "feint", "fight", "flee"] as const;

/**
 * 用**完全确定的策略**打完一世（不掷骰选行动，只按步数轮转），
 * 于是唯一的随机来源就是 state.rngState —— 正好可以拿来做确定性回归。
 */
function playLife(
  seed: number,
  content: TaleContent,
  maxSteps = 80,
): { state: TaleState; log: string[]; steps: number } {
  let state = createLife(seed, FIXTURE_SEED_ID, content);
  const log: string[] = [];
  let step = 0;
  while (state.alive && step < maxSteps) {
    if (state.combat) {
      const act = COMBAT_SCRIPT[step % COMBAT_SCRIPT.length] ?? "fight";
      const turn = combatAct(state, act, content);
      state = turn.state;
      log.push(...turn.roundLog);
      step += 1;
      continue;
    }
    const actions = availableActions(state, content);
    const action: ActionId = actions.includes("dormant")
      ? "dormant"
      : (actions[step % actions.length] ?? "rest");
    const turn = performAction(state, action, content);
    state = turn.state;
    log.push(...turn.notices);
    if (turn.moltResult) log.push(`molt:${turn.moltResult.chosen.id}`);
    if (turn.pendingEvent && state.alive) {
      const idxs = eligibleChoiceIdxs(state, turn.pendingEvent, content);
      const pick = idxs[step % idxs.length];
      if (pick !== undefined) {
        const result = resolveChoice(state, turn.pendingEvent, pick, content);
        state = result.state;
        log.push(result.outcomeText);
      }
    }
    step += 1;
  }
  return { state, log, steps: step };
}

/**
 * 第二套完全确定的策略：一路狩猎、能蛰伏就蛰伏、战斗死磕。
 * 存在的意义是让 golden 覆盖到蜕变与击杀 —— `playLife` 的轮转策略精气攒不够，
 * 一世下来一次都不蜕变。
 */
function huntOnly(
  seed: number,
  content: TaleContent,
  maxSteps = 120,
): { state: TaleState; steps: number } {
  let state = createLife(seed, FIXTURE_SEED_ID, content);
  let step = 0;
  while (state.alive && step < maxSteps) {
    if (state.combat) {
      state = combatAct(state, "fight", content).state;
      step += 1;
      continue;
    }
    const action: ActionId = availableActions(state, content).includes("dormant")
      ? "dormant"
      : "hunt";
    state = performAction(state, action, content).state;
    step += 1;
  }
  return { state, steps: step };
}

describe("确定性回归", () => {
  it("同种子＋同操作序列 → 同终态", () => {
    for (const seed of [1, 20260811, 777777, 0xdeadbeef]) {
      const a = playLife(seed, BUSY);
      const b = playLife(seed, BUSY);
      expect(a.state).toEqual(b.state);
      expect(a.log).toEqual(b.log);
      expect(a.steps).toBe(b.steps);
    }
  });

  // ⚠️ 下面两条是**golden 字面量**回归，不是「同进程跑两遍」那种自证式断言。
  // 它们钉的是抽取顺序本身：把 resolveHunt 里两次 cursor.next() 调换、或把 drawEvent
  // 的概率掷骰挪进/挪出分支，行为分布可能一模一样，但每个已存种子的剧本都被重掷 ——
  // 只有字面量能抓到这种漂移。**改动引擎的随机消耗顺序时这两条必红，届时要么改回去，
  // 要么确认是有意的破坏性变更再更新期望值。**
  it("golden：轮转策略下 3 个种子的终态逐字锁定", () => {
    const golden = [
      { seed: 20260811, steps: 32, rngState: 892708669, year: 7, ending: "starve", organs: 1 },
      { seed: 1, steps: 59, rngState: 3264331845, year: 12, ending: "starve", organs: 1 },
      { seed: 4242, steps: 18, rngState: 120310336, year: 4, ending: "starve", organs: 1 },
    ] as const;
    for (const expected of golden) {
      const { state, steps } = playLife(expected.seed, BUSY);
      expect({
        seed: expected.seed,
        steps,
        rngState: state.rngState,
        year: state.year,
        ending: state.ending,
        organs: state.organIds.length,
      }).toEqual(expected);
    }
  });

  it("golden：狩猎流策略锁定蜕变与击杀路径", () => {
    const quiet = contentWithoutEvents();
    const golden = [
      {
        seed: 20260811,
        steps: 37,
        rngState: 260872999,
        year: 7,
        organIds: ["organ-ling-yun", "ji-zu", "lin-jia", "gou-chi"],
        molts: 3,
        kills: 3,
      },
      {
        seed: 7,
        steps: 35,
        rngState: 2576131284,
        year: 8,
        organIds: ["organ-ling-yun", "wu-mu", "gou-chi", "lin-jia"],
        molts: 3,
        kills: 0,
      },
    ] as const;
    for (const expected of golden) {
      const { state, steps } = huntOnly(expected.seed, quiet);
      expect({
        seed: expected.seed,
        steps,
        rngState: state.rngState,
        year: state.year,
        organIds: state.organIds,
        molts: state.records.filter((record) => record.kind === "molt").length,
        kills: state.records.filter((record) => record.kind === "combat").length,
      }).toEqual(expected);
    }
  });

  it("换种子会得到不同的一世（不是恒定剧本）", () => {
    const outcomes = new Set<string>();
    for (let seed = 0; seed < 12; seed += 1) {
      const { state, steps } = playLife(seed * 8191 + 17, BUSY);
      outcomes.add(`${state.ending ?? "alive"}|${state.year}|${state.organIds.length}|${steps}`);
    }
    expect(outcomes.size).toBeGreaterThan(3);
  });

  it("state 是完整自描述的：JSON 往返后续跑结果一致", () => {
    const mid = playLife(31337, BUSY, 20).state;
    const revived = JSON.parse(JSON.stringify(mid)) as TaleState;
    if (mid.combat) {
      expect(combatAct(revived, "fight", BUSY).state).toEqual(combatAct(mid, "fight", BUSY).state);
    } else if (mid.alive) {
      const action = availableActions(mid, BUSY)[0] ?? "rest";
      expect(performAction(revived, action, BUSY).state).toEqual(
        performAction(mid, action, BUSY).state,
      );
    }
    expect(revived).toEqual(mid);
  });

  it("同一 state 反复调用同一函数结果恒等（无隐藏可变状态）", () => {
    const life = createLife(4242, FIXTURE_SEED_ID, BUSY);
    const first = performAction(life, "hunt", BUSY);
    const second = performAction(life, "hunt", BUSY);
    expect(first.state).toEqual(second.state);
    expect(first.notices).toEqual(second.notices);
    expect(first.pendingEvent?.id).toBe(second.pendingEvent?.id);
  });

  it("跑满一世能收束到某个结局并出得了列传", () => {
    let finished = 0;
    for (let seed = 0; seed < 30; seed += 1) {
      const { state } = playLife(seed * 65537 + 3, BUSY, 200);
      if (!state.alive && state.ending) {
        finished += 1;
        const entry = composeChronicle(state, BUSY);
        expect(entry.title.length).toBeGreaterThan(0);
        expect(entry.body).toContain("赞曰：");
        expect(entry.ending).toBe(state.ending);
      }
    }
    // 200 步（≈50 年）远超 fixture 的寿数上限，理应全部收束
    expect(finished).toBe(30);
  });
});

describe("禁用 API 纪律（源码扫描）", () => {
  const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

  /** 只扫**代码**：注释里为了讲清纪律必然会提到 Math.random / localStorage 这些词。 */
  const stripComments = (text: string): string =>
    text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  const sources = readdirSync(srcDir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => ({ name, text: stripComments(readFileSync(join(srcDir, name), "utf8")) }));

  it("扫到了源文件（防止扫描本身空转）", () => {
    expect(sources.length).toBeGreaterThanOrEqual(5);
    // 去注释后仍应剩下实打实的代码
    for (const { name, text } of sources) {
      expect(text.length, `${name} 去注释后为空`).toBeGreaterThan(100);
    }
  });

  it("src/ 里没有 Math.random / Date / performance.now", () => {
    for (const { name, text } of sources) {
      expect(text, `${name} 含 Math.random`).not.toMatch(/Math\.random/);
      expect(text, `${name} 含 Date`).not.toMatch(/\bDate\s*\.|new\s+Date\b/);
      expect(text, `${name} 含 performance.now`).not.toMatch(/performance\s*\.\s*now/);
    }
  });

  it("src/ 里没有 DOM / 浏览器全局", () => {
    for (const { name, text } of sources) {
      expect(text, `${name} 含 document`).not.toMatch(/\bdocument\b/);
      expect(text, `${name} 含 window`).not.toMatch(/\bwindow\b/);
      expect(text, `${name} 含 localStorage`).not.toMatch(/\blocalStorage\b/);
    }
  });

  it("src/ 里没有 import 3D 版 sim/content 包", () => {
    for (const { name, text } of sources) {
      expect(text, `${name} import 了 @shiling/sim`).not.toMatch(/@shiling\/(sim|content|client)/);
      expect(text, `${name} 跨包相对 import`).not.toMatch(/from\s+"\.\.\/\.\.\//);
    }
  });

  it("fixture 与真内容形状一致（B2 交接的形状契约）", () => {
    expect(Object.keys(FIXTURE_CONTENT).sort()).toEqual([
      "chronicleTemplates",
      "enemies",
      "events",
      "organs",
      "seeds",
      "tuning",
    ]);
    expect(FIXTURE_CONTENT.events).toHaveLength(3);
    expect(FIXTURE_CONTENT.organs).toHaveLength(4);
    expect(FIXTURE_CONTENT.enemies).toHaveLength(2);
    expect(FIXTURE_CONTENT.seeds).toHaveLength(1);
  });
});
