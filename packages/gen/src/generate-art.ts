/**
 * B4 美术管线主脚本 —— 《食灵·列传》全套插图生成。
 *
 * ## 三段式（顺序不可颠倒）
 * 1. `--anchors`      同一场景 × 5 种画风措辞，出候选锚图供人评选。
 * 2. `--promote=<id>` 把评选胜出的候选提升为正典锚图（`public/art/_style/anchor.jpg`）。
 * 3. `--batch=...`    其余全部走 image-to-image，**以正典锚图为参考**逐张生成。
 *
 * 第 3 段为什么必须挂锚图：60 张图分 5 个批次、跨若干次运行产生，纯 text-to-image 时
 * 每次调用都是独立采样，画风必然在批次之间漂移（这正是 owner 点名的验收红线）。
 * image-to-image 把每一张都钉在同一张参考图上，漂移面积从「60 张之间」压到
 * 「每张 vs 锚图」。
 *
 * ## 用法
 * ```
 * cd packages/gen
 * pnpm art:anchors                       # 第 1 段
 * pnpm art:promote -- d-agedsilk         # 第 2 段
 * pnpm art -- --batch=all                # 第 3 段（可反复跑，已存在的文件默认跳过）
 * pnpm art -- --only=qiu-hunt-thicket --force
 * pnpm art -- --batch=all --dry-run      # 只打 prompt 与预算，不花积分
 * ```
 *
 * ## 纪律
 * - 积分：跑前跑后各查一次 `/openapi/v1/balance` 并打印差额，报告里要写。
 * - 幂等：目标 webp 已存在即跳过，`--force` 才重跑 —— 重试单张不会重烧整批。
 * - 原图：PNG 原件落在临时目录（默认 `$TMPDIR/shiling-art-raw`），**不进仓库**。
 *   60 张 PNG 近百 MB，且仓库有每日 auto-commit，落在仓库里迟早被整批提进去。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ANCHOR_STYLE_VARIANTS,
  IMAGE_MODEL,
  aspectRatioFor,
  buildAnchoredPrompt,
  buildPrompt,
  type ArtKind,
} from "./artStyle.ts";
import {
  BATCHES,
  allJobs,
  artRelPath,
  featuresSelf,
  type ArtJob,
  type BatchName,
} from "./artManifest.ts";
import {
  assertImageToolsAvailable,
  decodeWebpToPng,
  encodeJpeg,
  encodeWebp,
} from "./artImage.ts";
import {
  createImageToImage,
  createTextToImage,
  downloadFile,
  getBalance,
  getImageToImageTask,
  getTextToImageTask,
  pollTask,
  type ImageTask,
} from "./meshy.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** packages/gen/src -> packages/tale-client/public/art */
const ART_DIR = join(__dirname, "../../tale-client/public/art");
const STYLE_DIR = join(ART_DIR, "_style");
const ANCHOR_PATH = join(STYLE_DIR, "anchor.jpg");
const RAW_DIR = process.env.ART_RAW_DIR ?? join(tmpdir(), "shiling-art-raw");
/** 每张成图记一笔（task id／积分／prompt 摘要），供报告与追溯用。 */
const LEDGER_PATH = join(RAW_DIR, "ledger.jsonl");

/**
 * 单张图的输出宽度上限（长边）。目标：单图 < 300KB，全套 < 20MB。
 *
 * 实测 API 出图约 1200px 宽（4:3 是 1200×896），所以这里的值只会缩不会放 ——
 * `encodeWebp` 会与源宽取 min，写大了也不会糊。
 */
const WIDTH_BY_KIND: Record<ArtKind, number> = {
  event: 1024, // 4:3  -> 1024x768，事件卡最大展示宽约 720，2x 够用
  portrait: 768, // 3:4  -> 768x1024
  avatar: 512, // 1:1  -> 512x512，头像展示尺寸很小
  hero: 1200, // 16:9 题字铺满首屏，给到源图上限
  ending: 1200, // 16:9 结局图也是满屏演出
  anchor: 1024,
};

