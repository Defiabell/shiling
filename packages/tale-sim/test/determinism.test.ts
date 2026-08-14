import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  availableActions,
  combatAct,
  combatPreview,
  composeChronicle,
  createLife,
  eligibleChoiceIdxs,
  exploreDestinations,
  performAction,
  resolveChoice,
  stalkAct,
  stalkPreview,
  type ActionId,
  type BodyPart,
  type CombatAct,
  type StalkAct,
  type TaleContent,
  type TaleState,
} from "../src/index.js";
import {
  ENEMY_YE_ZHI,
  FIXTURE_CONTENT,
  FIXTURE_SEED_ID,
  contentWithoutEvents,
  makeContent,
} from "./fixtures.js";

/** 事件多一点的 content：让确定性回归尽量把各条分支都走到。 */
const BUSY = makeContent({ tuning: { eventChanceBase: 0.6 } });

/**
 * 搏杀的**固定剧本**（不看状态，只按步数轮转）——「乱来的打法」。
 *
 * [M1-P2] 从四个字符串换成四个 `CombatAct`：刻意混进换姿态与逃，好让确定性回归覆盖到
 * 「换姿态那一回合不出手」「逃失败继续打」这些分支。
 */
const COMBAT_SCRIPT: readonly CombatAct[] = [
  { kind: "bite", part: "throat" },
  { kind: "stance", to: "low" },
  { kind: "bite", part: "eye" },
  { kind: "flee" },
];

/**
 * 剧本 → 合法指令。
 *
 * 唯一的加工是「已经是这个姿态就改咬一口」：`combatAct` 对「换成当前姿态」抛错（那只是
 * 白费一回合，界面本来也不给这颗按钮），而按步数轮转的剧本迟早会撞上。仍是纯函数、
 * 完全确定 —— 它只读 `state.combat.stance`。
 */
function scriptedCombat(state: TaleState, step: number): CombatAct {
  const plan = COMBAT_SCRIPT[step % COMBAT_SCRIPT.length] ?? { kind: "bite", part: "throat" };
  if (plan.kind === "stance" && plan.to === (state.combat?.stance ?? "square")) {
    return { kind: "bite", part: "leg" };
  }
  return plan;
}

/**
 * 明理但不作弊的打法：只读 `combatPreview`（界面摆给玩家看的那些数）。
 *
 * 优先级链就是一份可执行的手感说明：它要走就咬腿拦住（否则整顿肉白丢）、撑不住了就逃、
 * 否则挑当前伤害最高的那一咬（守备会把它从咬喉赶到别处）。
 */
function decideCombat(state: TaleState, content: TaleContent): CombatAct {
  const preview = combatPreview(state, content);
  if (preview.enemyWillFlee) return { kind: "bite", part: "leg" };
  if (preview.roundsToLive <= 1 && preview.fleeChance >= 0.5) return { kind: "flee" };
  const best = [...preview.bites].sort((a, b) => b.damage.mid - a.damage.mid)[0];
  return { kind: "bite", part: (best?.part ?? "throat") as BodyPart };
}

/**
 * 追猎的**固定剧本**（不看状态，只按步数轮转）——「乱来的猎手」。
 *
 * 与 `huntOnly` 用的 `decideStalk`（明理猎手）分工：这一套刻意会在远处扑空、会顺风硬冲，
 * 好让确定性回归覆盖到 escaped／combat／exhausted 三条收束分支；那一套负责让猎物真的到嘴，
 * golden 才盖得到蜕变与击杀。
 */
const STALK_SCRIPT: readonly StalkAct[] = ["circle", "creep", "creep", "pounce"];

/**
 * 明理但不作弊的猎手：只读 `stalkPreview`（界面上玩家看得见的那些数），不碰引擎内部。
 *
 * 它同时是一份**可执行的手感说明**：一个懂规则的人会先绕到上风，再一步步逼近，
 * 到七成命中率就出手，贴身而警觉过高时宁可屏息一次 —— 若这套打法的成功率不好看，
 * 那就是数值该调，而不是玩家该更聪明。
 */
