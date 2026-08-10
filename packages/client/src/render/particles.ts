import * as THREE from "three";
import type { Terrain } from "@shiling/sim";
import { interpolateDayNight, PALETTE } from "./palette.js";
import type { SimEvent } from "./simEvents.js";

/**
 * 粒子系统（Task 6，Post-fix-1 拆成两个 THREE.Points）：
 *
 * - 萤火氛围（`FIREFLY_COUNT`=40）：独立一个 THREE.Points/geometry/material，
 *   创建时初始化一次，此后永久存活，由 `update()` 里单独的一段循环按正弦漂移
 *   驱动。
 * - 事件粒子池（`EFFECT_CAPACITY`=472）：另一个独立的 THREE.Points/geometry/
 *   material，环形游标分配（round-robin over-write，不维护 free-list）：472
 *   远大于任何单次事件的粒子数（最大的一次性 burst 是 lethal hit 的 38），正常
 *   游玩节奏下前一批粒子早就过完生命周期（life<=0）才会被游标绕回来复用，只有
 *   极端连续暴击/连续挖洞才会出现"新粒子提前顶掉一个还没死透的旧粒子"，视觉上
 *   不可感知，用这个简单方案换掉 free-list 的复杂度是有意为之的取舍。
 *
 * **两个 Points 而不是一个（Post-fix-1 变更，原先是单个 THREE.Points 共享
 * 一份 position/color 属性）**：用户反馈"小黄点"——40 个萤火用无 `map` 的
 * PointsMaterial 渲成硬边方块，被误读成一个可互动的拾取物。修复思路是给点
 * 材质挂一张 canvas 生成的径向渐变光斑贴图（`createGlowSprite`），让点渲成
 * 柔和圆形光晕而不是硬方块。但萤火本身需要*加色（additive）*混合才有"发光"
 * 的读法，而事件粒子（墨溅/水花/尘土……）的生命周期效果是靠 RGB 整体线性衰减
 * 到近黑来表达"融入纸面"——同一份颜色数据如果被迫套加色混合，衰减到暗色时会
 * 在深色背景上叠加得比正常混合更亮，读出来的效果是"墨点发光"而不是"墨点变淡
 * 消失"，与预期的水墨氛围直接冲突。二者对混合模式的要求互斥，没有一种共享
 * 材质能同时满足，所以拆成两个独立 Points/material 才是对的：萤火用
 * `AdditiveBlending` + 逐顶点 alpha twinkle（4 分量 vertexColors，
 * three.js 在 color attribute itemSize===4 时会启用 USE_COLOR_ALPHA，直接把
 * 第 4 分量当透明度乘进最终颜色），事件粒子保留原先的 `NormalBlending` +
 * RGB 衰减、只是额外接上同一张贴图换掉硬方块。两个 Points 各自的 draw call
 * 数量都很小（40 / 472 个点），比起单 draw call 的性能收益，正确的混合语义
 * 更重要——这是一次有意识的取舍，不是遗漏。
 *
 * 死粒子仍按 brief 要求整体挪到 y=-999（而不是切 visible，Points 也没有逐点
 * visible 这回事）；x/z 不需要一起清空，反正 y=-999 已经在任何摄像机可见范围
 * 之外。
 *
 * `size` 字段（Float32Array，逐粒子记录 spawn 时的"名义大小"）按原结构保留在
 * 事件粒子池上，但**目前不会真的改变渲染出的点的大小**：THREE.PointsMaterial
 * 的 `size` 是材质级 uniform（所有点公用同一个值），stock 材质不支持逐顶点
 * size attribute（那需要手写 ShaderMaterial）。这是一个记录在案的已知简化，
 * 而不是遗漏——各效果之间的视觉分量差异现在完全靠"粒子数量"（12/36/18/8/6/14）
 * 和颜色来表达。拆分成独立 Points 之后，萤火终于可以用一个明显更小的
 * `FIREFLY_POINT_SIZE`（约事件粒子的一半），不再受制于事件池那档更大的尺寸——
 * 这正是拆分带来的第二个好处（不只是混合模式）。
 */
const FIREFLY_COUNT = 40;
const EFFECT_CAPACITY = 472;
const DEAD_Y = -999;
const POINT_SIZE = 0.45;
const FIREFLY_POINT_SIZE = POINT_SIZE * 0.5; // 用户反馈"小黄点"太显眼像拾取物——减半。纯视觉调参，不关联任何游玩机制（size 只影响渲染，spawn()/handle() 里的事件粒子 size 参数同理，见文件头注释）。

