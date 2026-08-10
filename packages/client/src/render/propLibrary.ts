import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * M2 A2「Meshy 山海经布景」（owner feedback「布景劣质，能不能生成精致的布景」）：
 * 9 件静态山海经布景 GLB 的加载/归一化/烘焙——与 modelLibrary.ts（生物 GLB）同一套
 * 手法但独立成一个平行模块，理由：
 *
 * 1. **资产目录分离**：布景存 `public/props/`，生物存 `public/models/`——两类资产的
 *    生成脚本（packages/gen 的 generate-props.ts / generate-creatures.ts）、消费方
 *    （landmarks.ts / creatureModels.ts）、生命周期（布景是"世界建好那一刻起永久静态
 *    摆件"，生物是"每个实例独立创建/死亡/复活"）全都不同，混进同一个目录/同一个模块会
 *    让"这个 entry 到底是谁在用"变得含糊。
 * 2. **归一化基准不同**：modelLibrary.ts 用 `bodyFootprintLength(species)` 把每个
 *    模型的 **Z 轴**（鼻尾方向）缩放到程序化模型的躯干长度——这对"四足站立、天然有
 *    一条鼻尾轴"的生物成立，但这 9 件布景里，石碑的定义性尺寸是高度、断桥是水平跨度、
 *    云纹岩这种自然岩石根本没有一条"正确"的轴——见下方 `loadOne` 里改用"最长边"
 *    归一化的完整论证。
 * 3. **不烘焙朝向**：modelLibrary.ts 把"转向 +Z"这个固定朝向烘焙进共享几何体（同物种
 *    每个实例天生朝向一致，动物有明确的脑袋/尾巴）。这 9 件布景除断桥外朝向无意义
 *    （plan 原话"facing irrelevant for most — random yaw"）——每个实例的朝向由
 *    landmarks.ts 在**摆放时**各自决定（多数随机 yaw，断桥例外用计算朝向），不能被
 *    一份共享几何体的固定朝向卡死，所以这里只烘焙缩放+落地对齐，不烘焙旋转。
 *
 * 加载时机：main.ts **不**像 modelLibraryPromise 那样把这个 promise 接进「入山」按钮
 * 门闩——plan 明确"preload NOT required at title...world appears instantly, refines
 * within seconds"，布景本来就该在世界一建好就用程序化占位块顶上，GLB 到位后再热替换
 * （见 landmarks.ts 的 swap 机制），不阻塞任何用户可见的等待态。
 */

export type PropId =
  | "shibei"
  | "tongding"
  | "tutengzhu"
  | "shanmen"
  | "yunwenyan"
  | "gushu"
  | "duanqiao"
  | "baigu"
  | "lingzhi";

export interface PropLibraryEntry {
  /**
   * 已烘焙（缩放到 targetSizeMeters + 落地对齐 min.y===0，**未烘焙旋转**——见文件头
   * 第 3 点）——landmarks.ts 每类布景共享同一份几何体喂给一个 InstancedMesh，
   * 从不为单个实例克隆几何体。
   */
  geometry: THREE.BufferGeometry;
  /** GLB 自带材质（未克隆——每类布景所有实例共享同一份，InstancedMesh 本身也只认一份材质，没有像 modelLibrary 的 carcass 那样需要第二个变体）。 */
  material: THREE.Material;
  /**
   * 烘焙后几何体的包围盒（min.y≈0）——code review 2026-08-10 指出：当前
   * landmarks.ts 的两枚夜间 gated 光效（铜鼎余烬/石碑刻纹）挂点高度用的是
   * STELE_TARGET_HEIGHT/DING_TARGET_HEIGHT 这两个镜像常量算出来的近似值，**没有**
   * 读这个 bbox——理由是这两处挂点必须在 GLB swap **之前**（占位阶段）就点亮，不能等
   * bbox 才可用。这个字段目前是"同 modelLibrary.ts 的 LibraryEntry 保持同一形状"的
   * 保留字段（该模块的 bbox 确实被 creatureModels.ts 消费），本模块暂无消费方——不是
   * 死代码误留，是刻意与姊妹模块的接口形状对齐，留给未来若要在 swap 完成后用真实
   * 包围盒重新精调挂点高度时复用。
   */
  bbox: THREE.Box3;
}

