/**
 * 追猎屏视图模型（纯）。
 *
 * ## 这一层唯一的职责：把引擎给的数**如实**摆到玩家眼前
 * 追猎的设计前提是「所有决策变量可见、动作按钮预告后果」。所以这里做的全是**呈现**决定
 * （精确值还是档位、要不要标红、警告写什么），一个游戏结算都不做 —— 命中率、警觉增益、
 * 反扑与否全部来自 `stalkPreview`（引擎），界面不复刻任何公式。
 *
 * ## 为什么档位映射放在这里而不是引擎
 * 「警觉 44 该显示成『有疑』还是『欲遁』」不影响任何结算，改它不会改变一场追猎的结果 ——
 * 它和 statusVm 里「饱食低于 25% 转朱砂」是同一类东西。引擎只回答「玩家有没有资格看见
 * 精确值」（`alertVisible`／`windVisible`，那是器官 tag 决定的**规则**）。
 */

import {
  lifeTuning,
  stalkPreview,
  type StalkAct,
  type StalkPreview,
  type StalkState,
  type TaleContent,
  type TaleState,
} from "@shiling/tale-sim";
import { enemyArt } from "../art/assets.js";
import { chanceCn, toPercent } from "./format.js";
import type { MediaAsset } from "./eventVm.js";

export type StalkActId = StalkAct;

/** 一个可读的量：精确值 ＋ 档位标签 ＋ 0〜100 的条形比例。 */
export interface StalkMeterVm {
  label: string;
  /** 精确读数（不可见时界面不该显示它，只用 `band`） */
  value: number;
  /** 「未觉」「有疑」「欲遁」这类档位；精确可见时是数值的补充说明 */
  band: string;
  /** 0〜100 */
  percent: number;
  /** 玩家有资格看见精确数值 */
  exact: boolean;
  /** 已进入危险档（界面转朱砂） */
  hot: boolean;
  /** 鼠标悬停的一句解释 */
  hint: string;
}

export interface StalkActionVm {
  id: StalkActId;
  /** 汉字印章 */
  glyph: string;
  label: string;
  /** 预期效果，如「近 12 步 · 警觉 +5」 */
  effect: string;
  /** 需要提醒的后果（顺风潜行、必失手、失手要打…）；无则 null */
  warning: string | null;
  /** 这一手是不是当前最该按的（金色呼吸） */
  highlight: boolean;
  enabled: boolean;
  disabledReason: string | null;
}

export interface StalkVm {
  preyName: string;
  preyDesc: string;
  /**
   * 猎物的常驻标记（目前只有「会反扑」）。
   *
   * 为什么不只写在扑击按钮的警告里：远距离时那颗按钮的警告位被「几乎必空」占着，
   * 于是「这头会反扑」要等玩家逼到近处才看得见 —— 而它恰恰是**要不要在这头上花五个回合**
   * 的前提。这类「关于这头猎物本身」的事实该挂在名号旁边，一直看得见。
   */
  preyBadge: string | null;
  preyPortrait: MediaAsset | null;
  /** 「第三息」 */
  roundLabel: string;
  distance: StalkMeterVm;
  alert: StalkMeterVm;
  stamina: StalkMeterVm;
  /** 风向：可见时「逆风」「侧风」「顺风」，不可见时「风势难辨」 */
  windLabel: string;
  windHint: string;
  /** 风向对潜行警觉的倍率说明，如「×2」；不可见时 null */
  windMulLabel: string | null;
  windVisible: boolean;
  /** 顺风（危险）——界面据此把风标转朱砂 */
  windAgainst: boolean;
  /** 距离条上那只猎物的位置（0〜100，越大越近） */
  closeness: number;
  /** 扑击命中率的可读形式：精确「七成二」或档位「参半」 */
  pounceLabel: string;
  pounceChance: number;
  /** 命中率进了「几乎必失手」档 */
  pounceHopeless: boolean;
  actions: StalkActionVm[];
  log: string[];
}

/** 警觉档位。三档对应「它还没在意你／它在疑／它要走了」。 */
const ALERT_BANDS: readonly { max: number; label: string }[] = [
  { max: 24, label: "未觉" },
  { max: 59, label: "有疑" },
  { max: Number.POSITIVE_INFINITY, label: "欲遁" },
];

/** 距离档位。挑的是「够不够得着」这条玩家真正在问的线。 */
const DISTANCE_BANDS: readonly { max: number; label: string }[] = [
  { max: 0, label: "贴身" },
  { max: 8, label: "一跃之内" },
  { max: 18, label: "尚远" },
  { max: Number.POSITIVE_INFINITY, label: "远" },
];

/**
 * 命中率档位（不给精确值时用）。
 *
 * ## 为什么是七档而不是五档
 * 实机跑出来的（`packages/gen` 的追猎实验台，bare build 400 场）：五档时「参半」一档横跨
 * 0.34〜0.60 足足 26 个点，于是**没有夜瞳的玩家做完一个动作看不出有没有变好** ——
 * 潜一步是参半、屏一息还是参半。机器猎手照这套信息决策时直接卡进「等到体力耗尽」的死循环，
 * 得手率 42%，比无脑硬冲（56%）还低。信息模糊是**该有的 build 差异**，信息无用不是。
 * 七档把最常落的中段切细（每档 ~13 个点），一个动作的收益就看得出来了。
 */