/** 同时在跑的生成任务数。Meshy 侧 429 会退避重试；4 并发实测未触发限流。 */
const CONCURRENCY = 4;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface Args {
  anchors: boolean;
  /**
   * 是否处于「提升锚图」模式。与 `promote`（候选 id）分开存**是为了消掉一个会烧积分的坑**：
   * 以前 `art:promote` 脚本本体不带任何 flag，忘了写 `-- <id>` 就会一路落到 runBatch，
   * 默认 `allJobs()` 60 张全量重跑。现在脚本本体带 `--promote`，少了 id 直接报用法错误。
   */
  promoteMode: boolean;
  promote: string | null;
  batches: BatchName[] | "all" | null;
  only: string[];
  force: boolean;
  dryRun: boolean;
  /** 重试时追加给 prompt 的纠正句（例如「不要出现第二只兽」）。 */
  extra: string | null;
  /** 退回 text-to-image（锚图不可用时的降级路径）。 */
  noAnchor: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    anchors: false,
    promoteMode: false,
    promote: null,
    batches: null,
    only: [],
    force: false,
    dryRun: false,
    extra: null,
    noAnchor: false,
  };
  for (const raw of argv) {
    // pnpm 11 把 `pnpm art -- --batch=all` 里的 `--` 一并透传给脚本，忽略掉。
    if (raw === "--") continue;
    if (raw === "--anchors") args.anchors = true;
    else if (raw === "--force") args.force = true;
    else if (raw === "--dry-run") args.dryRun = true;
    else if (raw === "--no-anchor") args.noAnchor = true;
    else if (raw === "--promote") args.promoteMode = true;
    else if (raw.startsWith("--promote=")) {
      args.promoteMode = true;
      args.promote = raw.slice("--promote=".length);
    }
    else if (raw.startsWith("--extra=")) args.extra = raw.slice("--extra=".length);
    else if (raw.startsWith("--only=")) args.only = raw.slice("--only=".length).split(",").filter(Boolean);
    else if (raw.startsWith("--batch=")) {
      const value = raw.slice("--batch=".length);
      if (value === "all") args.batches = "all";
      else {
        const names = value.split(",").filter(Boolean) as BatchName[];
        for (const name of names) {
          if (!(name in BATCHES)) {
            throw new Error(`未知批次 "${name}"，可选：${Object.keys(BATCHES).join("/")}/all`);
          }
        }
        args.batches = names;
      }
    } else if (raw.startsWith("--")) throw new Error(`未知参数 ${raw}`);
    // 裸位置参数只在 promote 模式下有意义（`pnpm art:promote -- d-agedsilk`）。
    // 其余情况一律报错 —— 打错的 flag 静默被忽略比直接失败危险得多。
    else if (args.promoteMode && args.promote === null) args.promote = raw;
    else throw new Error(`多余的参数 ${raw}`);
  }
  if (args.promoteMode && args.promote === null) {
    throw new Error("用法：pnpm art:promote -- <候选 id>（缺少候选 id）");
  }
  return args;
}

// ---------------------------------------------------------------------------
// 生成一张图（含轮询与下载）
// ---------------------------------------------------------------------------

interface GenResult {
  taskId: string;
  credits: number;
  rawPath: string;
}

