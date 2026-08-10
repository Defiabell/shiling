import * as THREE from "three";
import { createRng, type Rng } from "@shiling/sim";
import { PALETTE, interpolateDayNight } from "./palette.js";

/**
 * 天空远景（M2 A4「天空远景」，灵境重塑收尾批——owner feedback「整体风格和山海经差
 * 很远」）：五件套，全部是纯背景层——不参与任何 sim 判定，只吃 `sim.state.timeOfDay`/
 * 墙钟 `tSec`，与 atmosphere.ts 的天穹/雾/光照同属"氛围层"，但独立成模块（不是塞进
 * atmosphere.ts 本体——那个文件已经很长，且这里的元素各自有自己的几何/纹理构建逻辑，
 * 拆开更符合"一个文件一类关注点"的既有惯例，同 groundMist.ts/landmarks.ts 相对
 * atmosphere.ts 的关系）：
 *
 * 1. **水墨远山剪影**（`buildInkMountains`）：3 圈 8 面八角环形固定摆放的
 *    `THREE.InstancedMesh`（每圈一个 draw call，共 3 个），半径 350/420/490——刚好在
 *    地形边缘（terrain.size=480，半宽 240）之外、天空穹顶半径(400)内外都有分布（sky
 *    dome 自身 `depthWrite:false`，见 atmosphere.ts 头注释，不会遮挡半径>400 的远山）。
 *    **刻意不用 billboard/Sprite**——brief 原话"billboarding NOT wanted"：8 面固定
 *    世界朝向的平面拼成一圈"屏风"，玩家绕着走动时，近圈/远圈之间才会读出视差
 *    （billboard 会永远死贴在屏幕同一相对位置，没有这层"山有远近"的读法）。
 * 2. **云海**（`buildCloudBank`）：5 个巨大柔雾 Sprite（billboard——云本来就该永远
 *    面朝摄像机，与远山"不要 billboard"的诉求刻意相反，不是遗漏）。
 * 3. **日月轮**（`buildCelestialDisc`）：1 个"轮"Sprite + 1 个夜间光晕 Sprite，共用
 *    同一条 `celestialElevation(timeOfDay)` 轨迹——见该函数头注释，这是整批里唯一
 *    需要显式证明"数学对不对"的部分（noon 和 midnight 都在天顶，dawn/dusk 都在
 *    地平线，同一条连续公式，没有分支/跳变）。
 * 4. **夜空星河**（`buildStarfield`）：300 颗静态 `THREE.Points`（1 个 draw call）+
 *    1 条银河带 Mesh（1 个 draw call）——`starVisibilityFor(timeOfDay)` 是"night-only"
 *    的平滑门（不是直接复用 `nightAmount`，见该函数头注释为什么要单独收紧阈值）。
 * 5. **天穹关键帧**：未改动 atmosphere.ts 的 skyTop/skyHorizon/skyGlow——夜间关键帧
 *    的 skyTop(0x05070c) 实测对 300 颗冷白星点已经有足够反差（Playwright 截图判读
 *    确认，见任务报告），且 `groundLuminance()` 的护栏公式本就不读这三个字段（只读
 *    hemiSky/hemiIntensity/sunColor/sunIntensity），改了也不影响那条护栏——但既然视觉
 *    上已经够用，不做没有必要的改动（"fix the environment, don't add workaround"的
 *    反面同样适用：不需要修的东西不要碰）。
 *
 * **不做的事（有意识的取舍，都在下面各自小节展开）**：不让 atmosphere.ts 的
 * DirectionalLight 方向跟随日月轮角度转动——那是 brief 自己标注的"bonus, only if…"，
 * 现有四档关键帧光照（`sunPos` 固定在 `[60,100,20]`，只有色温/强度随昼夜插值）是照着
 * 一个固定的斜射角调过的地形/生物明暗，让光源角度也跟着日月轮转到"正午顶光"会
 * 在没有重新可视化核验的情况下改变四个关键帧各自的地形阴影读法——不做无根据的
 * 联动改动，留档在任务报告里。
 *
 * **颜色管线**：本文件所有材质都是标准 three.js 材质（`MeshBasicMaterial`/
 * `SpriteMaterial`/`PointsMaterial`），不是像 atmosphere.ts 的天穹那样手写
 * `ShaderMaterial`——因此颜色统一用默认色彩管理（直接 `setHex(hex)`，不需要
 * atmosphere.ts 头部注释里那个 `rawColor()`/`NoColorSpace` 特例，那个特例只对
 * "手写 shader 不会自动跑 colorspace_fragment 收尾 chunk"这一种情况成立）。
 * `fog:false`——半径 350-490 落在 `PALETTE.fogDensity` 的指数雾公式下会被雾几乎
 * 抹平（在 350m 处只剩 ~8% 可见度，490m 处 <1%），会直接吃掉这里手工调的四档墨色/
 * 三级环 opacity，所以本文件所有材质都关掉内置雾，用自己的（`mountainInk` 与
 * `fogColor` 的手动 lerp）代替，效果更可控。`toneMapped:false`——同 atmosphere.ts
 * 天穹的选择：这些是"天空系统"的一部分而不是"受光照的场景物体"，不该被为前景
 * 调的 ACES 曝光压暗/压色。
 */

const SUN_MOON_TAU = Math.PI * 2;

