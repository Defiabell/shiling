import * as THREE from "three";
import { mountainCenterFor, mountainMaskAt, MOUNTAIN_AMP_MULT, type Terrain } from "@shiling/sim";
import type { WorldParams } from "@shiling/content";
import { PALETTE, interpolateDayNight } from "./palette.js";

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

// ---- 普通挖点的枯草描边（M15 P2，巢穴存在感 rider——"escape network reads on the
// ground, not just minimap"）：比家巢草垫更淡更稀疏的版本，见 buildGrassRing/buildDugVisual。
const DUG_GRASS_TUFT_COUNT = 4; // 家巢的一半（8→4）——更稀疏，读作"没人打理的野草"
const DUG_GRASS_RING_RADIUS = 1.5; // 略大于 DUG_OUTER_RING_RADIUS(1.3)，围在淡环外一圈
const DUG_GRASS_TUFT_RADIUS = 0.05;
const DUG_GRASS_TUFT_HEIGHT = 0.18;

// ---- 家巢标记（Part 2，postfix-9 初版为石头环+暖光球；M15 P2 升级为土丘/草垫/骨堆
// 三件套——见 buildHomeNestVisual 头部注释，postfix-9 的石头环整体被这套更具体的
// 视觉取代，不是并存叠加）----
const HOME_NEST_MOUND_RADIUS = 1.1; // 压扁前的球半径——压扁后穹顶实际高度＝此值×MOUND_SQUASH
const HOME_NEST_MOUND_SQUASH = 0.4; // Y 轴压扁比例——"flattened dome"
// 土丘中心沿 +Z 偏移。**Playwright 截图实测修正**（首版 1.9 与半径 1.3 组合，近边缘＝
// 1.9-1.3=0.6，反而落在 DUG_OUTER_RING_RADIUS(1.3) 以内——土丘会整个扣在墨环/洞口上，
// 截图 m15p2-nest-mound-day.png 首版肉眼可见"土丘糊住了洞口"，读不出两者是分开的两个
// 构造）：改成 2.7，近边缘＝2.7-1.1=1.6，恰好与下面 HOME_NEST_GRASS_RING_RADIUS(1.6)
// 齐平（草长到土丘根部，视觉上是连续的），同时比洞口外环(1.3) 多留 0.3m 的干净缝隙。
const HOME_NEST_MOUND_OFFSET = 2.7;
const HOME_NEST_GRASS_COUNT = 8; // 普通挖点的两倍密度——"精心维护的家"读法
const HOME_NEST_GRASS_RING_RADIUS = 1.6;
const HOME_NEST_GRASS_TUFT_RADIUS = 0.09;
const HOME_NEST_GRASS_TUFT_HEIGHT = 0.3;
const HOME_NEST_BONE_COUNT = 3;
const HOME_NEST_BONE_RADIUS = 0.045;
const HOME_NEST_BONE_LENGTH = 0.5;
const HOME_NEST_BONE_CLUSTER_ANGLE = Math.PI * 1.15; // 与土丘偏移方向（0）错开约 205°，20m 外一眼能同时看清土丘＋骨堆两组，不叠在一起
const HOME_NEST_BONE_CLUSTER_RADIUS = 1.1;
// 悬浮高度——与 particles.ts 萤火的悬浮带(FIREFLY_MIN_Y..MAX_Y≈0.8..2.5)同一量级但更贴近
// 地面，读作"就地一盏灯"而非游荡的萤火。位置刻意留在洞口正上方（局部原点，未跟随
// HOME_NEST_MOUND_OFFSET 挪去土丘那一侧，code review 2026-08-10 确认过这一点是设计
// 取舍而非疏漏）：这盏光代表"洞里透出的暖光"，读法是家的入口本身透光，不是土丘上摆了
// 一盏灯——土丘/骨堆/草垫三件套负责白天的"家"识别，暖光负责夜里"这里有人"的信号，
// 两组视觉各自挂在自己最合理的位置上。
const HOME_NEST_GLOW_Y = 0.55;
const HOME_NEST_GLOW_RADIUS = 0.16;
/**
 * 暖光只在暮色/夜里点亮（M15 P2，postfix-9 初版是常驻可见，这里是升级点之一）——
 * nightAmount 取自 palette.ts 的 interpolateDayNight，与 particles.ts 萤火 gain/
 * atmosphere.ts 光照插值同一套 keyframe 数据源。四个关键帧的 nightAmount 依次是
 * 黎明 0.35／白昼 0.0／黄昏 0.65／夜 1.0（见 palette.ts DAYNIGHT_KEYFRAMES）——0.3
 * 卡在"白昼→黎明/黄昏"过渡区间的中段，不是任何一个关键帧本身的数值，两头都留了一截
 * smoothstep 过渡余量，不会卡在插值边界来回抖动。
 */