/** 布景 id → entry，缺失表示该布景 GLB 加载失败（landmarks.ts 的程序化占位块保持在场，游戏不受影响）。 */
export type PropLibrary = Partial<Record<PropId, PropLibraryEntry>>;

interface PropConfig {
  file: string;
  /** 目标真实世界尺寸（米）——见下方 loadOne 归一化说明。数值来自 plan：石碑2.2/鼎1.6/图腾3.5/山门5/云纹岩4/古树9/断桥4(跨度)/白骨3/灵芝1.2。 */
  targetSizeMeters: number;
  /**
   * 朝向修正（绕 Y 轴，度）——文件头第 3 点说"不烘焙朝向"对 8/9 件布景成立（朝向本身
   * 无意义，landmarks.ts 摆放时套随机 yaw），**断桥是唯一例外**：landmarks.ts 需要把
   * 断桥摆成"长轴指向灵泉中心"才能读出"跨在池上"，这要求它预先知道模型的长轴具体落在
   * 哪个局部轴上。用 `gltf-transform inspect duanqiao.glb` 实测（同 modelLibrary.ts
   * tanshou 57° 那次一样的经验方法，不是靠猜）：raw bbox `x≈1.898 > z≈0.991 > y≈0.718`
   * ——长轴落在**局部 X**，不是本文件其余摆放逻辑默认假设的局部 Z。这里显式转 90°，把
   * 长轴摆到局部 Z 上，landmarks.ts 的"计算朝向（指向泉心）= 绕 Y 的 yaw，0=+Z"这套
   * 既有约定才对得上。缺省 0（其余 8 件都不需要这道修正）。
   */
  yawCorrectionDeg?: number;
}

const PROP_CONFIG: Record<PropId, PropConfig> = {
  shibei: { file: "shibei.glb", targetSizeMeters: 2.2 },
  tongding: { file: "tongding.glb", targetSizeMeters: 1.6 },
  tutengzhu: { file: "tutengzhu.glb", targetSizeMeters: 3.5 },
  shanmen: { file: "shanmen.glb", targetSizeMeters: 5 },
  yunwenyan: { file: "yunwenyan.glb", targetSizeMeters: 4 },
  gushu: { file: "gushu.glb", targetSizeMeters: 9 },
  duanqiao: { file: "duanqiao.glb", targetSizeMeters: 4, yawCorrectionDeg: 90 },
  baigu: { file: "baigu.glb", targetSizeMeters: 3 },
  lingzhi: { file: "lingzhi.glb", targetSizeMeters: 1.2 },
};

/** 同 modelLibrary.ts 的 findFirstMesh——每份资产目前都是单 mesh/单材质（见 gen 侧 pipeline report），但对未来更深的节点层级保持稳健。 */
function findFirstMesh(root: THREE.Object3D): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  root.traverse((obj) => {
    if (!found && obj instanceof THREE.Mesh) found = obj;
  });
  return found;
}

/** 同 modelLibrary.ts 的 LOAD_TIMEOUT_MS/timeout——同源静态资源，理由同该文件注释：给一个绝不会在正常情况下触发、但能兜住真卡死请求的上限。 */
const LOAD_TIMEOUT_MS = 15000;

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms));
}

