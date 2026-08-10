import { describe, expect, it } from "vitest";
import { createSimEventDiffer } from "../src/render/simEvents.js";
import type { GameState, Creature } from "@shiling/sim";

function mkCreature(over: Partial<Creature>): Creature {
  return { id: 1, species: "lingshu", pos: { x: 0, y: 0, z: 0 }, yaw: 0, hp: 25,
    needs: { hunger: 80, thirst: 80, fatigue: 100 }, locomotion: "walk", activity: "idle",
    aiState: "wander", targetId: null, attackCooldown: 0, feedingCarcassId: null,
    burrowId: null, satiatedTimer: 0, digProgress: 0, interactHeld: false,
    aiDirX: 0, aiDirZ: 1, aiTimer: 0, fleeTime: 0, fleeRecoverTime: 0,
    carryingCarcassId: null, carryHeld: false, nestProgress: 0, dormantHeld: false, hiddenTicks: 0,
    pitDigProgress: 0, snaredTicks: 0,
    ...over };
}
function mkState(over: Partial<GameState>): GameState {
  return {
    tick: 0, playerId: 99, creatures: [], carcasses: [], playerDead: false, nextId: 100, homeNest: null,
    timeOfDay: 0.3, essence: { zu: 0, lin: 0, xue: 0, meng: 0 }, behaviorStats: { swimSec: 0, digCount: 0, sprintSec: 0, kills: 0 },
    // M1 B2：organs/hitsTaken/organsPrevCounters 是新增的 GameState 字段，client 侧
    // 目前没有任何消费（B5 才会读 organs 做可视化），这里只补齐类型契约的最小占位值。
    organs: {}, hitsTaken: 0, organsPrevCounters: { digCount: 0, kills: 0, hitsTaken: 0 },
    // M1 B3：dormancy/lastEvolution 同理——client 侧目前无消费，占位值即可。
    dormancy: null, lastEvolution: null,
    // M15 P1：pits/adrenaline* 同理——占位值即可，本文件测试逐条 spread 覆盖需要的字段。
    pits: [], adrenalineTicks: 0, adrenalineCooldown: 0, adrenalineArmed: true,
    ...over,
  };
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
  // M1 B6：hiddenTicks 0→>0（穴獾遁地隐匿开始）emits vanish once.
  it("hiddenTicks 0→>0 emits vanish", () => {
    const diff = createSimEventDiffer();
    const a = mkState({ creatures: [mkCreature({ id: 1, species: "xuehuan", hiddenTicks: 0 })] });
    const b = mkState({ creatures: [mkCreature({ id: 1, species: "xuehuan", hiddenTicks: 80 })] });
    expect(diff(a, b, 0.05)).toContainEqual(expect.objectContaining({ kind: "vanish", id: 1 }));
    expect(diff(b, b, 0.05)).toEqual([]); // 持续隐匿中不重复触发
  });
  it("hiddenTicks counting down to 0 (reappear) does not emit vanish", () => {
    const diff = createSimEventDiffer();
    const a = mkState({ creatures: [mkCreature({ id: 1, species: "xuehuan", hiddenTicks: 1 })] });
    const b = mkState({ creatures: [mkCreature({ id: 1, species: "xuehuan", hiddenTicks: 0 })] });
    expect(diff(a, b, 0.05).some((e) => e.kind === "vanish")).toBe(false);
  });

  // M15 P1（反制包）：陷坑触发——snaredTicks 0→>0（潭狩踩中陷坑那一瞬间），与
  // hiddenTicks 的边沿写法完全同构。
  it("snaredTicks 0→>0 emits pitSnare once", () => {
    const diff = createSimEventDiffer();
    const a = mkState({ creatures: [mkCreature({ id: 1, species: "tanshou", snaredTicks: 0 })] });
    const b = mkState({ creatures: [mkCreature({ id: 1, species: "tanshou", snaredTicks: 60 })] });
    expect(diff(a, b, 0.05)).toContainEqual(expect.objectContaining({ kind: "pitSnare", id: 1 }));
    expect(diff(b, b, 0.05)).toEqual([]); // 持续定身中不重复触发
  });

  it("snaredTicks counting down to 0 (freed) does not emit pitSnare", () => {
    const diff = createSimEventDiffer();
    const a = mkState({ creatures: [mkCreature({ id: 1, species: "tanshou", snaredTicks: 1 })] });
    const b = mkState({ creatures: [mkCreature({ id: 1, species: "tanshou", snaredTicks: 0 })] });
    expect(diff(a, b, 0.05).some((e) => e.kind === "pitSnare")).toBe(false);
  });

  // M15 P1：濒死爆发——GameState 顶层字段 adrenalineTicks 0→>0，不挂在任何 Creature 上。
  // 事件的 pos 取自玩家当前位置（见 simEvents.ts 的 currPlayer 判据），因此 state.creatures
  // 里必须真的有玩家这个 id 对应的 creature（与 digTick/drink/burrowToggle 三个既有的
  // "玩家专属"事件同一前提）。
  it("adrenalineTicks 0→>0 emits adrenaline once", () => {
    const diff = createSimEventDiffer();
    const player = mkCreature({ id: 99, species: "youshou" });
    const a = mkState({ creatures: [player], adrenalineTicks: 0 });
    const b = mkState({ creatures: [player], adrenalineTicks: 80 });
    expect(diff(a, b, 0.05)).toContainEqual(expect.objectContaining({ kind: "adrenaline" }));
    expect(diff(b, b, 0.05).some((e) => e.kind === "adrenaline")).toBe(false); // 窗口持续中不重复触发
  });

  it("adrenalineTicks counting down to 0 (window ends) does not emit adrenaline", () => {
    const diff = createSimEventDiffer();
    const player = mkCreature({ id: 99, species: "youshou" });
    const a = mkState({ creatures: [player], adrenalineTicks: 1 });
    const b = mkState({ creatures: [player], adrenalineTicks: 0 });
    expect(diff(a, b, 0.05).some((e) => e.kind === "adrenaline")).toBe(false);
  });
});
