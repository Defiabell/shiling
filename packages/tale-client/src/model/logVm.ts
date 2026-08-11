/**
 * 右侧「最近 6 条」日志缓冲（纯）。
 *
 * 引擎不维护这个缓冲：`TurnResult.notices` 是一次性的，`state.combat.log` 在战斗结束那一刻
 * 就没了，`state.records` 又只收列传素材（狩猎成败不写）。所以由界面自己攒，攒的规则
 * 放这里以便单测。
 */

import type { Season } from "@shiling/tale-sim";
import { formatSeason, formatYearCn } from "./format.js";

export type LogTone = "plain" | "gain" | "loss" | "combat" | "molt" | "omen";

export interface LogEntry {
  /** 单调递增序号 —— 渲染层拿它做 key 与入场动画的去重，别用文本 */
  id: number;
  year: number;
  season: Season;
  text: string;
  tone: LogTone;
}

export interface LogBuffer {
  entries: LogEntry[];
  nextId: number;
}

/** 右侧栏可见条数（计划规定 6 条）。 */
export const LOG_VISIBLE = 6;
/** 缓冲上限：比可见条数多留一些，供将来「展开全部」，同时防止一世 80 回合无限增长。 */
export const LOG_CAPACITY = 60;

export function emptyLog(): LogBuffer {
  return { entries: [], nextId: 1 };
}

export interface LogInput {
  text: string;
  tone?: LogTone;
}

/**
 * 追加若干条并按容量截断（保留最新）。返回新缓冲，不改入参。
 *
 * 空白文本被丢弃 —— 引擎某些分支会给空 notice，让它占掉一格可见位是纯损失。
 */
export function pushLog(
  buffer: LogBuffer,
  year: number,
  season: Season,
  inputs: readonly LogInput[],
): LogBuffer {
  const added: LogEntry[] = [];
  let nextId = buffer.nextId;
  for (const input of inputs) {
    const text = input.text.trim();
    if (text.length === 0) continue;
    added.push({ id: nextId++, year, season, text, tone: input.tone ?? "plain" });
  }
  if (added.length === 0) return buffer;
  const entries = [...buffer.entries, ...added].slice(-LOG_CAPACITY);
  return { entries, nextId };
}

export interface LogLineVm {
  id: number;
  stamp: string;
  text: string;
  tone: LogTone;
}

/** 最近 N 条，**最新在前**（右侧栏自上而下读）。 */
export function recentLogVm(buffer: LogBuffer, limit: number = LOG_VISIBLE): LogLineVm[] {
  return buffer.entries
    .slice(-limit)
    .reverse()
    .map((entry) => ({
      id: entry.id,
      stamp: `${formatYearCn(entry.year)}岁${formatSeason(entry.season)}`,
      text: entry.text,
      tone: entry.tone,
    }));
}
