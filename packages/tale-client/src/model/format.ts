/**
 * 纯格式化工具 —— 状态数字 → 界面文案。
 *
 * 全部无 DOM 依赖，单测直接盖。中文文案一律全角标点。
 */

import type { EndingType, EssenceType, Season } from "@shiling/tale-sim";

const CN_DIGITS = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"] as const;

/**
 * 0〜99 的汉字数字；越界返回 null（调用方自己决定退回阿拉伯数字还是别的说法）。
 */
function cnNumber(value: number): string | null {
  const n = Math.floor(value);
  if (!Number.isFinite(n) || n < 0 || n > 99) return null;
  if (n < 10) return CN_DIGITS[n] ?? null;
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  const tensPart = tens === 1 ? "十" : `${CN_DIGITS[tens] ?? ""}十`;
  return ones === 0 ? tensPart : `${tensPart}${CN_DIGITS[ones] ?? ""}`;
}

/**
 * 岁数汉字化：0 → "初"，1〜99 → "一"…"九十九"，≥100 退回阿拉伯数字。
 *
 * 数字风格的分工（全局一致，别混）：**岁数出现在散文与标题里用汉字**（「三岁 · 秋 · 青丘」，
 * 混排 "3 岁" 会把状态栏拉回仪表盘气质）；**可比对的量值用阿拉伯数字**（属性／饱食／
 * 精气／器官件数）。列传卷轴正文是引擎按内容模板生成的（那边用阿拉伯数字），所以卷轴上
 * 我这一侧的元信息也跟着用阿拉伯数字，免得同屏三行里两种数字并置。
 */
export function formatYearCn(year: number): string {
  const y = Math.floor(year);
  if (!Number.isFinite(y) || y < 0 || y === 0) return "初";
  return cnNumber(y) ?? String(y);
}

/** 计数汉字化（器官件数、蜕变次数等）：0〜99 给汉字，越界退回阿拉伯数字。 */
export function formatCountCn(count: number): string {
  return cnNumber(count) ?? String(Math.floor(count));
}

export const SEASON_NAMES: readonly [string, string, string, string] = ["春", "夏", "秋", "冬"];

export function formatSeason(season: Season): string {
  return SEASON_NAMES[season];
}

export const REGION_NAMES: Record<string, string> = { qingqiu: "青丘" };

export function formatRegion(region: string): string {
  return REGION_NAMES[region] ?? region;
}

/** 「三岁 · 秋 · 青丘」 */
export function formatWhen(year: number, season: Season, region: string): string {
  return `${formatYearCn(year)}岁 · ${formatSeason(season)} · ${formatRegion(region)}`;
}

export const STAT_LABELS = { meng: "猛", ling: "灵", ti: "体", de: "德" } as const;
export type StatKey = keyof typeof STAT_LABELS;
export const STAT_ORDER: readonly StatKey[] = ["meng", "ling", "ti", "de"];

export const STAT_HINTS: Record<StatKey, string> = {
  meng: "搏杀之力",
  ling: "悟性与神通",
  ti: "血肉与寿数",
  de: "气运与人心",
};

export const ESSENCE_LABELS: Record<EssenceType, string> = {
  zu: "足",
  lin: "鳞",
  xue: "穴",
  meng: "猛",
};
export const ESSENCE_ORDER: readonly EssenceType[] = ["zu", "lin", "xue", "meng"];

export const ENDING_LABELS: Record<EndingType, string> = {
  starve: "饿殍",
  slain: "横死",
  oldage: "寿终",
  ascend: "登神",
};

/** 死亡屏的一句话定性（列传正文之外的门楣题字）。 */
export const ENDING_EPITAPHS: Record<EndingType, string> = {
  starve: "饥馑连季，形销骨立。",
  slain: "力尽爪牙之下，血沃荒原。",
  oldage: "寿数既尽，卧于旧穴而化。",
  ascend: "白光贯顶，脱兽籍而列神班。",
};

/** 带符号的增量文案：+6 / −2 / 0 用全角减号，避免与连字符混淆。 */
export function formatSigned(value: number): string {
  if (value > 0) return `+${value}`;
  if (value < 0) return `−${Math.abs(value)}`;
  return "0";
}

/** 百分比（0〜1 → 0〜100 整数），越界夹紧。 */
export function toPercent(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  return Math.round(Math.min(1, Math.max(0, ratio)) * 100);
}
