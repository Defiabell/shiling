import type { EssenceType, OrganSlot } from "@shiling/content";
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
  /**
   * V 键（蛰伏蜕变，M1 B3，玩家专属，见 sim/src/dormancy.ts）边沿检测——镜像
   * carryHeld/interactHeld 的写法：记录上一 tick 的 input.dormant，保证一次按键只
   * 尝试触发一次蛰伏，长按不会在同一次按住里反复重试。蛰伏进行中（state.dormancy
   * !==null）本字段仍照常同步，只是 tickDormancy 那时走的是另一条分支，不再拿它
   * 判定"是否要触发"。
   */
  dormantHeld: boolean;
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
  /**
   * V 键（蛰伏蜕变，M1 B3）：在自己家巢洞内、精气与储粮都达标时的边沿触发键——
   * sim 侧只用它做边沿检测本身（见 Creature.dormantHeld），与 carry/interact 完全
   * 独立的第四个"情境交互"字段。蛰伏进行中这一字段不再触发第二次（tickDormancy 的
   * `state.dormancy !== null` 分支根本不读它做判定），持续按住不会有任何副作用。
   */
  dormant: boolean;
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
  /**
   * 玩家已装备的器官（M1 B2）：六个可替换槽（OrganSlot）＋一个不可替换的本命槽
   * ("innate")，Partial 因为可替换槽在开奖（B3）之前是空的。createSim 里只预装
   * innate: { organId: "shenzhong", temper: 50 }，其余槽初始不存在（不是空对象占位，
   * 是键根本不存在——sim/src/organs.ts 的 getModifiers/tickTemper 都用
   * `state.organs[slot]` 判空，undefined 与"槽存在但没装"是同一件事）。
   * 只有玩家有 organs（这是玩家专属的全局字段，不挂在任何 Creature 上，同 essence/
   * behaviorStats 的存储方式一致）——NPC 从不读写这个字段。
   */
  organs: Partial<Record<OrganSlot | "innate", { organId: string; temper: number }>>;
  /**
   * 玩家被直接命中的次数（M1 B2，sim/src/organs.ts 的 tickTemper 内部消费，不是跨批
   * 共享的数据模型字段）：目前唯一递增点是 ai.ts 的 tanshou resolveHunt 对玩家造成
   * 伤害那一行。饥渴归零掉血（needs.ts 的 starve 分支）刻意不计入——"挨打"和"饿死"是
   * 两种不同的伤害语义，只有前者才该磨砺 damageTakenMult 类护体器官（棘背/鳞甲）的
   * 淬炼度。不放进 behaviorStats（那 4 个字段是 B1 定的跨批契约，B3 的开奖权重会读，
   * 不应该为 B2 内部实现细节扩充它的形状）。
   */
  hitsTaken: number;
  /**
   * organs.ts 内部快照（M1 B2，非跨批共享接口）：tickTemper 用来判定"这一 tick 是否
   * 新触发了一次离散事件"（挖洞完成/击杀/被咬中）的边沿检测基准——镜像 carryHeld/
   * interactHeld 的边沿检测惯例，只是这里对比的是累计计数器而不是按键布尔量（这三个
   * 计数器只增不减，直接比较"当前值 > 上次记录值"即可判定"这一 tick 新发生了一次"）。
   * 每次 tickTemper 跑完都会把当前值写回，供下一 tick 比较。createSim 里全 0 初始化。
   */
  organsPrevCounters: { digCount: number; kills: number; hitsTaken: number };
  /**
   * 蛰伏蜕变进行中（M1 B3，见 sim/src/dormancy.ts）：null=未在蛰伏。ticksLeft 由
   * tryTriggerDormancy 设为 Math.round(TUNING.dormancySec*TUNING.tickHz)，之后
   * tickActiveDormancy 每 tick -1，归零触发 rollOrgan 并清回 null；储粮耗尽（燃料耗尽）
   * 时同样清回 null（中断，不开奖，精气保留——见 dormancy.ts 头部设计理由）。玩家专属
   * 全局字段（同 essence/organs 一样不挂在 Creature 上）——蛰伏是"这个人"的状态，不是
   * 某个生物实例的属性。
   */
  dormancy: null | { ticksLeft: number };
  /**
   * 最近一次开奖结果（M1 B3，client B5 的蜕变揭示卡消费）：null=从未开奖过。写入后不
   * 清除（"读后不清除，按 tick 判新"——plan 原话），下一次 rollOrgan 直接整体覆盖，不
   * 追加历史。replacedId 是被替换掉的旧器官 id（该槽此前为空则为 null）。
   */
  lastEvolution: { organId: string; slot: OrganSlot; replacedId: string | null; tick: number } | null;
}
