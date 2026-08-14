/**
 * 一世一剧本的实验台 —— 用真引擎的降世状态出骨架，让真网关生成，把事件包与账单打在终端上。
 *
 * 用法（在 packages/tale-ai 下）：
 *   pnpm scenario                        # 一世（默认种子），全量 16 槽，四批并行
 *   pnpm scenario -- --model litellm/gpt-latest
 *   pnpm scenario -- --slots 4 --batch-size 4   # 只生一批，调 prompt 用（便宜）
 *   pnpm scenario -- --seeds 20260813,20260814 --out ../../.superpowers/sdd/xxx/packs.json
 *   pnpm scenario -- --draw 200          # **不联网**：拿中值占位包跑真引擎，量生成池被抽中的比例
 *   pnpm scenario -- --dry               # **不联网**：只把骨架与中值草稿打出来，看规格书对不对
 *
 * ## 为什么默认 `cache: {"no-cache": true}`
 * 这个台子存在的理由之一是**量延迟**，而网关会缓存整发请求：body 里没有任何命中标志，
 * 唯一判据是响应头 `x-litellm-cache-key`（已记进 `stat.cacheHit`）。拿命中的数选型必然选错
 * —— P1 差点据此把 sonnet（真实 35〜44s）选进生产。`--cache` 只在「只想看文笔」时用。
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
  createCursor,
  createLife,
  eligibleChoiceIdxs,
  exploreDestinations,
  performAction,
  premiseOf,
  resolveChoice,
  stalkAct,
  stalkPreview,
  type ActionId,
  type BodyPart,
  type CombatAct,
  type StalkAct,
  type TaleContent,
  type TaleEvent,
  type TaleState,
  approachOf,
  clashOf,
} from "@shiling/tale-sim";
import { SEED_CHANG_TAI, TALE_CONTENT } from "@shiling/tale-content";
import {
  assembleEvent,
  buildSlots,
  generateScenario,
  midpointDraft,
  slotBlock,
  type SlotSpec,
} from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTENT = TALE_CONTENT;
const MAX_STEPS = 900;

// ===== 密钥 =====

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

// ===== 机器玩家（同 historian-lab：只读界面也看得到的数）=====

function decideAction(state: TaleState, actions: readonly ActionId[], roll: () => number): ActionId {
  if (actions.includes("dormant")) return "dormant";
  if (state.hunger <= 50) return "hunt";
  if (state.flags.includes("wound") || state.flags.includes("sick")) return "rest";
  return state.hunger >= 70 ? "explore" : roll() < 0.5 ? "hunt" : "explore";
}

function decideStalk(state: TaleState, content: TaleContent): StalkAct {
  const preview = stalkPreview(state, content);
  const stalk = approachOf(state);
  if (!stalk) throw new Error("decideStalk: 不在追猎中");
  if (preview.staminaLeft <= 1) return "pounce";
  if (!preview.alreadyUpwind && preview.staminaLeft >= 4) return "circle";
  if (preview.pounceChance >= 0.7) return "pounce";
  if (preview.creepGain > 0 && preview.pounceChanceAfterCreep >= preview.pounceChance) return "creep";
  if (preview.waitAlertDrop > 0) return "wait";
  return "pounce";
}

function decideCombat(state: TaleState, content: TaleContent): CombatAct {
  // [S1] 同 historian-lab：手抄镜像换成引擎导出的推荐链（漏改 skillId 时这里也崩过）
  return recommendCombatAct(combatPreview(state, content));
}

function pickChoice(event: TaleEvent, eligible: readonly number[], roll: () => number): number {
  return eligible[Math.floor(roll() * eligible.length) % eligible.length] ?? eligible[0] ?? 0;
}

/** 跑一世，返回撞上的全部事件 id。 */
function playLife(seed: number, content: TaleContent): { state: TaleState; seen: string[] } {
  const cursor = createCursor(seed ^ 0x5f3759df);
  const roll = (): number => cursor.next();
  let state = createLife(seed, SEED_CHANG_TAI, content);
  const seen: string[] = [];
  let steps = 0;
  while (state.alive && steps < MAX_STEPS) {
    steps += 1;
    if (clashOf(state)) {
      state = combatAct(state, decideCombat(state, content), content).state;
      continue;
    }
    if (approachOf(state)) {
      state = stalkAct(state, decideStalk(state, content), content).state;
      continue;
    }
    const action = decideAction(state, availableActions(state, content), roll);
    // [S2] 探索要指定去处：这两个 lab 只关心「文案够不够多」，所以恒去开得了的最深一处
    // （深处的事件池是这一批新写的，量文案量的就该是它们）
    const turn = performAction(
      state,
      action,
      content,
      action === "explore" ? { destinationId: deepestOpen(state, content) } : undefined,
    );
    state = turn.state;
    const event = turn.pendingEvent;
    if (!event || !state.alive) continue;
    seen.push(event.id);
    const eligible = eligibleChoiceIdxs(state, event, content);
    if (eligible.length === 0) throw new Error(`事件 ${event.id} 无可选抉择`);
    state = resolveChoice(state, event, pickChoice(event, eligible, roll), content).state;
  }
  return { state, seen };
}

