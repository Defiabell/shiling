import type { Creature, GameState, Locomotion, Vec3 } from "@shiling/sim";

/**
 * 状态 diff 事件流：把两帧相邻的 GameState 差异翻译成渲染层可消费的离散视觉事件
 * （粒子/屏幕特效，见 Task 6/7）。纯函数式 diff——不跑 sim、不依赖 THREE/DOM，
 * 唯一的内部状态是 digTick 节流累加器（放在 differ 闭包里，不污染 GameState）。
 */
export type SimEvent =
  | { kind: "hit"; id: number; pos: Vec3; lethal: boolean } // hp 下降；lethal=该 id 同帧消失或 activity==="dead"
  | { kind: "death"; id: number; species: string; pos: Vec3 } // creature 从列表消失（或玩家 playerDead 边沿）
  | { kind: "splash"; id: number; pos: Vec3 } // locomotion walk→swim 或 swim→walk
  | { kind: "digTick"; pos: Vec3 } // 玩家 activity==="digging"（每 0.4s 节流）
  | { kind: "drink"; pos: Vec3 } // 玩家 activity 变为 "drinking" 边沿
  | { kind: "carcassGone"; id: number; pos: Vec3 } // 尸体消失（吃光）
  | { kind: "burrowToggle"; entered: boolean; pos: Vec3 } // 玩家 burrowId null↔非 null
  | { kind: "vanish"; id: number; pos: Vec3 } // hiddenTicks 0→>0（M1 B6，目前只有穴獾遁地会命中）
  | { kind: "pitSnare"; id: number; pos: Vec3 } // M15 P1：潭狩 snaredTicks 0→>0（陷坑触发瞬间）
  | { kind: "adrenaline"; pos: Vec3 }; // M15 P1：玩家 adrenalineTicks 0→>0（濒死爆发触发边沿）

const DIG_TICK_INTERVAL_SEC = 0.4;

/** walk<->swim 之间的往返视为一次落水/上岸 splash；不含 burrow。 */
function isSplashTransition(prev: Locomotion, curr: Locomotion): boolean {
  return (prev === "walk" && curr === "swim") || (prev === "swim" && curr === "walk");
}

/**
 * 创建一个 differ 闭包。返回的函数按 (prev, curr, dtSec) 逐帧调用；
 * prev 为 null（首帧，无可对比基线）时返回空数组。
 *
 * **快照契约（CRITICAL——调用方必须遵守，否则事件流会静默清零）：**
 * `createSim` 的 `state` 是同一个对象，每次 `sim.step()` 都在原地 mutate（不会产生新引用）。
 * 如果渲染循环偷懒写 `prevState = sim.state`，那么下一次 `step()` 之后 `prevState` 和
 * `sim.state` 会是**同一个对象**——本 differ 内部所有比较（`c.hp < p.hp`、locomotion/
 * activity/burrowId 差异、creatures/carcasses 差集）都会因为"两边读到的是同一份最新数据"
 * 而恒为 false/无差异，且不会抛错、不会有任何日志——事件流只是悄无声息地永远返回 []。
 * 单测测不出这个坑，因为测试里 prev/curr 本来就是两个独立的静态字面量对象。
 *
 * 调用方（Task 6/7 的渲染循环）必须在**每次 `sim.step()` 之前**对当前 `sim.state` 拍一份
 * 真正独立的快照，作为下一帧的 `prev` 传入。在本项目这个规模下最省事、够用的写法：
 *
 * ```ts
 * let prevSnapshot: GameState | null = null;
 * const diff = createSimEventDiffer();
 * function frame(dtSec: number, input: PlayerInput) {
 *   sim.step(input); // 先推进一帧（原地 mutate sim.state）
 *   const events = diff(prevSnapshot, sim.state, dtSec); // 拿上一帧快照 vs 刚推进后的最新状态
 *   // ... 消费 events（粒子/屏幕特效）...
 *   // 关键：snapshot 只需要覆盖 differ 实际读取的字段
 *   // （creatures、carcasses、playerDead、playerId、adrenalineTicks——M15 P1 新增的
 *   // 顶层字段边沿判据，见下方 adrenaline 事件），不必整份 clone terrain 等重量级字段；
 *   // structuredClone 是 deep clone，保证下一帧 diff 时 prevSnapshot 不会和 sim.state 共享引用。
 *   prevSnapshot = structuredClone({
 *     creatures: sim.state.creatures,
 *     carcasses: sim.state.carcasses,
 *     playerDead: sim.state.playerDead,
 *     playerId: sim.state.playerId,
 *     tick: sim.state.tick,
 *     nextId: sim.state.nextId,
 *     adrenalineTicks: sim.state.adrenalineTicks,
 *   }) as GameState;
 * }
 * ```
 */
