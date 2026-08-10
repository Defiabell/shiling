import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { createRng, mountainCenterFor, mountainMaskAt, type Rng, type Terrain } from "@shiling/sim";
import { PALETTE, interpolateDayNight } from "./palette.js";
import { loadPropLibrary, type PropId, type PropLibrary, type PropLibraryEntry } from "./propLibrary.js";

/**
 * 志怪地标（M15 P3「山海经地形与地标」起手，M2 A2「Meshy 山海经布景」在此基础上重做——
 * owner feedback「布景劣质，能不能生成精致的布景」）。
 *
 * **M2 A2 之前**：古树/巨石阵/白骨/发光灵芝丛四类地标全部是纯程序化几何体（圆柱+箱体
 * 拼装），owner 反馈"布景劣质"。**M2 A2 之后**：9 件 Meshy 生成的静态 GLB 布景
 * （见 propLibrary.ts）替换/新增大部分地标的最终视觉，但世界建好的**那一帧**仍然是
 * 纯程序化 graybox——GLB 走网络异步加载，不能拖慢开局。策略：
 *
 * 1. **legacy 三类（古树/白骨/灵芝丛）**：M15 P3 原有的程序化几何体（buildTrees 的
 *    树干+枝干+叶簇、buildBoneSites 的肋骨弧、buildMushroomClusters 的伞菌）**原样
 *    保留**，直接充当"GLB 到位前"的即时占位——不是新写的占位块，是老代码换了个身份
 *    （见各自函数头注释）。
 * 2. **6 类全新地标（石碑/铜鼎/图腾柱/山门/云纹岩/断桥）**：没有历史几何体可以借用，
 *    新写一个统一的极简"graybox 方块"占位（buildGenericPlaceholder），维持数秒即被
 *    替换，不值得像 legacy 三类那样精雕。
 * 3. **swap**：`loadPropLibrary()`（propLibrary.ts）在 `buildLandmarks` 内部
 *    fire-and-forget 调用——不像 modelLibrary.ts 那样把 promise 交回 main.ts 门闩
 *    任何 UI（plan 原话"preload NOT required at title"）。resolve 后一次性把 9 类
 *    地标里每一类**已经成功加载 GLB 的那些**替换成 InstancedMesh（旧占位从 scene
 *    移除并 dispose，几何体/材质不重复持有），未加载成功的类型保留占位（同
 *    modelLibrary.ts 的"单个失败不影响其余"惯例）。`isPropsReady()` 供外部
 *    Playwright 脚本判定 swap 是否已完成。
 *
 * **位置确定性**：全部地标依次消耗**同一条** `rng`（`createRng(seed ^ 0x6c616e64)`）
 * ——调用顺序本身就是确定性契约的一部分，新增的 6 类必须严格追加在原有四类**之后**，
 * 不能插进中间，否则同一个世界种子会长出不同的地标布局。当前顺序（写在这里，改动
 * 前必读，与 `buildLandmarks` 函数体内的实际调用顺序一一对应）：巨石阵站位→古树
 * (→gushu)→白骨(→baigu)→灵芝丛(→lingzhi)→石碑→铜鼎(近泉+山地)→图腾柱→
 * 山门(山地入口+草甸)→云纹岩(复用巨石阵站位，只多抽 yaw+缩放抖动)→断桥。灵泉
 * 可视化 rng 独立（`seed`本身，不派生自这条 landmark rng），不受影响。
 *
 * **InstancedMesh 使用惯例（沿用 M15 P3 既有理由）**：同一种几何+同一种材质、大量
 * 重复摆放的场景用一个 InstancedMesh（一次 draw call）；GLB 布景也遵循这一惯例——
 * propLibrary.ts 把每类布景的 GLB 烘焙成**一份**共享几何体/材质，本文件用一个
 * InstancedMesh 承载该类型的**全部**实例（哪怕只有 1-2 个，如断桥/铜鼎，也统一走
 * InstancedMesh 而不是散落的独立 Mesh——代码路径一致，不需要按数量分支）。draw-call
 * 账本：9 类布景总计 31 个实例（4+2+3+2+3+8+1+2+6），只占 9 个 draw call（每类
 * 一个 InstancedMesh），而不是"每个实例一个 Mesh"会需要的 31 个——这是"instancing
 * where >2 of a kind"这条要求在数量≤2 的类型上的自然延伸，不是例外。
 */

const MAX_REJECTION_ATTEMPTS = 10_000;
const SWAMP_MOISTURE_OFFSET = 0.9; // 沼泽湿度带上限——镜像 terrainMesh.ts/scatter.ts/minimap.ts 同一公式
const COLOR_JITTER = 0.12; // ± brightness fraction，同 scatter.ts 的既有惯例

// M2 A2：新地标摆放的通用间距规则（plan 原话"spacing rules, not blocking springs/dig
// spots within 3m"）——terrain.ts 的 digSpots 是与地标完全独立的另一套采样点（44 个
// 挖点，见 world.ts QINGQIU_GRAYBOX.digSpotCount），此前四类 M15 P3 地标从未检查过
// 是否与它们重叠，这里统一补上这条底线，新旧地标 sampler 一视同仁。
const DIGSPOT_AVOID_DIST = 3;

/** terrain.digSpots 里是否存在与 (x,z) 距离小于 minDist 的挖点——见上方 DIGSPOT_AVOID_DIST 头注。 */
function nearAnyDigSpot(terrain: Terrain, x: number, z: number, minDist: number): boolean {
  return terrain.digSpots.some((d) => Math.hypot(x - d.pos.x, z - d.pos.z) < minDist);
}

// ---- 山地区 mask 阈值（M2 A2，mountainMaskAt 复用 sim 侧既有导出）----
// 参照系：terrain.ts 的 SPRING_MOUNTAIN_MASK_REJECT=0.6（灵泉排斥"最陡核心"）与
// main.ts 的 MOUNTAIN_ZONE_TOAST_THRESHOLD=0.75（flavor toast"已踏入山地区核心"）
// 是本工程已有的两个锚点——下面三个新阈值故意都落在比 0.6 更宽松的区间，因为地标
// 摆放要的是"读得出这是山地/进山口/平地"这种大尺度分区，不是"和灵泉一样严格排斥
// 最陡核心"或"和 flavor toast 一样只认最核心那圈"。
const MOUNTAIN_ZONE_MASK_MIN = 0.5; // 云纹岩/铜鼎(山地一件)：明确读作"在山里"
const MOUNTAIN_ENTRANCE_MASK_MIN = 0.15; // 山门(山地入口一件)：刚感觉到山地影响，还没深入
const MOUNTAIN_ENTRANCE_MASK_MAX = 0.4;
const MEADOW_MASK_MAX = 0.12; // 石碑/山门(草甸一件)：明确不在山地影响范围内的平地