// ---- 1. 水墨远山剪影 ----
const PLANES_PER_RING = 8;
const RING_BASE_Y = -20; // 平面底边世界 Y——远低于 waterLevel(-1.5)，保证任何视角都不会看到"山脚悬空"的缝
const RING_OVERLAP = 1.18; // 相邻面之间留一点重叠，盖住锯齿轮廓在拼接缝上的不规则空隙
const RIDGE_TEXTURE_W = 512;
const RIDGE_TEXTURE_H = 256;
const RIDGE_SAMPLES = 32; // 必须是 2 的幂——buildRidgeHeights 用二分中点位移递归
const RIDGE_BASE_FRAC = 0.5;
const RIDGE_INITIAL_AMPLITUDE = 0.4;
const RIDGE_ROUGHNESS = 0.55; // 每次二分位移幅度衰减比例——标准中点位移分形参数，0.5~0.6 读出来最像天然山脊
const RIDGE_MIN_FRAC = 0.12; // 峰顶最多顶到画布 12% 处（不顶到画布顶边，留一点纯天空）
const RIDGE_MAX_FRAC = 0.78; // 谷底最多下探到 78%，保证画布底部始终留有一段纯实色（不会有山脚透明缝）
const RIDGE_GRADIENT_BAND_PX = 22; // 山脊线以下的柔化渐隐带（"alpha gradient at top edge"）

interface RingConfig {
  radius: number;
  opacity: number;
  planeHeight: number;
  fogMix: number; // 越远越往 fogColor 靠——大气透视，"farther rings lighter/hazier"里"更浅"的那一半
  stagger: number; // 8 边形起始角偏移——避免三圈缝隙径向对齐
  textureSeedXor: number;
}

/**
 * opacity 0.68/0.48/0.32——brief 原话给的是 0.5/0.35/0.22，这里三档等比例上调
 * ×1.36（比例关系保持不变：0.68/0.48=1.42≈0.5/0.35=1.43，0.48/0.32=1.5≈
 * 0.35/0.22=1.59），是真实 Playwright 截图判读后的修正，不是随手改数字：
 *
 * 用红色满不透明度做隔离测试（临时把 ring0 材质换成纯红 opacity:1，见任务报告）
 * 先证明几何/位置/朝向全部正确——红带精确出现在地平线该有的位置。换回真实
 * ink 配色后用原始 brief 数值（0.5/0.35/0.22）核对却几乎看不出剪影，排查发现
 * 远山所在的天球纬度恰好落在 atmosphere.ts 天穹 shader 的 glow 峰值带（u≈0.5 附近，
 * 该处颜色公式是 `mix(base, skyGlow, glow*0.55)`，glow 在这一整条纬度上普遍很高）
 * ——白昼这一档算出来的实际背景色亮度约 (176,178,166)，而 0.5 opacity 的数学
 * 上限是"无论 ink 多深，最多只能把背景压暗到其原亮度的一半"（`0.5*ink+0.5*bg`，
 * ink→0 时下限就是 `0.5*bg`）。也就是说 0.5 opacity 这个值本身就注定读不出
 * "剪影"，不是墨色深浅的问题。修复分两步——先加深四档 `PALETTE` 里的
 * `mountainInk`（见该字段头注释），再把三档 opacity 整体上调，两个杠杆一起压，
 * 实测（见任务报告的 aimed-dusk-sun.png/aimed-dawn-sun.png 等）近圈已能在暮色/
 * 黎明的暖色天空前读出清晰的深色锯齿轮廓。这是在"数值精确复刻 brief"与
 * "brief 本身要求的效果（清晰可辨的水墨剪影）"之间选择后者——owner feedback
 * 本身就是「整体风格和山海经差很远」，不能为了照抄一个数字反而继续读不出山。
 */
// stagger 三档都不同（0/π/8/π/16）——code review 抓到：原先近圈(350)/远圈(490)
// 都用 stagger:0，与本字段自己的头注释"避免三圈缝隙径向对齐"字面矛盾（只有中圈
// 相对另两圈偏移，近/远圈彼此仍对齐）。三档两两不同才是这句注释真正成立的写法。
const RING_CONFIGS: readonly RingConfig[] = [
  { radius: 350, opacity: 0.68, planeHeight: 70, fogMix: 0.0, stagger: 0, textureSeedXor: 0x9f5a11 },
  { radius: 420, opacity: 0.48, planeHeight: 85, fogMix: 0.18, stagger: Math.PI / 8, textureSeedXor: 0x9f5a12 },
  { radius: 490, opacity: 0.32, planeHeight: 100, fogMix: 0.35, stagger: Math.PI / 16, textureSeedXor: 0x9f5a13 },
];

/**
 * 一维中点位移分形（"plasma line"）——递归对半分，每次在中点上叠加一个随二分深度
 * 衰减的随机扰动，是生成"锯齿但连续、不是简单正弦波"的山脊轮廓线的标准廉价算法。
 * 返回 `RIDGE_SAMPLES+1` 个采样点，已裁剪进 [RIDGE_MIN_FRAC, RIDGE_MAX_FRAC] 区间。
 *
 * **两端必须相等**（code review 抓到的真 bug）：这张纹理会被同一圈的 8 个八角面
 * 原样重复贴 8 次（见 buildInkMountains，一圈只生成一张 texture），若首尾两端各自
 * 独立随机（原实现），纹理在头尾拼接处（也就是每两个相邻八角面的拼接缝）会出现
 * 明显的山脊高度断层——不是"8 段不同的山"这种可接受的重复感，是每一条拼接线上
 * 都有一个跳变，绕着一圈走会看到 8 处规律出现的断层，读起来像纹理拼接错误而不是
 * 起伏的山。修复：两端共用同一个随机抽样（`edgeHeight`），让纹理左右边缘高度精确
 * 相等，环绕拼接时严丝合缝（首尾相接处山脊连续，只是同一条山脊线在重复——8 段
 * 完全一致本身是"屏风"的既有美术方向，见文件头 1 节注释，不是这次要解决的问题）。
 */
