import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { createRng, type Rng, type Terrain } from "@shiling/sim";
import { PALETTE } from "./palette.js";

/**
 * 志怪地标（M15 P3「山海经地形与地标」——owner feedback「地形太简单，不符合山海经的
 * 背景」）：古树/巨石阵/白骨/发光灵芝丛四类程序化静态地标 + 灵泉可视化（光环+上浮
 * 灵光颗粒），全部本批纯程序化（不接 Meshy，scope control——brief 原话）。
 *
 * 与 scatter.ts 同一套惯例：位置由 `createRng(seed ^ 常量)` 在陆地上 rejection-sample
 * （同一个世界种子总长出同一批地标），四类地标依次消耗同一条 rng 流（tree→stone→
 * bone→mushroom→spring sparkle），调用顺序本身就是确定性的一部分，不能颠倒。
 * InstancedMesh 用在"同一种几何+同一种材质、大量重复摆放"的场景（古树树干+枝干、
 * 古树叶簇、立石、肋骨、灵芝伞柄+伞盖）——每一类各自一个 InstancedMesh（一个
 * draw call），不同颜色/材质的部件（比如树干 vs 叶簇）必须拆成独立的 InstancedMesh，
 * 不能合并进同一份几何体再指望逐实例 `setColorAt` 兼顾两种颜色（scatter.ts 头部注释
 * 记录过的真实 bug：`setColorAt` 是"整份几何体一个颜色"，与逐顶点烘焙色是互斥的两条
 * 路径，材质开 `vertexColors:true` 会让 instancingColor 读到全零而整体变黑）。
 *
 * 只有灵泉可视化需要每帧更新（上浮颗粒的位置随时间变化）——其余三类地标是纯静态
 * 展示几何体，构建一次后永不再触碰，与 scatter.ts"此后不逐帧更新"完全同一惯例。
 */

const MAX_REJECTION_ATTEMPTS = 10_000;
const SWAMP_MOISTURE_OFFSET = 0.9; // 沼泽湿度带上限——镜像 terrainMesh.ts/scatter.ts/minimap.ts 同一公式
const COLOR_JITTER = 0.12; // ± brightness fraction，同 scatter.ts 的既有惯例

// ---- 古树（M15 P3）：8 株，虬曲树干+2-3 条扭曲枝干（合并进树干几何体，同 scatter.ts
// buildDeadTreeGeometry 的"一个 InstancedMesh 实例承载一整簇局部多部件几何体"手法，
// 只是本批枝干更粗更夸张，读出"年迈虬曲"而不是"枯树"）+ 3 团深色叶簇（独立
// InstancedMesh，见文件头注释为何不能合并进树干几何体）。----
const TREE_COUNT = 8;
const TREE_LAND_MARGIN = 0.8;
const TREE_SPRING_AVOID_DIST = 6; // 离任意灵泉的最小距离——树冠不与灵泉光环/池面重叠
const TREE_TRUNK_HEIGHT = 7.5; // 基准高度（缩放前）——TREE_SCALE_MIN/MAX 映射到 brief 的 6-10m 区间
const TREE_SCALE_MIN = 0.8; // 7.5×0.8=6m
const TREE_SCALE_MAX = 1.33; // 7.5×1.33≈10m
const TREE_BRANCH_COUNT = 3; // "2-3"，取上限——古树本就该比枯树枝繁
const TREE_BRANCH_LENGTH = 2.6;
const TREE_FOLIAGE_COUNT = 3; // "2-3"，取上限
const TREE_FOLIAGE_RADIUS = 0.95;
const TREE_TILT_JITTER = 0.12; // 古树本身也略微倾斜——比灌木/枯树的抖动大一档，读出"年迈"
// 叶簇局部坐标（树局部空间，缩放前）——大致贴合下面 buildTreeTrunkGeometry 里枝干的
// 附着高度（0.5/0.64/0.78 倍树高），不需要与枝干末端严丝合缝：这是一棵风格化的
// graybox 古树，叶簇"长在树冠附近"即可成立。
const TREE_FOLIAGE_LOCAL_OFFSETS: ReadonlyArray<{ x: number; y: number; z: number }> = [
  { x: 0.7, y: TREE_TRUNK_HEIGHT * 0.8, z: 0.3 },
  { x: -0.55, y: TREE_TRUNK_HEIGHT * 0.92, z: -0.45 },
  { x: 0.1, y: TREE_TRUNK_HEIGHT * 1.02, z: 0.55 },
];

