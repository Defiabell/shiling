import { QINGQIU_GRAYBOX, SPECIES, TUNING, type WorldParams } from "@shiling/content";
import { createRng, type Rng } from "./rng.js";
import { v3, type Vec3 } from "./vec.js";
import type { Creature, GameState, PlayerInput } from "./state.js";
import { createTerrain, type DigSpot, type Terrain } from "./terrain.js";
import { movePlayer } from "./movement.js";
import { tickDigging } from "./digging.js";
import { tickEating } from "./eating.js";
import { tickAi } from "./ai.js";
import { tickNeeds } from "./needs.js";

export const DT = 1 / TUNING.tickHz;

export type { DigSpot, Terrain };

export interface Sim {
  state: GameState;
  terrain: Terrain;
  step(input: PlayerInput): void;
}

const MAX_REJECTION_ATTEMPTS = 10_000;

/**
 * 在 params.size 范围内 rejection-sample，直到落在陆地且离水线有余量的位置
 * （h > waterLevel + 0.5；该条件已蕴含 !isWater，因为 isWater 等价于 h < waterLevel）。
 */
export function randomLandPos(rng: Rng, terrain: Terrain, params: WorldParams): Vec3 {
  const half = params.size / 2;
  for (let attempt = 0; attempt < MAX_REJECTION_ATTEMPTS; attempt++) {
    const x = rng.range(-half, half);
    const z = rng.range(-half, half);
    const h = terrain.heightAt(x, z);
    if (h > terrain.waterLevel + 0.5) return v3(x, h, z);
  }
  throw new Error("randomLandPos: no land position found after max attempts; check WorldParams");
}

const terrainFactory = createTerrain;

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
  // 初始朝向复用 yaw 的随机模式，另起一次采样给 aiDir（游走的初始方向）。
  const initAiAngle = rng.range(0, Math.PI * 2);
  const c: Creature = {
    id: state.nextId++,
    species,
    pos,
    yaw: rng.range(0, Math.PI * 2),
    hp: def.maxHp,
    needs: { hunger: 80, thirst: 80, fatigue: 100 },
    locomotion: "walk",
    activity: "idle",
    // 苓鼠 wander/graze/flee、潭狩 patrol/hunt/feed 已接线（Task 9/10）；玩家留 "idle" 待 Task 11。
    aiState: species === "lingshu" ? "wander" : species === "tanshou" ? "patrol" : "idle",
    targetId: null,
    attackCooldown: 0,
    feedingCarcassId: null,
    burrowId: null,
    satiatedTimer: 0,
    digProgress: 0,
    interactHeld: false,
    aiDirX: Math.sin(initAiAngle),
    aiDirZ: Math.cos(initAiAngle),
    aiTimer: TUNING.aiRepathSec,
  };
  state.creatures.push(c);
  return c;
}

export function createSim(seed: number, params: WorldParams = QINGQIU_GRAYBOX): Sim {
  const rng = createRng(seed);
  const terrain = terrainFactory(seed, params);
  const state: GameState = { tick: 0, playerId: 0, nextId: 1, creatures: [], carcasses: [], playerDead: false };

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
      movePlayer(state, terrain, input); // (Task 6)
      tickDigging(state, terrain, input); // (Task 8)
      tickEating(state, terrain, input); // (Task 11)
      tickAi(state, terrain, rng); // (Task 9)
      tickNeeds(state, terrain, input); // (Task 7)
    },
  };
}

export function getPlayer(state: GameState): Creature {
  const player = state.creatures.find((c) => c.id === state.playerId);
  if (!player) throw new Error(`player not found: id=${state.playerId}`);
  return player;
}
