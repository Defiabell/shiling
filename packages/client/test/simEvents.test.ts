import { describe, expect, it } from "vitest";
import { createSimEventDiffer } from "../src/render/simEvents.js";
import type { GameState, Creature } from "@shiling/sim";

function mkCreature(over: Partial<Creature>): Creature {
  return { id: 1, species: "lingshu", pos: { x: 0, y: 0, z: 0 }, yaw: 0, hp: 25,
    needs: { hunger: 80, thirst: 80, fatigue: 100 }, locomotion: "walk", activity: "idle",
    aiState: "wander", targetId: null, attackCooldown: 0, feedingCarcassId: null,
    burrowId: null, satiatedTimer: 0, digProgress: 0, interactHeld: false,
    aiDirX: 0, aiDirZ: 1, aiTimer: 0, ...over };
}
function mkState(over: Partial<GameState>): GameState {
  return { tick: 0, playerId: 99, creatures: [], carcasses: [], playerDead: false, nextId: 100, ...over };
}

describe("createSimEventDiffer", () => {
  it("first frame emits nothing", () => {
    const diff = createSimEventDiffer();
    expect(diff(null, mkState({}), 0.05)).toEqual([]);
  });
  it("hp drop emits hit; disappearance emits death", () => {
    const diff = createSimEventDiffer();
    const a = mkState({ creatures: [mkCreature({ id: 1, hp: 25 }), mkCreature({ id: 2 })] });
    const b = mkState({ creatures: [mkCreature({ id: 1, hp: 13 })] });
    const events = diff(a, b, 0.05);
    expect(events).toContainEqual(expect.objectContaining({ kind: "hit", id: 1, lethal: false }));
    expect(events).toContainEqual(expect.objectContaining({ kind: "death", id: 2 }));
  });
  it("walk→swim emits splash once", () => {
    const diff = createSimEventDiffer();
    const a = mkState({ creatures: [mkCreature({ id: 1, locomotion: "walk" })] });
    const b = mkState({ creatures: [mkCreature({ id: 1, locomotion: "swim" })] });
    expect(diff(a, b, 0.05)).toContainEqual(expect.objectContaining({ kind: "splash", id: 1 }));
    expect(diff(b, b, 0.05)).toEqual([]);   // 持续游泳不重复
  });
  it("digging throttles to ~0.4s cadence", () => {
    const diff = createSimEventDiffer();
    const digging = mkState({ playerId: 1, creatures: [mkCreature({ id: 1, activity: "digging" })] });
    let count = 0;
    let prev: GameState | null = null;
    for (let i = 0; i < 20; i++) { count += diff(prev, digging, 0.05).filter(e => e.kind === "digTick").length; prev = digging; }
    expect(count).toBeGreaterThanOrEqual(2);
    expect(count).toBeLessThanOrEqual(3);   // 1s / 0.4s ≈ 2.5
  });
  it("carcass eaten away emits carcassGone", () => {
    const diff = createSimEventDiffer();
    const a = mkState({ carcasses: [{ id: 7, species: "lingshu", pos: { x: 1, y: 0, z: 1 }, meat: 2 }] });
    const b = mkState({});
    expect(diff(a, b, 0.05)).toContainEqual(expect.objectContaining({ kind: "carcassGone", id: 7 }));
  });
});