// ---- 巨石阵（M15 P3）：3 处遗迹，每处 5-7 根立石围成一圈"粗略"圆环（角度+半径都带
// 抖动，不是精确等分）。----
const STONE_SITE_COUNT = 3;
const STONE_MIN_PER_SITE = 5;
const STONE_MAX_PER_SITE = 7; // inclusive
const STONE_LAND_MARGIN = 0.8;
const STONE_SPRING_AVOID_DIST = 8;
const STONE_CIRCLE_RADIUS = 3.2;
const STONE_RADIUS_JITTER = 0.6;
const STONE_HEIGHT_MIN = 1.8;
const STONE_HEIGHT_MAX = 2.8;
const STONE_WIDTH = 0.7;
const STONE_DEPTH = 0.5;
const STONE_TILT_MAX = 0.16; // radians——"slight random tilt"

// ---- 白骨（M15 P3）：2 处，上古巨兽的巨大肋骨遗骸——用一列直箱形肋骨沿半圆弧
// 排布（弧线本身用直线段近似，brief 原话"use...angled boxes"），从侧面看像一具
// outsize 的鲸骨拱门/肋骸，是本工程既有素材里从未出现过的"巨大遗骸"读法。----
const BONE_SITE_COUNT = 2;
const BONE_MIN_PER_SITE = 4;
const BONE_MAX_PER_SITE = 5; // inclusive
const BONE_LAND_MARGIN = 0.8;
const BONE_SPRING_AVOID_DIST = 8;
// 尺度基准：玩家（youshou）程序化模型大致 1m 量级——"giant"必须在同一画面里一眼就比
// 玩家大出显著一截，Playwright 截图判读实测过 2.6/2.2 的初版尺度站在骨架旁边完全读
// 不出"巨大"，与玩家/苓鼠尺度混在一起，几乎认不出是遗骸而不是散落石块。放大到接近
// 两倍以上（跨度 9m/高 4.4m），一进入这具骨架的視野就该有"这东西比我大得多"的压迫感。
const BONE_ARC_RADIUS = 4.5; // 弧的跨度半径（米）——肋骸"张开"的宽度
const BONE_ARC_HEIGHT = 4.4; // 弧顶离地高度（米）
const BONE_RIB_LENGTH = 1.9; // 每根肋骨自身的长度——真实肋骨之间本就有间隙，不强求首尾相接
const BONE_RIB_THICKNESS = 0.32;

// ---- 发光灵芝丛（M15 P3）：6 丛，贴着灵泉/沼泽湿度带生长——每丛 3-5 株小型发光菌，
// 伞盖用不受光材质（MeshBasicMaterial）表达"自己在发光"，外加一枚加色 Points 柔光
// sprite（brief 原话"PointLight-free glow sprite...no dynamic lights, use additive
// sprite"）。----
const MUSHROOM_CLUSTER_COUNT = 6;
const MUSHROOM_MIN_PER_CLUSTER = 3;
const MUSHROOM_MAX_PER_CLUSTER = 5; // inclusive
const MUSHROOM_NEAR_SPRING_DIST = 20; // 落在任一灵泉这个半径内即算"贴着灵泉"
const MUSHROOM_CLUSTER_SPREAD = 1.3; // 丛内各株相对丛心的散布半径
const MUSHROOM_STEM_HEIGHT = 0.22;
const MUSHROOM_STEM_RADIUS = 0.03;
const MUSHROOM_CAP_RADIUS = 0.15;
const MUSHROOM_CAP_HEIGHT = 0.16;
const MUSHROOM_GLOW_Y_OFFSET = 0.16; // 柔光 sprite 相对伞盖顶点再上浮这么多，读作"伞盖上罩着一层光晕"而不是紧贴表面
const MUSHROOM_GLOW_POINT_SIZE = 0.55;