export const CHANCE_BANDS: readonly { max: number; label: string }[] = [
  { max: 0.12, label: "几无可能" },
  { max: 0.26, label: "渺茫" },
  { max: 0.4, label: "略有指望" },
  { max: 0.55, label: "参半" },
  { max: 0.7, label: "可搏" },
  { max: 0.85, label: "颇有胜算" },
  { max: 1, label: "十拿九稳" },
];

const WIND_LABELS: Record<StalkState["wind"], string> = {
  into: "逆风",
  cross: "侧风",
  with: "顺风",
};

const WIND_HINTS: Record<StalkState["wind"], string> = {
  into: "风自它来 —— 气味吹向自己，潜行的动静只涨一半。",
  cross: "风横着走 —— 潜行的动静照常。",
  with: "风把你的气味直送过去 —— 潜行的动静翻倍。",
};

const ACT_META: Record<StalkActId, { glyph: string; label: string }> = {
  creep: { glyph: "潜", label: "潜行" },
  circle: { glyph: "绕", label: "绕至上风" },
  wait: { glyph: "息", label: "屏息等待" },
  pounce: { glyph: "扑", label: "扑击" },
};

function bandOf(value: number, bands: readonly { max: number; label: string }[]): string {
  return bands.find((band) => value <= band.max)?.label ?? bands[bands.length - 1]?.label ?? "";
}

/** 带符号的整数（全角减号，与 format.formatSigned 同体例）。 */
function signed(value: number): string {
  return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : "0";
}

/**
 * 界面推荐的那一手 —— **同一时刻只推荐一手**。
 *
 * 为什么要有它：早先四颗按钮各自判断要不要发金光，结果开局时「潜行」与「绕至上风」同时亮
 * （实测种子 1），玩家看到两个「最该按的」等于没有推荐。而追猎屏的说明书就是这几行提示，
 * 它模糊了，玩家就只能乱点。
 *
 * 优先级本身是有实测依据的（`packages/gen` 追猎实验台 400 场／打法 "screen"）：
 * 照这条链打，基础 build 得手率 76.8% —— 比我手写的「明理猎手」还高 2.5 个点。
 * 也就是说：**跟着界面的提示打，就是当前最好的打法**，这正是「信息可见」要达成的事。
 * 实验台里那套打法是这条链的镜像，改这里就要同步改那边（那边有注释指回来）。
 */
export function recommendStalkAct(stalk: StalkState, preview: StalkPreview): StalkActId {
  // 最后一动：不扑就是空手而归
  if (preview.staminaLeft <= 1) return "pounce";
  // 先买逆风：读不出风向时也推荐（绕一圈能把不确定变成确定，此后每一步的动静都只涨一半）
  if ((!preview.windVisible || !preview.alreadyUpwind) && preview.staminaLeft > 2) return "circle";
  if (preview.pounceChance >= 0.7) return "pounce";
  if (preview.creepGain > 0 && preview.pounceChanceAfterCreep >= preview.pounceChance) return "creep";
  if (stalk.distance <= 0 && preview.waitAlertDrop > 0 && preview.pounceChance < 0.6) return "wait";
  return "pounce";
}

