import type { WorldParams } from "@shiling/content";
import { createRng, type Rng } from "./rng.js";
import { v3, type Vec3 } from "./vec.js";

export interface DigSpot {
  id: number;
  pos: Vec3;
  dug: boolean;
}

/**
 * 灵泉（M15 P3「山海经地形与地标」——owner feedback「地形太简单，不符合山海经的
 * 背景」）：陆地上凹陷成一口小水塘的碗形地貌，见 createTerrain 内的 carveSpringBowl。
 * `pos.y` 固定取 `waterLevel`（"这是一口水塘，它的水位线"这一语义），不是碗底的实际
 * 挖深值——2D 距离判定（needs.ts 的灵泉加成、client 的可视化/minimap 标记）只用
 * pos.x/pos.z，`dist2d` 本身也只读这两个分量（见 vec.ts），y 分量在这些用途里从不被读取。
 */
export interface Spring {
  id: number;
  pos: Vec3;
}

export interface Terrain {
  size: number;
  waterLevel: number;
  digSpots: DigSpot[];
  /** M15 P3：3 口灵泉，位置由 `seed ^ 0x5eed` 派生，见 createTerrain 内的采样循环。 */
  springs: Spring[];
  /** 世界坐标 → 网格坐标（出界 clamp 到边缘）→ 双线性插值。 */
  heightAt(x: number, z: number): number;
  /** heightAt(x,z) < waterLevel */
  isWater(x: number, z: number): boolean;
}

// value-noise 两层波长（米），与世界大小无关的绝对尺度。
// COARSE_WAVELENGTH 48→72（W2，世界扩大到 480 后地貌单调——旧波长在新世界里会重复出
// 太多小起伏，拉宽粗层波长让地形块头更大、更容易读出"沼泽/草甸/山地"这种大尺度分区）。
const COARSE_WAVELENGTH = 72;
const FINE_WAVELENGTH = 12;
const FINE_WEIGHT = 0.25; // 细层振幅相对粗层的比例
// 陆地基准偏移：value noise 组合本身是零均值对称分布，边缘渐落又会把外圈大片区域
// 压到水下（半径 0.75~1.0 那一圈本来就覆盖了采样范围的近一半面积）。不加偏移的话
// 内陆区域本身也会有约一半概率跌破水位，导致整体水域反超陆地。加一个正向基准偏移，
// 让内陆以陆地为主（偶尔仍有低地/内陆湖），边缘渐落照常把外圈压成水域天然围栏。
const LAND_BIAS = 0.35;
// 边缘渐落起止（r / (size/2)）：0.75 开始渐落，1.0（世界边界）渐落满值。
const EDGE_START_RATIO = 0.75;
const EDGE_END_RATIO = 1.0;
// rejection-sample 安全阀：防止未来 WorldParams（如水域为主的沼泽 biome）配置下
// 陆地点稀缺甚至不存在时，静默死循环卡住游戏——超过上限直接报错，快速暴露配置问题。
const MAX_REJECTION_ATTEMPTS = 10_000;

// ---- 险峰山地区（M15 P3）：NE 象限一片崎岖山地，用 ridged noise 替代该区域原本的
// 平缓丘陵，其余地图不受影响——见 mountainCenterFor/mountainMaskAt/rawHeightAt 内的
// 混合公式。----
const RIDGE_WAVELENGTH = 55; // 山脊噪声波长（米）——比 COARSE_WAVELENGTH(72) 略短，脊线密度看得出走势又不至于太碎太乱
/** 山地区振幅倍数（相对 hillAmp）——brief 明确给定的数值，全局唯一权威来源，测试/client 都从这里导入，不各自抄一份魔法数字。 */
export const MOUNTAIN_AMP_MULT = 1.6;
/**
 * mask=1 的核心半径（米）——"steepest core"。**不是**灵泉排斥半径本身（code review
 * 2026-08-10 指出这条注释此前的措辞容易让人以为调这个常量就能直接挪动排斥范围）：
 * 灵泉是否被排斥真正看的是下面 SPRING_MOUNTAIN_MASK_REJECT 这个 mask 阈值——由于
 * smoothstep 的非线性，mask>0.6 对应的实际距离（约 80m）比这个 55m 更大，调
 * MOUNTAIN_RADIUS_INNER 会连带影响 mask 曲线形状，但真正决定"灵泉能不能落在这里"
 * 的判据在 createTerrain 的灵泉采样循环里，见该处对 SPRING_MOUNTAIN_MASK_REJECT 的引用。
 */