/** 中值占位包：不联网地把骨架变成可注入的事件（量抽中比例用）。 */
function dryPack(state: TaleState, content: TaleContent, slotCount: number): TaleEvent[] {
  return buildSlots(state, content, slotCount).slots.map((slot) => assembleEvent(slot, midpointDraft(slot)));
}

// ===== 参数 =====

interface Args {
  model: string;
  seeds: number[];
  out: string | null;
  cache: boolean;
  budgetMs: number;
  slots: number;
  batchSize: number;
  reasoning: string | null;
  draw: number;
  dry: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    model: "litellm/gpt-5.4-mini-with-fallback",
    seeds: [20260813],
    out: null,
    cache: false,
    budgetMs: 120_000,
    slots: 16,
    batchSize: 4,
    reasoning: null,
    draw: 0,
    dry: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--model" && value) args.model = value;
    if (flag === "--seeds" && value) args.seeds = value.split(",").map(Number);
    if (flag === "--out" && value) args.out = resolve(process.cwd(), value);
    if (flag === "--budget" && value) args.budgetMs = Number(value);
    if (flag === "--slots" && value) args.slots = Number(value);
    if (flag === "--batch-size" && value) args.batchSize = Number(value);
    if (flag === "--reasoning" && value) args.reasoning = value;
    if (flag === "--draw" && value) args.draw = Number(value);
    if (flag === "--cache") args.cache = true;
    if (flag === "--dry") args.dry = true;
  }
  return args;
}

function printEvent(event: TaleEvent, prefix = ""): void {
  console.log(`${prefix}《${event.title}》　${event.id}　${JSON.stringify(event.trigger)}`);
  console.log(`${prefix}${event.body}`);
  for (const choice of event.choices) {
    const gate = choice.requires ? `〔${JSON.stringify(choice.requires)}〕` : "";
    console.log(`${prefix}  ・${choice.label}${gate}`);
    for (const outcome of choice.outcomes) {
      console.log(`${prefix}    (${outcome.weight}) ${outcome.text}　${JSON.stringify(outcome.effects)}`);
    }
  }
}

// ===== 三种模式 =====

/** `--draw`：量「生成池实际被抽中的比例」。不联网。 */
function drawTally(lives: number, slotCount: number): void {
  let generated = 0;
  let written = 0;
  const distinct: number[] = [];
  const years: number[] = [];
  for (let i = 0; i < lives; i += 1) {
    const seed = (20260813 + i * 0x9e3779b1) >>> 0;
    const born = createLife(seed, SEED_CHANG_TAI, CONTENT);
    const injected: TaleContent = { ...CONTENT, events: [...CONTENT.events, ...dryPack(born, CONTENT, slotCount)] };
    const { state, seen } = playLife(seed, injected);
    const gen = seen.filter((id) => id.startsWith("gen-"));
    generated += gen.length;
    written += seen.length - gen.length;
    distinct.push(new Set(gen).size);
    years.push(state.year);
  }
  const total = generated + written;
  const mean = (list: number[]): number => list.reduce((a, b) => a + b, 0) / Math.max(1, list.length);
  console.log(`${lives} 世：撞上事件 ${total} 次，其中生成事件 ${generated} 次（${((generated / Math.max(1, total)) * 100).toFixed(1)}%）`);
  console.log(`每世平均撞上 ${(total / lives).toFixed(1)} 次事件，其中生成的 ${(generated / lives).toFixed(1)} 条（去重后 ${mean(distinct).toFixed(1)} 条不同）`);
  console.log(`每世平均寿 ${mean(years).toFixed(1)} 岁`);
}

