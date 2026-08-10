import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { createRng, type Rng, type Terrain } from "@shiling/sim";
import type { WorldParams } from "@shiling/content";
import { PALETTE } from "./palette.js";
import { terrainBandColor } from "./terrainMesh.js";

/**
 * 风草海（M2 A3「地表精致化」，owner feedback「地图不精致」）：一个 6000 实例的
 * InstancedMesh（1 个 draw call），彻底替换 scatter.ts 里原先稀疏的圆锥草丛
 * （GRASS_COUNT=880，见该文件 M2 A3 一节的头部注释）。
 *
 * **几何**：每个实例是"十字交叉叶片"——两片同宽的薄 PlaneGeometry 绕 Y 轴错开 90°
 * 合并成一个 X 形丛（同 Minecraft 式"crossed billboard"手法，但这里不跟随摄像机
 * 旋转，靠交叉本身在任意视角下都读出"有厚度"的一丛，而不是一片会消失的纸片）。
 * 几何体本地 Y 归一化到 [0,1]（translate 让根部落在 y=0），实际高度完全交给
 * per-instance 的 instanceMatrix Y 缩放——`position.y`（顶点属性，永远是变换前的
 * 本地坐标）因此天生就是"沿叶片高度的归一化位置"，不需要再为每个实例单独烘焙一份
 * heightFrac 属性。**不加随机 yaw**（有别于 scatter.ts 的草/岩石/枯树都会随机
 * yaw）：两片交叉叶片宽度相等，整个十字在绕 Y 轴 90° 旋转下严格不变，加 yaw 对
 * 这个特定几何形状的剪影没有任何视觉收益，反而会让下面"local X ≈ world X"这条
 * 简化（摇摆位移直接加在本地 X 上）失效——跳过 yaw 不是偷工，是这个几何形状下
 * 数学上等价的化简。
 *
 * **摇摆着色器**：`MeshLambertMaterial.onBeforeCompile` 注入两处——`#include
 * <common>` 之后声明 `attribute float aPhase`/`uniform float uTime`；
 * `#include <begin_vertex>` 之后把 `sin(worldX*0.35 + uTime*1.4 + aPhase) *
 * BEND * heightFrac` 加到 `transformed.x`（instance 变换前的本地坐标，`project_vertex`
 * 随后才把它乘上 instanceMatrix）。`worldX` 直接读 `instanceMatrix[3].x`
 * ——三. js 的 `WebGLProgram` 只要检测到 `object.isInstancedMesh` 就会在
 * prefixVertex 里无条件加上 `#define USE_INSTANCING` + `attribute mat4
 * instanceMatrix;`（读过 node_modules/three 源码确认，与材质是否是内置 ShaderLib
 * 模板无关），因此这份手写注入代码可以直接引用 `instanceMatrix`，不需要自己声明。
 * `instanceMatrix[3]` 是平移列——由于本文件的 instance 矩阵只含平移+缩放（上一段
 * 解释过为何不加 yaw/旋转），`instanceMatrix[3].x` 精确等于这株草锚点的世界 X，
 * 不受该实例自身缩放影响。
 *
 * **为什么选 `onBeforeCompile` 而不是手写 `ShaderMaterial`（brief 给了两个选项，
 * 要求"pick more maintainable, document"）**：atmosphere.ts 的天空穹顶是本工程
 * 唯一的手写 ShaderMaterial 先例，但那里选手写是因为穹顶本身不需要参与场景光照/
 * 雾（`fog:false`，`toneMapped:false`）——换句话说它天生就该绕开整套光照/雾管线。
 * 风草恰恰相反：它站在地面上，理应像 terrainMesh.ts/scatter.ts 一样跟着
 * hemi/sun 双光源与昼夜插值（`updateAtmosphere` 每帧写的 `hemiLightRef`/
 * `sunLightRef`）自然变亮变暗，也理应像其余地表物体一样被 `scene.fog` 罩住。
 * 手写 ShaderMaterial 想要这些效果，必须自己重新声明 hemi/sun uniform 并每帧从
 * atmosphere.ts 同步（重复一份 particles.ts 萤火早就在做的"gain 手动同步"套路），
 * 外加手动拼 `fog_vertex`/`fog_pars_fragment` 这些 chunk 字符串。而
 * `MeshLambertMaterial.onBeforeCompile` 只需要在**现成**的 Lambert 模板上打两个
 * 补丁（声明+位移），光照/雾/色调映射/色彩空间全部沿用材质模板原有实现——注入的
 * 代码量小一个量级，且"跟场景光照联动"这个诉求是零额外代码的（本来就是
 * MeshLambertMaterial 的分内工作）。唯一的已知代价——`onBeforeCompile` 依赖
 * three.js 内部 chunk 名字符串（`#include <begin_vertex>`），版本升级时这些名字
 * 理论上可能变化——用一次性验证（这批任务的三件套+Playwright 截图）核实过在
 * three@0.168.0 上工作正常，属于可接受的维护成本。
 *
 * **`customProgramCacheKey`——特意验证过不需要手动设**：`Material.customProgramCacheKey()`
 * 的默认实现是 `this.onBeforeCompile.toString()`（读过 three.module.js 源码确认），
 * 这里赋的是一个具名闭包函数，其 `.toString()` 天然与任何其它材质默认的
 * no-op `onBeforeCompile`（基类方法）不同——因此 three.js 的 WebGLPrograms 缓存
 * 天然不会把这份注入过的编译结果错误地复用给场景里其它普通 MeshLambertMaterial
 * （scatter.ts/terrainMesh.ts 到处都有），不需要额外手写一个 cache key。本文件
 * 只创建一份该材质实例，这条结论已经足够，不需要为"重复调用本函数会怎样"这种
 * 不会发生的场景过度设计。
 *
 * **上色**：直接复用 `terrainMesh.ts` 导出的 `terrainBandColor`（地形顶点色同一份
 * 分层公式）——owner brief 原话"grass color ties to terrain band tint"，草色要跟脚下
 * 的地形色带走，不是另开一套独立的绿色渐变。取色后向 `PALETTE.scatterGrass`
 * lerp 一点（`GRASS_GREEN_TINT`），给"这是草"一个统一的身份识别，同时仍保留
 * 地形色带带来的沿海岸/沼泽/山地渐变差异；再叠一层 `COLOR_JITTER` 做个体色差
 * （同 scatter.ts 的既有惯例）。
 *
 * **密度分布**："meadow-band-weighted"——沼泽湿度带（waterLevel+0.6..+0.9）与
 * 山地 rocky 带（h>=peakMin）分别按 `SWAMP_KEEP_PROB`/`ROCKY_KEEP_PROB` 概率稀疏化
 * （沼泽是芦苇的地盘、裸岩长不出草甸），纯草甸带满密度——公式与 terrainMesh.ts/
 * scatter.ts 镜像同一套 shoreMax/swampMax/peakMin 阈值（Terrain 接口不暴露
 * hillAmp，这里手动镜像，同 scatter.ts 头部注释"各自计算层不共享内部实现细节"的
 * 既有写法）。rng 独立于 scatter.ts/landmarks.ts（各自 `seed ^` 不同常数，互不干扰
 * 抽样序列，同既有惯例）。
 */

