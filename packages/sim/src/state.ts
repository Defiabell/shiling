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
  interact: boolean;
}

export interface GameState {
  tick: number;
  playerId: number;
  nextId: number; // 单调递增的下一个可用 id，不随生物/尸体移除而回收
  creatures: Creature[];
  carcasses: Carcass[];
  playerDead: boolean;
}