async function generateOne(opts: {
  label: string;
  prompt: string;
  kind: ArtKind;
  rawName: string;
  /** 空数组＝走 text-to-image；非空＝走 image-to-image（[0] 恒为正典锚图）。 */
  referenceDataUris: string[];
}): Promise<GenResult> {
  const aspectRatio = aspectRatioFor(opts.kind);
  const anchored = opts.referenceDataUris.length > 0;
  const taskId = anchored
    ? await createImageToImage({
        aiModel: IMAGE_MODEL,
        prompt: opts.prompt,
        referenceImageUrls: opts.referenceDataUris,
        aspectRatio,
      })
    : await createTextToImage({ aiModel: IMAGE_MODEL, prompt: opts.prompt, aspectRatio });

  const fetchTask = (): Promise<ImageTask> =>
    anchored ? getImageToImageTask(taskId) : getTextToImageTask(taskId);
  const task = await pollTask(opts.label, fetchTask, { intervalMs: 3_000, timeoutMs: 8 * 60_000 });

  const url = task.image_urls?.[0];
  if (!url) throw new Error(`[${opts.label}] 任务 ${taskId} 成功了但没有 image_urls`);

  const rawPath = join(RAW_DIR, `${opts.rawName}.png`);
  await downloadFile(url, rawPath);
  return { taskId, credits: task.consumed_credits ?? 0, rawPath };
}

function appendLedger(entry: Record<string, unknown>): void {
  mkdirSync(RAW_DIR, { recursive: true });
  writeFileSync(LEDGER_PATH, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, {
    flag: "a",
  });
}

/**
 * 有限并发的 map，保留输入顺序。
 *
 * `fn` 抛错时不让那个 worker 悄悄退出（那等于并发数默默减一，整批变慢却没人知道）：
 * 记下第一个错误，等所有 worker 收尾后再抛出去。调用方自己 try/catch 的正常路径不受影响。
 */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  let firstError: unknown = null;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) return;
      try {
        results[index] = await fn(item, index);
      } catch (error) {
        firstError ??= error;
      }
    }
  });
  await Promise.all(workers);
  if (firstError !== null) throw firstError;
  return results;
}

// ---------------------------------------------------------------------------
// 第 1 段：锚图候选
// ---------------------------------------------------------------------------

/**
 * 锚图评选场景。
 *
 * 选它的理由：60 张里 44 张是「幼兽 ＋ 青丘地貌 ＋ 一个叙事瞬间」的 4:3 事件插图，
 * 锚就该锚在主力构型上。同时这一个场景里同时有主角形貌、地貌、水、石、雾与留白 ——
 * 五个画风判据一次看全，不用为了看某一项另开一张。
 *
 * 刻意**不复用某条真实事件的 brief**：锚图会被 44 张图当参考，一旦它同时是某张成图，
 * 那张就会被自己当参考，「别抄参考的构图」这条约束在它身上自相矛盾。
 */
const ANCHOR_SUBJECT =
  "清晨薄雾中的青丘丘陵一角：近景一片浅水滩，滩边散着几块青灰湿石；" +
  "瘦小如幼狐、灰褐皮毛、额心一点淡青灵纹的食灵幼兽立于石上侧身回头，一只前爪抬起未落；" +
  "中景坡上白草成片，远处丘背连绵退入雾中直至消失。光自左后斜来，右上方大片留白。";

async function runAnchors(dryRun: boolean): Promise<void> {
  console.log(`\n=== 第 1 段：锚图候选 ${ANCHOR_STYLE_VARIANTS.length} 张 ===`);
  for (const variant of ANCHOR_STYLE_VARIANTS) {
    console.log(`  ${variant.id.padEnd(14)} ${variant.label}`);
  }
  if (dryRun) {
    console.log("\n--dry-run：打一份 prompt 示例后退出\n");
    const first = ANCHOR_STYLE_VARIANTS[0];
    if (first) {
      console.log(
        buildPrompt({ kind: "anchor", subject: ANCHOR_SUBJECT, styleOverride: first.style })
      );
    }
    return;
  }

  const results = await mapLimit([...ANCHOR_STYLE_VARIANTS], CONCURRENCY, async (variant) => {
    const label = `anchor:${variant.id}`;
    try {
      const out = await generateOne({
        label,
        prompt: buildPrompt({
          kind: "anchor",
          subject: ANCHOR_SUBJECT,
          styleOverride: variant.style,
        }),
        kind: "anchor",
        rawName: `anchor-${variant.id}`,
        referenceDataUris: [],
      });
      // 候选也压一份小 webp 进仓库：评选依据要能被复核，不能只活在一次会话里。
      const size = encodeWebp(out.rawPath, join(STYLE_DIR, "candidates", `${variant.id}.webp`), {
        width: 640,
        quality: 80,
      });
      appendLedger({ stage: "anchor", id: variant.id, taskId: out.taskId, credits: out.credits });
      console.log(`  ✓ ${variant.id} credits=${out.credits} preview=${(size / 1024) | 0}KB`);
      return { id: variant.id, ok: true as const, credits: out.credits };
    } catch (error) {
      console.error(`  ✗ ${variant.id}: ${(error as Error).message}`);
      appendLedger({ stage: "anchor", id: variant.id, error: (error as Error).message });
      return { id: variant.id, ok: false as const, credits: 0 };
    }
  });

  console.log(
    `\n候选就绪：${results.filter((r) => r.ok).length}/${results.length}。` +
      `原图 ${RAW_DIR}/anchor-*.png，预览 ${join(STYLE_DIR, "candidates")}。\n` +
      `下一步：肉眼评选后 \`pnpm art:promote -- <id>\`。`
  );
}

