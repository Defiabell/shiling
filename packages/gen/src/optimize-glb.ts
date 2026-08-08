// One-off / as-needed local remediation: decimates a GLB down to a
// game-appropriate polycount and shrinks its texture, with zero additional
// Meshy API calls (no credits spent). Root cause of oversized GLBs is fixed
// in generate-creatures.ts (should_remesh + target_polycount now set on the
// preview request) — this script exists as a manual escape hatch for the
// first batch (generated before that fix) and for any future output that
// still comes back oversized.
//
// Uses the installed @gltf-transform/cli binary via child_process rather than
// its programmatic API, matching what was manually verified interactively:
// --compress false (no Draco/meshopt) and no texture format conversion so the
// output stays a plain GLB loadable by any stock GLTFLoader — the client
// hasn't wired up any decoder for compressed geometry/KTX2 yet, and this
// pipeline should not force that dependency on it.
//
// Usage: node src/optimize-glb.ts [id...]   (defaults to all three creatures)

import { execFileSync } from "node:child_process";
import { existsSync, renameSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = join(__dirname, "../../client/public/models");
const CLI = join(__dirname, "../node_modules/.bin/gltf-transform");

interface OptimizeConfig {
  id: string;
  // Target fraction of vertices to keep (meshoptimizer edge-collapse).
  // Chosen per-creature to land near ~20k triangles from this batch's raw
  // (un-remeshed) output. Re-tune if you re-run this against different
  // source geometry.
  simplifyRatio: number;
}

const TARGETS: OptimizeConfig[] = [
  { id: "youshou", simplifyRatio: 0.05 },
  { id: "lingshu", simplifyRatio: 0.022 },
  { id: "tanshou", simplifyRatio: 0.066 },
];

function optimizeOne(cfg: OptimizeConfig): void {
  const src = join(MODELS_DIR, `${cfg.id}.glb`);
  if (!existsSync(src)) {
    console.warn(`[${cfg.id}] skip: ${src} not found`);
    return;
  }
  const tmp = join(MODELS_DIR, `${cfg.id}.opt.glb`);
  const before = statSync(src).size;

  execFileSync(
    CLI,
    [
      "optimize",
      src,
      tmp,
      "--compress",
      "false",
      "--texture-compress",
      "auto",
      "--texture-size",
      "1024",
      "--simplify",
      "true",
      "--simplify-ratio",
      String(cfg.simplifyRatio),
      "--simplify-error",
      "0.01",
    ],
    { stdio: "inherit" }
  );

  const after = statSync(tmp).size;
  renameSync(tmp, src);
  console.log(`[${cfg.id}] optimized ${(before / 1024).toFixed(0)}KiB -> ${(after / 1024).toFixed(0)}KiB`);

  const metaPath = join(MODELS_DIR, `${cfg.id}.json`);
  if (existsSync(metaPath)) {
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    meta.optimization = {
      tool: "@gltf-transform/cli optimize",
      appliedAt: new Date().toISOString(),
      params: {
        compress: false,
        textureCompress: "auto",
        textureSize: 1024,
        simplifyRatio: cfg.simplifyRatio,
        simplifyError: 0.01,
      },
      glbBytesBeforeOptimize: before,
      glbBytesAfterOptimize: after,
      reason:
        "Raw Meshy refine output was 300k-920k triangles (should_remesh was not " +
        "set on the preview request), producing 11-28MB GLBs. Decimated locally " +
        "with meshoptimizer instead of re-spending credits on a redo.",
    };
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  }
}

const ids = process.argv.slice(2);
const targets = ids.length > 0 ? TARGETS.filter((t) => ids.includes(t.id)) : TARGETS;
for (const t of targets) optimizeOne(t);