// ---- 灵泉可视化（M15 P3）：与 sim 侧 terrain.springs 一一对应——冷青光环贴水面 +
// 缓慢上浮的灵光颗粒（镜像 particles.ts 萤火的"永久存活 Points"手法，但只有垂直
// 漂移，没有水平游荡——"从水面冒出的灵光"是纯垂直读法）。----
const SPRING_GLOW_RING_RADIUS = 3.6; // 略大于 sim 侧 terrain.ts 的 SPRING_POOL_RADIUS(3m)，光环套在池子外沿
const SPRING_GLOW_RING_THICKNESS = 0.4;
const SPRING_GLOW_RING_OPACITY = 0.5;
const SPRING_GLOW_Y_OFFSET = 0.04; // 略高于水面，避免与水面网格 z-fighting
const SPRING_SPARKLE_COUNT_PER_SPRING = 10;
const SPRING_SPARKLE_RADIUS = 2.0;
const SPRING_SPARKLE_RISE_SPEED = 0.35; // 米/秒
const SPRING_SPARKLE_MAX_HEIGHT = 1.6; // 超过这个高度循环回到水面重新升起
const SPRING_SPARKLE_ORBIT_SPEED = 0.15; // 弧度/秒——缓慢绕灵泉中心公转，不是纯直上直下

interface LandPoint {
  x: number;
  y: number;
  z: number;
}

/** 陆地 rejection-sample，额外要求离任意灵泉都至少 `minSpringDist`——镜像 scatter.ts 的 sampleLandPoints，各模块各自维护一份，不跨模块共享内部实现细节（同该文件头部注释的既有理由）。 */
function sampleLandAwayFromSprings(
  rng: Rng,
  terrain: Terrain,
  count: number,
  landMargin: number,
  minSpringDist: number,
): LandPoint[] {
  const half = terrain.size / 2;
  const points: LandPoint[] = [];
  for (let i = 0; i < count; i++) {
    let placed = false;
    for (let attempt = 0; attempt < MAX_REJECTION_ATTEMPTS; attempt++) {
      const x = rng.range(-half, half);
      const z = rng.range(-half, half);
      const y = terrain.heightAt(x, z);
      if (y <= terrain.waterLevel + landMargin) continue;
      if (terrain.springs.some((s) => Math.hypot(x - s.pos.x, z - s.pos.z) < minSpringDist)) continue;
      points.push({ x, y, z });
      placed = true;
      break;
    }
    if (!placed) throw new Error("landmarks: no land position found away from springs after max attempts; check WorldParams/terrain");
  }
  return points;
}

/** 落在任一灵泉 `springDist` 半径内，或落在沼泽湿度带（`h<=swampMax`）内——发光灵芝丛专用采样，两条件任一满足即可，但仍必须是陆地（不能真的长在水里）。 */
function sampleNearSpringsOrSwamp(rng: Rng, terrain: Terrain, count: number, springDist: number, swampMax: number): LandPoint[] {
  const half = terrain.size / 2;
  const points: LandPoint[] = [];
  for (let i = 0; i < count; i++) {
    let placed = false;
    for (let attempt = 0; attempt < MAX_REJECTION_ATTEMPTS; attempt++) {
      const x = rng.range(-half, half);
      const z = rng.range(-half, half);
      const y = terrain.heightAt(x, z);
      if (y <= terrain.waterLevel) continue;
      const nearSpring = terrain.springs.some((s) => Math.hypot(x - s.pos.x, z - s.pos.z) <= springDist);
      if (!nearSpring && y > swampMax) continue;
      points.push({ x, y, z });
      placed = true;
      break;
    }
    if (!placed) throw new Error("landmarks: no near-spring/swamp position found after max attempts; check WorldParams/terrain");
  }
  return points;
}

