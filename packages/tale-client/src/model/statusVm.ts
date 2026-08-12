/**
 * 顶部状态栏视图模型（纯）。
 *
 * 界面渲染层只消费这里的产物，不再自己算比率、不自己判「饱食是否告急」——
 * 那些判断一旦散在 DOM 代码里就没法单测，而它们恰好是最容易和引擎口径漂移的部分。
 */

import {
  SYS_FLAG_STARVING,
  ascendProgress,
  ownedOrgans,
  type AscendGateId,
  type EssenceType,
  type TaleContent,
  type TaleState,
} from "@shiling/tale-sim";
import { PORTRAIT_LABELS, portraitArt, portraitStage, type PortraitStage } from "../art/assets.js";
import {
  ASCEND_GATE_LABELS,
  ASCEND_GATE_SHORTFALL,
  ESSENCE_LABELS,
  ESSENCE_ORDER,
  STAT_LABELS,
  STAT_ORDER,
  formatWhen,
  toPercent,
  type StatKey,
} from "./format.js";
import { essenceLede, hungerLede, statLede } from "./detailVm.js";

export interface StatGaugeVm {
  key: StatKey;
  label: string;
  /**
   * 悬停提示 ＝ **用当前数值实例化的机制**（「猛 10　出手底伤 4　·　扑击命中 +4%」）。
   *
   * 原先这里是 `STAT_HINTS` 的风味词（「搏杀之力」），而它是 owner「每个属性值有啥用……
   * 只能乱点」那句话的第一现场：读完仍然不知道那个数改变了什么。真正的说明在点开的详情里，
   * 这一句是它的第一行 —— 两处同源（`detailVm.statLede`），不各写一版。
   */
  hint: string;
  value: number;
  /** 0〜100，环形仪表的填充百分比（属性上限恒为 100） */
  percent: number;
}

/** 右栏「身内」那一排 chip —— 带 id 才点得开详情（此前只有名字，chip 是死的）。 */
export interface OrganChipVm {
  id: string;
  name: string;
  /** [0] 那枚神种（chip 上多一个「神」印） */
  isSeed: boolean;
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
  /** 悬停／详情第一行：「饱食 60／100　每季 −12（冬 −18）」 */
  hint: string;
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
  /** 悬停／详情第一行：「足之精气 45／90　尚差 45」 */
  hint: string;
}

/** 状态栏那枚小立绘：形貌随器官数长，是玩家在界面上唯一能「看见自己」的地方。 */
export interface PortraitVm {
  stage: PortraitStage;
  /** 「幼兽」／「成兽」／「近神」 */
  label: string;
  src: string;
}

/**
 * [M1-P2] 「登神之路」上的一条门槛。
 *
 * 常驻在状态栏 —— 计划 P2 的第一条：**登神条件开局可见，每项达成即点亮**。
 * M0 的登神门槛只存在于引擎里，玩家一辈子（好几世）都不知道自己在往哪走，
 * 于是一世结束时只剩「哦，死了」。摆出来之后每一次蜕变、每一次德行抉择都有了指向。
 */
export interface AscendGateVm {
  id: AscendGateId;
  /** 「寿」「器」「灵」「德」 */
  label: string;
  have: number;
  need: number;
  met: boolean;
  /** 0〜100 */
  percent: number;
  /** 悬停解释：「灵性 24／60　尚差三六」 */
  hint: string;
}

export interface AscendVm {
  gates: AscendGateVm[];
  metCount: number;
  total: number;
  /** 四项全满 —— 天门随时可能开 */
  ready: boolean;
  /** 「登神之路　二／四」或 ready 时的那句话 */
  caption: string;
}

export interface StatusVm {
  when: string;
  /** 神种名（出生记录的 refId 解出），查不到时给兜底 */
  seedName: string;
  portrait: PortraitVm;
  /** 器官件数（含神种），主界面用来给「蜕变」进度一点存在感 */
  organCount: number;
  organNames: string[];
  /** 同 `organNames`，但带 id：右栏 chip 要能点开详情 */
  organs: OrganChipVm[];
  lifespanMax: number;
  stats: StatGaugeVm[];
  hunger: HungerVm;
  essences: EssenceBarVm[];
  /** 任一精气达阈值 */
  moltReady: boolean;
  /** [M1-P2] 登神之路（常驻可见，逐项点亮） */
  ascend: AscendVm;
}

/**
 * 登神进度的视图模型。
 *
 * 门槛数值全部来自引擎的 `ascendProgress` —— 界面**不自己比大小**：那四行比较与
 * `refreshAscendFlag` 就会是两份门槛，哪天引擎加一条，进度条会照旧显示「全亮」而
 * 天命死活不入池，且没有任何测试会红。
 */
export function buildAscendVm(state: TaleState, content: TaleContent): AscendVm {
  const progress = ascendProgress(state, content);
  const gates: AscendGateVm[] = progress.gates.map((gate) => ({
    id: gate.id as AscendGateId,
    label: ASCEND_GATE_LABELS[gate.id],
    have: gate.have,
    need: gate.need,
    met: gate.met,
    percent: toPercent(gate.need > 0 ? gate.have / gate.need : 1),
    hint: gate.met
      ? `${ASCEND_GATE_LABELS[gate.id]} ${gate.have}／${gate.need}　已足`
      : `${ASCEND_GATE_LABELS[gate.id]} ${gate.have}／${gate.need}　${ASCEND_GATE_SHORTFALL[gate.id](gate.short)}`,
  }));
  return {
    gates,
    metCount: progress.metCount,
    total: gates.length,
    ready: progress.ready,
    caption: progress.ready ? "四事既备　天门可望" : `登神之路　${progress.metCount}／${gates.length}`,
  };
}

// 引擎导出了这个保留 flag 的常量（`SYS_FLAG_STARVING`），此处不再手抄字面量：
// 抄一份就会有一天与引擎那份对不上，而对不上的表现是「饿殍告警永远不亮」——没有任何测试会红。

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
    // 每季扣多少、一次得手补多少 —— 开局第一回合就要知道的账，此前一个字没写
    hint: hungerLede(state, content),
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
      hint: essenceLede(state, content, type),
    };
  });

  const stage = portraitStage(state.organIds.length, t.ascendMinOrgans);

  return {
    when: formatWhen(state.year, state.season, state.region),
    seedName: seed?.name ?? "无名神种",
    portrait: { stage, label: PORTRAIT_LABELS[stage], src: portraitArt(stage) },
    organCount: state.organIds.length,
    organNames: organs.map((organ) => organ.name),
    // isSeed 按 id 判而不按下标：`ownedOrgans` 会跳过查不到的 id，下标可能整体前移
    organs: organs.map((organ) => ({
      id: organ.id,
      name: organ.name,
      isSeed: organ.id === state.organIds[0],
    })),
    lifespanMax: state.lifespanMax,
    stats: STAT_ORDER.map((key) => ({
      key,
      label: STAT_LABELS[key],
      hint: statLede(state, content, key),
      value: Math.round(state.stats[key]),
      percent: toPercent(state.stats[key] / 100),
    })),
    hunger,
    essences,
    moltReady: essences.some((essence) => essence.ripe),
    ascend: buildAscendVm(state, content),
  };
}
