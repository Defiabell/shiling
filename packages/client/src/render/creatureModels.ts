import * as THREE from "three";
import { PALETTE } from "./palette.js";
import type { ModelLibrary, LibraryEntry } from "./modelLibrary.js";

/**
 * A creature's renderable model. Two families share the exact same
 * `CreatureModel` contract below: the original procedural graybox (a named-
 * mount hierarchy of MeshLambertMaterial primitives) for any species without
 * a loaded Meshy GLB, and — as of Postfix 7 (see modelLibrary.ts) — a real
 * Meshy-generated model for youshou/lingshu/tanshou, swapped in transparently
 * via `setModelLibrary()` below. `group`'s origin is the ground-contact point
 * (feet), not the geometric center, for both families — creatureView places
 * it directly at the sim's feet/terrain-surface position, no half-height
 * lift needed.
 *
 * Sim yaw convention: forward = (sin(yaw), cos(yaw)), and creatureView applies
 * `rotation.y = yaw` to `group`. So every model below is built facing +Z at
 * rotation.y = 0 — head/eyes toward +Z, tail toward -Z.
 */
/**
 * Per-frame procedural-animation input, recomputed fresh every call — see
 * `CreatureModel.animate`. `activity`/`locomotion` are deliberately plain
 * `string` rather than importing `@shiling/sim`'s `Activity`/`Locomotion`
 * unions: this module stays sim-agnostic on purpose (true of both the
 * procedural graybox and, since Postfix 7, the Meshy GLB variants above) —
 * creatureView, which already depends on `@shiling/sim` for other types, is
 * where those exact string literals get validated against
 * the real unions.
 */
export interface AnimateCtx {
  activity: string;
  locomotion: string;
  /** Horizontal speed estimate (m/s) from creatureView's interpolation data; ≈0 when stationary. */
  speedHint: number;
  /** Monotonic seconds (wall-clock derived) — the sole phase source for every sin/spring below. */
  tSec: number;
}

export interface CreatureModel {
  group: THREE.Group;
  /**
   * Named anchors — for the procedural graybox, the seam a Meshy GLB swap
   * hangs its own parts off of (see buildGlbCreatureModel), at the same
   * local transform this graybox model uses; for a GLB model itself,
   * bbox-derived M1 attachment points (not currently animated). Species
   * only create the subset of {head, back, tail, jaw} they actually use.
   */
  mounts: Record<string, THREE.Object3D>;
  /**
   * Animation handles for Task 4 (idle bob, attack lunge, tail wag, ...).
   * head/tail double as mounts.head/mounts.tail: the anchor an animation
   * drives *is* the seam a GLB swap replaces (a GLB model's `parts.head`/
   * `.tail` stay undefined — see buildGlbCreatureModel).
   */
  parts: { head?: THREE.Object3D; tail?: THREE.Object3D; body: THREE.Object3D };
  /**
   * Task 4: per-render-frame procedural animation, no skeleton — pure
   * sin/spring writes onto `group`/`parts`. creatureView.applyInterp calls
   * this *after* it has already lerped this frame's interpolated
   * position/yaw onto `group` (see that file's doc comment): the one `+=`
   * below (bob onto `group.position.y`) relies on that ordering to avoid
   * accumulating — every other write here is an absolute
   * baseline-plus-fresh-trig-term assignment, recomputed from `ctx.tSec`
   * each call, so calling this every frame is always safe regardless of
   * call order relative to that lerp.
   */
  animate(ctx: AnimateCtx): void;
  /** Frees every geometry/material in the model, outlines included — creatures die often. */
  dispose(): void;
}

/**
 * Shared `animate` implementation for every living species (youshou/lingshu/
 * tanshou): the M0.5 Task 4 formulas only ever touch `group` and
 * `parts.body`/`head`/`tail`, which every living builder provides in the same
 * shape, so one generic closure covers all three instead of copy-pasted
 * per-species logic.
 *
 * Baseline `body` rotation/scale are captured once here — called as the last
 * step of each builder, after that builder has finished orienting `body`
 * (e.g. `rotation.x = Math.PI/2` to swing the capsule's long axis onto +Z) —
 * so every per-frame write is `baseline + offset`, never a bare overwrite:
 * overwriting absolutely would erase that baked orientation the instant
 * locomotion isn't "swim" (rotation.x) or activity isn't idle/eating
 * (scale.y).
 *
 * Attack-spring state (`attackPitch`) and `lastTSec` (for frameDt) live in
 * this closure, one instance per model — creatureView no longer writes
 * `group.rotation.x` itself (Task 4 moved 100% ownership here), so there is
 * nothing to read back off the object; the spring's "current value" has to be
 * remembered somewhere, and a closure variable scoped to this one model
 * instance is the simplest place.
 */
