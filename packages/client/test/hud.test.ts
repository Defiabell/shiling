import { describe, expect, it } from "vitest";
import type { Creature } from "@shiling/sim";
import { contextPrompt, statusLabel, type HudContext } from "../src/hud.js";

/** 最小可用 Creature 字面量——contextPrompt/statusLabel 只读 burrowId/activity/locomotion。 */
function mkPlayer(over: Partial<Creature> = {}): Creature {
  return {
    id: 1, species: "youshou", pos: { x: 0, y: 0, z: 0 }, yaw: 0, hp: 60,
    needs: { hunger: 80, thirst: 80, fatigue: 100 }, locomotion: "walk", activity: "idle",
    aiState: "idle", targetId: null, attackCooldown: 0, feedingCarcassId: null,
    burrowId: null, satiatedTimer: 0, digProgress: 0, interactHeld: false,
    aiDirX: 0, aiDirZ: 1, aiTimer: 0, fleeTime: 0, fleeRecoverTime: 0,
    carryingCarcassId: null, carryHeld: false, nestProgress: 0, dormantHeld: false,
    ...over,
  };
}

const baseCtx: HudContext = {
  nearWater: false, nearCarcass: false, nearDigSpot: false, nearPrey: false,
  carrying: false, nearNest: false, stash: 0, inOwnBurrow: false, nestBuildPct: 0,
  dormant: false, dormancyEligible: false,
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

  // postfix-9 Part 0（controller ruling）：洞外"储粮进食"提示词整体移除——储粮进食
  // 已经改成"人在自己家的洞里自动吃"，不再是洞外的按键交互，HUD 也就没有对应的提示
  // 可显示（stash 数值改由 Part 2 的巢内状态行展示，见 hud.ts 的 statusLabel）。
  // nearNest/stash 仍然是 HudContext 上合法的字段（叼着时的"存粮"/"放下"判断还要用），
  // 这里回归测试的是"单纯 nearNest+stash>0、不叼着、附近没有其它东西"不再产出任何提示。
  it("stash presence alone (not carrying, no carcass) no longer surfaces a prompt — auto-eat is silent (Part 0)", () => {
    expect(contextPrompt({ ...baseCtx, nearNest: true, stash: 87 }, mkPlayer())).toBeNull();
  });

  it("falls through to 饮水 when nothing else applies", () => {
    expect(contextPrompt({ ...baseCtx, nearWater: true }, mkPlayer())).toEqual({ word: "饮水", key: "E" });
  });

  // M1 B3（蛰伏蜕变）：见 hud.ts contextPrompt 头部注释新增的这一小节。
  it("burrowed at home and eligible shows 蛰伏 (V), taking priority over 出洞", () => {
    const p = mkPlayer({ burrowId: 3 });
    expect(contextPrompt({ ...baseCtx, inOwnBurrow: true, dormancyEligible: true }, p)).toEqual({
      word: "蛰伏", key: "V",
    });
  });

  it("burrowed at home but NOT eligible falls back to 出洞 (unchanged pre-B3 behavior)", () => {
    const p = mkPlayer({ burrowId: 3 });
    expect(contextPrompt({ ...baseCtx, inOwnBurrow: true, dormancyEligible: false }, p)).toEqual({
      word: "出洞", key: "E",
    });
  });

  it("already dormant shows no prompt at all, even though still eligible/burrowed", () => {
    const p = mkPlayer({ burrowId: 3 });
    expect(contextPrompt({ ...baseCtx, inOwnBurrow: true, dormancyEligible: true, dormant: true }, p)).toBeNull();
  });
});

// postfix-9 Part 2：巢中休息状态行——burrowed-at-home 展示的是 stash 数量，取代泛用的
// "洞中休息"；这是 Part 0 静默自动进食唯一的可见痕迹（无提示、无按键），见 hud.ts 的
// statusLabel 头部注释。
describe("statusLabel", () => {
  it("burrowed in own home nest shows the floored stash count", () => {
    const p = mkPlayer({ burrowId: 3 });
    expect(statusLabel(p, { ...baseCtx, inOwnBurrow: true, stash: 87.9 })).toBe("巢中休息——储粮 87");
  });

  it("burrowed in own home nest with an empty stash still shows the line (0, not hidden)", () => {
    const p = mkPlayer({ burrowId: 3 });
    expect(statusLabel(p, { ...baseCtx, inOwnBurrow: true, stash: 0 })).toBe("巢中休息——储粮 0");
  });

  it("burrowed but not yet home keeps the generic 洞中休息 (no stash number)", () => {
    const p = mkPlayer({ burrowId: 3 });
    expect(statusLabel(p, { ...baseCtx, inOwnBurrow: false, stash: 40 })).toBe("洞中休息");
  });

  it("digging shows 挖掘中", () => {
    const p = mkPlayer({ activity: "digging" });
    expect(statusLabel(p, baseCtx)).toBe("挖掘中");
  });

  it("eating a real carcass shows 进食中 (unrelated to the burrow stash line)", () => {
    const p = mkPlayer({ activity: "eating" });
    expect(statusLabel(p, baseCtx)).toBe("进食中");
  });

  it("swimming shows 潜泳", () => {
    const p = mkPlayer({ locomotion: "swim" });
    expect(statusLabel(p, baseCtx)).toBe("潜泳");
  });

  it("idle on land shows nothing", () => {
    expect(statusLabel(mkPlayer(), baseCtx)).toBe("");
  });

  // M1 B3（蛰伏蜕变）：dormant 优先于 stash 行，且不需要 inOwnBurrow 单独判断——见
  // hud.ts statusLabel 头部注释新增的这一小节。
  it("dormant shows 蛰伏中……, taking priority over the stash line", () => {
    const p = mkPlayer({ burrowId: 3 });
    expect(statusLabel(p, { ...baseCtx, inOwnBurrow: true, stash: 87.9, dormant: true })).toBe("蛰伏中……");
  });
});