// ---- hit（墨溅）----
const HIT_COUNT = 12;
// HIT_LETHAL_INK_COUNT/CINNABAR_COUNT：玩家自己的死亡（victim id === playerId，见下方
// handle() 的 isKill 判据）仍然只用这两个"普通致命"数值——沿用 postfix-9 之前的既有
// 观感，不跟着一起放大。真正放大的是下面 HIT_KILL_*（玩家造成的击杀，"爽"感升级，
// Part 1 postfix-9）。两套数值分裂开是刻意的：把"更满足的大爆发"堆在玩家自己身上
// 死亡这一刻，观感上是本末倒置的。
const HIT_LETHAL_INK_COUNT = 36;
const HIT_LETHAL_CINNABAR_COUNT = 2;
// ---- 击杀爆发升级（Part 1，postfix-9）：36→60 墨 + 2→4 朱砂，外加下方的冲击环 ----
const HIT_KILL_INK_COUNT = 60;
const HIT_KILL_CINNABAR_COUNT = 4;
const HIT_LIFE = 0.5;
const HIT_GRAVITY = -9;
const HIT_SPEED_MIN = 2.5;
const HIT_SPEED_MAX = 5;
const HIT_CONE_HALF_ANGLE = (50 * Math.PI) / 180; // 锥形上抛，够宽读作"溅"
const HIT_SIZE = 0.3;
const HIT_LETHAL_CINNABAR_SIZE = 0.4;

// ---- 击杀冲击环（Part 1，postfix-9）：短命的平贴 RingGeometry mesh，靠整体 scale
// 模拟"扩散"，比逐帧重建几何体便宜得多——4 个一组池化（环形分配，同事件粒子池同一套
// 简单方案：击杀频率远低于连续命中，4 个足够覆盖"连续击杀"的极限场景，不需要真正的
// free-list）。颜色用 cinnabar，呼应致命一击本就用朱砂点题的既有配色。
const KILL_RING_POOL = 4;
const KILL_RING_LIFE = 0.35;
const KILL_RING_BASE_RADIUS = 1.0;
const KILL_RING_THICKNESS = 0.18;
const KILL_RING_START_SCALE = 0.5;
const KILL_RING_END_SCALE = 2.4;
const KILL_RING_START_OPACITY = 0.8;
const KILL_RING_Y_OFFSET = 0.08; // 略高于地面，避免与地形/尸体贴地阴影 z-fighting

// ---- splash（水花）----
const SPLASH_COUNT = 18;
// life 必须 >= 最快弹道自己"上抛再落回原高度"所需的时间（2*vy/gravity），否则粒子
// 会在半空中被生命周期直接掐掉，视觉上永远看不到"落回水面"这一下——code review
// 发现的真实调参问题：vy∈[cos(15°)*2.5, cos(15°)*4.5]≈[2.42,4.35]，落回耗时
// 2*vy/9∈[0.54s,0.97s]；0.97s 的上限只到"变得基本看不清"的边缘（colors 早已按
// life/maxLife 衰减到接近黑），LIFE=1.0 留了足够余量覆盖这个上限。
const SPLASH_LIFE = 1.0;
const SPLASH_GRAVITY = -9;
const SPLASH_SPEED_MIN = 2.5;
const SPLASH_SPEED_MAX = 4.5;
const SPLASH_CONE_HALF_ANGLE = (15 * Math.PI) / 180; // 窄锥 = 柱状上喷
const SPLASH_SIZE = 0.35;

// ---- digTick（尘土）----
const DIG_COUNT = 8;
const DIG_LIFE = 0.35;
const DIG_GRAVITY = -9;
const DIG_SPEED_MIN = 1;
const DIG_SPEED_MAX = 2;
const DIG_CONE_HALF_ANGLE = (60 * Math.PI) / 180; // 低抛 = 宽锥、低速
const DIG_SIZE = 0.25;

// ---- drink（涟漪替代）----
const DRINK_COUNT = 6;
const DRINK_LIFE = 0.6;
const DRINK_SPEED_MIN = 0.15;
const DRINK_SPEED_MAX = 0.4; // 几乎原地，只有很小的径向漂移
const DRINK_SIZE = 0.2;