function createLivingAnimate(
  group: THREE.Group,
  parts: { head?: THREE.Object3D; tail?: THREE.Object3D; body: THREE.Object3D },
): CreatureModel["animate"] {
  const { body, head, tail } = parts;
  const baseBodyRotX = body.rotation.x;
  const baseBodyRotZ = body.rotation.z;
  const baseBodyScaleY = body.scale.y;

  let attackPitch = 0;
  let lastTSec: number | null = null;

  return (ctx: AnimateCtx) => {
    // First call has no prior sample to diff against — 0 keeps the attack
    // spring from jumping on the very first frame instead of racing toward
    // its target using a bogus (huge, or negative on a clock hiccup) dt.
    const frameDt = lastTSec === null ? 0 : Math.max(0, ctx.tSec - lastTSec);
    lastTSec = ctx.tSec;

    const swimming = ctx.locomotion === "swim";
    const bobFreq = 4 + ctx.speedHint * 2;
    const bobAmp = Math.min(0.08, ctx.speedHint * 0.02) * (swimming ? 0.5 : 1);
    // += : relies on creatureView.applyInterp having just written this
    // frame's fresh interpolated position.y immediately before calling
    // animate() — see CreatureModel.animate's doc comment.
    group.position.y += Math.abs(Math.sin(ctx.tSec * bobFreq)) * bobAmp;
    // Same frequency as the bob, per spec ("同频微滚") — a fixed ±0.04 roll
    // regardless of speed, only its rate follows speedHint.
    body.rotation.z = baseBodyRotZ + Math.sin(ctx.tSec * bobFreq) * 0.04;

    body.scale.y =
      ctx.activity === "idle" || ctx.activity === "eating"
        ? baseBodyScaleY + Math.sin(ctx.tSec * 2.2) * 0.02
        : baseBodyScaleY;

    body.rotation.x = baseBodyRotX + (swimming ? Math.sin(ctx.tSec * 3) * 0.08 : 0);

    // Spring always runs (target flips 0.35↔0 on the activity edge) so the
    // lunge eases back out on exit instead of snapping — not gated to only
    // execute "while attacking".
    const targetPitch = ctx.activity === "attacking" ? 0.35 : 0;
    attackPitch += (targetPitch - attackPitch) * Math.min(1, 10 * frameDt);
    group.rotation.x = attackPitch;

    if (head) {
      head.rotation.x = ctx.activity === "eating" ? 0.4 + Math.sin(ctx.tSec * 5) * 0.15 : 0;
    }
    if (tail) {
      tail.rotation.y = Math.sin(ctx.tSec * (2 + ctx.speedHint * 3)) * 0.3;
    }
  };
}

const OUTLINE_SCALE = 1.06;

// ---------------------------------------------------------------------------
// Ground-contact blob shadow (Patch 3b, playtest feedback: 生物悬浮感)
// ---------------------------------------------------------------------------

const SHADOW_COLOR = 0x000000;
const SHADOW_OPACITY = 0.28;
const SHADOW_Y = 0.02;
const SHADOW_RADIUS_FACTOR = 0.55; // ≈0.55× body length, per spec
const SHADOW_SEGMENTS = 20;

/**
 * A flat CircleGeometry disc laid at `group`'s local y=0.02, added *directly*
 * to `group` (never through `attach()`) so it (a) moves with the creature
 * for free via the scene graph, (b) is excluded from ink-outline generation
 * (only `attach()` calls `addOutline`), and (c) — for carcasses — stays flat
 * on the ground undisturbed by the `tilt` child wrapper's rotation (see
 * buildCarcassModel: the shadow is added to `group`, not `tilt`).
 * `polygonOffset` guards against z-fighting with the terrain mesh directly
 * underneath (the disc sits only 0.02 above whatever height sim placed the
 * creature at, which is itself sampled from the same terrain).
 */
