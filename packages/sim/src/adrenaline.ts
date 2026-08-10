import { SPECIES, TUNING } from "@shiling/content";
import type { GameState } from "./state.js";

/**
 * 濒死爆发（M15 P1「反制包」）：玩家 hp 跌破 maxHp×adrenalineHpFrac(0.3) 的那一刻——
 * 真正的边沿，不是"只要低于阈值就一直生效"的电平判定，见 state.adrenalineArmed 的字段
 * 注释——触发 adrenalineSec(4s) 窗口：movement.ts 的 movePlayer 读 state.adrenalineTicks>0
 * 把整体移动速度乘 adrenalineSpeedMult(1.3)，且冲刺期间跳过疲劳消耗。窗口结束后进入
 * adrenalineCooldownSec(60s) 冷却，期间即使 hp 再次跌破阈值也不会重触发。
 *
 * 排在 step() 尾部（tickNeeds 之后）：要读的是本 tick 战斗（ai.ts resolveHunt）/饿死
 * （needs.ts 的 starve 分支）结算完的最终 hp，从下一 tick 的 movePlayer 起生效——1
 * tick=50ms 延迟，与 organs.ts tickTemper 的 hit 触发同一惯例，不可感知。反过来说，
 * movePlayer 排在 step() 最前面，这一 tick 战斗刚造成的那一下掉血本身永远不会被同一
 * tick 的速度加成保护到——爆发是"挨了这一下之后"的反制，不是"这一下命中的瞬间"就
 * 免疫，与 brief"濒死爆发"的语义一致（爆发出的是求生反应，不是防止那一下命中本身）。
 *
 * 洞中/蛰伏中整体早退（code review 发现的真实 bug，用真实 sim 复现过）：p.burrowId!==
 * null 时早退——这一条隐式覆盖了蛰伏（state.dormancy!==null 的前提本就是"人在自己家的
 * 洞里"，蛰伏进行中 burrowId 恒非 null，见 dormancy.ts，不需要再单独判 dormancy 字段）。
 * 若不加这一条：饿死判定（needs.ts）对蛰伏中/单纯躺洞里的玩家一样生效（口渴蛰伏期间
 * 无补偿会正常归零，见 dormancy.ts 头部"已知设计缺口"；单纯躺洞里也会正常饿死/渴死），
 * hp 跌破阈值会白白触发一次爆发——movePlayer/moveCreature 对洞中玩家整体 no-op（见
 * movement.ts），窗口期的速度加成完全用不上，60 秒冷却却已经扣下，等玩家真正出洞被追
 * 需要这条反制时，冷却还没转完。早退让 armed/ticks/cooldown 全部冻结在"进洞那一刻"的
 * 取值，出洞后才继续判定——这样"进洞前健康、洞里饿到跌破阈值、出洞时仍很虚弱"这种
 * 场景，会在出洞的第一个 tick 判定成一次真正的边沿并正确触发，而不是被洞里白白吃掉。
 */
export function tickAdrenaline(state: GameState): void {
  const p = state.creatures.find((c) => c.id === state.playerId);
  if (!p || p.activity === "dead" || p.burrowId !== null) return;

  if (state.adrenalineTicks > 0) state.adrenalineTicks -= 1;
  if (state.adrenalineCooldown > 0) state.adrenalineCooldown -= 1;

  const maxHp = SPECIES[p.species]!.maxHp;
  const belowThreshold = p.hp < maxHp * TUNING.adrenalineHpFrac;

  if (belowThreshold) {
    if (state.adrenalineArmed && state.adrenalineCooldown <= 0) {
      state.adrenalineTicks = Math.round(TUNING.adrenalineSec * TUNING.tickHz);
      state.adrenalineCooldown = Math.round(TUNING.adrenalineCooldownSec * TUNING.tickHz);
    }
    // 无论这次是否真的触发了（可能正在冷却），跌破阈值这一刻起先"卸下扳机"——下一次
    // 触发必须先回升到阈值之上再重新跌破才算一次新的边沿，见 state.adrenalineArmed 注释。
    state.adrenalineArmed = false;
  } else {
    state.adrenalineArmed = true;
  }
}
