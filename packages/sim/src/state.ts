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
  panicTimer: number;
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
