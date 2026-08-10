import * as THREE from "three";
import { createRng, type Rng, type Terrain } from "@shiling/sim";
import { PALETTE, interpolateDayNight } from "./palette.js";

/**
 * 贴地流雾（M2 A3「地表精致化」，owner feedback「地图不精致」）：12 片大而柔的
 * 雾贴片（`MIST_COUNT`，落在 brief 给的 10-14 范围内），常驻创建、逐帧原地漂移
 * ——不是事件触发的一次性特效（不进 particles.ts 的事件池），与
 * particles.ts 的萤火（同样"常驻+锚点+正弦漂移"结构）是平级的又一个氛围层，
 * 各自独立文件/独立 Points-or-Sprite 集合。
 *
 * **实现选择：`THREE.Sprite` 而非手写 billboard 面片**——`Sprite` 天生始终
 * 面向摄像机（three.js 内置行为，渲染时自动用摄像机的视图矩阵反算朝向），不需要
 * 每帧手动算一次"面朝摄像机"的旋转矩阵；每片雾还需要独立呼吸的 opacity（不能像
 * particles.ts 的 Points 池那样共享一份材质），本来就要求每片一个独立
 * `SpriteMaterial` 实例——12 个独立 draw call，落在 brief"mist ≤14 sprites"的
 * 预算内，也是"total new draw calls ≤20"这个任务级预算的一部分（风草场 1 个 +
 * 本文件最多 14 个 + particles.ts 新增的飘落物 Points 1 个，合计 ≤16，见任务报告
 * 的 draw-call 账本）。
 *
 * **贴图**：单张共享的径向渐变 canvas 贴图（`buildMistTexture`，只建一次，12 个
 * `SpriteMaterial` 共用同一个 `THREE.Texture` 引用）——比 particles.ts 的
 * `createGlowSprite` 更大更柔（边缘渐隐更宽），读作"雾"而不是"光点"。
 *
 * **混合模式**：`NormalBlending`（brief 原话"additive-off"）——雾是遮挡感的
 * 苍白色，不该像萤火那样"发光"；透明度全程压得很低（`MIST_OPACITY_MIN/MAX`
 * 落在 brief 给的 0.08-0.14 区间）。
 *
 * **产卵区**：低地/沼泽/水边——沿用 scatter.ts/terrainMesh.ts 镜像的
 * `waterLevel+SWAMP_MOISTURE_OFFSET` 湿度带公式（`MIST_BAND_MAX`），下限直接到
 * `waterLevel`（含水面本身正上方——"water edges" brief 明确要求），rng 独立于
 * scatter.ts/landmarks.ts/grassField.ts（各自 `seed ^` 不同常数）。高度用
 * `max(heightAt(x,z), waterLevel)`（水面以下的地形高度会被水面盖住，雾要贴的是
 * "看得见的地表"，不是被水遮住的裸露地形）+ 固定悬浮量。
 *
 * **昼夜呼吸**：`mistGainFor` 镜像 particles.ts 的 `fireflyGainFor`——同一套
 * "白天基准 gain、夜晚拉到 brief 给定的倍数"线性插值手法，`nightAmount` 来自
 * `palette.ts` 的 `interpolateDayNight`，与场景光照/萤火 gain 同一份昼夜关键帧
 * 数据源。brief"night/dawn opacity ×1.6"取的是**夜**关键帧（nightAmount=1.0）
 * 精确达到 ×1.6 这个上限；黎明（nightAmount=0.35）按同一条线性插值自然拿到一个
 * 介于两端之间的部分提升——与 `fireflyGainFor` 头部注释"夜里 gain 更高，×2"
 * 对"夜"这一个关键帧精确成立、其余关键帧按同一插值自然过渡是完全同一种解读。
 */

const MIST_COUNT = 12;
const MIST_BAND_MAX_OFFSET = 0.9; // 镜像 terrainMesh.ts/scatter.ts 的沼泽湿度带上限（waterLevel + 此值）
const MAX_REJECTION_ATTEMPTS = 10_000;

const MIST_HOVER_HEIGHT = 0.4; // 贴地高度——"near ground level"
const MIST_SIZE_MIN = 9; // Sprite 世界单位边长（柔光贴图本身已带渐隐边缘，不需要精确的圆形裁切）
const MIST_SIZE_MAX = 15;
const MIST_OPACITY_MIN = 0.08;
const MIST_OPACITY_MAX = 0.14;
const MIST_DRIFT_RADIUS = 4; // 漂移半径（米）——"drifting slowly"，比萤火的漂移半径(3)略大，雾团更松散
const MIST_DRIFT_FREQ_X = 0.06;
const MIST_DRIFT_FREQ_Z = 0.045;
const MIST_BREATH_FREQ = 0.22; // 透明度"呼吸"频率，比萤火 twinkle(1.8) 慢一个量级——雾的明灭该是缓慢的，不是闪烁

const MIST_GAIN_DAY = 1.0;
const MIST_GAIN_NIGHT = 1.6; // brief 原话"night/dawn opacity ×1.6"——见文件头"昼夜呼吸"一节，取的是夜关键帧精确值

const TEXTURE_SIZE = 128;

