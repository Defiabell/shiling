/**
 * 史官实验台 —— 用真引擎跑完整的一世，再让 AI 史官作传，把三篇列传与账单打在终端上。
 *
 * 存在的理由：调 prompt 需要**快而真**的循环。在浏览器里玩一世要一分钟，而这里几毫秒就
 * 跑完一世（同一个 `tale-sim` ＋ 同一份 `tale-content`，只是把「谁按按钮」换成脚本）。
 * 它不是 mock：状态、记录、结局、成道判定全部来自引擎，与玩家打出来的那一世同源。
 *
 * 用法（在 packages/tale-ai 下）：
 *   pnpm lab                      # 找齐寿终／横死／成道三世，各作一传
 *   pnpm lab -- --model litellm/gpt-latest
 *   pnpm lab -- --search 400      # 只搜种子，报各结局的分布，不调用网关（不花钱）
 *   pnpm lab -- --cache           # 允许命中网关缓存（省钱，但延迟数字作废）
 *   pnpm lab -- --out ../../.superpowers/sdd/xxx/lives.json
 *
 * ## 为什么默认 `cache: {"no-cache": true}`
 * 这个台子存在的理由是**量延迟**，而网关会缓存整发请求：实测同一发命中前 1.75s、命中后
 * 0.99s，body 里还没有任何命中标志（唯一判据是响应头 `x-litellm-cache-key`，已记进
 * `stat.cacheHit`）。拿命中的数选型必然选错，所以默认每发都绕开缓存。
 *
 * ⚠️ 绕缓存**不要靠改 temperature**（本台一度这么干）：`gpt-5.5`／`gpt-5.6`／`Kimi-latest`
 * 只收 temperature=1，非默认值直接 400 `unsupported_value`，一改就整批打不通 —— 而且每发
 * 都会给 key owner 推一条网关告警。`no-cache` 不动 prompt 也不动参数，测的才是同一发请求。
 *
 * 密钥从 `envs/aigw.env` 读（逐级上找），只塞进请求头，**不打印、不写进产物**。
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  availableActions,
  combatAct,
  combatPreview,
  recommendCombatAct,
  composeChronicle,
  createCursor,
  createLife,
  eligibleChoiceIdxs,
  exploreDestinations,
  performAction,
  resolveChoice,
  stalkAct,
  stalkPreview,
  waysProgress,
  type ActionId,
  type BodyPart,
  type CombatAct,
  type EndingType,
  type StalkAct,
  type TaleEvent,
  type TaleContent,
  type TaleState,
} from "@shiling/tale-sim";
import { SEED_CHANG_TAI, TALE_CONTENT } from "@shiling/tale-content";
import { writeChronicle } from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTENT = TALE_CONTENT;
const MAX_STEPS = 900;

// ===== 机器玩家：三种画像，对应三种要验收的收束 =====

/**
 * `plain` 想活着（多半寿终或饿殍）／`brute` 见谁打谁（多半横死）／`saint` 奔归山
 * （长寿厚德 —— 四条道里最够得着的一条）。
 *
 * 与 `packages/gen/src/balance-sim.ts` 的机器玩家是**同一套判据的精简版**（只读
 * `stalkPreview`／`combatPreview` 这些界面也看得到的数）。刻意不去 import 那个脚本：
 * 它是个带 main() 的命令行程序，import 进来会顺手跑一遍二百世。
 */
type Profile = "plain" | "brute" | "saint";

function decideAction(state: TaleState, actions: readonly ActionId[], profile: Profile, roll: () => number): ActionId {
  if (actions.includes("dormant")) return "dormant";
  const hurt = state.flags.includes("wound") || state.flags.includes("sick");
  if (state.hunger <= 50) return "hunt";
  if (hurt && profile !== "brute") return "rest";
  if (profile === "brute") return roll() < 0.8 ? "hunt" : "explore";
  if (profile === "saint") return state.hunger <= 70 ? "hunt" : roll() < 0.35 ? "rest" : "explore";
  return state.hunger >= 70 ? "explore" : roll() < 0.5 ? "hunt" : "explore";
}

