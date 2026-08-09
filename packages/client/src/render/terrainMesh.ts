import * as THREE from "three";
import type { Terrain } from "@shiling/sim";
import type { WorldParams } from "@shiling/content";
import { PALETTE } from "./palette.js";

// 标记略高于地表，避免与地形网格 z-fighting。
const MARKER_Y_OFFSET = 0.05;

// 已挖 dig spot 的实心墨洞填色（近黑，读作"洞口"）；未挖状态改用下方的三圈墨环，
// 不再是单一底色，故这里不再需要一个对应的 UNDUG_COLOR 常量。
const DUG_COLOR = 0x141414;

// 深水层沉底深度（相对 waterLevel）；表层水波动的振幅/频率见 applyWaterWave。
const WATER_DEEP_SINK = 0.15;
const WATER_SEGMENTS = 48;

// 未挖 dig spot 的三圈同心墨环：半径递增、透明度递减，读作"水面涟漪状"的墨迹提示。
// RING_THICKNESS(0.12) < 最小半径 0.5，且 radii 间距 0.3 留出可见缝隙，故环与环
// 之间既不会互相贴合也不会出现负数内径，不需要额外的下限兜底。
const UNDUG_RING_RADII = [0.5, 0.8, 1.1] as const;
const UNDUG_RING_OPACITIES = [0.5, 0.3, 0.15] as const;
const RING_THICKNESS = 0.12;
const DUG_HOLE_RADIUS = 1.0;
// 外圈淡环的半径/透明度：brief 只要求"外一圈淡环"，未钉死具体数值——
// 半径取洞口外沿再留一点缝隙（1.3，与 1.0 的洞口之间隔出 RING_THICKNESS 那圈
// 环宽），透明度沿用未挖三环里最淡的一档（0.15），保持墨色梯度一致。
const DUG_OUTER_RING_RADIUS = 1.3;
const DUG_OUTER_RING_OPACITY = 0.15;

// ---- 家巢标记（Part 2，postfix-9）：石/骨围成一圈 + 一点暖光萤火色的光点 ----
const HOME_NEST_STONE_COUNT = 6;
const HOME_NEST_STONE_RADIUS = 1.5; // 略大于 DUG_OUTER_RING_RADIUS(1.3)，围在淡环外一圈
const HOME_NEST_STONE_SIZE = { x: 0.22, y: 0.16, z: 0.16 } as const;
const HOME_NEST_GLOW_Y = 0.55; // 悬浮高度——与 particles.ts 萤火的悬浮带(FIREFLY_MIN_Y..MAX_Y≈0.8..2.5)同一量级但更贴近地面，读作"就地一盏灯"而非游荡的萤火
const HOME_NEST_GLOW_RADIUS = 0.16;

/**
 * 每个挖点标记的场景节点，按 dig spot id 索引：undug/dug 两套视觉常驻创建好，
 * updateDigSpots 只做可见性切换（不重建几何体/材质）；isDug 记录上次同步的状态，
 * 供下一帧 dirty-check 用（沿用原先"跳过未变化项"的结构，只是判据从颜色变成了
 * dug 布尔值本身）。
 */
interface DigSpotVisual {
  undug: THREE.Group;
  dug: THREE.Group;
  isDug: boolean;
}
type DigSpotMarkers = Map<number, DigSpotVisual>;

/**
 * 水面表层的引用由本模块内部持有（不像 digSpotMarkers 那样挂在 group.userData
 * 上）：updateWater 的导出签名只接受 tSec、不接受 group，所以用模块级变量记住
 * buildTerrainMesh 建出来的那块 PlaneGeometry(size,size,48,48) 及其 waterLevel。
 * 一次进程只会有一个活跃的 terrainMesh（main.ts 只 build 一次），这里用简单的
 * 模块级单例，不做多实例场景的额外抽象。
 */