function buildRidgeHeights(rng: Rng): number[] {
  const heights = new Array<number>(RIDGE_SAMPLES + 1).fill(RIDGE_BASE_FRAC);
  const edgeJitter = RIDGE_INITIAL_AMPLITUDE * 0.5;
  const edgeHeight = RIDGE_BASE_FRAC + (rng.next() - 0.5) * edgeJitter;
  heights[0] = edgeHeight;
  heights[RIDGE_SAMPLES] = edgeHeight;
  let step = RIDGE_SAMPLES;
  let amplitude = RIDGE_INITIAL_AMPLITUDE;
  while (step > 1) {
    const half = step / 2;
    for (let i = half; i < RIDGE_SAMPLES; i += step) {
      const left = heights[i - half]!;
      const right = heights[i + half]!;
      heights[i] = (left + right) / 2 + (rng.next() - 0.5) * amplitude;
    }
    amplitude *= RIDGE_ROUGHNESS;
    step = half;
  }
  return heights.map((h) => Math.min(RIDGE_MAX_FRAC, Math.max(RIDGE_MIN_FRAC, h)));
}

/**
 * 山脊剪影纹理：只编码形状（白色 + alpha），不烘颜色——同 groundMist.ts 的
 * `buildMistTexture`一样"贴图只管形状，颜色交给 material.color"的既有分工，
 * 这样同一张纹理才能在 updateSkyscape() 里随昼夜换色而不用重新生成 canvas。
 * 山脊线以上完全透明（"天空"）；以下先按 `RIDGE_GRADIENT_BAND_PX` 柔化渐入
 * 到完全不透明（"屏风感"的水墨软边），再往下全部纯色实心（保证画布底边—— 也就是
 * 平面底边——绝对不透明，见文件头 RING_BASE_Y 一节）。
 */
