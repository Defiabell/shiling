import * as THREE from "three";
import type { Carcass, Creature, GameState, Vec3 } from "@shiling/sim";

// Graybox visual feedback: pitch the mesh forward this many radians while the
// underlying sim activity is "attacking" (client only reflects state, it
// never decides when an attack happens).
const ATTACK_TILT_RAD = 0.3;

/**
 * Species-level graybox appearance. `height` is the geometry's full extent
 * along Y and is used to compute the ground "lift": sim `pos.y` is the
 * terrain-surface / feet height, but Box/Capsule geometry is centered on its
 * own origin, so a mesh placed straight at `pos` would be buried up to its
 * middle. Lifting by half the mesh height puts its bottom face on the
 * ground instead.
 */
interface CreatureSpec {
  makeGeometry(): THREE.BufferGeometry;
  color: number;
  height: number;
}

const PLAYER_SPEC: CreatureSpec = {
  makeGeometry: () => new THREE.CapsuleGeometry(0.5, 0.8),
  color: 0xd97a2b, // orange
  height: 0.8 + 2 * 0.5, // capsule length + 2*radius (two hemispherical caps)
};

const LINGSHU_SPEC: CreatureSpec = {
  makeGeometry: () => new THREE.BoxGeometry(0.6, 0.5, 0.9),
  color: 0xf2f2f2, // white
  height: 0.5,
};

const TANSHOU_SPEC: CreatureSpec = {
  makeGeometry: () => new THREE.BoxGeometry(1.2, 1.1, 2.2),
  color: 0x5c1414, // dark red
  height: 1.1,
};

/** Player is identified by state.playerId, not by species string ("youshou" is a content-layer detail). */
function specForCreature(c: Creature, state: GameState): CreatureSpec {
  if (c.id === state.playerId) return PLAYER_SPEC;
  switch (c.species) {
    case "lingshu":
      return LINGSHU_SPEC;
    case "tanshou":
      return TANSHOU_SPEC;
    default:
      // Defensive fallback: M0 content only ever spawns lingshu/tanshou NPCs alongside the player.
      return LINGSHU_SPEC;
  }
}

const CARCASS_HEIGHT = 0.25;
const CARCASS_COLOR = 0x6b6b6b; // gray
const CARCASS_DEFAULT_FOOTPRINT = { width: 0.7, depth: 1.0 };

/** Carcass footprint reuses the living species' box footprint, flattened, so corpses read at roughly the right size. */
function footprintForCarcass(carcass: Carcass): { width: number; depth: number } {
  switch (carcass.species) {
    case "lingshu":
      return { width: 0.6, depth: 0.9 };
    case "tanshou":
      return { width: 1.2, depth: 2.2 };
    default:
      // Player ("youshou") corpses and any unforeseen species fall back to a generic mid-size box.
      return CARCASS_DEFAULT_FOOTPRINT;
  }
}

export interface CreatureView {
  mesh: THREE.Mesh;
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

function makeCreatureMesh(spec: CreatureSpec): THREE.Mesh {
  const mesh = new THREE.Mesh(spec.makeGeometry(), new THREE.MeshLambertMaterial({ color: spec.color }));
  // "YXZ" applies yaw (world Y) before pitch (local X), so the attack tilt
  // always pitches the nose relative to current facing, not a fixed world axis.
  mesh.rotation.order = "YXZ";
  return mesh;
}

function makeCarcassMesh(carcass: Carcass): THREE.Mesh {
  const { width, depth } = footprintForCarcass(carcass);
  const geometry = new THREE.BoxGeometry(width, CARCASS_HEIGHT, depth);
  return new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color: CARCASS_COLOR }));
}

/** Creates a view whose prevPos/currPos both start at the lifted spawn position, so a freshly-added mesh never pops from some default. */
function newView(mesh: THREE.Mesh, groundPos: Vec3, yaw: number, lift: number): CreatureView {
  const lifted = new THREE.Vector3(groundPos.x, groundPos.y + lift, groundPos.z);
  mesh.position.copy(lifted);
  return { mesh, prevPos: lifted.clone(), currPos: lifted.clone(), prevYaw: yaw, currYaw: yaw, attacking: false };
}

/**
 * Reconciles the view registry against live sim state: adds meshes for
 * newly-appeared creatures/carcasses, removes meshes for ones that vanished
 * (a kill removes the prey from state.creatures; a fully-eaten carcass is
 * removed from state.carcasses), and refreshes each surviving view's
 * currPos/currYaw/attacking flag. Pure state → view sync — no game logic.
 */
export function syncCreatures(scene: THREE.Scene, state: GameState, views: CreatureViews): void {
  const liveKeys = new Set<string>();

  for (const c of state.creatures) {
    const key = creatureKey(c.id);
    liveKeys.add(key);
    const spec = specForCreature(c, state);
    let view = views.get(key);
    if (!view) {
      const mesh = makeCreatureMesh(spec);
      scene.add(mesh);
      view = newView(mesh, c.pos, c.yaw, spec.height / 2);
      views.set(key, view);
    }
    view.currPos.set(c.pos.x, c.pos.y + spec.height / 2, c.pos.z);
    view.currYaw = c.yaw;
    view.attacking = c.activity === "attacking";
    // Hidden while burrowed (underground, out of view) or once dead: a dead
    // player's creature entry lingers (see key comment above) but the
    // carcass mesh at the same spot is the one that should be visible.
    view.mesh.visible = c.burrowId === null && c.activity !== "dead";
  }

  for (const carcass of state.carcasses) {
    const key = carcassKey(carcass.id);
    liveKeys.add(key);
    let view = views.get(key);
    if (!view) {
      const mesh = makeCarcassMesh(carcass);
      scene.add(mesh);
      view = newView(mesh, carcass.pos, 0, CARCASS_HEIGHT / 2);
      views.set(key, view);
    }
    view.currPos.set(carcass.pos.x, carcass.pos.y + CARCASS_HEIGHT / 2, carcass.pos.z);
    view.mesh.visible = true;
  }

  for (const [key, view] of views) {
    if (liveKeys.has(key)) continue;
    scene.remove(view.mesh);
    view.mesh.geometry.dispose();
    (view.mesh.material as THREE.Material).dispose();
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
 * (leftover accumulator / DT) and writes the result onto the mesh transform.
 * Also applies the graybox attack-tilt (pitch forward by ATTACK_TILT_RAD)
 * for as long as the most recently synced state has activity === "attacking".
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