function jitterColor(rng: Rng, base: THREE.Color): THREE.Color {
  const factor = 1 + (rng.next() * 2 - 1) * COLOR_JITTER;
  return base.clone().multiplyScalar(factor);
}

const GLOW_SPRITE_SIZE = 64;

/** 径向渐变柔光贴图——镜像 particles.ts 的 createGlowSprite，本模块独立生成一份（同文件头"各模块各自构建"的既有理由）。 */
function createGlowSprite(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = GLOW_SPRITE_SIZE;
  canvas.height = GLOW_SPRITE_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("landmarks: createGlowSprite 2D context unavailable");
  const r = GLOW_SPRITE_SIZE / 2;
  const gradient = ctx.createRadialGradient(r, r, 0, r, r, r);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.4, "rgba(255,255,255,0.85)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, GLOW_SPRITE_SIZE, GLOW_SPRITE_SIZE);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/** 虬曲古树的树干+枝干合并几何体（局部空间，基座落在本地 y=0）——同 scatter.ts buildDeadTreeGeometry 同一手法，枝干的角度/长度更夸张，读作"年迈虬曲"而不是"枯树"。 */
function buildTreeTrunkGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.16, 0.26, TREE_TRUNK_HEIGHT, 7);
  trunk.translate(0, TREE_TRUNK_HEIGHT / 2, 0);
  const parts: THREE.BufferGeometry[] = [trunk];
  for (let i = 0; i < TREE_BRANCH_COUNT; i++) {
    const branch = new THREE.CylinderGeometry(0.05, 0.13, TREE_BRANCH_LENGTH, 6);
    branch.translate(0, TREE_BRANCH_LENGTH / 2, 0);
    branch.rotateX(1.15 + i * 0.22); // 比 scatter.ts 枯树(0.9+i*0.15)更夸张的倾角——"虬曲"
    branch.rotateZ(0.35 + i * 0.2);
    branch.rotateY((i / TREE_BRANCH_COUNT) * Math.PI * 2 + 0.6);
    branch.translate(0, TREE_TRUNK_HEIGHT * (0.5 + i * 0.14), 0);
    parts.push(branch);
  }
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error("landmarks: buildTreeTrunkGeometry merge failed");
  return merged;
}

function buildTrees(scene: THREE.Scene, terrain: Terrain, rng: Rng): LandPoint[] {
  const points = sampleLandAwayFromSprings(rng, terrain, TREE_COUNT, TREE_LAND_MARGIN, TREE_SPRING_AVOID_DIST);

  const trunkMesh = new THREE.InstancedMesh(
    buildTreeTrunkGeometry(),
    new THREE.MeshLambertMaterial({ color: PALETTE.landmarkTreeTrunk }),
    TREE_COUNT,
  );
  const foliageMesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(TREE_FOLIAGE_RADIUS, 0),
    new THREE.MeshLambertMaterial({ color: PALETTE.landmarkTreeFoliage }),
    TREE_COUNT * TREE_FOLIAGE_COUNT,
  );

  const treeMatrix = new THREE.Matrix4();
  const offsetMatrix = new THREE.Matrix4();
  const combined = new THREE.Matrix4();
  let foliageIdx = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const scale = TREE_SCALE_MIN + rng.next() * (TREE_SCALE_MAX - TREE_SCALE_MIN);
    const yaw = rng.next() * Math.PI * 2;
    const tiltX = (rng.next() * 2 - 1) * TREE_TILT_JITTER;
    const tiltZ = (rng.next() * 2 - 1) * TREE_TILT_JITTER;
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(tiltX, yaw, tiltZ, "XYZ"));
    treeMatrix.compose(new THREE.Vector3(p.x, p.y, p.z), quaternion, new THREE.Vector3(scale, scale, scale));
    trunkMesh.setMatrixAt(i, treeMatrix);

    for (const off of TREE_FOLIAGE_LOCAL_OFFSETS) {
      offsetMatrix.makeTranslation(off.x, off.y, off.z);
      combined.multiplyMatrices(treeMatrix, offsetMatrix);
      foliageMesh.setMatrixAt(foliageIdx, combined);
      foliageIdx++;
    }
  }
  trunkMesh.instanceMatrix.needsUpdate = true;
  foliageMesh.instanceMatrix.needsUpdate = true;
  scene.add(trunkMesh);
  scene.add(foliageMesh);
  return points;
}