function decideStalk(state: TaleState, profile: Profile): StalkAct {
  const preview = stalkPreview(state, CONTENT);
  const stalk = state.stalk;
  if (!stalk) throw new Error("decideStalk: 不在追猎中");
  if (preview.staminaLeft <= 1) return "pounce";
  if (profile === "brute") return stalk.distance > 0 ? "creep" : "pounce";
  if (!preview.alreadyUpwind && preview.staminaLeft >= 4) return "circle";
  if (preview.pounceChance >= 0.7) return "pounce";
  if (preview.creepGain > 0 && preview.pounceChanceAfterCreep >= preview.pounceChance) return "creep";
  if (preview.waitAlertDrop > 0) return "wait";
  return "pounce";
}

function decideCombat(state: TaleState, profile: Profile): CombatAct {
  const preview = combatPreview(state, CONTENT);
  if (profile === "brute") {
    // 莽夫：有技就放（不看局面）—— 与 `screen` 那一支的分工是「它不读屏幕」
    const skill = preview.skills.find((item) => item.ready);
    if (skill) return { kind: "skill", skillId: skill.skillId };
    const best = [...preview.bites].sort((a, b) => b.damage.mid - a.damage.mid)[0];
    return { kind: "bite", part: (best?.part ?? "throat") as BodyPart };
  }
  // [S1] 明理那一支直接用引擎导出的推荐链（＝玩家屏幕上发金光的那一手）。
  // 此前是手抄镜像，S1 重命名 `organId → skillId` 时漏改，两个 lab 当场崩
  // （`combatAct: 没有这个技 undefined`）—— 手抄的第四份就是这么埋的。
  return recommendCombatAct(preview);
}

/** 抉择打分：`saint` 攒德与寿，`brute` 攒猛与夺命，`plain` 求稳（不挑送死那条）。 */
function pickChoice(event: TaleEvent, eligible: readonly number[], profile: Profile, roll: () => number): number {
  let bestIdx = eligible[0] ?? 0;
  let bestScore = -Infinity;
  for (const idx of eligible) {
    const choice = event.choices[idx];
    if (!choice) continue;
    let score = 0;
    for (const outcome of choice.outcomes) {
      const effects = outcome.effects;
      const stats = effects.stats ?? {};
      const weight = outcome.weight;
      if (profile === "saint") {
        score += weight * ((stats.de ?? 0) * 3 + (effects.lifespan ?? 0) * 20 + (stats.ti ?? 0));
      } else if (profile === "brute") {
        score += weight * ((stats.meng ?? 0) * 3 + (effects.takesLife ?? 0) * 4);
      } else {
        score += weight * ((effects.hunger ?? 0) * 0.2 + (stats.ling ?? 0) + (stats.de ?? 0));
      }
      // 「应命而升」这类直接成道的抉择必挑；送死的一律不挑
      if (effects.die === "ascend") score += weight * 1000;
      else if (effects.die !== undefined) score -= weight * 400;
    }
    score += roll() * 0.01;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  }
  return bestIdx;
}

function playLife(seed: number, profile: Profile): TaleState {
  const cursor = createCursor(seed ^ 0x5f3759df);
  const roll = (): number => cursor.next();
  let state = createLife(seed, SEED_CHANG_TAI, CONTENT);
  let steps = 0;
  while (state.alive && steps < MAX_STEPS) {
    steps += 1;
    if (state.combat) {
      state = combatAct(state, decideCombat(state, profile), CONTENT).state;
      continue;
    }
    if (state.stalk) {
      state = stalkAct(state, decideStalk(state, profile), CONTENT).state;
      continue;
    }
    const action = decideAction(state, availableActions(state, CONTENT), profile, roll);
    // [S2] 探索要指定去处：这两个 lab 只关心「文案够不够多」，所以恒去开得了的最深一处
    // （深处的事件池是这一批新写的，量文案量的就该是它们）
    const turn = performAction(
      state,
      action,
      CONTENT,
      action === "explore" ? { destinationId: deepestOpen(state, CONTENT) } : undefined,
    );
    state = turn.state;
    const event = turn.pendingEvent;
    if (!event || !state.alive) continue;
    const eligible = eligibleChoiceIdxs(state, event, CONTENT);
    if (eligible.length === 0) throw new Error(`事件 ${event.id} 无可选抉择`);
    state = resolveChoice(state, event, pickChoice(event, eligible, profile, roll), CONTENT).state;
  }
  if (state.alive || state.ending === null) throw new Error(`seed ${seed} 跑满 ${MAX_STEPS} 步仍未收束`);
  return state;
}

// ===== 密钥与参数 =====

