import * as THREE from "three";
import type { GameState } from "@shiling/sim";
import type { OrganSlot } from "@shiling/content";
import { PALETTE } from "./palette.js";
import { bodyFootprintLength, type CreatureModel } from "./creatureModels.js";

/**
 * 器官可视化（M1 B5，见 2026-08-10-m1-evolution-plan.md B5 一节）：把玩家已装备的器官
 * （state.organs，唯一读者是玩家自己的 CreatureModel——organs 是玩家专属全局字段，见
 * @shiling/sim 的 state.ts 字段注释）翻译成挂在模型各处的程序化几何体/材质微调。
 *
 * **挂点策略（不用真正的 Box3 世界包围盒）**：plan 原话是"limbs/skin/sense anchor to
 * bbox-derived offsets"，但 model.group 是一个每帧被 creatureView.applyInterp 原地
 * 改写 position/rotation 的*活*对象——对它调用 `Box3().setFromObject()` 拿到的是这一帧
 * 的世界坐标包围盒，既不稳定（下一帧玩家挪动/转身就变了）也不是我们真正想要的"模型
 * 自身局部形状"。改用两个已经在别处验证过、且不随时间变化的稳定参照：
 *   1. `bodyFootprintLength(species)`（creatureModels.ts 已经导出的鼻尾长度，阴影半径/
 *      GLB 归一化缩放都用它）——所有前后向（Z 轴）间距的缩放基准；
 *   2. `model.parts.body.position.y`——对程序化模型是 body mesh 自己的 group-space Y
 *      （胶囊/球体几何体本身以局部原点为中心，这个值恰好就是躯干的竖直中心高度）、
 *      对 GLB 模型是 buildGlbCreatureModel 里那个专门为动画枢轴而设的 `pivot.position.y`
 *      （同样是躯干中心高度，见该函数注释）——两个家族天然给出同一语义的数值，不需要
 *      分支处理。
 * 左右/上下的具体偏移用 bodyFootprintLength 的固定小数比例近似（本工程legless 的
 * graybox 生物本来就没有真实的"肢体宽度"数据可读），是刻意的简化而非疏漏——这批是
 * 客户演示批次，视觉上"读得出这是什么器官、挂在大致正确的部位"就达标，不追求解剖学
 * 精确。
 *
 * **只服务玩家**：organs 只有玩家会有（NPC 从不装备），所以本模块的 species 参数在
 * 当前版本恒为 "youshou"；仍然显式接收而不是硬编码，是为了不在这个模块里悄悄嵌入
 * "调用方只可能是玩家"这条假设——万一未来真有别的生物也能装备器官，这里不需要改。
 *
 * **材质所有权（plan 明确点名的坑）**：`entry.livingMaterial`/`entry.geometry`
 * （modelLibrary.ts）是库级共享对象，同一物种的每个存活实例共用同一份 GPU 缓冲——
 * 但玩家（"youshou"）在本工程里永远只有一个实例，所以就地修改 library 材质"恰好"
 * 不会波及任何其它生物。即便如此，本模块的 油羽皮 tweak 仍然**克隆**一份材质、只改
 * 克隆体，绝不 mutate 共享原件——这是面向"这份契约本该由谁遵守"的防御性写法，不依赖
 * "反正当前只有一个实例"这个偶然事实（万一以后允许多幼兽/合作模式，这份契约就不会
 * 悄悄崩掉）。dispose() 负责把材质引用还原回调用方传入前的原值（可能是共享库材质，
 * 也可能是程序化模型自己的 MeshLambertMaterial——两者都不属于本模块，只清克隆体）。
 */

/** 挂件构建结果：objects 供调用方统一 dispose；dispose 是材质克隆等"不只是几何体"的额外清理。 */
export interface OrganVisualBuild {
  objects: THREE.Object3D[];
  dispose?: () => void;
}

type OrganVisualBuilder = (model: CreatureModel, species: string) => OrganVisualBuild;

/** 器官槎位 → 玩家可见中文名（器官面板/揭示卡共用同一份映射，唯一数据源）。 */
export const SLOT_LABELS: Record<OrganSlot | "innate", string> = {
  jaw: "颌",
  limbs: "肢",
  back: "脊背",
  skin: "皮膜",
  tail: "尾",
  sense: "窍",
  innate: "本命",
};

/** 器官面板固定展示顺序：六个可替换槎位 + 本命，逐一对应 SLOT_LABELS 的键。 */
export const ORGAN_PANEL_SLOTS: (OrganSlot | "innate")[] = ["jaw", "limbs", "back", "skin", "tail", "sense", "innate"];

