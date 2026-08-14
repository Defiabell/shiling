/**
 * 凝招（M2-B2）的内容闸门：部件表的 schema ＋ **严格占优检测**。
 *
 * 需求正本：`docs/plans/shiling/2026-08-14-liezhuan-m2-combat-core-plan.md` 的「B2 凝招」节 ——
 * 「平衡靠部件属性与槽位上限控住，不靠白名单；但必须有自动闸门检测严格占优的拼法」。
 *
 * ## 为什么占优检测放在内容库而不是引擎库
 * 它查的是**这一版的数**（15 件部件的 payload ＋ 10 条古法的倍率）够不够互不吃掉，
 * 而不是公式对不对。公式的性质由 `tale-sim/test/forge.test.ts` 守
 * （单调、代价随分量走）；这里守的是「拿这些数跑出来的那 1000 多种拼法里，
 * 有没有一种让别的从此没人会拼」。
 *
 * 手法沿用 P2 那道 AI 抉择闸门：它当初反过来查出了**手写内容自己**的一条假抉择
 * （萤引：吃了反而拿得更少还倒赔德）。同一条纪律 —— 闸门不是「AI 写的才要查」的规矩。
 */

import { describe, expect, it } from "vitest";
import {
  FORGE_SLOTS,
  forgeDominance,
  forgeDominanceReport,
  organIndex,
  type CombatSkillEffect,
  type PartDef,
} from "@shiling/tale-sim";
import { PARTS, TALE_CONTENT } from "../src/index.js";

const CONTENT = TALE_CONTENT;

describe("部件表 schema", () => {
  it("id 与器官一一对应，且每件器官至多产出一件部件", () => {
    const ids = PARTS.map((part) => part.id);
    expect(new Set(ids).size).toBe(ids.length);
    const organIds = PARTS.map((part) => part.organId);
    expect(new Set(organIds).size).toBe(organIds.length);
    const index = organIndex(CONTENT);
    for (const part of PARTS) {
      expect(index.get(part.organId), `部件 ${part.id} 指向不存在的器官`).toBeDefined();
    }
  });

  it("15 件器官（12 常规 ＋ 3 神种）全部产出部件 —— 缺一件就有一种 build 凝不出招", () => {
    expect(PARTS).toHaveLength(CONTENT.organs.length + CONTENT.seeds.length);
  });

  it("每件部件至少填得进一个槽（填不进任何槽的部件是死数据）", () => {
    for (const part of PARTS) {
      const slots = FORGE_SLOTS.filter((slot) => part[slot] !== undefined);
      expect(slots.length, `${part.name}放不进任何槽`).toBeGreaterThan(0);
    }
  });

  it("三个槽各至少有 3 件候选（否则拼装界面里有一栏永远只有一个选项）", () => {
    for (const slot of FORGE_SLOTS) {
      const count = PARTS.filter((part) => part[slot] !== undefined).length;
      expect(count, `${slot} 槽只有 ${count} 件候选`).toBeGreaterThanOrEqual(3);
    }
  });

  /**
   * 落笔纪律 1：**十档效果各由恰好一件部件承担**。
   *
   * 两件部件给同一档效果的话，它们在附加槽里的向量完全相同 —— 便宜的那件让贵的那件
   * 从此没人会拼。这一条是占优闸门跑得出 0 的**结构性前提**，所以单独钉一遍：
   * 闸门变红时先看它，比读 1700 条比较结果快得多。
   */
  it("十档效果各由恰好一件部件承担（附加槽里没有两件同义部件）", () => {
    const byEffect = new Map<CombatSkillEffect, PartDef[]>();
    for (const part of PARTS) {
      if (!part.addon) continue;
      byEffect.set(part.addon.effect, [...(byEffect.get(part.addon.effect) ?? []), part]);
    }
    for (const [effect, parts] of byEffect) {
      expect(parts.map((part) => part.name), `${effect} 有两件部件承担`).toHaveLength(1);
    }
    expect(byEffect.size, "十档效果没有全部落到部件上").toBe(10);
  });

  /** 落笔纪律 2：断伤只指向腿或眼 —— 喉不留整场伤（引擎的 `woundOf` 那条）。 */
  it("断伤不指向咽喉（引擎不给喉记伤，写了就是屏幕在说假话）", () => {
    for (const part of PARTS) {
      if (part.force?.woundPart) {
        expect(part.force.woundPart, `${part.name}把断伤指向了喉`).not.toBe("throat");
      }
    }
  });

  /** 落笔纪律 3：精气型跟着器官的 affinity 走（龙涎 affinity 为空，自己声明）。 */
  it("部件的精气型 ＝ 该器官 affinity 最高的那一型（affinity 为空的除外）", () => {
    const index = organIndex(CONTENT);
    for (const part of PARTS) {
      const organ = index.get(part.organId);
      const entries = Object.entries(organ?.affinity ?? {}).filter(([, w]) => (w ?? 0) > 0);
      if (entries.length === 0) continue;
      const top = entries.sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0];
      expect(part.essenceType, `${part.name}付的型与器官 affinity 不同向`).toBe(top);
    }
  });

  it("每件部件都写了自己那一行说明（按钮上要照念，不许空着）", () => {
    for (const part of PARTS) {
      expect(part.name.length, `${part.id} 的名号不是单字`).toBe(1);
      expect(part.desc.length).toBeGreaterThan(6);
      for (const slot of FORGE_SLOTS) {
        const payload = part[slot];
        if (payload) expect(payload.text.length, `${part.name}·${slot} 没写说明`).toBeGreaterThan(4);
      }
    }
  });

  /**
   * 「凑得到」：一世平均只蜕 2.7 件，所以**任意一枚神种 ＋ 任意两件常规器官**
   * 有相当比例要能凑出三个槽。判据取「三件之内凑得成的组合占比 ≥60%」——
   * 低于这个数，凝招在大半的一世里根本按不动，而那等于这一批没做。
   * 本版实测 **187/198 ＝ 94.4%**（判据留的余量是给 B3 加器官用的）。
   */
  it("三件器官（神种 ＋ 两件蜕出来的）里六成以上凑得出三个槽", () => {
    const seedOrganIds = CONTENT.seeds.map((seed) => seed.organ.id);
    const moltIds = CONTENT.organs.map((organ) => organ.id);
    let ok = 0;
    let total = 0;
    for (const seedId of seedOrganIds) {
      for (let i = 0; i < moltIds.length; i += 1) {
        for (let j = i + 1; j < moltIds.length; j += 1) {
          total += 1;
          const owned = [seedId, moltIds[i] as string, moltIds[j] as string];
          const parts = PARTS.filter((part) => owned.includes(part.organId));
          // 三件部件恰好占三个槽 —— 有解即算凑得出（全排列只有 6 种，直接扫）
          const fits = parts.some((open) =>
            parts.some(
              (force) =>
                force !== open &&
                parts.some(
                  (addon) =>
                    addon !== open &&
                    addon !== force &&
                    open.open !== undefined &&
                    force.force !== undefined &&
                    addon.addon !== undefined,
                ),
            ),
          );
          if (fits) ok += 1;
        }
      }
    }
    expect(ok / total, `${ok}/${total} 组三件器官凑得出三个槽`).toBeGreaterThanOrEqual(0.6);
  });
});

