import * as THREE from "three";
import type { Terrain } from "@shiling/sim";
import type { WorldParams } from "@shiling/content";
import { PALETTE } from "./palette.js";

// 挖点标记配色：未挖=深棕，已挖开=近黑（洞口感）。
const UNDUG_COLOR = 0x5b3a21;
const DUG_COLOR = 0x141414;
// 标记略高于地表，避免与地形网格 z-fighting。
const MARKER_Y_OFFSET = 0.05;

/**
 * 每个挖点标记的三维网格，按 dig spot id 索引，供 updateDigSpots 每帧查找同步。
 */
type DigSpotMarkers = Map<number, THREE.Mesh>;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * 按高度返回地形基础色（不含坡度墨染）：
 * - h <= shoreMax（waterLevel + 0.6）：纯 terrainShore，不参与渐变（贴水滩涂一律同色）。
 * - h >= peakMin（hillAmp * 0.75）：纯 terrainPeak。
 * - 二者之间：按归一化高度 t 在 Low → Mid → High → Peak 四色之间做三段线性插值。
 */
function terrainBandColor(h: number, shoreMax: number, peakMin: number): THREE.Color {
  const shore = new THREE.Color(PALETTE.terrainShore);
  if (h <= shoreMax) return shore;

  const low = new THREE.Color(PALETTE.terrainLow);
  const mid = new THREE.Color(PALETTE.terrainMid);
  const high = new THREE.Color(PALETTE.terrainHigh);
  const peak = new THREE.Color(PALETTE.terrainPeak);

  const span = Math.max(1e-6, peakMin - shoreMax);
  const t = clamp01((h - shoreMax) / span);
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
  const peakMin = params.hillAmp * 0.75;
  const ink = new THREE.Color(PALETTE.outlineInk);

  const colors = new Float32Array(positions.count * 3);
  for (let i = 0; i < positions.count; i++) {
    const h = positions.getY(i);
    const color = terrainBandColor(h, shoreMax, peakMin);
    const slope = clamp01(1 - normals.getY(i));
    color.lerp(ink, clamp01(slope * PALETTE.slopeInkFactor));
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
}

/**
 * 构建灰盒地形展示组：起伏地形网格 + 半透明水面 + 挖点标记。
 *
 * 坐标映射说明（关键）：PlaneGeometry 默认在本地 XY 平面（法线 +Z），
 * rotateX(-PI/2) 之后本地 (x, y, 0) 变为 (x, 0, -y) —— 即旋转后 position
 * 属性里的 x/z 分量已经等于目标世界坐标。因此下面的采样顺序是：先旋转，
 * 再读取旋转后的 x/z 喂给 heightAt，而不是用旋转前的本地 (x, y) 当作
 * (worldX, worldZ) —— 后者会因为符号未翻转而把地形沿 Z 轴镜像，
 * 与 sim 里的水域/挖点碰撞对不上。
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

  // --- 水面：整块平面停在 waterLevel，不需要逐顶点采样 ---
  const waterGeometry = new THREE.PlaneGeometry(terrain.size, terrain.size);
  waterGeometry.rotateX(-Math.PI / 2);
  const waterMaterial = new THREE.MeshLambertMaterial({
    color: 0x3a6ea5,
    transparent: true,
    opacity: 0.72,
  });
  const waterMesh = new THREE.Mesh(waterGeometry, waterMaterial);
  waterMesh.position.y = terrain.waterLevel;
  group.add(waterMesh);

  // --- 挖点标记：每个 dig spot 一个圆盘，位置沿用 spot.pos（生成时已是地表高度）---
  const digSpotGroup = new THREE.Group();
  const markers: DigSpotMarkers = new Map();
  for (const spot of terrain.digSpots) {
    const markerGeometry = new THREE.CircleGeometry(1.2);
    markerGeometry.rotateX(-Math.PI / 2);
    const markerMaterial = new THREE.MeshLambertMaterial({
      color: spot.dug ? DUG_COLOR : UNDUG_COLOR,
    });
    const markerMesh = new THREE.Mesh(markerGeometry, markerMaterial);
    markerMesh.position.set(spot.pos.x, spot.pos.y + MARKER_Y_OFFSET, spot.pos.z);
    digSpotGroup.add(markerMesh);
    markers.set(spot.id, markerMesh);
  }
  group.add(digSpotGroup);
  group.userData["digSpotMarkers"] = markers;

  return group;
}

/**
 * 每帧调用：把 terrain.digSpots 当前的 dug 状态同步到标记颜色上
 * （未挖=深棕，已挖开=近黑），避免每帧无条件重建材质。
 */
export function updateDigSpots(group: THREE.Group, terrain: Terrain): void {
  const markers = group.userData["digSpotMarkers"] as DigSpotMarkers | undefined;
  if (!markers) return;
  for (const spot of terrain.digSpots) {
    const markerMesh = markers.get(spot.id);
    if (!markerMesh) continue;
    const material = markerMesh.material as THREE.MeshLambertMaterial;
    const targetColor = spot.dug ? DUG_COLOR : UNDUG_COLOR;
    if (material.color.getHex() !== targetColor) material.color.setHex(targetColor);
  }
}
