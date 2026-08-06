import { SPECIES, TUNING } from "@shiling/content";
import { DT } from "./sim.js";
import type { Terrain } from "./terrain.js";
import type { Creature, GameState, PlayerInput } from "./state.js";

function clamp01to100(v: number): number {
  return v < 0 ? 0 : v > 100 ? 100 : v;
}

/** 供 ai/eating 复用：置 dead、生成 Carcass（meat = def.meat）、从 creatures 移除（玩家除外：只标记 playerDead）。 */
export function killCreature(state: GameState, c: Creature): void {
  if (c.activity === "dead") return;
  c.activity = "dead"; c.hp = 0;
  const def = SPECIES[c.species]!;
  state.carcasses.push({ id: c.id, species: c.species, pos: { ...c.pos }, meat: def.meat });
  if (c.id === state.playerId) { state.playerDead = true; return; }
  state.creatures = state.creatures.filter((x) => x.id !== c.id);
}

/** 身前 8 方向采样 interactRange 距离的点，命中任一水点即视为"在水边"。 */
function nearWater(c: Creature, terrain: Terrain): boolean {
  if (terrain.isWater(c.pos.x, c.pos.z)) return true;
  const r = TUNING.interactRange;
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const sx = c.pos.x + Math.sin(angle) * r;
    const sz = c.pos.z + Math.cos(angle) * r;
    if (terrain.isWater(sx, sz)) return true;
  }
  return false;
}

function tickCreatureNeeds(c: Creature): void {
  if (c.activity === "dead") return;

  c.needs.hunger = clamp01to100(c.needs.hunger - TUNING.hungerDecayPerSec * DT);
  c.needs.thirst = clamp01to100(c.needs.thirst - TUNING.thirstDecayPerSec * DT);

  let fatigueRecoverPerSec: number;
  if (c.burrowId !== null) {
    fatigueRecoverPerSec = TUNING.burrowFatigueRecoverPerSec;
  } else if (c.activity === "moving") {
    fatigueRecoverPerSec = TUNING.fatigueWalkRecoverPerSec;
  } else {
    fatigueRecoverPerSec = TUNING.fatigueRecoverPerSec;
  }
  c.needs.fatigue = clamp01to100(c.needs.fatigue + fatigueRecoverPerSec * DT);
}

/** 所有活物统一结算：饥渴衰减、疲劳恢复、归零掉血、死亡转尸体。玩家在水边按 interact 饮水。 */
export function tickNeeds(state: GameState, terrain: Terrain, input: PlayerInput): void {
  const player = state.creatures.find((c) => c.id === state.playerId);

  for (const c of state.creatures) tickCreatureNeeds(c);

  if (player && player.activity !== "dead" && input.interact && player.activity !== "digging" && player.burrowId === null && nearWater(player, terrain)) {
    player.activity = "drinking";
    player.needs.thirst = clamp01to100(player.needs.thirst + TUNING.drinkPerSec * DT);
  }

  for (const c of state.creatures) {
    if (c.activity === "dead") continue;
    if (c.needs.hunger === 0 || c.needs.thirst === 0) {
      c.hp -= TUNING.starveHpPerSec * DT;
      if (c.hp <= 0) killCreature(state, c);
    }
  }
}