describe("严格占优闸门（验收第三问：应为 0）", () => {
  it("全枚举：没有任何一种拼法严格占优于另一种", () => {
    const report = forgeDominanceReport(CONTENT);
    // 覆盖范围要报出来 —— 一道只查了三种组合的闸门与没有闸门是一回事
    expect(report.combos, "候选拼法太少，闸门等于没查").toBeGreaterThan(300);
    expect(
      report.pairs.map((pair) => `${pair.winner} 占优 ${pair.loser}（${pair.why}）`),
    ).toEqual([]);
  });

  /**
   * **阳性对照**：把检测器指向一份被故意改坏的内容，它必须当场报出来。
   *
   * 没有这一条，「0 条占优」与「检测器根本没在跑」在测试报告里长得一模一样
   * （P2 那道闸门也配了同样的对照：把稳健档写满、德行档写空，检测器立刻报出来）。
   *
   * 改坏的方式用的是**这一批真的踩到过的那一种**：把「穿地」的伤害系数放回 S1 的 1.8。
   * 自拟招的总系数上界是 2.0（起手 齿 1.4 ＋ 力道 爪／齿／胎 0.6），所以一条停在 2.0 以内的
   * 单效果古法，一定存在一副**同效果、伤害不低、精气更省**的自拟拼法把它整条比下去 ——
   * 于是那条古法从此没人会习。闸门第一次跑就是这么报出来的（连同 抵撞 1.8）。
   */
  it("阳性对照：把「穿地」的系数放回 1.8，检测器当场报出它被自拟招比下去", () => {
    const broken = {
      ...CONTENT,
      synergies: CONTENT.synergies.map((synergy) =>
        synergy.name === "穿地"
          ? { ...synergy, skill: { ...synergy.skill, damageMul: 1.8 } }
          : synergy,
      ),
    };
    const pairs = forgeDominance(broken);
    expect(pairs.length, "检测器对一份被改坏的内容也报 0 —— 它没在跑").toBeGreaterThan(0);
    expect(pairs.every((pair) => pair.loser === "古法·穿地")).toBe(true);
  });
});