function buildStoneCircles(scene: THREE.Scene, terrain: Terrain, rng: Rng): LandPoint[] {
  const sites = sampleLandAwayFromSprings(rng, terrain, STONE_SITE_COUNT, STONE_LAND_MARGIN + STONE_CIRCLE_RADIUS, STONE_SPRING_AVOID_DIST);
  const counts = sites.map(() => STONE_MIN_PER_SITE + rng.int(STONE_MAX_PER_SITE - STONE_MIN_PER_SITE + 1));
  const total = counts.reduce((a, b) => a + b, 0);

  const geometry = new THREE.BoxGeometry(STONE_WIDTH, 1, STONE_DEPTH); // 高度按每根立石单独缩放，几何体本身固定 1m 高
  geometry.translate(0, 0.5, 0); // 基座落在本地 y=0
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshLambertMaterial({ color: PALETTE.landmarkStoneRing }), total);

  const matrix = new THREE.Matrix4();
  const baseColor = new THREE.Color(PALETTE.landmarkStoneRing);
  let idx = 0;
  for (let s = 0; s < sites.length; s++) {
    const site = sites[s]!;
    const count = counts[s]!;
    for (let i = 0; i < count; i++) {
      // "rough circle"：角度大致均分但带抖动，半径也带抖动——不是精确几何圆。
      const angle = (i / count) * Math.PI * 2 + rng.range(-0.18, 0.18);
      const r = STONE_CIRCLE_RADIUS + (rng.next() * 2 - 1) * STONE_RADIUS_JITTER;
      const x = site.x + Math.sin(angle) * r;
      const z = site.z + Math.cos(angle) * r;
      const y = terrain.heightAt(x, z);
      const height = STONE_HEIGHT_MIN + rng.next() * (STONE_HEIGHT_MAX - STONE_HEIGHT_MIN);
      const tiltX = (rng.next() * 2 - 1) * STONE_TILT_MAX;
      const tiltZ = (rng.next() * 2 - 1) * STONE_TILT_MAX;
      const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(tiltX, angle, tiltZ, "XYZ"));
      matrix.compose(new THREE.Vector3(x, y, z), quaternion, new THREE.Vector3(1, height, 1));
      mesh.setMatrixAt(idx, matrix);
      mesh.setColorAt(idx, jitterColor(rng, baseColor));
      idx++;
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
  return sites;
}

/**
 * 白骨遗骸：每处 site 沿一道竖直半圆弧（局部 X-Y 平面，绕世界 Y 轴转到随机朝向
 * `facing`）分布 4-5 根肋骨，每根肋骨的朝向用 `setFromUnitVectors` 直接把几何体
 * 默认竖直轴（0,1,0）对齐到该点的弧切线方向——比手工拼 Euler 角更不容易在"局部
 * 竖直平面绕 Y 轴整体转向"这类组合旋转里搞错符号，读出来就是"沿弧线立起来的一排
 * 弯曲骨骼"，从侧面看像一具鲸骨拱门。
 */
