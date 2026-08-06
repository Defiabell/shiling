import * as THREE from "three";
import type { Terrain } from "@shiling/sim";
import type { WorldParams } from "@shiling/content";

// 挖点标记配色：未挖=深棕，已挖开=近黑（洞口感）。
const UNDUG_COLOR = 0x5b3a21;
const DUG_COLOR = 0x141414;
// 标记略高于地表，避免与地形网格 z-fighting。
const MARKER_Y_OFFSET = 0.05;

/**
 * 每个挖点标记的三维网格，按 dig spot id 索引，供 updateDigSpots 每帧查找同步。
 */
type DigSpotMarkers = Map<number, THREE.Mesh>;

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
  const terrainMaterial = new THREE.MeshLambertMaterial({ color: 0x7a8b6f });
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