interface LandPoint {
  x: number;
  y: number;
  z: number;
}

/** 陆地 rejection-sample，额外要求离任意灵泉都至少 `minSpringDist`、离任意挖点都至少 `DIGSPOT_AVOID_DIST`——镜像 scatter.ts 的 sampleLandPoints，各模块各自维护一份，不跨模块共享内部实现细节（同该文件头部注释的既有理由）。 */
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
      if (nearAnyDigSpot(terrain, x, z, DIGSPOT_AVOID_DIST)) continue;
      points.push({ x, y, z });
      placed = true;
      break;
    }
    if (!placed) throw new Error("landmarks: no land position found away from springs after max attempts; check WorldParams/terrain");
  }
  return points;
}

/** 落在任一灵泉 `springDist` 半径内，或落在沼泽湿度带（`h<=swampMax`）内——发光灵芝丛专用采样，两条件任一满足即可，但仍必须是陆地（不能真的长在水里）且远离挖点。 */
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
      if (nearAnyDigSpot(terrain, x, z, DIGSPOT_AVOID_DIST)) continue;
      points.push({ x, y, z });
      placed = true;
      break;
    }
    if (!placed) throw new Error("landmarks: no near-spring/swamp position found after max attempts; check WorldParams/terrain");
  }
  return points;
}

type ZonePredicate = (h: number, mask: number) => boolean;

/**
 * 通用陆地 rejection-sample + mountainMaskAt 分区判据（M2 A2 新地标专用）——石碑/
 * 铜鼎(山地一件)/图腾柱走"predicate=true"以外的分支，山门/云纹岩/巨石阵站位复用这个
 * 函数配不同 predicate。与上面两个 M15 P3 既有 sampler 分开维护（同文件头一贯理由：
 * 各自独立，不强行合并出一个大而全但难读的超级函数），只是同样都会检查挖点/灵泉。
 */
function sampleZone(
  rng: Rng,
  terrain: Terrain,
  mountainCenter: { x: number; z: number },
  count: number,
  landMargin: number,
  minSpringDist: number,
  predicate: ZonePredicate,
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
      if (nearAnyDigSpot(terrain, x, z, DIGSPOT_AVOID_DIST)) continue;
      const mask = mountainMaskAt(x, z, mountainCenter);
      if (!predicate(y, mask)) continue;
      points.push({ x, y, z });
      placed = true;
      break;
    }
    if (!placed) throw new Error("landmarks: sampleZone found no matching position after max attempts; check zone predicate/WorldParams");
  }
  return points;
}

/** 泉边环带采样（铜鼎"近泉"一件专用）：绕一口随机选中的灵泉、半径 [ringMin,ringMax) 内取点——比 SPRING_GLOW_RING_RADIUS(3.6) 更外一圈，不与灵泉光环视觉重叠。 */
function samplePointNearASpring(rng: Rng, terrain: Terrain, ringMin: number, ringMax: number): LandPoint {
  for (let attempt = 0; attempt < MAX_REJECTION_ATTEMPTS; attempt++) {
    const spring = terrain.springs[rng.int(terrain.springs.length)]!;
    const angle = rng.range(0, Math.PI * 2);
    const dist = rng.range(ringMin, ringMax);
    const x = spring.pos.x + Math.cos(angle) * dist;
    const z = spring.pos.z + Math.sin(angle) * dist;
    const y = terrain.heightAt(x, z);
    if (y <= terrain.waterLevel) continue;
    if (nearAnyDigSpot(terrain, x, z, DIGSPOT_AVOID_DIST)) continue;
    return { x, y, z };
  }
  throw new Error("landmarks: samplePointNearASpring found no valid position after max attempts");
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

// ===========================================================================
// M2 A2 布景实例摆放（PropSite）+ InstancedMesh 通用构建/替换——9 类布景共用。
// ===========================================================================

/** 一件布景实例的最终摆放——position + 绕世界 Y 轴的朝向 + 可选缩放抖动（`scale` 缺省=1）。 */
interface PropSite {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale?: number;
}

/** LandPoint[] → PropSite[]，逐点从 rng 抽一个随机朝向（"facing irrelevant — random yaw"，plan 原话），可选再抽一点缩放抖动（自然物读作"每株/每块都不完全一样"）。 */
function toPropSites(rng: Rng, points: LandPoint[], scaleJitter?: { min: number; max: number }): PropSite[] {
  return points.map((p) => ({
    x: p.x,
    y: p.y,
    z: p.z,
    yaw: rng.next() * Math.PI * 2,
    scale: scaleJitter ? scaleJitter.min + rng.next() * (scaleJitter.max - scaleJitter.min) : undefined,
  }));
}

/** 用一份共享几何体+材质、按 sites 摆放，建出一个 InstancedMesh——9 类布景（占位与 GLB 两种身份）统一走这条路径，见文件头"InstancedMesh 使用惯例"。 */
function buildInstancedFromSites(geometry: THREE.BufferGeometry, material: THREE.Material, sites: PropSite[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, sites.length);
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < sites.length; i++) {
    const s = sites[i]!;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s.yaw, 0));
    const scl = s.scale ?? 1;
    matrix.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(scl, scl, scl));
    mesh.setMatrixAt(i, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

/** 从 scene 移除并 dispose 一组占位对象——只 dispose geometry（材质是否共享由调用方决定要不要传 disposeMaterial=false，避免同一份共享占位材质被 dispose 两次）。 */
function removeAndDispose(scene: THREE.Scene, objects: THREE.Object3D[], disposeMaterial: boolean): void {
  for (const obj of objects) {
    scene.remove(obj);
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
      // InstancedMesh extends Mesh, so this branch already covers it.
      obj.geometry.dispose();
      if (disposeMaterial) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of mats) {
          // 灵芝/灵泉这类发光 sprite 材质挂了 createGlowSprite() 生成的 canvas
          // 贴图——只 dispose 材质本身不会连带释放它，必须显式多 dispose 一次 map，
          // 否则每次 swap 都会静默攒一份再也没人引用的 GPU 贴图内存。
          const map = (mat as THREE.Material & { map?: THREE.Texture | null }).map;
          if (map) map.dispose();
          mat.dispose();
        }
      }
    }
  }
}

