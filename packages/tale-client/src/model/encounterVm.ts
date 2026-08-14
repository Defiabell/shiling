/**
 * [M2-B1] 遭遇屏**公共外壳**的视图模型（纯）。
 *
 * ## 它存在的理由：一套 UI 语汇
 * M1 的追猎屏与搏杀屏是两块长得像的屏 —— 各有各的头、各有各的日志，玩家在「扑空 → 它回头」
 * 那一刻看到的是整块屏换掉。M2-B1 把两者做成**同一场遭遇的两个阶段**，于是这一层负责
 * 两个阶段都一样的那些东西：
 *
 * - 遭遇头：名号／来路（我盯上了它／它扑了我）／当前行为段／弱点小牌；
 * - **势条**：跨阶段延续的那一格资源；
 * - **部位伤牌**：整场累积的三处伤（拆腿／废眼／放血）；
 * - **四相盘**：猛／体／灵／德此刻各自在做什么 —— owner 那句「好好展示积累的各项指标的
 *   作用」的直接落点，**逐项写在屏幕上，不藏在公式里**；
 * - 整场日志（接近的每一息与交锋的每一合在同一条里）。
 *
 * 中段（接近的四量与四颗按钮／交锋的血条与指令网格）仍归 `stalkVm`／`combatVm`。
 *
 * ## 纪律
 * 这一层**不做任何结算**：所有数来自 `encounterPreview`（引擎），这里只决定措辞。
 * 「猛 26 → 咬击基伤 +3」里的 3 是引擎算的，「+3」这三个字才是这里的事。
 */

import {
  BODY_PART_NAMES,
  encounterPreview,
  type BodyPart,
  type EncounterPreview,
  type TaleContent,
  type TaleState,
} from "@shiling/tale-sim";
import { enemyArt } from "../art/assets.js";
import { chanceCn, toPercent } from "./format.js";
import type { MediaAsset } from "./eventVm.js";

/** 一格势（满／空）—— 界面画成一排小方块，比进度条更像「攒了几点」。 */
export interface MomentumVm {
  value: number;
  max: number;
  /** 长度 = max，true = 已攒到 */
  pips: boolean[];
  /** 「势 3／5　再攒 1 点可发决杀」 */
  label: string;
  hint: string;
  /** 已够发决杀（界面转金） */
  hot: boolean;
}

/**
 * 一处部位伤 —— 「腿 ②　它再也走不掉」。
 *
 * **咬喉那一格恒为 0**（`woundOf("throat")` 返回 null：咬喉是爆发那一档，不留整场伤）。
 * 它照样上屏，而且说明里必须**明说它不留伤** —— 三格并排才看得出「哪两条是能经营的线」，
 * 而一格默默停在 0 又不解释，玩家只会以为自己没打中。
 */
export interface WoundVm {
  part: BodyPart;
  label: string;
  stacks: number;
  cap: number;
  /** 这一处**根本不累积**（咬喉）—— 界面据此把它排成一枚说明牌而不是一个计数器 */
  neverWounds: boolean;
  /** 已触发那条一劳永逸的效果（断腿／废眼） */
  landmark: boolean;
  hint: string;
}

/**
 * 四相盘的一行。`value` 是属性值，`effects` 是它**此刻**在做的事（每条都是一句短话）。
 *
 * 为什么是数组而不是一句：四项各有两三处落点（体＝血上限 ＋ 减伤；德＝闪避 ＋ 暴击 ＋
 * 它的退意），揉成一句就没人读得完 —— 而这一盘的全部意义就是「逐项看得见」。
 */
export interface StatLineVm {
  key: "meng" | "ti" | "ling" | "de";
  zi: string;
  name: string;
  value: number;
  effects: string[];
}

export interface EncounterChromeVm {
  enemyName: string;
  enemyDesc: string;
  enemyPortrait: MediaAsset | null;
  /** 「我盯上了它」「它扑了我」「撞到一处」 */
  originLabel: string;
  phase: "approach" | "clash";
  /** 「接近」「交锋」 */
  phaseLabel: string;
  /** 行为段小牌（单段的兽为 null） */
  stageBadge: string | null;
  /** 「二段／三段」—— 让「它还会变」这件事看得见 */
  stageProgress: string | null;
  /** 弱点小牌：识破了写出在哪，没识破写「还差几合／几口」 */
  weaknessBadge: string | null;
  weaknessFound: boolean;
  weaknessHint: string | null;
  momentum: MomentumVm;
  wounds: WoundVm[];
  stats: StatLineVm[];
  log: string[];
}

const ORIGIN_LABEL = {
  hunt: "我盯上了它",
  ambush: "它扑了我",
  event: "撞到一处",
} as const;

const PHASE_LABEL = { approach: "接近", clash: "交锋" } as const;

const WOUND_META: Record<BodyPart, { label: string; landmark: string; plain: string }> = {
  throat: {
    label: "喉",
    landmark: "",
    // ⚠️ 这一句 code-reviewer 抓过一次：原文写「咬开的喉口每合自己淌血」，而引擎从不给喉记伤
    // （`woundOf` 对 throat 返回 null）—— 一句屏幕上恒在、却永远不会发生的承诺
    plain: "咬喉不留整场伤 —— 那一档是爆发（×1.6），一口就是一口。",
  },
  leg: {
    label: "腿",
    landmark: "腿已废 —— 它追不上你，也走不掉。",
    plain: "腿上每多一道伤，它出手就轻一分、也更扑不起来。",
  },
  eye: {
    label: "眼",
    landmark: "眼已瞎 —— 它多半打空，也不再反口。",
    plain: "眼上每多一道伤，它打空的机会就多一分。",
  },
};

