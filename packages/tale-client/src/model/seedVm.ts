/**
 * 神种选择屏视图模型（纯）。
 *
 * 「已解锁 / 可解锁 / 点数不足」三态与解锁花费的判定都在这里，界面只挑样式。
 */

import {
  boonCost,
  rollPremise,
  type Bloodline,
  type OrganDef,
  type SeedDef,
  type TaleContent,
  type TaleState,
} from "@shiling/tale-sim";
import {
  STAT_LABELS,
  STAT_ORDER,
  WAY_LABELS,
  WAY_SCOPES,
  formatSigned,
  skillMulLine,
} from "./format.js";
import { composeAscendGap } from "./chronicleVm.js";

export type SeedLockState = "unlocked" | "affordable" | "locked";

export interface SeedCardVm {
  id: string;
  name: string;
  desc: string;
  cost: number;
  lock: SeedLockState;
  /** 自带器官（第 0 器官） */
  organName: string;
  organDesc: string;
  organTags: string[];
  /** 「猛 +6」这类一次性加成，无加成时为空数组 */
  statMods: string[];
  /** 有战技则给技名，界面上是很强的选择动机 */
  combatSkillName: string | null;
  /** 还差多少血统点（lock === "locked" 时 > 0） */
  shortfall: number;
}

/**
 * [2026-08-13] 「下一世的世道」预告 ＋ 「换条路试试」的具体理由。
 *
 * 为什么摆在择神种这一屏：这是玩家按下「转世」之后看到的第一屏，也是他**唯一一次**
 * 在开局之前做选择的机会。若这一屏只有三张神种卡，那「第二局」就是从同一个起点再来一次；
 * 而「这一世大旱，上一世你死在归山路上差德行一二 —— 旱年难养德，或者试试妖王」
 * 让他带着一个具体的打算进去。
 *
 * 天时／出身能提前知道，是因为引擎的 `rollPremise(seedNum)` 是纯函数、且降世时那两次抽取
 * 恒在最前（见 `createLife`）—— 界面不掷骰，只是提前问了同一个答案。
 */
export interface NextLifeVm {
  /** 这一世的天时（名字 ＋ 机制那一行） */
  skyName: string;
  skyEffect: string;
  originName: string;
  originEffect: string;
  /** 「此世天时：大旱之年」 */
  caption: string;
  /**
   * 上一世的擦肩而过 ＋ 一条建议换的道；没有前世时为 null。
   *
   * 文案由**数据推**（上一世最接近的那条道、差了什么、这一世的天时），不写死。
   */
  advice: string | null;
}

/**
 * [S1] 「异变图鉴」的一行。
 *
 * 两种形态，**未发现的那一种不许泄露任何配方**（计划的铁律之一）：
 * - 已发现：名号 ＋ 配方（器官名）＋ 那一手的效果 ＋ 因果一句。
 * - 未发现：只有「？」与一句「尚未撞见」—— 连「要几件器官」都不说
 *   （件数本身就是线索，而这一批的全部本钱是「意料之外」）。
 */
export interface SynergyRowVm {
  /** 已发现才有 id（未发现的行连 id 都不给界面，免得从 DOM 里读出来） */
  id: string | null;
  known: boolean;
  /** 已发现＝「溃咬」；未发现恒为「？」 */
  name: string;
  /** 已发现＝「狩齿 ＋ 毒腺」；未发现为空串 */
  recipe: string;
  /** 已发现＝那一手的账（伤害倍率／效果／冷却／代价）；未发现为空串 */
  effect: string;
  /** 已发现＝`SynergyDef.reveal` 那一句因果；未发现＝「尚未撞见」 */
  note: string;
}

/** [S1] 「血脉」商店的一行：一件已发现过的器官，标价、买不买得起、买没买。 */
export interface BoonRowVm {
  organId: string;
  name: string;
  desc: string;
  /** 「肢位 · 猛 +2 灵 +2 体 +2」 */
  meta: string;
  /** 有战技就报技名（这是买它的主要动机） */
  skillName: string | null;
  cost: number;
  affordable: boolean;
  /**
   * 还差多少血统点（够买或已买时为 0）—— 同屏的神种卡也这么写。
   * 只写「买不起」而不写差多少，玩家就不知道「再活一世够不够」。
   */
  shortfall: number;
  /** 已经买下、下一世自带 */
  chosen: boolean;
}