/**
 * 6 类全新地标（石碑/铜鼎/图腾柱/山门/云纹岩/断桥）没有历史几何体可借用——统一用一个
 * 极简方块占位，方块的宽高深按 plan 给的目标尺寸手工估一个大致轮廓（比如石碑读作
 * "又高又薄的石片"），只求"占位那几秒里大致轮廓不违和"，不追求形似——GLB 到位就会
 * 整个换掉。占位材质由调用方传入并共享（见 buildLandmarks 里唯一一份
 * PLACEHOLDER_MATERIAL，dispose 时机同理只在 swap 全部完成后统一处理一次）。
 */
interface PlaceholderShape {
  height: number;
  width: number;
  depth: number;
}

function buildPlaceholderGeometry(shape: PlaceholderShape): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(shape.width, shape.height, shape.depth);
  geometry.translate(0, shape.height / 2, 0); // 落地对齐：基座落在本地 y=0，与 propLibrary.ts 烘焙后的 GLB 几何体同一惯例，swap 前后地标不会有一帧的"陷进地里"或"悬空"跳变
  return geometry;
}

// ---- 巨石阵（M15 P3，M2 A2：站位改为山地区约束——见文件头 §1 与下方 buildStoneCircles 注释）：3 处遗迹，每处 5-7 根立石围成一圈"粗略"圆环。----
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

/**
 * M2 A2：站位采样从"陆地+远离灵泉"改为"陆地+远离灵泉+山地区"
 * （`mask >= MOUNTAIN_ZONE_MASK_MIN`）——这不是巨石阵本身的新要求，是为了让"每处
 * 遗迹中心摆一块云纹岩当核心巨岩"（plan 原话）这件事成立：云纹岩的分布要求本来就是
 * "mountain zone"，而巨石阵恰好也是唯三个 count=3 的地标类型里最适合"石圈中央立一块
 * 巨岩"这个读法的——把两者的站位直接合一（同一个 sites 数组），比另开一套独立的
 * "云纹岩自己的 3 个山地点位"更省一层间接、也更符合"centerpiece"这个词的字面意思。
 */
function buildStoneCircles(scene: THREE.Scene, terrain: Terrain, rng: Rng, mountainCenter: { x: number; z: number }): LandPoint[] {
  const sites = sampleZone(
    rng,
    terrain,
    mountainCenter,
    STONE_SITE_COUNT,
    STONE_LAND_MARGIN + STONE_CIRCLE_RADIUS,
    STONE_SPRING_AVOID_DIST,
    (_h, mask) => mask >= MOUNTAIN_ZONE_MASK_MIN,
  );
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

// ---- 古树 → gushu（M15 P3 程序化几何体原样保留，充当 GLB 到位前的即时占位；M2 A2
// 只改了"最终身份"，站位采样/树干枝干几何体一字未动）：8 株。----
const TREE_COUNT = 8;
const TREE_LAND_MARGIN = 0.8;
const TREE_SPRING_AVOID_DIST = 6;
const TREE_TRUNK_HEIGHT = 7.5;
const TREE_SCALE_MIN = 0.8;
const TREE_SCALE_MAX = 1.33;
const TREE_BRANCH_COUNT = 3;
const TREE_BRANCH_LENGTH = 2.6;
const TREE_FOLIAGE_COUNT = 3;
const TREE_FOLIAGE_RADIUS = 0.95;
const TREE_TILT_JITTER = 0.12;
const TREE_FOLIAGE_LOCAL_OFFSETS: ReadonlyArray<{ x: number; y: number; z: number }> = [
  { x: 0.7, y: TREE_TRUNK_HEIGHT * 0.8, z: 0.3 },
  { x: -0.55, y: TREE_TRUNK_HEIGHT * 0.92, z: -0.45 },
  { x: 0.1, y: TREE_TRUNK_HEIGHT * 1.02, z: 0.55 },
];

/** 虬曲古树的树干+枝干合并几何体（局部空间，基座落在本地 y=0）——M15 P3 原样保留。 */
function buildTreeTrunkGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.16, 0.26, TREE_TRUNK_HEIGHT, 7);
  trunk.translate(0, TREE_TRUNK_HEIGHT / 2, 0);
  const parts: THREE.BufferGeometry[] = [trunk];
  for (let i = 0; i < TREE_BRANCH_COUNT; i++) {
    const branch = new THREE.CylinderGeometry(0.05, 0.13, TREE_BRANCH_LENGTH, 6);
    branch.translate(0, TREE_BRANCH_LENGTH / 2, 0);
    branch.rotateX(1.15 + i * 0.22);
    branch.rotateZ(0.35 + i * 0.2);
    branch.rotateY((i / TREE_BRANCH_COUNT) * Math.PI * 2 + 0.6);
    branch.translate(0, TREE_TRUNK_HEIGHT * (0.5 + i * 0.14), 0);
    parts.push(branch);
  }
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error("landmarks: buildTreeTrunkGeometry merge failed");
  return merged;
}

/**
 * 古树占位（M2 A2：函数改名自 M15 P3 的 buildTrees，签名改为接收外部算好的
 * `sites: PropSite[]`——position+yaw 必须与后面 gushu GLB swap 用的完全一致，见文件
 * 头"位置确定性"一节；scale/tilt 抖动仍在这里现抽 rng，属于占位专属的视觉花活，不
 * 影响 swap 后的一致性契约，占位消失后这几个抽样值也随之作废）。返回占位对象列表供
 * 后续 dispose。
 */