const NO_OUTLINE_MATERIAL = (color: number, opts: { emissive?: number; emissiveIntensity?: number } = {}): THREE.MeshLambertMaterial => {
  const material = new THREE.MeshLambertMaterial({ color });
  if (opts.emissive !== undefined) {
    material.emissive = new THREE.Color(opts.emissive);
    material.emissiveIntensity = opts.emissiveIntensity ?? 1;
  }
  return material;
};

/** 找到 model.parts.body 实际对应的 THREE.Mesh——procedural 家族本身就是 Mesh；GLB 家族是包着一个 Mesh 的 pivot Group（见 buildGlbCreatureModel）。 */
function ensureBodyMesh(model: CreatureModel): THREE.Mesh | null {
  const body = model.parts.body;
  if (body instanceof THREE.Mesh) return body;
  for (const child of body.children) {
    if (child instanceof THREE.Mesh) return child;
  }
  return null;
}

/** 躯干竖直中心高度（group-space）——见文件头"挂点策略"注释第 2 点，procedural/GLB 两个家族天然同义。 */
function torsoY(model: CreatureModel): number {
  return model.parts.body.position.y;
}

/**
 * back 槎位缺失时（procedural youshou 无 back mount，见 creatureModels.ts buildYoushouModel
 * 的 mounts）就地合成一个——位置与 buildTanshouModel 自己的 backMount（BODY_Y+0.5,0,0）
 * 同一量级，用躯干中心高度而不是硬编码的 species 专属常量。
 *
 * code-review 修正（资源泄漏）：合成出的 anchor 必须写回 `model.mounts.back`——否则每次
 * organSignature 变化触发 dispose()+重建（applyOrganVisuals 只清理它自己 objects 数组里
 * 的挂件，从不知道也不该知道 anchor 本身的存在），这里都会重新 `new THREE.Group()` 并
 * `model.group.add()` 一个全新实例，而上一个从未被任何人摘掉——每次蜕变都会在场景图里
 * 多挂一个再也没人引用、找不到、清不掉的空 Group。写回 mounts 后与 head/tail 两个"模型
 * 创建时就有、终身不变"的 mount 同一生命周期语义：整个模型实例存续期间只创建一次。
 */
function resolveBackAnchor(model: CreatureModel): THREE.Object3D {
  if (model.mounts.back) return model.mounts.back;
  const anchor = new THREE.Group();
  anchor.position.set(0, torsoY(model) + 0.35, 0);
  model.group.add(anchor);
  model.mounts.back = anchor;
  return anchor;
}

/** 沿 Z 轴等距分布 count 个点，跨度 span，居中于 0。count===1 时退化为单点 [0]。 */
function spreadAlongZ(count: number, span: number): number[] {
  if (count <= 1) return [0];
  const step = span / (count - 1);
  return Array.from({ length: count }, (_, i) => -span / 2 + i * step);
}

function addChild(parent: THREE.Object3D, mesh: THREE.Object3D, x: number, y: number, z: number): void {
  mesh.position.set(x, y, z);
  parent.add(mesh);
}

// ---------------------------------------------------------------------------
// 12 个可替换器官的挂件 builder（ORGANS 表同一顺序分组，PALETTE.organ* 同一顺序分组）
// ---------------------------------------------------------------------------

/** 裂颌·獠牙锥×2——headMount 下颌两侧，朝下前方。 */
function buildLiehe(model: CreatureModel): OrganVisualBuild {
  const head = model.mounts.head;
  if (!head) return { objects: [] };
  const objects: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const fang = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.16, 8), NO_OUTLINE_MATERIAL(PALETTE.organFang));
    fang.rotation.x = Math.PI; // 尖端朝下
    addChild(head, fang, side * 0.1, -0.16, 0.18);
    objects.push(fang);
  }
  return { objects };
}

/**
 * 滤颚·滤颚片×3——plan 的 B5 可视化清单没有列出这一件（12 个可替换器官里唯一缺席的
 * 一个，见文件头注释/task report 里对这处偏差的说明），但滤颚是真实可装备的器官——
 * 装备后毫无可视反馈会读作"这件东西是不是没生效"的 bug，故补一个低成本、克制的
 * 视觉：headMount 两侧三片薄梳状滤片，呼应"颚滤如网"的志怪词条。
 */
function buildLve(model: CreatureModel): OrganVisualBuild {
  const head = model.mounts.head;
  if (!head) return { objects: [] };
  const objects: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 0.03), NO_OUTLINE_MATERIAL(PALETTE.organFilter));
      addChild(head, slat, side * 0.14, -0.08 - i * 0.05, 0.08);
      objects.push(slat);
    }
  }
  return { objects };
}