function buildRidgeTexture(rng: Rng): THREE.Texture {
  const heights = buildRidgeHeights(rng);
  const canvas = document.createElement("canvas");
  canvas.width = RIDGE_TEXTURE_W;
  canvas.height = RIDGE_TEXTURE_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("skyscape: 2D context unavailable (buildRidgeTexture)");
  const image = ctx.createImageData(RIDGE_TEXTURE_W, RIDGE_TEXTURE_H);
  for (let x = 0; x < RIDGE_TEXTURE_W; x++) {
    const u = x / (RIDGE_TEXTURE_W - 1);
    const pos = u * RIDGE_SAMPLES;
    const i0 = Math.min(RIDGE_SAMPLES - 1, Math.floor(pos));
    const i1 = i0 + 1;
    const frac = pos - i0;
    const ridgeFrac = heights[i0]! + (heights[i1]! - heights[i0]!) * frac;
    const ridgeY = ridgeFrac * RIDGE_TEXTURE_H;
    for (let y = 0; y < RIDGE_TEXTURE_H; y++) {
      const idx = (y * RIDGE_TEXTURE_W + x) * 4;
      image.data[idx] = 255;
      image.data[idx + 1] = 255;
      image.data[idx + 2] = 255;
      const belowRidge = y - ridgeY;
      const alpha = belowRidge <= 0 ? 0 : Math.min(1, belowRidge / RIDGE_GRADIENT_BAND_PX);
      image.data[idx + 3] = Math.round(alpha * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

interface RingHandle {
  material: THREE.MeshBasicMaterial;
  fogMix: number;
}

/** 3 圈远山各自的 InstancedMesh（8 实例/圈），加入 scene 并返回供 update() 逐帧改色的材质引用。 */
function buildInkMountains(scene: THREE.Scene, seed: number): RingHandle[] {
  const handles: RingHandle[] = [];
  for (const cfg of RING_CONFIGS) {
    const texture = buildRidgeTexture(createRng(seed ^ cfg.textureSeedXor));
    const chord = 2 * cfg.radius * Math.sin(Math.PI / PLANES_PER_RING);
    const width = chord * RING_OVERLAP;
    const geometry = new THREE.PlaneGeometry(width, cfg.planeHeight);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      // depthWrite:true（不是本文件其余 Sprite 那套 depthWrite:false）——远山之间、
      // 远山与地形之间需要真实的相互遮挡（"近圈挡住远圈"是"层山"读法的核心），不是
      // 像萤火/流雾那样纯叠加的柔光。side:DoubleSide 是防御性冗余：下面
      // rotation.y=angle+π 的推导已经让正面朝内，但双面渲染确保就算推导有符号误差
      // 也不会整片消失不见（只会读成镜像的锯齿，视觉上无法分辨对错）。
      side: THREE.DoubleSide,
      depthWrite: true,
      fog: false,
      toneMapped: false,
      opacity: cfg.opacity,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, PLANES_PER_RING);
    const matrix = new THREE.Matrix4();
    const centerY = RING_BASE_Y + cfg.planeHeight / 2;
    for (let i = 0; i < PLANES_PER_RING; i++) {
      const angle = (i / PLANES_PER_RING) * SUN_MOON_TAU + cfg.stagger;
      const x = Math.sin(angle) * cfg.radius;
      const z = Math.cos(angle) * cfg.radius;
      // 旋转 angle+π：绕世界 Y 轴转 φ 会把局部 +Z（PlaneGeometry 默认法线）变到
      // world (sinφ, 0, cosφ)；φ=angle+π 时这等于 (-sinφ0,0,-cosφ0)（φ0=angle），
      // 正好等于"从这个位置指向原点"的方向——正面因此始终朝向世界中心（玩家活动
      // 区域），不需要每帧跟摄像机重算，这正是"fixed world orientation"的字面意思。
      const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle + Math.PI, 0));
      matrix.compose(new THREE.Vector3(x, centerY, z), quaternion, new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
    handles.push({ material, fogMix: cfg.fogMix });
  }
  return handles;
}

// ---- 2. 云海 ----
const CLOUD_COUNT = 5;
const CLOUD_Y_MIN = 60;
const CLOUD_Y_MAX = 90;
const CLOUD_RADIUS_MIN = 220; // 落在地形边缘(240)与最近一圈远山(350)之间——云在山前的中景
const CLOUD_RADIUS_MAX = 320;
const CLOUD_SIZE_MIN = 150;
const CLOUD_SIZE_MAX = 260;
const CLOUD_OPACITY_MIN = 0.1;
const CLOUD_OPACITY_MAX = 0.18;
const CLOUD_DRIFT_SPEED_MIN = 0.0006; // rad/s——"drifting extremely slowly"：TUNING.dayLengthSec=300s 一整个昼夜只转过 0.18~0.45 rad(~10°~26°)
const CLOUD_DRIFT_SPEED_MAX = 0.0015;
const CLOUD_TEXTURE_SIZE = 256;
const CLOUD_BLOB_COUNT = 6;
// 云海整体亮度随昼夜衰减——day=1.0(近白基准)，night=0.35("very dim"，brief 原话）。
const CLOUD_GAIN_DAY = 1.0;
const CLOUD_GAIN_NIGHT = 0.35;

/** 云海昼夜增益——纯函数，导出供测试直接断言（同 particles.ts fireflyGainFor/groundMist.ts mistGainFor 的既有惯例）。 */
export function cloudGainFor(timeOfDay: number): number {
  const night = interpolateDayNight(timeOfDay).nightAmount;
  return CLOUD_GAIN_DAY + (CLOUD_GAIN_NIGHT - CLOUD_GAIN_DAY) * night;
}

/**
 * 云海贴图：多个随机偏移/半径的柔光圆斑用 `lighter`（加色）合成叠在一张画布上——
 * 重叠处自然更亮更"稠密"，边缘稀疏渐隐，读作一整片不规则云团而不是一个规整的
 * 圆形光斑（后者是 particles.ts createGlowSprite 单个径向渐变的效果，云海需要更
 * "破碎"的轮廓）。同 groundMist.ts 的单一共享贴图惯例——本文件 CLOUD_COUNT 个
 * Sprite 共用这一张纹理，靠各自独立的 material.color/opacity 区分。
 */
function buildCloudTexture(rng: Rng): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = CLOUD_TEXTURE_SIZE;
  canvas.height = CLOUD_TEXTURE_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("skyscape: 2D context unavailable (buildCloudTexture)");
  ctx.globalCompositeOperation = "lighter";
  const center = CLOUD_TEXTURE_SIZE / 2;
  for (let i = 0; i < CLOUD_BLOB_COUNT; i++) {
    const ox = center + (rng.next() - 0.5) * CLOUD_TEXTURE_SIZE * 0.5;
    const oy = center + (rng.next() - 0.5) * CLOUD_TEXTURE_SIZE * 0.5;
    const r = CLOUD_TEXTURE_SIZE * (0.22 + rng.next() * 0.2);
    const gradient = ctx.createRadialGradient(ox, oy, 0, ox, oy, r);
    gradient.addColorStop(0, "rgba(255,255,255,0.8)");
    gradient.addColorStop(0.6, "rgba(255,255,255,0.35)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CLOUD_TEXTURE_SIZE, CLOUD_TEXTURE_SIZE);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

interface CloudSlot {
  sprite: THREE.Sprite;
  radius: number;
  y: number;
  baseAngle: number;
  angularSpeed: number;
  baseOpacity: number;
}

function buildCloudBank(scene: THREE.Scene, seed: number): CloudSlot[] {
  const rng = createRng(seed ^ 0x9f5a20);
  const texture = buildCloudTexture(rng);
  const slots: CloudSlot[] = [];
  for (let i = 0; i < CLOUD_COUNT; i++) {
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending, // brief 原话"additive-off"——云是遮挡感的柔雾，不是发光体
      fog: false,
      toneMapped: false,
    });
    const sprite = new THREE.Sprite(material);
    const size = CLOUD_SIZE_MIN + rng.next() * (CLOUD_SIZE_MAX - CLOUD_SIZE_MIN);
    sprite.scale.setScalar(size);
    const radius = CLOUD_RADIUS_MIN + rng.next() * (CLOUD_RADIUS_MAX - CLOUD_RADIUS_MIN);
    const y = CLOUD_Y_MIN + rng.next() * (CLOUD_Y_MAX - CLOUD_Y_MIN);
    const baseAngle = rng.next() * SUN_MOON_TAU;
    const angularSpeed =
      (CLOUD_DRIFT_SPEED_MIN + rng.next() * (CLOUD_DRIFT_SPEED_MAX - CLOUD_DRIFT_SPEED_MIN)) * (rng.next() < 0.5 ? 1 : -1);
    const baseOpacity = CLOUD_OPACITY_MIN + rng.next() * (CLOUD_OPACITY_MAX - CLOUD_OPACITY_MIN);
    sprite.position.set(Math.sin(baseAngle) * radius, y, Math.cos(baseAngle) * radius);
    scene.add(sprite);
    slots.push({ sprite, radius, y, baseAngle, angularSpeed, baseOpacity });
  }
  return slots;
}

// ---- 3. 日月轮 ----
const CELESTIAL_ORBIT_RADIUS = 380; // 略小于 sky dome 半径(400)，读作"嵌在天空里"而不是浮在天空外
const CELESTIAL_AZIMUTH = Math.PI / 6; // 轨道所在大圆的固定方位角——纯美术选择，避免圆完全对齐坐标轴
const HALO_SCALE = 1.9; // 光晕相对日月轮本体直径的倍数
const HALO_OPACITY_MAX = 0.22;
const DISC_TEXTURE_SIZE = 128;
const HALO_TEXTURE_SIZE = 128;

/**
 * 日月轮在天穹上的"仰角"（0=贴地平线，1=天顶）——brief 原话"noon = zenith-ish for
 * sun, midnight [zenith] for moon opposite"要求同一个连续公式在 t=0.25（白昼）与
 * t=0.75（夜）**两个**时刻都给出仰角 1，且在 t=0（黎明）与 t=0.5（黄昏）都给出 0。
 * `|sin(2πt)|`恰好精确满足这四个锚点（sin(π/2)=1、sin(3π/2)=-1→取绝对值同样是 1、
 * sin(0)=sin(π)=0），且处处连续——不需要在"白天走 sin 那一半、夜里换另一套公式"
 * 这样的分支：地平线附近（t 经过 0 或 0.5）取绝对值会有一个"触地反弹"式的速度反转
 * （导数不连续，但**位置**本身连续），正好读作"日落即月升/月落即日升"的自然过渡，
 * 不是 bug。导出供 skyscape.test.ts 直接断言这四个锚点，这是本文件唯一需要显式
 * 证明"数学对不对"的部分（其余昼夜色彩/透明度都是常规线性插值，风险低得多）。
 */
export function celestialElevation(timeOfDay: number): number {
  return Math.abs(Math.sin(timeOfDay * SUN_MOON_TAU));
}

/**
 * 日月轮世界坐标——水平分量与仰角分量共用同一个 `CELESTIAL_ORBIT_RADIUS`，是字面
 * 意义的"一个大圆"（`x²+y²+z²` 对任意 t 恒等于 `CELESTIAL_ORBIT_RADIUS²`，见
 * skyscape.test.ts 的不变量断言）。导出供测试直接调用（不传 `out`，接受一次性
 * 分配——测试不在热路径上）；`update()` 的每帧调用（见下方 buildSkyscape 内部）
 * 传入复用的 scratch 对象，原地写入三个分量，不在渲染循环里分配新对象
 * （code review 抓到：早期版本每帧 `return {x,y,z}` 新建一个字面量，与本文件头部
 * "zero per-frame allocation" 的既有纪律不一致）。
 */
export function celestialWorldPos(
  timeOfDay: number,
  out: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
): { x: number; y: number; z: number } {
  const angle = timeOfDay * SUN_MOON_TAU;
  const horiz = Math.cos(angle) * CELESTIAL_ORBIT_RADIUS;
  out.x = horiz * Math.cos(CELESTIAL_AZIMUTH);
  out.y = celestialElevation(timeOfDay) * CELESTIAL_ORBIT_RADIUS;
  out.z = horiz * Math.sin(CELESTIAL_AZIMUTH);
  return out;
}

/** "轮"贴图——比 particles.ts 的 createGlowSprite 更实心（渐隐边缘更窄），读作一个有边界的圆盘而不是一团发散的光。 */
function buildDiscTexture(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = DISC_TEXTURE_SIZE;
  canvas.height = DISC_TEXTURE_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("skyscape: 2D context unavailable (buildDiscTexture)");
  const r = DISC_TEXTURE_SIZE / 2;
  const gradient = ctx.createRadialGradient(r, r, 0, r, r, r);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.7, "rgba(255,255,255,1)");
  gradient.addColorStop(0.88, "rgba(255,255,255,0.55)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, DISC_TEXTURE_SIZE, DISC_TEXTURE_SIZE);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/** 光晕（月晖）贴图——中心透明（不与本体重叠叠加亮度）、中段一圈柔光带、外圈渐隐——只在夜间随 nightAmount 显现（见 update() 里的 HALO_OPACITY_MAX 用法）。 */
function buildHaloTexture(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = HALO_TEXTURE_SIZE;
  canvas.height = HALO_TEXTURE_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("skyscape: 2D context unavailable (buildHaloTexture)");
  const r = HALO_TEXTURE_SIZE / 2;
  const gradient = ctx.createRadialGradient(r, r, 0, r, r, r);
  gradient.addColorStop(0, "rgba(255,255,255,0)");
  gradient.addColorStop(0.4, "rgba(255,255,255,0)");
  gradient.addColorStop(0.6, "rgba(255,255,255,0.55)");
  gradient.addColorStop(0.8, "rgba(255,255,255,0.18)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, HALO_TEXTURE_SIZE, HALO_TEXTURE_SIZE);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

interface CelestialHandle {
  discSprite: THREE.Sprite;
  discMaterial: THREE.SpriteMaterial;
  haloSprite: THREE.Sprite;
  haloMaterial: THREE.SpriteMaterial;
}

function buildCelestialDisc(scene: THREE.Scene): CelestialHandle {
  const haloMaterial = new THREE.SpriteMaterial({
    map: buildHaloTexture(),
    color: PALETTE.moonHaloTint,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending, // 光晕是"发光"读法——同萤火的既有选择
    fog: false,
    toneMapped: false,
    opacity: 0,
  });
  const haloSprite = new THREE.Sprite(haloMaterial);
  scene.add(haloSprite);

  const discMaterial = new THREE.SpriteMaterial({
    map: buildDiscTexture(),
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending, // 日月"轮"是有边界的实体圆盘，不是发光点——不用 additive
    fog: false,
    toneMapped: false,
  });
  const discSprite = new THREE.Sprite(discMaterial);
  scene.add(discSprite);

  return { discSprite, discMaterial, haloSprite, haloMaterial };
}

// ---- 4. 夜空星河 ----
const STAR_COUNT = 300;
const STAR_RADIUS = 390; // 略小于 sky dome 半径(400)，同日月轮的"嵌在天空里"考量
const STAR_MIN_Y_FRAC = 0.05; // 允许低到几乎贴地平线，但绝大多数落在上半天球
const STAR_POINT_SIZE = 1.4;
const STAR_TWINKLE_BASE = 0.5;
const STAR_TWINKLE_AMP = 0.4;
// night-only 门：不直接复用 nightAmount（黎明/黄昏关键帧的 nightAmount 是 0.35/0.65，
// 直接用会让星星在天还没黑透时就有 35%~65% 可见度，读不出"夜空专属"）——用一段更陡的
// smoothstep 把门槛收紧到 nightAmount∈[0.4,0.75] 才开始显现，nightAmount 本身已经是
// 关键帧间 smoothstep 插值的产物（见 palette.ts findDayNightBracket），这里再叠一层
// smoothstep 不会引入新的跳变，只是把"星星什么时候开始出现"的阈值收得更晚更陡。
const STAR_FADE_LOW = 0.4;
const STAR_FADE_HIGH = 0.75;

function smoothstep01(x: number): number {
  const c = x < 0 ? 0 : x > 1 ? 1 : x;
  return c * c * (3 - 2 * c);
}

/** 星河/银河带的 night-only 可见度门——纯函数，导出供测试直接断言。 */
export function starVisibilityFor(timeOfDay: number): number {
  const night = interpolateDayNight(timeOfDay).nightAmount;
  return smoothstep01((night - STAR_FADE_LOW) / (STAR_FADE_HIGH - STAR_FADE_LOW));
}

interface StarHandle {
  points: THREE.Points;
  colorAttr: THREE.BufferAttribute;
  phases: Float32Array;
  freqs: Float32Array;
}

function buildStarPoints(scene: THREE.Scene, seed: number): StarHandle {
  const rng = createRng(seed ^ 0x9f5a30);
  const positions = new Float32Array(STAR_COUNT * 3);
  const colors = new Float32Array(STAR_COUNT * 4); // RGBA——itemSize=4 触发 three.js 的 USE_COLOR_ALPHA（同 particles.ts 萤火的既有手法）
  const phases = new Float32Array(STAR_COUNT);
  const freqs = new Float32Array(STAR_COUNT);
  const base = new THREE.Color(PALETTE.starTint);
  for (let i = 0; i < STAR_COUNT; i++) {
    const yFrac = STAR_MIN_Y_FRAC + rng.next() * (1 - STAR_MIN_Y_FRAC);
    const horizRadius = Math.sqrt(Math.max(0, 1 - yFrac * yFrac));
    const az = rng.next() * SUN_MOON_TAU;
    positions[i * 3] = STAR_RADIUS * horizRadius * Math.cos(az);
    positions[i * 3 + 1] = STAR_RADIUS * yFrac;
    positions[i * 3 + 2] = STAR_RADIUS * horizRadius * Math.sin(az);
    colors[i * 4] = base.r;
    colors[i * 4 + 1] = base.g;
    colors[i * 4 + 2] = base.b;
    colors[i * 4 + 3] = STAR_TWINKLE_BASE;
    phases[i] = rng.next() * Math.PI * 2;
    freqs[i] = 0.5 + rng.next() * 1.0; // 各自异步的 twinkle 频率，避免 300 颗一起同步闪烁
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const colorAttr = new THREE.BufferAttribute(colors, 4);
  geometry.setAttribute("color", colorAttr);
  const material = new THREE.PointsMaterial({
    size: STAR_POINT_SIZE,
    vertexColors: true,
    transparent: true,
    sizeAttenuation: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false; // 300 颗散布在整个天球半径上，默认包围球判定容易在边缘误剔除
  scene.add(points);
  return { points, colorAttr, phases, freqs };
}

// ---- 银河带 ----
const GALAXY_SEGMENTS = 32;
const GALAXY_RADIUS = 385;
const GALAXY_HALF_WIDTH = 45;
const GALAXY_TILT = Math.PI / 5; // 银河带所在大圆相对水平面的倾角——纯美术选择，避免完全水平/垫直
const GALAXY_ARC_START = -0.08 * Math.PI;
const GALAXY_ARC_END = 1.08 * Math.PI; // 略过半圆，两端都探到地平线以下，靠贴图自身的端部渐隐收尾
const GALAXY_TEXTURE_W = 512;
const GALAXY_TEXTURE_H = 64;
const GALAXY_BASE_OPACITY = 0.12; // brief 原话精确值

/** 银河带贴图：沿长度方向、沿宽度方向各一段柔和渐隐 + 一点颗粒噪声（"云雾般的星带"读法，不是一条边缘锐利的光带）。 */
function buildGalaxyTexture(rng: Rng): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = GALAXY_TEXTURE_W;
  canvas.height = GALAXY_TEXTURE_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("skyscape: 2D context unavailable (buildGalaxyTexture)");
  const image = ctx.createImageData(GALAXY_TEXTURE_W, GALAXY_TEXTURE_H);
  for (let x = 0; x < GALAXY_TEXTURE_W; x++) {
    const u = x / (GALAXY_TEXTURE_W - 1);
    const alphaH = Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.6);
    for (let y = 0; y < GALAXY_TEXTURE_H; y++) {
      const v = y / (GALAXY_TEXTURE_H - 1);
      const alphaV = Math.pow(Math.max(0, Math.sin(Math.PI * v)), 0.8);
      const noise = 0.75 + rng.next() * 0.25;
      const idx = (y * GALAXY_TEXTURE_W + x) * 4;
      image.data[idx] = 255;
      image.data[idx + 1] = 255;
      image.data[idx + 2] = 255;
      image.data[idx + 3] = Math.round(alphaH * alphaV * noise * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/**
 * 银河带几何：沿一个倾斜大圆采样 `GALAXY_SEGMENTS+1` 个点，每点沿"球面切线方向的
 * 垂线"（`radial × tangent`）左右各展开 `GALAXY_HALF_WIDTH`，拼成一条带状
 * `BufferGeometry`（1 个 draw call，静态，不逐帧重建）。这条垂线天然贴着球面走，
 * 从内部（摄像机在原点附近）看上去会随透视自然"拱起"，不需要真的做一个跟随摄像机
 * 姿态调整的机制——brief 原话"arcing overhead"这个视觉效果单靠几何本身+透视就成立。
 */
function buildGalaxyGeometry(): THREE.BufferGeometry {
  const u = new THREE.Vector3(1, 0, 0);
  const v = new THREE.Vector3(0, Math.cos(GALAXY_TILT), Math.sin(GALAXY_TILT));
  const positions = new Float32Array((GALAXY_SEGMENTS + 1) * 2 * 3);
  const uvs = new Float32Array((GALAXY_SEGMENTS + 1) * 2 * 2);
  const indices: number[] = [];
  for (let i = 0; i <= GALAXY_SEGMENTS; i++) {
    const t = i / GALAXY_SEGMENTS;
    const angle = GALAXY_ARC_START + (GALAXY_ARC_END - GALAXY_ARC_START) * t;
    const radial = u.clone().multiplyScalar(Math.cos(angle)).add(v.clone().multiplyScalar(Math.sin(angle)));
    const tangent = u.clone().multiplyScalar(-Math.sin(angle)).add(v.clone().multiplyScalar(Math.cos(angle))).normalize();
    const perp = new THREE.Vector3().crossVectors(radial, tangent).normalize();
    const center = radial.multiplyScalar(GALAXY_RADIUS);
    const top = center.clone().addScaledVector(perp, GALAXY_HALF_WIDTH);
    const bottom = center.clone().addScaledVector(perp, -GALAXY_HALF_WIDTH);
    const base = i * 2 * 3;
    positions[base] = top.x;
    positions[base + 1] = top.y;
    positions[base + 2] = top.z;
    positions[base + 3] = bottom.x;
    positions[base + 4] = bottom.y;
    positions[base + 5] = bottom.z;
    const uvBase = i * 2 * 2;
    uvs[uvBase] = t;
    uvs[uvBase + 1] = 0;
    uvs[uvBase + 2] = t;
    uvs[uvBase + 3] = 1;
    if (i < GALAXY_SEGMENTS) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, c, b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

function buildGalaxyBand(scene: THREE.Scene, seed: number): THREE.Mesh {
  const material = new THREE.MeshBasicMaterial({
    map: buildGalaxyTexture(createRng(seed ^ 0x9f5a40)),
    color: PALETTE.galaxyTint,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, // 银河是"发光的星尘"读法，同萤火/星点一致
    fog: false,
    toneMapped: false,
    opacity: 0,
  });
  const mesh = new THREE.Mesh(buildGalaxyGeometry(), material);
  scene.add(mesh);
  return mesh;
}

// ---- 汇总 ----
export interface SkyscapeHandle {
  update(tSec: number, timeOfDay: number): void;
  /** 验证专用（镜像 landmarks.ts getLandmarkAnchors 惯例）：日月轮最近一次 update() 算出的世界坐标，供外部 Playwright 脚本核对"正午顶空为日轮/子夜顶空为月轮"。 */
  getCelestialWorldPos(): { x: number; y: number; z: number };
}

/**
 * 构建整套天空远景并加入 `scene`。调用时机与 `buildLandmarks`/`buildGroundMist`
 * 同层——地形建好之后一次性调用一次（本文件不读 `terrain`，见文件头"不需要
 * Terrain 参数"这一点：所有元素的位置都是相对世界原点的固定半径/高度，不依赖实际
 * 地形高度场）。`seed` 与 `createSim` 同源，各子系统用不同的 `^` 常数派生独立 rng
 * 流（同 scatter.ts/landmarks.ts/grassField.ts/groundMist.ts 的既有惯例）。
 */
export function buildSkyscape(scene: THREE.Scene, seed: number): SkyscapeHandle {
  const rings = buildInkMountains(scene, seed);
  const clouds = buildCloudBank(scene, seed);
  const celestial = buildCelestialDisc(scene);
  const stars = buildStarPoints(scene, seed);
  const galaxy = buildGalaxyBand(scene, seed);

  // 每帧复用的 scratch——fogScratch 避免"墨色朝 fogColor 靠"这个 lerp 分配新
  // Color；celestialPosScratch 同理避免 celestialWorldPos() 每帧 return 一个新
  // 字面量（perf 要求"zero per-frame allocation"，code review 抓到的真问题——见
  // celestialWorldPos 的 `out` 参数头注释）。getCelestialWorldPos() 返回的也是这一个
  // 对象本身，不是拷贝——同 getPetalPositions() 等既有 dev-only 探针一样只读不改，
  // 调用方不会拿到一份需要防止被后续 update() 悄悄突变的引用去长期持有。
  const fogScratch = new THREE.Color();
  const celestialPosScratch = { x: 0, y: 0, z: 0 };

  return {
    update(tSec: number, timeOfDay: number): void {
      const kf = interpolateDayNight(timeOfDay);

      // 1. 远山：颜色朝 fogColor 按各圈 fogMix 混合（大气透视），透明度维持构建时定死的三级固定值（brief 原话"opacity 0.5/0.35/0.22"，不随时间变化）。
      fogScratch.setHex(kf.fogColor);
      for (const ring of rings) {
        ring.material.color.setHex(kf.mountainInk).lerp(fogScratch, ring.fogMix);
      }

      // 2. 云海：极慢角速度漂移——同 groundMist.ts/particles.ts 的既有惯例，位置直接由
      // 绝对墙钟 tSec 重新算出（`baseAngle + angularSpeed*tSec`），不维护一个逐帧累加
      // 的状态变量：update() 只拿到 tSec（不是 frameDt），"绝对时间代入周期函数"天然
      // 是零分配、且掉帧也不会让漂移量偏移（累加式写法反而会因为掉帧的 tick 数不同
      // 而漂出不同轨迹）。main.ts 的渲染循环即便 `paused` 为真也无条件调用
      // updateSkyscape（backdrop 惯例，见 main.ts 头部注释），tSec 是真实墙钟不会在
      // 暂停时冻结，云会跟 groundMist 的雾团一样在暂停期间继续缓慢漂移——这是既有
      // backdrop 惯例本身的行为，不是本文件特有的选择。
      const cloudGain = cloudGainFor(timeOfDay);
      for (const cloud of clouds) {
        const angle = cloud.baseAngle + cloud.angularSpeed * tSec;
        cloud.sprite.position.set(Math.sin(angle) * cloud.radius, cloud.y, Math.cos(angle) * cloud.radius);
        (cloud.sprite.material as THREE.SpriteMaterial).color.setHex(kf.cloudTint);
        (cloud.sprite.material as THREE.SpriteMaterial).opacity = cloud.baseOpacity * cloudGain;
      }

      // 3. 日月轮：位置/尺寸/颜色随 timeOfDay，光晕透明度随 nightAmount。
      const pos = celestialWorldPos(timeOfDay, celestialPosScratch);
      celestial.discSprite.position.set(pos.x, pos.y, pos.z);
      celestial.haloSprite.position.set(pos.x, pos.y, pos.z);
      const size = kf.celestialSize;
      celestial.discSprite.scale.setScalar(size);
      celestial.haloSprite.scale.setScalar(size * HALO_SCALE);
      celestial.discMaterial.color.setHex(kf.celestialColor);
      celestial.haloMaterial.opacity = kf.nightAmount * HALO_OPACITY_MAX;

      // 4. 星河：night-only 门控整体可见度 × 每颗异步 twinkle；银河带只随同一门控改透明度（颜色恒定，见 PALETTE.galaxyTint 头注）。
      const visibility = starVisibilityFor(timeOfDay);
      const colors = stars.colorAttr.array as Float32Array;
      for (let i = 0; i < STAR_COUNT; i++) {
        const twinkle = STAR_TWINKLE_BASE + STAR_TWINKLE_AMP * Math.sin(tSec * stars.freqs[i]! + stars.phases[i]!);
        colors[i * 4 + 3] = Math.max(0, twinkle) * visibility;
      }
      stars.colorAttr.needsUpdate = true;
      (galaxy.material as THREE.MeshBasicMaterial).opacity = GALAXY_BASE_OPACITY * visibility;
    },
    getCelestialWorldPos(): { x: number; y: number; z: number } {
      return celestialPosScratch;
    },
  };
}
