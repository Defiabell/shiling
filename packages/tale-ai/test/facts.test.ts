/**
 * 事实提取 —— 「AI 只能写发生过的事」的第一道机制（第二道是 validate）。
 *
 * 最要紧的一条断言：**摘录选法与 `composeChronicle` 完全一致**。两版列传若讲的不是同一条
 * 时间线，回落那一刻玩家会读到两份互相矛盾的编年，而回落恰恰是最不该出岔子的路径。
 */

import { describe, expect, it } from "vitest";
import { composeChronicle, type LifeRecord } from "@shiling/tale-sim";
import { collectLifeFacts, excerptPrefix } from "../src/index.js";
import { CONTENT, DEATH_RECORD, KILL_RECORD, MOLT_RECORD, finishedLife } from "./helpers.js";

describe("collectLifeFacts 前置", () => {
  it("一世未结束时抛错（同 composeChronicle）", () => {
    const alive = { ...finishedLife({ ending: "oldage" }), alive: true };
    expect(() => collectLifeFacts(alive, CONTENT)).toThrow(/尚未结束/);
    const noEnding = { ...finishedLife({ ending: "oldage" }), ending: null };
    expect(() => collectLifeFacts(noEnding, CONTENT)).toThrow(/尚未结束/);
  });
});

describe("编年摘录", () => {
  it("与 composeChronicle 的中段逐条对得上（同一条时间线、同一个顺序）", () => {
    const state = finishedLife({ ending: "slain", extraRecords: [MOLT_RECORD, KILL_RECORD, DEATH_RECORD] });
    const facts = collectLifeFacts(state, CONTENT);
    const templateMiddle = composeChronicle(state, CONTENT)
      .body.split("\n")
      .slice(1, -2);

    expect(facts.excerpts).toHaveLength(templateMiddle.length);
    facts.excerpts.forEach((excerpt, index) => {
      // 只断言正文与顺序：前缀的**字面**由内容的 middleLine 模板决定（fixture 那份是
      // 简化版，没有汉字数字与「初岁」分支），真内容的前缀逐字对齐在 real-content.test.ts
      expect(templateMiddle[index]).toContain(excerpt.text);
    });
  });

  it("首条恒为出生，死亡记录不入摘录（同引擎的记录纪律）", () => {
    const facts = collectLifeFacts(
      finishedLife({ ending: "slain", extraRecords: [MOLT_RECORD, KILL_RECORD, DEATH_RECORD] }),
      CONTENT,
    );
    expect(facts.excerpts[0]?.kind).toBe("birth");
    expect(facts.excerpts.some((excerpt) => excerpt.kind === "death")).toBe(false);
    expect(facts.deathText).toBe(DEATH_RECORD.text);
  });

  it("前缀用汉字数字，零岁读作「初岁」", () => {
    expect(excerptPrefix(0, 0, ["春", "夏", "秋", "冬"])).toBe("初岁春");
    expect(excerptPrefix(12, 2, ["春", "夏", "秋", "冬"])).toBe("十二岁秋");
  });

  it("摘录条数吃 chronicleMaxExcerpts（与模板同一个上限）", () => {
    const many: LifeRecord[] = Array.from({ length: 20 }, (_, index) => ({
      ...MOLT_RECORD,
      year: index + 1,
    }));
    const facts = collectLifeFacts(finishedLife({ ending: "oldage", extraRecords: many }), CONTENT);
    // birth ＋ 上限条
    expect(facts.excerpts.length).toBe(1 + CONTENT.tuning.chronicleMaxExcerpts);
  });
});

describe("专名白名单与目录", () => {
  it("白名单含身上的器官、蜕出的器官、搏杀取胜者与咬死自己的兽", () => {
    const facts = collectLifeFacts(
      finishedLife({ ending: "slain", extraRecords: [MOLT_RECORD, KILL_RECORD, DEATH_RECORD] }),
      CONTENT,
    );
    expect(facts.allowedNouns).toContain("狩齿");
    expect(facts.allowedNouns).toContain("野雉");
    expect(facts.allowedNouns).toContain("灵蕴");
    expect(facts.killerName).toBe("野雉");
    expect(facts.killedNames).toEqual(["野雉"]);
    expect(facts.moltNames).toEqual(["狩齿"]);
  });

  it("目录覆盖全内容的器官／敌人／神种名，且没打过的兽不在白名单里", () => {
    const facts = collectLifeFacts(finishedLife({ ending: "oldage", extraRecords: [] }), CONTENT);
    const otherEnemy = CONTENT.enemies.find((enemy) => enemy.name !== "野雉");
    expect(otherEnemy).toBeDefined();
    expect(facts.catalogNouns).toContain(otherEnemy?.name);
    expect(facts.allowedNouns).not.toContain(otherEnemy?.name);
  });

  it("records 文本里真出现过的专名进白名单（遇见过≠杀过，但确实发生过）", () => {
    const met: LifeRecord = {
      year: 4,
      season: 0,
      kind: "event",
      text: "谷底横着一条垂死的穷奇幼崽，看了它一眼便走开。",
      refId: "some-event",
    };
    const facts = collectLifeFacts(finishedLife({ ending: "oldage", extraRecords: [met] }), CONTENT);
    expect(facts.allowedNouns).toContain("穷奇幼崽");
    // 别名：史笔多半只写「穷奇」，那也该放行
    expect(facts.allowedNouns).toContain("穷奇");
  });
});

describe("成道与前提", () => {
  it("成道时报的是那条道，未成道时报最接近的那条与差什么", () => {
    const ascended = collectLifeFacts(finishedLife({ ending: "ascend", way: "guishan" }), CONTENT);
    expect(ascended.way).toBe("guishan");
    expect(ascended.wayLabel).toBe("归山");
    expect(ascended.endingLabel).toBe("归山");

    const failed = collectLifeFacts(finishedLife({ ending: "oldage", year: 3 }), CONTENT);
    expect(failed.way).toBeNull();
    expect(failed.nearestWay.shortfalls.length).toBeGreaterThan(0);
    // 差距说的是人话且用汉字数字
    expect(failed.nearestWay.shortfalls.join("")).not.toMatch(/[0-9]/u);
  });

  it("天时与出身进事实（列传开篇要交代这一世的前提）", () => {
    const facts = collectLifeFacts(finishedLife({ ending: "oldage" }), CONTENT);
    expect(facts.skyName).toBe("常年");
    expect(facts.originName).toBe("常胎");
    expect(facts.seedName).toBe("灵蕴神种");
  });
});