let waterSurfaceMesh: THREE.Mesh | null = null;
let waterSurfaceLevel = 0;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * 按高度返回地形基础色（不含坡度墨染）。W2（playtest feedback「地貌单调」）新增了
 * 沼泽湿度带，四种地貌读法：水塘（isWater，本函数不覆盖——水面另有独立的水层网格盖住）
 * / 沼泽 swamp / 草甸 meadow / 山地 rocky：
 * - h <= shoreMax（waterLevel + 0.6）：贴水滩涂一律 terrainShore 起步；其中更靠近
 *   实际水面的内层——|h - waterLevel| < 0.5——再向 waterDeep lerp 0.4，叠出
 *   "近水湿润深色 → 稍高处干燥浅色"的两层渐变（0.5~0.6 之间仍是纯 shore，不参与
 *   这一档）。
 * - shoreMax < h <= swampMax（waterLevel + 0.9，即 moisture proxy 的上限——越接近
 *   waterLevel 越"湿"）：沼泽湿度带，按 moisture（1=贴着 shoreMax、0=到 swampMax 为止）
 *   把 terrainLow（草甸最低色）向 terrainSwamp 混合，读作"低平近水地"。这条带对应
 *   scatter.ts 里芦苇（reeds）的采样范围，颜色与点缀在空间上是一致的。
 * - h >= peakMin（hillAmp * 0.75）：纯 terrainPeak（山地 rocky 的顶端）。
 * - swampMax 到 peakMin 之间：按归一化高度 t 在 Low → Mid → High → Peak 四色之间做
 *   三段线性插值——后半段（High→Peak）本身偏灰，读作"山地 rocky"，配合 scatter.ts
 *   在这个高度带把草丛稀疏化、多摆岩石，视觉上与草甸区分开。
 */
function terrainBandColor(h: number, waterLevel: number, shoreMax: number, swampMax: number, peakMin: number): THREE.Color {
  const shore = new THREE.Color(PALETTE.terrainShore);
  if (h <= shoreMax) {
    if (Math.abs(h - waterLevel) < 0.5) {
      return shore.lerp(new THREE.Color(PALETTE.waterDeep), 0.4);
    }
    return shore;
  }

  const low = new THREE.Color(PALETTE.terrainLow);
  const mid = new THREE.Color(PALETTE.terrainMid);
  const high = new THREE.Color(PALETTE.terrainHigh);
  const peak = new THREE.Color(PALETTE.terrainPeak);

  if (h <= swampMax) {
    const swamp = new THREE.Color(PALETTE.terrainSwamp);
    const moisture = clamp01((swampMax - h) / Math.max(1e-6, swampMax - shoreMax));
    return low.clone().lerp(swamp, moisture);
  }

  const span = Math.max(1e-6, peakMin - swampMax);
  const t = clamp01((h - swampMax) / span);
  const third = 1 / 3;
  if (t <= third) return low.lerp(mid, t / third);
  if (t <= 2 * third) return mid.lerp(high, (t - third) / third);
  return high.lerp(peak, (t - 2 * third) / third);
}

/**
 * 逐顶点写入地形顶点色：先按高度取分层基础色，再按坡度向 outlineInk 墨染
 * （坡度用 computeVertexNormals 烘焙好的法线 y 分量近似——法线越偏离正上方，
 * 说明相邻顶点高差越大、越陡，"相邻顶点高差近似法线倾角"正是这个意思，
 * 不需要再手工重新采样相邻格点)。必须在 computeVertexNormals() 之后调用。
 */