// ---------------------------------------------------------------------------
// 第 2 段：提升正典锚图
// ---------------------------------------------------------------------------

function runPromote(variantId: string): void {
  if (!ANCHOR_STYLE_VARIANTS.some((v) => v.id === variantId)) {
    throw new Error(
      `没有候选 "${variantId}"。可选：${ANCHOR_STYLE_VARIANTS.map((v) => v.id).join("/")}`
    );
  }
  const rawPath = join(RAW_DIR, `anchor-${variantId}.png`);
  if (!existsSync(rawPath)) {
    throw new Error(`找不到候选原图 ${rawPath} —— 先跑 \`pnpm art:anchors\`。`);
  }
  // JPEG 而非 webp：image-to-image 的参考图只吃 jpg/jpeg/png。
  const size = encodeJpeg(rawPath, ANCHOR_PATH, { width: 1280, quality: 3 });
  writeFileSync(join(STYLE_DIR, "anchor.txt"), `${variantId}\n`, "utf8");
  console.log(`正典锚图 = ${variantId} -> ${ANCHOR_PATH} (${(size / 1024) | 0}KB)`);
  console.log(`别忘了把胜出的画风措辞固化进 artStyle.ts 的 STYLE_CORE。`);
}

function loadAnchorDataUri(): string {
  if (!existsSync(ANCHOR_PATH)) {
    throw new Error(
      `缺正典锚图 ${ANCHOR_PATH}。先 \`pnpm art:anchors\` 再 \`pnpm art:promote -- <id>\`；` +
        `确实要不挂锚图生成就加 --no-anchor（风格一致性会下降，报告里必须写明）。`
    );
  }
  const base64 = readFileSync(ANCHOR_PATH).toString("base64");
  return `data:image/jpeg;base64,${base64}`;
}

// ---------------------------------------------------------------------------
// 第 3 段：批量生成
// ---------------------------------------------------------------------------

function selectJobs(args: Args): ArtJob[] {
  let jobs: ArtJob[];
  if (args.batches === "all" || (args.batches === null && args.only.length > 0)) jobs = allJobs();
  else if (args.batches) jobs = args.batches.flatMap((name) => BATCHES[name]());
  else jobs = allJobs();

  if (args.only.length === 0) return jobs;
  const wanted = new Set(args.only);
  const picked = jobs.filter((job) => wanted.has(job.id));
  const missing = [...wanted].filter((id) => !picked.some((job) => job.id === id));
  if (missing.length > 0) throw new Error(`--only 里这些 id 不在清单中：${missing.join(", ")}`);
  return picked;
}

/**
 * 把追加参考图（`public/art/` 下的 webp）解成 data URI。
 *
 * 优先用本次运行留在 RAW_DIR 的 PNG 原件（无二次压缩损失）；跨会话跑时原件已不在，
 * 就把仓库里的 webp 用 dwebp 解回 PNG。两条路都通，所以「先跑立绘再跑结局」不必同一次运行。
 */
