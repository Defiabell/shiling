/**
 * 拿**真内容**跑一遍事实提取与拼装 —— fixture 测的是管线，这里测的是「真的那 51 事件／
 * 12 器官／8 敌人放进来会不会出岔子」。
 *
 * 两件只有真内容才暴露得出来的事：
 * 1. 前缀的字面必须与 `chronicleTemplates.middleLine` 渲染出来的一模一样（真模板带汉字数字
 *    与「初岁」分支，fixture 那份没有）—— 对不上，回落那一刻两版编年就会打架。
 * 2. 专名目录里的名字互不为**真子串**（「穷奇」是「穷奇幼崽」的子串，那是有意的别名；
 *    别的若撞上，编造检查会误伤或漏检）。
 *
 * tale-content 只作为 devDependency 出现：运行时依赖方向仍是 client → ai → sim。
 */

import { describe, expect, it } from "vitest";
import { TALE_CONTENT } from "@shiling/tale-content";
import { composeChronicle, createLife, type LifeRecord, type TaleState } from "@shiling/tale-sim";
import { collectLifeFacts } from "../src/index.js";

const SEED_ID = TALE_CONTENT.seeds[0]?.id ?? "";

function realLife(records: LifeRecord[]): TaleState {
  const base = createLife(20260813, SEED_ID, TALE_CONTENT);
  return {
    ...base,
    year: 9,
    alive: false,
    ending: "slain",
    records: [...base.records, ...records],
  };
}

const KILL: LifeRecord = {
  year: 3,
  season: 2,
  kind: "combat",
  text: "搏杀草狐，食其精气。",
  refId: "cao-hu",
};
const MOLT: LifeRecord = {
  year: 5,
  season: 0,
  kind: "molt",
  text: "蛰伏一季，蜕生狩齿。",
  refId: "gou-chi",
};

describe("真内容", () => {
  it("摘录前缀与真模板渲染出来的中段逐字对齐", () => {
    const state = realLife([MOLT, KILL]);
    const facts = collectLifeFacts(state, TALE_CONTENT);
    const middle = composeChronicle(state, TALE_CONTENT).body.split("\n").slice(1, -2);
    expect(facts.excerpts).toHaveLength(middle.length);
    facts.excerpts.forEach((excerpt, index) => {
      expect(middle[index]).toBe(`${excerpt.prefix}，${excerpt.text}`);
    });
    // 出生那条恒是「初岁X」（真模板的 {{^year}} 分支）
    expect(facts.excerpts[0]?.prefix.startsWith("初岁")).toBe(true);
  });

  it("目录专名之间只有「穷奇」这一类刻意的别名关系", () => {
    const facts = collectLifeFacts(realLife([MOLT, KILL]), TALE_CONTENT);
    const nouns = facts.catalogNouns;
    const collisions = nouns.filter((a) =>
      nouns.some((b) => b !== a && b.includes(a) && !b.startsWith(a)),
    );
    expect(collisions).toEqual([]);
  });

  it("真内容下的白名单只含这一世的东西", () => {
    const facts = collectLifeFacts(realLife([MOLT, KILL]), TALE_CONTENT);
    expect(facts.allowedNouns).toContain("草狐");
    expect(facts.allowedNouns).toContain("狩齿");
    expect(facts.allowedNouns).not.toContain("玄蟒");
    expect(facts.allowedNouns).not.toContain("穷奇幼崽");
  });

  it("四种收束都能提取（成道读的是道名）", () => {
    for (const ending of ["starve", "slain", "oldage"] as const) {
      const facts = collectLifeFacts({ ...realLife([]), ending }, TALE_CONTENT);
      expect(facts.endingLabel.length).toBeGreaterThan(0);
    }
    const ascended = collectLifeFacts(
      { ...realLife([]), ending: "ascend", wayAchieved: "hualing" },
      TALE_CONTENT,
    );
    expect(ascended.endingLabel).toBe("化灵");
  });
});