/** 「势 3／5」那一格的读法。 */
function momentumVmOf(preview: EncounterPreview): MomentumVm {
  const need = Math.max(0, preview.finisherMomentum - preview.momentum);
  const hot = preview.momentum >= preview.finisherMomentum;
  return {
    value: preview.momentum,
    max: preview.momentumMax,
    pips: Array.from({ length: preview.momentumMax }, (_, i) => i < preview.momentum),
    label: hot ? `势 ${preview.momentum}／${preview.momentumMax}　可发决杀` : `势 ${preview.momentum}／${preview.momentumMax}`,
    hint: hot
      ? `势已足 —— 决杀吃掉全部的势，攒得越多这一记越重，且它护不住。`
      : `每合自涨 ${preview.momentumPerRound}；咬中它没护着的地方、或这一合它没伤到你，各多攒一点。再攒 ${need} 点可发决杀。`,
    hot,
  };
}

function woundVmsOf(preview: EncounterPreview): WoundVm[] {
  const parts: BodyPart[] = ["throat", "leg", "eye"];
  return parts.map((part) => {
    const stacks = preview.wounds[part];
    const meta = WOUND_META[part];
    const landmark =
      (part === "leg" && preview.legCrippled) || (part === "eye" && preview.eyeRuined);
    return {
      part,
      label: meta.label,
      stacks,
      cap: preview.woundCap,
      neverWounds: part === "throat",
      landmark,
      hint: landmark ? meta.landmark : meta.plain,
    };
  });
}

/**
 * 四相盘 —— 这一批最要紧的一屏内容。
 *
 * 每一行的 `effects` 都只写**此刻算得出来的数**（引擎给的），不写「提升伤害」这种没有数的话：
 * 一句没有数的形容词与「藏在公式里」是同一回事。
 */
function statLinesOf(preview: EncounterPreview): StatLineVm[] {
  const s = preview.stats;
  const approach = preview.phase === "approach";
  return [
    {
      key: "meng",
      zi: "猛",
      name: "猛",
      value: s.meng,
      effects: approach
        ? [
            `扑击命中 +${toPercent(s.pounceChanceBonus)}%`,
            `一咬基伤 ${s.biteBase}　其中猛给 +${s.mengBiteBonus}`,
          ]
        : [
            `一咬基伤 ${s.biteBase}　其中猛给 +${s.mengBiteBonus}`,
            `咬喉 ×1.6　决杀也按猛算`,
          ],
    },
    {
      key: "ti",
      zi: "体",
      name: "体",
      value: s.ti,
      effects:
        s.toughness > 0
          ? [`交锋血上限 ${s.hpMax}`, `每次受伤 −${s.toughness}`]
          : [`交锋血上限 ${s.hpMax}`, "再厚一些才减得动伤"],
    },
    {
      key: "ling",
      zi: "灵",
      name: "灵",
      value: s.ling,
      effects: [
        `势上限 ${s.momentumMax}　起手 ${s.momentumStart}`,
        `看破弱点需 ${s.weaknessRoundsBase} 合`,
        `遁走 ${chanceCn(s.fleeChance, "无")}`,
      ],
    },
    {
      key: "de",
      zi: "德",
      name: "德",
      value: s.de,
      /*
       * 闪避与暴击用**百分数**而不是汉字成数：德在开局只有 5 点，两者都落在个位数百分比里，
       * 而汉字成数在那一档要么写成「〇成二」（读着别扭），要么被 `chanceCn` 归成「无」——
       * 后者会让一个**真的在生效**的加成在屏幕上显示为「没有」，那正是这一盘要消灭的事。
       * 「遁走」那一行仍用汉字：它是个大数，与追猎屏的读法保持一致。
       */
      effects: [
        `闪避 ${toPercent(s.dodgeChance)}%`,
        `暴击 ${toPercent(s.critChance)}%`,
        `它的退意 ×${s.enemyFleeMul.toFixed(2)}`,
      ],
    },
  ];
}

export function buildEncounterChromeVm(
  state: TaleState,
  content: TaleContent,
): EncounterChromeVm {
  const preview = encounterPreview(state, content);
  const weaknessBadge = preview.weaknessFound
    ? `破绽 · ${preview.weaknessName ?? BODY_PART_NAMES[preview.weaknessPart ?? "throat"]}`
    : preview.weaknessPart === null
      ? null
      : "尚未看出破绽";
  return {
    enemyName: preview.enemyName,
    enemyDesc: preview.enemyDesc,
    enemyPortrait: { kind: "image", src: enemyArt(preview.enemyId), aspect: "1 / 1" },
    originLabel: ORIGIN_LABEL[preview.origin],
    phase: preview.phase,
    phaseLabel: PHASE_LABEL[preview.phase],
    stageBadge: preview.stageCount > 1 ? (preview.stageName ?? null) : null,
    stageProgress:
      preview.stageCount > 1 ? `${preview.stageIndex + 1}／${preview.stageCount} 段` : null,
    weaknessBadge,
    weaknessFound: preview.weaknessFound,
    /*
     * 没识破时也要写清**怎么才识得破**（还差几合／还差几口）。
     * 一枚只写「尚未看出破绽」的牌是废话；写上倒数，它才是一条真的出路。
     */
    weaknessHint:
      preview.weaknessPart === null
        ? null
        : preview.weaknessFound
          ? `打这一处 ×1.6，且它护也护不住。`
          : `再打 ${preview.weaknessRoundsLeft} 合看得出来；或咬中同一处 ${preview.weaknessHitsLeft} 回试出来。`,
    momentum: momentumVmOf(preview),
    wounds: woundVmsOf(preview),
    stats: statLinesOf(preview),
    log: preview.log,
  };
}