// ---- carcassGone（灰白升腾）----
const CARCASS_COUNT = 10;
const CARCASS_LIFE = 1.2;
const CARCASS_GRAVITY = -0.3; // 轻微减速而非匀速上飘，读作"渐渐散去"
const CARCASS_RISE_SPEED_MIN = 0.5;
const CARCASS_RISE_SPEED_MAX = 1.0;
const CARCASS_JITTER = 0.3; // 水平抖动幅度（不是径直上升，带一点飘散感）
const CARCASS_SIZE = 0.3;

// ---- burrowToggle（尘土环）----
const BURROW_RING_COUNT = 14;
const BURROW_RING_LIFE = 0.5;
const BURROW_RING_GRAVITY = -9;
const BURROW_RING_SPEED_MIN = 1.5;
const BURROW_RING_SPEED_MAX = 3;
const BURROW_RING_UP_MIN = 0.5;
const BURROW_RING_UP_MAX = 1.2;
const BURROW_RING_SIZE = 0.25;

// ---- 萤火（常驻氛围）----
// Post-fix-1：createParticles 现在多接一个 terrain 参数（原先只有 scene，
// handle() 才拿得到 terrain，但也只给 waterLevel），萤火的游荡高度因此改成
// 采样 terrain.heightAt 算出的"地表 + 固定悬浮带"，不再是写死的世界绝对 Y——
// 之前 FIREFLY_MIN_Y..MAX_Y=[1,4] 是绝对世界坐标，在 hillAmp=9 的丘陵地形上
// 完全可能钻进地里或飘到令人困惑的高度，是用户反馈"读作地面物品"的部分成因。
const FIREFLY_SPREAD = 90;
const FIREFLY_MIN_Y = 0.8; // 地表以上（Patch: 相对 terrain.heightAt，不再是绝对世界 Y）
const FIREFLY_MAX_Y = 2.5;
const FIREFLY_DRIFT_RADIUS = 3;
const FIREFLY_DRIFT_FREQ_X = 0.25;
const FIREFLY_DRIFT_FREQ_Z = 0.18;
const FIREFLY_BOB_AMP = 0.6;
const FIREFLY_BOB_FREQ = 0.35;
const FIREFLY_TWINKLE_BASE = 0.75; // 现在驱动的是逐顶点 alpha（见下），不再是 RGB 亮度倍数
const FIREFLY_TWINKLE_AMP = 0.25;
const FIREFLY_TWINKLE_FREQ = 1.8;
/**
 * 萤火夜间 gain（M1 B5，plan 原话"夜里萤火 gain 更高，×2"）：不是把 alpha 往上顶到
 * >1（额定 additive blending 下 alpha>1 只会在饱和处被 GPU 钳到最亮，视觉上没有真正
 * "更亮"的余地，也没必要冒 alpha 语义溢出的风险），而是反过来——白昼把已经调好的
 * twinkle 数值打半折，夜晚保持 FIREFLY_TWINKLE_BASE/AMP 原有（早就playtest 调好的）
 * 亮度不变。这样"夜里是白昼的 2 倍"这个比例关系精确成立（NIGHT_GAIN/DAY_GAIN=2），
 * 且从不越出 [DAY_GAIN, NIGHT_GAIN] 这个安全区间。nightAmount 来自
 * palette.ts 的 interpolateDayNight（与 atmosphere.ts 的光照/雾/天穹插值同一套
 * keyframe 数据，昼夜两头的 gain 因此天然与光照明暗过渡同步）。
 */
const FIREFLY_GAIN_DAY = 0.5;
const FIREFLY_GAIN_NIGHT = 1.0;

/** 导出供 particles.test.ts 直接断言——纯函数，不需要 THREE/DOM。 */
export function fireflyGainFor(timeOfDay: number): number {
  const night = interpolateDayNight(timeOfDay).nightAmount;
  return FIREFLY_GAIN_DAY + (FIREFLY_GAIN_NIGHT - FIREFLY_GAIN_DAY) * night;
}

// ---- 柔光贴图（Post-fix-1）----
const SPRITE_TEXTURE_SIZE = 64;

/** hex → [r,g,b]，只在 createParticles 里对每个用到的 PALETTE 色调用一次（非逐帧/逐粒子）。 */
function toRgb01(hex: number): readonly [number, number, number] {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b] as const;
}

/**
 * 生成一张径向渐变的柔光贴图（中心白、边缘透明），供两个 Points 材质的
 * `map` 共用——用户反馈"小黄点"读作方块拾取物，根因是 PointsMaterial 没设
 * `map` 时 GPU 直接把每个点画成硬边正方形。贴图本身不含颜色信息（纯白+alpha
 * 渐变），最终可见色仍完全由 vertexColors 决定，贴图只负责"形状"（圆形+边缘
 * 柔化），职责单一，两种混合模式（加色/普通）都能正确叠加它。
 */
