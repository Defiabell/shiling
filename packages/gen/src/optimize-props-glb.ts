// One-off / as-needed local remediation for the props batch — parallel sibling to
// optimize-glb.ts (creature batch), same tool/flags, different MODELS_DIR/TARGETS.
// See optimize-glb.ts's header comment for the full rationale (meshoptimizer edge-
// collapse + texture downsize, --compress false so no client-side decoder dependency
// is introduced). generate-props.ts already sets should_remesh+target_polycount at
// generation time, so this is a data-driven fallback (run only against whichever
// prop actually still comes back oversized), not an assumed-necessary step.
//
// Usage: node src/optimize-props-glb.ts <id> [--simplify-ratio R] [--texture-size N]
//   Defaults: --texture-size 1024 (matches the creature batch's final texture weight),
//   no --simplify-ratio (geometry untouched) — pass one explicitly only for a prop
//   whose downloaded GLB is actually still oversized after generation.

import { execFileSync } from "node:child_process";
import { existsSync, renameSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = join(__dirname, "../../client/public/props");
const CLI = join(__dirname, "../node_modules/.bin/gltf-transform");

function parseArgs(argv: string[]): { id: string; simplifyRatio: number | null; textureSize: number } {
  const id = argv[0];
  if (!id) {
    console.error("Usage: node src/optimize-props-glb.ts <id> [--simplify-ratio R] [--texture-size N]");
    process.exit(1);
  }
  let simplifyRatio: number | null = null;
  let textureSize = 1024;
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--simplify-ratio") simplifyRatio = Number(argv[++i]);
    if (argv[i] === "--texture-size") textureSize = Number(argv[++i]);
  }
  return { id, simplifyRatio, textureSize };
}

function optimizeOne(id: string, simplifyRatio: number | null, textureSize: number): void {
  const src = join(MODELS_DIR, `${id}.glb`);
  if (!existsSync(src)) {
    console.warn(`[${id}] skip: ${src} not found`);
    return;
  }
  const tmp = join(MODELS_DIR, `${id}.opt.glb`);
  const before = statSync(src).size;
  const simplify = simplifyRatio !== null;

  const args = [
    "optimize",
    src,
    tmp,
    "--compress",
    "false",
    "--texture-compress",
    "auto",
    "--texture-size",
    String(textureSize),
    "--simplify",
    String(simplify),
  ];
  if (simplify) args.push("--simplify-ratio", String(simplifyRatio), "--simplify-error", "0.01");

  execFileSync(CLI, args, { stdio: "inherit" });

  const after = statSync(tmp).size;
  renameSync(tmp, src);
  console.log(`[${id}] optimized ${(before / 1024).toFixed(0)}KiB -> ${(after / 1024).toFixed(0)}KiB`);

  const metaPath = join(MODELS_DIR, `${id}.json`);
  if (existsSync(metaPath)) {
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    meta.optimization = {
      tool: "@gltf-transform/cli optimize",
      appliedAt: new Date().toISOString(),
      params: {
        compress: false,
        textureCompress: "auto",
        textureSize,
        simplify,
        ...(simplify ? { simplifyRatio, simplifyError: 0.01 } : {}),
      },
      glbBytesBeforeOptimize: before,
      glbBytesAfterOptimize: after,
      reason: simplify
        ? "Downloaded GLB came back oversized despite should_remesh+target_polycount at " +
          "generation time; decimated locally with meshoptimizer instead of re-spending credits."
        : "Geometry was already on-target at generation time; this pass only shrinks the texture.",
    };
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  }
}

const { id, simplifyRatio, textureSize } = parseArgs(process.argv.slice(2));
optimizeOne(id, simplifyRatio, textureSize);
