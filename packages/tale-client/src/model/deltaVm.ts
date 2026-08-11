/**
 * 状态前后差分 → 数值飘字规格（纯）。
 *
 * 为什么不直接读 `ChoiceResult.delta`：那是内容**声明**的原始值（未夹紧、不含引擎自己
 * 扣的季耗与蜕变加成）。玩家眼里的真相是「这一步之后我的数字变了多少」，所以按前后两个
 * state 差分算。锚点用稳定的字符串 key，渲染层据此找到状态栏上对应的元素。
 */

import type { EssenceType, TaleState } from "@shiling/tale-sim";
import { ESSENCE_LABELS, ESSENCE_ORDER, STAT_LABELS, STAT_ORDER, formatSigned } from "./format.js";

export type FloaterTone = "gain" | "loss" | "essence" | "omen";

export interface FloaterSpec {
  /** 状态栏锚点：`stat:meng` / `hunger` / `essence:zu` */
  anchor: string;
  text: string;
  tone: FloaterTone;
  /** 精气类飘字用它取色 */
  essence?: EssenceType;
}

export interface DiffOptions {
  /** 忽略每季固定饱食消耗造成的下降（回合推进的常态，不值得飘字刷屏） */
  ignoreHungerDrop?: number;
}

/**
 * 差分出该飘哪些字。
 *
 * 饱食有个门槛：`ignoreHungerDrop` 给的量以内的**下降**不飘（季耗是背景噪音），
 * 但任何上升都飘（吃到东西是正反馈，必须给）。
 */
export function diffFloaters(
  prev: TaleState,
  next: TaleState,
  options: DiffOptions = {},
): FloaterSpec[] {
  const out: FloaterSpec[] = [];

  for (const key of STAT_ORDER) {
    const change = Math.round(next.stats[key]) - Math.round(prev.stats[key]);
    if (change === 0) continue;
    out.push({
      anchor: `stat:${key}`,
      text: `${STAT_LABELS[key]} ${formatSigned(change)}`,
      tone: change > 0 ? "gain" : "loss",
    });
  }

  const hungerChange = Math.round(next.hunger) - Math.round(prev.hunger);
  const ignore = options.ignoreHungerDrop ?? 0;
  if (hungerChange > 0 || hungerChange < -ignore) {
    out.push({
      anchor: "hunger",
      text: `饱食 ${formatSigned(hungerChange)}`,
      tone: hungerChange > 0 ? "gain" : "loss",
    });
  }

  for (const type of ESSENCE_ORDER as readonly EssenceType[]) {
    const change = Math.round(next.essence[type]) - Math.round(prev.essence[type]);
    if (change === 0) continue;
    out.push({
      anchor: `essence:${type}`,
      text: `${ESSENCE_LABELS[type]} ${formatSigned(change)}`,
      tone: "essence",
      essence: type,
    });
  }

  const lifespanChange = next.lifespanMax - prev.lifespanMax;
  if (lifespanChange !== 0) {
    out.push({
      anchor: "when",
      text: `寿元 ${formatSigned(lifespanChange)}`,
      tone: lifespanChange > 0 ? "gain" : "omen",
    });
  }

  return out;
}

/** 本次变化里新增的精气类型（用于触发对应颜色的粒子脉冲）。 */
export function gainedEssenceTypes(prev: TaleState, next: TaleState): EssenceType[] {
  return (ESSENCE_ORDER as readonly EssenceType[]).filter(
    (type) => next.essence[type] > prev.essence[type],
  );
}
