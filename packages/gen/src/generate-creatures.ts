// Config-driven creature generation pipeline for 食灵 (shiling).
//
// Flow per creature: text-to-3d preview -> text-to-3d refine -> download GLB.
// Auto-rigging/animation are intentionally NOT invoked here: Meshy's rigging
// API is documented as biped-only ("currently only works well with standard
// humanoid (bipedal) assets") and all three creatures below are quadrupeds.
// See meshy.ts header comment and the pipeline report for details.
//
// Budget discipline: exactly one preview + one refine per creature. No
// automatic retries — if a task fails outright, this script throws and the
// operator decides whether to re-run for that single creature.

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import {
  createTextTo3DPreview,
  createTextTo3DRefine,
  getTextTo3DTask,
  pollTask,
  downloadFile,
  getBalance,
  type AiModel,
  type TextureResolution,
} from "./meshy.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/gen/src -> ../../../ -> packages/client
const MODELS_DIR = join(__dirname, "../../client/public/models");

const AI_MODEL: AiModel = "meshy-6";
const TEXTURE_RESOLUTION: TextureResolution = "2k";
// Game-appropriate polycount for a stylized real-time creature. Only takes
// effect because shouldRemesh is also set to true below.
const TARGET_POLYCOUNT = 20_000;

interface CreatureConfig {
  id: string;
  nameCn: string;
  prompt: string;
  negativePrompt?: string;
  /** Per-creature override of TARGET_POLYCOUNT (M1 B4: fish can go lower than the ~15-20k default). */
  targetPolycount?: number;
}

const NEGATIVE_BASE =
  "photorealistic, real photo, realistic fur texture, blurry, low detail, " +
  "extra limbs, missing legs, distorted anatomy, humanoid, bipedal, two legs, " +
  "text, watermark, logo, multiple creatures, human";

const CREATURES: CreatureConfig[] = [
  {
    id: "youshou",
    nameCn: "幼兽（玩家）",
    prompt:
      "A stylized hand-painted fantasy game creature: a chubby fox-cat hybrid cub, " +
      "four short legs, standing on the ground, small nub-like antlers on its head, " +
      "a big fluffy tail, soft cream-colored belly fur, vivid warm orange coat, " +
      "large round friendly eyes, cute and endearing, clean readable silhouette, " +
      "painterly stylized non-photorealistic look, game-ready 3D asset",
    negativePrompt: `${NEGATIVE_BASE}, scary, menacing, dark colors`,
  },
  {
    id: "lingshu",
    nameCn: "苓鼠（猎物）",
    prompt:
      "A stylized hand-painted fantasy game creature: a plump round cream-white rodent, " +
      "four short stubby legs, standing on the ground, oversized round ears, " +
      "a tiny short tail, big innocent eyes, soft rounded dumpling-shaped body, " +
      "gentle harmless prey animal, clean readable silhouette, painterly stylized " +
      "non-photorealistic look, game-ready 3D asset",
    negativePrompt: `${NEGATIVE_BASE}, long tail, lean body, sharp teeth, predator features, dark colors`,
  },
  {
    id: "tanshou",
    nameCn: "潭狩（猎手）",
    prompt:
      "A stylized hand-painted fantasy game creature: a low-slung menacing panther-like " +
      "predator, four muscular legs, standing on the ground, dark crimson-black fur, " +
      "sharp bony spines running along its back, glowing amber eyes, a long sinuous tail, " +
      "sharp claws, lean powerful quadruped body, dramatic dangerous silhouette, " +
      "painterly stylized non-photorealistic look, game-ready 3D asset",
    negativePrompt: `${NEGATIVE_BASE}, cute, friendly, bright colors, cartoonish, happy expression`,
  },
  // M1 B4 — two new species (溪鱼/穴獾). Prompts kept style-consistent with the three
  // above ("painterly stylized non-photorealistic" + "game-ready 3D asset" boilerplate,
  // same NEGATIVE_BASE). targetPolycount overrides the shared 20k default per the plan's
  // "decimate to ~15k tris (fish can be lower ~8k)" guidance.
  {
    id: "xiyu",
    nameCn: "溪鱼（水生猎物）",
    prompt:
      "A stylized hand-painted fantasy game creature: a small river fish, " +
      "streamlined torpedo-shaped body, silver-teal iridescent scales, " +
      "translucent flowing fins and tail, large round eyes, swimming pose, " +
      "clean readable silhouette, painterly stylized non-photorealistic look, " +
      "game-ready 3D asset",
    negativePrompt: `${NEGATIVE_BASE}, legs, fur, land animal, whiskers, mammal, dry scales`,
    targetPolycount: 8_000,
  },
  {
    id: "xuehuan",
    nameCn: "穴獾（遁地猎物）",
    prompt:
      "A stylized hand-painted fantasy game creature: a stocky burrowing badger-like " +
      "beast, four short strong legs, standing on the ground, broad flat head, " +
      "short powerful digging claws, earth-brown fur with darker facial stripes, " +
      "compact muscular body built for digging, clean readable silhouette, " +
      "painterly stylized non-photorealistic look, game-ready 3D asset",
    negativePrompt: `${NEGATIVE_BASE}, long thin body, feline, snake-like, reptile, scales`,
    targetPolycount: 15_000,
  },
];

interface CreatureResult {
  id: string;
  ok: boolean;
  error?: string;
  previewTaskId?: string;
  refineTaskId?: string;
  glbBytes?: number;
  previewCredits?: number;
  refineCredits?: number;
}