function buildTreesPlaceholder(scene: THREE.Scene, sites: PropSite[], rng: Rng): THREE.Object3D[] {
  const trunkMesh = new THREE.InstancedMesh(
    buildTreeTrunkGeometry(),
    new THREE.MeshLambertMaterial({ color: PALETTE.landmarkTreeTrunk }),
    sites.length,
  );
  const foliageMesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(TREE_FOLIAGE_RADIUS, 0),
    new THREE.MeshLambertMaterial({ color: PALETTE.landmarkTreeFoliage }),
    sites.length * TREE_FOLIAGE_COUNT,
  );

  const treeMatrix = new THREE.Matrix4();
  const offsetMatrix = new THREE.Matrix4();
  const combined = new THREE.Matrix4();
  let foliageIdx = 0;
  for (let i = 0; i < sites.length; i++) {
    const site = sites[i]!;
    const scale = TREE_SCALE_MIN + rng.next() * (TREE_SCALE_MAX - TREE_SCALE_MIN);
    const tiltX = (rng.next() * 2 - 1) * TREE_TILT_JITTER;
    const tiltZ = (rng.next() * 2 - 1) * TREE_TILT_JITTER;
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(tiltX, site.yaw, tiltZ, "XYZ"));
    treeMatrix.compose(new THREE.Vector3(site.x, site.y, site.z), quaternion, new THREE.Vector3(scale, scale, scale));
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
  return [trunkMesh, foliageMesh];
}

// ---- 白骨 → baigu（M15 P3 弧形肋骨占位原样保留；M2 A2：每个 site 最终只落一枚巨兽
// 头骨 GLB，不是逐根肋骨——"白骨替换 2 处遗骸"读的是 site 级替换）：2 处。----
const BONE_SITE_COUNT = 2;
const BONE_MIN_PER_SITE = 4;
const BONE_MAX_PER_SITE = 5;
const BONE_LAND_MARGIN = 0.8;
const BONE_SPRING_AVOID_DIST = 8;
const BONE_ARC_RADIUS = 4.5;
const BONE_ARC_HEIGHT = 4.4;
const BONE_RIB_LENGTH = 1.9;
const BONE_RIB_THICKNESS = 0.32;

/** 白骨占位（M2 A2：改名自 buildBoneSites，签名改为接收 `sites: PropSite[]`——每个 site 的 `yaw` 当作整具骨架的朝向 `facing`，与 M15 P3 原逻辑的"随机 facing"语义完全一致，只是抽样时机挪到了外面）。 */
function buildBonesPlaceholder(scene: THREE.Scene, terrain: Terrain, sites: PropSite[], rng: Rng): THREE.Object3D[] {
  const counts = sites.map(() => BONE_MIN_PER_SITE + rng.int(BONE_MAX_PER_SITE - BONE_MIN_PER_SITE + 1));
  const total = counts.reduce((a, b) => a + b, 0);

  const geometry = new THREE.BoxGeometry(BONE_RIB_THICKNESS, BONE_RIB_LENGTH, BONE_RIB_THICKNESS);
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshLambertMaterial({ color: PALETTE.landmarkBoneWhite }), total);

  const matrix = new THREE.Matrix4();
  const up = new THREE.Vector3(0, 1, 0);
  const baseColor = new THREE.Color(PALETTE.landmarkBoneWhite);
  let idx = 0;
  for (let s = 0; s < sites.length; s++) {
    const site = sites[s]!;
    const count = counts[s]!;
    const facing = site.yaw;
    const cosF = Math.cos(facing);
    const sinF = Math.sin(facing);
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const arcAngle = t * Math.PI;
      const localX = -Math.cos(arcAngle) * BONE_ARC_RADIUS;
      const localY = Math.sin(arcAngle) * BONE_ARC_HEIGHT;
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
  return [mesh];
}

// ---- 发光灵芝丛 → lingzhi（M15 P3 伞菌+发光 sprite 占位原样保留；M2 A2：每个 site
// 最终只落一株"丛生在树桩上"的灵芝 GLB，同 baigu 一样是 site 级替换——GLB 本身的
// prompt 已经是"a cluster of caps on a stump"，天然承载了原来"一丛 3-5 株"的读法）：
// 6 丛。----
const MUSHROOM_CLUSTER_COUNT = 6;
const MUSHROOM_MIN_PER_CLUSTER = 3;
const MUSHROOM_MAX_PER_CLUSTER = 5;
const MUSHROOM_NEAR_SPRING_DIST = 20;
const MUSHROOM_CLUSTER_SPREAD = 1.3;
const MUSHROOM_STEM_HEIGHT = 0.22;
const MUSHROOM_STEM_RADIUS = 0.03;
const MUSHROOM_CAP_RADIUS = 0.15;
const MUSHROOM_CAP_HEIGHT = 0.16;
const MUSHROOM_GLOW_Y_OFFSET = 0.16;
const MUSHROOM_GLOW_POINT_SIZE = 0.55;
// M2 A2：lingzhi GLB 目标高度（镜像 propLibrary.ts 的 PROP_CONFIG.lingzhi.targetSizeMeters
// ——两处都是"1.2m"这同一个 plan 数值的字面复制，propLibrary.ts 不对外导出这份配置表，
// 同 landmarks.ts 其余"镜像私有常量"的既有做法，见 SPRING_GLOW_RING_RADIUS 的头注）,
// 供 swap 后重建发光 sprite 的挂点高度换算。
const LINGZHI_TARGET_HEIGHT = 1.2;

/** 灵芝丛占位（M2 A2：改名自 buildMushroomClusters，签名改为接收 `sites: PropSite[]`）。除了地表几何体外，额外返回发光 sprite 的 Points 对象——swap 时需要连同占位几何体一起替换，见下方 lingzhi swap 逻辑。 */
function buildMushroomsPlaceholder(scene: THREE.Scene, sites: PropSite[], rng: Rng): THREE.Object3D[] {
  const counts = sites.map(() => MUSHROOM_MIN_PER_CLUSTER + rng.int(MUSHROOM_MAX_PER_CLUSTER - MUSHROOM_MIN_PER_CLUSTER + 1));
  const total = counts.reduce((a, b) => a + b, 0);

  const stemGeometry = new THREE.CylinderGeometry(MUSHROOM_STEM_RADIUS * 0.6, MUSHROOM_STEM_RADIUS, MUSHROOM_STEM_HEIGHT, 5);
  stemGeometry.translate(0, MUSHROOM_STEM_HEIGHT / 2, 0);
  const stemMesh = new THREE.InstancedMesh(stemGeometry, new THREE.MeshLambertMaterial({ color: PALETTE.landmarkMushroomCap }), total);

  const capGeometry = new THREE.ConeGeometry(MUSHROOM_CAP_RADIUS, MUSHROOM_CAP_HEIGHT, 7);
  capGeometry.translate(0, MUSHROOM_STEM_HEIGHT + MUSHROOM_CAP_HEIGHT / 2, 0);
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
      const y = site.y; // 占位阶段：直接用 site 落地高度近似（同一丛内地表起伏可忽略），不重新查 terrain.heightAt
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

  const glowPoints = buildGlowPoints(glowPositions, PALETTE.landmarkMushroomGlow, MUSHROOM_GLOW_POINT_SIZE);
  scene.add(glowPoints);
  return [stemMesh, capMesh, glowPoints];
}