function refDataUri(relPath: string): string {
  const rawCandidate = join(RAW_DIR, `${relPath.split("/").pop()?.replace(/\.webp$/, "")}.png`);
  if (existsSync(rawCandidate)) {
    return `data:image/png;base64,${readFileSync(rawCandidate).toString("base64")}`;
  }
  const committed = join(ART_DIR, relPath);
  if (!existsSync(committed)) {
    throw new Error(
      `追加参考图 ${relPath} 还不存在 —— 它所属的批次要先跑完（依赖波次本该排好，` +
        `除非你用 --only 单点了一张依赖别人的图）。`
    );
  }
  const decoded = join(RAW_DIR, "refs", `${relPath.replace(/\//g, "-")}.png`);
  decodeWebpToPng(committed, decoded);
  return `data:image/png;base64,${readFileSync(decoded).toString("base64")}`;
}

/**
 * 按依赖排波次：一张图的 `refs` 全部就绪（已在仓库里，或本波之前已生成）才进队。
 *
 * 不做完整拓扑排序 —— 依赖链只有「幼兽→成兽→近神」这一条，反复扫到不再有进展即可，
 * 而且这样天然能报出环／悬空依赖。
 */
function scheduleWaves(pending: ArtJob[]): ArtJob[][] {
  const remaining = [...pending];
  // 本次要（重）生成的产物。**关键**：这些不算「已就绪」，即使磁盘上已经有旧文件 ——
  // 否则 `--force` 重跑成长链时，成兽和近神会同时起跑，近神拿到的是上一轮的旧成兽图，
  // 「每一环只跨一步」的承接就断了（而且断得很安静，图看着还挺像）。
  const willRegenerate = new Set(pending.map((job) => artRelPath(job)));
  /** 已可用作参考的产物：本轮不重生成且磁盘上确实存在，或已在前面的波次里生成完。 */
  const available = (rel: string): boolean =>
    !willRegenerate.has(rel) && existsSync(join(ART_DIR, rel));
  const produced = new Set<string>();

  const waves: ArtJob[][] = [];
  while (remaining.length > 0) {
    const ready = remaining.filter((job) =>
      (job.refs ?? []).every((rel) => produced.has(rel) || available(rel))
    );
    if (ready.length === 0) {
      throw new Error(
        `参考图依赖成环或悬空，排不出波次：${remaining
          .map((job) => `${job.id}(refs=${(job.refs ?? []).join("+") || "-"})`)
          .join(", ")}`
      );
    }
    waves.push(ready);
    for (const job of ready) {
      produced.add(artRelPath(job));
      remaining.splice(remaining.indexOf(job), 1);
    }
  }
  return waves;
}

/** 一张图的 prompt 输入 —— dry-run 与实跑必须走同一条组装路径，否则预览就不算预览。 */
function promptSpecFor(job: ArtJob, extraFromCli: string | null) {
  const extra = [job.extra, extraFromCli].filter(Boolean).join(" ") || undefined;
  return {
    kind: job.kind,
    subject: job.subject,
    extra,
    featuresSelf: featuresSelf(job),
    growthFromRef: (job.refs?.length ?? 0) > 0,
  };
}