function buildGroundShadow(radius: number): THREE.Mesh {
  const geometry = new THREE.CircleGeometry(radius, SHADOW_SEGMENTS);
  geometry.rotateX(-Math.PI / 2); // native normal +Z → +Y, lies flat
  const material = new THREE.MeshBasicMaterial({
    color: SHADOW_COLOR,
    transparent: true,
    opacity: SHADOW_OPACITY,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = SHADOW_Y;
  return mesh;
}

/**
 * Nose-to-tail-tip torso length (full extent along the model's forward axis:
 * capsule length + both end-cap radii for youshou/tanshou, sphere diameter
 * scaled for lingshu) — the same "shared constant" shadowRadiusFor below
 * multiplies by SHADOW_RADIUS_FACTOR. Exported so modelLibrary.ts (Postfix 7,
 * Meshy GLB swap) has one source of truth for the target size each raw GLB
 * gets uniformly rescaled to, instead of a second hand-copied literal that
 * could silently drift from CAPSULE_BODY/LINGSHU_BODY.
 */
export function bodyFootprintLength(species: string): number {
  switch (species) {
    case "youshou":
      return CAPSULE_BODY.youshou.length + 2 * CAPSULE_BODY.youshou.radius;
    case "tanshou":
      return CAPSULE_BODY.tanshou.length + 2 * CAPSULE_BODY.tanshou.radius;
    default:
      // lingshu + defensive fallback, mirrors carcassShape's own default branch.
      return 2 * LINGSHU_BODY.radius * LINGSHU_BODY.scale[2];
  }
}

/**
 * Per-species shadow radius, derived from the same body-shape constants the
 * living models below build their capsule/sphere geometry from (never a
 * hardcoded duplicate) — so a future tweak to CAPSULE_BODY/LINGSHU_BODY can't
 * silently desync the shadow's size from the silhouette it's meant to ground.
 * Shared by both the living builders and buildCarcassModel (a carcass reuses
 * the same underlying body shape — see carcassShape above) — and, as of
 * Postfix 7, by the GLB variants too (bodyFootprintLength is species-shape
 * agnostic either way).
 */
function shadowRadiusFor(species: string): number {
  return SHADOW_RADIUS_FACTOR * bodyFootprintLength(species);
}

interface MeshOpts {
  /** MeshBasicMaterial instead of MeshLambertMaterial — unlit, self-illuminated look (tanshou's eyes). */
  basic?: boolean;
}

/** Builds a mesh with the given geometry/palette color. Set position/rotation/scale on the result before calling attach(). */
function makeMesh(geometry: THREE.BufferGeometry, color: number, opts: MeshOpts = {}): THREE.Mesh {
  const material = opts.basic
    ? new THREE.MeshBasicMaterial({ color })
    : new THREE.MeshLambertMaterial({ color });
  return new THREE.Mesh(geometry, material);
}

/**
 * Clones `mesh`'s geometry into an inverted-hull ink outline (BackSide,
 * 1.06x) and parents it as a *child* of `mesh` (local identity transform,
 * scale 1.06) rather than a value-copied sibling: a child inherits `mesh`'s
 * transform through the scene graph every frame for free, so Task 4's
 * planned per-part animation (rotating/scaling `parts.body` etc. directly)
 * drags the outline along automatically instead of leaving it behind.
 */
function addOutline(mesh: THREE.Mesh): void {
  const outline = new THREE.Mesh(
    mesh.geometry.clone(),
    new THREE.MeshBasicMaterial({ color: PALETTE.outlineInk, side: THREE.BackSide }),
  );
  outline.scale.setScalar(OUTLINE_SCALE);
  mesh.add(outline);
}

/** Adds `mesh` to `parent` plus (unless suppressed) its ink outline child. */
function attach(parent: THREE.Object3D, mesh: THREE.Mesh, withOutline = true): THREE.Mesh {
  parent.add(mesh);
  if (withOutline) addOutline(mesh);
  return mesh;
}

/** A positioned, empty anchor — used both as a GLB-swap mount and as the parent for the part's own meshes. */
function makeMount(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Group {
  const anchor = new THREE.Group();
  anchor.position.set(x, y, z);
  parent.add(anchor);
  return anchor;
}

/** Frees one mesh's own geometry/material (array-aware, matching Mesh.material's union type) — the single-mesh building block disposeTree below traverses with, and the GLB builders' dispose() (Postfix 7) call directly on just their per-instance blob shadow. */
function disposeMesh(mesh: THREE.Mesh): void {
  mesh.geometry.dispose();
  const material = mesh.material;
  if (Array.isArray(material)) material.forEach((m) => m.dispose());
  else material.dispose();
}

/** Frees every geometry/material under `root` (outlines included — traverse() walks the whole subtree regardless of nesting depth). */
function disposeTree(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) disposeMesh(obj);
  });
}

