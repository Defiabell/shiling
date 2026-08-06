import { SPECIES, TUNING } from "@shiling/content";
import { norm2d } from "./vec.js";
import { DT } from "./sim.js";
import type { Terrain } from "./terrain.js";
import type { Creature, GameState, PlayerInput } from "./state.js";

/** 通用运动学移动：走/游自动切换、贴地、边界 clamp。也供 AI 使用。 */
export function moveCreature(c: Creature, dirX: number, dirZ: number, sprint: boolean, terrain: Terrain): void {
  if (c.burrowId !== null || c.activity === "dead") return;
  const def = SPECIES[c.species]!;
  const { x: nx, z: nz } = norm2d(dirX, dirZ);
  if (nx === 0 && nz === 0) {
    if (c.activity === "moving") c.activity = "idle";
    // 静止时也要按当前位置同步 locomotion/贴地高度（例如站在水里不动仍应是 swim）。
    const stillInWater = terrain.isWater(c.pos.x, c.pos.z);
    c.locomotion = stillInWater ? "swim" : "walk";
    c.pos.y = stillInWater ? terrain.waterLevel : terrain.heightAt(c.pos.x, c.pos.z);
    return;
  }
  const inWater = terrain.isWater(c.pos.x, c.pos.z);
  let speed = inWater ? def.swimSpeed : def.walkSpeed;
  if (sprint && c.needs.fatigue > TUNING.minSprintFatigue) speed *= TUNING.sprintMultiplier;
  const half = terrain.size / 2;
  const tx = Math.max(-half, Math.min(half, c.pos.x + nx * speed * DT));
  const tz = Math.max(-half, Math.min(half, c.pos.z + nz * speed * DT));
  if (!def.canSwim && terrain.isWater(tx, tz)) {
    // 旱鸭子挡在水边：位置不变，但仍要按当前（未位移）位置同步 locomotion/pos.y，
    // 并把 activity 从 "moving" 回落 "idle"（不动就不该停留在 moving 状态）。
    if (c.activity === "moving") c.activity = "idle";
    c.locomotion = inWater ? "swim" : "walk";
    c.pos.y = inWater ? terrain.waterLevel : terrain.heightAt(c.pos.x, c.pos.z);
    return;
  }
  c.pos.x = tx; c.pos.z = tz;
  const nowWater = terrain.isWater(tx, tz);
  c.locomotion = nowWater ? "swim" : "walk";
  c.pos.y = nowWater ? terrain.waterLevel : terrain.heightAt(tx, tz);
  c.yaw = Math.atan2(nx, nz);
  c.activity = "moving";
}

export function movePlayer(state: GameState, terrain: Terrain, input: PlayerInput): void {
  const p = state.creatures.find((c) => c.id === state.playerId);
  if (!p || p.activity === "dead") return;
  moveCreature(p, input.moveX, input.moveZ, input.sprint, terrain);
  if (input.sprint && (input.moveX !== 0 || input.moveZ !== 0) && p.needs.fatigue > TUNING.minSprintFatigue) {
    p.needs.fatigue = Math.max(0, p.needs.fatigue - TUNING.fatigueSprintPerSec * DT);
  }
}
