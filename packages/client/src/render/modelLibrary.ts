import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { PALETTE } from "./palette.js";
import { bodyFootprintLength } from "./creatureModels.js";

/**
 * Postfix 7 — Meshy-generated creature GLB swap.
 *
 * Loads the three static (unrigged, un-animated — see
 * `.superpowers/sdd/2026-08-07-m05-ink-visual-plan/meshy-pipeline-report.md`)
 * GLBs in `public/models/`, normalizes each one (rotate to face +Z, uniform
 * scale to the procedural model's own body-length footprint, ground-align to
 * y=0), and bakes that normalization directly into a fresh shared
 * BufferGeometry per species — so every later creatureModels.ts clone is just
 * `new THREE.Mesh(entry.geometry, entry.livingMaterial)`, no per-instance
 * wrapper transform needed, and every clone of the same species shares the
 * exact same GPU-side geometry/material buffers (26 lingshu instances must
 * not multiply either).
 *
 * Called once, at boot, by main.ts — see that file's `loadModelLibrary()`
 * call next to `showTitle()` for the title-screen preload gate this exists
 * to serve. `setModelLibrary()` (creatureModels.ts) wires the resolved
 * library into `buildCreatureModel`/`buildCarcassModel`.
 */

export interface LibraryEntry {
  /**
   * Fully baked (rotated + uniformly scaled + ground-aligned so min.y === 0)
   * — shared across every living AND carcass instance of this species. NEVER
   * disposed per-creature; the library owns it for the page's lifetime (see
   * creatureModels.ts's buildGlbCreatureModel/buildGlbCarcassModel dispose()
   * comments).
   */
  geometry: THREE.BufferGeometry;
  /** One shared clone of the GLB's own material, used by every living instance — tweak envMapIntensity/etc. here ONCE, never per-clone. */
  livingMaterial: THREE.MeshStandardMaterial;
  /** A SECOND shared clone, tinted PALETTE.carcass once at load time — used by every carcass instance of this species. */
  carcassMaterial: THREE.MeshStandardMaterial;
  /** Bbox of the baked geometry (min.y ≈ 0, centered-ish in X/Z) — creatureModels.ts derives mount anchors and reuses it as carcassGroundLift's input. */
  bbox: THREE.Box3;
}

/** Species → entry, or absent if that species' GLB failed to load (procedural fallback stays in effect — see loadOne's catch). */
export type ModelLibrary = Partial<Record<string, LibraryEntry>>;

interface SpeciesConfig {
  file: string;
  /**
   * Degrees to rotate the raw GLB about Y so its head points toward +Z,
   * matching creatureModels.ts's "every model faces +Z at rotation.y=0"
   * convention. Measured per-species, NOT computed generically: youshou/
   * lingshu's raw GLBs already face +Z natively (0°). tanshou's does not —
   * its raw bounding box is longest along X, but the model isn't axis-
   * aligned at all (a naive minimal-cross-section bbox sweep falsely
   * suggested 90°, dominated by its splayed front legs, not its spine); the
   * correct value was found by orbiting a Playwright-driven camera around
   * the untouched GLB and eyeballing which rotation puts the face dead-on
   * toward a camera on the +Z axis (see postfix-7-report.md's inspection
   * screenshots) — 57° is where both eyes/the nose read symmetrically
   * front-on, not a value derived from any bbox formula.
   */
  rotationYDeg: number;
}

const MODEL_CONFIG: Record<string, SpeciesConfig> = {
  youshou: { file: "youshou.glb", rotationYDeg: 0 },
  lingshu: { file: "lingshu.glb", rotationYDeg: 0 },
  tanshou: { file: "tanshou.glb", rotationYDeg: 57 },
  // M1 B4 — verified with the same empirical method tanshou's 57° was found with (see
  // this interface's doc comment above), not assumed just because these are fresh
  // generations from the same pipeline: a standalone rotation-probe scene (raw GLB, no
  // baked transform, four cardinal camera positions ±X/±Z) confirmed both models'
  // faces/eyes read front-on from the +Z camera and their tails/hindquarters from -Z —
  // i.e. both happen to already export facing +Z natively, unlike tanshou.
  xiyu: { file: "xiyu.glb", rotationYDeg: 0 },
  xuehuan: { file: "xuehuan.glb", rotationYDeg: 0 },
};

/** First Mesh found anywhere in the GLTF scene graph — every current asset is a single mesh/single material (see pipeline report), but this stays robust to a future re-export with a deeper node hierarchy. */
function findFirstMesh(root: THREE.Object3D): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  root.traverse((obj) => {
    if (!found && obj instanceof THREE.Mesh) found = obj;
  });
  return found;
}