/** 疾足·腕环×4——躯干左右前后四处，读作"轻盈迅捷"的暖光环。 */
function buildJizu(model: CreatureModel, species: string): OrganVisualBuild {
  const length = bodyFootprintLength(species);
  const halfWidth = length * 0.22;
  const y = torsoY(model) * 0.5;
  const objects: THREE.Object3D[] = [];
  for (const z of [length * 0.22, -length * 0.22]) {
    for (const x of [-halfWidth, halfWidth]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.025, 8, 16), NO_OUTLINE_MATERIAL(PALETTE.organLimbRing));
      ring.rotation.x = Math.PI / 2;
      addChild(model.group, ring, x, y, z);
      objects.push(ring);
    }
  }
  return { objects };
}

/** 掘爪·爪锥×1——前下方单枚大爪，呼应"爪利如凿"。 */
function buildJuezhua(model: CreatureModel, species: string): OrganVisualBuild {
  const length = bodyFootprintLength(species);
  const claw = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.28, 8), NO_OUTLINE_MATERIAL(PALETTE.organClaw));
  claw.rotation.x = Math.PI / 2.4;
  addChild(model.group, claw, 0, torsoY(model) * 0.35, length * 0.32);
  return { objects: [claw] };
}

/** 鳞甲·背瓦×5——backAnchor 沿身长方向叠瓦分布。 */
function buildLinjia(model: CreatureModel, species: string): OrganVisualBuild {
  const anchor = resolveBackAnchor(model);
  const length = bodyFootprintLength(species);
  const objects: THREE.Object3D[] = [];
  for (const z of spreadAlongZ(5, length * 0.5)) {
    const tile = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.14), NO_OUTLINE_MATERIAL(PALETTE.organScale));
    addChild(anchor, tile, 0, 0.03, z);
    objects.push(tile);
  }
  return { objects };
}

/** 棘背·背棘锥×3——backAnchor 沿身长方向三枚尖锥，比鳞甲更少但更高，读作"刺"。 */
function buildJibei(model: CreatureModel, species: string): OrganVisualBuild {
  const anchor = resolveBackAnchor(model);
  const length = bodyFootprintLength(species);
  const objects: THREE.Object3D[] = [];
  for (const z of spreadAlongZ(3, length * 0.35)) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 8), NO_OUTLINE_MATERIAL(PALETTE.organSpike));
    addChild(anchor, spike, 0, 0.1, z);
    objects.push(spike);
  }
  return { objects };
}

const GLOSS_EMISSIVE_INTENSITY = 0.35;

/**
 * 油羽皮·材质光泽 tweak——不新增任何几何体，克隆 body 材质并调高 emissive 制造"入水
 * 不濡"的水光质感（MeshLambertMaterial 与 MeshStandardMaterial 都支持 emissive/
 * emissiveIntensity，两个家族同一套 tweak，见文件头"材质所有权"注释）。
 */
function buildYouyupi(model: CreatureModel): OrganVisualBuild {
  const mesh = ensureBodyMesh(model);
  if (!mesh) return { objects: [] };
  const original = mesh.material;
  // 防御性：本工程从未给 body 用多材质数组，也从未用过既不是 Lambert 也不是 Standard
  // 的材质类型（procedural 家族=MeshLambertMaterial，GLB 家族=entry.livingMaterial 的
  // MeshStandardMaterial，见 modelLibrary.ts）——两个 instanceof 分支穷尽了本工程实际
  // 会遇到的全部情形，emissive/emissiveIntensity 在这两个具体类型上都是真实存在的字段
  // （泛型 `Material` 基类没有，这也是需要 instanceof 缩窄而不能直接操作 `original`
  // 本身的原因）。
  if (Array.isArray(original)) return { objects: [] };
  if (!(original instanceof THREE.MeshLambertMaterial) && !(original instanceof THREE.MeshStandardMaterial)) {
    return { objects: [] };
  }
  const clone = original.clone();
  clone.emissive = new THREE.Color(PALETTE.organGloss);
  clone.emissiveIntensity = GLOSS_EMISSIVE_INTENSITY;
  mesh.material = clone;
  return {
    objects: [],
    dispose: () => {
      mesh.material = original; // 还原调用方传入前的引用（可能是共享库材质，也可能是程序化模型自己的材质）
      clone.dispose();
    },
  };
}

/** 苔纹皮·绿斑片×4——直接贴在 group 上、躯干高度附近散布，呼应"隐于草莱"。 */
function buildTaiwenpi(model: CreatureModel, species: string): OrganVisualBuild {
  const length = bodyFootprintLength(species);
  const y = torsoY(model);
  const offsets: [number, number, number][] = [
    [length * 0.14, y * 1.1, length * 0.15],
    [-length * 0.14, y * 1.1, -length * 0.05],
    [length * 0.1, y * 0.8, -length * 0.22],
    [-length * 0.1, y * 0.8, length * 0.28],
  ];
  const objects: THREE.Object3D[] = [];
  for (const [x, yy, z] of offsets) {
    const patch = new THREE.Mesh(new THREE.CircleGeometry(0.07, 8), NO_OUTLINE_MATERIAL(PALETTE.organMossPatch));
    patch.rotation.x = -Math.PI / 2;
    addChild(model.group, patch, x, yy + 0.01, z);
    objects.push(patch);
  }
  return { objects };
}