async function generateOne(cfg: CreatureConfig): Promise<CreatureResult> {
  console.log(`\n=== ${cfg.id} (${cfg.nameCn}) ===`);

  console.log(`[${cfg.id}] creating preview task...`);
  const previewTaskId = await createTextTo3DPreview({
    prompt: cfg.prompt,
    negativePrompt: cfg.negativePrompt,
    aiModel: AI_MODEL,
    // IMPORTANT (found the hard way, see pipeline report): target_polycount
    // is only honored when should_remesh is explicitly true. Leaving both
    // unset let the first batch through at raw diffusion-mesh density
    // (300k-920k triangles, 11-28MB GLBs) instead of the intended ~20k.
    shouldRemesh: true,
    targetPolycount: cfg.targetPolycount ?? TARGET_POLYCOUNT,
  });
  console.log(`[${cfg.id}] preview task id: ${previewTaskId}`);

  const preview = await pollTask(`${cfg.id}/preview`, () => getTextTo3DTask(previewTaskId));
  console.log(`[${cfg.id}] preview done, consumed_credits=${preview.consumed_credits}`);

  console.log(`[${cfg.id}] creating refine task...`);
  const refineTaskId = await createTextTo3DRefine({
    previewTaskId,
    textureResolution: TEXTURE_RESOLUTION,
    aiModel: AI_MODEL,
  });
  console.log(`[${cfg.id}] refine task id: ${refineTaskId}`);

  const refine = await pollTask(`${cfg.id}/refine`, () => getTextTo3DTask(refineTaskId));
  console.log(`[${cfg.id}] refine done, consumed_credits=${refine.consumed_credits}`);

  const glbUrl = refine.model_urls?.glb;
  if (!glbUrl) {
    throw new Error(`[${cfg.id}] refine task succeeded but has no model_urls.glb`);
  }

  const destPath = join(MODELS_DIR, `${cfg.id}.glb`);
  console.log(`[${cfg.id}] downloading GLB -> ${destPath}`);
  const bytes = await downloadFile(glbUrl, destPath);
  console.log(`[${cfg.id}] downloaded ${(bytes / 1024).toFixed(0)} KiB`);

  const metaPath = join(MODELS_DIR, `${cfg.id}.json`);
  const metadata = {
    id: cfg.id,
    nameCn: cfg.nameCn,
    generatedAt: new Date().toISOString(),
    pipeline: "packages/gen (Meshy API text-to-3d preview+refine)",
    settings: {
      aiModel: AI_MODEL,
      textureResolution: TEXTURE_RESOLUTION,
    },
    prompt: cfg.prompt,
    negativePrompt: cfg.negativePrompt,
    tasks: {
      previewTaskId,
      refineTaskId,
    },
    credits: {
      preview: preview.consumed_credits,
      refine: refine.consumed_credits,
    },
    glbBytes: bytes,
    thumbnailUrl: refine.thumbnail_url,
    note:
      "Auto-rigging/animation not applied: Meshy's rigging API is documented as " +
      "biped-only; this creature is a quadruped. See meshy-pipeline-report.md.",
  };
  writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

  return {
    id: cfg.id,
    ok: true,
    previewTaskId,
    refineTaskId,
    glbBytes: bytes,
    previewCredits: preview.consumed_credits,
    refineCredits: refine.consumed_credits,
  };
}

// Budget discipline (M1 B4, code review 2026-08-10): CLI args filter which creatures to
// (re)generate, mirroring optimize-glb.ts's `process.argv.slice(2)` convention. Bare
// invocation is a hard error rather than "default to everyone" — a habitual bare
// `pnpm generate` (the exact scenario this guard exists for) would otherwise silently
// re-spend credits regenerating every already-delivered creature in CREATURES every time
// a new species gets appended to the array, which is precisely the accident this file's
// budget-discipline header comment warns about. `--all` is the explicit, unambiguous way
// to actually mean "regenerate everyone."
const requestedIds = process.argv.slice(2);
if (requestedIds.length === 0) {
  console.error(
    `Refusing to run with no arguments — this would regenerate all ${CREATURES.length} creatures ` +
      "and re-spend credits on ones already delivered.\n" +
      `Pass specific ids to (re)generate, e.g.: node src/generate-creatures.ts xiyu xuehuan\n` +
      "Or pass --all to deliberately regenerate every creature in CREATURES."
  );
  process.exit(1);
}
const CREATURES_TO_RUN = requestedIds.includes("--all") ? CREATURES : CREATURES.filter((c) => requestedIds.includes(c.id));

async function main() {
  const balanceBefore = await getBalance();
  console.log(`Meshy credit balance before: ${balanceBefore}`);

  const results: CreatureResult[] = [];
  for (const cfg of CREATURES_TO_RUN) {
    try {
      results.push(await generateOne(cfg));
    } catch (err) {
      console.error(`[${cfg.id}] FAILED:`, err);
      results.push({ id: cfg.id, ok: false, error: String(err) });
    }
  }

  const balanceAfter = await getBalance();
  console.log(`\nMeshy credit balance after: ${balanceAfter}`);
  console.log(`Total credits consumed: ${balanceBefore - balanceAfter}`);

  console.log("\n=== Summary ===");
  for (const r of results) {
    if (r.ok) {
      console.log(
        `${r.id}: OK  preview=${r.previewTaskId} refine=${r.refineTaskId} ` +
          `bytes=${r.glbBytes} credits(preview=${r.previewCredits}, refine=${r.refineCredits})`
      );
    } else {
      console.log(`${r.id}: FAILED  ${r.error}`);
    }
  }

  if (results.some((r) => !r.ok)) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exitCode = 1;
});
