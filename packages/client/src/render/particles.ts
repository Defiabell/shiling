import * as THREE from "three";
import { PALETTE } from "./palette.js";
import type { SimEvent } from "./simEvents.js";

/**
 * 粒子系统（Task 6）：单个 THREE.Points，容量 512，一次性分配、永不重建几何体。
 * 512 个槽位切成两段，各自的生命周期管理完全独立：
 *
 * - `[0, FIREFLY_COUNT)`（40 个）：萤火氛围槽位，创建时初始化一次，此后永久存活，
 *   由 `update()` 里单独的一段循环按正弦漂移驱动——effect 池的 spawn/kill 逻辑
 *   完全不触碰这段索引。
 * - `[FIREFLY_COUNT, POOL_CAPACITY)`（472 个）：事件粒子池（墨溅/水花/尘土/……），
 *   环形游标分配（round-robin over-write，不维护 free-list）：472 远大于任何单次
 *   事件的粒子数（最大的一次性 burst 是 lethal hit 的 38），正常游玩节奏下前一批
 *   粒子早就过完生命周期（life<=0）才会被游标绕回来复用，只有极端连续暴击/连续
 *   挖洞才会出现"新粒子提前顶掉一个还没死透的旧粒子"，视觉上不可感知，用这个
 *   简单方案换掉 free-list 的复杂度是有意为之的取舍。
 *
 * 只用一个 THREE.Points（而不是萤火单独一套）：两段槽位共享同一份
 * position/color BufferAttribute、同一个 PointsMaterial、同一次 draw call；
 * 萤火和事件粒子在视觉上都是"暗夜里的墨点/光点"，没有必要为了逻辑上的独立性
 * 拆成两个 scene 节点、两次 GPU 提交——这正是 brief 里"单个 THREE.Points"的字面
 * 要求，也更省心（不用另外管理第二个 geometry 的创建/清理时机）。
 *
 * 死粒子按 brief 要求整体挪到 y=-999（而不是切 visible，Points 也没有逐点
 * visible 这回事）；x/z 不需要一起清空，反正 y=-999 已经在任何摄像机可见范围之外。
 *
 * `size` 字段（Float32Array，逐粒子记录 spawn 时的"名义大小"）按 brief 的池
 * 结构要求保留，但**目前不会真的改变渲染出的点的大小**：THREE.PointsMaterial
 * 的 `size` 是材质级 uniform（所有点公用同一个值），stock 材质不支持逐顶点
 * size attribute（那需要手写 ShaderMaterial，brief 明确点名的是 PointsMaterial
 * 本身）。这是一个记录在案的已知简化，而不是遗漏——各效果之间的视觉分量差异
 * 现在完全靠"粒子数量"（12/36/18/8/6/10/14）和颜色来表达，这也是 stock
 * PointsMaterial + vertexColors 组合实际能表达的两个维度。
 */
const POOL_CAPACITY = 512;
const FIREFLY_COUNT = 40;
const EFFECT_START = FIREFLY_COUNT;
const DEAD_Y = -999;
const POINT_SIZE = 0.45;

// ---- hit（墨溅）----
const HIT_COUNT = 12;
const HIT_LETHAL_INK_COUNT = 36;
const HIT_LETHAL_CINNABAR_COUNT = 2;
const HIT_LIFE = 0.5;
const HIT_GRAVITY = -9;
const HIT_SPEED_MIN = 2.5;
const HIT_SPEED_MAX = 5;
const HIT_CONE_HALF_ANGLE = (50 * Math.PI) / 180; // 锥形上抛，够宽读作"溅"
const HIT_SIZE = 0.3;
const HIT_LETHAL_CINNABAR_SIZE = 0.4;

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
// createParticles 的签名只有 scene，handle() 才拿得到 terrain（且只给 waterLevel），
// 萤火的游荡范围因此不是采样 terrain.heightAt 算出来的，而是按已知的世界尺度
// （QINGQIU_GRAYBOX.size=240，半宽 120）留出安全边距后写死的一个近似值——
// 与 main.ts 里 nearWater() 复刻 needs.ts 判定逻辑是同一种"渲染层没有权威数据源
// 就退而求其次自己估一个"的处理方式，不是疏漏。
const FIREFLY_SPREAD = 90;
const FIREFLY_MIN_Y = 1;
const FIREFLY_MAX_Y = 4;
const FIREFLY_DRIFT_RADIUS = 3;
const FIREFLY_DRIFT_FREQ_X = 0.25;
const FIREFLY_DRIFT_FREQ_Z = 0.18;
const FIREFLY_BOB_AMP = 0.6;
const FIREFLY_BOB_FREQ = 0.35;
const FIREFLY_TWINKLE_BASE = 0.75;
const FIREFLY_TWINKLE_AMP = 0.25;
const FIREFLY_TWINKLE_FREQ = 1.8;

