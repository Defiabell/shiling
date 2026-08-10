import * as THREE from "three";
import { TUNING } from "@shiling/content";
import type { GameState } from "@shiling/sim";
import { PALETTE } from "./palette.js";

/**
 * 陷坑视觉（M15 P1「反制包」）：dark pit disc + 枯枝 cover（thin crossed cylinders，
 * brief 原话）。固定容量池（TUNING.maxPits 个 Group，常驻创建、只做可见性/位置切换）
 * ——同 particles.ts/killMarker.ts 的池化惯例，而不是 terrainMesh.ts 那种按静态 id
 * 建 Map 的写法：dig spot 数量恒定不变，陷坑却会随玩家挖/触发/轮换动态增删，池化
 * 更适合这种"总量恒定上限、成员流转"的场景。
 */
const MARKER_Y_OFFSET = 0.05; // 同 terrainMesh.ts 同名常量，避免与地形网格 z-fighting
const DISC_RADIUS = 0.55;
const BRANCH_LENGTH = 1.0;
const BRANCH_RADIUS = 0.035;
const BRANCH_Y = 0.09; // 略高于圆盘，交叉搭在坑口上方

interface PitSlot {
  group: THREE.Group;
  id: number | null;
}

function buildPitVisual(): THREE.Group {
  const group = new THREE.Group();

  const discGeometry = new THREE.CircleGeometry(DISC_RADIUS, 20);
  discGeometry.rotateX(-Math.PI / 2);
  const discMaterial = new THREE.MeshBasicMaterial({ color: PALETTE.outlineInk });
  const disc = new THREE.Mesh(discGeometry, discMaterial);
  disc.position.y = MARKER_Y_OFFSET;
  group.add(disc);

  // 两根交叉的枯枝——圆柱默认沿本地 Y 轴，先绕 Z 转 90° 躺平到 X 轴，再各自绕 Y 转
  // ±45° 叠出"X"形的交叉搭放。
  const branchGeometry = new THREE.CylinderGeometry(BRANCH_RADIUS, BRANCH_RADIUS, BRANCH_LENGTH, 6);
  const branchMaterial = new THREE.MeshLambertMaterial({ color: PALETTE.scatterWood });
  for (const yaw of [Math.PI / 4, -Math.PI / 4]) {
    const branch = new THREE.Mesh(branchGeometry, branchMaterial);
    branch.rotation.z = Math.PI / 2;
    branch.rotation.y = yaw;
    branch.position.y = BRANCH_Y;
    group.add(branch);
  }

  return group;
}

export interface PitVisuals {
  /** 每帧调用：把 state.pits 的当前成员同步到固定容量的槽位池（分配/回收+定位）。 */
  update(state: GameState): void;
}

export function createPitVisuals(scene: THREE.Scene): PitVisuals {
  const slots: PitSlot[] = [];
  for (let i = 0; i < TUNING.maxPits; i++) {
    const group = buildPitVisual();
    group.visible = false;
    scene.add(group);
    slots.push({ group, id: null });
  }

  function update(state: GameState): void {
    const liveIds = new Set(state.pits.map((pit) => pit.id));
    // 回收：槽位绑定的坑已经不在 state.pits 里了（触发消耗/轮换移除）——隐藏并释放槽位。
    for (const slot of slots) {
      if (slot.id !== null && !liveIds.has(slot.id)) {
        slot.group.visible = false;
        slot.id = null;
      }
    }
    // 分配：state.pits 里还没有对应槽位的（新挖的）——占用一个空槽位并定位。
    for (const pit of state.pits) {
      if (slots.some((s) => s.id === pit.id)) continue;
      const free = slots.find((s) => s.id === null);
      // 防御性：state.pits.length 受 TUNING.maxPits 硬约束（见 sim/src/pits.ts 的
      // addPit），槽位数量与上限相等，理论上不会出现"没有空槽位"的情形。
      if (!free) continue;
      free.id = pit.id;
      free.group.position.set(pit.pos.x, pit.pos.y, pit.pos.z);
      free.group.visible = true;
    }
  }

  return { update };
}
