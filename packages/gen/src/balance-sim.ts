/**
 * 平衡校验：用真引擎 ＋ 真内容跑 N 世，统计生死分布（B5 交付线第 5 条）。
 *
 * 与 `tale-content/test/smoke.test.ts` 的分工：冒烟测试跑 50 世、只断言三条护栏
 * （覆盖率白名单／平均蜕变 2〜4／饿死率 ≤60%），跑在每次 `pnpm test` 里所以必须快；
 * 本脚本是**调参台**：世数可调（默认 200）、指标铺开（蜕变分布、死因拆分、寿数分位、
 * 两种玩家画像对照），失败不是红灯而是给人看的数。
 *
 * 用法：
 *   pnpm -C packages/gen balance                # 200 世，谨慎玩家
 *   pnpm -C packages/gen balance -- --lives 500 --profile reckless
 *   pnpm -C packages/gen balance -- --json      # 只吐 JSON，便于对比两次调参
 *
 * 纪律：数值不达标只调 `tale-content/src/tuning.ts` 与事件 `effects`，**不改引擎**。
 */

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
  type EndingType,
  type TaleState,
} from "../../tale-sim/src/index.ts";
import { EVENTS, FLAG_SICK, FLAG_WOUND, SEED_CHANG_TAI, TALE_CONTENT } from "../../tale-content/src/index.ts";

/** 一世的操作上限（寿数 16〜20 岁≈80 回合，加战斗回合，600 足够宽） */
const MAX_STEPS = 600;

/**
 * 试参用的临时覆写：`--tune moltThreshold=72,initialStats.ti=26`。
 *
 * 只接受数字字段（含一层点号路径）。存在的意义是**别为了试一个数就去改 tuning.ts 再改回来**
 * —— 改文件试参会漏改回去，那种漂移最难发现。定下来的值才写进
 * `tale-content/src/tuning.ts`，脚本里不留任何默认覆写。
 */
function applyTuneOverrides(spec: string): typeof TALE_CONTENT {
  const tuning = { ...TALE_CONTENT.tuning } as unknown as Record<string, unknown>;
  for (const pair of spec.split(",")) {
    const [path, raw] = pair.split("=");
    const value = Number(raw);
    if (!path || !Number.isFinite(value)) throw new Error(`--tune 项写错：${pair}`);
    const segments = path.split(".");
    // 多于两段直接报错：`initialStats.ti.extra=5` 若静默按 `initialStats.ti=5` 落地，
    // 报告里的数字看着正常、其实调的不是你以为的那一项 —— 打错的 flag 静默被吞比失败危险
    if (segments.length > 2) throw new Error(`--tune 最多支持一层点号：${path}`);
    const [head, tail] = segments;
    if (!head || !(head in tuning)) throw new Error(`--tune 未知字段：${path}`);
    if (tail === undefined) {
      if (typeof tuning[head] !== "number") throw new Error(`--tune 只能改数字字段：${path}`);
      tuning[head] = value;
      continue;
    }
    const nested = tuning[head];
    if (typeof nested !== "object" || nested === null || !(tail in nested)) {
      throw new Error(`--tune 未知字段：${path}`);
    }
    tuning[head] = { ...(nested as Record<string, number>), [tail]: value };
  }
  return { ...TALE_CONTENT, tuning: tuning as unknown as typeof TALE_CONTENT.tuning };
}

let CONTENT = TALE_CONTENT;

/**
 * 抉择策略。三种画像，因为「平衡」对不同玩法是不同的数：
 *
 * - `cautious`：优先最后一个可选抉择 —— 本库的抉择顺序是「诱人／有门槛／稳妥」，
 *   末条基本是不冒险那条。这是**人会怎么玩**的近似（新玩家第一世多半更谨慎）。
 * - `reckless`：优先第一条（最诱人也最容易死），一世时长的下界。
 * - `random`：满足门槛的选项里等概率乱点 —— B2 冒烟用的那个画像，好把贪心分支都踩到。
 */