/** hex → [r,g,b]，只在 createParticles 里对每个用到的 PALETTE 色调用一次（非逐帧/逐粒子）。 */
function toRgb01(hex: number): readonly [number, number, number] {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b] as const;
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

export function createParticles(scene: THREE.Scene): {
  handle(events: SimEvent[], terrain: { waterLevel: number }): void;
  update(frameDt: number, tSec: number): void;
} {
  // ---- 池的底层存储：position/color 是真正喂给 GPU 的 BufferAttribute；
  // velocity/life/maxLife/gravity/size/baseColor 是纯 CPU 侧模拟状态，
  // 从头到尾只分配这一份，update()/handle() 里只做原地读写。 ----
  const positions = new Float32Array(POOL_CAPACITY * 3);
  const colors = new Float32Array(POOL_CAPACITY * 3);
  const baseColor = new Float32Array(POOL_CAPACITY * 3); // spawn 时的本色；colors[] 是每帧按 life 衰减派生出的显示色
  const velocities = new Float32Array(POOL_CAPACITY * 3);
  const life = new Float32Array(POOL_CAPACITY);
  const maxLife = new Float32Array(POOL_CAPACITY);
  const gravity = new Float32Array(POOL_CAPACITY);
  const size = new Float32Array(POOL_CAPACITY); // 见文件头注释：目前不驱动渲染，仅按 brief 结构保留

  const geometry = new THREE.BufferGeometry();
  const positionAttr = new THREE.BufferAttribute(positions, 3);
  const colorAttr = new THREE.BufferAttribute(colors, 3);
  geometry.setAttribute("position", positionAttr);
  geometry.setAttribute("color", colorAttr);

  const material = new THREE.PointsMaterial({
    size: POINT_SIZE,
    vertexColors: true,
    transparent: true,
    sizeAttenuation: true,
    depthWrite: false,
  });

  const points = new THREE.Points(geometry, material);
  // 事件粒子会出现在 240x240 世界的任意位置，且每帧原地重写 position 而不重建
  // 几何体；three.js 的视锥裁剪只在懒计算时对 geometry.boundingSphere 求值一次
  // （不会随 needsUpdate 自动重新计算），按初始状态（萤火簇 + 一堆停在 y=-999
   // 的死粒子）算出的包围球会错误裁掉后续在别处出现的真实 burst，因此关掉裁剪。
  points.frustumCulled = false;
  scene.add(points);

  const INK = toRgb01(PALETTE.outlineInk);
  const CINNABAR = toRgb01(PALETTE.cinnabar);
  const WATER = toRgb01(PALETTE.waterSurface);
  const DUST = toRgb01(PALETTE.terrainMid);
  const CARCASS = toRgb01(PALETTE.carcass);
  const FIREFLY = toRgb01(PALETTE.lampWarm);

  // ---- 萤火槽位：一次性初始化，永久存活，effect 池的 spawn/kill 逻辑不会碰这段索引 ----
  const fireflyAnchorX = new Float32Array(FIREFLY_COUNT);
  const fireflyAnchorY = new Float32Array(FIREFLY_COUNT);
  const fireflyAnchorZ = new Float32Array(FIREFLY_COUNT);
  const fireflyPhase = new Float32Array(FIREFLY_COUNT);
  for (let i = 0; i < FIREFLY_COUNT; i++) {
    fireflyAnchorX[i] = (Math.random() * 2 - 1) * FIREFLY_SPREAD;
    fireflyAnchorZ[i] = (Math.random() * 2 - 1) * FIREFLY_SPREAD;
    fireflyAnchorY[i] = FIREFLY_MIN_Y + Math.random() * (FIREFLY_MAX_Y - FIREFLY_MIN_Y);
    fireflyPhase[i] = Math.random() * Math.PI * 2;
    positions[i * 3] = fireflyAnchorX[i]!;
    positions[i * 3 + 1] = fireflyAnchorY[i]!;
    positions[i * 3 + 2] = fireflyAnchorZ[i]!;
    colors[i * 3] = FIREFLY[0];
    colors[i * 3 + 1] = FIREFLY[1];
    colors[i * 3 + 2] = FIREFLY[2];
  }

  // ---- 事件粒子池：初始全部"死"，停在 y=-999 ----
  for (let i = EFFECT_START; i < POOL_CAPACITY; i++) {
    positions[i * 3 + 1] = DEAD_Y;
    life[i] = 0;
  }
  positionAttr.needsUpdate = true;
  colorAttr.needsUpdate = true;

  let nextEffectSlot = EFFECT_START; // 环形分配游标，范围 [EFFECT_START, POOL_CAPACITY)

  function allocSlot(): number {
    const idx = nextEffectSlot;
    nextEffectSlot++;
    if (nextEffectSlot >= POOL_CAPACITY) nextEffectSlot = EFFECT_START;
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

  function spawnHit(pos: { x: number; y: number; z: number }, lethal: boolean): void {
    const inkCount = lethal ? HIT_LETHAL_INK_COUNT : HIT_COUNT;
    for (let i = 0; i < inkCount; i++) {
      const v = coneVelocity(HIT_SPEED_MIN, HIT_SPEED_MAX, HIT_CONE_HALF_ANGLE);
      spawn(pos.x, pos.y, pos.z, v.vx, v.vy, v.vz, INK[0], INK[1], INK[2], HIT_LIFE, HIT_SIZE, HIT_GRAVITY);
    }
    if (lethal) {
      for (let i = 0; i < HIT_LETHAL_CINNABAR_COUNT; i++) {
        const v = coneVelocity(HIT_SPEED_MIN, HIT_SPEED_MAX, HIT_CONE_HALF_ANGLE);
        spawn(
          pos.x, pos.y, pos.z, v.vx, v.vy, v.vz,
          CINNABAR[0], CINNABAR[1], CINNABAR[2],
          HIT_LIFE, HIT_LETHAL_CINNABAR_SIZE, HIT_GRAVITY,
        );
      }
    }
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

  function handle(events: SimEvent[], terrain: { waterLevel: number }): void {
    for (const e of events) {
      switch (e.kind) {
        case "hit":
          spawnHit(e.pos, e.lethal);
          break;
        case "splash":
          spawnSplash(e.pos, terrain.waterLevel);
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
        default: {
          const _exhaustive: never = e;
          void _exhaustive;
        }
      }
    }
  }

  function update(frameDt: number, tSec: number): void {
    // 萤火：围绕各自 anchor 正弦漂移 + 轻微亮度明灭（twinkle），永远存活。
    for (let i = 0; i < FIREFLY_COUNT; i++) {
      const phase = fireflyPhase[i]!;
      positions[i * 3] = fireflyAnchorX[i]! + Math.sin(tSec * FIREFLY_DRIFT_FREQ_X + phase) * FIREFLY_DRIFT_RADIUS;
      positions[i * 3 + 1] = fireflyAnchorY[i]! + Math.sin(tSec * FIREFLY_BOB_FREQ + phase * 1.3) * FIREFLY_BOB_AMP;
      positions[i * 3 + 2] = fireflyAnchorZ[i]! + Math.cos(tSec * FIREFLY_DRIFT_FREQ_Z + phase) * FIREFLY_DRIFT_RADIUS;
      const twinkle = FIREFLY_TWINKLE_BASE + FIREFLY_TWINKLE_AMP * Math.sin(tSec * FIREFLY_TWINKLE_FREQ + phase * 2.1);
      colors[i * 3] = FIREFLY[0] * twinkle;
      colors[i * 3 + 1] = FIREFLY[1] * twinkle;
      colors[i * 3 + 2] = FIREFLY[2] * twinkle;
    }

    // 事件粒子池：受重力积分位置、按剩余寿命比例把颜色向黑衰减（墨渐渐融入纸面），
    // 寿命耗尽即刻停到 y=-999 并整帧跳过（不再重复搬运/改色）。
    for (let i = EFFECT_START; i < POOL_CAPACITY; i++) {
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

    positionAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
  }

  return { handle, update };
}