export const MOUNTAIN_RADIUS_INNER = 55;
/** mask 渐落到 0 的外半径（米）——inner..outer 之间是 smoothstep 过渡带，两端导数为零，与其余地图之间不会出现可见接缝。 */
export const MOUNTAIN_RADIUS_OUTER = 115;
const MOUNTAIN_CENTER_SEED_XOR = 0x4d0757a1;
const MOUNTAIN_CENTER_ANGLE_MIN = Math.PI / 6; // 30°
const MOUNTAIN_CENTER_ANGLE_MAX = Math.PI / 3; // 60°
const MOUNTAIN_CENTER_DIST_MIN_RATIO = 0.35; // 距世界原点，占 half 的比例下限
const MOUNTAIN_CENTER_DIST_MAX_RATIO = 0.6;

// ---- 灵泉（M15 P3）----
const SPRING_COUNT = 3;
const SPRING_SEED_XOR = 0x5eed;
/** 池子半径（米）——碗形凹陷的外沿，超出此距离地形完全不受影响。 */
const SPRING_POOL_RADIUS = 3;
const SPRING_BOWL_INNER_RATIO = 0.55; // 碗底"平坦"（其实是同一条 smoothstep 曲线的起点）区半径，占 SPRING_POOL_RADIUS 的比例
const SPRING_BOWL_FLOOR_DEPTH = 2.2; // 碗底相对 waterLevel 的下探深度（米）
const SPRING_LAND_MARGIN = 1.0; // 采样时（碗还没挖）要求的陆地余量——比 digSpot 的 0.5 更宽，给挖完之后的碗留出天然的岸
const SPRING_MOUNTAIN_MASK_REJECT = 0.6; // mountainMaskAt 超过此值视为"最陡核心"，灵泉不允许落在这里（见 brief 原话）
const SPRING_MIN_SPACING = 60; // 灵泉互相之间的最小间距（米）

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * 在一张 (cells+1)x(cells+1) 的方形表上做双线性插值。
 * u/v 是"格点坐标"（已经从世界坐标换算好），范围 [0, cells]；出界会被 clamp 到边缘格。
 */
function bilinearSample(table: number[][], cells: number, u: number, v: number): number {
  const ix0 = clamp(Math.floor(u), 0, cells - 1);
  const iz0 = clamp(Math.floor(v), 0, cells - 1);
  const ix1 = ix0 + 1;
  const iz1 = iz0 + 1;
  const fx = clamp(u - ix0, 0, 1);
  const fz = clamp(v - iz0, 0, 1);
  const row0 = table[iz0]!;
  const row1 = table[iz1]!;
  const h00 = row0[ix0]!;
  const h10 = row0[ix1]!;
  const h01 = row1[ix0]!;
  const h11 = row1[ix1]!;
  const top = h00 + (h10 - h00) * fx;
  const bottom = h01 + (h11 - h01) * fx;
  return top + (bottom - top) * fz;
}

/** 用给定 rng 预填充格点随机值表，取值范围 [-1,1]。 */
function buildLattice(rng: Rng, cells: number): number[][] {
  const res = cells + 1;
  const table: number[][] = [];
  for (let iz = 0; iz < res; iz++) {
    const row: number[] = [];
    for (let ix = 0; ix < res; ix++) row.push(rng.range(-1, 1));
    table.push(row);
  }
  return table;
}

/**
 * 构造一层 value noise：预填格点表（覆盖 [-size/2, size/2]，格距尽量贴近 wavelength，
 * 但取整以精确覆盖世界范围），返回按世界坐标采样的插值函数，取值范围 [-1,1]。
 */
function makeNoiseLayer(rng: Rng, size: number, wavelength: number): (wx: number, wz: number) => number {
  const cells = Math.max(1, Math.round(size / wavelength));
  const effectiveWavelength = size / cells; // 保证格点精确落在世界边界上
  const table = buildLattice(rng, cells);
  const half = size / 2;
  return (wx: number, wz: number): number => {
    const u = (wx + half) / effectiveWavelength;
    const v = (wz + half) / effectiveWavelength;
    return bilinearSample(table, cells, u, v);
  };
}

