/**
 * prompt 构造 —— 这里的断言盯的都是**会污染输出的输入**。
 *
 * 最要紧的一条：事实清单里不许出现阿拉伯数字。prompt 里漏一个「7」，输出里就会回来一片
 * ——「数字一律汉字」那条体例靠的是把转换做在代码这边，不是靠嘱咐模型。
 */

import { describe, expect, it } from "vitest";
import {
  OPENING_ANGLES,
  assembleBody,
  buildMessages,
  collectLifeFacts,
  factsBlock,
  openingAngle,
  styleAnchors,
} from "../src/index.js";
import { CONTENT, DEATH_RECORD, KILL_RECORD, MOLT_RECORD, finishedLife, goodDraft } from "./helpers.js";

const STATE = finishedLife({ ending: "slain", extraRecords: [MOLT_RECORD, KILL_RECORD, DEATH_RECORD] });
const FACTS = collectLifeFacts(STATE, CONTENT);

describe("事实清单", () => {
  it("整段没有阿拉伯数字（数字全部预先汉字化）", () => {
    expect(factsBlock(FACTS)).not.toMatch(/[0-9]/u);
  });

  it("给了前提、总账、编年与可用专名四块", () => {
    const block = factsBlock(FACTS);
    for (const heading of ["【本世前提】", "【一世总账】", "【编年", "【可用专名"]) {
      expect(block).toContain(heading);
    }
    for (const excerpt of FACTS.excerpts) expect(block).toContain(excerpt.prefix);
    expect(block).toContain("野雉");
  });

  it("没打过的兽不会出现在事实清单里（只给发生过的事）", () => {
    const other = CONTENT.enemies.find((enemy) => enemy.name !== "野雉")?.name ?? "";
    expect(factsBlock(FACTS)).not.toContain(other);
  });
});

describe("消息组装", () => {
  it("system ＋ 一条 user，user 里带语感锚与这一世的模板版", () => {
    const messages = buildMessages({
      facts: FACTS,
      anchors: ["丛内有物在动。"],
      templateBody: "食灵者，无名。\n赞曰：兽之常也。",
    });
    expect(messages.map((message) => message.role)).toEqual(["system", "user"]);
    expect(messages[1]?.content).toContain("丛内有物在动。");
    expect(messages[1]?.content).toContain("赞曰：兽之常也。");
    expect(messages[1]?.content).toContain("不得沿用");
  });

  it("每一篇带一条专属起法，且同一局重放取到同一条", () => {
    const messages = buildMessages({ facts: FACTS, anchors: ["锚"], templateBody: "模板" });
    expect(messages[1]?.content).toContain("【本篇起法");
    expect(messages[1]?.content).toContain(openingAngle(FACTS));
    // 轮转键是 seed，不是随机数 —— 同一局重放必须得到同一篇（架构红线 1）
    expect(openingAngle(FACTS)).toBe(openingAngle({ ...FACTS }));
    const shifted = OPENING_ANGLES.map((_, index) => openingAngle({ ...FACTS, variant: index }));
    expect(new Set(shifted).size).toBe(OPENING_ANGLES.length);
  });

  it("风格锚取自真手写事件正文（内容换了也不会空手）", () => {
    const anchors = styleAnchors(CONTENT);
    expect(anchors.length).toBeGreaterThan(0);
    for (const anchor of anchors) expect(anchor.length).toBeGreaterThan(10);
  });
});

describe("正文拼装", () => {
  it("结构与 composeChronicle 同形：开篇／每条编年一行／收束／赞曰", () => {
    const prefixes = FACTS.excerpts.map((excerpt) => excerpt.prefix);
    const body = assembleBody(goodDraft(prefixes), "赞曰：");
    const lines = body.split("\n");
    expect(lines[0]).toContain("食灵者");
    expect(lines).toHaveLength(prefixes.length + 3);
    expect(lines[lines.length - 1]?.startsWith("赞曰：")).toBe(true);
  });
});