/**
 * Same-origin static asset, so this should resolve in well under a second —
 * generous enough to never trip in normal operation, but bounded so a
 * genuinely stalled (not erroring) fetch can't leave `loadModelLibrary()`'s
 * promise permanently pending: title.ts's "入山" button is gated on that
 * exact promise, and a request that never settles would otherwise leave the
 * button disabled forever with no way to recover short of a page reload.
 */
const LOAD_TIMEOUT_MS = 15000;

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms));
}

async function loadOne(species: string, config: SpeciesConfig): Promise<LibraryEntry | null> {
  try {
    const gltf = await Promise.race([new GLTFLoader().loadAsync(`/models/${config.file}`), timeout(LOAD_TIMEOUT_MS)]);
    const mesh = findFirstMesh(gltf.scene);
    if (!mesh) throw new Error(`no mesh found in ${config.file}`);

    // Orient + scale on the *root*, not the mesh directly — matrixWorld below
    // composes through however many ancestor nodes the GLB export used, so
    // this stays correct regardless of nesting depth.
    gltf.scene.rotation.y = (config.rotationYDeg * Math.PI) / 180;
    gltf.scene.updateWorldMatrix(true, true);

    const rawSize = new THREE.Vector3();
    new THREE.Box3().setFromObject(mesh).getSize(rawSize);
    // Uniform scale so the model's own nose-to-tail (+Z) extent matches the
    // procedural model's body-length footprint for this species — the two
    // are otherwise unrelated numbers (Meshy normalizes every generated mesh
    // to a similar canonical bounding size regardless of the described
    // creature, so youshou/lingshu/tanshou's raw GLBs are all within ~20% of
    // each other despite lingshu being conceptually much smaller — this
    // rescale is what restores the correct *relative* sizing between them).
    const scale = bodyFootprintLength(species) / rawSize.z;
    gltf.scene.scale.setScalar(scale);
    gltf.scene.updateWorldMatrix(true, true);

    // Bake rotation+scale into a fresh geometry (BufferGeometry.applyMatrix4
    // correctly transforms normals too, not just positions) so every future
    // clone is a bare, already-normalized buffer — no wrapper transform for
    // creatureModels.ts to carry around per instance.
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);

    // Ground-align: translate so the lowest vertex sits exactly at y=0,
    // measured from the actual transformed geometry (this project's
    // established standard — see creatureModels.ts's carcassGroundLift),
    // never a guessed per-species constant.
    geometry.computeBoundingBox();
    const groundLift = -(geometry.boundingBox?.min.y ?? 0);
    geometry.translate(0, groundLift, 0);
    geometry.computeBoundingBox();
    const bbox = geometry.boundingBox!.clone();

    const original = mesh.material as THREE.MeshStandardMaterial;
    const livingMaterial = original.clone();
    // Second independent clone (not livingMaterial.clone() — either order
    // reaches the same result, this just reads as "two siblings off the
    // original" rather than "a clone of a clone") tinted PALETTE.carcass,
    // the same flat tint every procedural carcass already uses, applied by
    // multiplying the GLB's own baseColor texture rather than discarding it
    // (MeshStandardMaterial's `color` multiplies `map` in the shader) — the
    // corpse keeps its GLB silhouette/detail but reads desaturated/lifeless.
    const carcassMaterial = original.clone();
    carcassMaterial.color = new THREE.Color(PALETTE.carcass);

    return { geometry, livingMaterial, carcassMaterial, bbox };
  } catch (err) {
    // Fallback per spec: this species keeps its procedural model (the
    // library simply has no entry for it — see ModelLibrary's doc comment),
    // game stays playable.
    console.warn(`modelLibrary: failed to load ${species} (${config.file}), keeping procedural fallback`, err);
    return null;
  }
}

/**
 * Kicked off once at boot (main.ts) alongside the title-screen preload gate.
 * Every species loads independently and in parallel — one failing never
 * blocks or downgrades the other two.
 */
export async function loadModelLibrary(): Promise<ModelLibrary> {
  const species = Object.keys(MODEL_CONFIG);
  const entries = await Promise.all(species.map((s) => loadOne(s, MODEL_CONFIG[s]!)));
  const library: ModelLibrary = {};
  species.forEach((s, i) => {
    const entry = entries[i];
    if (entry) library[s] = entry;
  });
  return library;
}
