import { TUNING } from "@shiling/content";
import { DT } from "./sim.js";
import { dist2d } from "./vec.js";
import type { Creature, GameState, PlayerInput } from "./state.js";
import type { DigSpot, Terrain } from "./terrain.js";

/** 入洞：位置钉在洞口、切 burrow locomotion、复位挖掘进度。 */
function enterBurrow(p: Creature, spot: DigSpot): void {
  p.pos = { ...spot.pos };
  p.burrowId = spot.id;
  p.locomotion = "burrow";
  p.activity = "idle";
  p.digProgress = 0;
}

/** 出洞：恢复 walk，按当前（洞口）位置贴地。 */
function exitBurrow(p: Creature, terrain: Terrain): void {
  p.burrowId = null;
  p.locomotion = "walk";
  p.activity = "idle";
  p.pos.y = terrain.heightAt(p.pos.x, p.pos.z);
}

/**
 * 玩家专属系统（M0 NPC 不挖洞），在 movePlayer 之后、tickNeeds 之前执行：
 * - 未挖开的 dig spot 附近（dist2d <= interactRange）按住 interact → activity="digging"，
 *   digProgress 按 DT 累积；达到 digDurationSec → spot.dug=true 并自动入洞。
 * - 已挖开的洞口按 interact（松开后再按的上升沿）→ 入洞；洞中按 interact（同样上升沿）→ 出洞。
 *   interactHeld 记录上一 tick 的 interact 状态，保证一次按键只触发一次进/出洞，不会
 *   在同一次按住里"进洞又出洞"。
 * - 移动输入（moveX/moveZ 非零）取消挖掘：digProgress 归零，且不在同一 tick 处理进/出洞
 *   （moveCreature 对 burrowId !== null 已 early-return，移动本身也不会真的移动玩家）。
 */
export function tickDigging(state: GameState, terrain: Terrain, input: PlayerInput): void {
  const p = state.creatures.find((c) => c.id === state.playerId);
  if (!p || p.activity === "dead") return;

  const moving = input.moveX !== 0 || input.moveZ !== 0;

  if (moving) {
    if (p.burrowId === null) {
      p.digProgress = 0;
      if (p.activity === "digging") p.activity = "idle";
    }
    p.interactHeld = input.interact;
    return;
  }

  if (p.burrowId !== null) {
    if (input.interact && !p.interactHeld) exitBurrow(p, terrain);
    p.interactHeld = input.interact;
    return;
  }

  const spot = terrain.digSpots.find((s) => dist2d(p.pos, s.pos) <= TUNING.interactRange);
  if (!spot) {
    if (p.activity === "digging") { p.activity = "idle"; p.digProgress = 0; }
    p.interactHeld = input.interact;
    return;
  }

  if (!spot.dug) {
    if (input.interact) {
      p.activity = "digging";
      p.digProgress += DT;
      if (p.digProgress >= TUNING.digDurationSec) {
        spot.dug = true;
        enterBurrow(p, spot);
      }
    } else if (p.activity === "digging") {
      p.activity = "idle";
    }
  } else if (input.interact && !p.interactHeld) {
    enterBurrow(p, spot);
  }

  p.interactHeld = input.interact;
}
