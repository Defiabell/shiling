import { SPECIES, TUNING } from "@shiling/content";
import { DT } from "./sim.js";
import type { Terrain } from "./terrain.js";
import type { Creature, GameState, PlayerInput } from "./state.js";

function clamp01to100(v: number): number {
  return v < 0 ? 0 : v > 100 ? 100 : v;
}

/** 供 ai/eating 复用：置 dead、生成 Carcass（meat = def.meat）、从 creatures 移除（玩家除外：只标记 playerDead）。 */
export function killCreature(state: GameState, c: Creature): void {
  if (c.activity === "dead") return;
  c.activity = "dead"; c.hp = 0;
  const def = SPECIES[c.species]!;
  state.carcasses.push({ id: c.id, species: c.species, pos: { ...c.pos }, meat: def.meat });
  if (c.id === state.playerId) { state.playerDead = true; return; }
  state.creatures = state.creatures.filter((x) => x.id !== c.id);
}

/** 身前 8 方向采样 interactRange 距离的点，命中任一水点即视为"在水边"。 */
function nearWater(c: Creature, terrain: Terrain): boolean {
  if (terrain.isWater(c.pos.x, c.pos.z)) return true;
  const r = TUNING.interactRange;
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const sx = c.pos.x + Math.sin(angle) * r;
    const sz = c.pos.z + Math.cos(angle) * r;
    if (terrain.isWater(sx, sz)) return true;
  }
  return false;
}

function tickCreatureNeeds(c: Creature): void {
  if (c.activity === "dead") return;

  // 饥渴衰减对所有活物、所有 activity 一视同仁——不按 activity 特判（不然会把"吃东西时
  // 饥饿衰减该不该继续算"这种平衡性决策，从具体的进食系统悄悄挪到这个公共函数里，隐性影响
  // 苓鼠 graze/潭狩 feed 的净回复速率）。玩家吃尸体这一 tick 同时叠加衰减与回复导致的
  // "双重结算"问题，改在 eating.ts 的进食公式里就地补偿（只影响进食者本身，不影响其它
  // activity==="eating" 的生物），见 eating.ts 顶部注释。
  c.needs.hunger = clamp01to100(c.needs.hunger - TUNING.hungerDecayPerSec * DT);
  c.needs.thirst = clamp01to100(c.needs.thirst - TUNING.thirstDecayPerSec * DT);

  let fatigueRecoverPerSec: number;
  if (c.burrowId !== null) {
    fatigueRecoverPerSec = TUNING.burrowFatigueRecoverPerSec;
  } else if (c.activity === "moving") {
    fatigueRecoverPerSec = TUNING.fatigueWalkRecoverPerSec;
  } else {
    fatigueRecoverPerSec = TUNING.fatigueRecoverPerSec;
  }
  c.needs.fatigue = clamp01to100(c.needs.fatigue + fatigueRecoverPerSec * DT);
}

/** 所有活物统一结算：饥渴衰减、疲劳恢复、归零掉血、死亡转尸体。玩家在水边按 interact 饮水。 */
export function tickNeeds(state: GameState, terrain: Terrain, input: PlayerInput): void {
  const player = state.creatures.find((c) => c.id === state.playerId);

  for (const c of state.creatures) tickCreatureNeeds(c);

  // 挖洞/进食（另两个消费者，见 eating.ts 顶部注释）不满足才轮到饮水；满足时才把 activity
  // 置 "drinking"，否则若上一 tick 还残留 "drinking"（比如离开水边、松开 interact），这里
  // 要显式降级回 "idle"——不然它会像 Task 11 修复前的 "eating" 一样变成一个永不清零的僵死
  // activity（虽然 "drinking" 不参与任何衰减跳过逻辑，暂时无副作用，但留着就是下一个隐患，
  // 一并修掉）。
  // 键位拆分（W2）新语义：饮水只看 input.attack 是否按下，不再看"范围内是否存在攻击目标"
  // ——左键(攻击)与 E(饮水/进食/挖掘)已是两个独立字段，举着左键就直接不喝水（不管这一下
  // 有没有真的打中什么），而单独按 E（哪怕范围内正好站着一只猎物）现在应当正常喝水——
  // 这是用户键位拆分后"意图已经显式"的直接体现，不再需要跨文件反查 eating.ts 的攻击目标
  // 扫描结果（旧版本导出的 hasAttackTargetInRange 已随之移除）。
  if (player && player.activity !== "dead" && input.interact && player.activity !== "digging" && !input.attack && player.activity !== "eating" && player.burrowId === null && nearWater(player, terrain)) {
    player.activity = "drinking";
    player.needs.thirst = clamp01to100(player.needs.thirst + TUNING.drinkPerSec * DT);
  } else if (player && player.activity === "drinking") {
    player.activity = "idle";
  }

  for (const c of state.creatures) {
    if (c.activity === "dead") continue;
    // 饥饿归零对所有活物一视同仁——苓鼠 graze（ai.ts doGraze）、潭狩 feed（ai.ts doFeed）、
    // 玩家吃尸体（eating.ts）都能回复 hunger，三者都有对应的"反制手段"。但口渴的反制手段
    // （本函数上面的饮水分支）只接了玩家：M0 的 NPC AI（Task 9/10：苓鼠 wander/graze/flee，
    // 潭狩 patrol/hunt/feed）从未实现"找水喝"的状态。若 thirst===0 对 NPC 也判死刑，
    // 就等于给所有非玩家生物钉了一个和捕食/进食完全无关、无法规避的倒计时——灰盒期
    // thirstDecayPerSec=0.5、苓鼠 maxHp=25，约 180s 后全场苓鼠/潭狩因口渴团灭
    // （headless ecology 冒烟测试 2026-08 发现，见 ecology.test.ts），这不是生态平衡问题，
    // 是需求-反制手段的对称性缺口。在 NPC 获得真实的饮水行为之前，口渴归零只对玩家致命；
    // 饥饿仍对所有生物一视同仁（其反制手段本就齐备）。
    const canDieOfThirst = c.id === state.playerId;
    if (c.needs.hunger === 0 || (canDieOfThirst && c.needs.thirst === 0)) {
      c.hp -= TUNING.starveHpPerSec * DT;
      if (c.hp <= 0) killCreature(state, c);
    }
  }
}
