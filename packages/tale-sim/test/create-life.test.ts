import { describe, expect, it } from "vitest";
import { clashOf, createCursor, createLife, rollPremise } from "../src/index.js";
import { FIXTURE_CONTENT, FIXTURE_SEED_ID, FIXTURE_SEED_ORGAN_ID, makeContent } from "./fixtures.js";

describe("createLife 出生", () => {
  it("初始 stats = tuning 基线 ＋ 神种 statMods", () => {
    const life = createLife(1, FIXTURE_SEED_ID, FIXTURE_CONTENT);
    // 基线 meng 10／ling 10／ti 20／de 5，灵蕴神种 +3 ling
    expect(life.stats).toEqual({ meng: 10, ling: 13, ti: 20, de: 5 });
  });

  it("lifespanMax = lifespanBase + floor(ti / lifespanTiDivisor)", () => {
    const life = createLife(1, FIXTURE_SEED_ID, FIXTURE_CONTENT);
    expect(life.lifespanMax).toBe(16 + Math.floor(20 / 10));

    const beefy = makeContent({
      seeds: [
        {
          ...FIXTURE_CONTENT.seeds[0]!,
          organ: { ...FIXTURE_CONTENT.seeds[0]!.organ, statMods: { ti: 15 } },
        },
      ],
    });
    const strong = createLife(1, FIXTURE_SEED_ID, beefy);
    expect(strong.stats.ti).toBe(35);
    expect(strong.lifespanMax).toBe(16 + 3);
  });

  it("organIds[0] 恒为神种器官", () => {
    const life = createLife(1, FIXTURE_SEED_ID, FIXTURE_CONTENT);
    expect(life.organIds).toEqual([FIXTURE_SEED_ORGAN_ID]);
  });

  it("写入一条 birth 记录，refId 指向神种", () => {
    const life = createLife(1, FIXTURE_SEED_ID, FIXTURE_CONTENT);
    expect(life.records).toHaveLength(1);
    expect(life.records[0]?.kind).toBe("birth");
    expect(life.records[0]?.refId).toBe(FIXTURE_SEED_ID);
    expect(life.records[0]?.text).toContain("灵蕴神种");
    expect(life.records[0]?.year).toBe(0);
    expect(life.records[0]?.season).toBe(0);
  });

  /**
   * [2026-08-13] `rngState` 不再等于 `seedNum`：降世时先掷天时与出身（**恒定两次抽取，
   * 且必须是一世的头两次**），`rngState` 从那两次之后接着走。这个顺序是接口的一部分 ——
   * `rollPremise(seedNum, content)` 就是靠它在 `createLife` 之前复算出同一个世道
   * （择神种那一屏据此提前显示「此世大旱」）。
   */
  it("seed 原样留存；rngState 已走过天时与出身那两次抽取", () => {
    const life = createLife(20260811, FIXTURE_SEED_ID, FIXTURE_CONTENT);
    expect(life.seed).toBe(20260811);
    const cursor = createCursor(20260811);
    cursor.next();
    cursor.next();
    expect(life.rngState).toBe(cursor.state);
  });

  it("天时与出身落进 state，且与 rollPremise 的预览逐字相同", () => {
    const life = createLife(20260811, FIXTURE_SEED_ID, FIXTURE_CONTENT);
    const preview = rollPremise(20260811, FIXTURE_CONTENT);
    expect(life.skyId).toBe(preview.sky.id);
    expect(life.originId).toBe(preview.origin.id);
  });

  it("其余初值：饱食/精气/地域/存活/无战斗", () => {
    const life = createLife(1, FIXTURE_SEED_ID, FIXTURE_CONTENT);
    expect(life.hunger).toBe(60);
    expect(life.essence).toEqual({ zu: 0, lin: 0, xue: 0, meng: 0 });
    expect(life.region).toBe("qingqiu");
    expect(life.year).toBe(0);
    expect(life.season).toBe(0);
    expect(life.alive).toBe(true);
    expect(life.ending).toBeNull();
    expect(clashOf(life)).toBeNull();
    expect(life.flags).toEqual([]);
    expect(life.firedOnceIds).toEqual([]);
  });

  it("神种 id 不存在时抛错", () => {
    expect(() => createLife(1, "no-such-seed", FIXTURE_CONTENT)).toThrow(/未知神种/);
  });

  it("stats 夹紧在 0-100（神种加成溢出也不越界）", () => {
    const overflow = makeContent({
      seeds: [
        {
          ...FIXTURE_CONTENT.seeds[0]!,
          organ: { ...FIXTURE_CONTENT.seeds[0]!.organ, statMods: { ling: 200, de: -50 } },
        },
      ],
    });
    const life = createLife(1, FIXTURE_SEED_ID, overflow);
    expect(life.stats.ling).toBe(100);
    expect(life.stats.de).toBe(0);
  });
});
