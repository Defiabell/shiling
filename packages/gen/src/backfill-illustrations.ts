/**
 * 把已生成的事件插图文件名回填进 tale-content 的 `TaleEvent.illustration`。
 *
 * ## 为什么写成脚本而不是手改 44 处
 * 手改 44 个字段一定会漏、也一定会和「文件到底存不存在」失同步。脚本每次都以
 * `packages/tale-client/public/art/events/` 的**磁盘实况**为准：
 * 图在就写字段，图不在就不写（并报出来）。重跑幂等 —— 已经对的行原样不动。
 *
 * ## 改写方式
 * 在事件对象里 `illustrationBrief:` 那一行**之前**插入 `illustration: "events/<id>.webp",`，
 * 与 `TaleEvent` 接口的字段声明顺序（… body, illustration?, illustrationBrief?, choices）一致。
 * 用文本插入而不是 AST 改写：这批源码格式统一（prettier 风格、每个事件一个 `id: "..."`），
 * 文本改写足够，而引入 AST 工具要加依赖 —— 那会动 lockfile，B3 正在并行。
 *
 * 用法：`pnpm art:backfill`（`--dry-run` 只报要改什么）
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { TALE_CONTENT } from "../../tale-content/src/index.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVENTS_SRC_DIR = join(__dirname, "../../tale-content/src/events");
const EVENT_ART_DIR = join(__dirname, "../../tale-client/public/art/events");
const SOURCE_FILES = ["hunt.ts", "explore.ts", "rest.ts", "generic.ts"];

const dryRun = process.argv.includes("--dry-run");

/** 事件 id -> `public/art/` 下的相对路径，仅收录磁盘上真实存在的图。 */
function existingArt(): Map<string, string> {
  const found = new Map<string, string>();
  for (const event of TALE_CONTENT.events) {
    const rel = `events/${event.id}.webp`;
    if (existsSync(join(EVENT_ART_DIR, `${event.id}.webp`))) found.set(event.id, rel);
  }
  return found;
}

interface FileEdit {
  file: string;
  inserted: number;
  updated: number;
  unchanged: number;
}

function backfillFile(fileName: string, art: Map<string, string>): FileEdit {
  const path = join(EVENTS_SRC_DIR, fileName);
  const lines = readFileSync(path, "utf8").split("\n");
  const out: string[] = [];
  const edit: FileEdit = { file: fileName, inserted: 0, updated: 0, unchanged: 0 };

  /** 当前正在遍历的事件 id（遇到 `id: "..."` 行时更新）。 */
  let currentId: string | null = null;

  for (const line of lines) {
    const idMatch = /^\s*id: "([a-z0-9-]+)",\s*$/.exec(line);
    if (idMatch?.[1]) currentId = idMatch[1];

    // 已存在的 illustration 行：按磁盘实况改写或删除，保证幂等且不留悬空引用。
    // 假设格式恰好是 `illustration: "…",` 单行双引号（本脚本自己写出来的形状，44/44 命中）。
    // 若有人手改成单引号或加了换行，这里认不出来 → 会在它前面再插一条，从而出现重复键。
    // 兜底是 main() 末尾的「回填数 vs 磁盘图数」对账：数目不符即 exit 1，不会静默带病提交。
    const existingMatch = /^(\s*)illustration: "([^"]*)",\s*$/.exec(line);
    if (existingMatch && currentId) {
      const want = art.get(currentId);
      if (!want) continue; // 图没了 -> 去掉字段，别让客户端 404
      if (existingMatch[2] === want) {
        edit.unchanged++;
        out.push(line);
      } else {
        edit.updated++;
        out.push(`${existingMatch[1]}illustration: "${want}",`);
      }
      continue;
    }

    const briefMatch = /^(\s*)illustrationBrief:/.exec(line);
    if (briefMatch && currentId) {
      const want = art.get(currentId);
      // 上一行已经是本事件的 illustration 时不重复插入（幂等）。
      const previous = out[out.length - 1] ?? "";
      if (want && !/^\s*illustration: "/.test(previous)) {
        out.push(`${briefMatch[1]}illustration: "${want}",`);
        edit.inserted++;
      }
    }
    out.push(line);
  }

  if (!dryRun && (edit.inserted > 0 || edit.updated > 0)) {
    writeFileSync(path, out.join("\n"), "utf8");
  }
  return edit;
}

function main(): void {
  const art = existingArt();
  const missing = TALE_CONTENT.events.filter((event) => !art.has(event.id)).map((e) => e.id);

  console.log(`磁盘上的事件插图 ${art.size}/${TALE_CONTENT.events.length} 张`);
  if (missing.length > 0) console.log(`还缺：${missing.join(", ")}`);

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  for (const fileName of SOURCE_FILES) {
    const edit = backfillFile(fileName, art);
    inserted += edit.inserted;
    updated += edit.updated;
    unchanged += edit.unchanged;
    console.log(
      `  ${fileName}: 新增 ${edit.inserted}／改写 ${edit.updated}／原样 ${edit.unchanged}`
    );
  }
  console.log(
    `${dryRun ? "[dry-run] " : ""}回填合计 新增 ${inserted}／改写 ${updated}／原样 ${unchanged}`
  );
  if (inserted + updated + unchanged !== art.size) {
    console.error(
      `回填数（${inserted + updated + unchanged}）与磁盘图数（${art.size}）不符 —— ` +
        `大概是某个事件的源码格式不合脚本假设，去看一眼。`
    );
    process.exit(1);
  }
}

main();