export function createSimEventDiffer(): (prev: GameState | null, curr: GameState, dtSec: number) => SimEvent[] {
  let digAccum = 0; // digTick 节流累加器，只在这个 differ 实例内持续

  return (prev, curr, dtSec) => {
    if (prev === null) return [];

    const events: SimEvent[] = [];
    const prevById = new Map<number, Creature>(prev.creatures.map((c) => [c.id, c]));
    const currById = new Map<number, Creature>(curr.creatures.map((c) => [c.id, c]));

    // hit / splash：prev、curr 中都存在的 creature 按字段对比。
    for (const [id, c] of currById) {
      const p = prevById.get(id);
      if (!p) continue; // 本帧新出现（生成），无 diff 基线，不产生事件

      if (c.hp < p.hp) {
        // `c.activity === "dead"` 分支在真实数据流里只有玩家会命中：非玩家死者
        // 同一 tick 就被 killCreature 从数组过滤掉了（见下方 death 循环的注释），
        // 走不到这个"prev/curr 都存在"的分支。
        const lethal = c.activity === "dead" || (id === curr.playerId && !prev.playerDead && curr.playerDead);
        events.push({ kind: "hit", id, pos: { ...c.pos }, lethal });
      }
      if (isSplashTransition(p.locomotion, c.locomotion)) {
        events.push({ kind: "splash", id, pos: { ...c.pos } });
      }
      // M1 B6：hiddenTicks 0→>0——与 creatureView.ts 的可见性判定同一字段（见该文件
      // `view.mesh.visible = ... && c.hiddenTicks === 0`），这里只是把同一次视觉消失
      // 翻译成一个可供 audio.ts 消费的离散事件。隐匿的生物仍留在 state.creatures 里
      // （不像死亡那样被移除），所以走的是这条"prev/curr 都存在"的分支，不是下面的
      // death 分支。
      if (p.hiddenTicks === 0 && c.hiddenTicks > 0) {
        events.push({ kind: "vanish", id, pos: { ...c.pos } });
      }
      // M15 P1：陷坑触发——snaredTicks 0→>0，与上面 hiddenTicks 的判据同一套边沿写法
      // （只有潭狩会命中，见 sim/src/pits.ts 的 tickPitSnares，但这里不需要按 species
      // 特判——非潭狩物种的 snaredTicks 恒为 0，这条边沿天然只会在潭狩身上触发）。
      if (p.snaredTicks === 0 && c.snaredTicks > 0) {
        events.push({ kind: "pitSnare", id, pos: { ...c.pos } });
      }
    }

    // death：prev 存在、curr 消失的非玩家 creature。真实 sim 里 killCreature 在同一 tick
    // 把非玩家死者从数组移除，因此"消失"本身就蕴含"本帧 hp 归零死亡"——一并补一条
    // lethal hit，保持"死亡=致命一击"的 trace 一致性（若 prev 时已是 0 血则不重复补）。
    for (const [id, p] of prevById) {
      if (currById.has(id)) continue;
      events.push({ kind: "death", id, species: p.species, pos: { ...p.pos } });
      if (p.hp > 0) {
        events.push({ kind: "hit", id, pos: { ...p.pos }, lethal: true });
      }
    }

    // 玩家特例：playerDead false→true 边沿。玩家死亡后仍留在 creatures 数组里
    // （killCreature 只 filter 非玩家），所以走不到上面的"消失"分支，须单独判。
    if (!prev.playerDead && curr.playerDead) {
      const player = currById.get(curr.playerId);
      if (player) {
        events.push({ kind: "death", id: player.id, species: player.species, pos: { ...player.pos } });
      }
    }

    // 玩家专属：digTick 节流 / drink 边沿 / burrowToggle。
    const prevPlayer = prevById.get(curr.playerId);
    const currPlayer = currById.get(curr.playerId);
    if (currPlayer) {
      if (currPlayer.activity === "digging") {
        digAccum += dtSec;
        // 单个 if（非 while）在 dtSec 远大于 0.4s 时会欠触发（一帧最多补发一次，不会
        // 一次性把跳过的所有阈值都补齐）。固定 DT（sim tick 定长）下 dtSec 不会大幅
        // 超过 0.4s，这里不是问题；但如果 dtSec 改用真实 wall-clock delta（例如掉帧、
        // 切后台恢复），单帧 dtSec 可能远超 0.4s，届时需要改成 while 循环补发。
        if (digAccum >= DIG_TICK_INTERVAL_SEC) {
          digAccum -= DIG_TICK_INTERVAL_SEC;
          events.push({ kind: "digTick", pos: { ...currPlayer.pos } });
        }
      } else {
        digAccum = 0;
      }

      if (currPlayer.activity === "drinking" && prevPlayer?.activity !== "drinking") {
        events.push({ kind: "drink", pos: { ...currPlayer.pos } });
      }

      const prevBurrowId = prevPlayer?.burrowId ?? null;
      if (prevBurrowId === null && currPlayer.burrowId !== null) {
        events.push({ kind: "burrowToggle", entered: true, pos: { ...currPlayer.pos } });
      } else if (prevBurrowId !== null && currPlayer.burrowId === null) {
        events.push({ kind: "burrowToggle", entered: false, pos: { ...currPlayer.pos } });
      }

      // M15 P1：濒死爆发边沿——state.adrenalineTicks 0→>0（GameState 顶层字段，不挂在
      // Creature 上，见 sim/src/state.ts），与上面 burrowId 的判据同一层级、同一写法，
      // 只是比对的字段来自 prev/curr 整体而不是 currPlayer。
      if (prev.adrenalineTicks === 0 && curr.adrenalineTicks > 0) {
        events.push({ kind: "adrenaline", pos: { ...currPlayer.pos } });
      }
    }

    // carcassGone：尸体消失（吃光，见 ai.ts doFeed / eating.ts）。
    const currCarcassIds = new Set(curr.carcasses.map((cc) => cc.id));
    for (const cc of prev.carcasses) {
      if (!currCarcassIds.has(cc.id)) {
        events.push({ kind: "carcassGone", id: cc.id, pos: { ...cc.pos } });
      }
    }

    return events;
  };
}
