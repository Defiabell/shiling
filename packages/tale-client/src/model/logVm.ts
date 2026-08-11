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
  /** 连续重复的条数（>1 时界面显示「×N」）；不重复为 1 */
  repeat: number;
}

/**
 * 最近 N 条，**最新在前**（右侧栏自上而下读），并把**连续重复**的同一句合成一条 ×N。
 *
 * 为什么要合：引擎对「探索但没抽到事件」只有一句固定旁白（「循青丘旧径独行，草木皆是生面。」），
 * 连探三季就在 6 条可见位里占掉三格一模一样的字，读起来像界面坏了 —— 而且把真正发生过的事
 * 挤出了栏外。合成「×3」既省位子，又如实表达「这几季什么都没发生」。
 * 只合**相邻且同句**的，不做全局去重（隔了别的事再发生一次是新的一次）。
 */
export function recentLogVm(buffer: LogBuffer, limit: number = LOG_VISIBLE): LogLineVm[] {
  const merged: LogLineVm[] = [];
  // 从最新往旧走，遇到与上一条同句就并进去（并进去的 id／时间戳取这一组里最新那条）。
  // 注意 limit 只拦「要新起一条」的时候：若把它写进循环条件，凑满 6 条就停，
  // 最后那一组的 ×N 会少算（明明重复了五次却显示 ×2）。
  for (let i = buffer.entries.length - 1; i >= 0; i -= 1) {
    const entry = buffer.entries[i];
    if (!entry) continue;
    const last = merged[merged.length - 1];
    if (last && last.text === entry.text && last.tone === entry.tone) {
      last.repeat += 1;
      continue;
    }
    if (merged.length >= limit) break;
    merged.push({
      id: entry.id,
      stamp: `${formatYearCn(entry.year)}岁${formatSeason(entry.season)}`,
      text: entry.text,
      tone: entry.tone,
      repeat: 1,
    });
  }
  return merged;
}