function findEnvFile(from: string): string | null {
  let dir = from;
  for (let depth = 0; depth < 9; depth += 1) {
    const candidate = join(dir, "envs", "aigw.env");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function loadKey(): { key: string; baseUrl: string } {
  const envKey = process.env.AIGW_API_KEY;
  if (envKey) return { key: envKey, baseUrl: process.env.AIGW_BASE_URL ?? "https://aigw.meshy.team/v1" };
  const file = findEnvFile(HERE);
  if (file === null) throw new Error("找不到 envs/aigw.env，也没有 AIGW_API_KEY");
  const parsed: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) parsed[trimmed.slice(0, eq)] = trimmed.slice(eq + 1).replace(/^["']|["']$/gu, "");
  }
  const key = parsed.AIGW_API_KEY;
  if (!key) throw new Error(`${file} 里没有 AIGW_API_KEY`);
  return { key, baseUrl: parsed.AIGW_BASE_URL ?? "https://aigw.meshy.team/v1" };
}

interface Args {
  model: string;
  search: number;
  out: string | null;
  seeds: number[] | null;
  /**
   * 只在「就是要测温度」时才动。**它不是绕缓存的旋钮**：多个网关模型只收 1，
   * 非默认值直接 400（见文件头）。绕缓存是 `cache` 那个字段的事。
   */
  temperature: number;
  /** 允许命中网关缓存。默认 false＝每发都 `no-cache`，因为本台量的是真实延迟 */
  cache: boolean;
  /** 实测台可以放宽预算：**量一个模型到底要多久**是选型的前提，客户端那 6s 才不是拍脑袋 */
  budgetMs: number;
  /** 传给网关的 `reasoning_effort`（选型时量「思考」值不值那几秒） */
  reasoning: string | null;
  /** 连打 N 世只报账（AI 命中率／延迟／成本的实测值就是它跑出来的） */
  batch: number;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    model: "litellm/gpt-5.4-mini-with-fallback",
    search: 0,
    out: null,
    seeds: null,
    temperature: 1,
    cache: false,
    budgetMs: 6000,
    reasoning: null,
    batch: 0,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--model" && value) args.model = value;
    if (flag === "--search" && value) args.search = Number(value);
    if (flag === "--out" && value) args.out = resolve(process.cwd(), value);
    if (flag === "--temperature" && value) args.temperature = Number(value);
    if (flag === "--budget" && value) args.budgetMs = Number(value);
    if (flag === "--reasoning" && value) args.reasoning = value;
    if (flag === "--cache") args.cache = true;
    if (flag === "--batch" && value) args.batch = Number(value);
    if (flag === "--seeds" && value) args.seeds = value.split(",").map(Number);
  }
  return args;
}

/** 找齐三种收束各一世：寿终／横死／成道。 */
function findLives(limit: number): { profile: Profile; seed: number; state: TaleState }[] {
  const want: Record<string, boolean> = { oldage: false, slain: false, ascend: false };
  const found: { profile: Profile; seed: number; state: TaleState }[] = [];
  const profiles: Profile[] = ["saint", "brute", "plain"];
  /*
   * **一个种子只收一世**。天时／出身／神种是按种子掷的，同一种子的三种画像共享同一套前提，
   * 于是三篇列传的开篇会说同一件事 —— 那样去回答「三篇是否雷同」就是在放水。
   */
  for (let seed = 20260813; seed < 20260813 + limit; seed += 1) {
    for (const profile of profiles) {
      const state = playLife(seed, profile);
      const key = state.ending as string;
      if (want[key] === false) {
        want[key] = true;
        found.push({ profile, seed, state });
        break;
      }
    }
    if (Object.values(want).every(Boolean)) break;
  }
  return found;
}

function tally(limit: number): void {
  const counts = new Map<string, number>();
  for (const profile of ["plain", "brute", "saint"] as Profile[]) {
    for (let seed = 20260813; seed < 20260813 + limit; seed += 1) {
      const state = playLife(seed, profile);
      const key = `${profile}/${state.ending}${state.wayAchieved ? `:${state.wayAchieved}` : ""}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  for (const [key, count] of [...counts].sort((a, b) => b[1] - a[1])) {
    console.log(`${key.padEnd(24)} ${count}`);
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.search > 0) {
    tally(args.search);
    return 0;
  }

  const { key, baseUrl } = loadKey();
  const profileOrder: Profile[] = ["saint", "brute", "plain"];
  const lives = args.batch > 0
    ? Array.from({ length: args.batch }, (_, index) => {
        const profile = profileOrder[index % 3] ?? "plain";
        const seed = 20260901 + index;
        return { profile, seed, state: playLife(seed, profile) };
      })
    : args.seeds
    ? args.seeds.map((seed, index) => ({
        profile: (["saint", "brute", "plain"] as Profile[])[index % 3] ?? "plain",
        seed,
        state: playLife(seed, (["saint", "brute", "plain"] as Profile[])[index % 3] ?? "plain"),
      }))
    : findLives(600);

  /*
   * `no-cache` 是默认项：本台量的是未缓存延迟，而网关缓存整发请求且 body 无标志。
   * `--cache` 只在「只想看文笔、不看数」时用。两个旋钮都往 `extraParams` 里塞 ——
   * 网关不认识的字段会被丢掉，所以对不支持缓存控制的后端也是安全的。
   */
  const extraParams: Record<string, unknown> = {};
  if (args.reasoning !== null) extraParams.reasoning_effort = args.reasoning;
  if (!args.cache) extraParams.cache = { "no-cache": true };

  const records: unknown[] = [];
  for (const life of lives) {
    const progress = waysProgress(life.state, CONTENT);
    const result = await writeChronicle({
      state: life.state,
      content: CONTENT,
      lifeKey: `lab:${life.seed}:${life.profile}`,
      options: {
        endpoint: `${baseUrl}/chat/completions`,
        model: args.model,
        temperature: args.temperature,
        budgetMs: args.budgetMs,
        headers: { authorization: `Bearer ${key}` },
        ...(Object.keys(extraParams).length > 0 ? { extraParams } : {}),
      },
    });
    const template = composeChronicle(life.state, CONTENT);

    console.log(`\n${"=".repeat(78)}`);
    console.log(
      `画像 ${life.profile}　种子 ${life.seed}　收束 ${life.state.ending}${life.state.wayAchieved ? `（${life.state.wayAchieved}）` : ""}　寿 ${life.state.year}　器官 ${life.state.organIds.length}　夺命 ${life.state.livesTaken}`,
    );
    console.log(
      `来源 ${result.source}　耗时 ${result.telemetry.totalMs}ms　尝试 ${result.telemetry.attempts}　token ${result.telemetry.promptTokens}+${result.telemetry.completionTokens}（思考 ${result.telemetry.reasoningTokens}）　成本 ${result.telemetry.costUsd ?? "n/a"}`,
    );
    // 缓存命中会把耗时砍掉一半上下 —— 宁可吵，也别让人拿命中的数去选型
    const cached = result.telemetry.calls.filter((call) => call.cacheHit).length;
    if (cached > 0) {
      console.log(`⚠️ ${cached}/${result.telemetry.calls.length} 发命中网关缓存，这一世的耗时不是真实延迟`);
    }
    if (result.telemetry.fallbackReason) console.log(`回落原因：${result.telemetry.fallbackReason}`);
    for (const rejection of result.telemetry.rejections) console.log(`打回：${rejection.join(" ")}`);
    console.log(`${"-".repeat(78)}\n${result.entry.title}\n${result.entry.body}`);

    records.push({
      profile: life.profile,
      seed: life.seed,
      ending: life.state.ending,
      way: life.state.wayAchieved,
      years: life.state.year,
      organIds: life.state.organIds,
      livesTaken: life.state.livesTaken,
      stats: life.state.stats,
      skyId: life.state.skyId,
      originId: life.state.originId,
      records: life.state.records,
      waysProgress: progress,
      templateBody: template.body,
      aiTitle: result.entry.title,
      aiBody: result.entry.body,
      source: result.source,
      telemetry: result.telemetry,
    });
  }

  if (args.out !== null) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, JSON.stringify({ model: args.model, lives: records }, null, 2), "utf8");
    console.log(`\n写入 ${args.out}`);
  }
  return 0;
}

process.exitCode = await main();

/** [S2] 开得了的最深一处（`content.destinations` 由浅入深排）。 */
function deepestOpen(state: TaleState, content: TaleContent): string {
  const open = exploreDestinations(state, content).filter((entry) => entry.unlocked);
  const picked = open[open.length - 1];
  if (picked === undefined) throw new Error("lab：一处去处都开不了");
  return picked.def.id;
}