type Profile = "cautious" | "reckless" | "random";

interface Args {
  lives: number;
  profile: Profile;
  json: boolean;
  tune: string | null;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { lives: 200, profile: "cautious", json: false, tune: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--json") {
      args.json = true;
      continue;
    }
    if (flag === "--tune") {
      const value = argv[i + 1];
      if (value === undefined) throw new Error("--tune 需要形如 moltThreshold=72 的覆写串");
      args.tune = value;
      i += 1;
      continue;
    }
    if (flag === "--lives") {
      const value = Number.parseInt(argv[i + 1] ?? "", 10);
      if (!Number.isFinite(value) || value <= 0) throw new Error("--lives 需要一个正整数");
      args.lives = value;
      i += 1;
      continue;
    }
    if (flag === "--profile") {
      const value = argv[i + 1];
      if (value !== "cautious" && value !== "reckless" && value !== "random") {
        throw new Error("--profile 只能是 cautious｜reckless｜random");
      }
      args.profile = value;
      i += 1;
      continue;
    }
    // 打错的 flag 静默被吞比失败危险（B4 在 art:promote 上踩过一次）
    throw new Error(`未知参数：${flag}`);
  }
  return args;
}

/**
 * 一世要读多少字 —— 真人时长粗校的基数（B5 交付线第 7 条）。
 *
 * 分三类计，因为它们的阅读速度差别很大：
 * - `prose`：事件正文＋抉择结果＋战斗与行动旁白，是**逐字读**的部分；
 * - `options`：抉择标签与门槛提示，是**扫读＋比较**的部分（字少但耗决策时间）；
 * - `chronicle`：一世末尾那篇列传，读一遍就结束。
 */
interface CharCount {
  prose: number;
  options: number;
  chronicle: number;
}

interface LifeSummary {
  ending: EndingType;
  years: number;
  molts: number;
  kills: number;
  organCount: number;
  bloodline: number;
  steps: number;
  /** 决策次数：事件抉择／行动选择／战斗指令，分别有不同的思考成本 */
  decisions: { event: number; action: number; combat: number };
  chars: CharCount;
  /** slain 的两种来源：战斗致死（死亡记录带击杀者 refId）与事件直杀 */
  slainBy: "combat" | "event" | null;
  firedEventIds: string[];
  chronicleChars: number;
}

/**
 * 明理但不作弊的行动策略。
 *
 * ⚠️ 与 B2 冒烟测试那一版有一处**关键修正**：原版是「带伤就休」，而 `restHealFlags` 只治
 * `sick` 不治 `wound`（那是内容侧刻意的分工），于是一旦挂上 `wound`，休憩既治不好伤、
 * 又把饱食顶在 45 以上让「饿了就猎」永不触发 —— 策略陷入**无限休憩**：不猎不探、不吃精气、
 * 一世零蜕变。实测这就是「一世未蜕形 40%」的主因，是策略的缺陷而不是数值的缺陷。
 * 修法是**每次伤病最多歇两季**（不是「连续两季」——那样会退化成休憩两季干一季的循环，
 * 一世一半的回合都在睡）：歇过还没好就带着伤过日子，内容里有专门的疗伤事件。
 */
function decideAction(
  state: TaleState,
  actions: readonly ActionId[],
  roll: () => number,
  restsThisInjury: number,
): ActionId {
  if (actions.includes("dormant")) return "dormant";
  const hurt = state.flags.includes(FLAG_WOUND) || state.flags.includes(FLAG_SICK);
  if (state.hunger <= 50) return "hunt";
  if (hurt && restsThisInjury < 2) return "rest";
  if (state.hunger >= 70) return "explore";
  return roll() < 0.5 ? "hunt" : "explore";
}

function isHurt(state: TaleState): boolean {
  return state.flags.includes(FLAG_WOUND) || state.flags.includes(FLAG_SICK);
}