const GRASS_FIELD_COUNT = 6000;
const MAX_REJECTION_ATTEMPTS = 10_000; // 同 scatter.ts/landmarks.ts 既有防御性上限

const LAND_MARGIN = 0.8; // 镜像 scatter.ts 的 LAND_MARGIN——水域/滩涂不长草
const SWAMP_KEEP_PROB = 0.4; // 沼泽湿度带内按此概率保留——读作"这里是芦苇的地盘，草长得挑剔"
const ROCKY_KEEP_PROB = 0.12; // 山地 rocky 带内按此概率保留——裸崖石上长不出草甸

const BLADE_WIDTH = 0.4; // 交叉叶片本地宽度（缩放前）
const GRASS_HEIGHT_MIN = 0.5;
const GRASS_HEIGHT_MAX = 0.85;
const GRASS_WIDTH_SCALE_MIN = 0.8;
const GRASS_WIDTH_SCALE_MAX = 1.3;

const GRASS_GREEN_TINT = 0.3; // 向 PALETTE.scatterGrass 混合的比例——见文件头"上色"一节
const COLOR_JITTER = 0.12; // ± 亮度抖动，同 scatter.ts 既有惯例

// 摇摆公式常量（brief 原话的具体数值）：世界 X 空间频率 0.35、时间频率 1.4、
// 弯曲幅度 0.16（叶尖位移，单位=米，乘 heightFrac 后叶根处为 0）。
const SWAY_WORLD_FREQ = 0.35;
const SWAY_TIME_FREQ = 1.4;
const SWAY_BEND = 0.16;

