/**
 * 神种选择屏视图模型（纯）。
 *
 * 「已解锁 / 可解锁 / 点数不足」三态与解锁花费的判定都在这里，界面只挑样式。
 */

import type { Bloodline, SeedDef, TaleContent } from "@shiling/tale-sim";
import { STAT_LABELS, STAT_ORDER, formatSigned } from "./format.js";

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

export interface SeedScreenVm {
  points: number;
  cards: SeedCardVm[];
  /** 前世列传目录，**最新在前** */
  chronicle: { title: string; body: string; ending: string; years: number; organCount: number }[];
  /** 已历几世 */
  lives: number;
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

export function buildSeedScreenVm(bloodline: Bloodline, content: TaleContent): SeedScreenVm {
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

  return {
    points: bloodline.points,
    cards,
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