const HOME_NEST_GLOW_NIGHT_THRESHOLD = 0.3;

// ---- 险峰山地区调色（M15 P3——owner feedback「地形太简单，不符合山海经的背景」）：
// terrainBandColor 算出的高度分层基础色之上，按 sim/src/terrain.ts 的 mountainMaskAt
// 再叠一层 zone-aware tint——"这块地读起来是山地区的一部分"，不是靠地形网格几何形状
// 本身（那由 sim 的 ridged noise 负责）单独传达。----
const MOUNTAIN_ROCK_TINT_MAX = 0.55; // mask=1 时向 mountainRock 混合的最大比例——留一点原有高度分层色，不整块替换成纯灰
const MOUNTAIN_PEAK_TINT_MAX = 0.7; // 峰值区域（h>=peakMin）额外向 mountainPeakSnow 混合的最大比例，"崖线之上，白留"

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
// 导出（M2 A3「地表精致化」）：grassField.ts 复用这份分层公式给 6000 株风草上色——
// 草色要"贴地形色带"，不是另开一套独立的草色渐变。shoreMax/swampMax/peakMin 三个
// 阈值本身仍按 scatter.ts 头部注释"各自计算层不共享内部实现细节"的既有惯例各自镜像
// 一份（几行算术不值得共享），只有这个颜色分层函数本身值得共享（真正的复杂度在这里）。
export function terrainBandColor(h: number, waterLevel: number, shoreMax: number, swampMax: number, peakMin: number): THREE.Color {
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
 *
 * `mountainCenter`（M15 P3）：山地区 zone-aware tint 的圆心——按
 * sim/src/terrain.ts 同一份 `mountainMaskAt` 算出这个顶点是否落在山地区（及落得多
 * "深"），再向 mountainRock/mountainPeakSnow 混合，与 sim 侧 ridged noise 撑起来的
 * 几何形状在空间上精确对齐（不是各自估一份可能对不齐的近似——山地区是"整块地形都
 * 该看起来是山"这件事，不像 scatter.ts 的 slopeAt 那种允许近似的次要细节）。
 */
function applyTerrainVertexColors(
  geometry: THREE.BufferGeometry,
  terrain: Terrain,
  params: WorldParams,
  mountainCenter: { x: number; z: number },
): void {
  const positions = geometry.attributes.position;
  const normals = geometry.attributes.normal;
  if (!positions || !normals) throw new Error("applyTerrainVertexColors: missing position/normal attribute");

  const shoreMax = terrain.waterLevel + 0.6;
  const swampMax = terrain.waterLevel + 0.9; // 沼泽湿度带上限（moisture proxy，W2）——与 scatter.ts 的芦苇采样带同公式
  const peakMin = params.hillAmp * 0.75;
  const globalAmp = params.hillAmp * MOUNTAIN_AMP_MULT; // M15 P3：山地区振幅上限，见 terrain.ts 的 globalAmp 同一常量
  const peakSpan = Math.max(1e-6, globalAmp - peakMin);
  const ink = new THREE.Color(PALETTE.outlineInk);
  const mountainRock = new THREE.Color(PALETTE.mountainRock);
  const mountainPeakSnow = new THREE.Color(PALETTE.mountainPeakSnow);

  const colors = new Float32Array(positions.count * 3);
  for (let i = 0; i < positions.count; i++) {
    const h = positions.getY(i);
    const color = terrainBandColor(h, terrain.waterLevel, shoreMax, swampMax, peakMin);
    const slope = clamp01(1 - normals.getY(i));
    color.lerp(ink, clamp01(slope * PALETTE.slopeInkFactor));

    // 险峰山地区调色（M15 P3）：mask 越高越冷灰（裸崖石），峰值区域再叠一层更强的
    // 留白（mountainPeakSnow）——两次 lerp 顺序不能颠倒：先定下"这是山地区的岩石"，
    // 再单独强调"这一点还恰好是山地区的最高处"，后者是前者的加强，不是独立判断。
    const mask = mountainMaskAt(positions.getX(i), positions.getZ(i), mountainCenter);
    if (mask > 0) {
      color.lerp(mountainRock, mask * MOUNTAIN_ROCK_TINT_MAX);
      if (h >= peakMin) {
        const peakT = clamp01((h - peakMin) / peakSpan);
        color.lerp(mountainPeakSnow, mask * peakT * MOUNTAIN_PEAK_TINT_MAX);
      }
    }

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

/**
 * 单株草垫/枯草——细锥体立在地面（同 scatter.ts buildGrassGeometry 同一手法：translate
 * 让锥体底部落在本地 y=0，这样 mesh.position 直接就是"这株草站的地面点"，不需要额外
 * 减半高度）。
 */
function buildGrassTuft(radius: number, height: number, color: number): THREE.Mesh {
  const geometry = new THREE.ConeGeometry(radius, height, 5);
  geometry.translate(0, height / 2, 0);
  const material = new THREE.MeshLambertMaterial({ color });
  return new THREE.Mesh(geometry, material);
}

/**
 * 一圈草垫/枯草描边——固定角度均分（同 postfix-9 石头环/particles.ts spawnBurrowRing
 * 同一"固定角度而非随机撒点"手法，读出"围成一圈"而不是散落一地），每株再叠一点
 * Math.random() 的高度/半径抖动增加自然感。这是客户端一次性构建（buildTerrainMesh 只调
 * 一次）的纯展示几何体，不是 sim 状态——Math.random() 在这里不影响任何确定性契约，
 * 与 particles.ts 萤火初始相位/scatter.ts 地表点缀已有的用法同一惯例（sim/src 才是
 * "禁止 Math.random()"的确定性纪律边界）。供 buildDugVisual（枯草，稀疏淡）与
 * buildHomeNestVisual（草垫，密集鲜绿）共用，只是传入的数量/半径/颜色不同。
 */
function buildGrassRing(count: number, ringRadius: number, tuftRadius: number, tuftHeight: number, color: number): THREE.Group {
  const group = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const jitter = 0.85 + Math.random() * 0.3;
    const tuft = buildGrassTuft(tuftRadius * jitter, tuftHeight * jitter, color);
    tuft.position.set(Math.sin(angle) * ringRadius, MARKER_Y_OFFSET, Math.cos(angle) * ringRadius);
    tuft.rotation.y = angle; // 沿圆周切线摆一点角度，同一批草读起来不是完全相同的复制粘贴
    group.add(tuft);
  }
  return group;
}

/**
 * 单根骨头——细圆柱躺平（同 pits.ts 交叉枯枝同一手法：默认圆柱沿本地 Y 轴竖直，绕 Z
 * 转 90° 把它掰倒躺平到 X 轴）。
 */
function buildBoneStick(radius: number, length: number, color: number): THREE.Mesh {
  const geometry = new THREE.CylinderGeometry(radius, radius, length, 6);
  const material = new THREE.MeshLambertMaterial({ color });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.z = Math.PI / 2;
  return mesh;
}

/** 已挖 dig spot 的视觉：实心墨洞（全黑圆盘）+ 外圈一道更淡的墨环收边 + 一圈稀疏枯草。 */
function buildDugVisual(): THREE.Group {
  const group = new THREE.Group();
  const holeGeometry = new THREE.CircleGeometry(DUG_HOLE_RADIUS, 32);
  holeGeometry.rotateX(-Math.PI / 2);
  const holeMaterial = new THREE.MeshBasicMaterial({ color: DUG_COLOR });
  const hole = new THREE.Mesh(holeGeometry, holeMaterial);
  hole.position.y = MARKER_Y_OFFSET;
  group.add(hole);
  group.add(buildInkRing(DUG_OUTER_RING_RADIUS, DUG_OUTER_RING_OPACITY));
  // 枯草描边（M15 P2，巢穴存在感 rider——"escape network reads on the ground, not just
  // minimap"）：普通挖开的洞口也有一圈更淡更稀疏的枯草，与家巢草垫（更密、更绿）区分，
  // 读作"这只是个洞"而不是"这是家"，同一套视觉语言里天然分出两个等级。
  group.add(buildGrassRing(DUG_GRASS_TUFT_COUNT, DUG_GRASS_RING_RADIUS, DUG_GRASS_TUFT_RADIUS, DUG_GRASS_TUFT_HEIGHT, PALETTE.digRimGrassDry));
  return group;
}

/**
 * 家巢标记（Part 2，postfix-9 初版为石头环+暖光球；M15 P2「引导链＋巢穴存在感」升级——
 * owner feedback「还是没有巢穴概念」，巢穴系统本身早就存在，问题是可发现性：postfix-9
 * 那圈均匀的灰色小方块从 20m 外读不出"这是一个家"，只读得出"这里有点什么"）：
 *   - 土丘：压扁的半球穹顶，偏移到洞口一侧（不盖住洞口本身），读作"挖洞时堆在旁边的
 *     浮土"——见 HOME_NEST_MOUND_OFFSET 头部注释。
 *   - 草垫环：一圈鲜绿草丛（比 buildDugVisual 的枯草更密更绿，见 buildGrassRing 共用
 *     实现），读作"这里被打理过，是活的"。
 *   - 骨堆：2-3 根散落的骨头，聚在与土丘错开的另一侧角度，避免两组视觉元素叠在同一块
 *     20m 外的视野里。
 *   - 暖光：与萤火同色相（PALETTE.lampWarm），只在暮色/夜里点亮（见 updateHomeNest 的
 *     nightAmount 判定与 HOME_NEST_GLOW_NIGHT_THRESHOLD 注释）——postfix-9 初版是常驻
 *     可见，白天也亮着，本批收紧成"像窗户里透出的灯火"，昼夜差异本身也是一种存在感。
 * 只建一次、单例——GameState.homeNest 本身就是单例（同一时刻只有一个家），
 * updateHomeNest 每帧只做"挪到哪个 dig spot、要不要可见、暖光要不要点亮"的判断，不
 * 重建任何几何体（与 digSpotMarkers 的"常驻创建、可见性切换"是同一套思路，只是这次
 * 只有一份实例，不按 spot id 建 Map）。
 */
function buildHomeNestVisual(): THREE.Group {
  const group = new THREE.Group();

  // 土丘——SphereGeometry 用 thetaLength=PI/2 只取上半球（从极点到赤道），天然就是一个
  // 圆顶，不需要额外裁切/合并几何体；scale.y 再压扁成"flattened dome"。
  const moundGeometry = new THREE.SphereGeometry(HOME_NEST_MOUND_RADIUS, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const moundMaterial = new THREE.MeshLambertMaterial({ color: PALETTE.nestMoundEarth });
  const mound = new THREE.Mesh(moundGeometry, moundMaterial);
  mound.scale.y = HOME_NEST_MOUND_SQUASH;
  mound.position.set(0, MARKER_Y_OFFSET, HOME_NEST_MOUND_OFFSET);
  group.add(mound);

  // 草垫环——密度是普通挖点枯草的两倍，覆盖整整一圈（含盖过土丘那一侧，读作"草长在
  // 新翻的土上"，本身就是自然的）。
  group.add(buildGrassRing(HOME_NEST_GRASS_COUNT, HOME_NEST_GRASS_RING_RADIUS, HOME_NEST_GRASS_TUFT_RADIUS, HOME_NEST_GRASS_TUFT_HEIGHT, PALETTE.scatterGrass));

  // 骨堆——聚在与土丘偏移方向错开约 205° 的一侧，各自的角度/半径/长度都带一点独立抖动
  // （同 buildGrassRing 的 Math.random() 用法，纯展示几何体，见该函数头部注释）。
  for (let i = 0; i < HOME_NEST_BONE_COUNT; i++) {
    const bone = buildBoneStick(HOME_NEST_BONE_RADIUS, HOME_NEST_BONE_LENGTH * (0.8 + Math.random() * 0.3), PALETTE.nestBoneWhite);
    const angle = HOME_NEST_BONE_CLUSTER_ANGLE + (i - (HOME_NEST_BONE_COUNT - 1) / 2) * 0.35;
    const r = HOME_NEST_BONE_CLUSTER_RADIUS + Math.random() * 0.2;
    bone.position.set(Math.sin(angle) * r, MARKER_Y_OFFSET + HOME_NEST_BONE_RADIUS, Math.cos(angle) * r);
    bone.rotation.y = angle + Math.PI / 2 + (Math.random() - 0.5) * 0.6; // 大致沿圆周切向散落，带一点随机偏转，不是整整齐齐一排
    group.add(bone);
  }

  // 暖光——与萤火同色相，MeshBasicMaterial 自发光读法，延续本工程"氛围光靠未受光材质
  // 表达"的既有惯例（不为每个巢穴单独开一盏真实 PointLight）。初值隐藏，updateHomeNest
  // 每帧按 nightAmount 同步真实值（见该函数与 HOME_NEST_GLOW_NIGHT_THRESHOLD）。
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(HOME_NEST_GLOW_RADIUS, 12, 10),
    new THREE.MeshBasicMaterial({ color: PALETTE.lampWarm }),
  );
  glow.position.y = HOME_NEST_GLOW_Y;
  glow.visible = false;
  group.add(glow);
  group.userData["homeNestGlow"] = glow;

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
 *
 * `seed`（M15 P3 新增参数）：与 `createSim(seed)`/`buildScatter(...,seed,...)` 同一个
 * 世界种子——山地区调色需要知道 mountainCenterFor(seed, terrain.size) 算出的圆心，
 * 才能让"看起来是山"的地形色与 sim 侧 ridged noise 撑起来的几何形状精确对齐。
 */
export function buildTerrainMesh(terrain: Terrain, params: WorldParams, seed: number): THREE.Group {
  const group = new THREE.Group();
  const mountainCenter = mountainCenterFor(seed, terrain.size);

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
  applyTerrainVertexColors(terrainGeometry, terrain, params, mountainCenter);
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
 *
 * `timeOfDay`（M15 P2 新增参数）：驱动暖光 chip 的暮色/夜间点亮判定——这一段刻意
 * 不放进上面 spotId 的 dirty-check 里，nightAmount 是连续变化的插值量，不是"变化时
 * 处理一次"的离散事件，必须每帧都重新判断（同 updateWater/updateAtmosphere 每帧
 * 无条件重算同一套惯例，即便 homeNestGroup 本身因为 spotId 未变而没有触发上面那段
 * if 分支）。
 */
export function updateHomeNest(group: THREE.Group, terrain: Terrain, homeNest: { spotId: number; stash: number } | null, timeOfDay: number): void {
  const homeNestGroup = group.userData["homeNestGroup"] as THREE.Group | undefined;
  const tracker = group.userData["homeNestTrackedSpotId"] as { spotId: number | null } | undefined;
  if (!homeNestGroup || !tracker) return;

  const nextSpotId = homeNest?.spotId ?? null;
  if (nextSpotId !== tracker.spotId) {
    tracker.spotId = nextSpotId;
    if (nextSpotId === null) {
      homeNestGroup.visible = false;
    } else {
      const spot = terrain.digSpots.find((s) => s.id === nextSpotId);
      if (!spot) {
        // 防御性兜底：理论上不会发生（homeNest.spotId 只可能来自 buildHomeNest 写入
        // 一个真实存在的 dig spot id），但宁可安静隐藏也不要指向一个不存在的位置。
        homeNestGroup.visible = false;
      } else {
        homeNestGroup.position.set(spot.pos.x, spot.pos.y, spot.pos.z);
        homeNestGroup.visible = true;
      }
    }
  }

  // 暖光——只在暮色/夜里点亮（见 HOME_NEST_GLOW_NIGHT_THRESHOLD 头部注释）；即使
  // homeNestGroup 本身不可见（还没筑巢），照常同步这个子节点的 visible 也没有任何
  // 副作用（父节点 visible=false 时子节点无论如何都不会被渲染），不需要额外 if 包一层。
  const glow = homeNestGroup.userData["homeNestGlow"] as THREE.Mesh | undefined;
  if (glow) {
    glow.visible = interpolateDayNight(timeOfDay).nightAmount >= HOME_NEST_GLOW_NIGHT_THRESHOLD;
  }
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