function createGlowSprite(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = SPRITE_TEXTURE_SIZE;
  canvas.height = SPRITE_TEXTURE_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("createGlowSprite: 2D context unavailable");
  const r = SPRITE_TEXTURE_SIZE / 2;
  const gradient = ctx.createRadialGradient(r, r, 0, r, r, r);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.4, "rgba(255,255,255,0.85)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, SPRITE_TEXTURE_SIZE, SPRITE_TEXTURE_SIZE);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/**
 * 锥形速度采样：theta=0 时正对 +Y（正上方），coneHalfAngle 越大锥越宽（越接近水平），
 * phi 是绕 Y 轴的随机方位角。返回标量分量而不是 THREE.Vector3，配合 spawn() 的
 * 标量参数签名，事件触发时（不是逐帧）分配几个数字没有性能问题。
 */
function coneVelocity(
  speedMin: number,
  speedMax: number,
  coneHalfAngle: number,
): { vx: number; vy: number; vz: number } {
  const speed = speedMin + Math.random() * (speedMax - speedMin);
  const theta = Math.random() * coneHalfAngle;
  const phi = Math.random() * Math.PI * 2;
  const vy = Math.cos(theta) * speed;
  const horiz = Math.sin(theta) * speed;
  return { vx: Math.cos(phi) * horiz, vy, vz: Math.sin(phi) * horiz };
}

export function createParticles(
  scene: THREE.Scene,
  terrain: Terrain,
): {
  /**
   * `killIds`（Part 1，postfix-9 新增第三参；code review 2026-08-09 收紧）：main.ts
   * 集中算好的"本 tick 里玩家造成的致命一击"受害者 id 集合——不是简单的
   * `id!==playerId`（那样潭狩猎杀苓鼠/任意生物饥饿致死也会被误判成"玩家造成"，
   * 见 main.ts PLAYER_HIT_PROXIMITY 头部注释）。本模块只管按 id 是否在集合里决定
   * 要不要放大爆发，不重新判定"是不是玩家造成"。
   */
  handle(events: SimEvent[], terrain: { waterLevel: number }, killIds: Set<number>): void;
  /**
   * `timeOfDay`（M1 B5，第三参）：main.ts 直传 `sim.state.timeOfDay`——见
   * FIREFLY_GAIN_DAY/NIGHT 头部注释，只用于驱动萤火 twinkle 的昼夜 gain，不影响
   * 事件粒子池的任何行为。
   */
  update(frameDt: number, tSec: number, timeOfDay: number): void;
} {
  const sprite = createGlowSprite();

  const INK = toRgb01(PALETTE.outlineInk);
  const CINNABAR = toRgb01(PALETTE.cinnabar);
  const WATER = toRgb01(PALETTE.waterSurface);
  const DUST = toRgb01(PALETTE.terrainMid);
  const CARCASS = toRgb01(PALETTE.carcass);
  const FIREFLY = toRgb01(PALETTE.lampWarm);

  // ---- 萤火 Points：一次性初始化，永久存活，独立 geometry/material ----
  const fireflyPositions = new Float32Array(FIREFLY_COUNT * 3);
  const fireflyColors = new Float32Array(FIREFLY_COUNT * 4); // RGBA：itemSize=4 触发 three.js 的 USE_COLOR_ALPHA
  const fireflyAnchorX = new Float32Array(FIREFLY_COUNT);
  const fireflyAnchorY = new Float32Array(FIREFLY_COUNT); // 已含地表高度（heightAt 采样结果），非相对值
  const fireflyAnchorZ = new Float32Array(FIREFLY_COUNT);
  const fireflyPhase = new Float32Array(FIREFLY_COUNT);
  for (let i = 0; i < FIREFLY_COUNT; i++) {
    const x = (Math.random() * 2 - 1) * FIREFLY_SPREAD;
    const z = (Math.random() * 2 - 1) * FIREFLY_SPREAD;
    fireflyAnchorX[i] = x;
    fireflyAnchorZ[i] = z;
    // 地表 + 固定悬浮带，而不是绝对世界 Y——见上方 FIREFLY_MIN_Y 注释。漂移
    // （见 update() 的 FIREFLY_DRIFT_RADIUS）会把萤火移到 anchor 之外的
    // (x,z)，那里的实际地表高度可能与这里采样的 anchor 高度略有出入；同一种
    // "渲染层没有权威数据源就退而求其次自己估一个"的处理方式，量级足够小
    // （漂移半径 3m vs 地形起伏尺度），不做逐帧重新采样。
    fireflyAnchorY[i] = terrain.heightAt(x, z) + FIREFLY_MIN_Y + Math.random() * (FIREFLY_MAX_Y - FIREFLY_MIN_Y);
    fireflyPhase[i] = Math.random() * Math.PI * 2;
    fireflyPositions[i * 3] = fireflyAnchorX[i]!;
    fireflyPositions[i * 3 + 1] = fireflyAnchorY[i]!;
    fireflyPositions[i * 3 + 2] = fireflyAnchorZ[i]!;
    fireflyColors[i * 4] = FIREFLY[0];
    fireflyColors[i * 4 + 1] = FIREFLY[1];
    fireflyColors[i * 4 + 2] = FIREFLY[2];
    fireflyColors[i * 4 + 3] = FIREFLY_TWINKLE_BASE;
  }
  const fireflyGeometry = new THREE.BufferGeometry();
  const fireflyPositionAttr = new THREE.BufferAttribute(fireflyPositions, 3);
  const fireflyColorAttr = new THREE.BufferAttribute(fireflyColors, 4);
  fireflyGeometry.setAttribute("position", fireflyPositionAttr);
  fireflyGeometry.setAttribute("color", fireflyColorAttr);
  const fireflyMaterial = new THREE.PointsMaterial({
    size: FIREFLY_POINT_SIZE,
    map: sprite,
    vertexColors: true,
    transparent: true,
    sizeAttenuation: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending, // "发光"读法——见文件头注释为何不能跟事件粒子共用一个材质
  });
  const fireflyPoints = new THREE.Points(fireflyGeometry, fireflyMaterial);
  // 萤火漂移范围有限（anchor ± drift/bob），但每帧原地重写 position 不重建
  // 几何体，懒计算的 boundingSphere 不会跟着更新——沿用事件池同样的理由关闭裁剪。
  fireflyPoints.frustumCulled = false;
  scene.add(fireflyPoints);

  // ---- 事件粒子池 Points：初始全部"死"，停在 y=-999 ----
  const positions = new Float32Array(EFFECT_CAPACITY * 3);
  const colors = new Float32Array(EFFECT_CAPACITY * 3);
  const baseColor = new Float32Array(EFFECT_CAPACITY * 3); // spawn 时的本色；colors[] 是每帧按 life 衰减派生出的显示色
  const velocities = new Float32Array(EFFECT_CAPACITY * 3);
  const life = new Float32Array(EFFECT_CAPACITY);
  const maxLife = new Float32Array(EFFECT_CAPACITY);
  const gravity = new Float32Array(EFFECT_CAPACITY);
  const size = new Float32Array(EFFECT_CAPACITY); // 见文件头注释：目前不驱动渲染，仅按原结构保留
  for (let i = 0; i < EFFECT_CAPACITY; i++) {
    positions[i * 3 + 1] = DEAD_Y;
    life[i] = 0;
  }

  const effectGeometry = new THREE.BufferGeometry();
  const effectPositionAttr = new THREE.BufferAttribute(positions, 3);
  const effectColorAttr = new THREE.BufferAttribute(colors, 3);
  effectGeometry.setAttribute("position", effectPositionAttr);
  effectGeometry.setAttribute("color", effectColorAttr);
  const effectMaterial = new THREE.PointsMaterial({
    size: POINT_SIZE,
    map: sprite, // 同一张贴图，普通混合——柔光形状但不加色发光，衰减到近黑仍读作"墨渐渐融入纸面"
    vertexColors: true,
    transparent: true,
    sizeAttenuation: true,
    depthWrite: false,
  });
  const effectPoints = new THREE.Points(effectGeometry, effectMaterial);
  // 事件粒子会出现在 480x480 世界（W2 扩大后）的任意位置，且每帧原地重写 position 而不重建
  // 几何体；按初始状态（一堆停在 y=-999 的死粒子）算出的包围球会错误裁掉后续
  // 在别处出现的真实 burst，因此关掉裁剪。
  effectPoints.frustumCulled = false;
  scene.add(effectPoints);

  // ---- 击杀冲击环池（Part 1，postfix-9）：4 个常驻 Mesh，共享一份几何体，各自独立
  // material（opacity 逐个动画，不能共享）。初始全部 visible=false，同事件粒子池
  // 一样"常驻创建、环形游标复用"，不逐次 new/dispose。 ----
  const killRingGeometry = new THREE.RingGeometry(KILL_RING_BASE_RADIUS - KILL_RING_THICKNESS, KILL_RING_BASE_RADIUS, 32);
  killRingGeometry.rotateX(-Math.PI / 2);
  const killRingSlots: { mesh: THREE.Mesh; life: number }[] = [];
  for (let i = 0; i < KILL_RING_POOL; i++) {
    const material = new THREE.MeshBasicMaterial({
      color: PALETTE.cinnabar,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(killRingGeometry, material);
    mesh.visible = false;
    scene.add(mesh);
    killRingSlots.push({ mesh, life: 0 });
  }
  let nextKillRingSlot = 0;

  function spawnKillRing(pos: { x: number; y: number; z: number }): void {
    const slot = killRingSlots[nextKillRingSlot]!;
    nextKillRingSlot = (nextKillRingSlot + 1) % KILL_RING_POOL;
    slot.life = KILL_RING_LIFE;
    slot.mesh.position.set(pos.x, pos.y + KILL_RING_Y_OFFSET, pos.z);
    slot.mesh.scale.setScalar(KILL_RING_START_SCALE);
    (slot.mesh.material as THREE.MeshBasicMaterial).opacity = KILL_RING_START_OPACITY;
    slot.mesh.visible = true;
  }

  function updateKillRings(frameDt: number): void {
    for (const slot of killRingSlots) {
      if (slot.life <= 0) continue;
      slot.life -= frameDt;
      if (slot.life <= 0) {
        slot.life = 0;
        slot.mesh.visible = false;
        continue;
      }
      const t = 1 - slot.life / KILL_RING_LIFE; // 0→1，扩散进度
      slot.mesh.scale.setScalar(KILL_RING_START_SCALE + (KILL_RING_END_SCALE - KILL_RING_START_SCALE) * t);
      (slot.mesh.material as THREE.MeshBasicMaterial).opacity = KILL_RING_START_OPACITY * (1 - t);
    }
  }

  let nextEffectSlot = 0; // 环形分配游标，范围 [0, EFFECT_CAPACITY)

  function allocSlot(): number {
    const idx = nextEffectSlot;
    nextEffectSlot++;
    if (nextEffectSlot >= EFFECT_CAPACITY) nextEffectSlot = 0;
    return idx;
  }

  /** 分配一个槽位并写满它的全部字段——spawn 永远整体覆写，不依赖上一位占用者留下的任何旧值。 */
  function spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    r: number,
    g: number,
    b: number,
    lifeSec: number,
    particleSize: number,
    grav: number,
  ): void {
    const i = allocSlot();
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    velocities[i * 3] = vx;
    velocities[i * 3 + 1] = vy;
    velocities[i * 3 + 2] = vz;
    baseColor[i * 3] = r;
    baseColor[i * 3 + 1] = g;
    baseColor[i * 3 + 2] = b;
    life[i] = lifeSec;
    maxLife[i] = lifeSec;
    size[i] = particleSize;
    gravity[i] = grav;
  }

  /**
   * `isKill`（Part 1，postfix-9；code review 2026-08-09 收紧判据）：`killIds.has(e.id)`
   * ——main.ts 已经把"玩家造成的致命一击"（id!==playerId 且落在玩家攻击距离内，见
   * main.ts PLAYER_HIT_PROXIMITY 头部注释）算好传进来，这里只管按结果分支，不重新
   * 判定。让"更满足的大爆发+冲击环"只出现在玩家真正打出的致命一击上——既不会在
   * 玩家自己死亡时放大（那个场景走下面 `lethal` 分支的原始 36/2 数值），也不会被
   * 潭狩猎杀苓鼠这类玩家不在场的背景死亡误触发。
   */
  function spawnHit(pos: { x: number; y: number; z: number }, lethal: boolean, isKill: boolean): void {
    const inkCount = lethal ? (isKill ? HIT_KILL_INK_COUNT : HIT_LETHAL_INK_COUNT) : HIT_COUNT;
    for (let i = 0; i < inkCount; i++) {
      const v = coneVelocity(HIT_SPEED_MIN, HIT_SPEED_MAX, HIT_CONE_HALF_ANGLE);
      spawn(pos.x, pos.y, pos.z, v.vx, v.vy, v.vz, INK[0], INK[1], INK[2], HIT_LIFE, HIT_SIZE, HIT_GRAVITY);
    }
    if (lethal) {
      const cinnabarCount = isKill ? HIT_KILL_CINNABAR_COUNT : HIT_LETHAL_CINNABAR_COUNT;
      for (let i = 0; i < cinnabarCount; i++) {
        const v = coneVelocity(HIT_SPEED_MIN, HIT_SPEED_MAX, HIT_CONE_HALF_ANGLE);
        spawn(
          pos.x, pos.y, pos.z, v.vx, v.vy, v.vz,
          CINNABAR[0], CINNABAR[1], CINNABAR[2],
          HIT_LIFE, HIT_LETHAL_CINNABAR_SIZE, HIT_GRAVITY,
        );
      }
    }
    if (isKill) spawnKillRing(pos);
  }

  function spawnSplash(pos: { x: number; z: number }, waterLevel: number): void {
    for (let i = 0; i < SPLASH_COUNT; i++) {
      const v = coneVelocity(SPLASH_SPEED_MIN, SPLASH_SPEED_MAX, SPLASH_CONE_HALF_ANGLE);
      // y 直接吸附到 waterLevel（brief 要求），不用事件里的 pos.y——splash 触发于
      // walk<->swim 的那一 tick，creature.pos.y 此时读到的是移动后已经同步好的
      // 贴地/贴水高度，两者理论上很接近，但吸附水位是更稳的写法，不依赖时序假设。
      spawn(pos.x, waterLevel, pos.z, v.vx, v.vy, v.vz, WATER[0], WATER[1], WATER[2], SPLASH_LIFE, SPLASH_SIZE, SPLASH_GRAVITY);
    }
  }

  function spawnDust(pos: { x: number; y: number; z: number }): void {
    for (let i = 0; i < DIG_COUNT; i++) {
      const v = coneVelocity(DIG_SPEED_MIN, DIG_SPEED_MAX, DIG_CONE_HALF_ANGLE);
      spawn(pos.x, pos.y, pos.z, v.vx, v.vy, v.vz, DUST[0], DUST[1], DUST[2], DIG_LIFE, DIG_SIZE, DIG_GRAVITY);
    }
  }

  function spawnDrink(pos: { x: number; y: number; z: number }): void {
    for (let i = 0; i < DRINK_COUNT; i++) {
      const speed = DRINK_SPEED_MIN + Math.random() * (DRINK_SPEED_MAX - DRINK_SPEED_MIN);
      const angle = Math.random() * Math.PI * 2;
      const vx = Math.cos(angle) * speed;
      const vz = Math.sin(angle) * speed;
      spawn(pos.x, pos.y, pos.z, vx, 0, vz, WATER[0], WATER[1], WATER[2], DRINK_LIFE, DRINK_SIZE, 0);
    }
  }

  function spawnCarcassGone(pos: { x: number; y: number; z: number }): void {
    for (let i = 0; i < CARCASS_COUNT; i++) {
      const vy = CARCASS_RISE_SPEED_MIN + Math.random() * (CARCASS_RISE_SPEED_MAX - CARCASS_RISE_SPEED_MIN);
      const vx = (Math.random() * 2 - 1) * CARCASS_JITTER;
      const vz = (Math.random() * 2 - 1) * CARCASS_JITTER;
      spawn(pos.x, pos.y, pos.z, vx, vy, vz, CARCASS[0], CARCASS[1], CARCASS[2], CARCASS_LIFE, CARCASS_SIZE, CARCASS_GRAVITY);
    }
  }

  function spawnBurrowRing(pos: { x: number; y: number; z: number }): void {
    for (let i = 0; i < BURROW_RING_COUNT; i++) {
      // 固定均分角度（不随机）——"尘土环"要读出环的形状，不是一团随机扬尘。
      const angle = (i / BURROW_RING_COUNT) * Math.PI * 2;
      const speed = BURROW_RING_SPEED_MIN + Math.random() * (BURROW_RING_SPEED_MAX - BURROW_RING_SPEED_MIN);
      const vy = BURROW_RING_UP_MIN + Math.random() * (BURROW_RING_UP_MAX - BURROW_RING_UP_MIN);
      const vx = Math.cos(angle) * speed;
      const vz = Math.sin(angle) * speed;
      spawn(pos.x, pos.y, pos.z, vx, vy, vz, DUST[0], DUST[1], DUST[2], BURROW_RING_LIFE, BURROW_RING_SIZE, BURROW_RING_GRAVITY);
    }
  }

  function handle(events: SimEvent[], eventTerrain: { waterLevel: number }, killIds: Set<number>): void {
    for (const e of events) {
      switch (e.kind) {
        case "hit": {
          const isKill = killIds.has(e.id);
          spawnHit(e.pos, e.lethal, isKill);
          break;
        }
        case "splash":
          spawnSplash(e.pos, eventTerrain.waterLevel);
          break;
        case "digTick":
          spawnDust(e.pos);
          break;
        case "drink":
          spawnDrink(e.pos);
          break;
        case "carcassGone":
          spawnCarcassGone(e.pos);
          break;
        case "burrowToggle":
          spawnBurrowRing(e.pos);
          break;
        case "death":
          // 无独立视觉：simEvents.ts 的 death 分支里，非玩家死亡永远和一条 lethal
          // hit 成对出现在同一个 events[] 里（见其"一并补一条 lethal hit"注释），
          // 上面 hit 分支的 36 墨+2 朱砂已经覆盖了"死亡"这个视觉节拍；玩家死亡
          // （playerDead 边沿）目前也不额外加粒子——HUD 的死亡遮罩负责那一拍。
          break;
        case "vanish":
          // 无独立视觉（M1 B6 范围只加音效——见 audio.ts 的 playBurrowVanish）：穴獾
          // 遁地本身已经是"瞬间消失"，creatureView.ts 的可见性判定当帧就把它的 mesh
          // 隐藏掉了，不需要再叠一层粒子来强调这次消失。
          break;
        default: {
          const _exhaustive: never = e;
          void _exhaustive;
        }
      }
    }
  }

  function update(frameDt: number, tSec: number, timeOfDay: number): void {
    // 萤火：围绕各自 anchor 正弦漂移 + 逐顶点 alpha twinkle（永远存活，颜色
    // RGB 恒定为 PALETTE.lampWarm，只有第 4 分量——透明度——按 sin 明灭）。
    const gain = fireflyGainFor(timeOfDay);
    for (let i = 0; i < FIREFLY_COUNT; i++) {
      const phase = fireflyPhase[i]!;
      fireflyPositions[i * 3] = fireflyAnchorX[i]! + Math.sin(tSec * FIREFLY_DRIFT_FREQ_X + phase) * FIREFLY_DRIFT_RADIUS;
      fireflyPositions[i * 3 + 1] = fireflyAnchorY[i]! + Math.sin(tSec * FIREFLY_BOB_FREQ + phase * 1.3) * FIREFLY_BOB_AMP;
      fireflyPositions[i * 3 + 2] = fireflyAnchorZ[i]! + Math.cos(tSec * FIREFLY_DRIFT_FREQ_Z + phase) * FIREFLY_DRIFT_RADIUS;
      const twinkle = (FIREFLY_TWINKLE_BASE + FIREFLY_TWINKLE_AMP * Math.sin(tSec * FIREFLY_TWINKLE_FREQ + phase * 2.1)) * gain;
      fireflyColors[i * 4 + 3] = twinkle;
    }
    fireflyPositionAttr.needsUpdate = true;
    fireflyColorAttr.needsUpdate = true;

    // 事件粒子池：受重力积分位置、按剩余寿命比例把颜色向黑衰减（墨渐渐融入纸面），
    // 寿命耗尽即刻停到 y=-999 并整帧跳过（不再重复搬运/改色）。
    for (let i = 0; i < EFFECT_CAPACITY; i++) {
      if (life[i]! <= 0) continue;
      life[i]! -= frameDt;
      if (life[i]! <= 0) {
        life[i] = 0;
        positions[i * 3 + 1] = DEAD_Y;
        continue;
      }
      velocities[i * 3 + 1]! += gravity[i]! * frameDt;
      positions[i * 3]! += velocities[i * 3]! * frameDt;
      positions[i * 3 + 1]! += velocities[i * 3 + 1]! * frameDt;
      positions[i * 3 + 2]! += velocities[i * 3 + 2]! * frameDt;
      const fade = life[i]! / maxLife[i]!;
      colors[i * 3] = baseColor[i * 3]! * fade;
      colors[i * 3 + 1] = baseColor[i * 3 + 1]! * fade;
      colors[i * 3 + 2] = baseColor[i * 3 + 2]! * fade;
    }
    effectPositionAttr.needsUpdate = true;
    effectColorAttr.needsUpdate = true;

    updateKillRings(frameDt);
  }

  return { handle, update };
}