// ---------------------------------------------------------------------------
// Living models
// ---------------------------------------------------------------------------

/**
 * Capsule-body proportions, shared between each species' living model and
 * its carcass (buildCarcassModel deliberately reuses these dimensions in
 * their native, un-rotated orientation — see its doc comment for why).
 * Keeping them here instead of duplicated literals means a future tweak to
 * one living body's size can't silently desync its corpse's silhouette.
 */
const CAPSULE_BODY = {
  youshou: { radius: 0.42, length: 0.7 },
  tanshou: { radius: 0.5, length: 1.4 },
} as const;

function capsuleBodyGeometry(shape: (typeof CAPSULE_BODY)[keyof typeof CAPSULE_BODY]): THREE.BufferGeometry {
  return new THREE.CapsuleGeometry(shape.radius, shape.length, 6, 12);
}

/** 幼兽 youshou (also the player creature — species "youshou" already implies this look, no by-id branch needed). */
function buildYoushouModel(): CreatureModel {
  const group = new THREE.Group();
  const BODY_Y = CAPSULE_BODY.youshou.radius; // underside rests on the ground

  const body = makeMesh(capsuleBodyGeometry(CAPSULE_BODY.youshou), PALETTE.playerBody);
  // Capsule's native long axis is Y (vertical). Rotating +90° about X swings
  // it onto Z (forward) — not the brief's literal rotation.z, which would
  // instead swing it onto X (sideways) and violate the +Z-forward contract above.
  body.rotation.x = Math.PI / 2;
  body.position.set(0, BODY_Y, 0);
  attach(group, body);

  const BELLY_RADIUS = 0.3;
  const belly = makeMesh(new THREE.CapsuleGeometry(BELLY_RADIUS, 0.45, 6, 12), PALETTE.playerBelly);
  belly.rotation.x = Math.PI / 2;
  // Widened sideways (scale.x only — rotation.x=90° leaves the local X axis
  // untouched, so this is a pure world-X stretch, not a vertical one) so it
  // still peeks out past the main body's circular cross-section at this
  // height instead of being fully swallowed by it. position.y = BELLY_RADIUS
  // (not BODY_Y - 0.22, which sank its underside 0.1 below the shared ground
  // plane) so its own underside rests exactly on the ground like the main body.
  belly.scale.x = 1.3;
  belly.position.set(0, BELLY_RADIUS, 0.1);
  attach(group, belly);

  const headMount = makeMount(group, 0, BODY_Y + 0.18, 0.85);
  const head = makeMesh(new THREE.SphereGeometry(0.3, 16, 12), PALETTE.playerBody);
  attach(headMount, head);

  const earL = makeMesh(new THREE.ConeGeometry(0.1, 0.22, 10), PALETTE.playerBody);
  earL.position.set(-0.16, 0.24, -0.05);
  earL.rotation.z = 0.35;
  attach(headMount, earL);
  const earR = makeMesh(new THREE.ConeGeometry(0.1, 0.22, 10), PALETTE.playerBody);
  earR.position.set(0.16, 0.24, -0.05);
  earR.rotation.z = -0.35;
  attach(headMount, earR);

  const tailMount = makeMount(group, 0, BODY_Y + 0.05, -0.85);
  const tail = makeMesh(new THREE.CylinderGeometry(0.05, 0.02, 0.5, 8), PALETTE.playerBody);
  tail.rotation.x = -1.3; // rear-and-up flick ("微翘")
  tail.position.set(0, 0.1, -0.14);
  attach(tailMount, tail);

  group.add(buildGroundShadow(shadowRadiusFor("youshou")));

  const parts = { head: headMount, tail: tailMount, body };
  return {
    group,
    mounts: { head: headMount, tail: tailMount },
    parts,
    animate: createLivingAnimate(group, parts),
    dispose: () => disposeTree(group),
  };
}