/** 常驻发光 Points（不随昼夜 gate——"灵芝 glow (exists)"，plan 明确这层效果保持既有行为，不纳入下方 M2 A2 新增的夜间 gated 效果）。抽出来是因为占位和 GLB swap 之后都要重建同一种发光 sprite，只是位置数组不同。 */
function buildGlowPoints(positions: Float32Array, color: number, size: number): THREE.Points {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    size,
    map: createGlowSprite(),
    color,
    transparent: true,
    sizeAttenuation: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false; // 见 M15 P3 既有理由：颗粒跨度可达整个地图，懒计算包围球不可靠
  return points;
}

// ===========================================================================
// M2 A2 全新 6 类地标：站位采样 + 占位形状表。
// ===========================================================================

// ---- 石碑 shibei ×4：草甸小径（一般陆地，非山地非沼泽）----
const STELE_COUNT = 4;
const STELE_LAND_MARGIN = 0.8;
const STELE_SPRING_AVOID_DIST = 5;
const STELE_TARGET_HEIGHT = 2.2; // 镜像 propLibrary.ts PROP_CONFIG.shibei.targetSizeMeters

// ---- 铜鼎 tongding ×2：一件近泉，一件山地 ----
const DING_TARGET_HEIGHT = 1.6; // 镜像 propLibrary.ts PROP_CONFIG.tongding.targetSizeMeters
const DING_NEAR_SPRING_RING_MIN = 4; // 略超出 SPRING_GLOW_RING_RADIUS(3.6)，不与灵泉光环视觉重叠
const DING_NEAR_SPRING_RING_MAX = 9;
const DING_MOUNTAIN_LAND_MARGIN = 1.0;
const DING_MOUNTAIN_SPRING_AVOID_DIST = 6;

// ---- 图腾柱 tutengzhu ×3：沼泽边缘 ----
const TOTEM_COUNT = 3;
const TOTEM_LAND_MARGIN = 0.05; // 贴近水线——"沼泽边缘"读法，同 sampleNearSpringsOrSwamp 的 swamp 分支容忍度
const TOTEM_SPRING_AVOID_DIST = 3; // 仅底线（DIGSPOT_AVOID_DIST 同量级）——沼泽湿度带本身可能天然贴近灵泉，不额外收紧

// ---- 山门 shanmen ×2：一件山地入口，一件草甸 ----
const GATE_MOUNTAIN_LAND_MARGIN = 0.8;
const GATE_MOUNTAIN_SPRING_AVOID_DIST = 6;
const GATE_MEADOW_LAND_MARGIN = 0.8;
const GATE_MEADOW_SPRING_AVOID_DIST = 6;

// ---- 断桥 duanqiao ×1：一口灵泉的"窄口"边缘（见下方 placeDuanqiaoSite 注释）----
// 镜像 terrain.ts 私有常量 SPRING_POOL_RADIUS(=3)——terrain.ts 未导出它，同本文件
// SPRING_GLOW_RING_RADIUS 头注的既有做法：各处按需镜像同一个数值，不新增跨包导出。
const SPRING_POOL_RADIUS_MIRROR = 3;
const DUANQIAO_RING_OFFSET = 0.6; // 落点比池沿再外探这么多，桥身另一端才会真的悬在水面之上（见 placeDuanqiaoSite）

const PLACEHOLDER_SHAPES: Record<"shibei" | "tongding" | "tutengzhu" | "shanmen" | "yunwenyan" | "duanqiao", PlaceholderShape> = {
  shibei: { height: STELE_TARGET_HEIGHT, width: 0.7, depth: 0.3 },
  tongding: { height: 0.9, width: 1.2, depth: 1.2 },
  tutengzhu: { height: 3.5, width: 0.6, depth: 0.6 },
  shanmen: { height: 5, width: 3.6, depth: 0.5 },
  yunwenyan: { height: 2.2, width: 4, depth: 3 },
  duanqiao: { height: 0.6, width: 1.6, depth: 4 },
};

/** 断桥落点：随机选一口灵泉，落在其池沿再外探 DUANQIAO_RING_OFFSET 处——桥身跨度 4m，从这个落点朝池心方向铺开，近端落地、远端探入水面上方，读作"一段跨在池上的残桥"。朝向不是随机的（见 PropSite.yaw 的这处例外）：必须指向池心才能读出"跨过"而不是"随便扔在岸边"。 */
function placeDuanqiaoSite(rng: Rng, terrain: Terrain): PropSite {
  for (let attempt = 0; attempt < MAX_REJECTION_ATTEMPTS; attempt++) {
    const spring = terrain.springs[rng.int(terrain.springs.length)]!;
    const angle = rng.range(0, Math.PI * 2);
    const dist = SPRING_POOL_RADIUS_MIRROR + DUANQIAO_RING_OFFSET;
    const x = spring.pos.x + Math.cos(angle) * dist;
    const z = spring.pos.z + Math.sin(angle) * dist;
    const y = terrain.heightAt(x, z);
    if (y <= terrain.waterLevel) continue;
    if (nearAnyDigSpot(terrain, x, z, DIGSPOT_AVOID_DIST)) continue;
    // 朝向池心：atan2(dx,dz) 与本文件其余"绕 Y 轴的偏航角"同一约定（0=+Z），指向
    // spring 中心意味着桥身长轴（几何体在本地 Z 上最长——见 PLACEHOLDER_SHAPES.duanqiao
    // 与 propLibrary.ts 的"最长边归一化"）朝着池心铺开。
    const yaw = Math.atan2(spring.pos.x - x, spring.pos.z - z);
    return { x, y, z, yaw };
  }
  throw new Error("landmarks: placeDuanqiaoSite found no valid position after max attempts");
}

