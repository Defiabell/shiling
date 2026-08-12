/**
 * 顶部状态栏视图模型（纯）。
 *
 * 界面渲染层只消费这里的产物，不再自己算比率、不自己判「饱食是否告急」——
 * 那些判断一旦散在 DOM 代码里就没法单测，而它们恰好是最容易和引擎口径漂移的部分。
 */

import {
  SYS_FLAG_STARVING,
  lifeTuning,
  ownedOrgans,
  premiseOf,
  waysProgress,
  type EssenceType,
  type TaleContent,
  type TaleState,
  type WayGateId,
  type WayId,
} from "@shiling/tale-sim";
import { PORTRAIT_LABELS, portraitArt, portraitStage, type PortraitStage } from "../art/assets.js";
import {
  WAY_GATE_LABELS,
  WAY_GATE_SHORTFALL,
  WAY_LABELS,
  WAY_SCOPES,
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
 * [M1-P2 ／ 2026-08-13 扩成四道] 一条道上的一条门槛。
 *
 * 常驻在状态栏 —— P2 的第一条是「登神条件开局可见，每项达成即点亮」，这一批把它从**一条道**
 * 扩到**四条并列**：玩法再不同，若目标只有一个，第二局仍旧是同一件事再做一遍。
 */
export interface WayGateVm {
  id: WayGateId;
  /** 「寿」「灵」「德」「猛」「杀」「神」「净」 */
  label: string;
  have: number;
  need: number;
  met: boolean;
  /** 0〜100（`max` 类门槛：达成 100、破了 0） */
  percent: number;
  /**
   * 横带上那一行**读数**（界面直接贴，不自己拼）。
   *
   * `min` 类是「21／56」；`max` 类（不杀一命）是「未夺」或「已夺 3」—— 写成 `0／0`
   * 会读成「零比零」，写成 `3／0` 更糟（读起来像超额完成，正相反）。实机抄字时撞到的。
   */
  read: string;
  /** 悬停解释：「灵性 24／52　灵性差二八」 */
  hint: string;
}

/** 横带上的一条道（tab ＋ 展开时的那几条门槛）。 */
export interface WayVm {
  id: WayId;
  /** 「登神」「妖王」「归山」「化灵」 */
  label: string;
  /** 一句话说清它要什么（tab 的悬停） */
  scope: string;
  gates: WayGateVm[];
  metCount: number;
  total: number;
  /** 门槛全备 —— 那桩事随时会来（归山则等寿终兑现） */
  ready: boolean;
  /** 这条道已经**走不到了**（今天只有化灵会：夺过一命就闭） */
  lost: boolean;
  /** 「登神 一／三」 */
  caption: string;
}

export interface WaysVm {
  /** 固定顺序：登神 → 妖王 → 归山 → 化灵 */
  ways: WayVm[];
  /** 引擎判的「最接近的那条」（已闭的道不参与） */
  nearest: WayId;
  /**
   * 横带当前**展开**的那一条。缺省跟着 `nearest` 走；玩家点了 tab 就是他点的那条。
   *
   * 切 tab 是**查看态**，不是操作 —— 它不进引擎、不消耗回合，也不增加每回合的必点次数
   * （M1 的既定裁决）。
   */
  shown: WayId;
  /** 展开的那条道（`ways` 里 id === shown 的那个，界面免得再找一次） */
  current: WayVm;
  /** 有任何一条道门槛全备 */
  anyReady: boolean;
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
  /** [2026-08-13] 四道并列（常驻可见，逐项点亮，可切 tab 查看） */
  ways: WaysVm;
  /** [2026-08-13] 这一世的天时与出身 —— 状态栏那一行「值大旱之年 · 孤生」 */
  premise: PremiseVm;
}

/** 这一世的开局前提（天时／出身各一条，两处都要给玩家看机制而不只是名字）。 */
export interface PremiseLineVm {
  /** 「天时」／「出身」 */
  kind: string;
  name: string;
  /** 机制那一行（`PremiseDef.effect`） */
  effect: string;
  desc: string;
}

export interface PremiseVm {
  sky: PremiseLineVm;
  origin: PremiseLineVm;
  /** 状态栏一行：「大旱之年 · 孤生」 */
  caption: string;
  /** 悬停：两条机制并起来 */
  hint: string;
}

export function buildPremiseVm(state: TaleState, content: TaleContent): PremiseVm {
  const { sky, origin } = premiseOf(state, content);
  const line = (kind: string, def: typeof sky): PremiseLineVm => ({
    kind,
    name: def.name,
    effect: def.effect,
    desc: def.desc,
  });
  return {
    sky: line("天时", sky),
    origin: line("出身", origin),
    caption: `${sky.name} · ${origin.name}`,
    hint: `天时 ${sky.name}：${sky.effect}\n出身 ${origin.name}：${origin.effect}`,
  };
}

/**
 * 四道进度的视图模型。
 *
 * 门槛数值全部来自引擎的 `waysProgress` —— 界面**不自己比大小**：那几行比较与
 * `refreshWayFlags` 就会是两份门槛，哪天引擎给某条道加一条，进度条会照旧显示「全亮」而
 * 成道事件死活不入池，且没有任何测试会红。
 *
 * @param shown 玩家点开的那条 tab；`null` ＝ 跟着引擎判的「最接近的那条」走
 */
export function buildWaysVm(
  state: TaleState,
  content: TaleContent,
  shown: WayId | null = null,
): WaysVm {
  const progress = waysProgress(state, content);
  const ways: WayVm[] = progress.ways.map((way) => {
    const gates: WayGateVm[] = way.gates.map((gate) => ({
      id: gate.id,
      label: WAY_GATE_LABELS[gate.id],
      have: gate.have,
      need: gate.need,
      met: gate.met,
      /*
       * `max` 类门槛（不杀一命）没有「进度」这回事：它要么满、要么破。按 have/need 算会
       * 得到 have/0 → 除零，而按「破了就 0」画，那根条本身就是这条道的开关。
       */
      percent:
        gate.bound === "max"
          ? gate.met
            ? 100
            : 0
          : toPercent(gate.need > 0 ? gate.have / gate.need : 1),
      read:
        gate.bound === "max"
          ? gate.met
            ? "未夺"
            : `已夺 ${gate.have}`
          : `${gate.have}／${gate.need}`,
      hint: gate.met
        ? `${WAY_GATE_LABELS[gate.id]} ${gate.have}／${gate.need}　已足`
        : `${WAY_GATE_LABELS[gate.id]} ${gate.have}／${gate.need}　${WAY_GATE_SHORTFALL[gate.id](gate.short)}`,
    }));
    return {
      id: way.id,
      label: WAY_LABELS[way.id],
      scope: WAY_SCOPES[way.id],
      gates,
      metCount: way.metCount,
      total: gates.length,
      ready: way.ready,
      lost: way.lost,
      caption: way.lost
        ? `${WAY_LABELS[way.id]}　已闭`
        : way.ready
          ? `${WAY_LABELS[way.id]}　既备`
          : `${WAY_LABELS[way.id]}　${way.metCount}／${gates.length}`,
    };
  });
  /*
   * 玩家点开的那条**已闭**也照他点的显示（「化灵 已闭　已夺三命」是他要看的答案）；
   * 只有缺省视图才躲开已闭的道 —— 那是引擎的 `nearest` 已经处理过的事。
   */
  const shownId = shown ?? progress.nearest;
  const current = ways.find((way) => way.id === shownId) ?? ways[0];
  if (!current) throw new Error("buildWaysVm: 四道为空");
  return {
    ways,
    nearest: progress.nearest,
    shown: current.id,
    current,
    anyReady: progress.ready,
  };
}

// 引擎导出了这个保留 flag 的常量（`SYS_FLAG_STARVING`），此处不再手抄字面量：
// 抄一份就会有一天与引擎那份对不上，而对不上的表现是「饿殍告警永远不亮」——没有任何测试会红。

export function buildStatusVm(
  state: TaleState,
  content: TaleContent,
  /** 横带上玩家点开的那条道；`null` ＝ 跟着「最接近的那条」 */
  shownWay: WayId | null = null,
): StatusVm {
  // 这一世生效的调参（天时／出身改过的那几项）—— 界面读的数必须与引擎结算的是同一份，
  // 否则大旱之年会出现「饱食条说每季 −12 而实扣 −15」那种静默说谎
  const t = lifeTuning(state, content);
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

  const stage = portraitStage(state.organIds.length);

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
    ways: buildWaysVm(state, content, shownWay),
    premise: buildPremiseVm(state, content),
  };
}