async function runBatch(args: Args): Promise<void> {
  const jobs = selectJobs(args);
  const willAnchor = !args.noAnchor;
  // dry-run 不加载锚图：预览的意义就是「还没花钱、也还没跑过第 1/2 段时」也能看 prompt。
  const anchorDataUri = willAnchor && !args.dryRun ? loadAnchorDataUri() : null;

  const pending = jobs.filter((job) => {
    const dest = join(ART_DIR, artRelPath(job));
    return args.force || !existsSync(dest);
  });
  const skipped = jobs.length - pending.length;

  console.log(`\n=== 第 3 段：批量生成 ===`);
  console.log(`清单 ${jobs.length} 张，跳过已存在 ${skipped} 张，本次生成 ${pending.length} 张。`);
  console.log(`模式 ${willAnchor ? "image-to-image（挂正典锚图）" : "text-to-image（无锚图）"}`);
  console.log(`模型 ${IMAGE_MODEL}，预算约 ${pending.length * 9} 积分。`);

  if (args.dryRun) {
    for (const job of pending) {
      const refs = job.refs?.length ? ` refs=${job.refs.join("+")}` : "";
      console.log(`\n----- ${job.id} (${job.kind}, ${aspectRatioFor(job.kind)}) ${job.label}${refs}`);
      console.log(job.subject);
    }
    const sample = pending[0];
    if (sample) {
      console.log(`\n===== ${sample.id} 的完整 prompt =====\n`);
      const spec = promptSpecFor(sample, args.extra);
      console.log(willAnchor ? buildAnchoredPrompt(spec) : buildPrompt(spec));
    }
    return;
  }
  if (pending.length === 0) return;

  assertImageToolsAvailable();
  const before = await getBalance();
  console.log(`起始余额 ${before} 积分\n`);

  const waves = scheduleWaves(pending);
  if (waves.length > 1) {
    console.log(`依赖波次 ${waves.map((wave) => wave.length).join(" -> ")}\n`);
  }

  let done = 0;
  const failures: Array<{ id: string; error: string }> = [];
  for (const wave of waves) {
    await mapLimit(wave, CONCURRENCY, async (job) => {
      const spec = promptSpecFor(job, args.extra);
      const prompt = anchorDataUri ? buildAnchoredPrompt(spec) : buildPrompt(spec);
      try {
        // 锚图恒为 [0]（风格来源），追加参考图在后（形貌来源）。
        const references = anchorDataUri
          ? [anchorDataUri, ...(job.refs ?? []).map(refDataUri)]
          : [];
        const out = await generateOne({
          label: job.id,
          prompt,
          kind: job.kind,
          rawName: job.id,
          referenceDataUris: references,
        });
        const dest = join(ART_DIR, artRelPath(job));
        const size = encodeWebp(out.rawPath, dest, { width: WIDTH_BY_KIND[job.kind] });
        appendLedger({
          stage: "batch",
          id: job.id,
          kind: job.kind,
          taskId: out.taskId,
          credits: out.credits,
          bytes: size,
          refs: job.refs ?? [],
          anchored: anchorDataUri !== null,
        });
        done++;
        console.log(
          `  ✓ [${done}/${pending.length}] ${job.id} ${(size / 1024) | 0}KB credits=${out.credits}`
        );
      } catch (error) {
        const message = (error as Error).message;
        failures.push({ id: job.id, error: message });
        appendLedger({ stage: "batch", id: job.id, error: message });
        console.error(`  ✗ ${job.id}: ${message}`);
      }
    });
  }

  const after = await getBalance();
  console.log(`\n成图 ${done}/${pending.length}，失败 ${failures.length}`);
  for (const failure of failures) console.log(`  ✗ ${failure.id}: ${failure.error}`);
  console.log(`余额 ${before} -> ${after}（消耗 ${before - after} 积分）`);
  console.log(`账本 ${LEDGER_PATH}`);
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(RAW_DIR, { recursive: true });

  if (args.anchors) {
    if (!args.dryRun) assertImageToolsAvailable();
    const before = args.dryRun ? 0 : await getBalance();
    await runAnchors(args.dryRun);
    if (!args.dryRun) {
      const after = await getBalance();
      console.log(`余额 ${before} -> ${after}（消耗 ${before - after} 积分）`);
    }
    return;
  }
  if (args.promoteMode) {
    // parseArgs 已保证 promoteMode 下 promote 非 null（缺 id 会在那里报用法错误）。
    assertImageToolsAvailable();
    runPromote(args.promote ?? "");
    return;
  }
  await runBatch(args);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