function applyTerrainVertexColors(geometry: THREE.BufferGeometry, terrain: Terrain, params: WorldParams): void {
  const positions = geometry.attributes.position;
  const normals = geometry.attributes.normal;
  if (!positions || !normals) throw new Error("applyTerrainVertexColors: missing position/normal attribute");

  const shoreMax = terrain.waterLevel + 0.6;
  const swampMax = terrain.waterLevel + 0.9; // 沼泽湿度带上限（moisture proxy，W2）——与 scatter.ts 的芦苇采样带同公式
  const peakMin = params.hillAmp * 0.75;
  const ink = new THREE.Color(PALETTE.outlineInk);

  const colors = new Float32Array(positions.count * 3);
  for (let i = 0; i < positions.count; i++) {
    const h = positions.getY(i);
    const color = terrainBandColor(h, terrain.waterLevel, shoreMax, swampMax, peakMin);
    const slope = clamp01(1 - normals.getY(i));
    color.lerp(ink, clamp01(slope * PALETTE.slopeInkFactor));
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
}

/**
 * 按 (x, z) 世界坐标写入水面表层的逐顶点高度：waterLevel 为基准，叠加一组正弦/
 * 余弦交叉波形成的起伏（振幅 0.06，足够小不会让水面大幅穿出岸线）。buildTerrainMesh
 * 建模时以 t=0 调一次拿到初始姿态，updateWater 每帧传入递增的 tSec 复用同一份
 * 公式，保证两处只有一份实现。只重写 y 分量、原地写回同一个 position 数组
 * （不 new 新数组/新几何体），供每帧调用不产生额外分配。
 *
 * 收尾会重新 computeVertexNormals()：这不是"只改 position"字面最省事的做法，
 * 是实测出来的必要项——MeshLambertMaterial 是纯色（非贴图），水面本身透明叠在
 * 同样纯色的深水层上；如果法线不跟着重新算，逐顶点光照强度完全由法线决定、
 * 与 position 无关，于是每帧位移的波纹在渲染结果里是**像素级不变**的（用
 * WebGL gl.readPixels 抓两帧实测验证过，336 格采样点 diff=0）。48x48 分段的
 * 网格重新算法线成本很小，换来"两帧位相差"真正可见，是此处唯一会通过视觉/
 * 像素验证的实现。
 */
function applyWaterWave(geometry: THREE.BufferGeometry, waterLevel: number, tSec: number): void {
  const positions = geometry.attributes.position;
  if (!positions) throw new Error("applyWaterWave: missing position attribute");
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const wave = Math.sin(x * 0.15 + tSec * 1.2) * Math.cos(z * 0.13 + tSec * 0.9) * 0.06;
    positions.setY(i, waterLevel + wave);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
}

/** 单个墨环（RingGeometry 环带），厚度固定，只有半径/透明度可变。 */
function buildInkRing(radius: number, opacity: number): THREE.Mesh {
  const ringGeometry = new THREE.RingGeometry(radius - RING_THICKNESS, radius, 32);
  ringGeometry.rotateX(-Math.PI / 2);
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: PALETTE.outlineInk,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(ringGeometry, ringMaterial);
  mesh.position.y = MARKER_Y_OFFSET;
  return mesh;
}

/** 未挖 dig spot 的视觉：三圈同心墨环，半径越大越淡。 */
function buildUndugVisual(): THREE.Group {
  const group = new THREE.Group();
  for (let i = 0; i < UNDUG_RING_RADII.length; i++) {
    group.add(buildInkRing(UNDUG_RING_RADII[i]!, UNDUG_RING_OPACITIES[i]!));
  }
  return group;
}

/** 已挖 dig spot 的视觉：实心墨洞（全黑圆盘）+ 外圈一道更淡的墨环收边。 */
function buildDugVisual(): THREE.Group {
  const group = new THREE.Group();
  const holeGeometry = new THREE.CircleGeometry(DUG_HOLE_RADIUS, 32);
  holeGeometry.rotateX(-Math.PI / 2);
  const holeMaterial = new THREE.MeshBasicMaterial({ color: DUG_COLOR });
  const hole = new THREE.Mesh(holeGeometry, holeMaterial);
  hole.position.y = MARKER_Y_OFFSET;
  group.add(hole);
  group.add(buildInkRing(DUG_OUTER_RING_RADIUS, DUG_OUTER_RING_OPACITY));
  return group;
}

/**
 * 家巢标记（Part 2，postfix-9）：一圈小石/骨头（6 个灰色小方块，固定均分角度——
 * 复用 particles.ts spawnBurrowRing 同款"固定角度而非随机"手法，读出"围成一圈"的
 * 形状而不是散落一地）+ 一颗悬浮的暖光小球（PALETTE.lampWarm，与萤火/HUD 饥饿环
 * 同一色相，MeshBasicMaterial 自发光读法——延续本工程"氛围光靠未受光材质表达"的
 * 既有惯例，不为每个巢穴单独开一盏真实 PointLight）。只建一次、单例——
 * GameState.homeNest 本身就是单例（同一时刻只有一个家），updateHomeNest 每帧只做
 * "挪到哪个 dig spot、要不要可见"的判断，不重建任何几何体（与 digSpotMarkers 的
 * "常驻创建、可见性切换"是同一套思路，只是这次只有一份实例，不按 spot id 建 Map）。
 */
function buildHomeNestVisual(): THREE.Group {
  const group = new THREE.Group();

  const stoneGeometry = new THREE.BoxGeometry(HOME_NEST_STONE_SIZE.x, HOME_NEST_STONE_SIZE.y, HOME_NEST_STONE_SIZE.z);
  const stoneMaterial = new THREE.MeshLambertMaterial({ color: PALETTE.scatterRock });
  for (let i = 0; i < HOME_NEST_STONE_COUNT; i++) {
    const angle = (i / HOME_NEST_STONE_COUNT) * Math.PI * 2;
    const stone = new THREE.Mesh(stoneGeometry, stoneMaterial);
    stone.position.set(
      Math.sin(angle) * HOME_NEST_STONE_RADIUS,
      MARKER_Y_OFFSET + HOME_NEST_STONE_SIZE.y / 2,
      Math.cos(angle) * HOME_NEST_STONE_RADIUS,
    );
    stone.rotation.y = angle; // 沿圆周切线摆一点角度，六块读起来不是完全相同的复制粘贴
    group.add(stone);
  }

  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(HOME_NEST_GLOW_RADIUS, 12, 10),
    new THREE.MeshBasicMaterial({ color: PALETTE.lampWarm }),
  );
  glow.position.y = HOME_NEST_GLOW_Y;
  group.add(glow);

  return group;
}

