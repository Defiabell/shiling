import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { createRng, type Rng, type Terrain } from "@shiling/sim";
import { PALETTE } from "./palette.js";

/**
 * 地表点缀（Patch 3c，playtest feedback: 地面空）：草丛/岩石/枯树三种静态
 * InstancedMesh（每类一个，共 3 个 draw call），main.ts 在地形建好之后调用
 * `buildScatter` 一次，此后不逐帧更新——与 particles.ts 的萤火/事件粒子（每帧
 * 重写 position）不同，这里每个实例的变换矩阵/颜色只在构建时写入一次。
 *
 * 位置通过 `createRng(seed ^ 0x51ab)` 在陆地上 rejection-sample（复用 sim 的
 * 世界种子，异或一个跟地形自己 digRng 用的 `^ 0x9e3779b9`（terrain.ts）不同
 * 的常数，避免两路 rng 巧合撞出可疑的重复分布）：同一个世界种子总是长出同一
 * 片点缀，这也是为什么 rng 在本模块内部创建，而不是接一个外部共享实例——
 * 三种类型顺序消耗同一个 rng 流（grass → rock → wood），调用顺序本身就是
 * 确定性的一部分，不能颠倒。
 */

const LAND_MARGIN = 0.8; // heightAt > waterLevel + margin
const MAX_REJECTION_ATTEMPTS = 400;

const GRASS_COUNT = 220;
const ROCK_COUNT = 40;
const WOOD_COUNT = 16;

const GRASS_HEIGHT = 0.42;
const GRASS_RADIUS = 0.06;
const GRASS_SCALE_MIN = 0.7;
const GRASS_SCALE_MAX = 1.4;
const GRASS_TILT_JITTER = 0.2; // radians, small organic lean off vertical

const ROCK_RADIUS = 0.35;
const ROCK_SCALE_MIN = 0.8;
const ROCK_SCALE_MAX = 1.6;
const ROCK_EMBED_FACTOR = 0.35; // fraction of scaled radius sunk below ground — reads as resting *in* the dirt, not floating on it
const ROCK_SLOPE_TINT_SCALE = 3.5; // slope(≈tan) * this, clamped — mirrors terrainMesh.ts's own "越陡越浓墨" read (slopeInkFactor)
const ROCK_SLOPE_TINT_MAX = 0.5;

const WOOD_TRUNK_HEIGHT = 2.4;
const WOOD_BRANCH_COUNT = 3;
const WOOD_SCALE_MIN = 0.85;
const WOOD_SCALE_MAX = 1.3;

const COLOR_JITTER = 0.12; // ± brightness fraction, per instance — keeps a rejection-sampled but visually identical mesh from reading as stamped copies

interface LandPoint {
  x: number;
  y: number;
  z: number;
}

/** Rejection-samples `count` points on land (mirrors sim.ts's randomLandPos, but with this pass's own LAND_MARGIN and its own rng stream). */
function sampleLandPoints(rng: Rng, terrain: Terrain, count: number): LandPoint[] {
  const half = terrain.size / 2;
  const points: LandPoint[] = [];
  for (let i = 0; i < count; i++) {
    let placed = false;
    for (let attempt = 0; attempt < MAX_REJECTION_ATTEMPTS; attempt++) {
      const x = rng.range(-half, half);
      const z = rng.range(-half, half);
      const y = terrain.heightAt(x, z);
      if (y > terrain.waterLevel + LAND_MARGIN) {
        points.push({ x, y, z });
        placed = true;
        break;
      }
    }
    if (!placed) {
      throw new Error("scatter: no land position found after max attempts; check WorldParams/terrain");
    }
  }
  return points;
}

/**
 * Finite-difference slope magnitude (≈tan of the local grade) at (x,z).
 * terrainMesh.ts derives its own slope tint from the baked vertex normal's Y
 * component; scatter only has `terrain.heightAt` to work with (no access to
 * the terrain mesh's normal buffer), so it estimates the same quantity with
 * a small central-difference sample instead.
 */