/**
 * A near-flat "puck": reads as a big ear disc but, unlike CircleGeometry
 * (brief's literal spec), is a genuine closed volume with front/back faces
 * and a thin rim. CircleGeometry is a single-sided infinitely-thin plane —
 * its inverted-hull outline clone would be exactly coincident with it (scale
 * only grows the in-plane radius, never the zero depth), so the two z-fight
 * across the whole disc instead of producing a rim. rotateX swings the
 * puck's native cap-normal from local Y onto Z, so it drops into the same
 * rotation.y-swings-the-normal-sideways placement code a CircleGeometry
 * would have used.
 */
function earPuckGeometry(radius: number): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(radius, radius, radius * 0.25, 16);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

/** Sphere-body proportions for lingshu, shared with its carcass shape for the same desync-proofing reason as CAPSULE_BODY above. */
const LINGSHU_BODY = { radius: 0.32, scale: [1, 0.8, 1.2] as const };

function lingshuBodyGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(LINGSHU_BODY.radius, 16, 12);
  geometry.scale(...LINGSHU_BODY.scale);
  return geometry;
}

/** 苓鼠 lingshu — small flattened prey, big ear discs. */
function buildLingshuModel(): CreatureModel {
  const group = new THREE.Group();
  const BODY_Y = LINGSHU_BODY.radius * LINGSHU_BODY.scale[1]; // underside rests on the ground

  const body = makeMesh(lingshuBodyGeometry(), PALETTE.lingshuBody);
  body.position.set(0, BODY_Y, 0);
  attach(group, body);

  const headMount = makeMount(group, 0, BODY_Y + 0.06, 0.42);
  const head = makeMesh(new THREE.SphereGeometry(0.16, 12, 10), PALETTE.lingshuBody);
  attach(headMount, head);

  // Puck's face normal is local +Z; rotation.y swings that normal out to ±X
  // so the disc reads edge-on as a big ear sticking out sideways, not as a
  // flat coin glued to the front of the head.
  const earL = makeMesh(earPuckGeometry(0.12), PALETTE.lingshuEar);
  earL.position.set(-0.16, 0.16, 0.02);
  earL.rotation.y = Math.PI / 2.4;
  attach(headMount, earL);
  const earR = makeMesh(earPuckGeometry(0.12), PALETTE.lingshuEar);
  earR.position.set(0.16, 0.16, 0.02);
  earR.rotation.y = -Math.PI / 2.4;
  attach(headMount, earR);

  const tailMount = makeMount(group, 0, BODY_Y, -0.36);
  const tail = makeMesh(new THREE.CylinderGeometry(0.025, 0.015, 0.22, 8), PALETTE.lingshuBody);
  tail.rotation.x = -Math.PI / 2 + 0.2;
  tail.position.set(0, 0, -0.08);
  attach(tailMount, tail);

  group.add(buildGroundShadow(shadowRadiusFor("lingshu")));

  const parts = { head: headMount, tail: tailMount, body };
  return {
    group,
    mounts: { head: headMount, tail: tailMount },
    parts,
    animate: createLivingAnimate(group, parts),
    dispose: () => disposeTree(group),
  };
}