/**
 * 构建灰盒地形展示组：起伏地形网格 + 双层水面（深水静止托底 + 表层逐帧起伏）
 * + 挖点墨环标记。
 *
 * 坐标映射说明（关键）：PlaneGeometry 默认在本地 XY 平面（法线 +Z），
 * rotateX(-PI/2) 之后本地 (x, y, 0) 变为 (x, 0, -y) —— 即旋转后 position
 * 属性里的 x/z 分量已经等于目标世界坐标。因此下面的采样顺序是：先旋转，
 * 再读取旋转后的 x/z 喂给 heightAt（地形）/ applyWaterWave（水面表层），
 * 而不是用旋转前的本地 (x, y) 当作 (worldX, worldZ) —— 后者会因为符号未翻转
 * 而把结果沿 Z 轴镜像，与 sim 里的水域/挖点碰撞对不上。水面表层同样不用
 * mesh.position.y 做整体平移（不像下面的深水层那样）：waterLevel 直接烘焙进
 * 每个顶点的 y 分量，这样 updateWater 每帧原地重写这份 y 时，只靠
 * position.getX/getZ 就能复原世界坐标，不需要知道 mesh 自身的 transform。
 */
export function buildTerrainMesh(terrain: Terrain, params: WorldParams): THREE.Group {
  const group = new THREE.Group();

  // --- 地形网格：分辨率对齐 WorldParams.cell，与 sim 内部高度图网格粒度一致 ---
  const segments = Math.max(1, Math.round(params.size / params.cell));
  const terrainGeometry = new THREE.PlaneGeometry(terrain.size, terrain.size, segments, segments);
  terrainGeometry.rotateX(-Math.PI / 2);
  const positions = terrainGeometry.attributes.position;
  if (!positions) throw new Error("buildTerrainMesh: terrain geometry missing position attribute");
  for (let i = 0; i < positions.count; i++) {
    const worldX = positions.getX(i);
    const worldZ = positions.getZ(i);
    positions.setY(i, terrain.heightAt(worldX, worldZ));
  }
  positions.needsUpdate = true;
  terrainGeometry.computeVertexNormals();
  applyTerrainVertexColors(terrainGeometry, terrain, params);
  const terrainMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
  const terrainMesh = new THREE.Mesh(terrainGeometry, terrainMaterial);
  group.add(terrainMesh);

  // --- 水面下层：深水静止托底，整块平面沉在 waterLevel 之下，不参与逐帧更新 ---
  const waterDeepGeometry = new THREE.PlaneGeometry(terrain.size, terrain.size);
  waterDeepGeometry.rotateX(-Math.PI / 2);
  const waterDeepMaterial = new THREE.MeshLambertMaterial({ color: PALETTE.waterDeep });
  const waterDeepMesh = new THREE.Mesh(waterDeepGeometry, waterDeepMaterial);
  waterDeepMesh.position.y = terrain.waterLevel - WATER_DEEP_SINK;
  group.add(waterDeepMesh);

  // --- 水面上层：分段网格，逐顶点起伏，半透明盖住深水层露出层次感 ---
  const waterSurfaceGeometry = new THREE.PlaneGeometry(terrain.size, terrain.size, WATER_SEGMENTS, WATER_SEGMENTS);
  waterSurfaceGeometry.rotateX(-Math.PI / 2);
  applyWaterWave(waterSurfaceGeometry, terrain.waterLevel, 0); // 内部已含 computeVertexNormals()
  const waterSurfaceMaterial = new THREE.MeshLambertMaterial({
    color: PALETTE.waterSurface,
    transparent: true,
    opacity: PALETTE.waterOpacity,
  });
  const surfaceMesh = new THREE.Mesh(waterSurfaceGeometry, waterSurfaceMaterial);
  group.add(surfaceMesh);
  waterSurfaceMesh = surfaceMesh;
  waterSurfaceLevel = terrain.waterLevel;

  // --- 挖点标记：未挖=三圈墨环，已挖=实心墨洞+淡环，两套视觉常驻，靠可见性切换 ---
  const digSpotGroup = new THREE.Group();
  const markers: DigSpotMarkers = new Map();
  for (const spot of terrain.digSpots) {
    const undug = buildUndugVisual();
    const dug = buildDugVisual();
    undug.visible = !spot.dug;
    dug.visible = spot.dug;
    const spotGroup = new THREE.Group();
    spotGroup.position.set(spot.pos.x, spot.pos.y, spot.pos.z);
    spotGroup.add(undug);
    spotGroup.add(dug);
    digSpotGroup.add(spotGroup);
    markers.set(spot.id, { undug, dug, isDug: spot.dug });
  }
  group.add(digSpotGroup);
  group.userData["digSpotMarkers"] = markers;

  // --- 家巢标记：单例，默认隐藏，updateHomeNest 每帧按 state.homeNest 决定位置/可见性 ---
  const homeNestGroup = buildHomeNestVisual();
  homeNestGroup.visible = false;
  group.add(homeNestGroup);
  group.userData["homeNestGroup"] = homeNestGroup;
  // 独立的 tracker 对象（而不是直接读 homeNestGroup.visible 反推）：dirty-check 要比较
  // 的是"上一次同步到的 spotId"，不是"当前是否可见"——两者在"重新筑巢挪到新 spot"
  // 这个场景里不等价（挪动前后 visible 全程都是 true，但 spotId 变了，必须重新定位）。
  group.userData["homeNestTrackedSpotId"] = { spotId: null as number | null };

  return group;
}

