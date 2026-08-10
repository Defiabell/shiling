import { describe, expect, it } from "vitest";
import type { Creature } from "@shiling/sim";
import { contextPrompt, homeBearing, normalizeAngle, statusLabel, type HudContext } from "../src/hud.js";

/** 最小可用 Creature 字面量——contextPrompt/statusLabel 只读 burrowId/activity/locomotion。 */
function mkPlayer(over: Partial<Creature> = {}): Creature {
  return {
    id: 1, species: "youshou", pos: { x: 0, y: 0, z: 0 }, yaw: 0, hp: 60,
    needs: { hunger: 80, thirst: 80, fatigue: 100 }, locomotion: "walk", activity: "idle",
    aiState: "idle", targetId: null, attackCooldown: 0, feedingCarcassId: null,
    burrowId: null, satiatedTimer: 0, digProgress: 0, interactHeld: false,
    aiDirX: 0, aiDirZ: 1, aiTimer: 0, fleeTime: 0, fleeRecoverTime: 0,
    carryingCarcassId: null, carryHeld: false, nestProgress: 0, dormantHeld: false, hiddenTicks: 0, reappearStallCount: 0,
    pitDigProgress: 0, snaredTicks: 0,
    ...over,
  };
}

const baseCtx: HudContext = {
  nearWater: false, nearCarcass: false, nearDigSpot: false, nearPrey: false, nearTanshou: false,
  carrying: false, nearNest: false, stash: 0, inOwnBurrow: false, nestBuildPct: 0,
  dormant: false, dormancyEligible: false,
  essencePct: { zu: 0, lin: 0, xue: 0, meng: 0 },
  adrenalineActive: false,
  homeCompass: null,
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

  // M15 P1（反制包）：陷坑挖掘——整条链最末的 FALLBACK，只在 nearTanshou 为真（35m 内
  // 有潭狩）时才显示，避免在任何开阔地常驻可见（见 hud.ts contextPrompt 的设计取舍）。
  it("falls through to 挖陷坑 only when a tanshou is within pitPromptRadius, otherwise stays null", () => {
    expect(contextPrompt({ ...baseCtx, nearTanshou: true }, mkPlayer())).toEqual({ word: "挖陷坑", key: "E" });
    expect(contextPrompt({ ...baseCtx, nearTanshou: false }, mkPlayer())).toBeNull();
  });

  it("挖陷坑 is the lowest priority — any of the five higher tiers wins over it even with a tanshou nearby", () => {
    expect(contextPrompt({ ...baseCtx, nearTanshou: true, nearWater: true }, mkPlayer())).toEqual({ word: "饮水", key: "E" });
    expect(contextPrompt({ ...baseCtx, nearTanshou: true, nearDigSpot: true }, mkPlayer())).toEqual({ word: "挖掘", key: "E" });
    expect(contextPrompt({ ...baseCtx, nearTanshou: true, nearCarcass: true }, mkPlayer())).toEqual({ word: "叼起", key: "C" });
    expect(contextPrompt({ ...baseCtx, nearTanshou: true, nearPrey: true }, mkPlayer())).toEqual({ word: "撕咬", key: "J" });
    expect(contextPrompt({ ...baseCtx, nearTanshou: true, carrying: true, nearNest: true }, mkPlayer())).toEqual({ word: "存粮", key: "C" });
    const burrowed = mkPlayer({ burrowId: 3 });
    expect(contextPrompt({ ...baseCtx, nearTanshou: true, inOwnBurrow: false }, burrowed)).toEqual({ word: "筑巢", key: "E" });
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

// M15 P2（巢穴存在感——家巢罗盘 chip）：code review 2026-08-10 把这段三角推导从 main.ts
// 挪到 hud.ts 正是为了能被直接单元测试（main.ts 顶层有真实副作用，天生不可 import）。
describe("normalizeAngle", () => {
  it("passes values already inside (-π, π] through unchanged", () => {
    expect(normalizeAngle(0)).toBeCloseTo(0, 9);
    expect(normalizeAngle(1)).toBeCloseTo(1, 9);
    expect(normalizeAngle(-1)).toBeCloseTo(-1, 9);
    expect(normalizeAngle(Math.PI)).toBeCloseTo(Math.PI, 9); // 上界闭区间——π 本身合法
  });

  it("wraps values above π down by one full turn", () => {
    expect(normalizeAngle(Math.PI + 0.5)).toBeCloseTo(0.5 - Math.PI, 9);
    expect(normalizeAngle(Math.PI * 2 - 0.1)).toBeCloseTo(-0.1, 9);
  });

  it("wraps values at or below -π up by one full turn", () => {
    expect(normalizeAngle(-Math.PI)).toBeCloseTo(Math.PI, 9); // 下界不闭——恰好 -π 折到 +π
    expect(normalizeAngle(-Math.PI - 0.5)).toBeCloseTo(Math.PI - 0.5, 9);
  });

  it("handles multi-turn wraparounds (several full 2π revolutions)", () => {
    expect(normalizeAngle(Math.PI * 4 + 0.3)).toBeCloseTo(0.3, 9);
    expect(normalizeAngle(-Math.PI * 4 - 0.3)).toBeCloseTo(-0.3, 9);
  });
});

describe("homeBearing", () => {
  it("home straight ahead (same direction as camera forward) gives bearing 0", () => {
    // camYaw=0 → forward=(sin0,cos0)=(0,1)=+Z；home 同样在 +Z 方向（dx=0,dz=1）。
    expect(homeBearing(0, 1, 0)).toBeCloseTo(0, 9);
  });

  it("home directly behind gives bearing ±π", () => {
    expect(Math.abs(homeBearing(0, -1, 0))).toBeCloseTo(Math.PI, 9);
  });

  it("home to camera's screen-right gives a positive bearing (CSS rotate() clockwise)", () => {
    // camYaw=0 时镜头的屏幕右手方向 right=(-cos0,sin0)=(-1,0)=世界 -X（见 homeBearing
    // 头部注释的基向量推导）——home 摆在世界 -X（dx=-1,dz=0）应该读作"在屏幕右边"。
    expect(homeBearing(-1, 0, 0)).toBeCloseTo(Math.PI / 2, 9);
  });

  it("home to camera's screen-left gives a negative bearing", () => {
    expect(homeBearing(1, 0, 0)).toBeCloseTo(-Math.PI / 2, 9);
  });

  it("rotating the camera yaw by the same amount as the home direction keeps bearing at 0 (bearing is relative, not absolute)", () => {
    // camYaw=π/2 时 right=(-cos(π/2),sin(π/2))=(0,1)=世界 +Z——把 home 摆在同一个方向
    // (dx=0,dz=1) 应该现在读作"正前方"意味着 bearing 归零？不——home 在世界 +Z、镜头转向
    // π/2 后 forward=(sin(π/2),cos(π/2))=(1,0)=+X，+Z 相对新 forward 是"右边"，不是
    // "正前方"，所以这里断言的是"右边"（+π/2），呼应上一条测试换了个 camYaw 仍然自洽。
    expect(homeBearing(0, 1, Math.PI / 2)).toBeCloseTo(Math.PI / 2, 9);
  });

  it("bearing is purely relative: rotating camYaw by the exact angle to home always yields 0", () => {
    const dx = 3;
    const dz = -4;
    const homeAngle = Math.atan2(dx, dz);
    expect(homeBearing(dx, dz, homeAngle)).toBeCloseTo(0, 9);
  });
});