function slopeAt(terrain: Terrain, x: number, z: number): number {
  const eps = 0.75;
  const hL = terrain.heightAt(x - eps, z);
  const hR = terrain.heightAt(x + eps, z);
  const hD = terrain.heightAt(x, z - eps);
  const hU = terrain.heightAt(x, z + eps);
  const slopeX = (hR - hL) / (2 * eps);
  const slopeZ = (hU - hD) / (2 * eps);
  return Math.sqrt(slopeX * slopeX + slopeZ * slopeZ);
}

function jitterColor(rng: Rng, base: THREE.Color): THREE.Color {
  const factor = 1 + (rng.next() * 2 - 1) * COLOR_JITTER;
  return base.clone().multiplyScalar(factor);
}

/** Single cone standing in for a grass tuft — base translated to local y=0 so instance position lands exactly on the sampled ground point. */
function buildGrassGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.ConeGeometry(GRASS_RADIUS, GRASS_HEIGHT, 5);
  geometry.translate(0, GRASS_HEIGHT / 2, 0);
  return geometry;
}

/** Low-poly icosahedron — reads as a rough-cut rock, no translate needed (already centered, embedding is handled per-instance via ROCK_EMBED_FACTOR). */
function buildRockGeometry(): THREE.BufferGeometry {
  return new THREE.IcosahedronGeometry(ROCK_RADIUS, 0);
}

/**
 * Thin cylinder trunk + WOOD_BRANCH_COUNT tilted branch cylinders, merged
 * into one static local-space BufferGeometry (base at local y=0) — so a
 * single InstancedMesh (one per-instance 4x4 transform) can place a whole
 * multi-part tree, satisfying "one InstancedMesh per type" without a second
 * draw call for the branches. Each branch's rotate-then-translate order
 * pivots it from its own attachment point on the trunk (rotateX/rotateY
 * apply around the geometry's local origin *before* the final translate
 * moves it up to that attachment height), giving it a genuine "tilted
 * outward from the trunk" read rather than all branches sharing one pivot.
 */
function buildDeadTreeGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.05, 0.09, WOOD_TRUNK_HEIGHT, 6);
  trunk.translate(0, WOOD_TRUNK_HEIGHT / 2, 0);

  const parts: THREE.BufferGeometry[] = [trunk];
  for (let i = 0; i < WOOD_BRANCH_COUNT; i++) {
    const branchHeight = 0.85;
    const branch = new THREE.CylinderGeometry(0.02, 0.045, branchHeight, 5);
    branch.translate(0, branchHeight / 2, 0);
    branch.rotateX(0.9 + i * 0.15);
    branch.rotateY((i / WOOD_BRANCH_COUNT) * Math.PI * 2 + 0.4);
    branch.translate(0, WOOD_TRUNK_HEIGHT * (0.55 + i * 0.15), 0);
    parts.push(branch);
  }
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error("scatter: buildDeadTreeGeometry merge failed");
  return merged;
}

/**
 * Builds one static InstancedMesh: `place` writes each instance's transform
 * matrix, `pickColor` (defaults to plain jitterColor) picks its per-instance
 * tint. Never touched again after this call — no frustumCulled override
 * needed, unlike particles.ts's dynamic Points (InstancedMesh's default
 * bounding-sphere computation is correct here because instances never move).
 */
