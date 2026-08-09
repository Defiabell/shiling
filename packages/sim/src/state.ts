import type { EssenceType } from "@shiling/content";
import type { Vec3 } from "./vec.js";

export type Locomotion = "walk" | "swim" | "burrow";
export type Activity = "idle" | "moving" | "eating" | "drinking" | "digging" | "attacking" | "dead";

export interface Needs {
  hunger: number;
  thirst: number;
  fatigue: number;
}

export interface Creature {
  id: number;
  species: string;
  pos: Vec3;
  yaw: number;
  hp: number;
  needs: Needs;
  locomotion: Locomotion;
  activity: Activity;
  aiState: string;
  targetId: number | null;
  attackCooldown: number;
  feedingCarcassId: number | null;
  burrowId: number | null;
  satiatedTimer: number;
  digProgress: number;
  interactHeld: boolean;
  aiDirX: number;
  aiDirZ: number;
  aiTimer: number;
  /**
   * lingshu 专属逃跑耐力（M0.5 postfix-3）：连续处于 aiState==="flee" 的累计秒数，
   * 超过 TUNING.fleeFatigueThresholdSec 后 doFlee 按 fleeFatigueSpeedMult 减速——
   * 给玩家"追一段就能追上"的正反馈。非 lingshu 生物永远保持 0，不参与任何逻辑。
   */
  fleeTime: number;
  /**
   * 与 fleeTime 配对：连续处于非 flee 状态的累计秒数，达到 TUNING.fleeRecoverSec
   * 后才把 fleeTime 清零（完全恢复）。中途重新进入 flee 会把这个计时器清零，但
   * fleeTime 本身不重置——短时间内反复受惊的疲态是累加的，不是每次都从头计。
   */
  fleeRecoverTime: number;
  /**
   * 叼运（M1 postfix N1，玩家专属，见 carrying.ts）：正叼着的 Carcass id，null=未叼。
   * 通用字段挂在 Creature 上（而不是单开一个只有玩家用的旁路结构）是刻意的——
   * feedingCarcassId 已经是同一种"全体生物共享字段、目前只有部分角色实际使用"的
   * 先例（潭狩 feed 也用它），沿用同一惯例，不为玩家专属状态另起一套存储方式。
   */
  carryingCarcassId: number | null;
  /**
   * C 键（叼运）的边沿检测——镜像 interactHeld 的写法（见 digging.ts 顶部注释）：
   * 记录上一 tick 的 input.carry，保证一次按键只触发一次叼起/放下，长按不会在
   * 同一次按住里反复切换。
   */
  carryHeld: boolean;
  /**
   * 筑巢进度（M1 postfix N1，玩家专属，见 digging.ts 的 burrow 分支）：在一个已挖开、
   * 玩家占据的洞穴里持续按住 E 达到 TUNING.nestBuildSec 秒后转为玩家的家（见
   * GameState.homeNest）。累积方式与 digProgress 同构（可打断、松开即清零），但
   * 挂在洞穴场景而非挖点场景，故另开一个字段而不是复用 digProgress。
   */
  nestProgress: number;
}

export interface Carcass {
  id: number;
  species: string;
  pos: Vec3;
  meat: number;
}

export interface PlayerInput {
  moveX: number;
  moveZ: number;
  sprint: boolean;
  /**
   * E 键（挖掘/进食/饮水/出洞——所有"情境类"交互，见 digging.ts/eating.ts/needs.ts）。
   * 键位拆分（W2）之前这个字段还兼管"撕咬"，现在撕咬已独立到下面的 `attack`。
   */
  interact: boolean;
  /**
   * 左键（撕咬），键位拆分（W2，playtest feedback「单一 E 键在重叠时无法选择操作」）
   * 新增字段：与 `interact` 完全独立——同一 tick 两者可以同时为 true 也可以只有其一，
   * eating.ts 把攻击与进食判定拆成两条互不阻塞的分支，各自只看自己对应的这个字段。
   */
  attack: boolean;
  /**
   * C 键（叼运，M1 postfix N1）：拾起/放下附近的尸体——单一按住布尔量，sim 侧
   * （carrying.ts）自己做边沿检测（见 Creature.carryHeld），与 interact/attack
   * 完全独立的第三个"情境交互"字段。
   */
  carry: boolean;
}

export interface GameState {
  tick: number;
  playerId: number;
  nextId: number; // 单调递增的下一个可用 id，不随生物/尸体移除而回收
  creatures: Creature[];
  carcasses: Carcass[];
  playerDead: boolean;
  /**
   * 玩家的家（M1 postfix N1，见 digging.ts 的筑巢分支）：null=尚未筑巢。只有唯一
   * 一个——在别处重新筑巢会把 homeNest 整体挪过去（见 buildHomeNest），不是数组，
   * 因为 M1 的设计就是"单一巢穴"，不支持多巢共存。
   */
  homeNest: { spotId: number; stash: number } | null;
  /**
   * 昼夜时钟（M1 B1）：[0,1) 环绕，0=黎明；每 tick 由 sim.ts 的 step() 累加
   * DT/TUNING.dayLengthSec 并取模。玩家全局字段（不挂在任何单个生物上），createSim
   * 里给 0.3（=上午）作初值——纯展示/氛围用途（B5 昼夜光照消费），sim 侧目前不做任何
   * 玩法判定。
   */
  timeOfDay: number;
  /**
   * 玩家精气（M1 B1）：四种类型各自 0..TUNING.essenceCap，createSim 里全 0 初始化。
   * 玩家全局字段，不是逐生物属性——精气是"这个人吃了什么"的累积记忆，不依附于某只
   * 具体生物实例。essence.ts 的 gainEssence 是唯一写入点（鲜尸进食路径调用，见该文件
   * 头注——巢中吃储粮不触发，精气随死亡消散是刻意的设计权衡）。B3 蛰伏开奖消费。
   */
  essence: Record<EssenceType, number>;
  /**
   * 玩家行为统计（M1 B1）：累计计数，createSim 里全 0 初始化，从不清零/衰减——B3 蛰伏
   * 开奖用它们做"行为偏置"（游得多偏水系器官、挖得多偏土系器官……），是只增不减的
   * 终身履历，不是某个时间窗口内的滑动统计。各字段的累加点分散在对应系统里（swimSec 见
   * movement.ts、sprintSec 见 movement.ts、digCount 见 digging.ts、kills 见
   * eating.ts），每处都标了 "consumed by B3 roll" 注释。
   */
  behaviorStats: { swimSec: number; digCount: number; sprintSec: number; kills: number };
}
