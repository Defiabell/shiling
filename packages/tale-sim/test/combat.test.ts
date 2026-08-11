import { describe, expect, it } from "vitest";
import {
  SYS_FLAG_FEINT_PRIMED,
  combatAct,
  createLife,
  type TaleState,
} from "../src/index.js";
import {
  ENEMY_QIONG_QI,
  ENEMY_YE_ZHI,
  FIXTURE_SEED_ID,
  ORGAN_GOU_CHI,
  UNCLAMPED_CHANCE,
  contentWithoutEvents,
  enterCombat,
  makeContent,
  withOrgans,
} from "./fixtures.js";

/** 关掉伤害抖动，让伤害公式可以精确断言。 */
const EXACT = contentWithoutEvents({ tuning: { combatDamageJitter: 0 } });

function fightingLife(enemyId: string, content = EXACT, seed = 1): TaleState {
  return enterCombat(createLife(seed, FIXTURE_SEED_ID, content), enemyId, content);
}

describe("战斗：前置校验", () => {
  it("不在战斗中时抛错", () => {
    const life = createLife(1, FIXTURE_SEED_ID, EXACT);
    expect(() => combatAct(life, "fight", EXACT)).toThrow(/不在战斗中/);
  });

  it("已死亡时抛错", () => {
    const state = { ...fightingLife(ENEMY_YE_ZHI), alive: false };
    expect(() => combatAct(state, "fight", EXACT)).toThrow(/已死亡/);
  });

  it("敌人 id 失效时抛错", () => {
    const state = fightingLife(ENEMY_YE_ZHI);
    const broken = { ...state, combat: { ...state.combat!, enemyId: "ghost" } };
    expect(() => combatAct(broken, "fight", EXACT)).toThrow(/未知敌人/);
  });

  it("没有带战斗技的器官时 act=organ 抛错", () => {
    expect(() => combatAct(fightingLife(ENEMY_YE_ZHI), "organ", EXACT)).toThrow(/战斗技/);
  });
});