function buildInstancedScatter(
  geometry: THREE.BufferGeometry,
  baseColorHex: number,
  points: LandPoint[],
  rng: Rng,
  place: (point: LandPoint, rng: Rng, matrix: THREE.Matrix4) => void,
  pickColor: (point: LandPoint, rng: Rng, baseColor: THREE.Color) => THREE.Color = (_point, r, baseColor) =>
    jitterColor(r, baseColor),
): THREE.InstancedMesh {
  // No `vertexColors: true` here (deliberately): per-instance tint comes
  // entirely from `setColorAt`/`instanceColor`, which three.js's WebGLProgram
  // wires up independently of `material.vertexColors` (its "instancingColor"
  // program parameter is `isInstancedMesh && instanceColor !== null`, no
  // material flag required). Turning `vertexColors` on here was tried first
  // and is a real bug, caught via this task's own screenshot verification:
  // it makes the *vertex* shader additionally define `USE_COLOR` (unlike the
  // fragment shader, whose `USE_COLOR` is `vertexColors || instancingColor`
  // — an OR), and `color_vertex.glsl`'s `vColor *= color` then reads the
  // geometry's nonexistent "color" attribute, which WebGL defaults to
  // (0,0,0) when unbound — zeroing vColor *before* the instanceColor
  // multiplication ever runs, so every instance rendered flat black
  // regardless of its actual instance color.
  const material = new THREE.MeshLambertMaterial();
  const mesh = new THREE.InstancedMesh(geometry, material, points.length);
  const baseColor = new THREE.Color(baseColorHex);
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < points.length; i++) {
    place(points[i]!, rng, matrix);
    mesh.setMatrixAt(i, matrix);
    mesh.setColorAt(i, pickColor(points[i]!, rng, baseColor));
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

function placeGrass(point: LandPoint, rng: Rng, matrix: THREE.Matrix4): void {
  const scale = GRASS_SCALE_MIN + rng.next() * (GRASS_SCALE_MAX - GRASS_SCALE_MIN);
  const yaw = rng.next() * Math.PI * 2;
  const tiltX = (rng.next() * 2 - 1) * GRASS_TILT_JITTER;
  const tiltZ = (rng.next() * 2 - 1) * GRASS_TILT_JITTER;
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(tiltX, yaw, tiltZ, "XYZ"));
  matrix.compose(new THREE.Vector3(point.x, point.y, point.z), quaternion, new THREE.Vector3(scale, scale, scale));
}

function placeRock(point: LandPoint, rng: Rng, matrix: THREE.Matrix4): void {
  const scale = ROCK_SCALE_MIN + rng.next() * (ROCK_SCALE_MAX - ROCK_SCALE_MIN);
  const embedY = point.y - ROCK_RADIUS * scale * ROCK_EMBED_FACTOR;
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rng.next() * Math.PI * 2, rng.next() * Math.PI * 2, rng.next() * Math.PI * 2),
  );
  matrix.compose(new THREE.Vector3(point.x, embedY, point.z), quaternion, new THREE.Vector3(scale, scale, scale));
}

function placeWood(point: LandPoint, rng: Rng, matrix: THREE.Matrix4): void {
  const scale = WOOD_SCALE_MIN + rng.next() * (WOOD_SCALE_MAX - WOOD_SCALE_MIN);
  const yaw = rng.next() * Math.PI * 2;
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
  matrix.compose(new THREE.Vector3(point.x, point.y, point.z), quaternion, new THREE.Vector3(scale, scale, scale));
}

/**
 * Builds and adds all three scatter InstancedMeshes to `scene`. Call once,
 * after `buildTerrainMesh` (needs `terrain` fully built for `heightAt`),
 * with the same seed `createSim` was constructed with — deterministic per
 * world, matching the module doc comment above.
 */
export function buildScatter(scene: THREE.Scene, terrain: Terrain, seed: number): void {
  const rng = createRng(seed ^ 0x51ab);

  const grassPoints = sampleLandPoints(rng, terrain, GRASS_COUNT);
  scene.add(buildInstancedScatter(buildGrassGeometry(), PALETTE.scatterGrass, grassPoints, rng, placeGrass));

  const rockPoints = sampleLandPoints(rng, terrain, ROCK_COUNT);
  scene.add(
    buildInstancedScatter(buildRockGeometry(), PALETTE.scatterRock, rockPoints, rng, placeRock, (point, r, baseColor) => {
      const tint = Math.min(1, slopeAt(terrain, point.x, point.z) * ROCK_SLOPE_TINT_SCALE) * ROCK_SLOPE_TINT_MAX;
      return jitterColor(r, baseColor).lerp(new THREE.Color(PALETTE.outlineInk), tint);
    }),
  );

  const woodPoints = sampleLandPoints(rng, terrain, WOOD_COUNT);
  scene.add(buildInstancedScatter(buildDeadTreeGeometry(), PALETTE.scatterWood, woodPoints, rng, placeWood));
}
