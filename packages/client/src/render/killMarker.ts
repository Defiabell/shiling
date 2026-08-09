import * as THREE from "three";
import type { SimEvent } from "./simEvents.js";

/**
 * 击杀浮字「＋肉」（Part 1，postfix-9 击杀特效强化）：世界坐标→屏幕坐标投影出来的
 * 玻璃风格 DOM 小标签，出现在击杀位置，随后 0.8s 内向上飘＋淡出。
 *
 * 只关心"玩家造成的致命一击"——由 main.ts 集中算好传进来的 `killIds: Set<number>`
 * 驱动（code review 2026-08-09 收紧：单纯 `id!==playerId` 不够，潭狩猎杀苓鼠/任意
 * 生物饥饿致死也会命中非玩家 id，见 main.ts PLAYER_HIT_PROXIMITY 头部注释），本模块
 * 不重新判定"是不是玩家造成"。玩家自己死亡不会冒出"＋肉"——那不是一次"收获"，
 * 强行展示会显得荒谬（killIds 的构造本就排除了 id===playerId 的情形）。
 *
 * 池化管理（固定容量、环形分配），不逐次创建/销毁 DOM 节点——延续 particles.ts 事件
 * 粒子池同一套"槽位环形复用"思路，只是这次载体是 DOM 而不是顶点缓冲。
 */
const LABEL_LIFE_SEC = 0.8;
const RISE_DISTANCE_PX = 40; // 上浮的像素距离——brief"rising"的具体量，克制、不喧宾夺主
const POOL_SIZE = 6; // 连续击杀的极限场景也够用，同 particles.ts 事件池"够用就好"的取舍
const STYLE_ID = "shiling-kill-marker-style";
const CONTAINER_ID = "shiling-kill-marker-layer";
// 略高于尸体/击杀位置——读作"从猎物身上浮起"，而不是紧贴地面。
const SPAWN_Y_OFFSET = 1.2;

interface Slot {
  el: HTMLDivElement;
  life: number; // 剩余秒数，<=0 视为空闲槽位
  startScreenY: number;
}

function ensureStyleInjected(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
#${CONTAINER_ID} {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9; /* screenFx.ts(8) 之上、hud.ts 的 #hud(10) 之下——比屏幕特效更"前景"但不遮挡 HUD 数值 */
  overflow: hidden;
}
.shiling-kill-label {
  position: absolute;
  transform: translate(-50%, -50%);
  padding: 3px 10px;
  border-radius: 999px;
  background: rgba(14, 16, 22, 0.55);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.12) inset;
  color: #e8b45f;
  font-size: 14px;
  font-weight: 300;
  letter-spacing: 0.05em;
  white-space: nowrap;
  visibility: hidden;
}
`;
  document.head.appendChild(style);
}

/** 幂等地拿到（或创建）承载浮字标签的固定 id 容器——同 screenFx.ts ensureOverlayDiv 的套路。 */
function ensureContainer(): HTMLDivElement {
  const existing = document.getElementById(CONTAINER_ID);
  if (existing) return existing as HTMLDivElement;
  const el = document.createElement("div");
  el.id = CONTAINER_ID;
  document.body.appendChild(el);
  return el;
}

export function createKillMarker(camera: THREE.PerspectiveCamera): {
  /** 只消费 id 落在 killIds 里的 hit 事件（main.ts 已经算好"玩家造成的致命一击"）；其余一律忽略。 */
  handle(events: SimEvent[], killIds: Set<number>): void;
  /** 每渲染帧调用一次：推进上浮/淡出，并把仍存活的槽位重新定位到（可能已经移动的）相机投影点。 */
  update(frameDt: number): void;
} {
  ensureStyleInjected();
  const container = ensureContainer();

  const slots: Slot[] = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    const el = document.createElement("div");
    el.className = "shiling-kill-label";
    el.textContent = "＋肉";
    container.appendChild(el);
    slots.push({ el, life: 0, startScreenY: 0 });
  }
  let nextSlot = 0;

  /**
   * 世界→屏幕投影。显式调一次 `camera.updateMatrixWorld()`——本函数可能在
   * main.ts 渲染循环里 followCam.update() 重新摆好这一帧的相机位置*之前*被调用
   * （见 main.ts 顿帧/事件处理那段的调用顺序注释），矩阵若不强制刷新，`.project()`
   * 读到的会是上一帧的 matrixWorldInverse——对平滑移动的镜头而言这至多是一帧的
   * 误差（本工程其它地方也接受同量级的插值滞后，见 carrying 视觉的"叼运可能滞后
   * 一帧"结论），但强制刷新几乎零成本，索性做对，不留这层可以避免的误差。
   */
  function spawn(worldPos: { x: number; y: number; z: number }): void {
    camera.updateMatrixWorld();
    const v = new THREE.Vector3(worldPos.x, worldPos.y + SPAWN_Y_OFFSET, worldPos.z);
    v.project(camera);
    // 相机背后，或落在视锥之外（code review 2026-08-09：原先只判 v.z，NDC 的
    // x/y 越界也算不在视野内——两者都不需要浮字，省一次无意义的样式写入）。
    if (v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) return;
    const x = ((v.x + 1) / 2) * innerWidth;
    const y = ((1 - v.y) / 2) * innerHeight;

    const slot = slots[nextSlot]!;
    nextSlot = (nextSlot + 1) % POOL_SIZE;
    slot.life = LABEL_LIFE_SEC;
    slot.startScreenY = y;
    slot.el.style.left = `${x}px`;
    slot.el.style.top = `${y}px`;
    slot.el.style.opacity = "1";
    slot.el.style.visibility = "visible";
  }

  function handle(events: SimEvent[], killIds: Set<number>): void {
    for (const e of events) {
      if (e.kind === "hit" && killIds.has(e.id)) spawn(e.pos);
    }
  }

  function update(frameDt: number): void {
    for (const slot of slots) {
      if (slot.life <= 0) continue;
      slot.life -= frameDt;
      if (slot.life <= 0) {
        slot.life = 0;
        slot.el.style.visibility = "hidden";
        continue;
      }
      const t = 1 - slot.life / LABEL_LIFE_SEC; // 0→1
      slot.el.style.top = `${slot.startScreenY - t * RISE_DISTANCE_PX}px`;
      slot.el.style.opacity = `${1 - t}`;
    }
  }

  return { handle, update };
}
