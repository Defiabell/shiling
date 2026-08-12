/**
 * 神种选择屏视图模型（纯）。
 *
 * 「已解锁 / 可解锁 / 点数不足」三态与解锁花费的判定都在这里，界面只挑样式。
 */

import { rollPremise, type Bloodline, type SeedDef, type TaleContent, type TaleState } from "@shiling/tale-sim";
import { STAT_LABELS, STAT_ORDER, WAY_LABELS, WAY_SCOPES, formatSigned } from "./format.js";
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

export interface SeedScreenVm {
  points: number;
  cards: SeedCardVm[];
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