export function buildStalkVm(
  state: TaleState,
  stalk: StalkState,
  content: TaleContent,
): StalkVm {
  const t = lifeTuning(state, content);
  const preview = stalkPreview(state, content);
  const prey = content.enemies.find((candidate) => candidate.id === stalk.preyId);
  const startDistance = prey?.startDistance ?? t.stalkStartDistance;

  const alertExact = preview.alertVisible;
  const alertBand = bandOf(stalk.alertness, ALERT_BANDS);
  const alert: StalkMeterVm = {
    label: "警觉",
    value: stalk.alertness,
    band: alertBand,
    percent: toPercent(stalk.alertness / Math.max(1, t.stalkAlertMax)),
    exact: alertExact,
    hot: stalk.alertness >= 60,
    hint: alertExact
      ? `警觉 ${stalk.alertness}／${t.stalkAlertMax}　满则它必走`
      : "只看得出个大概 —— 夜瞳、灵犀之类的器官才读得出确数。",
  };

  const distance: StalkMeterVm = {
    label: "距离",
    value: stalk.distance,
    band: bandOf(stalk.distance, DISTANCE_BANDS),
    // 距离条按「起手距离」归一：玩家关心的是「走了多少、还剩多少」
    percent: toPercent(stalk.distance / Math.max(1, startDistance)),
    exact: true,
    hot: false,
    hint: `相距 ${stalk.distance} 步　越近越扑得中`,
  };

  const stamina: StalkMeterVm = {
    label: "体力",
    value: stalk.stamina,
    band: stalk.stamina <= 1 ? "将尽" : stalk.stamina <= 3 ? "半疲" : "尚足",
    percent: toPercent(stalk.stamina / Math.max(1, t.stalkStamina)),
    exact: true,
    hot: stalk.stamina <= 1,
    hint:
      stalk.stamina <= 1
        ? "只余一动 —— 这一手若不是扑击，就该罢手了。"
        : `还能动 ${stalk.stamina} 次（含最后那一扑）`,
  };

  const windVisible = preview.windVisible;
  const windMul = t.stalkWindAlertMul[stalk.wind] ?? 1;

  const hopeless = preview.pounceChance <= 0.12;
  /**
   * 命中率的读法：有夜瞳／灵犀读确数，否则读档位。
   *
   * 两种读法都必须能表达「**这一手让它变好了还是变坏了**」—— 所以潜行按钮上也要挂一份
   * 潜行之后的读数（下面的 `creepOutlook`）。只报当前值的界面在档位模式下等于什么都没说。
   */
  const readChance = (chance: number): string =>
    alertExact ? chanceCn(chance) : bandOf(chance, CHANCE_BANDS);
  const pounceLabel = readChance(preview.pounceChance);

  const nearest = stalk.distance <= 0;
  const creepUseless = preview.creepGain <= 0;
  const worthCreeping = preview.pounceChanceAfterCreep >= preview.pounceChance;
  const recommended = recommendStalkAct(stalk, preview);
  // 潜行之后能扑成什么样 —— 「再近一步值不值」全靠这一句，档位模式下尤其
  const creepOutlook = creepUseless
    ? ""
    : ` · 扑中转 ${readChance(preview.pounceChanceAfterCreep)}`;

  const actions: StalkActionVm[] = [
    {
      ...ACT_META.creep,
      id: "creep",
      effect: `近 ${preview.creepGain} 步 · 警觉 ${signed(preview.creepAlertGain)}${creepOutlook}`,
      warning: creepUseless
        ? "已在爪下，再近无益 —— 白涨警觉。"
        : stalk.wind === "with" && windVisible
          ? "顺风逼近：警觉翻倍。"
          : null,
      highlight: recommended === "creep" && !creepUseless && worthCreeping && !nearest,
      enabled: true,
      disabledReason: null,
    },
    {
      ...ACT_META.circle,
      id: "circle",
      effect: `风向转逆 · 警觉 ${signed(preview.circleAlertGain)}`,
      warning:
        windVisible && preview.alreadyUpwind
          ? "已在上风 —— 这一息是白费的。"
          : windVisible
            ? null
            : "风势难辨：绕一圈可保准是逆风。",
      /*
       * 读不出风向时**照样推荐绕行** —— 这是实机跑出来的一条修正：原先写
       * `windVisible && !alreadyUpwind`，于是开局那种没有雾目／夜瞳的 build 永远看不到
       * 这颗按钮发光，界面等于在劝玩家「别管风」，而顺风硬冲的得手率只有三成。
       * 不确定的时候花一息买确定，正是这颗按钮存在的理由。
       */
      highlight: recommended === "circle",
      enabled: true,
      disabledReason: null,
    },
    {
      ...ACT_META.wait,
      id: "wait",
      effect: `警觉 ${signed(-preview.waitAlertDrop)} · 它可能自行挪位`,
      warning:
        preview.waitAlertDrop <= 0
          ? "它已浑然不觉，等下去只是白耗体力。"
          : `约 ${toPercent(t.stalkWaitMoveChance)}% 会挪位，也可能就此走远。`,
      highlight: recommended === "wait",
      enabled: true,
      disabledReason: null,
    },
    {
      ...ACT_META.pounce,
      id: "pounce",
      effect: `命中 ${pounceLabel}`,
      warning: hopeless
        ? "相距尚远／它已戒备 —— 这一扑几乎必空。"
        : preview.retaliates
          ? "它不会逃，失手就是一场硬仗。"
          : null,
      // 反扑这件事也挂在名号旁边（`preyBadge`）—— 远距离时这里的位置被「必空」占着
      highlight: recommended === "pounce" && !hopeless,
      enabled: true,
      disabledReason: null,
    },
  ];

  return {
    preyName: prey?.name ?? stalk.preyId,
    preyDesc: prey?.desc ?? "",
    preyBadge: preview.retaliates ? "会反扑" : null,
    preyPortrait: prey ? { kind: "image", src: enemyArt(prey.id), aspect: "1 / 1" } : null,
    roundLabel: `第 ${stalk.round + 1} 息`,
    distance,
    alert,
    stamina,
    windLabel: windVisible ? WIND_LABELS[stalk.wind] : "风势难辨",
    windHint: windVisible
      ? WIND_HINTS[stalk.wind]
      : "读不出风向 —— 雾目、夜瞳、灵犀之类的器官才辨得清。",
    windMulLabel: windVisible ? `潜行动静 ×${windMul}` : null,
    windVisible,
    windAgainst: windVisible && stalk.wind === "with",
    closeness: toPercent(1 - stalk.distance / Math.max(1, startDistance)),
    pounceLabel,
    pounceChance: preview.pounceChance,
    pounceHopeless: hopeless,
    actions,
    log: stalk.log,
  };
}