// 法线朝上偏（见 buildSwayMaterial 内注入点的完整论证）：叶根 0.4、叶尖 0.75
// （BASE + TIP），让暗部不再糊成剪影，同时仍保留一部分真实竖直法线的方向性
// （不是整片拍成 1.0 全朝上——那样会完全丢失"竖直薄面"的读法，变成贴图感的
// 平贴地面圆片）。
const GRASS_NORMAL_UP_BIAS_BASE = 0.4;
const GRASS_NORMAL_UP_BIAS_TIP = 0.35;

interface GrassPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * Meadow-band-weighted rejection sampler（见文件头"密度分布"一节）：陆地上按高度带
 * 分别应用保留概率，纯草甸带（swampMax < h < peakMin）始终保留。
 */
function sampleGrassFieldPoints(
  rng: Rng,
  terrain: Terrain,
  count: number,
  swampMax: number,
  peakMin: number,
): GrassPoint[] {
  const half = terrain.size / 2;
  const points: GrassPoint[] = [];
  for (let i = 0; i < count; i++) {
    let placed = false;
    for (let attempt = 0; attempt < MAX_REJECTION_ATTEMPTS; attempt++) {
      const x = rng.range(-half, half);
      const z = rng.range(-half, half);
      const y = terrain.heightAt(x, z);
      if (y <= terrain.waterLevel + LAND_MARGIN) continue;
      if (y <= swampMax) {
        if (rng.next() > SWAMP_KEEP_PROB) continue;
      } else if (y >= peakMin) {
        if (rng.next() > ROCKY_KEEP_PROB) continue;
      }
      points.push({ x, y, z });
      placed = true;
      break;
    }
    if (!placed) {
      throw new Error("grassField: no meadow position found after max attempts; check WorldParams/terrain");
    }
  }
  return points;
}

/**
 * 十字交叉叶片几何——两片等宽 PlaneGeometry 绕 Y 轴错开 90°，本地 Y 归一化到
 * [0,1]（translate 把根部移到 y=0）。见文件头"几何"一节为何不需要额外的 yaw 变体。
 */
function buildBladeGeometry(): THREE.BufferGeometry {
  const planeA = new THREE.PlaneGeometry(BLADE_WIDTH, 1, 1, 1);
  planeA.translate(0, 0.5, 0);
  const planeB = new THREE.PlaneGeometry(BLADE_WIDTH, 1, 1, 1);
  planeB.rotateY(Math.PI / 2);
  planeB.translate(0, 0.5, 0);
  const merged = mergeGeometries([planeA, planeB], false);
  if (!merged) throw new Error("grassField: buildBladeGeometry merge failed");
  return merged;
}

/**
 * `MeshLambertMaterial` + `onBeforeCompile` 注入摇摆位移——见文件头"摇摆着色器"/
 * "为什么选 onBeforeCompile"两节完整论证。返回材质本身与一个可写的 uniforms
 * 引用容器：`onBeforeCompile` 只在首次真正编译时才会被调用（真实编译时机由
 * renderer 决定，不是材质构造时），因此 `uTime` uniform 对象要等编译发生后才存在
 * ——用一个可变的闭包容器（而不是直接返回 `shader.uniforms`）让 `update()` 在
 * 编译尚未发生的极短窗口内安全 no-op，同 atmosphere.ts 的 `hemiLightRef` 系列
 * null 兜底同一惯例。
 */
