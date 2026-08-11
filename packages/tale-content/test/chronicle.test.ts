/**
 * 列传模板的分支覆盖 —— 用真引擎的 `composeChronicle` 渲染各种「一世」。
 *
 * 冒烟测试只能撞到玩出来的那几种组合（多半是德行平平的战死／寿终），而列传是玩家一世
 * 结束后**唯一读到的评语**：8 段赞语里若有一段永远选不中，或某个结局段落里有个写错的占位，
 * 玩家不会报 bug，只会觉得「这游戏的文字很敷衍」。所以这里按 de × ending 把矩阵铺开渲染。
 */

import { describe, expect, it } from "vitest";
import {
  composeChronicle,
  createLife,
  type EndingType,
  type TaleState,
} from "@shiling/tale-sim";
import { CHRONICLE_TEMPLATES, SEED_CHANG_TAI, TALE_CONTENT } from "../src/index.js";

const ENDINGS: readonly EndingType[] = ["starve", "slain", "oldage", "ascend"];
const DE_LEVELS = [0, 5, 20, 42, 70];

/** 造一具「刚死的」状态：真出生记录 ＋ 几条中段素材 ＋ 指定德行与结局。 */
function deadLife(ending: EndingType, de: number): TaleState {
  const born = createLife(4321, SEED_CHANG_TAI, TALE_CONTENT);
  return {
    ...born,
    year: 12,
    season: 2,
    alive: false,
    ending,
    stats: { ...born.stats, de, ling: 30 },
    organIds: [...born.organIds, "gou-chi", "wu-mu"],
    records: [
      ...born.records,
      { year: 3, season: 1, kind: "molt", text: "蛰伏一季，蜕生狩齿。", refId: "gou-chi" },
      { year: 5, season: 0, kind: "combat", text: "搏杀草狐，食其精气。", refId: "cao-hu" },
      { year: 9, season: 2, kind: "molt", text: "蛰伏一季，蜕生雾目。", refId: "wu-mu" },
      { year: 12, season: 2, kind: "death", text: "力尽，横死于青丘荒野。" },
    ],
  };
}

describe("列传模板", () => {
  it("四结局 × 五档德行都渲染得出，且不留占位", () => {
    for (const ending of ENDINGS) {
      for (const de of DE_LEVELS) {
        const entry = composeChronicle(deadLife(ending, de), TALE_CONTENT);
        expect(entry.body, `${ending}/de=${de} 有漏填占位`).not.toMatch(/\{\{\w+\}\}/);
        expect(entry.title).toBe("食灵列传·常胎");
        expect(entry.ending).toBe(ending);
        expect(entry.body.startsWith("食灵者")).toBe(true);
        expect(entry.body).toContain(CHRONICLE_TEMPLATES.endings[ending]);
        expect(entry.body).toContain(CHRONICLE_TEMPLATES.praisePrefix);
      }
    }
  });

  it("中段按史记笔法编年摘录（蜕变与搏杀都入传）", () => {
    const body = composeChronicle(deadLife("oldage", 30), TALE_CONTENT).body;
    expect(body).toContain("3岁夏，蛰伏一季，蜕生狩齿。");
    expect(body).toContain("5岁春，搏杀草狐，食其精气。");
    // 开篇总账要把一世的数字说清楚
    expect(body).toContain("凡历12岁");
    expect(body).toContain("蜕2");
    expect(body).toContain("杀1");
  });

  it("赞语真的按德行与结局分支（至少 4 段变体能被选中）", () => {
    const praises = new Set<string>();
    for (const ending of ENDINGS) {
      for (const de of DE_LEVELS) {
        const body = composeChronicle(deadLife(ending, de), TALE_CONTENT).body;
        const lines = body.split("\n");
        praises.add(lines[lines.length - 1] ?? "");
      }
    }
    expect(praises.size, `只选中了 ${praises.size} 段赞语`).toBeGreaterThanOrEqual(4);
  });

  it("登神＋厚德是最高一档评语，暴戾横死是最低一档", () => {
    const saintly = composeChronicle(deadLife("ascend", 70), TALE_CONTENT).body;
    expect(saintly).toContain("与云气同流");
    const brute = composeChronicle(deadLife("slain", 0), TALE_CONTENT).body;
    expect(brute).toContain("以杀始，以杀终");
  });
});