function decideCombat(state: TaleState, roll: () => number): "fight" | "flee" | "feint" | "organ" {
  const combat = state.combat;
  if (!combat) throw new Error("decideCombat: 不在战斗中");
  if (combat.playerHp <= state.stats.ti * 0.35) return "flee";
  if (combat.round === 0 && roll() < 0.3) return "feint";
  return combatSkillOrgan(state, CONTENT) ? "organ" : "fight";
}

function pickChoice(eligible: readonly number[], profile: Profile, roll: () => number): number {
  const last = eligible[eligible.length - 1] ?? 0;
  const first = eligible[0] ?? 0;
  if (profile === "cautious") return last;
  if (profile === "reckless") return first;
  return eligible[Math.floor(roll() * eligible.length)] ?? first;
}

function runLife(seed: number, profile: Profile): LifeSummary {
  // 策略自己的随机源与引擎的 rngState 分开，互不污染（同 seed 仍完全可复现）
  const cursor = createCursor(seed ^ 0x5f3759df);
  const roll = (): number => cursor.next();
  const fired = new Set<string>();

  let state = createLife(seed, SEED_CHANG_TAI, CONTENT);
  let steps = 0;
  let restsThisInjury = 0;
  const decisions = { event: 0, action: 0, combat: 0 };
  const chars: CharCount = { prose: 0, options: 0, chronicle: 0 };

  while (state.alive && steps < MAX_STEPS) {
    steps += 1;
    if (state.combat) {
      decisions.combat += 1;
      const round = combatAct(state, decideCombat(state, roll), CONTENT);
      chars.prose += round.roundLog.join("").length;
      state = round.state;
      continue;
    }
    if (!isHurt(state)) restsThisInjury = 0;
    const action = decideAction(state, availableActions(state, CONTENT), roll, restsThisInjury);
    if (action === "rest") restsThisInjury += 1;
    decisions.action += 1;
    const turn = performAction(state, action, CONTENT);
    chars.prose += turn.notices.join("").length;
    state = turn.state;
    const event = turn.pendingEvent;
    if (!event || !state.alive) continue;
    const eligible = eligibleChoiceIdxs(state, event, CONTENT);
    if (eligible.length === 0) throw new Error(`事件 ${event.id} 无可选抉择`);
    decisions.event += 1;
    chars.prose += event.title.length + event.body.length;
    // 玩家会把每个抉择都看一遍（含点不了的那些 —— 那正是「欲望展示位」的用处）
    chars.options += event.choices.reduce((sum, choice) => sum + choice.label.length, 0);
    const outcome = resolveChoice(state, event, pickChoice(eligible, profile, roll), CONTENT);
    chars.prose += outcome.outcomeText.length;
    state = outcome.state;
    fired.add(event.id);
  }

  if (state.alive || state.ending === null) throw new Error(`seed ${seed} 跑满 ${MAX_STEPS} 步仍未收束`);
  // 不用 findLast：gen 的 tsconfig 没开 ES2023 lib（这里只是脚本，不为一个方法去动编译配置）
  const deaths = state.records.filter((record) => record.kind === "death");
  const death = deaths[deaths.length - 1];
  const chronicle = composeChronicle(state, CONTENT);
  chars.chronicle = chronicle.body.length;
  return {
    decisions,
    chars,
    ending: state.ending,
    years: state.year,
    molts: state.records.filter((record) => record.kind === "molt").length,
    kills: state.records.filter((record) => record.kind === "combat").length,
    organCount: state.organIds.length,
    bloodline: bloodlineGain(state),
    steps,
    slainBy: state.ending !== "slain" ? null : death?.refId === undefined ? "event" : "combat",
    firedEventIds: [...fired],
    chronicleChars: chronicle.body.length,
  };
}

