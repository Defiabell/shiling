/**
 * 纯格式化工具 —— 状态数字 → 界面文案。
 *
 * 全部无 DOM 依赖，单测直接盖。中文文案一律全角标点。
 */

import {
  cnNumeral,
  type AscendGateId,
  type EndingType,
  type EssenceType,
  type OrganSlot,
  type Season,
} from "@shiling/tale-sim";

/**
 * 岁数汉字化：0 → "初"，1〜99 → "一"…"九十九"，≥100 退回阿拉伯数字。
 *
 * 数字风格的分工（全局一致，别混）：**散文里的数字一律汉字** —— 状态栏的岁数
 * （「三岁 · 秋 · 青丘」）、列传卷轴的正文与元信息、死亡屏摘要；**只有要横向比对的量值
 * 用阿拉伯数字**（属性／饱食／精气／血统点这些盯着看涨跌的）。列传正文由引擎按 B2 的
 * 模板生成，那边同样是汉字（`{{years|cn}}`），所以卷轴上下不会并置两种数字体系。
 *
 * 汉字数字表只有一份，在 tale-sim（`cnNumeral`）—— 界面与列传模板共用它。
 */
export function formatYearCn(year: number): string {
  const y = Math.floor(year);
  if (!Number.isFinite(y) || y <= 0) return "初";
  return cnNumeral(y);
}

/** 计数汉字化（器官件数、蜕变次数等）：0〜99 给汉字，越界退回阿拉伯数字。 */
export function formatCountCn(count: number): string {
  return cnNumeral(count);
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

/**
 * 属性的**一句机制**（不是风味）。
 *
 * 原先这里写的是「搏杀之力」「血肉与寿数」——读完仍然不知道那个数字改变了什么，于是
 * owner 的原话是「每个属性值有啥用……只能乱点」。真正的说明由 `detailVm` 用玩家当前的
 * 数值实例化（「出手底伤 4　·　扑击命中 +4%」），本表只留一句**它管哪一摊**，
 * 用在详情浮层的副标题上，好让人知道点开会看到什么。
 */
export const STAT_SCOPES: Record<StatKey, string> = {
  meng: "搏杀出手与扑击命中",
  ling: "遁走成算、登神门槛与抉择",
  ti: "搏杀血量与寿限",
  de: "登神门槛与抉择",
};

/** 器官槽位的汉字名（`OrganDef.slot` → 屏幕上的字）。 */
export const ORGAN_SLOT_LABELS: Record<OrganSlot, string> = {
  eye: "目",
  tooth: "齿",
  hide: "皮",
  limb: "肢",
  gut: "腹",
  spirit: "神",
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

/**
 * 死亡屏的一句话定性（列传正文之外的门楣题字）。
 *
 * [M1-P2] `oldage` 改成**明确的失败**：原句「寿数既尽，卧于旧穴而化」读起来像一件圆满的事，
 * 而 owner 验收 M0 的原话是「最后寿终正寝，让人没有再次玩的欲望」。中性的收尾不会让人
 * 追问「我差了什么」—— 这一屏的下一行正是差距报告，题字得先把人推到那个问题上。
 */
export const ENDING_EPITAPHS: Record<EndingType, string> = {
  starve: "饥馑连季，形销骨立。",
  slain: "力尽爪牙之下，血沃荒原。",
  oldage: "终未成器，与草木同朽。",
  ascend: "白光贯顶，脱兽籍而列神班。",
};

/** 登神四门槛的汉字名（`AscendGate.id` → 屏幕上的字）。 */
export const ASCEND_GATE_LABELS: Record<AscendGateId, string> = {
  year: "寿",
  organs: "器",
  ling: "灵",
  de: "德",
};

/** 差距报告里的说法：「差二件器官」「灵性差九」。 */
export const ASCEND_GATE_SHORTFALL: Record<AscendGateId, (short: number) => string> = {
  year: (short) => `寿数差${formatCountCn(short)}岁`,
  organs: (short) => `差${formatCountCn(short)}件器官`,
  ling: (short) => `灵性差${formatCountCn(short)}`,
  de: (short) => `德行差${formatCountCn(short)}`,
};

/** 带符号的增量文案：+6 / −2 / 0 用全角减号，避免与连字符混淆。 */
export function formatSigned(value: number): string {
  if (value > 0) return `+${value}`;
  if (value < 0) return `−${Math.abs(value)}`;
  return "0";
}

const CN_DIGITS = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"] as const;

/**
 * 概率的汉字读法：0.72 → 「七成二」。整成时省掉零（0.7 → 「七成」）。
 *
 * 追猎屏、搏杀屏与属性详情共用一份 —— 同一个游戏里「命中七成四」与「遁走 66%」两种读法
 * 并置，玩家要在脑子里换算两次单位。
 *
 * `zeroLabel` 是唯一的方言：搏杀屏的「招反击」写 `无` 比写 `〇成` 短且更像话，
 * 而量表类读数要的是「〇成」这个量。除此之外三处逐字同解。
 */
export function chanceCn(chance: number, zeroLabel = "〇成"): string {
  const tenths = Math.round(chance * 100);
  if (tenths >= 100) return "十成";
  if (tenths <= 0) return zeroLabel;
  const shi = Math.floor(tenths / 10);
  const yu = tenths % 10;
  const head = CN_DIGITS[shi] ?? "〇";
  return yu === 0 ? `${head}成` : `${head}成${CN_DIGITS[yu] ?? ""}`;
}

/** 百分比（0〜1 → 0〜100 整数），越界夹紧。 */
export function toPercent(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  return Math.round(Math.min(1, Math.max(0, ratio)) * 100);
}