/** 潭狩 tanshou — long low predator, box head, glowing threat-read eyes, back spikes. */
function buildTanshouModel(): CreatureModel {
  const group = new THREE.Group();
  // Underside rests on the ground (not sunk below it — the "低伏"/crouched
  // read comes from the capsule's large radius and long, low silhouette,
  // not from embedding the body in the terrain, which the model has no
  // legs to visually bridge).
  const BODY_Y = CAPSULE_BODY.tanshou.radius;

  const body = makeMesh(capsuleBodyGeometry(CAPSULE_BODY.tanshou), PALETTE.tanshouBody);
  body.rotation.x = Math.PI / 2; // see youshou's body comment for why X (not the brief's literal Z)
  body.position.set(0, BODY_Y, 0);
  attach(group, body);

  const headMount = makeMount(group, 0, BODY_Y + 0.05, 1.35);
  const head = makeMesh(new THREE.BoxGeometry(0.55, 0.4, 0.7), PALETTE.tanshouHead);
  attach(headMount, head);

  // Eyes: unlit MeshBasicMaterial reads as a glow regardless of scene
  // lighting, the "threat you can spot in the dark" cue from the brief.
  const eyeL = makeMesh(new THREE.SphereGeometry(0.05, 8, 6), PALETTE.tanshouEye, { basic: true });
  eyeL.position.set(-0.15, 0.08, 0.3);
  attach(headMount, eyeL);
  const eyeR = makeMesh(new THREE.SphereGeometry(0.05, 8, 6), PALETTE.tanshouEye, { basic: true });
  eyeR.position.set(0.15, 0.08, 0.3);
  attach(headMount, eyeR);

  const backMount = makeMount(group, 0, BODY_Y + 0.5, 0);
  for (const z of [0.35, 0, -0.35]) {
    const spike = makeMesh(new THREE.ConeGeometry(0.08, 0.2, 10), PALETTE.tanshouBody);
    spike.position.set(0, 0.1, z);
    attach(backMount, spike);
  }

  const tailMount = makeMount(group, 0, BODY_Y + 0.05, -1.2);
  const tail = makeMesh(new THREE.CylinderGeometry(0.07, 0.03, 0.9, 10), PALETTE.tanshouBody);
  tail.rotation.x = -Math.PI / 2 + 0.1; // trails low and mostly straight back
  tail.position.set(0, 0, -0.4);
  attach(tailMount, tail);

  group.add(buildGroundShadow(shadowRadiusFor("tanshou")));

  const parts = { head: headMount, tail: tailMount, body };
  return {
    group,
    mounts: { head: headMount, tail: tailMount, back: backMount },
    parts,
    animate: createLivingAnimate(group, parts),
    dispose: () => disposeTree(group),
  };
}

// ---------------------------------------------------------------------------
// Meshy GLB swap (Postfix 7) — module-level library injection
// ---------------------------------------------------------------------------

/**
 * Set once by main.ts after `loadModelLibrary()` (modelLibrary.ts) resolves
 * during the title-screen preload. Module-level rather than a parameter
 * threaded through creatureView.ts/syncCreatures: keeps every existing
 * `buildCreatureModel(species)` / `buildCarcassModel(species)` call site
 * unchanged — this file is the only one that needs to know a library exists.
 * Starts `{}` (every species reads as "no GLB yet") so a build that runs
 * before the preload resolves — or a species whose GLB failed to load — just
 * falls through to the procedural builders below, no null-checks needed at
 * the call sites.
 */
let modelLibrary: ModelLibrary = {};

/** Called once by main.ts once loadModelLibrary() resolves (or a species entry is null — see that file's per-species try/catch). */
export function setModelLibrary(library: ModelLibrary): void {
  modelLibrary = library;
}

/**
 * GLB swap for a species with a loaded Meshy model: same CreatureModel
 * contract as the procedural builders above, but `parts.body` is a torso-
 * height pivot wrapping the whole single-mesh GLB (see the pivot comment
 * below) and head/tail stay undefined — createLivingAnimate's optional-
 * chaining on those two already no-ops (see its doc comment), so bob/breath/
 * attack-lean still apply to the whole model via `group`/`parts.body`, just
 * without the separate head-nod/tail-wag sub-animation the procedural models
 * drive on their own separate head/tail mounts.
 *
 * No ink outline (deliberate style call, unlike every procedural model
 * above): these are PBR-textured ~20k-tri imports, and an inverted-hull
 * outline would double the triangle count *and* visually fight the baked
 * texture read that a flat-color procedural mesh doesn't have to contend
 * with — procedural fallbacks (GLB load failure) keep their outline as
 * normal, only the GLB path skips it.
 */
