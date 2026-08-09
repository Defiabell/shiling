import { SPECIES, TUNING } from "@shiling/content";
import type { GameState } from "./state.js";

/**
 * 精气获取（M1 B1，见 docs/plans/shiling/2026-08-10-m1-evolution-plan.md 数据模型）。
 *
 * 只在 eating.ts 的"鲜尸进食"分支调用（玩家吃真实 Carcass 的那条路径，攻击致死后的
 * 尸体也算——只要最终是从 state.carcasses 里啃下来的肉）：按尸体物种的
 * def.essenceType 累加到对应的 state.essence 桶，量 = meatEaten × def.essenceYieldPerMeat，
 * clamp 在 TUNING.essenceCap。
 *
 * 设计权衡（**巢中吃储粮不获精气**，这是刻意的，不是遗漏）：精气随死亡消散，只有咬开
 * 还带着"灵气"的鲜尸才能养精——存进 homeNest.stash 的肉已经是"死物粮食"，图的是
 * 蛰伏时不挨饿的方便，不是精气来源。这个权衡把"储粮方便"和"鲜食养精"分成两条不
 * 重叠的收益，逼玩家不能只窝在家里囤粮过日子，仍要出门捕猎才能推进进化系统——因此
 * eating.ts 的 burrow 自动进食分支（吃 state.homeNest.stash）不调用本函数，只有洞外
 * 吃 state.carcasses 里的真实尸体这条分支会调用。
 *
 * species 查不到（防御性，理论上不会发生——调用方总是传 Carcass.species，且世界里
 * 生成的尸体物种一定在 SPECIES 表里）时静默跳过，不抛错——精气获取是"锦上添花"的
 * 副作用，不应该因为数据缺口而打断主进食流程。
 */
export function gainEssence(state: GameState, species: string, meatEaten: number): void {
  const def = SPECIES[species];
  if (!def || meatEaten <= 0) return;
  const type = def.essenceType;
  const gained = meatEaten * def.essenceYieldPerMeat;
  state.essence[type] = Math.min(TUNING.essenceCap, state.essence[type] + gained);
}