function buildSwayMaterial(): { material: THREE.MeshLambertMaterial; setTime: (t: number) => void } {
  const material = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  let timeUniform: THREE.IUniform<number> | null = null;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    timeUniform = shader.uniforms.uTime as THREE.IUniform<number>;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute float aPhase;\nuniform float uTime;\nvarying float vHeightFrac;",
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
	float heightFrac = clamp(position.y, 0.0, 1.0);
	vHeightFrac = heightFrac;
	// code review 抓到的真实 bug：这里的位移加在 instanceMatrix 变换*之前*的
	// 本地坐标上（project_vertex 随后才把 transformed 乘上 instanceMatrix），
	// 而本文件的 instance 矩阵带非均匀缩放（宽度 widthScale 独立于高度
	// height，见 buildGrassField 的 matrix.compose 调用）——如果直接把
	// "世界空间意义上想要的位移量" 加在本地 X 上，它会在变换时被 instanceMatrix
	// 的 X 轴缩放（也就是 widthScale，0.8~1.3）放大/缩小，实际世界空间摇摆
	// 幅度因此逐实例漂移 ±30%，不再是 SWAY_BEND 这个常量本身。用
	// instanceMatrix 第一列（X 基向量）的长度还原出这株草自己的 widthScale，
	// 除掉它抵消这份缩放，让最终世界空间幅度精确等于 SWAY_BEND，不随
	// widthScale 抽样结果漂移。
	float instScaleX = length(instanceMatrix[0].xyz);
	float sway = sin(instanceMatrix[3].x * ${SWAY_WORLD_FREQ} + uTime * ${SWAY_TIME_FREQ} + aPhase) * ${SWAY_BEND} * heightFrac / instScaleX;
	transformed.x += sway;`,
      );

    // 法线朝上偏——见文件头"上色"一节：叶片是竖直薄面，法线水平朝外，
    // HemisphereLight 对水平法线只给 hemiSky/hemiGround 各半的亮度（不像地形
    // 那种朝上法线几乎满额吃 hemiSky 的亮度）。**真实渲染截图 + 直接抓取编译后
    // 的 GLSL 源码核验过的两版尝试**：
    // 1) 第一版把偏移加在顶点着色器的 `objectNormal`（`beginnormal_vertex` 之后）——
    //    编译产物确认注入成功，但截图肉眼看不出任何变化，6000 片草仍然读成一片
    //    近黑剪影。抓取 `normal_fragment_begin` 片元 chunk 源码后找到根因：
    //    `DOUBLE_SIDED` 材质在**片元阶段**对整条法线做 `normal *= faceDirection`
    //    （`faceDirection = gl_FrontFacing ? 1.0 : -1.0`）——这条翻转在顶点阶段
    //    的偏移**之后**发生，会把刚偏好的朝上分量连同其余分量一起原样翻成朝下
    //    （对着摄像机呈现"背面"的那一半叶片三角形——由于本文件不给实例加 yaw，
    //    这一半在整片草场里是几何上固定的一批，不是随机噪点，因此拖累的是
    //    "一整片"的平均亮度，不是零星几株）。
    // 2) 第二版（当前采用）把偏移挪到**片元阶段**、`normal_fragment_begin` 完成
    //    翻转**之后**——此时 `normal` 已经是"这一帧、这一片元真正会拿去算光照"
    //    的那份，在它之上再朝上偏移，翻转不会再抵消这份偏移。`heightFrac`
    //    只在顶点阶段有 `position` 可读，故新增 `vHeightFrac` varying 跨阶段
    //    传递（同一个数值，只是搬到片元端消费）。**"上"不能直接写 `vec3(0,1,0)`**
    //    ——`normal_fragment_begin` 产出的 `normal` 是**视空间**（camera-space）
    //    向量（`vNormal` 由顶点阶段的 `normalMatrix`——对象空间到视空间——变换
    //    而来），世界 +Y 在视空间下的朝向随镜头俯仰角实时变化，不是常量
    //    `(0,1,0)`；直接把它当视空间常量偏，会在镜头俯视/仰视时偏出一个错误方向。
    //    用 `viewMatrix`（片元 prefix 现成的 uniform）把世界 +Y 显式变换进视空间
    //    （`w=0` 只取旋转分量，不含平移）才是"世界意义上的上"。
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vHeightFrac;")
      .replace(
        "#include <normal_fragment_begin>",
        `#include <normal_fragment_begin>
	float normalUpBias = ${GRASS_NORMAL_UP_BIAS_BASE} + ${GRASS_NORMAL_UP_BIAS_TIP} * vHeightFrac;
	vec3 worldUpInViewSpace = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
	normal = normalize(mix(normal, worldUpInViewSpace, normalUpBias));`,
      );
  };

  return {
    material,
    setTime: (t: number) => {
      if (timeUniform) timeUniform.value = t;
    },
  };
}

function pickGrassColor(rng: Rng, point: GrassPoint, waterLevel: number, shoreMax: number, swampMax: number, peakMin: number): THREE.Color {
  const band = terrainBandColor(point.y, waterLevel, shoreMax, swampMax, peakMin);
  const tinted = band.lerp(new THREE.Color(PALETTE.scatterGrass), GRASS_GREEN_TINT);
  const factor = 1 + (rng.next() * 2 - 1) * COLOR_JITTER;
  return tinted.multiplyScalar(factor);
}

/**
 * 构建风草场并加入 `scene`。调用时机/参数约定同 `buildScatter`——地形建好之后
 * 一次性调用，`seed` 与 `createSim` 同源（确定性），`params` 供 `hillAmp` 算
 * `peakMin`（`Terrain` 接口本身不暴露）。返回的 `update(tSec)` 每帧写一次
 * `uTime` uniform（main.ts 的渲染循环调用，同 `updateWater(tSec)`/
 * `landmarks.update(...)` 的既有惯例），不做任何其它每帧分配。
 */
export function buildGrassField(
  scene: THREE.Scene,
  terrain: Terrain,
  seed: number,
  params: WorldParams,
): { update(tSec: number): void } {
  const rng = createRng(seed ^ 0x67617373); // "gass"-ish 常数，独立于 scatter.ts(^0x51ab)/landmarks.ts(^0x6c616e64)
  const waterLevel = terrain.waterLevel;
  const shoreMax = waterLevel + 0.6; // 镜像 terrainMesh.ts
  const swampMax = waterLevel + 0.9; // 镜像 terrainMesh.ts/scatter.ts
  const peakMin = params.hillAmp * 0.75; // 镜像 terrainMesh.ts

  const points = sampleGrassFieldPoints(rng, terrain, GRASS_FIELD_COUNT, swampMax, peakMin);

  const geometry = buildBladeGeometry();
  const { material, setTime } = buildSwayMaterial();
  const mesh = new THREE.InstancedMesh(geometry, material, points.length);

  const phases = new Float32Array(points.length);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion(); // identity — 见文件头"几何"一节：不加 yaw
  for (let i = 0; i < points.length; i++) {
    const point = points[i]!;
    phases[i] = rng.next() * Math.PI * 2;
    const height = GRASS_HEIGHT_MIN + rng.next() * (GRASS_HEIGHT_MAX - GRASS_HEIGHT_MIN);
    const widthScale = GRASS_WIDTH_SCALE_MIN + rng.next() * (GRASS_WIDTH_SCALE_MAX - GRASS_WIDTH_SCALE_MIN);
    matrix.compose(new THREE.Vector3(point.x, point.y, point.z), quaternion, new THREE.Vector3(widthScale, height, widthScale));
    mesh.setMatrixAt(i, matrix);
    mesh.setColorAt(i, pickGrassColor(rng, point, waterLevel, shoreMax, swampMax, peakMin));
  }
  mesh.instanceMatrix.needsUpdate = true;
  geometry.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phases, 1));

  // 静态实例，构建后不再移动（摇摆完全是顶点着色器位移，不改 CPU 侧
  // instanceMatrix/包围球）——同 scatter.ts 的既有惯例，frustumCulled 保持默认
  // true，摇摆幅度（SWAY_BEND=0.16m）远小于包围球误差容限，不需要关闭裁剪。
  scene.add(mesh);

  return {
    update(tSec: number): void {
      setTime(tSec);
    },
  };
}
