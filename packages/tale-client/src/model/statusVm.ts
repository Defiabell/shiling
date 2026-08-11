/**
 * 顶部状态栏视图模型（纯）。
 *
 * 界面渲染层只消费这里的产物，不再自己算比率、不自己判「饱食是否告急」——
 * 那些判断一旦散在 DOM 代码里就没法单测，而它们恰好是最容易和引擎口径漂移的部分。
 */

import { ownedOrgans, type EssenceType, type TaleContent, type TaleState } from "@shiling/tale-sim";
import {
  ESSENCE_LABELS,
  ESSENCE_ORDER,
  STAT_HINTS,
  STAT_LABELS,
  STAT_ORDER,
  formatWhen,
  toPercent,
  type StatKey,
} from "./format.js";

export interface StatGaugeVm {
  key: StatKey;
  label: string;
  hint: string;
  value: number;
  /** 0〜100，环形仪表的填充百分比（属性上限恒为 100） */
  percent: number;
}

export interface HungerVm {
  value: number;
  max: number;
  percent: number;
  /** 低于 25% → 朱砂告警（呼吸闪由 CSS 负责） */
  critical: boolean;
  /** 引擎已挂 sys:starving：再一季就饿死 */
  starving: boolean;
  caption: string;
}

export interface EssenceBarVm {
  type: EssenceType;
  label: string;
  value: number;
  threshold: number;
  /** 0〜100，相对 moltThreshold 的填充（超过阈值仍显示 100） */
  percent: number;
  /** 已达阈值 → 该柱发光，且底部「蛰伏」点亮 */
  ripe: boolean;
}

export interface StatusVm {
  when: string;
  /** 神种名（出生记录的 refId 解出），查不到时给兜底 */
  seedName: string;
  /** 器官件数（含神种），主界面用来给「蜕变」进度一点存在感 */
  organCount: number;
  organNames: string[];
  lifespanMax: number;
  stats: StatGaugeVm[];
  hunger: HungerVm;
  essences: EssenceBarVm[];
  /** 任一精气达阈值 */
  moltReady: boolean;
}

const SYS_FLAG_STARVING = "sys:starving";

export function buildStatusVm(state: TaleState, content: TaleContent): StatusVm {
  const t = content.tuning;
  const birth = state.records.find((record) => record.kind === "birth");
  const seed = content.seeds.find((candidate) => candidate.id === birth?.refId);
  const organs = ownedOrgans(state, content);

  const hungerPercent = toPercent(t.hungerMax > 0 ? state.hunger / t.hungerMax : 0);
  const starving = state.flags.includes(SYS_FLAG_STARVING);
  const hunger: HungerVm = {
    value: Math.round(state.hunger),
    max: t.hungerMax,
    percent: hungerPercent,
    critical: hungerPercent < 25,
    starving,
    caption: starving ? "再一季便要饿殍" : hungerPercent < 25 ? "腹中空空" : "饱食",
  };

  const essences: EssenceBarVm[] = ESSENCE_ORDER.map((type) => {
    const value = Math.round(state.essence[type]);
    return {
      type,
      label: ESSENCE_LABELS[type],
      value,
      threshold: t.moltThreshold,
      percent: toPercent(t.moltThreshold > 0 ? value / t.moltThreshold : 0),
      ripe: value >= t.moltThreshold,
    };
  });

  return {
    when: formatWhen(state.year, state.season, state.region),
    seedName: seed?.name ?? "无名神种",
    organCount: state.organIds.length,
    organNames: organs.map((organ) => organ.name),
    lifespanMax: state.lifespanMax,
    stats: STAT_ORDER.map((key) => ({
      key,
      label: STAT_LABELS[key],
      hint: STAT_HINTS[key],
      value: Math.round(state.stats[key]),
      percent: toPercent(state.stats[key] / 100),
    })),
    hunger,
    essences,
    moltReady: essences.some((essence) => essence.ripe),
  };
}
