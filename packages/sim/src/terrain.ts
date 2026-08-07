import type { WorldParams } from "@shiling/content";
import { createRng, type Rng } from "./rng.js";
import { v3, type Vec3 } from "./vec.js";

export interface DigSpot {
  id: number;
  pos: Vec3;
  dug: boolean;
}

export interface Terrain {
  size: number;
  waterLevel: number;
  digSpots: DigSpot[];
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

export function createTerrain(seed: number, params: WorldParams): Terrain {
  const { size, cell, waterLevel, hillAmp, digSpotCount } = params;
  const half = size / 2;

  // 两层 value noise 共用同一条 rng 流：先填粗层格点表，再接着填细层格点表。
  const noiseRng = createRng(seed);
  const coarseNoise = makeNoiseLayer(noiseRng, size, COARSE_WAVELENGTH);
  const fineNoise = makeNoiseLayer(noiseRng, size, FINE_WAVELENGTH);

  // 边缘渐落幅度：满 falloff 时保证压到 waterLevel 以下（留 0.5m buffer）；
  // 取的是"够用但不总是饱和"的量——只有噪声本身已偏高时才会被下面的 clamp 兜底到 -hillAmp，
  // 避免整圈边界被拍成一条死平线。
  const edgeSubtract = hillAmp - waterLevel + 0.5;

  function rawHeightAt(x: number, z: number): number {
    // 两层噪声按振幅加权平均，组合结果落在 [-1,1]：
    // coarse ∈ [-1,1]，fine ∈ [-1,1] ⇒ (coarse + w·fine) / (1+w) ∈ [-1,1]。
    // 叠加陆地基准偏移后再 clamp 回 [-1,1]，保证振幅边界不被破坏。
    const rawNoise = (coarseNoise(x, z) + FINE_WEIGHT * fineNoise(x, z)) / (1 + FINE_WEIGHT);
    const raw = clamp(rawNoise + LAND_BIAS, -1, 1);
    let h = raw * hillAmp;
    const r = Math.hypot(x, z);
    const falloff = smoothstep(EDGE_START_RATIO * half, EDGE_END_RATIO * half, r);
    h -= falloff * edgeSubtract;
    // 振幅硬边界：噪声本身已在 [-hillAmp, hillAmp] 内，这里的 clamp 只在边缘渐落把结果
    // 推过 -hillAmp 时兜底（测试要求 |height| <= hillAmp 对任意采样点成立）。
    return clamp(h, -hillAmp, hillAmp);
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

  // 独立 rng（与地形噪声流隔离），rejection-sample 陆地点作为可挖点。
  // 额外要求 height > waterLevel + 0.5，避免贴着水线生成可挖点。
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

  return { size, waterLevel, digSpots, heightAt, isWater };
}
