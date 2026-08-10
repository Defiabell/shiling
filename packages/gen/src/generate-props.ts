// Config-driven prop (static set-piece) generation pipeline for 食灵 (shiling).
//
// M2 A2 — owner feedback「布景劣质，能不能生成精致的布景」: static architectural/
// landscape props are Meshy text-to-3d's strongest use case (no rigging/animation
// concerns at all — unlike generate-creatures.ts, these are never meant to move),
// so this script exists as a parallel sibling to generate-creatures.ts rather than
// extending it: props have their own MODELS_DIR (packages/client/public/props/, kept
// separate from public/models/ so creature vs. prop assets stay organizationally
// distinct — see packages/client/src/render/propLibrary.ts for the loader).
//
// Flow per prop: text-to-3d preview -> text-to-3d refine -> download GLB. No
// rigging/animation calls at all (props are inanimate set dressing, not characters —
// there is no "biped-only" caveat to route around here, unlike the creature batch;
// this pipeline simply never calls createRiggingTask/createAnimationTask).
//
// Budget discipline (same convention as generate-creatures.ts): exactly one preview +
// one refine per prop, no automatic retries. 9 props x (preview 20 + refine 10) = 270
// credits total if every single one succeeds first try — matches the plan's "~270
// credits budget" exactly.

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
const MODELS_DIR = join(__dirname, "../../client/public/props");

const AI_MODEL: AiModel = "meshy-6";
const TEXTURE_RESOLUTION: TextureResolution = "2k";
// Plan: "Target polycount 12000 each (props can be lower than creatures)" — lower than
// generate-creatures.ts's 20k default because these are rigid static set dressing (no
// silhouette-reading creature anatomy to preserve at higher density) and most instance
// multiple times in the world (石碑x4/图腾柱x3/云纹岩x3/etc — lower per-instance tri
// budget matters more here than for the handful of unique creatures).
const TARGET_POLYCOUNT = 12_000;

interface PropConfig {
  id: string;
  nameCn: string;
  prompt: string;
  negativePrompt?: string;
}

// Shared negative-prompt tail: keep the whole batch's hand-painted look consistent with
// the creature set (generate-creatures.ts's own NEGATIVE_BASE reads "photorealistic,
// real photo..." for the same reason) and steer away from anything that reads as a
// living creature (props are set dressing, never meant to be mistaken for a spawnable
// entity) or carries embedded text/logos (game asset, not a signage prop).
const NEGATIVE_BASE =
  "photorealistic, real photo, realistic skin texture, blurry, low detail, " +
  "text, watermark, logo, modern, sci-fi, plastic, creature, animal, human, " +
  "character, humanoid";

