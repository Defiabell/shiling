/**
 * 生成包的事后审计 —— 把 E2E 打出来的 `scenario-report.json` 逐条过一遍闸门。
 *
 * 存在的理由：验收那五问里有三问（严格占优是否为 0、是否呼应本世前提、id 是否都合法）
 * **应该是机械可判的**，而不是靠人读十六条事件再下结论。生成那一刻已经过了一遍闸门，
 * 这里是**独立复核**：拿玩家机器上真正存下来的那份包（localStorage 的原样）再走一次判据，
 * 万一注入／持久化那一段把什么弄坏了，这里会吵。
 *
 * 用法（在 packages/tale-ai 下）：
 *   pnpm audit-pack ../tale-client/screenshots/p2/scenario-report.json
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { TALE_CONTENT } from "@shiling/tale-content";
import type { TaleEvent } from "@shiling/tale-sim";
import { EVENTS } from "@shiling/tale-content";
import { auditEvent, dominancePairs, longestSharedSpan } from "../src/index.js";

const CONTENT = TALE_CONTENT;

interface Life {
  label: string;
  seed: number;
  skyId: string;
  originId: string;
  genWaitS: number;
  pack: { cacheKey: string; version: number; events: TaleEvent[] } | null;
  generatedSeen: { id: string; title: string }[];
  life: { years: number; ending: string; eventsSeen: number };
}

const PREMISE_KEYWORDS: Record<string, readonly string[]> = {
  "sky-drought": ["旱", "涸", "渴", "干", "水", "泉", "溪", "雨", "碱", "潭", "见底"],
  "sky-beast-tide": ["兽潮", "成群", "群", "南", "北", "嚎", "窜", "逃"],
  "sky-spirit-flux": ["灵气", "青光", "荧", "芒", "异", "露", "通灵", "光"],
  "sky-early-winter": ["寒", "冬", "雪", "冰", "霜", "冻", "枯", "僵"],
  "origin-solitary": ["孤", "独", "无伴", "同类", "只身", "单", "一只"],
  "origin-spirit-womb": ["眼", "神识", "睁", "视", "异于", "先", "明"],
  "origin-breech": ["异", "痕", "疤", "逆", "绕", "避", "怪", "祥"],
  "origin-twin": ["同胞", "双", "同穴", "伴", "一模一样", "兄", "弟", "另一个"],
};

function auditLife(life: Life): void {
  const events = life.pack?.events ?? [];
  console.log(`\n${"=".repeat(78)}`);
  console.log(
    `${life.label}　种子 ${life.seed}　${life.skyId} / ${life.originId}　生成 ${events.length} 条（等了 ${life.genWaitS}s）` +
      `　一世 ${life.life.years} 岁 ${life.life.ending}，撞上 ${life.life.eventsSeen} 桩事，其中生成的 ${life.generatedSeen.length} 条`,
  );

  const dominated = events.flatMap((event) =>
    dominancePairs(event).map(([strong, weak]) => `${event.id}：选项${strong + 1} 占优于 选项${weak + 1}`),
  );
  console.log(`严格占优：${dominated.length} 条${dominated.length > 0 ? `\n  ${dominated.join("\n  ")}` : "（0＝达标）"}`);

  const bad = events.flatMap((event) => auditEvent(event, CONTENT).map((problem) => `${event.id}：${problem}`));
  console.log(`id 白名单／字段终审：${bad.length} 条问题${bad.length > 0 ? `\n  ${bad.join("\n  ")}` : "（0＝达标）"}`);

  const skyWords = PREMISE_KEYWORDS[life.skyId] ?? [];
  const originWords = PREMISE_KEYWORDS[life.originId] ?? [];
  const echoed = events.filter((event) =>
    [...skyWords, ...originWords].some((word) => event.body.includes(word)),
  );
  console.log(
    `呼应本世前提（正文里出现天时／出身的母题词）：${echoed.length}/${events.length} 条` +
      `　命中词：${[...new Set(events.flatMap((event) => [...skyWords, ...originWords].filter((word) => event.body.includes(word))))].join("、")}`,
  );

  const written = EVENTS.map((event) => event.body);
  const collided = events.filter((event) =>
    written.some((body) => longestSharedSpan(event.body, body, 12) !== null),
  );
  console.log(`与手写事件撞正文：${collided.map((event) => event.id).join("、") || "无（0＝达标）"}`);

  const lengths = events.map((event) => [...event.body].length).sort((a, b) => a - b);
  console.log(
    `正文长度：min ${lengths[0]}　中位 ${lengths[Math.floor(lengths.length / 2)]}　max ${lengths[lengths.length - 1]}` +
      `（手写 51 条实测 60〜91，中位 67）`,
  );
  const labels = events.flatMap((event) => event.choices.map((choice) => choice.label));
  console.log(`选项字面 ${labels.length} 个，去重后 ${new Set(labels).size} 个`);
}

function main(): number {
  const path = resolve(process.cwd(), process.argv[2] ?? "");
  const report = JSON.parse(readFileSync(path, "utf8")) as Record<string, Life>;
  for (const key of ["lifeA", "lifeB"]) {
    const life = report[key];
    if (life) auditLife(life);
  }
  const a = report.lifeA?.pack?.events ?? [];
  const b = report.lifeB?.pack?.events ?? [];
  console.log(`\n${"=".repeat(78)}`);
  console.log(
    `两世交叉：标题重合 ${a.filter((event) => b.some((other) => other.title === event.title)).length} 条` +
      `　正文最长公共片段 ≥12 字的对子 ${a.filter((event) => b.some((other) => longestSharedSpan(event.body, other.body, 12) !== null)).length} 对`,
  );
  return 0;
}

process.exitCode = main();
