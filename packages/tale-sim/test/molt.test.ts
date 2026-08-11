import { describe, expect, it } from "vitest";
import { createLife, performAction, type TaleState } from "../src/index.js";
import {
  FIXTURE_SEED_ID,
  FIXTURE_SEED_ORGAN_ID,
  ORGAN_GOU_CHI,
  ORGAN_JI_ZU,
  ORGAN_LIN_JIA,
  ORGAN_WU_MU,
  contentWithoutEvents,
  withOrgans,
} from "./fixtures.js";

/** 蛰伏测试统一用「不扣饱食、不抽事件」的 content，把变量收敛到开奖本身。 */
const CONTENT = contentWithoutEvents({ tuning: { hungerPerSeason: 0, winterHungerExtra: 0 } });

function ripeLife(seed: number, essence: Partial<Record<"zu" | "lin" | "xue" | "meng", number>>) {
  const life = createLife(seed, FIXTURE_SEED_ID, CONTENT);
  return { ...life, essence: { ...life.essence, ...essence } } satisfies TaleState;
}

describe("蜕变开奖：阈值门槛", () => {
  it("精气不到阈值时蛰伏根本不可选（调用即抛）", () => {
    const almost = ripeLife(1, { zu: 59 });
    expect(() => performAction(almost, "dormant", CONTENT)).toThrow(/不可执行行动/);
  });

  it("刚好到阈值就能开奖", () => {
    const exact = ripeLife(1, { zu: 60 });
    const { moltResult } = performAction(exact, "dormant", CONTENT);
    expect(moltResult).not.toBeNull();
    expect(moltResult?.essenceType).toBe("zu");
  });

  it("多型达阈值时取数值最高的那型", () => {
    const both = ripeLife(2, { zu: 60, meng: 90 });
    const { moltResult, state } = performAction(both, "dormant", CONTENT);
    expect(moltResult?.essenceType).toBe("meng");
    expect(state.essence.meng).toBe(0);
    expect(state.essence.zu).toBe(60);
  });

  it("并列时按 zu→lin→xue→meng 的固定顺序裁决", () => {
    const tied = ripeLife(3, { zu: 70, lin: 70 });
    expect(performAction(tied, "dormant", CONTENT).moltResult?.essenceType).toBe("zu");
    const tied2 = ripeLife(3, { lin: 70, xue: 70 });
    expect(performAction(tied2, "dormant", CONTENT).moltResult?.essenceType).toBe("lin");
  });
});

describe("蜕变开奖：结果落账", () => {
  it("开出的器官进 organIds，statMods 一次性落账", () => {
    // 只有狩齿对 meng 有亲和 → 结果唯一，可断言具体数值
    const life = ripeLife(4, { meng: 60 });
    const { state, moltResult } = performAction(life, "dormant", CONTENT);
    expect(moltResult?.chosen.id).toBe(ORGAN_GOU_CHI);
    expect(state.organIds).toEqual([FIXTURE_SEED_ORGAN_ID, ORGAN_GOU_CHI]);
    expect(state.stats.meng).toBe(life.stats.meng + 6);
  });

  it("开奖后该型精气清零，其余型不动", () => {
    const life = ripeLife(5, { meng: 88, lin: 30 });
    const { state } = performAction(life, "dormant", CONTENT);
    expect(state.essence.meng).toBe(0);
    expect(state.essence.lin).toBe(30);
  });

  it("写一条 molt 记录，refId 指向器官", () => {
    const life = ripeLife(6, { meng: 60 });
    const { state } = performAction(life, "dormant", CONTENT);
    const record = state.records[state.records.length - 1];
    expect(record?.kind).toBe("molt");
    expect(record?.refId).toBe(ORGAN_GOU_CHI);
    expect(record?.text).toContain("狩齿");
  });

  it("候选数 = min(moltCandidateCount, 池子大小)，且互不重复、都未持有", () => {
    const life = ripeLife(7, { zu: 60 });
    const { moltResult } = performAction(life, "dormant", CONTENT);
    expect(moltResult?.candidates).toHaveLength(3);
    const ids = moltResult!.candidates.map((organ) => organ.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids).not.toContain(FIXTURE_SEED_ORGAN_ID);
    expect(moltResult!.candidates).toContainEqual(moltResult!.chosen);
  });

  it("已持有的器官不再进候选池", () => {
    const life = withOrgans(ripeLife(8, { zu: 60 }), ORGAN_JI_ZU, ORGAN_LIN_JIA);
    const { moltResult } = performAction(life, "dormant", CONTENT);
    const ids = moltResult?.candidates.map((organ) => organ.id) ?? [];
    expect(ids).not.toContain(ORGAN_JI_ZU);
    expect(ids).not.toContain(ORGAN_LIN_JIA);
    expect(new Set(ids)).toEqual(new Set([ORGAN_GOU_CHI, ORGAN_WU_MU]));
  });

  it("候选池空（器官已全）时白费一季：不获得、也不没收精气", () => {
    const life = withOrgans(
      ripeLife(9, { zu: 60 }),
      ORGAN_GOU_CHI,
      ORGAN_WU_MU,
      ORGAN_LIN_JIA,
      ORGAN_JI_ZU,
    );
    const { state, moltResult, notices } = performAction(life, "dormant", CONTENT);
    expect(moltResult).toBeNull();
    expect(state.essence.zu).toBe(60);
    expect(state.organIds).toHaveLength(life.organIds.length);
    expect(notices.join("")).toContain("无所凭依");
  });

  it("对该型亲和为 0 的器官不进候选池", () => {
    // xue 只有鳞甲有亲和
    const life = ripeLife(10, { xue: 60 });
    const { moltResult } = performAction(life, "dormant", CONTENT);
    expect(moltResult?.candidates.map((organ) => organ.id)).toEqual([ORGAN_LIN_JIA]);
    expect(moltResult?.chosen.id).toBe(ORGAN_LIN_JIA);
  });
});