/** 昼夜呼吸增益——导出供测试直接断言（纯函数，同 particles.ts 的 fireflyGainFor 惯例）。 */
export function mistGainFor(timeOfDay: number): number {
  const night = interpolateDayNight(timeOfDay).nightAmount;
  return MIST_GAIN_DAY + (MIST_GAIN_NIGHT - MIST_GAIN_DAY) * night;
}

/**
 * 径向渐变雾贴图——比 particles.ts 的 `createGlowSprite` 更宽的渐隐边缘（0→0.6
 * 之间几乎不透明，0.6→1 慢慢淡出），读作"一片雾"而不是"一个光点"。单张共享贴图，
 * 12 个 SpriteMaterial 引用同一个 THREE.Texture 实例。
 */
function buildMistTexture(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("groundMist: 2D context unavailable");
  const r = TEXTURE_SIZE / 2;
  const gradient = ctx.createRadialGradient(r, r, 0, r, r, r);
  gradient.addColorStop(0, "rgba(255,255,255,0.9)");
  gradient.addColorStop(0.5, "rgba(255,255,255,0.55)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

interface MistSlot {
  sprite: THREE.Sprite;
  anchorX: number;
  anchorY: number;
  anchorZ: number;
  phase: number;
}

/** Rejection-samples a low-lying/swamp/water-edge point（见文件头"产卵区"一节）。 */
function sampleMistPoint(rng: Rng, terrain: Terrain, bandMax: number): { x: number; z: number } {
  const half = terrain.size / 2;
  for (let attempt = 0; attempt < MAX_REJECTION_ATTEMPTS; attempt++) {
    const x = rng.range(-half, half);
    const z = rng.range(-half, half);
    const y = terrain.heightAt(x, z);
    if (y <= bandMax) return { x, z };
  }
  throw new Error("groundMist: no lowland/swamp/water-edge position found after max attempts; check WorldParams/terrain");
}

/**
 * 构建贴地流雾并加入 `scene`。调用时机同 `buildScatter`/`buildGrassField`——地形
 * 建好之后一次性调用，`seed` 与 `createSim` 同源。返回的 `update(tSec, timeOfDay)`
 * 每帧原地重写各 sprite 的 position/opacity，不分配新对象。
 */
export function buildGroundMist(
  scene: THREE.Scene,
  terrain: Terrain,
  seed: number,
): { update(tSec: number, timeOfDay: number): void; anchors: ReadonlyArray<{ x: number; z: number }> } {
  const rng = createRng(seed ^ 0x6d697374); // "mist" ascii-ish 常数，独立于 scatter/landmarks/grassField 各自的 rng
  const bandMax = terrain.waterLevel + MIST_BAND_MAX_OFFSET;
  const texture = buildMistTexture();

  const slots: MistSlot[] = [];
  for (let i = 0; i < MIST_COUNT; i++) {
    const { x, z } = sampleMistPoint(rng, terrain, bandMax);
    const groundY = Math.max(terrain.heightAt(x, z), terrain.waterLevel);
    const size = MIST_SIZE_MIN + rng.next() * (MIST_SIZE_MAX - MIST_SIZE_MIN);
    const material = new THREE.SpriteMaterial({
      map: texture,
      color: PALETTE.groundMistPale,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending, // brief 原话"additive-off"——雾是遮挡色，不发光
      opacity: MIST_OPACITY_MIN,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.setScalar(size);
    const anchorY = groundY + MIST_HOVER_HEIGHT;
    sprite.position.set(x, anchorY, z);
    scene.add(sprite);
    slots.push({ sprite, anchorX: x, anchorY, anchorZ: z, phase: rng.next() * Math.PI * 2 });
  }

  return {
    // 验证专用（镜像 landmarks.ts 的 getLandmarkAnchors 既有惯例）：12 片雾很稀疏，
    // 外部 Playwright 脚本靠"随便挑一个低地点"几乎不可能真的落在任何一片雾的漂移
    // 范围内，暴露锚点坐标供脚本精确 warp 过去取景。
    anchors: slots.map((s) => ({ x: s.anchorX, z: s.anchorZ })),
    update(tSec: number, timeOfDay: number): void {
      const gain = mistGainFor(timeOfDay);
      for (const slot of slots) {
        const { sprite, phase } = slot;
        sprite.position.x = slot.anchorX + Math.sin(tSec * MIST_DRIFT_FREQ_X + phase) * MIST_DRIFT_RADIUS;
        sprite.position.z = slot.anchorZ + Math.cos(tSec * MIST_DRIFT_FREQ_Z + phase * 1.4) * MIST_DRIFT_RADIUS;
        // 高度不参与漂移（雾贴地，不该也上下飘）——只保留 anchorY。
        sprite.position.y = slot.anchorY;
        const breath = 0.5 + 0.5 * Math.sin(tSec * MIST_BREATH_FREQ + phase * 1.7); // 0..1，缓慢呼吸
        const opacity = (MIST_OPACITY_MIN + (MIST_OPACITY_MAX - MIST_OPACITY_MIN) * breath) * gain;
        (sprite.material as THREE.SpriteMaterial).opacity = opacity;
      }
    },
  };
}
