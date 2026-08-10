import { TUNING } from "@shiling/content";
import { dist2d } from "./vec.js";
import type { GameState, Pit } from "./state.js";
import type { Vec3 } from "./vec.js";

/**
 * 陷坑（M15 P1「反制包」——owner feedback「面对高级怪物只能被追上被杀，没有反制措施，
 * 不能设置陷阱」）。玩家在开阔地挖出的定身陷阱，见 digging.ts 的 pit-dig 分支（触发/
 * 累积进度在那个文件，本文件只管 state.pits 数组本身的增删与潭狩踩坑判定）。
 *
 * 只有潭狩会触发（brief 原话「兽自己挖的坑自己认得」——玩家与猎物物种对陷坑免疫，
 * tickPitSnares 的扫描范围显式限定 species==="tanshou"）：玩家踩自己刚挖的坑毫无意义
 * （不构成任何反制张力），prey 物种被卷入是 M2 的路径规划题（"prey pathing into pits
 * is an M2 idea"，brief 原话），本批刻意不做。
 */

/** 挖好一个陷坑：塞进 state.pits，超过 TUNING.maxPits 时移除最旧的一个（数组首项，先进先出）。 */
export function addPit(state: GameState, pos: Vec3): void {
  const pit: Pit = { id: state.nextId++, pos: { ...pos }, armed: true };
  state.pits.push(pit);
  if (state.pits.length > TUNING.maxPits) state.pits.shift();
}

/**
 * 潭狩踩坑判定：任一未死亡、未入洞的潭狩与任一 armed 陷坑的距离 <= pitTriggerRadius
 * 时定身——写 snaredTicks（moveCreature 读它整体早退，见该文件），陷坑本身当场
 * disarm 并从数组移除（"disarm→removed"是同一步，见 state.ts 的 Pit 字段注释：外部
 * 快照永远看不到 armed:false 的中间状态）。已经被定身的潭狩不重复判定/不二次触发——
 * 定身期间它仍站在陷坑原地，若不排除会在 snaredTicks 归零前的每个 tick 都重新触发一次，
 * 把倒数永远续在最大值上，读起来像"永久定身"而不是"3 秒定身"。
 *
 * 实际冻结时长按构造是 pitSnareSec×tickHz − 1 个 tick（约 2.95s，不是刚好 3.00s，见
 * pits.test.ts 里那条精确断言）：本函数排在 sim.ts step() 里 tickAi 之后——触发那一
 * tick，tickAi 已经先跑过一次真实移动（潭狩踩中陷坑前的最后一步），才轮到这里写
 * snaredTicks；而解除定身那一 tick，ai.ts 的 tickTanshou 先把 snaredTicks 递减到 0，
 * moveCreature 紧接着在同一 tick 就读到新值、正常位移，不必等到下一 tick。两头各"省"
 * 半个 tick 的位移窗口，净效果就是少了一个整 tick——这是构造上必然如此，不是需要修的
 * 缺口，写在这里省得下一次有人重新推导一遍。
 */
export function tickPitSnares(state: GameState): void {
  if (state.pits.length === 0) return;
  const triggeredPitIds = new Set<number>();
  for (const c of state.creatures) {
    if (c.species !== "tanshou") continue;
    if (c.activity === "dead" || c.burrowId !== null) continue;
    if (c.snaredTicks > 0) continue; // 已经定身中，不重复触发（见函数头注释）
    for (const pit of state.pits) {
      // !pit.armed 同时挡住"本 tick 更早已被别的潭狩触发"的坑（armed 在触发时立即置
      // false，见下方），不需要额外查 triggeredPitIds 是否已含该 id。
      if (!pit.armed) continue;
      if (dist2d(c.pos, pit.pos) <= TUNING.pitTriggerRadius) {
        c.snaredTicks = Math.round(TUNING.pitSnareSec * TUNING.tickHz);
        pit.armed = false;
        triggeredPitIds.add(pit.id);
        break;
      }
    }
  }
  if (triggeredPitIds.size > 0) {
    state.pits = state.pits.filter((p) => !triggeredPitIds.has(p.id));
  }
}