function buildGlbCreatureModel(species: string, entry: LibraryEntry): CreatureModel {
  const group = new THREE.Group();

  // entry.geometry/entry.livingMaterial are library-owned and shared across
  // every live instance of this species (e.g. 26 lingshu share one GPU
  // buffer) — only this Mesh wrapper is per-instance. See dispose() below.
  const body = new THREE.Mesh(entry.geometry, entry.livingMaterial);

  // createLivingAnimate's breathing scale / roll / swim-tilt writes go onto
  // whatever it's handed as `parts.body`, rotating/scaling around *that
  // object's own local origin* — every procedural body positions itself at
  // roughly torso-center height for exactly this reason (e.g.
  // buildYoushouModel's `body.position.set(0, BODY_Y, 0)`). entry.geometry's
  // own local origin, by contrast, sits at the model's FEET (modelLibrary.ts
  // bakes ground-alignment to y=0), so rotating `body` directly would swing
  // the whole model's silhouette around a much longer lever arm than the
  // procedural amplitudes were tuned against. `pivot` re-centers that origin
  // to roughly torso height and is what actually gets passed to `parts.body`
  // below — `body` itself is never touched again after this offset.
  const pivotY = entry.bbox.max.y * 0.5;
  body.position.y = -pivotY;
  const pivot = new THREE.Group();
  pivot.position.y = pivotY;
  pivot.add(body);
  group.add(pivot);

  // Mount anchors derived from the baked (ground-aligned, +Z-facing) bbox —
  // added straight to `group` (not `pivot`), so they stay put regardless of
  // the breathing/roll animation above; not wired into `parts` (so
  // createLivingAnimate never touches them either), kept for M1 (future
  // attachments/effects hanging off a specific body point).
  const headMount = makeMount(group, 0, entry.bbox.max.y * 0.8, entry.bbox.max.z);
  const backMount = makeMount(group, 0, entry.bbox.max.y, (entry.bbox.max.z + entry.bbox.min.z) / 2);
  const tailMount = makeMount(group, 0, entry.bbox.max.y * 0.3, entry.bbox.min.z);

  const shadow = buildGroundShadow(shadowRadiusFor(species));
  group.add(shadow);

  const parts = { body: pivot };
  return {
    group,
    mounts: { head: headMount, back: backMount, tail: tailMount },
    parts,
    animate: createLivingAnimate(group, parts),
    dispose: () => {
      // entry.geometry/entry.livingMaterial are library-owned — never
      // disposed here, that would break every other living instance of this
      // species still sharing the same GPU buffers. Only the shadow disc
      // (built fresh per instance by buildGroundShadow) belongs to us alone.
      disposeMesh(shadow);
    },
  };
}

export function buildCreatureModel(species: string): CreatureModel {
  const entry = modelLibrary[species];
  if (entry) return buildGlbCreatureModel(species, entry);
  switch (species) {
    case "youshou":
      return buildYoushouModel();
    case "tanshou":
      return buildTanshouModel();
    default:
      // Defensive fallback, mirrors the previous graybox-mesh convention: M0
      // content only ever spawns lingshu/tanshou NPCs alongside the youshou
      // player, so any unrecognized species reads as lingshu.
      return buildLingshuModel();
  }
}

// ---------------------------------------------------------------------------
// Carcasses
// ---------------------------------------------------------------------------

interface CarcassShape {
  makeGeometry(): THREE.BufferGeometry;
}

/** Reuses each species' living-body silhouette proportions (CAPSULE_BODY/LINGSHU_BODY above), in their native (un-rotated) orientation. */
function carcassShape(species: string): CarcassShape {
  switch (species) {
    case "youshou":
      return { makeGeometry: () => capsuleBodyGeometry(CAPSULE_BODY.youshou) };
    case "tanshou":
      return { makeGeometry: () => capsuleBodyGeometry(CAPSULE_BODY.tanshou) };
    default:
      // lingshu + defensive fallback for any unforeseen species.
      return { makeGeometry: () => lingshuBodyGeometry() };
  }
}

const CARCASS_SQUASH_Y = 0.35;
const CARCASS_TILT_Z = 0.6;

/**
 * How far to lift the `tilt` wrapper so the squashed+tipped carcass's lowest
 * vertex lands exactly on the ground (y=0), instead of a shared guessed
 * `position.y` (the M0.5 Task 3 bug this replaces: one magic offset applied
 * across three different species' radii/lengths, sinking each one a
 * different, wrong amount below ground once tipped).
 *
 * `tilt.rotation.z` sweeps everything inside `tilt` around *tilt's own*
 * origin. A fixed offset baked onto `body.position` (a child of `tilt`,
 * applied *before* that rotation) gets swept along by it too — how far its
 * lowest point ends up below tilt's origin then depends on the body's own
 * radius/length in a way a single shared constant can't capture. So instead
 * of guessing, this measures the actual squashed+rotated geometry (mirroring
 * exactly what `body`/`tilt` apply at render time — see the two calls below)
 * and lands the correction on `tilt.position.y`, which — unlike `body`'s
 * position — is translated *after* `tilt`'s own rotation in the composed
 * transform (Three.js composes an Object3D's local matrix as T·R·S), so it
 * is not itself swept by it.
 */