function buildBoneSites(scene: THREE.Scene, terrain: Terrain, rng: Rng): LandPoint[] {
  const sites = sampleLandAwayFromSprings(rng, terrain, BONE_SITE_COUNT, BONE_LAND_MARGIN + BONE_ARC_RADIUS, BONE_SPRING_AVOID_DIST);
  const counts = sites.map(() => BONE_MIN_PER_SITE + rng.int(BONE_MAX_PER_SITE - BONE_MIN_PER_SITE + 1));
  const total = counts.reduce((a, b) => a + b, 0);

  const geometry = new THREE.BoxGeometry(BONE_RIB_THICKNESS, BONE_RIB_LENGTH, BONE_RIB_THICKNESS); // 长轴沿本地 Y——setFromUnitVectors 会把它转到弧切线方向
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshLambertMaterial({ color: PALETTE.landmarkBoneWhite }), total);

  const matrix = new THREE.Matrix4();
  const up = new THREE.Vector3(0, 1, 0);
  const baseColor = new THREE.Color(PALETTE.landmarkBoneWhite);
  let idx = 0;
  for (let s = 0; s < sites.length; s++) {
    const site = sites[s]!;
    const count = counts[s]!;
    const facing = rng.range(0, Math.PI * 2); // 整具骨架朝向随机（绕世界 Y 轴）
    const cosF = Math.cos(facing);
    const sinF = Math.sin(facing);
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1); // 0..1，沿半弧均匀分布
      const arcAngle = t * Math.PI; // 0=地面一侧，π/2=弧顶，π=地面另一侧
      const localX = -Math.cos(arcAngle) * BONE_ARC_RADIUS; // -R..+R
      const localY = Math.sin(arcAngle) * BONE_ARC_HEIGHT; // 0..H..0
      // 弧切线（对 arcAngle 求导）：(sin·R, cos·H)，即"这一点沿弧线前进的方向"。
      const tangentLocalX = Math.sin(arcAngle) * BONE_ARC_RADIUS;
      const tangentLocalY = Math.cos(arcAngle) * BONE_ARC_HEIGHT;

      const worldX = site.x + localX * cosF;
      const worldZ = site.z + localX * sinF;
      const worldY = terrain.heightAt(worldX, worldZ) + localY;

      const tangentWorld = new THREE.Vector3(tangentLocalX * cosF, tangentLocalY, tangentLocalX * sinF).normalize();
      const quaternion = new THREE.Quaternion().setFromUnitVectors(up, tangentWorld);

      matrix.compose(new THREE.Vector3(worldX, worldY, worldZ), quaternion, new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(idx, matrix);
      mesh.setColorAt(idx, jitterColor(rng, baseColor));
      idx++;
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
  return sites;
}