/**
 * 每帧调用：把 terrain.digSpots 当前的 dug 状态同步到标记可见性上
 * （未挖=三圈墨环可见，已挖=实心墨洞+淡环可见）。dirty-check（isDug 未变则
 * continue）避免每帧无条件切换可见性，沿用此前按颜色比较跳过的同一结构。
 */
export function updateDigSpots(group: THREE.Group, terrain: Terrain): void {
  const markers = group.userData["digSpotMarkers"] as DigSpotMarkers | undefined;
  if (!markers) return;
  for (const spot of terrain.digSpots) {
    const visual = markers.get(spot.id);
    if (!visual || visual.isDug === spot.dug) continue;
    visual.undug.visible = !spot.dug;
    visual.dug.visible = spot.dug;
    visual.isDug = spot.dug;
  }
}

/**
 * 每帧调用：把家巢标记同步到 state.homeNest 当前指向的 dig spot——null 时隐藏，
 * spotId 变化时（含"从无到有""重新筑巢挪到新地点"两种情况）重新定位再显示。
 * dirty-check 用一个独立的 tracker 对象比较"上一次同步到的 spotId"，不是拿
 * `homeNestGroup.visible` 反推（见 buildTerrainMesh 里那处注释：两者在"挪动"场景
 * 下不等价）。
 */
export function updateHomeNest(group: THREE.Group, terrain: Terrain, homeNest: { spotId: number; stash: number } | null): void {
  const homeNestGroup = group.userData["homeNestGroup"] as THREE.Group | undefined;
  const tracker = group.userData["homeNestTrackedSpotId"] as { spotId: number | null } | undefined;
  if (!homeNestGroup || !tracker) return;

  const nextSpotId = homeNest?.spotId ?? null;
  if (nextSpotId === tracker.spotId) return;
  tracker.spotId = nextSpotId;

  if (nextSpotId === null) {
    homeNestGroup.visible = false;
    return;
  }
  const spot = terrain.digSpots.find((s) => s.id === nextSpotId);
  if (!spot) {
    // 防御性兜底：理论上不会发生（homeNest.spotId 只可能来自 buildHomeNest 写入
    // 一个真实存在的 dig spot id），但宁可安静隐藏也不要指向一个不存在的位置。
    homeNestGroup.visible = false;
    return;
  }
  homeNestGroup.position.set(spot.pos.x, spot.pos.y, spot.pos.z);
  homeNestGroup.visible = true;
}

/**
 * 每帧调用：把水面表层的每个顶点按 applyWaterWave 的公式重新写一次 y
 * （原地写回同一份 Float32 position 数组，不分配新数组/新几何体）。tSec 由
 * main.ts 渲染循环里已经算好的 wall-clock 秒数传入，与 creatureModels 的
 * animate(ctx.tSec) 共用同一个相位来源。buildTerrainMesh 还没调用过时
 * （理论上不会发生，main.ts 总是先 build 再进入渲染循环）静默跳过。
 */
export function updateWater(tSec: number): void {
  if (!waterSurfaceMesh) return;
  applyWaterWave(waterSurfaceMesh.geometry, waterSurfaceLevel, tSec);
}