describe("蜕变开奖：亲和度加权分布（大样本）", () => {
  // fixture 里对 zu 的亲和刻意拉开量级：疾足 0.9 / 鳞甲 0.1 / 雾目 0.05 / 狩齿 0.02
  const RUNS = 3000;

  it("候选入选率随亲和度单调，且高亲和几乎必入选", () => {
    const inclusion: Record<string, number> = {};
    for (let seed = 0; seed < RUNS; seed += 1) {
      const life = ripeLife(seed * 7919 + 3, { zu: 60 });
      const { moltResult } = performAction(life, "dormant", CONTENT);
      for (const organ of moltResult?.candidates ?? []) {
        inclusion[organ.id] = (inclusion[organ.id] ?? 0) + 1;
      }
    }
    const rate = (id: string): number => (inclusion[id] ?? 0) / RUNS;
    expect(rate(ORGAN_JI_ZU)).toBeGreaterThan(0.95);
    expect(rate(ORGAN_LIN_JIA)).toBeGreaterThan(rate(ORGAN_WU_MU));
    expect(rate(ORGAN_WU_MU)).toBeGreaterThan(rate(ORGAN_GOU_CHI));
    expect(rate(ORGAN_GOU_CHI)).toBeLessThan(0.7);
  });

  it("最终开出的器官也随亲和度单调偏斜", () => {
    const chosen: Record<string, number> = {};
    for (let seed = 0; seed < RUNS; seed += 1) {
      const life = ripeLife(seed * 104729 + 11, { zu: 60 });
      const { moltResult } = performAction(life, "dormant", CONTENT);
      if (moltResult) chosen[moltResult.chosen.id] = (chosen[moltResult.chosen.id] ?? 0) + 1;
    }
    const rate = (id: string): number => (chosen[id] ?? 0) / RUNS;
    // 每次候选 3 个再等权抽 1，故上限约 1/3；高亲和应贴近该上限
    expect(rate(ORGAN_JI_ZU)).toBeGreaterThan(0.3);
    expect(rate(ORGAN_JI_ZU)).toBeGreaterThan(rate(ORGAN_GOU_CHI));
    expect(rate(ORGAN_LIN_JIA)).toBeGreaterThan(rate(ORGAN_GOU_CHI));
    // 四个器官都有可能开出（低亲和只是稀少，不是不可能）
    expect(rate(ORGAN_GOU_CHI)).toBeGreaterThan(0);
    expect(Object.keys(chosen)).toHaveLength(4);
  });

  it("精气量只是公共系数，不改变分布形状", () => {
    const tally = (amount: number): Record<string, number> => {
      const chosen: Record<string, number> = {};
      for (let seed = 0; seed < 800; seed += 1) {
        const life = ripeLife(seed * 6151 + 5, { zu: amount });
        const { moltResult } = performAction(life, "dormant", CONTENT);
        if (moltResult) chosen[moltResult.chosen.id] = (chosen[moltResult.chosen.id] ?? 0) + 1;
      }
      return chosen;
    };
    expect(tally(60)).toEqual(tally(240));
  });
});
