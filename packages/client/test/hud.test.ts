import { describe, expect, it } from "vitest";
import type { Creature } from "@shiling/sim";
import { contextPrompt, type HudContext } from "../src/hud.js";

/** 最小可用 Creature 字面量——contextPrompt/statusLabel 只读 burrowId/activity/locomotion。 */
function mkPlayer(over: Partial<Creature> = {}): Creature {
  return {
    id: 1, species: "youshou", pos: { x: 0, y: 0, z: 0 }, yaw: 0, hp: 60,
    needs: { hunger: 80, thirst: 80, fatigue: 100 }, locomotion: "walk", activity: "idle",
    aiState: "idle", targetId: null, attackCooldown: 0, feedingCarcassId: null,
    burrowId: null, satiatedTimer: 0, digProgress: 0, interactHeld: false,
    aiDirX: 0, aiDirZ: 1, aiTimer: 0, fleeTime: 0, fleeRecoverTime: 0,
    carryingCarcassId: null, carryHeld: false, nestProgress: 0,
    ...over,
  };
}

const baseCtx: HudContext = {
  nearWater: false, nearCarcass: false, nearDigSpot: false, nearPrey: false,
  carrying: false, nearNest: false, stash: 0, inOwnBurrow: false,
};

describe("contextPrompt", () => {
  it("returns null when nothing is in range", () => {
    expect(contextPrompt(baseCtx, mkPlayer())).toBeNull();
  });

  it("burrowed but not yet home shows 筑巢", () => {
    const p = mkPlayer({ burrowId: 3 });
    expect(contextPrompt({ ...baseCtx, inOwnBurrow: false }, p)).toEqual({ word: "筑巢", key: "E" });
  });

  it("burrowed and already home shows 出洞", () => {
    const p = mkPlayer({ burrowId: 3 });
    expect(contextPrompt({ ...baseCtx, inOwnBurrow: true }, p)).toEqual({ word: "出洞", key: "E" });
  });

  it("carrying near the nest shows 存粮 (C)", () => {
    expect(contextPrompt({ ...baseCtx, carrying: true, nearNest: true }, mkPlayer())).toEqual({
      word: "存粮", key: "C",
    });
  });

  it("carrying away from the nest shows 放下 (C)", () => {
    expect(contextPrompt({ ...baseCtx, carrying: true, nearNest: false }, mkPlayer())).toEqual({
      word: "放下", key: "C",
    });
  });

  it("carrying takes priority over a dig spot/prey/carcass in range", () => {
    const ctx: HudContext = { ...baseCtx, carrying: true, nearDigSpot: true, nearPrey: true, nearCarcass: true };
    expect(contextPrompt(ctx, mkPlayer())).toEqual({ word: "放下", key: "C" });
  });

  it("a nearby carcass (not carrying) shows 叼起 (C), not 进食", () => {
    expect(contextPrompt({ ...baseCtx, nearCarcass: true }, mkPlayer())).toEqual({ word: "叼起", key: "C" });
  });

  it("stash eating shows a plain two-char 进食 — regression: must not embed a variable-length count", () => {
    const prompt = contextPrompt({ ...baseCtx, nearNest: true, stash: 87 }, mkPlayer());
    expect(prompt).toEqual({ word: "进食", key: "E" });
    // createHud()'s update() unconditionally does word.slice(0,-1)/word.slice(-1) to color the
    // last character — any word whose length isn't exactly 2 breaks that convention (this is
    // exactly the bug a 2026-08-09 review caught: `进食(87)` tore the closing paren off as the
    // "accented" character instead of a meaningful glyph). Pin the invariant directly instead of
    // just eyeballing today's literal, so a future embedded-number regression fails loudly here.
    expect(prompt!.word.length).toBe(2);
  });

  it("no stash eating when stash is empty even if near the nest", () => {
    expect(contextPrompt({ ...baseCtx, nearNest: true, stash: 0 }, mkPlayer())).toBeNull();
  });

  it("stash eating only shows when no physical carcass is in range (carcass wins)", () => {
    const ctx: HudContext = { ...baseCtx, nearNest: true, stash: 50, nearCarcass: true };
    expect(contextPrompt(ctx, mkPlayer())).toEqual({ word: "叼起", key: "C" });
  });

  it("falls through to 饮水 when nothing else applies", () => {
    expect(contextPrompt({ ...baseCtx, nearWater: true }, mkPlayer())).toEqual({ word: "饮水", key: "E" });
  });
});