async function loadOne(id: PropId, config: PropConfig): Promise<PropLibraryEntry | null> {
  try {
    const gltf = await Promise.race([new GLTFLoader().loadAsync(`/props/${config.file}`), timeout(LOAD_TIMEOUT_MS)]);
    const mesh = findFirstMesh(gltf.scene);
    if (!mesh) throw new Error(`no mesh found in ${config.file}`);

    // 朝向修正（见 PropConfig.yawCorrectionDeg 头注）——必须在量"最长边"之前应用：
    // 一次绕 Y 的旋转只会在局部 X/Z 之间互换范围（Y 轴本身的范围不受影响），所以
    // "先转再量"和"先量再转"对 rawLargestDim 这个标量结果其实无差别；这里选"先转"
    // 只是让后面的注释读起来更直接——"此后的 rawSize 已经是修正过的"，不需要读者
    // 自己在脑内再做一次旋转推理。
    if (config.yawCorrectionDeg) {
      gltf.scene.rotation.y = (config.yawCorrectionDeg * Math.PI) / 180;
    }
    gltf.scene.updateWorldMatrix(true, true);
    const rawSize = new THREE.Vector3();
    new THREE.Box3().setFromObject(mesh).getSize(rawSize);

    // 归一化基准："最长边"而不是固定轴（对比 modelLibrary.ts 用固定的 Z 轴/
    // bodyFootprintLength）——这 9 件布景的"定义性尺寸"分别落在不同轴上（石碑/图腾柱/
    // 山门/古树是高度，断桥是水平跨度，云纹岩/白骨这种不规则天然形体根本没有一条
    // "正确"的轴），而且 Meshy 的原始导出朝向本身不保证轴对齐（modelLibrary.ts 记录过
    // tanshou 需要额外 57° 校正的真实案例）。用"不管长在哪个轴上，最长的那条边缩放到
    // targetSizeMeters"是唯一对全部 9 种形体都成立、且不需要逐个探测朝向的归一化方式
    // ——代价是云纹岩/白骨这类"最长边"未必是视觉上最直觉的维度，但这批是布景演示批次，
    // "大致读出目标体量"已达标，不追求逐轴精确匹配。
    const rawLargestDim = Math.max(rawSize.x, rawSize.y, rawSize.z);
    const scale = config.targetSizeMeters / rawLargestDim;
    gltf.scene.scale.setScalar(scale);
    gltf.scene.updateWorldMatrix(true, true);

    // 烘焙缩放（不烘焙旋转——见文件头第 3 点）：BufferGeometry.applyMatrix4 会把
    // gltf.scene 迄今为止的世界矩阵（此刻只含缩放，scene.rotation 从未被写过）正确
    // 转换到几何体自身，包括法线。
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);

    // 落地对齐：同 modelLibrary.ts 的既有标准，从实际变换后的几何体量出来，不用猜测的
    // per-prop 常量。
    geometry.computeBoundingBox();
    const groundLift = -(geometry.boundingBox?.min.y ?? 0);
    geometry.translate(0, groundLift, 0);
    geometry.computeBoundingBox();
    const bbox = geometry.boundingBox!.clone();

    // 材质直接复用 GLB 自带的（不克隆）——每类布景所有实例共享同一份，本模块从不
    // per-instance 篡改它（不像 modelLibrary.ts 需要额外克隆一份 carcass 材质，布景
    // 没有"尸体"这种第二形态）。
    const material = mesh.material as THREE.Material;

    return { geometry, material, bbox };
  } catch (err) {
    // 兜底同 modelLibrary.ts：这件布景保留 landmarks.ts 的程序化占位/回退几何体，
    // 游戏照常可玩，只是这一处摆件永远读不到 GLB 版本。
    console.warn(`propLibrary: failed to load ${id} (${config.file}), keeping procedural fallback`, err);
    return null;
  }
}

/**
 * 9 件布景各自独立加载（Promise.all，任一失败只影响它自己——同 modelLibrary.ts
 * loadModelLibrary 的既有惯例）。main.ts 不 await 这个 promise 去门闩任何 UI——见
 * 文件头"加载时机"一节；真正消费方是 landmarks.ts 的 buildLandmarks 内部 fire-and-
 * forget 调用点。
 */
export async function loadPropLibrary(): Promise<PropLibrary> {
  const ids = Object.keys(PROP_CONFIG) as PropId[];
  const entries = await Promise.all(ids.map((id) => loadOne(id, PROP_CONFIG[id]!)));
  const library: PropLibrary = {};
  ids.forEach((id, i) => {
    const entry = entries[i];
    if (entry) library[id] = entry;
  });
  return library;
}
