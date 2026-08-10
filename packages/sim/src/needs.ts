import { SPECIES, TUNING } from "@shiling/content";
import { DT } from "./sim.js";
import type { Terrain } from "./terrain.js";
import type { Creature, GameState, PlayerInput } from "./state.js";
import { dist2d, type Vec3 } from "./vec.js";

function clamp01to100(v: number): number {
  return v < 0 ? 0 : v > 100 ? 100 : v;
}

/** 供 ai/eating 复用：置 dead、生成 Carcass（meat = def.meat）、从 creatures 移除（玩家除外：只标记 playerDead）。 */
export function killCreature(state: GameState, c: Creature): void {
  if (c.activity === "dead") return;
  c.activity = "dead"; c.hp = 0;
  const def = SPECIES[c.species]!;
  state.carcasses.push({ id: c.id, species: c.species, pos: { ...c.pos }, meat: def.meat });
  if (c.id === state.playerId) {
    state.playerDead = true;
    // M1 B3 防御性收口（code review 2026-08-10）：玩家若恰好蛰伏中死亡（例如口渴归零，
    // 蛰伏期间没有饮水手段——见 dormancy.ts 头部对这一已知设计缺口的说明），tickDormancy
    // 的 `p.activity === "dead"` 早退会让它此后永远不再触碰 state.dormancy，字段会卡在
    // 死前那一刻的 ticksLeft 上一直不清零。今天这个卡住的字段没有任何可见副作用
    // （hud.ts 一旦 dead 就整体不再读它；唯一的复活路径是 location.reload() 整页刷新，
    // 清空全部 JS 状态）——但显式清空成本几乎为零，且比"依赖死亡永远是终局"这条隐含假设
    // 更稳，为 M1 之后可能出现的复活/转世机制预先兜底。
    state.dormancy = null;
    return;
  }
  state.creatures = state.creatures.filter((x) => x.id !== c.id);
}

/**
 * 身前 8 方向采样 interactRange 距离的点，命中任一水点即视为"在水边"。导出
 * （M15 P1）供 digging.ts 的陷坑挖掘判据复用——同一套"是否在水边"几何只应该有一份
 * 实现，digging.ts 需要用它排除"贴着水边的开阔地不该触发陷坑挖掘"（否则会跟这里
 * 的饮水判据在同一 tick 抢占同一次 E 按下，见 digging.ts 头部注释）。client 侧的
 * main.ts 另有一份独立的只读复刻（不经过这个导出）——那份是隔着 sim 包边界的 HUD
 * 探针，见该文件头注释，与这里的包内复用是两个不同的问题。
 *
 * 参数类型只要求 `{ pos: Vec3 }`（M15 P3 收紧，此前是完整的 `Creature`）——函数体
 * 只读 `c.pos`，从未用过 `Creature` 的其它字段；收紧之后测试侧（pits.test.ts 的
 * findOpenGround，用它排除"贴着灵泉/新地形水域的开阔地"）可以直接传一个裸的
 * `{pos:{x,y,z}}`，不需要伪造一整个 Creature 对象来满足类型检查。
 */
export function nearWater(c: { pos: Vec3 }, terrain: Terrain): boolean {
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

  // 灵泉滋养（M15 P3「山海经地形与地标」）：正在饮水（上面这个分支本 tick 刚设好/
  // 延续设好 "drinking"）且落在任一灵泉 TUNING.springRadius(5m) 内——额外加成：
  // 补足到 drinkPerSec×springDrinkMult 的总速率（上面已经加过 1x，这里只补
  // (springDrinkMult-1) 倍的差额，两段相加正好等于总量，不重复计算），外加 hp regen
  // （封顶玩家自己的 maxHp）。这是叠在"在哪片水域饮水"这件事之上的加成，不是独立于
  // 饮水判据之外的另一套触发条件——灵泉本身只是水域里更优越的一种，站在灵泉旁但没有
  // 满足上面的基础饮水判据（比如举着左键攻击）不会触发这段加成。
  if (player && player.activity === "drinking") {
    const nearSpring = terrain.springs.some((s) => dist2d(player.pos, s.pos) <= TUNING.springRadius);
    if (nearSpring) {
      player.needs.thirst = clamp01to100(player.needs.thirst + TUNING.drinkPerSec * (TUNING.springDrinkMult - 1) * DT);
      const maxHp = SPECIES[player.species]!.maxHp;
      player.hp = Math.min(maxHp, player.hp + TUNING.springHpPerSec * DT);
    }
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