/**
 * 险峰山地区的中心点（M15 P3）：落在 NE 象限（世界坐标 +x、-z——与 minimap.ts"北=世界
 * -z"的既有约定一致）内一点，角度（30°~60°，象限内居中不贴坐标轴）与距离（世界半径的
 * 35%~60%）都由 `seed ^ MOUNTAIN_CENTER_SEED_XOR` 派生的独立 rng 决定——同一个世界种子
 * 总是长出同一处山地，但具体落在 NE 象限的哪个角落、离原点多远因种子而异（brief 原话
 * "center offset deterministic from seed"）。导出供 client（terrainMesh.ts 的山地区
 * 地形色调整、main.ts 的「首次进入山地」flavor toast 判定）与本文件测试复用同一份计算，
 * 不各自维护一份可能漂移的复刻。
 */
export function mountainCenterFor(seed: number, size: number): { x: number; z: number } {
  const rng = createRng(seed ^ MOUNTAIN_CENTER_SEED_XOR);
  const half = size / 2;
  const angle = rng.range(MOUNTAIN_CENTER_ANGLE_MIN, MOUNTAIN_CENTER_ANGLE_MAX);
  const distRatio = MOUNTAIN_CENTER_DIST_MIN_RATIO + rng.next() * (MOUNTAIN_CENTER_DIST_MAX_RATIO - MOUNTAIN_CENTER_DIST_MIN_RATIO);
  const dist = half * distRatio;
  return { x: Math.cos(angle) * dist, z: -Math.sin(angle) * dist };
}

/**
 * 山地区混合权重：以 `center` 为圆心的 radial smoothstep 遮罩，1=山地核心（ridged noise
 * 完全取代平缓丘陵），0=山地区之外（原有丘陵地形，完全不受影响）。MOUNTAIN_RADIUS_INNER
 * ..OUTER 之间是平滑过渡带——smoothstep 两端导数为零，与地形其余部分的接缝天然不可见，
 * 不需要额外的羽化处理。导出理由同 mountainCenterFor（client 山地区调色/flavor toast 判定
 * 都要读同一份 mask，不能各自逼近一份可能对不齐的近似值）。
 */
export function mountainMaskAt(x: number, z: number, center: { x: number; z: number }): number {
  const d = Math.hypot(x - center.x, z - center.z);
  return 1 - smoothstep(MOUNTAIN_RADIUS_INNER, MOUNTAIN_RADIUS_OUTER, d);
}

/**
 * 灵泉碗形凹陷：在已经烘焙好的 heightmap 网格上，把 spring 附近的格点原地压低——
 * `d <= inner` 的格点整体拍到 `floor`（碗底），`inner < d < outer` 用 smoothstep
 * 从 `floor` 平滑过渡回未经改动的原始高度（`d >= outer` 完全不碰），两端导数为零，
 * 碗口与周围陆地之间不会出现台阶感的接缝。必须在 digSpots 采样之前调用——digSpots
 * 的陆地判据（`h > waterLevel + 0.5`）读的是 heightAt，heightAt 又直接读这张
 * heightmap，碗挖好之后 digSpots 自然不会落进灵泉水面（不需要额外排除逻辑）。
 */
function carveSpringBowl(
  heightmap: number[][],
  n: number,
  effectiveCell: number,
  half: number,
  waterLevel: number,
  spring: Spring,
): void {
  const inner = SPRING_POOL_RADIUS * SPRING_BOWL_INNER_RATIO;
  const outer = SPRING_POOL_RADIUS;
  const floor = waterLevel - SPRING_BOWL_FLOOR_DEPTH;
  const ixMin = clamp(Math.floor((spring.pos.x - outer + half) / effectiveCell), 0, n - 1);
  const ixMax = clamp(Math.ceil((spring.pos.x + outer + half) / effectiveCell), 0, n - 1);
  const izMin = clamp(Math.floor((spring.pos.z - outer + half) / effectiveCell), 0, n - 1);
  const izMax = clamp(Math.ceil((spring.pos.z + outer + half) / effectiveCell), 0, n - 1);
  for (let iz = izMin; iz <= izMax; iz++) {
    const wz = -half + iz * effectiveCell;
    const row = heightmap[iz]!;
    for (let ix = ixMin; ix <= ixMax; ix++) {
      const wx = -half + ix * effectiveCell;
      const d = Math.hypot(wx - spring.pos.x, wz - spring.pos.z);
      if (d >= outer) continue;
      const t = d <= inner ? 0 : smoothstep(inner, outer, d); // 0=碗底，1=未改动的原始高度
      row[ix] = floor + t * (row[ix]! - floor);
    }
  }
}

