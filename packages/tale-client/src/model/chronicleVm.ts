/**
 * 列传卷轴视图模型（纯）。
 *
 * `composeChronicle` 返回的 `body` 是「开篇 ＼n 中段若干行 ＼n 结局 ＼n 赞曰…」的整块文本。
 * 卷轴要给赞语单独的排版（居中、朱砂、留白），所以在这里按结构拆开 —— 拆法只依赖
 * `chronicleTemplates.praisePrefix`（内容提供的「赞曰：」），不猜行数，行数不足时优雅降级。
 */

import type { ChronicleEntry, EndingType, TaleContent, TaleState } from "@shiling/tale-sim";
import { PORTRAIT_LABELS, portraitArt, portraitStage } from "../art/assets.js";
import { ENDING_EPITAPHS, ENDING_LABELS, formatCountCn, formatYearCn } from "./format.js";

/** 卷轴上的「其形」画像：一世终局的形貌（幼兽／成兽／近神）。 */
export interface PortraitStage {
  label: string;
  src: string;
}

export interface ChronicleVm {
  title: string;
  opening: string;
  /** 中段摘录，每行一条 */
  middle: string[];
  /** 结局段（不含赞语） */
  closing: string;
  /** 「赞曰：」前缀 */
  praisePrefix: string;
  /** 赞语正文（已去掉前缀） */
  praise: string;
  ending: EndingType;
  endingLabel: string;
  epitaph: string;
  years: number;
  yearsCn: string;
  organCount: number;
  organCountCn: string;
  /** 本世结算的血统点 */
  bloodlineGain: number;
  /** 终局形态的立绘（按器官数分阶），用于卷轴上的「其形」画像 */
  portrait: PortraitStage;
}

/** 按 praisePrefix 把 body 拆成 开篇／中段／结局／赞语 四段。 */
export function splitChronicleBody(
  body: string,
  praisePrefix: string,
): { opening: string; middle: string[]; closing: string; praise: string } {
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let praise = "";
  let rest = lines;
  const praiseIdx = praisePrefix
    ? lines.findLastIndex((line) => line.startsWith(praisePrefix))
    : -1;
  if (praiseIdx >= 0) {
    praise = (lines[praiseIdx] ?? "").slice(praisePrefix.length).trim();
    rest = lines.slice(0, praiseIdx);
  }

  const opening = rest[0] ?? "";
  const closing = rest.length > 1 ? (rest[rest.length - 1] ?? "") : "";
  const middle = rest.length > 2 ? rest.slice(1, -1) : [];
  return { opening, middle, closing, praise };
}

export function buildChronicleVm(
  entry: ChronicleEntry,
  bloodlineGain: number,
  content: TaleContent,
): ChronicleVm {
  const praisePrefix = content.chronicleTemplates.praisePrefix;
  const parts = splitChronicleBody(entry.body, praisePrefix);
  const stage = portraitStage(entry.organCount, content.tuning.ascendMinOrgans);
  return {
    title: entry.title,
    opening: parts.opening,
    middle: parts.middle,
    closing: parts.closing,
    praisePrefix,
    praise: parts.praise,
    ending: entry.ending,
    endingLabel: ENDING_LABELS[entry.ending],
    epitaph: ENDING_EPITAPHS[entry.ending],
    years: entry.years,
    yearsCn: formatYearCn(entry.years),
    organCount: entry.organCount,
    organCountCn: formatCountCn(entry.organCount),
    bloodlineGain,
    portrait: { label: PORTRAIT_LABELS[stage], src: portraitArt(stage) },
  };
}

/** 死亡屏用的极简摘要（墨渍散尽前的那一屏，不上列传全文）。 */
export interface DeathVm {
  endingLabel: string;
  epitaph: string;
  /** 引擎写的那条 death 记录原文；缺失时退回 epitaph */
  lastWords: string;
  yearsCn: string;
  organCount: number;
  killCount: number;
  moltCount: number;
  /** 一句史记式收尾（零值有专门说法，不出现「蜕〇」这种话） */
  summary: string;
}

/**
 * 「凡历四岁，成器官二，蜕一，杀三。」
 *
 * 零值单独措辞：`蜕〇`／`杀〇` 是机器话，会在死亡这一屏破掉整段文气。
 */
export function composeDeathSummary(
  years: number,
  organCount: number,
  moltCount: number,
  killCount: number,
): string {
  const parts = [`凡历${formatYearCn(years)}岁`, `成器官${formatCountCn(organCount)}`];
  parts.push(moltCount > 0 ? `蜕${formatCountCn(moltCount)}` : "未尝蜕形");
  parts.push(killCount > 0 ? `杀${formatCountCn(killCount)}` : "未尝杀生");
  return `${parts.join("，")}。`;
}

export function buildDeathVm(state: TaleState): DeathVm {
  const ending: EndingType = state.ending ?? "oldage";
  const death = state.records.findLast((record) => record.kind === "death");
  const organCount = state.organIds.length;
  const killCount = state.records.filter((record) => record.kind === "combat").length;
  const moltCount = state.records.filter((record) => record.kind === "molt").length;
  return {
    endingLabel: ENDING_LABELS[ending],
    epitaph: ENDING_EPITAPHS[ending],
    lastWords: death?.text ?? ENDING_EPITAPHS[ending],
    yearsCn: formatYearCn(state.year),
    organCount,
    killCount,
    moltCount,
    summary: composeDeathSummary(state.year, organCount, moltCount, killCount),
  };
}
