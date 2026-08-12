/**
 * 列传卷轴视图模型（纯）。
 *
 * `composeChronicle` 返回的 `body` 是「开篇 ＼n 中段若干行 ＼n 结局 ＼n 赞曰…」的整块文本。
 * 卷轴要给赞语单独的排版（居中、朱砂、留白），所以在这里按结构拆开 —— 拆法只依赖
 * `chronicleTemplates.praisePrefix`（内容提供的「赞曰：」），不猜行数，行数不足时优雅降级。
 */

import {
  waysProgress,
  type ChronicleEntry,
  type EndingType,
  type TaleContent,
  type TaleState,
  type WayId,
} from "@shiling/tale-sim";
import { PORTRAIT_LABELS, portraitArt, portraitStage } from "../art/assets.js";
import {
  WAY_GATE_SHORTFALL,
  WAY_LABELS,
  endingLabelOf,
  epitaphOf,
  formatCountCn,
  formatYearCn,
} from "./format.js";

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
  /**
   * [M1-P2 ／ 2026-08-13 改按道] 差距报告 —— 死亡演出一闪而过，而**卷轴是玩家按「转世」
   * 之前盯着的那一屏**。那颗按钮旁边就该写着「你差德行六」。
   *
   * 报的是**最接近的那条道**，不再只报登神：一个奔妖王的一世死时被告知「差灵性四十」
   * 是一句与他这一世无关的话，而这一行的全部作用就是让他想「下一局我差的是那两件事」。
   */
  ascendGap: string;
  ascendGapItems: string[];
  ascendMet: number;
  ascendTotal: number;
  /** 差距报告针对的那条道（成道则是成的那条） */
  gapWay: WayId;
  /** 那条道的汉字名 */
  gapWayLabel: string;
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
  /** 那一世的终态 —— 差距报告要按它算（`ChronicleEntry` 只带岁数与器官数，算不出灵与德） */
  state: TaleState,
): ChronicleVm {
  const gap = composeAscendGap(state, content);
  const praisePrefix = content.chronicleTemplates.praisePrefix;
  const parts = splitChronicleBody(entry.body, praisePrefix);
  const stage = portraitStage(entry.organCount);
  return {
    title: entry.title,
    opening: parts.opening,
    middle: parts.middle,
    closing: parts.closing,
    praisePrefix,
    praise: parts.praise,
    ending: entry.ending,
    endingLabel: endingLabelOf(entry.ending, state.wayAchieved),
    epitaph: epitaphOf(entry.ending, state.wayAchieved),
    years: entry.years,
    yearsCn: formatYearCn(entry.years),
    organCount: entry.organCount,
    organCountCn: formatCountCn(entry.organCount),
    bloodlineGain,
    ascendGap: gap.gap,
    ascendGapItems: gap.gapItems,
    ascendMet: gap.met,
    ascendTotal: gap.total,
    gapWay: gap.way,
    gapWayLabel: WAY_LABELS[gap.way],
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
  /**
   * [M1-P2] **差距报告**：「你差二件器官、灵性差三六。」
   *
   * 这一行是整个结局重构的目的。M0 的死亡屏只有「凡历四岁，成器官二，蜕一，杀三」——
   * 一份收支表，读完的念头是「哦，死了」。差距报告把同一件事换成一个**待办**：
   * 玩家合上这一屏时想的是「我差两件器官」，那才是按下「转世」的理由。
   *
   * 登神那一世没有差距，此时是那句「四事既备」的确认。
   */
  gap: string;
  /** 差距报告的逐条形式（界面要逐项排版时用；已达成的不在其中） */
  gapItems: string[];
  /** 达成了几条／共几条 —— 死亡屏上那排点亮的门槛 */
  ascendMet: number;
  ascendTotal: number;
  /** 差距报告针对的那条道 */
  gapWay: WayId;
  gapWayLabel: string;
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

/**
 * 「离归山：寿数差三岁、德行差一二。」—— 差距报告。
 *
 * 只列**没达成**的门槛，且用「差多少」而不是「有多少」：`8/15` 是一个读数，
 * 「差七岁」是一件没做完的事。两者信息量相同，后者才会让人想再开一世。
 *
 * [2026-08-13] 报的是**最接近的那条道**（成道则是成的那条）。这一行的读法因此从
 * 「你离唯一的目标有多远」变成「你这一世走的是哪条路、还差什么」—— 后者才接得上
 * 转世屏那句「下一局换条路试试」。
 */
export function composeAscendGap(
  state: TaleState,
  content: TaleContent,
): { gap: string; gapItems: string[]; met: number; total: number; way: WayId } {
  const progress = waysProgress(state, content);
  // 成道那一世报的是**成的那条**（它的门槛当然全备），否则报最接近的那条
  const wayId = state.wayAchieved ?? progress.nearest;
  const way = progress.ways.find((item) => item.id === wayId) ?? progress.ways[0];
  if (!way) throw new Error("composeAscendGap: 四道为空");
  const gapItems = way.gates
    .filter((gate) => !gate.met)
    .map((gate) => WAY_GATE_SHORTFALL[gate.id](gate.short));
  const label = WAY_LABELS[way.id];
  const gap =
    gapItems.length === 0
      ? `${label}诸事既备 —— 那道门曾为你开过。`
      : `离${label}：${gapItems.join("、")}。`;
  return { gap, gapItems, met: way.metCount, total: way.gates.length, way: way.id };
}

export function buildDeathVm(state: TaleState, content: TaleContent): DeathVm {
  const ending: EndingType = state.ending ?? "oldage";
  const death = state.records.findLast((record) => record.kind === "death");
  const organCount = state.organIds.length;
  const killCount = state.records.filter((record) => record.kind === "combat").length;
  const moltCount = state.records.filter((record) => record.kind === "molt").length;
  const { gap, gapItems, met, total, way } = composeAscendGap(state, content);
  const epitaph = epitaphOf(ending, state.wayAchieved);
  return {
    endingLabel: endingLabelOf(ending, state.wayAchieved),
    epitaph,
    lastWords: death?.text ?? epitaph,
    yearsCn: formatYearCn(state.year),
    organCount,
    killCount,
    moltCount,
    summary: composeDeathSummary(state.year, organCount, moltCount, killCount),
    gap,
    gapItems,
    ascendMet: met,
    ascendTotal: total,
    gapWay: way,
    gapWayLabel: WAY_LABELS[way],
  };
}