/** 鳍尾·鳍片×1——tailMount 末端一片薄鳍，呼应"破浪疾行"。 */
function buildQiwei(model: CreatureModel): OrganVisualBuild {
  const tail = model.mounts.tail;
  if (!tail) return { objects: [] };
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.2), NO_OUTLINE_MATERIAL(PALETTE.organFin));
  addChild(tail, fin, 0, 0.05, -0.15);
  return { objects: [fin] };
}

/** 平衡尾·端球×1——tailMount 末端一枚小球，呼应"尾能自衡"。 */
function buildPinghengwei(model: CreatureModel): OrganVisualBuild {
  const tail = model.mounts.tail;
  if (!tail) return { objects: [] };
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), NO_OUTLINE_MATERIAL(PALETTE.organTailOrb));
  addChild(tail, orb, 0, 0, -0.22);
  return { objects: [orb] };
}

/** 夜瞳·发光眼点×2——headMount 两侧，MeshBasicMaterial 自发光（不受场景光照影响，"视幽如昼"的读法）。 */
function buildYetong(model: CreatureModel): OrganVisualBuild {
  const head = model.mounts.head;
  if (!head) return { objects: [] };
  const objects: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 8, 6),
      new THREE.MeshBasicMaterial({ color: PALETTE.organEyeGlow }),
    );
    addChild(head, eye, side * 0.12, 0.02, 0.2);
    objects.push(eye);
  }
  return { objects };
}

const NOSE_GLOW_OPACITY = 0.9;

/** 灵嗅·鼻光点×1——headMount 正前方，同 夜瞳 一样用 MeshBasicMaterial 自发光。 */
function buildLingxiu(model: CreatureModel): OrganVisualBuild {
  const head = model.mounts.head;
  if (!head) return { objects: [] };
  const nose = new THREE.Mesh(
    new THREE.SphereGeometry(0.04, 8, 6),
    new THREE.MeshBasicMaterial({ color: PALETTE.organNoseGlow, opacity: NOSE_GLOW_OPACITY, transparent: true }),
  );
  addChild(head, nose, 0, -0.05, 0.26);
  return { objects: [nose] };
}

/** organId → builder。神种(shenzhong) 不在这张表里——"无可视化"是刻意的空缺，不是遗漏（见 applyOrganVisuals 的过滤逻辑）。 */
const ORGAN_VISUAL_BUILDERS: Record<string, OrganVisualBuilder> = {
  liehe: buildLiehe,
  lve: buildLve,
  jizu: buildJizu,
  juezhua: buildJuezhua,
  linjia: buildLinjia,
  jibei: buildJibei,
  youyupi: buildYouyupi,
  taiwenpi: buildTaiwenpi,
  qiwei: buildQiwei,
  pinghengwei: buildPinghengwei,
  yetong: buildYetong,
  lingxiu: buildLingxiu,
};

/** 逐 Mesh 释放几何体/材质——供 dispose() 清理本模块自己创建的挂件（不碰 model.group 原有的任何东西）。 */
function disposeVisualTree(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      const material = obj.material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material.dispose();
    }
  });
}

export interface OrganVisualHandle {
  dispose(): void;
}

/**
 * 主入口（creatureView.ts 在检测到玩家 state.organs 的 organId 集合变化时整体重建调用，
 * 见该文件 organSignature 的 dirty-check 注释）：遍历当前已装备的每个槎位，按 organId
 * 查表构建挂件，未登记的 organId（目前只有 "shenzhong"）直接跳过——无可视化是刻意的。
 */
export function applyOrganVisuals(model: CreatureModel, species: string, organs: GameState["organs"]): OrganVisualHandle {
  const objects: THREE.Object3D[] = [];
  const disposers: (() => void)[] = [];

  for (const equipped of Object.values(organs)) {
    if (!equipped) continue;
    const builder = ORGAN_VISUAL_BUILDERS[equipped.organId];
    if (!builder) continue; // shenzhong（本命）及任何未登记的 organId：无可视化
    const built = builder(model, species);
    objects.push(...built.objects);
    if (built.dispose) disposers.push(built.dispose);
  }

  return {
    dispose(): void {
      for (const obj of objects) {
        obj.parent?.remove(obj);
        disposeVisualTree(obj);
      }
      for (const d of disposers) d();
    },
  };
}