/**
 * 真人一世时长的估算模型（B5 交付线第 7 条「一世真人时长粗校」）。
 *
 * 不是猜的：字数与决策次数来自上面 200 世的实跑，速率是两档公开常识值 —— 中文带理解的
 * 阅读速度约 300〜400 字/分（取 350），扫读抉择列表约 500 字/分；决策时间按「事件抉择
 * 12 秒／行动 4 秒／战斗指令 3 秒」计（事件是要权衡代价的那种选择，行动是习惯性点击）。
 * 演出（水墨浮现 0.6s×回合、蜕变开奖约 6s、死亡链约 12s）单列。
 *
 * 两档速率给出区间：慢读者（250 字/分、决策 ×1.6）与快读者（450 字/分、决策 ×0.6）。
 */
function estimateMinutes(life: LifeSummary, pace: "slow" | "mid" | "fast"): number {
  const readCpm = pace === "slow" ? 250 : pace === "mid" ? 350 : 450;
  const scanCpm = readCpm * 1.4;
  const decisionMul = pace === "slow" ? 1.6 : pace === "mid" ? 1 : 0.6;
  const readMin = (life.chars.prose + life.chars.chronicle) / readCpm + life.chars.options / scanCpm;
  const decideSec =
    (life.decisions.event * 12 + life.decisions.action * 4 + life.decisions.combat * 3) * decisionMul;
  const fxSec = life.decisions.action * 0.6 + life.molts * 6 + 12;
  return readMin + (decideSec + fxSec) / 60;
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[idx] as number;
}