function decideStalk(state: TaleState, content: TaleContent): StalkAct {
  const preview = stalkPreview(state, content);
  if (preview.staminaLeft <= 1) return "pounce";
  if (preview.pounceChance >= 0.7) return "pounce";
  if (!preview.alreadyUpwind && preview.staminaLeft >= 3) return "circle";
  if (preview.creepGain > 0 && preview.pounceChanceAfterCreep > preview.pounceChance) return "creep";
  if (preview.waitAlertDrop > 0) return "wait";
  return "pounce";
}

/**
 * [S2] 「往哪走」的**完全确定**策略：在开得了的去处里按回合数轮转。
 *
 * 轮转而不是「恒去第一处」：确定性回归的价值在于**覆盖分支**，而恒去兽径会让路费、
 * 遇袭、以及带门槛去处的整条路径一次都走不到（那正是这一批新加的东西）。
 * 非探索行动一律返回 `undefined` —— 引擎对「非探索却给了去处」抛错，这里顺带钉住那条契约。
 */
function scriptedDestination(
  state: TaleState,
  content: TaleContent,
  action: ActionId,
  turn: number,
): { destinationId: string } | undefined {
  if (action !== "explore") return undefined;
  const open = exploreDestinations(state, content).filter((entry) => entry.unlocked);
  const picked = open[turn % Math.max(1, open.length)] ?? open[0];
  if (picked === undefined) throw new Error("确定性回归：一处去处都开不了");
  return { destinationId: picked.def.id };
}

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
  /*
   * 行动轮转用**独立**计数器（只在真正选了行动时 +1），战斗／追猎的脚本仍按 `step` 走。
   * 理由：M1-P1 后一次狩猎会花掉 2〜6 个 `step`，若行动仍按 `step % actions.length` 轮转，
   * 「猎→探→休」会被追猎的步数打乱成几乎全是狩猎 —— 机器玩家从此不休憩、两三岁就饿死，
   * golden 覆盖的一世从十来年缩到两年。这是**测试策略**被子系统步数污染，不是数值问题。
   */
  let turn = 0;
  while (state.alive && step < maxSteps) {
    if (state.combat) {
      const turn = combatAct(state, scriptedCombat(state, step), content);
      state = turn.state;
      log.push(...turn.roundLog);
      step += 1;
      continue;
    }
    if (state.stalk) {
      const act = STALK_SCRIPT[step % STALK_SCRIPT.length] ?? "creep";
      const turn = stalkAct(state, act, content);
      state = turn.state;
      log.push(...turn.roundLog);
      step += 1;
      continue;
    }
    const actions = availableActions(state, content);
    const action: ActionId = actions.includes("dormant")
      ? "dormant"
      : (actions[turn % actions.length] ?? "rest");
    const result = performAction(state, action, content, scriptedDestination(state, content, action, turn));
    state = result.state;
    log.push(...result.notices);
    if (result.moltResult) log.push(`molt:${result.moltResult.chosen.id}`);
    if (result.pendingEvent && state.alive) {
      const idxs = eligibleChoiceIdxs(state, result.pendingEvent, content);
      const pick = idxs[turn % idxs.length];
      if (pick !== undefined) {
        const chosen = resolveChoice(state, result.pendingEvent, pick, content);
        state = chosen.state;
        log.push(chosen.outcomeText);
      }
    }
    turn += 1;
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
  // M1-P1：一次狩猎现在要花 2〜6 步把追猎打完，同样的年数需要三四倍的步数
  maxSteps = 400,
): { state: TaleState; steps: number } {
  let state = createLife(seed, FIXTURE_SEED_ID, content);
  let step = 0;
  while (state.alive && step < maxSteps) {
    if (state.combat) {
      state = combatAct(state, decideCombat(state, content), content).state;
      step += 1;
      continue;
    }
    if (state.stalk) {
      state = stalkAct(state, decideStalk(state, content), content).state;
      step += 1;
      continue;
    }
    const action: ActionId = availableActions(state, content).includes("dormant")
      ? "dormant"
      : "hunt";
    state = performAction(state, action, content, scriptedDestination(state, content, action, step)).state;
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

  /*
   * ⚠️ 下面两条 golden 的数值被整批重掷过**三次**：
   * M1-P1（追猎屏把狩猎从一次掷骰换成状态机）、M1-P2（搏杀重做：每回合多了「守备＋意图＋
   * 意图旁白」三次抽取，且开战时也要摇一次）、以及 2026-08-13「每局不同」（`createLife`
   * 在最前面加了**两次**抽取：天时与出身 —— 于是每个已存种子的整条剧本从第一步就错开了）。
   * 三次都是**有意的破坏性变更**，不是漂移 —— 判据是三条都还成立：
   * ① 同种子同操作仍恒等（上一条测试）② 换种子仍有分岔 ③ 30 世仍全部收束得出列传。
   */
  // 下面两条是**golden 字面量**回归，不是「同进程跑两遍」那种自证式断言。
  // 它们钉的是抽取顺序本身：把 resolveHunt 里两次 cursor.next() 调换、或把 drawEvent
  // 的概率掷骰挪进/挪出分支，行为分布可能一模一样，但每个已存种子的剧本都被重掷 ——
  // 只有字面量能抓到这种漂移。**改动引擎的随机消耗顺序时这两条必红，届时要么改回去，
  // 要么确认是有意的破坏性变更再更新期望值。**
  it("golden：轮转策略下 3 个种子的终态逐字锁定", () => {
    const golden = [
      { seed: 20260811, steps: 26, rngState: 2284262403, year: 4, ending: "starve", organs: 1 },
      { seed: 1, steps: 15, rngState: 752141765, year: 3, ending: "starve", organs: 1 },
      { seed: 4242, steps: 16, rngState: 1383981676, year: 2, ending: "starve", organs: 1 },
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
    /*
     * 让野雉反扑：追猎失手即转搏杀 —— 否则这条 golden 覆盖不到击杀路径。
     * （M0 是 `huntFailCombatChance` 掷骰进战斗；M1-P1 改成由 `EnemyDef.retaliates` 决定，
     * 而 fixture 的野雉不反扑。这一改让「追猎失手 → 打赢 → 吞精气」整条链重新落在 golden 里。）
     */
    const quiet = contentWithoutEvents({
      enemies: FIXTURE_CONTENT.enemies.map((enemy) =>
        enemy.id === ENEMY_YE_ZHI ? { ...enemy, retaliates: true } : enemy,
      ),
    });
    const golden = [
      {
        seed: 20260811,
        steps: 96,
        rngState: 3021251567,
        year: 6,
        organIds: ["organ-ling-yun", "ji-zu", "gou-chi", "lin-jia"],
        molts: 3,
        kills: 5,
      },
      {
        seed: 7,
        steps: 119,
        rngState: 785777768,
        year: 8,
        organIds: ["organ-ling-yun", "wu-mu", "ji-zu", "gou-chi", "lin-jia"],
        molts: 4,
        kills: 6,
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
    if (mid.stalk) {
      // 追猎中的 state 也必须是自描述的：四个量＋log 全在 TaleState 里，没有藏在闭包里的东西
      expect(stalkAct(revived, "creep", BUSY).state).toEqual(stalkAct(mid, "creep", BUSY).state);
    } else if (mid.combat) {
      const act = decideCombat(mid, BUSY);
      expect(combatAct(revived, act, BUSY).state).toEqual(combatAct(mid, act, BUSY).state);
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
      "destinations",
      "enemies",
      "events",
      "organs",
      "origins",
      "seeds",
      "sigils",
      "skies",
      "synergies",
      "tuning",
    ]);
    expect(FIXTURE_CONTENT.events).toHaveLength(3);
    // [2026-08-13] 开局变量：fixture 各一条且都无修正（见 fixtures.ts 的理由）
    expect(FIXTURE_CONTENT.skies).toHaveLength(1);
    expect(FIXTURE_CONTENT.origins).toHaveLength(1);
    expect(FIXTURE_CONTENT.organs).toHaveLength(4);
    expect(FIXTURE_CONTENT.enemies).toHaveLength(2);
    expect(FIXTURE_CONTENT.seeds).toHaveLength(1);
    // [S2] 两处去处：一处无门槛无兽（既有断言的基线），一处要疾足且是绝境
    expect(FIXTURE_CONTENT.destinations).toHaveLength(2);
  });
});