// ===========================================================================
// 夜间氛围新增两枚 gated 光效（M2 A2）：铜鼎余烬暖光 + 石碑刻纹幽光——均只在夜里可见
// （interpolateDayNight(timeOfDay).nightAmount 做门控增益，同 particles.ts
// fireflyGainFor 的既有手法），叠加一层缓慢呼吸（同 organVisuals.ts essence 光晕的
// 1.2Hz 呼吸节奏，读作"活的"而不是死板的开关）。这两层效果的挂点高度用
// STELE_TARGET_HEIGHT/DING_TARGET_HEIGHT 换算，不依赖 GLB 是否已经 swap 完成——占位
// 阶段就已经点亮，不需要等 GLB 到位才出现。
// ---------------------------------------------------------------------------
const NIGHT_GLOW_BREATHE_HZ = 1.2;
const STELE_SHIMMER_Y_FRACTION = 0.62; // 石碑刻纹大致在石碑上半段
const STELE_SHIMMER_BASE_OPACITY = 0.45; // "subtle"——比铜鼎余烬更弱一档
const STELE_SHIMMER_POINT_SIZE = 0.35;
const DING_EMBER_Y_FRACTION = 0.4; // 铜鼎余烬大致在鼎腹中段（"鼎内隐约的火光"读法）
const DING_EMBER_BASE_OPACITY = 0.6; // "faint"，但比石碑刻纹更暖更显眼一档——鼎本身就是"容器里有火"的读法
const DING_EMBER_POINT_SIZE = 0.4;

interface NightGatedGlow {
  update(tSec: number, nightAmount: number): void;
}

