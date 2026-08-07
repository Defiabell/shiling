import * as THREE from "three";
import type { GameState, Vec3 } from "@shiling/sim";
import { buildCarcassModel, buildCreatureModel, type CreatureModel } from "./creatureModels.js";

// Graybox visual feedback: pitch the mesh forward this many radians while the
// underlying sim activity is "attacking" (client only reflects state, it
// never decides when an attack happens). Task 4 will replace this hard snap
// with a spring animation driven off model.parts instead of the whole group.
const ATTACK_TILT_RAD = 0.3;

export interface CreatureView {
  /** = model.group. Kept as a top-level field (existing call sites read .mesh.position for the follow camera). */
  mesh: THREE.Object3D;
  /** Frees model.group's geometries/materials, outlines included. */
  dispose: () => void;
  /** World position at the start of the current fixed step (interpolation source). */
  prevPos: THREE.Vector3;
  /** World position at the end of the current fixed step (interpolation target). */
  currPos: THREE.Vector3;
  prevYaw: number;
  currYaw: number;
  /** Set from the most recent state read; drives the attack forward-tilt in applyInterp. */
  attacking: boolean;
}

/**
 * Keyed by `${kind}:${id}`, not by bare numeric id: killCreature keeps a dead
 * player in state.creatures (only non-player kills are filtered out) while
 * also pushing a carcass with the *same* numeric id, so a dead player and its
 * own carcass would collide under a plain id key.
 */
export type CreatureViews = Map<string, CreatureView>;

function creatureKey(id: number): string {
  return `creature:${id}`;
}

function carcassKey(id: number): string {
  return `carcass:${id}`;
}

/** Creates a view whose prevPos/currPos both start at the model's spawn position, so a freshly-added model never pops from some default. */
function newView(model: CreatureModel, groundPos: Vec3, yaw: number): CreatureView {
  const pos = new THREE.Vector3(groundPos.x, groundPos.y, groundPos.z);
  model.group.position.copy(pos);
  // "YXZ": yaw (world Y) applied before pitch (local X), so the attack tilt
  // always pitches the nose relative to current facing, not a fixed world
  // axis. Harmless for carcasses — their pitch/yaw stay 0, and their own
  // tip-over lives on an inner wrapper this rotation.order never touches.
  model.group.rotation.order = "YXZ";
  return {
    mesh: model.group,
    dispose: () => model.dispose(),
    prevPos: pos.clone(),
    currPos: pos.clone(),
    prevYaw: yaw,
    currYaw: yaw,
    attacking: false,
  };
}

/**
 * Reconciles the view registry against live sim state: adds models for
 * newly-appeared creatures/carcasses, removes models for ones that vanished
 * (a kill removes the prey from state.creatures; a fully-eaten carcass is
 * removed from state.carcasses), and refreshes each surviving view's
 * currPos/currYaw/attacking flag. Pure state → view sync — no game logic.
 */
export function syncCreatures(scene: THREE.Scene, state: GameState, views: CreatureViews): void {
  const liveKeys = new Set<string>();

  for (const c of state.creatures) {
    const key = creatureKey(c.id);
    liveKeys.add(key);
    let view = views.get(key);
    if (!view) {
      // Species-keyed model already implies the right look here: the player
      // creature's species is always "youshou", so no separate by-id branch
      // is needed to pick its color/shape (unlike the old graybox mesh spec).
      const model = buildCreatureModel(c.species);
      scene.add(model.group);
      view = newView(model, c.pos, c.yaw);
      views.set(key, view);
    }
    // Model's group origin is the feet (ground-contact point), so sim's pos
    // (already terrain-surface height) maps straight across — no half-height lift.
    view.currPos.set(c.pos.x, c.pos.y, c.pos.z);
    view.currYaw = c.yaw;
    view.attacking = c.activity === "attacking";
    // Hidden while burrowed (underground, out of view) or once dead: a dead
    // player's creature entry lingers (see key comment above) but the
    // carcass model at the same spot is the one that should be visible.
    view.mesh.visible = c.burrowId === null && c.activity !== "dead";
  }

  for (const carcass of state.carcasses) {
    const key = carcassKey(carcass.id);
    liveKeys.add(key);
    let view = views.get(key);
    if (!view) {
      const model = buildCarcassModel(carcass.species);
      scene.add(model.group);
      view = newView(model, carcass.pos, 0);
      views.set(key, view);
    }
    view.currPos.set(carcass.pos.x, carcass.pos.y, carcass.pos.z);
    view.mesh.visible = true;
  }

  for (const [key, view] of views) {
    if (liveKeys.has(key)) continue;
    scene.remove(view.mesh);
    view.dispose();
    views.delete(key);
  }
}

/**
 * Copies each view's currPos/currYaw into prevPos/prevYaw. Call once, right
 * before sim.step(), so the interpolation source reflects the pose as it was
 * before this fixed step (the target is filled in afterwards by syncCreatures).
 */
export function snapshotPrev(views: CreatureViews): void {
  for (const view of views.values()) {
    view.prevPos.copy(view.currPos);
    view.prevYaw = view.currYaw;
  }
}

/** Shortest-path angle lerp so yaw doesn't spin the long way around across the ±π wrap. */
function lerpAngle(a: number, b: number, t: number): number {
  let diff = (b - a) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  else if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

/**
 * Render-frame interpolation: blends each view's prev→curr pose by alpha
 * (leftover accumulator / DT) and writes the result onto the model's root
 * transform. Also applies the graybox attack-tilt (pitch forward by
 * ATTACK_TILT_RAD) for as long as the most recently synced state has
 * activity === "attacking".
 */
export function applyInterp(views: CreatureViews, alpha: number): void {
  const t = Math.max(0, Math.min(1, alpha));
  for (const view of views.values()) {
    view.mesh.position.lerpVectors(view.prevPos, view.currPos, t);
    const yaw = lerpAngle(view.prevYaw, view.currYaw, t);
    const pitch = view.attacking ? ATTACK_TILT_RAD : 0;
    view.mesh.rotation.set(pitch, yaw, 0);
  }
}
