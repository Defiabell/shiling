import { describe, expect, it } from "vitest";
import type { CombatState } from "@shiling/tale-sim";
import { buildCombatVm } from "../src/model/combatVm.js";
import { FIXTURE_CONTENT, newState, withPatch } from "./helpers.js";

function combat(patch: Partial<CombatState> = {}): CombatState {
  return { enemyId: "ye-zhi", enemyHp: 6, playerHp: 20, round: 0, log: ["野雉当道，避之不得。"], ...patch };
}

describe("buildCombatVm", () => {
  it("敌我血条按各自上限算比率（我方上限＝体）", () => {
    const state = newState();
    const vm = buildCombatVm(state, combat({ enemyHp: 3, playerHp: 10 }), FIXTURE_CONTENT);
    expect(vm.enemyName).toBe("野雉");
    expect(vm.enemyHpMax).toBe(6);
    expect(vm.enemyPercent).toBe(50);
    expect(vm.playerHpMax).toBe(state.stats.ti);
    expect(vm.playerPercent).toBe(50);
  });

  it("血量为负时显示 0 而不是负数", () => {
    const vm = buildCombatVm(newState(), combat({ enemyHp: -4 }), FIXTURE_CONTENT);
    expect(vm.enemyHp).toBe(0);
    expect(vm.enemyPercent).toBe(0);
  });

  it("我方低于三成判 critical", () => {
    const state = newState(); // ti = 20
    expect(buildCombatVm(state, combat({ playerHp: 5 }), FIXTURE_CONTENT).playerCritical).toBe(true);
    expect(buildCombatVm(state, combat({ playerHp: 12 }), FIXTURE_CONTENT).playerCritical).toBe(false);
  });

  it("无战技器官 → 第四个按钮不点亮并给原因（引擎那边会抛错，界面必须先挡住）", () => {
    const vm = buildCombatVm(newState(), combat(), FIXTURE_CONTENT);
    const organ = vm.actions[3]!;
    expect(organ.id).toBe("organ");
    expect(organ.enabled).toBe(false);
    expect(organ.disabledReason).toBe("未蜕生带战技的器官");
    expect(vm.actions.slice(0, 3).every((action) => action.enabled)).toBe(true);
  });

  it("有战技器官 → 按钮变成技名并点亮", () => {
    const base = newState();
    const state = withPatch(base, { organIds: [...base.organIds, "gou-chi"] });
    const organ = buildCombatVm(state, combat(), FIXTURE_CONTENT).actions[3]!;
    expect(organ.enabled).toBe(true);
    expect(organ.label).toBe("撕咬");
    expect(organ.hint).toContain("咬断猎物咽喉");
  });

  it("诈术蓄势位会透出到界面", () => {
    const base = newState();
    expect(buildCombatVm(base, combat(), FIXTURE_CONTENT).primed).toBe(false);
    const primed = withPatch(base, { flags: ["sys:feint-primed"] });
    expect(buildCombatVm(primed, combat(), FIXTURE_CONTENT).primed).toBe(true);
  });

  it("敌人 id 失效时不崩（退回 id 当名字，血条上限用当前值）", () => {
    const vm = buildCombatVm(newState(), combat({ enemyId: "ghost", enemyHp: 5 }), FIXTURE_CONTENT);
    expect(vm.enemyName).toBe("ghost");
    expect(vm.enemyHpMax).toBe(5);
  });
});