const PROPS: PropConfig[] = [
  {
    id: "shibei",
    nameCn: "石碑",
    prompt:
      "A stylized hand-painted ancient Chinese stone stele, a tall weathered stone " +
      "slab standing upright, deeply carved mysterious patterns and archaic script " +
      "covering its face, patches of green moss growing across the cracked surface, " +
      "sitting on a simple stone base, painterly stylized non-photorealistic look, " +
      "clean readable silhouette, game-ready 3D asset",
    negativePrompt: `${NEGATIVE_BASE}, readable modern language, flat unweathered surface`,
  },
  {
    id: "tongding",
    nameCn: "铜鼎",
    prompt:
      "A stylized hand-painted ancient Chinese bronze ding tripod cauldron, three " +
      "sturdy legs, round vessel body covered in taotie beast-face motifs and " +
      "geometric relief patterns, weathered green patina covering aged bronze, " +
      "two loop handles at the rim, sitting solidly on the ground, painterly " +
      "stylized non-photorealistic look, clean readable silhouette, game-ready 3D asset",
    negativePrompt: `${NEGATIVE_BASE}, shiny polished metal, gold color, modern cookware`,
  },
  {
    id: "tutengzhu",
    nameCn: "图腾柱",
    prompt:
      "A stylized hand-painted ancient carved wooden totem pole, a tall weathered " +
      "wooden column stacked with several mythical beast faces carved in relief " +
      "along its length, deep wood grain, faded ochre and cinnabar paint remnants " +
      "in the carved grooves, standing upright planted in the ground, painterly " +
      "stylized non-photorealistic look, clean readable silhouette, game-ready 3D asset",
    negativePrompt: `${NEGATIVE_BASE}, metal, stone, totem pole toppled over lying down`,
  },
  {
    id: "shanmen",
    nameCn: "山门",
    prompt:
      "A stylized hand-painted weathered ancient Chinese stone gate arch, two thick " +
      "stone pillars supporting one horizontal stone lintel on top, the lintel " +
      "visibly cracked and chipped with age, faint carved patterns on the pillars, " +
      "standalone freestanding archway with open space between the pillars, " +
      "painterly stylized non-photorealistic look, clean readable silhouette, " +
      "game-ready 3D asset",
    negativePrompt: `${NEGATIVE_BASE}, wooden gate, torii, modern architecture, wall attached, doors`,
  },
  {
    id: "yunwenyan",
    nameCn: "云纹岩",
    prompt:
      "A stylized hand-painted large natural rock formation, a big weathered boulder " +
      "with swirling cloud-pattern carvings etched across its surface, organic " +
      "irregular rock silhouette, mossy patches in the crevices, sitting heavily on " +
      "the ground, painterly stylized non-photorealistic look, clean readable " +
      "silhouette, game-ready 3D asset",
    negativePrompt: `${NEGATIVE_BASE}, perfectly smooth sphere, cut gemstone, crystal, geometric cube`,
  },
  {
    id: "gushu",
    nameCn: "古树",
    prompt:
      "A stylized hand-painted ancient gnarled tree, a massive thick twisted trunk " +
      "with deeply grooved bark, gnarled writhing branches reaching outward and " +
      "upward, sparse patches of red autumn leaves clinging to the branch tips, " +
      "an air of great age and mystery, rooted firmly in the ground, painterly " +
      "stylized non-photorealistic look, clean readable silhouette, game-ready 3D asset",
    negativePrompt: `${NEGATIVE_BASE}, lush full green canopy, thin sapling, dead bare tree`,
  },
  {
    id: "duanqiao",
    nameCn: "断桥",
    prompt:
      "A stylized hand-painted broken white jade bridge fragment, an ornately " +
      "carved white stone bridge deck with decorative railings, one end shattered " +
      "and jagged where the bridge has broken off, delicate carved railing posts " +
      "along the intact side, elegant ancient craftsmanship, painterly stylized " +
      "non-photorealistic look, clean readable silhouette, game-ready 3D asset",
    negativePrompt: `${NEGATIVE_BASE}, complete unbroken bridge, wooden bridge, rope bridge, modern railing`,
  },
  {
    id: "baigu",
    nameCn: "白骨",
    prompt:
      "A stylized hand-painted giant mythical beast skull, an enormous weathered " +
      "bone-white skull half-buried in the ground, deep eye sockets, short broken " +
      "horn stubs on top of the skull, cracked and pitted ancient bone surface, " +
      "an air of a long-dead colossal creature, painterly stylized " +
      "non-photorealistic look, clean readable silhouette, game-ready 3D asset",
    negativePrompt: `${NEGATIVE_BASE}, full skeleton, human skull, clean polished bone, small skull`,
  },
  {
    id: "lingzhi",
    nameCn: "灵芝",
    prompt:
      "A stylized hand-painted oversized glowing lingzhi mushroom cluster growing " +
      "on top of an old tree stump, several large fan-shaped mushroom caps of " +
      "varying size clustered together, caps glowing with soft bioluminescent " +
      "cyan-green light, rich woody stump base, fantastical magical fungus, " +
      "painterly stylized non-photorealistic look, clean readable silhouette, " +
      "game-ready 3D asset",
    negativePrompt: `${NEGATIVE_BASE}, single small mushroom, edible button mushroom, no stump, dull matte caps`,
  },
];

interface PropResult {
  id: string;
  ok: boolean;
  error?: string;
  previewTaskId?: string;
  refineTaskId?: string;
  glbBytes?: number;
  previewCredits?: number;
  refineCredits?: number;
}

async function generateOne(cfg: PropConfig): Promise<PropResult> {
  console.log(`\n=== ${cfg.id} (${cfg.nameCn}) ===`);

  console.log(`[${cfg.id}] creating preview task...`);
  const previewTaskId = await createTextTo3DPreview({
    prompt: cfg.prompt,
    negativePrompt: cfg.negativePrompt,
    aiModel: AI_MODEL,
    // Root-cause fix from the creature batch (meshy-pipeline-report.md) applies here
    // too: target_polycount is only honored when should_remesh is explicitly true.
    shouldRemesh: true,
    targetPolycount: TARGET_POLYCOUNT,
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
      targetPolycount: TARGET_POLYCOUNT,
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
      "Auto-rigging/animation not applicable: this is a static architectural/landscape " +
      "set-piece, not a character — no rigging/animation calls were made for this asset.",
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

// Same budget-discipline guard as generate-creatures.ts: bare invocation is a hard
// error, not "regenerate everyone" — see that file's comment for the exact incident
// this guards against.
const requestedIds = process.argv.slice(2);
if (requestedIds.length === 0) {
  console.error(
    `Refusing to run with no arguments — this would regenerate all ${PROPS.length} props ` +
      "and re-spend credits on ones already delivered.\n" +
      `Pass specific ids to (re)generate, e.g.: node src/generate-props.ts shibei tongding\n` +
      "Or pass --all to deliberately regenerate every prop in PROPS."
  );
  process.exit(1);
}
const PROPS_TO_RUN = requestedIds.includes("--all") ? PROPS : PROPS.filter((p) => requestedIds.includes(p.id));

async function main() {
  const balanceBefore = await getBalance();
  console.log(`Meshy credit balance before: ${balanceBefore}`);

  const results: PropResult[] = [];
  for (const cfg of PROPS_TO_RUN) {
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