function pct(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10;
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  if (args.tune !== null) CONTENT = applyTuneOverrides(args.tune);
  const lives = Array.from({ length: args.lives }, (_, index) => runLife(1000 + index * 7919, args.profile));

  const rate = (ending: EndingType): number => pct(lives.filter((life) => life.ending === ending).length, lives.length);
  const years = lives.map((life) => life.years);
  const molts = lives.map((life) => life.molts);
  const moltHistogram: Record<string, number> = {};
  for (const life of lives) {
    const key = life.molts >= 6 ? "6+" : String(life.molts);
    moltHistogram[key] = (moltHistogram[key] ?? 0) + 1;
  }
  const fired = new Set(lives.flatMap((life) => life.firedEventIds));
  const missing = EVENTS.filter((event) => !fired.has(event.id)).map((event) => event.id);

  const report = {
    lives: lives.length,
    profile: args.profile,
    endings: {
      starve: rate("starve"),
      slain: rate("slain"),
      oldage: rate("oldage"),
      ascend: rate("ascend"),
    },
    slainSplit: {
      combat: pct(lives.filter((life) => life.slainBy === "combat").length, lives.length),
      event: pct(lives.filter((life) => life.slainBy === "event").length, lives.length),
    },
    years: {
      mean: Math.round(mean(years) * 10) / 10,
      p10: quantile(years, 0.1),
      median: quantile(years, 0.5),
      p90: quantile(years, 0.9),
      max: Math.max(...years),
    },
    survivedTo8: pct(lives.filter((life) => life.years >= 8).length, lives.length),
    /**
     * 三岁前就没的那一撮 —— 它是「首世体验」的真正风险：owner 只玩一世，若落在这里
     * 他连蜕变开奖都没见过就到列传了。所以单列出来，并拆成饿死／战死看该动哪个旋钮。
     */
    earlyDeath: {
      before3: pct(lives.filter((life) => life.years < 3).length, lives.length),
      starve: pct(lives.filter((life) => life.years < 3 && life.ending === "starve").length, lives.length),
      slain: pct(lives.filter((life) => life.years < 3 && life.ending === "slain").length, lives.length),
    },
    zeroMolt: pct(lives.filter((life) => life.molts === 0).length, lives.length),
    molts: { mean: Math.round(mean(molts) * 100) / 100, histogram: moltHistogram },
    kills: { mean: Math.round(mean(lives.map((life) => life.kills)) * 100) / 100 },
    bloodline: { mean: Math.round(mean(lives.map((life) => life.bloodline)) * 100) / 100 },
    turnsPerLife: { mean: Math.round(mean(lives.map((life) => life.steps))) },
    chronicleChars: { mean: Math.round(mean(lives.map((life) => life.chronicleChars))) },
    /** 一世要读的字数与决策次数（真人时长估算的基数） */
    reading: {
      proseChars: Math.round(mean(lives.map((life) => life.chars.prose))),
      optionChars: Math.round(mean(lives.map((life) => life.chars.options))),
      chronicleChars: Math.round(mean(lives.map((life) => life.chars.chronicle))),
      eventDecisions: Math.round(mean(lives.map((life) => life.decisions.event))),
      actionDecisions: Math.round(mean(lives.map((life) => life.decisions.action))),
      combatDecisions: Math.round(mean(lives.map((life) => life.decisions.combat))),
      minutesSlow: Math.round(mean(lives.map((life) => estimateMinutes(life, "slow")))),
      minutesMid: Math.round(mean(lives.map((life) => estimateMinutes(life, "mid")))),
      minutesFast: Math.round(mean(lives.map((life) => estimateMinutes(life, "fast")))),
      minutesMidP90: Math.round(quantile(lives.map((life) => estimateMinutes(life, "mid")), 0.9)),
    },
    eventCoverage: `${fired.size}/${EVENTS.length}`,
    missingEvents: missing,
    targets: {
      "活过 8 岁 ≥60%": pct(lives.filter((life) => life.years >= 8).length, lives.length) >= 60,
      "平均蜕变 2〜4": mean(molts) >= 2 && mean(molts) <= 4,
      "登神率 <2%": rate("ascend") < 2,
    },
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }

  console.log(`[平衡] ${report.lives} 世 · 玩家画像 ${report.profile}${args.tune ? ` · 覆写 ${args.tune}` : ""}`);
  console.log(
    `结局：饿死 ${report.endings.starve}% / 战死 ${report.endings.slain}%（战斗 ${report.slainSplit.combat}% ＋事件直杀 ${report.slainSplit.event}%） / 寿终 ${report.endings.oldage}% / 登神 ${report.endings.ascend}%`,
  );
  console.log(
    `寿数：均 ${report.years.mean} 岁（p10 ${report.years.p10}／中位 ${report.years.median}／p90 ${report.years.p90}／最长 ${report.years.max}）`,
  );
  console.log(`活过 8 岁：${report.survivedTo8}%　平均蜕变 ${report.molts.mean}　平均击杀 ${report.kills.mean}　平均血统点 ${report.bloodline.mean}`);
  console.log(
    `三岁前夭折：${report.earlyDeath.before3}%（饿 ${report.earlyDeath.starve}% ／战 ${report.earlyDeath.slain}%）　一世未蜕形：${report.zeroMolt}%`,
  );
  console.log(`蜕变分布：${JSON.stringify(report.molts.histogram)}`);
  console.log(`一世回合数：均 ${report.turnsPerLife.mean}　列传字数：均 ${report.chronicleChars.mean}`);
  console.log(
    `一世阅读量：正文 ${report.reading.proseChars} 字 ＋抉择 ${report.reading.optionChars} 字 ＋列传 ${report.reading.chronicleChars} 字；` +
      `决策 事件 ${report.reading.eventDecisions}／行动 ${report.reading.actionDecisions}／战斗 ${report.reading.combatDecisions}`,
  );
  console.log(
    `估算真人时长：慢 ${report.reading.minutesSlow} 分／中 ${report.reading.minutesMid} 分（p90 ${report.reading.minutesMidP90} 分）／快 ${report.reading.minutesFast} 分　（设计目标 60〜180 分）`,
  );
  console.log(`事件覆盖：${report.eventCoverage}　未触发：${report.missingEvents.join("、") || "无"}`);
  for (const [name, ok] of Object.entries(report.targets)) console.log(`${ok ? "✓" : "✗"} ${name}`);
  return Object.values(report.targets).every(Boolean) ? 0 : 1;
}

process.exitCode = main();