function buildMushroomClusters(scene: THREE.Scene, terrain: Terrain, rng: Rng): LandPoint[] {
  const swampMax = terrain.waterLevel + SWAMP_MOISTURE_OFFSET;
  const sites = sampleNearSpringsOrSwamp(rng, terrain, MUSHROOM_CLUSTER_COUNT, MUSHROOM_NEAR_SPRING_DIST, swampMax);
  const counts = sites.map(() => MUSHROOM_MIN_PER_CLUSTER + rng.int(MUSHROOM_MAX_PER_CLUSTER - MUSHROOM_MIN_PER_CLUSTER + 1));
  const total = counts.reduce((a, b) => a + b, 0);

  const stemGeometry = new THREE.CylinderGeometry(MUSHROOM_STEM_RADIUS * 0.6, MUSHROOM_STEM_RADIUS, MUSHROOM_STEM_HEIGHT, 5);
  stemGeometry.translate(0, MUSHROOM_STEM_HEIGHT / 2, 0);
  const stemMesh = new THREE.InstancedMesh(stemGeometry, new THREE.MeshLambertMaterial({ color: PALETTE.landmarkMushroomCap }), total);

  const capGeometry = new THREE.ConeGeometry(MUSHROOM_CAP_RADIUS, MUSHROOM_CAP_HEIGHT, 7);
  capGeometry.translate(0, MUSHROOM_STEM_HEIGHT + MUSHROOM_CAP_HEIGHT / 2, 0);
  // MeshBasicMaterial（不受光照）——"发光"读法：本工程氛围光靠未受光材质表达的既有
  // 惯例（terrainMesh.ts 的家巢暖光同一手法），伞盖亮度不随昼夜/阴影变化，天生读作
  // "自己在发光"，不需要真的挂一盏 PointLight（brief 明确禁止）。
  const capMesh = new THREE.InstancedMesh(capGeometry, new THREE.MeshBasicMaterial({ color: PALETTE.landmarkMushroomGlow }), total);

  const glowPositions = new Float32Array(total * 3);

  const matrix = new THREE.Matrix4();
  let idx = 0;
  for (let s = 0; s < sites.length; s++) {
    const site = sites[s]!;
    const count = counts[s]!;
    for (let i = 0; i < count; i++) {
      const angle = rng.next() * Math.PI * 2;
      const r = rng.next() * MUSHROOM_CLUSTER_SPREAD;
      const x = site.x + Math.cos(angle) * r;
      const z = site.z + Math.sin(angle) * r;
      const y = terrain.heightAt(x, z);
      const scale = 0.75 + rng.next() * 0.6;
      const yaw = rng.next() * Math.PI * 2;
      const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
      matrix.compose(new THREE.Vector3(x, y, z), quaternion, new THREE.Vector3(scale, scale, scale));
      stemMesh.setMatrixAt(idx, matrix);
      capMesh.setMatrixAt(idx, matrix);
      glowPositions[idx * 3] = x;
      glowPositions[idx * 3 + 1] = y + (MUSHROOM_STEM_HEIGHT + MUSHROOM_CAP_HEIGHT) * scale + MUSHROOM_GLOW_Y_OFFSET;
      glowPositions[idx * 3 + 2] = z;
      idx++;
    }
  }
  stemMesh.instanceMatrix.needsUpdate = true;
  capMesh.instanceMatrix.needsUpdate = true;
  scene.add(stemMesh);
  scene.add(capMesh);

  // 灵芝发光 sprite：静态 Points，构建一次后不再更新（无动画——柔光晕本身就是
  // 常驻的，不需要像灵泉那样"上浮"才成立）。
  const glowGeometry = new THREE.BufferGeometry();
  glowGeometry.setAttribute("position", new THREE.BufferAttribute(glowPositions, 3));
  const glowMaterial = new THREE.PointsMaterial({
    size: MUSHROOM_GLOW_POINT_SIZE,
    map: createGlowSprite(),
    color: PALETTE.landmarkMushroomGlow,
    transparent: true,
    sizeAttenuation: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const glowPoints = new THREE.Points(glowGeometry, glowMaterial);
  glowPoints.frustumCulled = false; // 每颗粒之间跨度可达整个地图（6 丛分散各处），懒计算的包围球不可靠——同 particles.ts 事件池同一理由
  scene.add(glowPoints);
  return sites;
}

interface SpringVisuals {
  update(frameDt: number, tSec: number): void;
}

/**
 * 灵泉可视化：贴水面的冷青光环（每口灵泉一个静态 Mesh，只有 3 个，不值得为此开一条
 * InstancedMesh） + 缓慢上浮/公转的灵光颗粒（Points，逐帧重写 position，镜像
 * particles.ts 萤火"永久存活、原地重写"的手法）。
 */
function buildSpringVisuals(scene: THREE.Scene, terrain: Terrain, seed: number): SpringVisuals {
  const ringGeometry = new THREE.RingGeometry(SPRING_GLOW_RING_RADIUS - SPRING_GLOW_RING_THICKNESS, SPRING_GLOW_RING_RADIUS, 32);
  ringGeometry.rotateX(-Math.PI / 2);
  for (const s of terrain.springs) {
    const ring = new THREE.Mesh(
      ringGeometry,
      new THREE.MeshBasicMaterial({ color: PALETTE.springGlowRing, transparent: true, opacity: SPRING_GLOW_RING_OPACITY, depthWrite: false }),
    );
    ring.position.set(s.pos.x, s.pos.y + SPRING_GLOW_Y_OFFSET, s.pos.z);
    scene.add(ring);
  }

  const total = terrain.springs.length * SPRING_SPARKLE_COUNT_PER_SPRING;
  const positions = new Float32Array(total * 3);
  const anchorX = new Float32Array(total);
  const anchorZ = new Float32Array(total);
  const riseOffset = new Float32Array(total); // 各颗粒初始相位错开，不会一起从水面冒出
  const radial = new Float32Array(total);
  const angle0 = new Float32Array(total);

  const sparkleRng = createRng(seed ^ 0x5f21a3); // 独立 rng——纯展示用途，不参与任何 sim 确定性契约，只是"同一世界种子长出同一批灵光初始相位"这点确定性本身值得保留
  let idx = 0;
  for (const s of terrain.springs) {
    for (let i = 0; i < SPRING_SPARKLE_COUNT_PER_SPRING; i++) {
      anchorX[idx] = s.pos.x;
      anchorZ[idx] = s.pos.z;
      riseOffset[idx] = sparkleRng.next() * SPRING_SPARKLE_MAX_HEIGHT;
      radial[idx] = sparkleRng.next() * SPRING_SPARKLE_RADIUS;
      angle0[idx] = sparkleRng.next() * Math.PI * 2;
      idx++;
    }
  }

  const geometry = new THREE.BufferGeometry();
  const positionAttr = new THREE.BufferAttribute(positions, 3);
  geometry.setAttribute("position", positionAttr);
  const material = new THREE.PointsMaterial({
    size: 0.3,
    map: createGlowSprite(),
    color: PALETTE.springGlowRing,
    transparent: true,
    sizeAttenuation: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);

  const baseY = terrain.waterLevel;
  return {
    update(_frameDt: number, tSec: number): void {
      for (let i = 0; i < total; i++) {
        const h = (riseOffset[i]! + tSec * SPRING_SPARKLE_RISE_SPEED) % SPRING_SPARKLE_MAX_HEIGHT;
        const angle = angle0[i]! + tSec * SPRING_SPARKLE_ORBIT_SPEED;
        positions[i * 3] = anchorX[i]! + Math.cos(angle) * radial[i]!;
        positions[i * 3 + 1] = baseY + h;
        positions[i * 3 + 2] = anchorZ[i]! + Math.sin(angle) * radial[i]!;
      }
      positionAttr.needsUpdate = true;
    },
  };
}

export interface Landmarks {
  /** 每渲染帧调用一次（main.ts 无条件调用，backdrop 动画同 particles/water 同一惯例——见该文件调用点注释）。 */
  update(frameDt: number, tSec: number): void;
  /**
   * 各类地标的采样锚点（不是每一件具体物件的最终位置，是"这一处遗迹/这一棵树"的
   * site 中心）——纯粹是验证用的只读数据出口（main.ts 的 dev-only `__shiling` 探针
   * 消费，供外部 Playwright 脚本确定性地飞到某处地标附近取景截图，不需要在
   * 480×480 的世界里凭空猜坐标，同 sim 侧 `terrain.digSpots`/`terrain.springs`
   * 本就是"始终存在、供查询"的既有惯例）。
   */
  anchors: {
    trees: ReadonlyArray<{ x: number; z: number }>;
    stoneCircleSites: ReadonlyArray<{ x: number; z: number }>;
    boneSites: ReadonlyArray<{ x: number; z: number }>;
    mushroomClusterSites: ReadonlyArray<{ x: number; z: number }>;
  };
}

/**
 * 构建全部四类地标 + 灵泉可视化，一次性调用（main.ts 在地形/scatter 建好之后调用）。
 * `seed` 与 `createSim(seed)`/`buildScatter(...,seed,...)` 同一个世界种子——同一个
 * 世界总长出同一批地标。
 */
export function buildLandmarks(scene: THREE.Scene, terrain: Terrain, seed: number): Landmarks {
  const rng = createRng(seed ^ 0x6c616e64); // "land" 的 ascii 位模式，纯粹取一个与 scatter.ts(0x51ab)/terrain.ts 内部几路 rng 都不同的独立异或常数
  const trees = buildTrees(scene, terrain, rng);
  const stoneCircleSites = buildStoneCircles(scene, terrain, rng);
  const boneSites = buildBoneSites(scene, terrain, rng);
  const mushroomClusterSites = buildMushroomClusters(scene, terrain, rng);
  const springVisuals = buildSpringVisuals(scene, terrain, seed);
  return {
    update(frameDt: number, tSec: number): void {
      springVisuals.update(frameDt, tSec);
    },
    anchors: { trees, stoneCircleSites, boneSites, mushroomClusterSites },
  };
}