/**
 * [S1] 血统点的第二个去处 ＋ 图鉴。
 *
 * 为什么与神种卡同屏：血统点此前**只能**解锁神种（三枚共 13 点），13 点花完后一世产的
 * 3〜8 点永久无处可花 —— owner 的原话「血统没什么用途」说的就是这个。血脉与图鉴摆在
 * 同一屏，转世那一刻的问题才从「按哪枚种」变成「这一世我要带什么、去凑什么」。
 */
export interface CodexVm {
  /** 已发现的组合数 ／ 全部（「已知 3/10」） */
  knownCount: number;
  total: number;
  caption: string;
  rows: SynergyRowVm[];
  /** 血脉可买的器官（已发现过的，最近发现的在前）；一件都没发现过时为空 */
  boons: BoonRowVm[];
  /** 已选的血脉（下一世自带），null ＝ 没买 */
  chosenBoonName: string | null;
  /** 一件都还没见过时的那句话（不留空白区） */
  boonEmptyNote: string | null;
}

export interface SeedScreenVm {
  points: number;
  cards: SeedCardVm[];
  /** [S1] 异变图鉴 ＋ 血脉 */
  codex: CodexVm;
  /** 前世列传目录，**最新在前** */
  chronicle: { title: string; body: string; ending: string; years: number; organCount: number }[];
  /** 已历几世 */
  lives: number;
  /** [2026-08-13] 下一世的世道预告与「换条路」的理由 */
  next: NextLifeVm;
}

function statModLabels(seed: SeedDef): string[] {
  const mods = seed.organ.statMods;
  if (!mods) return [];
  const out: string[] = [];
  for (const key of STAT_ORDER) {
    const value = mods[key];
    if (value === undefined || value === 0) continue;
    out.push(`${STAT_LABELS[key]} ${formatSigned(value)}`);
  }
  return out;
}

/**
 * 「换条路试试」那一句。
 *
 * 三段都从数据推：① 上一世死在哪条道上、差了什么（`composeAscendGap`，与死亡屏同源）；
 * ② 这一世的天时会让那条道更难还是更易（按天时改的那几项判）；③ 建议换的那条道
 * （挑上一世**没走**的、且这一世的天时帮得上的一条）。
 *
 * 不写死是刻意的：写死的建议在第三世就开始重复，而这一屏的全部作用就是让人觉得
 * 「下一局有别的东西可试」。
 */
function composeAdvice(last: TaleState | null, content: TaleContent, skyId: string): string | null {
  if (!last) return null;
  const gap = composeAscendGap(last, content);
  const lastLabel = WAY_LABELS[gap.way];
  const head =
    gap.gapItems.length === 0
      ? `上一世你走通了${lastLabel}。`
      : `上一世你死在${lastLabel}的路上，${gap.gapItems.join("、")}。`;
  /*
   * 建议哪一条：跳过上一世那条，挑「这一世的天时帮得上」的一条。
   * 对应关系写在这里而不是内容里，因为它是**界面的建议**，不是规则（引擎不认识「建议」）。
   */
  const favoured: Record<string, "shen" | "yaowang" | "guishan" | "hualing"> = {
    "sky-drought": "yaowang",
    "sky-beast-tide": "yaowang",
    "sky-spirit-flux": "hualing",
    "sky-early-winter": "guishan",
    "sky-plain": "shen",
  };
  const wanted = favoured[skyId] ?? "shen";
  const suggest = wanted === gap.way ? (gap.way === "shen" ? "guishan" : "shen") : wanted;
  return `${head}这一世不妨试试${WAY_LABELS[suggest]} —— ${WAY_SCOPES[suggest]}。`;
}

/** 器官槽位的单字读法（与蜕变卷轴同一套字）。 */
const SLOT_GLYPH: Record<string, string> = {
  eye: "窍",
  tooth: "颌",
  hide: "皮",
  limb: "肢",
  gut: "腑",
  spirit: "神",
};

/** 组合技那一手的账（按倍率读，与异变揭示演出共用 `skillMulLine`）。 */
function synergySkillText(content: TaleContent, id: string): string {
  const synergy = content.synergies.find((item) => item.id === id);
  return synergy ? skillMulLine(synergy.skill, content.tuning) : "";
}

function organName(content: TaleContent, id: string): string {
  return content.organs.find((organ) => organ.id === id)?.name ?? id;
}

function organMeta(organ: OrganDef): string {
  const slot = SLOT_GLYPH[organ.slot] ?? organ.slot;
  const mods = STAT_ORDER.filter((key) => (organ.statMods?.[key] ?? 0) !== 0).map(
    (key) => `${STAT_LABELS[key]} ${formatSigned(organ.statMods?.[key] ?? 0)}`,
  );
  return [`${slot}位`, ...mods].join(" · ");
}

