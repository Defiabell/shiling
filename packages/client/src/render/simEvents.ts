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
  | { kind: "burrowToggle"; entered: boolean; pos: Vec3 }; // 玩家 burrowId null↔非 null

const DIG_TICK_INTERVAL_SEC = 0.4;

/** walk<->swim 之间的往返视为一次落水/上岸 splash；不含 burrow。 */
function isSplashTransition(prev: Locomotion, curr: Locomotion): boolean {
  return (prev === "walk" && curr === "swim") || (prev === "swim" && curr === "walk");
}

/**
 * 创建一个 differ 闭包。返回的函数按 (prev, curr, dtSec) 逐帧调用；
 * prev 为 null（首帧，无可对比基线）时返回空数组。
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
        const lethal = c.activity === "dead" || (id === curr.playerId && !prev.playerDead && curr.playerDead);
        events.push({ kind: "hit", id, pos: { ...c.pos }, lethal });
      }
      if (isSplashTransition(p.locomotion, c.locomotion)) {
        events.push({ kind: "splash", id, pos: { ...c.pos } });
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