/** 一组固定挂点的夜间 gated 发光 sprite——石碑/铜鼎各自一份，两者的 material/breathe 参数不同，共用同一套"opacity = baseOpacity × nightAmount × breathe(tSec)"公式。 */
function buildNightGatedGlow(sites: PropSite[], yOffset: number, color: number, size: number, baseOpacity: number): { points: THREE.Points; handle: NightGatedGlow } {
  const positions = new Float32Array(sites.length * 3);
  sites.forEach((s, i) => {
    positions[i * 3] = s.x;
    positions[i * 3 + 1] = s.y + yOffset;
    positions[i * 3 + 2] = s.z;
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    size,
    map: createGlowSprite(),
    color,
    transparent: true,
    opacity: 0,
    sizeAttenuation: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return {
    points,
    handle: {
      update(tSec: number, nightAmount: number): void {
        const breathe = 0.75 + 0.25 * Math.sin(tSec * NIGHT_GLOW_BREATHE_HZ * Math.PI * 2);
        material.opacity = baseOpacity * nightAmount * breathe;
      },
    },
  };
}

// ---- 灵泉可视化（M15 P3，原样保留）----
const SPRING_GLOW_RING_RADIUS = 3.6;
const SPRING_GLOW_RING_THICKNESS = 0.4;
const SPRING_GLOW_RING_OPACITY = 0.5;
const SPRING_GLOW_Y_OFFSET = 0.04;
const SPRING_SPARKLE_COUNT_PER_SPRING = 10;
const SPRING_SPARKLE_RADIUS = 2.0;
const SPRING_SPARKLE_RISE_SPEED = 0.35;
const SPRING_SPARKLE_MAX_HEIGHT = 1.6;
const SPRING_SPARKLE_ORBIT_SPEED = 0.15;

interface SpringVisuals {
  update(frameDt: number, tSec: number): void;
}

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
  const riseOffset = new Float32Array(total);
  const radial = new Float32Array(total);
  const angle0 = new Float32Array(total);

  const sparkleRng = createRng(seed ^ 0x5f21a3);
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
  /** 每渲染帧调用一次（main.ts 无条件调用）。新增第三参 `timeOfDay`（M2 A2）——铜鼎余烬/石碑刻纹两枚夜间 gated 光效需要它算 nightAmount；灵泉上浮颗粒不需要，行为不变。 */
  update(frameDt: number, tSec: number, timeOfDay: number): void;
  /** 各类地标的采样锚点——纯粹是验证用的只读数据出口，见原 M15 P3 头注。M2 A2 新增 6 个字段（stele/ding/totem/gate/bridge），legacy 4 个字段语义不变（同一批站位，只是最终视觉换成了 GLB）。 */
  anchors: {
    trees: ReadonlyArray<{ x: number; z: number }>;
    stoneCircleSites: ReadonlyArray<{ x: number; z: number }>;
    boneSites: ReadonlyArray<{ x: number; z: number }>;
    mushroomClusterSites: ReadonlyArray<{ x: number; z: number }>;
    steleSites: ReadonlyArray<{ x: number; z: number }>;
    dingSites: ReadonlyArray<{ x: number; z: number }>;
    totemSites: ReadonlyArray<{ x: number; z: number }>;
    gateSites: ReadonlyArray<{ x: number; z: number }>;
    bridgeSite: { x: number; z: number };
  };
  /** M2 A2：GLB 布景是否已经完成 swap（无论每类是否全部成功——只反映"loadPropLibrary 的 promise 是否已 resolve 并跑完替换逻辑"，不是"是否 9 类全部成功"）。main.ts 的 dev-only `__shiling` 探针消费，供 Playwright 脚本确定性地等待 lazy-load swap 完成再截图，不需要瞎猜超时时长。 */
  isPropsReady(): boolean;
}

/**
 * 构建全部地标 + 灵泉可视化，一次性调用（main.ts 在地形/scatter 建好之后调用，签名
 * 不变——`seed` 派生 `mountainCenter`，M2 A2 不需要新增任何调用参数）。GLB 布景的
 * 异步加载在函数末尾 fire-and-forget 触发，`buildLandmarks` 本身仍然是同步的：调用
 * 返回时，占位版本已经在 scene 里，世界"立刻可见"这条约束不受影响。
 */
export function buildLandmarks(scene: THREE.Scene, terrain: Terrain, seed: number): Landmarks {
  const rng = createRng(seed ^ 0x6c616e64);
  const mountainCenter = mountainCenterFor(seed, terrain.size);

  // ---- legacy 四类（站位采样 + 占位/最终几何体）：严格保持原 M15 P3 消耗顺序 ----
  const stoneCircleSites = buildStoneCircles(scene, terrain, rng, mountainCenter); // 巨石阵（永久程序化）+ 云纹岩站位来源

  const treeLandPoints = sampleLandAwayFromSprings(rng, terrain, TREE_COUNT, TREE_LAND_MARGIN, TREE_SPRING_AVOID_DIST);
  const treeSites = toPropSites(rng, treeLandPoints);
  let treePlaceholder = buildTreesPlaceholder(scene, treeSites, rng);

  const boneLandPoints = sampleLandAwayFromSprings(rng, terrain, BONE_SITE_COUNT, BONE_LAND_MARGIN + BONE_ARC_RADIUS, BONE_SPRING_AVOID_DIST);
  const boneSites = toPropSites(rng, boneLandPoints);
  let bonePlaceholder = buildBonesPlaceholder(scene, terrain, boneSites, rng);

  const swampMax = terrain.waterLevel + SWAMP_MOISTURE_OFFSET;
  const mushroomLandPoints = sampleNearSpringsOrSwamp(rng, terrain, MUSHROOM_CLUSTER_COUNT, MUSHROOM_NEAR_SPRING_DIST, swampMax);
  const mushroomSites = toPropSites(rng, mushroomLandPoints);
  let mushroomPlaceholder = buildMushroomsPlaceholder(scene, mushroomSites, rng);

  // ---- M2 A2 全新 6 类：站位采样（延续同一条 rng）----
  const steleLandPoints = sampleZone(
    rng, terrain, mountainCenter, STELE_COUNT, STELE_LAND_MARGIN, STELE_SPRING_AVOID_DIST,
    (h, mask) => mask < MEADOW_MASK_MAX && h <= swampMax + 4, // 草甸小径：不在山地影响范围内即可；上界只是防止"草甸"延伸进离水位过高的陡坡地带，不是严格禁沼泽（4m 余量足够宽松，不会误伤正常草地）
  );
  const steleSites = toPropSites(rng, steleLandPoints);

  const dingNearSpringPoint = samplePointNearASpring(rng, terrain, DING_NEAR_SPRING_RING_MIN, DING_NEAR_SPRING_RING_MAX);
  const dingMountainPoints = sampleZone(
    rng, terrain, mountainCenter, 1, DING_MOUNTAIN_LAND_MARGIN, DING_MOUNTAIN_SPRING_AVOID_DIST,
    (_h, mask) => mask >= MOUNTAIN_ZONE_MASK_MIN,
  );
  const dingSites = toPropSites(rng, [dingNearSpringPoint, ...dingMountainPoints]);

  const totemLandPoints = sampleZone(
    rng, terrain, mountainCenter, TOTEM_COUNT, TOTEM_LAND_MARGIN, TOTEM_SPRING_AVOID_DIST,
    (h) => h <= swampMax,
  );
  const totemSites = toPropSites(rng, totemLandPoints);

  const gateMountainPoints = sampleZone(
    rng, terrain, mountainCenter, 1, GATE_MOUNTAIN_LAND_MARGIN, GATE_MOUNTAIN_SPRING_AVOID_DIST,
    (_h, mask) => mask >= MOUNTAIN_ENTRANCE_MASK_MIN && mask < MOUNTAIN_ENTRANCE_MASK_MAX,
  );
  const gateMeadowPoints = sampleZone(
    rng, terrain, mountainCenter, 1, GATE_MEADOW_LAND_MARGIN, GATE_MEADOW_SPRING_AVOID_DIST,
    (_h, mask) => mask < MEADOW_MASK_MAX,
  );
  const gateSites = toPropSites(rng, [...gateMountainPoints, ...gateMeadowPoints]);

  // 云纹岩：站位=巨石阵的 3 个 site 中心本身（不重新采样——见 buildStoneCircles 头注"centerpiece"论证）。
  // 天然岩石允许一点缩放抖动——code review 2026-08-10 纠正：这里不是"同
  // gushu/baigu/lingzhi"（那三类的 toPropSites 调用刻意不传 scaleJitter，swap 到
  // GLB 后是统一尺寸，见 buildTreesPlaceholder 头注"占位消失后这几个抽样值也随之
  // 作废"），云纹岩是本批**唯一**在 swap 之后仍保留缩放抖动的类型。
  const yunwenyanSites = toPropSites(rng, stoneCircleSites, { min: 0.85, max: 1.15 });

  const duanqiaoSite = placeDuanqiaoSite(rng, terrain);

  // ---- M2 A2 全新 6 类：占位（唯一一份共享占位材质，swap 全部完成后统一 dispose 一次） ----
  const placeholderMaterial = new THREE.MeshLambertMaterial({ color: PALETTE.landmarkPropPlaceholder });
  let stelePlaceholder: THREE.Object3D = buildInstancedFromSites(buildPlaceholderGeometry(PLACEHOLDER_SHAPES.shibei), placeholderMaterial, steleSites);
  let dingPlaceholder: THREE.Object3D = buildInstancedFromSites(buildPlaceholderGeometry(PLACEHOLDER_SHAPES.tongding), placeholderMaterial, dingSites);
  let totemPlaceholder: THREE.Object3D = buildInstancedFromSites(buildPlaceholderGeometry(PLACEHOLDER_SHAPES.tutengzhu), placeholderMaterial, totemSites);
  let gatePlaceholder: THREE.Object3D = buildInstancedFromSites(buildPlaceholderGeometry(PLACEHOLDER_SHAPES.shanmen), placeholderMaterial, gateSites);
  let yunwenyanPlaceholder: THREE.Object3D = buildInstancedFromSites(buildPlaceholderGeometry(PLACEHOLDER_SHAPES.yunwenyan), placeholderMaterial, yunwenyanSites);
  let duanqiaoPlaceholder: THREE.Object3D = buildInstancedFromSites(buildPlaceholderGeometry(PLACEHOLDER_SHAPES.duanqiao), placeholderMaterial, [duanqiaoSite]);
  scene.add(stelePlaceholder, dingPlaceholder, totemPlaceholder, gatePlaceholder, yunwenyanPlaceholder, duanqiaoPlaceholder);

  // ---- 夜间氛围两枚新增 gated 光效：石碑刻纹幽光 + 铜鼎余烬暖光（占位阶段即点亮，不等 GLB） ----
  const steleGlow = buildNightGatedGlow(steleSites, STELE_TARGET_HEIGHT * STELE_SHIMMER_Y_FRACTION, PALETTE.landmarkSteleShimmer, STELE_SHIMMER_POINT_SIZE, STELE_SHIMMER_BASE_OPACITY);
  const dingGlow = buildNightGatedGlow(dingSites, DING_TARGET_HEIGHT * DING_EMBER_Y_FRACTION, PALETTE.landmarkDingEmberGlow, DING_EMBER_POINT_SIZE, DING_EMBER_BASE_OPACITY);
  scene.add(steleGlow.points, dingGlow.points);

  // ---- 灵泉可视化（不受本批改动影响） ----
  const springVisuals = buildSpringVisuals(scene, terrain, seed);

  // ---- M2 A2：GLB 布景异步加载 + 一次性 swap（fire-and-forget，不阻塞 buildLandmarks 返回）----
  let propsReady = false;
  loadPropLibrary()
    .then((library: PropLibrary) => {
      const swapOne = (id: PropId, placeholder: THREE.Object3D, sites: PropSite[]): THREE.Object3D => {
        const entry: PropLibraryEntry | undefined = library[id];
        if (!entry) return placeholder; // 该类型 GLB 加载失败：保留占位，游戏不受影响（同 modelLibrary.ts 的既有兜底）
        // disposeMaterial=false：6 个占位共享同一份 placeholderMaterial（见下方统一
        // dispose 一次的注释），这里只清理该类型自己独占的占位几何体。
        removeAndDispose(scene, [placeholder], false);
        const finalMesh = buildInstancedFromSites(entry.geometry, entry.material, sites);
        scene.add(finalMesh);
        return finalMesh;
      };

      stelePlaceholder = swapOne("shibei", stelePlaceholder, steleSites);
      dingPlaceholder = swapOne("tongding", dingPlaceholder, dingSites);
      totemPlaceholder = swapOne("tutengzhu", totemPlaceholder, totemSites);
      gatePlaceholder = swapOne("shanmen", gatePlaceholder, gateSites);
      yunwenyanPlaceholder = swapOne("yunwenyan", yunwenyanPlaceholder, yunwenyanSites);
      duanqiaoPlaceholder = swapOne("duanqiao", duanqiaoPlaceholder, [duanqiaoSite]);
      // 6 类全新地标共享一份占位材质（placeholderMaterial）——只有在全部 6 类都真的
      // swap 成功时才安全 dispose 它：哪怕只有一类失败（保留占位、继续引用这份材质
      // 渲染），这里 dispose 都会让那个仍在场景里的占位 mesh 用一份已 dispose 的材质
      // 渲染（WebGL 层面读到失效资源，不是"退回更丑的占位"这种优雅降级，是真的
      // 渲染错误）——code review 前的第一版曾经无条件 dispose，属于真实 bug，这里
      // 显式收紧成"全部成功才 dispose"，宁可在极端情况下漏释放一份小材质对象，也不能
      // 冒这个风险。
      const allNewTypesSwapped = (["shibei", "tongding", "tutengzhu", "shanmen", "yunwenyan", "duanqiao"] as PropId[]).every(
        (id) => library[id] !== undefined,
      );
      if (allNewTypesSwapped) placeholderMaterial.dispose();

      // legacy 三类：多个占位对象（trunk+foliage / ribs / stem+cap+glow）一次性替换。
      if (library.gushu) {
        removeAndDispose(scene, treePlaceholder, true);
        const gushu = buildInstancedFromSites(library.gushu.geometry, library.gushu.material, treeSites);
        scene.add(gushu);
        treePlaceholder = [gushu];
      }
      if (library.baigu) {
        removeAndDispose(scene, bonePlaceholder, true);
        const baigu = buildInstancedFromSites(library.baigu.geometry, library.baigu.material, boneSites);
        scene.add(baigu);
        bonePlaceholder = [baigu];
      }
      if (library.lingzhi) {
        removeAndDispose(scene, mushroomPlaceholder, true);
        const lingzhi = buildInstancedFromSites(library.lingzhi.geometry, library.lingzhi.material, mushroomSites);
        scene.add(lingzhi);
        // 发光 sprite 保持效果（"keeping their glow sprites"）——按新的 GLB 目标高度
        // 重新算挂点，不复用占位阶段那份 Points（几何体不同批次，直接重建比"原地
        // 修改 buffer 长度"更简单，且发光 sprite 数量本来就没变过，重建成本可忽略）。
        const glowPositions = new Float32Array(mushroomSites.length * 3);
        mushroomSites.forEach((s, i) => {
          glowPositions[i * 3] = s.x;
          glowPositions[i * 3 + 1] = s.y + LINGZHI_TARGET_HEIGHT + MUSHROOM_GLOW_Y_OFFSET;
          glowPositions[i * 3 + 2] = s.z;
        });
        const lingzhiGlow = buildGlowPoints(glowPositions, PALETTE.landmarkMushroomGlow, MUSHROOM_GLOW_POINT_SIZE);
        scene.add(lingzhiGlow);
        mushroomPlaceholder = [lingzhi, lingzhiGlow];
      }

      propsReady = true;
    })
    .catch((err) => {
      // loadPropLibrary 内部已经把每个物种的加载失败都吞掉了（per-species try/catch,
      // 见 propLibrary.ts），这里只兜底"promise 本身意外 reject"这种理论上不会发生的
      // 情况——占位保持在场，游戏不受影响，只是 isPropsReady() 永远不会翻真。
      console.error("landmarks: loadPropLibrary rejected unexpectedly, keeping all placeholders", err);
    });

  return {
    update(frameDt: number, tSec: number, timeOfDay: number): void {
      springVisuals.update(frameDt, tSec);
      const nightAmount = interpolateDayNight(timeOfDay).nightAmount;
      steleGlow.handle.update(tSec, nightAmount);
      dingGlow.handle.update(tSec, nightAmount);
    },
    anchors: {
      trees: treeSites,
      stoneCircleSites,
      boneSites,
      mushroomClusterSites: mushroomSites,
      steleSites,
      dingSites,
      totemSites,
      gateSites,
      bridgeSite: { x: duanqiaoSite.x, z: duanqiaoSite.z },
    },
    isPropsReady: () => propsReady,
  };
}