/** `--dry`：把骨架规格书与中值草稿打出来。不联网。 */
function dryRun(seed: number, slotCount: number): void {
  const born = createLife(seed, SEED_CHANG_TAI, CONTENT);
  const { sky, origin } = premiseOf(born, CONTENT);
  console.log(`种子 ${seed}　天时 ${sky.name}　出身 ${origin.name}`);
  const { slots } = buildSlots(born, CONTENT, slotCount);
  for (const slot of slots) {
    console.log(`\n${slotBlock(slot)}`);
    console.log(`　插图：${slot.illustration || "（无 —— 走客户端水墨占位）"}`);
  }
  console.log(`\n${"=".repeat(78)}\n中值草稿（骨架填满长这样）：`);
  for (const slot of slots) printEvent(assembleEvent(slot, midpointDraft(slot)), "  ");
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.draw > 0) {
    drawTally(args.draw, args.slots);
    return 0;
  }
  if (args.dry) {
    dryRun(args.seeds[0] ?? 20260813, args.slots);
    return 0;
  }

  const { key, baseUrl } = loadKey();
  const extraParams: Record<string, unknown> = {};
  if (args.reasoning !== null) extraParams.reasoning_effort = args.reasoning;
  if (!args.cache) extraParams.cache = { "no-cache": true };

  const records: unknown[] = [];
  for (const seed of args.seeds) {
    const born = createLife(seed, SEED_CHANG_TAI, CONTENT);
    const { sky, origin } = premiseOf(born, CONTENT);
    const slots: SlotSpec[] = buildSlots(born, CONTENT, args.slots).slots;
    const result = await generateScenario({
      state: born,
      content: CONTENT,
      cacheKey: `lab:${seed}`,
      slotCount: args.slots,
      options: {
        endpoint: `${baseUrl}/chat/completions`,
        model: args.model,
        budgetMs: args.budgetMs,
        batchSize: args.batchSize,
        headers: { authorization: `Bearer ${key}` },
        ...(Object.keys(extraParams).length > 0 ? { extraParams } : {}),
      },
    });

    console.log(`\n${"=".repeat(78)}`);
    console.log(`种子 ${seed}　天时 ${sky.name}　出身 ${origin.name}　模型 ${args.model}`);
    const t = result.telemetry;
    console.log(
      `收下 ${t.accepted}/${t.slots} 条　耗时 ${t.totalMs}ms　token ${t.promptTokens}+${t.completionTokens}（思考 ${t.reasoningTokens}）　成本 ${t.costUsd ?? "n/a"}`,
    );
    for (const batch of t.batches) {
      const cached = batch.calls.filter((call) => call.cacheHit).length;
      console.log(
        `  批 ${batch.slotIds.length} 槽：收下 ${batch.accepted}　尝试 ${batch.attempts}　${batch.totalMs}ms${cached > 0 ? `　⚠️ ${cached} 发命中缓存，延迟不作数` : ""}`,
      );
      for (const call of batch.calls) {
        if (!call.ok) console.log(`    调用失败：${call.error ?? `HTTP ${call.status}`}`);
      }
      for (const rejection of batch.rejections) {
        for (const problem of rejection) console.log(`    打回：${problem}`);
      }
    }
    console.log("-".repeat(78));
    for (const event of result.pack.events) {
      printEvent(event);
      console.log("");
    }

    records.push({
      seed,
      skyId: born.skyId,
      originId: born.originId,
      skyName: sky.name,
      originName: origin.name,
      slots,
      pack: result.pack,
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