/**
 * [S1] 图鉴 ＋ 血脉。
 *
 * **顺序恒定**（按 `content.synergies`）而不是「已发现的排前面」：位置固定，玩家才会记住
 * 「第三格还是问号」—— 那一格就是他下一世想去凑的东西。若已发现的往前挤，问号的位置
 * 每世都在动，图鉴就只是一个计数器。
 */
function buildCodexVm(bloodline: Bloodline, content: TaleContent): CodexVm {
  const known = new Set(bloodline.knownSynergyIds);
  const rows: SynergyRowVm[] = content.synergies.map((synergy) =>
    known.has(synergy.id)
      ? {
          id: synergy.id,
          known: true,
          name: synergy.name,
          recipe: synergy.organIds.map((id) => organName(content, id)).join(" ＋ "),
          effect: synergySkillText(content, synergy.id),
          note: synergy.reveal,
        }
      : { id: null, known: false, name: "？", recipe: "", effect: "", note: "尚未撞见" },
  );
  const boons: BoonRowVm[] = [...bloodline.knownOrganIds]
    .reverse()
    .map((id) => content.organs.find((organ) => organ.id === id))
    .filter((organ): organ is OrganDef => organ !== undefined)
    .map((organ) => {
      const cost = boonCost(organ.id, content);
      return {
        organId: organ.id,
        name: organ.name,
        desc: organ.desc,
        meta: organMeta(organ),
        skillName: organ.combatSkill?.name ?? null,
        cost,
        // [S1] 与 `buyBoon` **逐条同形**（一世只带一件，买过就整排锁住）——
        // 界面的置灰是那条规则的镜像，不许比它更严也不许更松
        affordable: bloodline.boonOrganId === null && bloodline.points >= cost,
        shortfall: Math.max(0, cost - bloodline.points),
        chosen: bloodline.boonOrganId === organ.id,
      };
    });
  const chosen = boons.find((boon) => boon.chosen);
  return {
    knownCount: known.size,
    total: content.synergies.length,
    caption: `已知异变 ${known.size}/${content.synergies.length}`,
    rows,
    boons,
    chosenBoonName: chosen?.name ?? null,
    boonEmptyNote:
      boons.length > 0
        ? null
        : "还没有蜕出过任何器官 —— 活过一世、蜕一件形，这里就有东西可带了。",
  };
}

/**
 * @param nextSeedNum 下一世将要用的种子数（`TaleApp` 按 `baseSeed + lifeIndex × φ` 算）——
 *   有了它才能**提前**问出这一世的天时与出身（`rollPremise` 是纯函数，与 `createLife` 同解）
 * @param lastLife 上一世的终态；没有前世时传 null
 */
export function buildSeedScreenVm(
  bloodline: Bloodline,
  content: TaleContent,
  nextSeedNum: number,
  lastLife: TaleState | null = null,
): SeedScreenVm {
  const unlocked = new Set(bloodline.unlockedSeedIds);
  const cards: SeedCardVm[] = content.seeds.map((seed) => {
    const isUnlocked = unlocked.has(seed.id) || seed.cost <= 0;
    const shortfall = Math.max(0, seed.cost - bloodline.points);
    const lock: SeedLockState = isUnlocked ? "unlocked" : shortfall === 0 ? "affordable" : "locked";
    return {
      id: seed.id,
      name: seed.name,
      desc: seed.desc,
      cost: seed.cost,
      lock,
      organName: seed.organ.name,
      organDesc: seed.organ.desc,
      organTags: seed.organ.tags,
      statMods: statModLabels(seed),
      combatSkillName: seed.organ.combatSkill?.name ?? null,
      shortfall: isUnlocked ? 0 : shortfall,
    };
  });

  const { sky, origin } = rollPremise(nextSeedNum, content);
  return {
    points: bloodline.points,
    cards,
    codex: buildCodexVm(bloodline, content),
    next: {
      skyName: sky.name,
      skyEffect: sky.effect,
      originName: origin.name,
      originEffect: origin.effect,
      caption: `此世天时　${sky.name} · ${origin.name}`,
      advice: composeAdvice(lastLife, content, sky.id),
    },
    chronicle: [...bloodline.chronicle].reverse().map((entry) => ({
      title: entry.title,
      body: entry.body,
      ending: entry.ending,
      years: entry.years,
      organCount: entry.organCount,
    })),
    lives: bloodline.chronicle.length,
  };
}