describe("战斗：出手与伤害公式", () => {
  it("fight 伤害 = base + floor(meng / divisor)", () => {
    const state = fightingLife(ENEMY_QIONG_QI);
    // meng 10 → 3 + floor(10/8) = 4
    const { state: next, roundLog } = combatAct(state, "fight", EXACT);
    expect(next.combat?.enemyHp).toBe(40 - 4);
    expect(roundLog.join("")).toContain("伤其4");
  });

  it("敌方反击伤害用敌人的 meng", () => {
    const state = fightingLife(ENEMY_QIONG_QI);
    // 穷奇 meng 30 → 3 + floor(30/8) = 6
    const { state: next } = combatAct(state, "fight", EXACT);
    expect(next.combat?.playerHp).toBe(state.stats.ti - 6);
  });

  it("伤害有下限 1（公式算成 0 也至少打掉 1）", () => {
    const feeble = contentWithoutEvents({
      tuning: { combatDamageJitter: 0, combatDamageBase: 0, combatDamageMengDivisor: 1000 },
    });
    const state = fightingLife(ENEMY_QIONG_QI, feeble);
    const { state: next } = combatAct(state, "fight", feeble);
    expect(next.combat?.enemyHp).toBe(39);
    expect(next.combat?.playerHp).toBe(state.stats.ti - 1);
  });

  it("抖动让伤害落在 ±jitter 区间内", () => {
    const jittery = contentWithoutEvents({ tuning: { combatDamageJitter: 1 } });
    const seen = new Set<number>();
    for (let seed = 0; seed < 60; seed += 1) {
      const state = fightingLife(ENEMY_QIONG_QI, jittery, seed);
      const next = combatAct(state, "fight", jittery).state;
      seen.add(40 - (next.combat?.enemyHp ?? 0));
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([3, 4, 5]);
  });

  it("round 每回合 +1，log 在 state.combat.log 上累积", () => {
    let state = fightingLife(ENEMY_QIONG_QI);
    state = combatAct(state, "fight", EXACT).state;
    expect(state.combat?.round).toBe(1);
    const logAfterOne = state.combat?.log.length ?? 0;
    state = combatAct(state, "fight", EXACT).state;
    expect(state.combat?.round).toBe(2);
    expect(state.combat?.log.length).toBeGreaterThan(logAfterOne);
  });
});

describe("战斗：打死敌人", () => {
  const oneShot = contentWithoutEvents({
    tuning: { combatDamageJitter: 0, combatDamageBase: 100 },
  });

  it("敌人血尽 → over=win，吞得精气与饱食，combat 清空", () => {
    const state = fightingLife(ENEMY_YE_ZHI, oneShot);
    const { state: next, over, roundLog } = combatAct(state, "fight", oneShot);
    expect(over).toBe("win");
    expect(next.combat).toBeNull();
    expect(next.essence.zu).toBe(12);
    expect(next.essence.xue).toBe(4);
    expect(next.hunger).toBe(60 + 18);
    expect(roundLog.join("")).toContain("毙于爪牙");
  });

  it("战胜写一条 combat 记录（击杀专用，refId=敌人）", () => {
    const state = fightingLife(ENEMY_YE_ZHI, oneShot);
    const { state: next } = combatAct(state, "fight", oneShot);
    const record = next.records[next.records.length - 1];
    expect(record?.kind).toBe("combat");
    expect(record?.refId).toBe(ENEMY_YE_ZHI);
    expect(record?.text).toContain("野雉");
  });

  it("敌人被打死后不再反击", () => {
    const state = fightingLife(ENEMY_YE_ZHI, oneShot);
    const { state: next, roundLog } = combatAct(state, "fight", oneShot);
    expect(next.alive).toBe(true);
    expect(roundLog.join("")).not.toContain("反噬");
  });
});

describe("战斗：被打死", () => {
  it("playerHp 见底 → over=dead，ending=slain，death 记录末条", () => {
    const state = fightingLife(ENEMY_QIONG_QI);
    const dying = { ...state, combat: { ...state.combat!, playerHp: 1 } };
    const { state: next, over } = combatAct(dying, "fight", EXACT);
    expect(over).toBe("dead");
    expect(next.alive).toBe(false);
    expect(next.ending).toBe("slain");
    expect(next.combat).toBeNull();
    const record = next.records[next.records.length - 1];
    expect(record?.kind).toBe("death");
    expect(record?.refId).toBe(ENEMY_QIONG_QI);
    expect(record?.text).toContain("穷奇幼崽");
  });

  it("被打死不写 combat（击杀）记录", () => {
    const state = fightingLife(ENEMY_QIONG_QI);
    const dying = { ...state, combat: { ...state.combat!, playerHp: 1 } };
    const { state: next } = combatAct(dying, "fight", EXACT);
    expect(next.records.filter((record) => record.kind === "combat")).toHaveLength(0);
  });
});

describe("战斗：逃跑", () => {
  it("成功 → over=fled，未损血，combat 清空", () => {
    const surefire = contentWithoutEvents({
      tuning: { ...UNCLAMPED_CHANCE, combatDamageJitter: 0, fleeBase: 1 },
    });
    const state = fightingLife(ENEMY_QIONG_QI, surefire);
    const { state: next, over, roundLog } = combatAct(state, "flee", surefire);
    expect(over).toBe("fled");
    expect(next.combat).toBeNull();
    expect(next.alive).toBe(true);
    expect(roundLog.join("")).toContain("遁去");
  });

  it("失败 → 战斗继续并挨一下正常伤害", () => {
    const doomed = contentWithoutEvents({
      tuning: { ...UNCLAMPED_CHANCE, combatDamageJitter: 0, fleeBase: 0, fleePerLingDiff: 0 },
    });
    const state = fightingLife(ENEMY_QIONG_QI, doomed);
    const { state: next, over, roundLog } = combatAct(state, "flee", doomed);
    expect(over).toBeNull();
    expect(next.combat?.playerHp).toBe(state.stats.ti - 6);
    expect(next.combat?.enemyHp).toBe(40);
    expect(roundLog.join("")).toContain("遁而不得脱");
  });

  it("fleeBias 真的进了公式（同一 ling，野雉必脱、穷奇必不脱）", () => {
    const biasRules = contentWithoutEvents({
      tuning: {
        ...UNCLAMPED_CHANCE,
        combatDamageJitter: 0,
        fleeBase: 0.5,
        fleePerLingDiff: 0,
        fleeBiasFactor: 0.05,
      },
    });
    expect(combatAct(fightingLife(ENEMY_YE_ZHI, biasRules), "flee", biasRules).over).toBe("fled");
    expect(combatAct(fightingLife(ENEMY_QIONG_QI, biasRules), "flee", biasRules).over).toBeNull();
  });

  it("ling 与 enemy.meng 的差进了公式", () => {
    const lingRules = contentWithoutEvents({
      tuning: {
        ...UNCLAMPED_CHANCE,
        combatDamageJitter: 0,
        fleeBase: 0,
        fleePerLingDiff: 0.1,
        fleeBiasFactor: 0,
      },
    });
    const dull = fightingLife(ENEMY_QIONG_QI, lingRules); // ling 13 − 30 < 0 → 0%
    expect(combatAct(dull, "flee", lingRules).over).toBeNull();
    const bright = { ...dull, stats: { ...dull.stats, ling: 50 } }; // (50−30)×0.1 = 2 → 100%
    expect(combatAct(bright, "flee", lingRules).over).toBe("fled");
  });
});

describe("战斗：诈（feint）", () => {
  const alwaysFeint = contentWithoutEvents({
    tuning: { ...UNCLAMPED_CHANCE, combatDamageJitter: 0, feintPerLing: 1 },
  });
  const neverFeint = contentWithoutEvents({
    tuning: { ...UNCLAMPED_CHANCE, combatDamageJitter: 0, feintPerLing: 0 },
  });

  it("成功 = 本回合免伤 ＋ 挂上蓄势 flag", () => {
    const state = fightingLife(ENEMY_QIONG_QI, alwaysFeint);
    const { state: next, roundLog } = combatAct(state, "feint", alwaysFeint);
    expect(next.combat?.playerHp).toBe(state.stats.ti);
    expect(next.combat?.enemyHp).toBe(40);
    expect(next.flags).toContain(SYS_FLAG_FEINT_PRIMED);
    expect(roundLog.join("")).toContain("扑空");
  });

  it("失败 = 受 feintFailDamageMul 倍伤，且不挂蓄势", () => {
    const state = fightingLife(ENEMY_QIONG_QI, neverFeint);
    const { state: next, roundLog } = combatAct(state, "feint", neverFeint);
    // 穷奇基础 6 × 1.5 = 9
    expect(next.combat?.playerHp).toBe(state.stats.ti - 9);
    expect(next.flags).not.toContain(SYS_FLAG_FEINT_PRIMED);
    expect(roundLog.join("")).toContain("反受重创");
  });

  it("蓄势让下一次出手伤害 ×feintBonusDamageMul", () => {
    const primed = combatAct(
      fightingLife(ENEMY_QIONG_QI, alwaysFeint),
      "feint",
      alwaysFeint,
    ).state;
    const { state: next } = combatAct(primed, "fight", alwaysFeint);
    expect(next.combat?.enemyHp).toBe(40 - 8); // 4 × 2
  });

  it("蓄势只管紧接的下一次，用掉即摘", () => {
    let state = combatAct(fightingLife(ENEMY_QIONG_QI, alwaysFeint), "feint", alwaysFeint).state;
    state = combatAct(state, "fight", alwaysFeint).state;
    expect(state.flags).not.toContain(SYS_FLAG_FEINT_PRIMED);
    const hpBefore = state.combat?.enemyHp ?? 0;
    state = combatAct(state, "fight", alwaysFeint).state;
    expect(state.combat?.enemyHp).toBe(hpBefore - 4);
  });

  it("蓄势期间改逃跑也会消耗掉蓄势（不留到更后面）", () => {
    const stubborn = contentWithoutEvents({
      tuning: {
        ...UNCLAMPED_CHANCE,
        combatDamageJitter: 0,
        feintPerLing: 1,
        fleeBase: 0,
        fleePerLingDiff: 0,
      },
    });
    let state = combatAct(fightingLife(ENEMY_QIONG_QI, stubborn), "feint", stubborn).state;
    state = combatAct(state, "flee", stubborn).state;
    expect(state.flags).not.toContain(SYS_FLAG_FEINT_PRIMED);
    const hpBefore = state.combat?.enemyHp ?? 0;
    state = combatAct(state, "fight", stubborn).state;
    expect(state.combat?.enemyHp).toBe(hpBefore - 4);
  });
});

describe("战斗：器官技", () => {
  it("持有带 combatSkill 的器官时伤害 ×organSkillDamageMul", () => {
    const state = withOrgans(fightingLife(ENEMY_QIONG_QI), ORGAN_GOU_CHI);
    const { state: next, roundLog } = combatAct(state, "organ", EXACT);
    expect(next.combat?.enemyHp).toBe(40 - 8);
    expect(roundLog.join("")).toContain("撕咬");
  });

  it("器官技也吃诈术蓄势的加成（叠乘）", () => {
    const alwaysFeint = contentWithoutEvents({
      tuning: { ...UNCLAMPED_CHANCE, combatDamageJitter: 0, feintPerLing: 1 },
    });
    const armed = withOrgans(fightingLife(ENEMY_QIONG_QI, alwaysFeint), ORGAN_GOU_CHI);
    const primed = combatAct(armed, "feint", alwaysFeint).state;
    const { state: next } = combatAct(primed, "organ", alwaysFeint);
    expect(next.combat?.enemyHp).toBe(40 - 16); // 4 × 2（器官）× 2（蓄势）
  });

  it("器官技倍率可调", () => {
    const brutal = contentWithoutEvents({
      tuning: { combatDamageJitter: 0, organSkillDamageMul: 5 },
    });
    const state = withOrgans(fightingLife(ENEMY_QIONG_QI, brutal), ORGAN_GOU_CHI);
    expect(combatAct(state, "organ", brutal).state.combat?.enemyHp).toBe(40 - 20);
  });
});

describe("战斗：不可变约定", () => {
  it("combatAct 不改动入参 state", () => {
    const state = fightingLife(ENEMY_QIONG_QI);
    const snapshot = structuredClone(state);
    combatAct(state, "fight", EXACT);
    expect(state).toEqual(snapshot);
  });

  it("同一 state 重复调用得到相同结果（无隐藏状态）", () => {
    const state = fightingLife(ENEMY_QIONG_QI, makeContent({ tuning: { combatDamageJitter: 1 } }));
    const content = makeContent({ tuning: { combatDamageJitter: 1 } });
    expect(combatAct(state, "fight", content).state).toEqual(combatAct(state, "fight", content).state);
  });
});