export function createTerrain(seed: number, params: WorldParams): Terrain {
  const { size, cell, waterLevel, hillAmp, digSpotCount } = params;
  const half = size / 2;

  // 三层 value noise 共用同一条 rng 流：先填粗层格点表，再填细层，最后填山脊层
  // （新增第三层只是继续从同一条流里多消费一段——不影响 coarse/fine 已经生成的值，
  // 两者的确定性契约不受影响）。
  const noiseRng = createRng(seed);
  const coarseNoise = makeNoiseLayer(noiseRng, size, COARSE_WAVELENGTH);
  const fineNoise = makeNoiseLayer(noiseRng, size, FINE_WAVELENGTH);
  const ridgeNoise = makeNoiseLayer(noiseRng, size, RIDGE_WAVELENGTH);

  const mountainCenter = mountainCenterFor(seed, size);

  // 山地区全局振幅（M15 P3）：新的"硬边界"——不只是山地区内部的振幅上限，也是下面
  // edgeSubtract 的计算基准（见其头部注释的解析论证）。
  const globalAmp = hillAmp * MOUNTAIN_AMP_MULT;

  // 边缘渐落幅度：满 falloff 时保证压到 waterLevel 以下（留 0.5m buffer）。
  //
  // **M15 P3 重新推导（山地区振幅 ×1.6 之后，"世界边缘水下"这条 M0 就有的保证是否
  // 还成立）**：旧公式用 `hillAmp - waterLevel + 0.5` 是因为旧地形的高度硬边界就是
  // `±hillAmp`——满 falloff 时从这个上限减去 edgeSubtract，必然落在 `waterLevel-0.5`
  // 以下。山地区混合进来之后，任意一点在减去 falloff 之前的高度 `h`（见 rawHeightAt）
  // 是 `gentleH` 与 `mountainH` 按 mask∈[0,1] 的凸组合：`gentleH∈[-hillAmp,hillAmp]
  // ⊆[-globalAmp,globalAmp]`，`mountainH∈[-globalAmp,globalAmp]`（山脊噪声本身按
  // globalAmp 缩放），两者的凸组合同样落在 `[-globalAmp,globalAmp]` 内——因此 `h` 的
  // 理论上限统一变成了 `globalAmp`，与山地区具体落在哪、mask 在边缘处取值多少完全
  // 无关。把 edgeSubtract 换成用 `globalAmp` 而不是旧的 `hillAmp` 计算，同一个解析
  // 论证原样成立：满 falloff（r>=half，含世界四角——那里 r=half*sqrt2>half，
  // smoothstep 会 clamp 到同样的满值 1）时，`h - edgeSubtract <= globalAmp -
  // (globalAmp - waterLevel + 0.5) = waterLevel - 0.5`，世界边缘（含四角）依旧保证
  // 在水下，且这条保证不依赖"山地区离边缘有多远"这个额外假设——见 terrain.test.ts
  // 新增的 "world rim stays underwater" 回归。
  const edgeSubtract = globalAmp - waterLevel + 0.5;

  function rawHeightAt(x: number, z: number): number {
    // 平缓丘陵（M0 既有公式，地图其余部分原样不变）：两层噪声按振幅加权平均，组合
    // 结果落在 [-1,1]，叠加陆地基准偏移后 clamp 回 [-1,1]，再乘 hillAmp。
    const rawNoise = (coarseNoise(x, z) + FINE_WEIGHT * fineNoise(x, z)) / (1 + FINE_WEIGHT);
    const gentleRaw = clamp(rawNoise + LAND_BIAS, -1, 1);
    const gentleH = gentleRaw * hillAmp;

    // 险峰山地区（M15 P3）：ridged noise——`1-|noise|`，噪声穿越零点的地方读数最高，
    // 天然长出"拔地而起的山脊与崖线"（而不是平滑的圆丘）。`*2-1` 把 [0,1] 映射回
    // [-1,1]，与 gentleRaw 同一量纲才能直接线性混合；再乘 globalAmp 让山地区峰值可以
    // 达到 hillAmp×1.6（brief 明确数值），谷值同样可以下探到 -globalAmp（陡峭崖线的
    // "另一侧"，不强制必须高于地面）。
    const ridged = 1 - Math.abs(ridgeNoise(x, z));
    const mountainRaw = ridged * 2 - 1;
    const mountainH = mountainRaw * globalAmp;

    const mask = mountainMaskAt(x, z, mountainCenter);
    let h = gentleH + mask * (mountainH - gentleH); // mask=0→纯平缓丘陵，mask=1→纯山地区，中间平滑过渡

    const r = Math.hypot(x, z);
    const falloff = smoothstep(EDGE_START_RATIO * half, EDGE_END_RATIO * half, r);
    h -= falloff * edgeSubtract;
    // 振幅硬边界：见上面 edgeSubtract 头部的解析论证，这里的 clamp 只在边缘渐落把
    // 结果推过 -globalAmp 时兜底（测试要求 |height| <= globalAmp 对任意采样点成立）。
    return clamp(h, -globalAmp, globalAmp);
  }

  // 预烘焙高度图网格：分辨率 n = size/cell + 1，heightAt 在这张网格上做双线性插值。
  // effectiveCell（而非原始 cell）保证网格最后一行/列精确落在世界边界上，
  // 即使 size 不能被 cell 整除也不会在边缘产生分辨率偏差（与 makeNoiseLayer 的
  // effectiveWavelength 做法一致）。
  const n = Math.max(2, Math.round(size / cell) + 1);
  const effectiveCell = size / (n - 1);
  const heightmap: number[][] = [];
  for (let iz = 0; iz < n; iz++) {
    const wz = -half + iz * effectiveCell;
    const row: number[] = [];
    for (let ix = 0; ix < n; ix++) {
      const wx = -half + ix * effectiveCell;
      row.push(rawHeightAt(wx, wz));
    }
    heightmap.push(row);
  }

  function heightAt(x: number, z: number): number {
    const u = clamp((x + half) / effectiveCell, 0, n - 1);
    const v = clamp((z + half) / effectiveCell, 0, n - 1);
    return bilinearSample(heightmap, n - 1, u, v);
  }

  function isWater(x: number, z: number): boolean {
    return heightAt(x, z) < waterLevel;
  }

  // 灵泉采样（M15 P3）：独立 rng（`seed ^ SPRING_SEED_XOR`），在挖碗之前的自然地形上
  // rejection-sample——陆地、不在山地最陡核心、与已放置的灵泉保持 SPRING_MIN_SPACING
  // 以上间距。挖碗（carveSpringBowl）必须等全部 3 口位置都采样完才能开始，否则后挖的
  // 灵泉在做"是否陆地"判定时会读到前一口已经挖低的 heightAt，产生采样顺序依赖。
  const springRng = createRng(seed ^ SPRING_SEED_XOR);
  const springs: Spring[] = [];
  for (let i = 0; i < SPRING_COUNT; i++) {
    let placed = false;
    for (let attempt = 0; attempt < MAX_REJECTION_ATTEMPTS; attempt++) {
      const x = springRng.range(-half, half);
      const z = springRng.range(-half, half);
      const h = heightAt(x, z);
      if (h <= waterLevel + SPRING_LAND_MARGIN) continue;
      if (mountainMaskAt(x, z, mountainCenter) > SPRING_MOUNTAIN_MASK_REJECT) continue;
      let farEnough = true;
      for (const s of springs) {
        if (Math.hypot(x - s.pos.x, z - s.pos.z) < SPRING_MIN_SPACING) {
          farEnough = false;
          break;
        }
      }
      if (!farEnough) continue;
      springs.push({ id: i, pos: v3(x, waterLevel, z) });
      placed = true;
      break;
    }
    if (!placed) {
      throw new Error("createTerrain: no valid spring position found after max attempts; check WorldParams/mountain zone config");
    }
  }
  for (const s of springs) carveSpringBowl(heightmap, n, effectiveCell, half, waterLevel, s);

  // 独立 rng（与地形噪声流、灵泉流隔离），rejection-sample 陆地点作为可挖点。
  // 额外要求 height > waterLevel + 0.5，避免贴着水线生成可挖点——碗挖好之后这条
  // 判据天然也排除了灵泉水面本身，不需要专门再判一次"是否在灵泉里"。
  const digRng = createRng(seed ^ 0x9e3779b9);
  const digSpots: DigSpot[] = [];
  for (let i = 0; i < digSpotCount; i++) {
    let placed = false;
    for (let attempt = 0; attempt < MAX_REJECTION_ATTEMPTS; attempt++) {
      const x = digRng.range(-half, half);
      const z = digRng.range(-half, half);
      const h = heightAt(x, z);
      if (h > waterLevel + 0.5) {
        digSpots.push({ id: i, pos: v3(x, h, z), dug: false });
        placed = true;
        break;
      }
    }
    if (!placed) {
      throw new Error("createTerrain: no land position found for dig spot after max attempts; check WorldParams");
    }
  }

  return { size, waterLevel, digSpots, springs, heightAt, isWater };
}