function carcassGroundLift(geometry: THREE.BufferGeometry): number {
  const probe = geometry.clone();
  probe.scale(1, CARCASS_SQUASH_Y, 1);
  probe.rotateZ(CARCASS_TILT_Z);
  probe.computeBoundingBox();
  const minY = probe.boundingBox?.min.y ?? 0;
  probe.dispose();
  return -minY;
}

/**
 * GLB carcass variant — reuses the exact same baked geometry as the living
 * GLB model (library-owned, never disposed here — see buildGlbCreatureModel's
 * dispose() comment, same ownership rule applies) with the OTHER shared
 * material clone (`entry.carcassMaterial`, tinted PALETTE.carcass once at
 * load time in modelLibrary.ts), squashed/tilted/ground-lifted exactly like
 * the procedural carcasses below. carcassGroundLift works on *any*
 * BufferGeometry — it was written against capsule/sphere shapes but only
 * ever does a generic clone→scale→rotateZ→bbox probe, so the already
 * ground-aligned, +Z-facing GLB geometry plugs in unchanged.
 */
function buildGlbCarcassModel(species: string, entry: LibraryEntry): CreatureModel {
  const group = new THREE.Group();

  const body = new THREE.Mesh(entry.geometry, entry.carcassMaterial);
  body.scale.y = CARCASS_SQUASH_Y;

  const tilt = new THREE.Group();
  tilt.rotation.z = CARCASS_TILT_Z;
  tilt.position.y = carcassGroundLift(entry.geometry);
  tilt.add(body);
  group.add(tilt); // no outline: GLB carcasses never had one to begin with (see buildGlbCreatureModel)

  const shadow = buildGroundShadow(shadowRadiusFor(species));
  group.add(shadow);

  return {
    group,
    mounts: {},
    parts: { body },
    // No-op per spec, same reasoning as the procedural carcass below (a
    // carcass never locomotes/breathes/attacks/eats).
    animate: () => {},
    dispose: () => {
      // entry.geometry/entry.carcassMaterial are library-owned — never
      // disposed here (see buildGlbCreatureModel's dispose() comment).
      disposeMesh(shadow);
    },
  };
}

/**
 * 尸体：flattened, uniformly carcass-tinted, tipped over, no outline ("消隐感").
 *
 * Reuses the *native* (un-rotated) body geometry rather than the living
 * model's already-forward-facing instance: squashing that instance's own Y
 * axis would shorten its length (rotation.x baked the long axis onto Z),
 * whereas squashing the native vertical capsule/sphere pancakes its standing
 * height instead — the "collapsed" look this spec wants.
 */
export function buildCarcassModel(species: string): CreatureModel {
  const entry = modelLibrary[species];
  if (entry) return buildGlbCarcassModel(species, entry);
  const group = new THREE.Group();
  const shape = carcassShape(species);
  const geometry = shape.makeGeometry();

  const body = makeMesh(geometry, PALETTE.carcass);
  body.scale.y = CARCASS_SQUASH_Y;

  // creatureView drives `group.rotation` every frame (yaw + attack-pitch), so
  // the sideways tip has to live on a child wrapper instead: setting it on
  // `group` directly would get overwritten by the very next applyInterp() call.
  const tilt = new THREE.Group();
  tilt.rotation.z = CARCASS_TILT_Z;
  tilt.position.y = carcassGroundLift(geometry);
  tilt.add(body);
  group.add(tilt); // no outline() call: carcass models are unlined per spec

  // Added to `group`, not `tilt`: the shadow must stay flat on the ground
  // regardless of the carcass's sideways tip-over (see buildGroundShadow's
  // doc comment).
  group.add(buildGroundShadow(shadowRadiusFor(species)));

  return {
    group,
    mounts: {},
    parts: { body },
    // No-op per spec: a carcass never locomotes/breathes/attacks/eats, and
    // critically must never touch `group.rotation.x` — the inner `tilt`
    // child (see comment above) already owns the tip-over, and creatureView
    // no longer writes a fixed attack-pitch onto `group` itself, so leaving
    // this empty is what keeps `group.rotation`/`.position.y` exactly what
    // applyInterp's lerp wrote, undisturbed.
    animate: () => {},
    dispose: () => disposeTree(group),
  };
}
