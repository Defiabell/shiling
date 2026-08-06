import { QINGQIU_GRAYBOX, SPECIES, TUNING, type WorldParams } from "@shiling/content";
import { createRng, type Rng } from "./rng.js";
import { v3, type Vec3 } from "./vec.js";
import type { Creature, GameState, PlayerInput } from "./state.js";

export const DT = 1 / TUNING.tickHz;

/**
 * 最小结构化地形接口。Task 5 会在 terrain.ts 中定义真正的 Terrain 并接入
 * createTerrain；这里只声明当前用到的形状，便于 Task 5 无缝替换。
 */
export interface Terrain {
  heightAt(x: number, z: number): number;
  isWater(x: number, z: number): boolean;
  waterLevel: number;
  digSpots: Vec3[];
  size: number;
}

export interface Sim {
  state: GameState;
  terrain: Terrain; // Task 5 前为平地 stub
  step(input: PlayerInput): void;
}

/** Task 5 前的临时地形：全平地、无水、无挖点。Task 5 接入后删除。 */
export function flatTerrain(_seed: number, params: WorldParams): Terrain {
  return {
    heightAt: () => 0,
    isWater: () => false,
    waterLevel: params.waterLevel,
    digSpots: [],
    size: params.size,
  };
}

/** 在 params.size 范围内 rejection-sample，直到落在非水面位置。 */
export function randomLandPos(rng: Rng, terrain: Terrain, params: WorldParams): Vec3 {
  const half = params.size / 2;
  let x: number;
  let z: number;
  do {
    x = rng.range(-half, half);
    z = rng.range(-half, half);
  } while (terrain.isWater(x, z));
  return v3(x, terrain.heightAt(x, z), z);
}

let terrainFactory = flatTerrain; // Task 5 将替换为 createTerrain

/** 生成一只生物并加入 state.creatures，供 createSim 内部与测试使用。 */
export function spawnCreature(
  state: GameState,
  rng: Rng,
  terrain: Terrain,
  params: WorldParams,
  species: string,
): Creature {
  const def = SPECIES[species];
  if (!def) throw new Error(`unknown species: ${species}`);
  const pos = randomLandPos(rng, terrain, params);
  const c: Creature = {
    id: state.creatures.length + 1,
    species,
    pos,
    yaw: rng.range(0, Math.PI * 2),
    hp: def.maxHp,
    needs: { hunger: 80, thirst: 80, fatigue: 100 },
    locomotion: "walk",
    activity: "idle",
    aiState: "idle",
    targetId: null,
    attackCooldown: 0,
    feedingCarcassId: null,
    burrowId: null,
    satiatedTimer: 0,
    panicTimer: 0,
  };
  state.creatures.push(c);
  return c;
}

export function createSim(seed: number, params: WorldParams = QINGQIU_GRAYBOX): Sim {
  const rng = createRng(seed);
  const terrain = terrainFactory(seed, params);
  const state: GameState = { tick: 0, playerId: 0, creatures: [], carcasses: [], playerDead: false };

  state.playerId = spawnCreature(state, rng, terrain, params, "youshou").id;
  for (const s of params.spawns) {
    for (let i = 0; i < s.count; i++) spawnCreature(state, rng, terrain, params, s.species);
  }

  return {
    state,
    terrain,
    step(input: PlayerInput) {
      state.tick++;
      // 系统按序执行；后续任务逐个填入：
      // movePlayer(state, terrain, input);  (Task 6)
      // tickAi(state, terrain, rng);        (Task 8/9)
      // tickEating(state, input);           (Task 10)
      // tickNeeds(state, terrain, input);   (Task 7)
    },
  };
}

export function getPlayer(state: GameState): Creature {
  const player = state.creatures.find((c) => c.id === state.playerId);
  if (!player) throw new Error(`player not found: id=${state.playerId}`);
  return player;
}
