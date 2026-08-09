import { TUNING } from "@shiling/content";
import { DT } from "./sim.js";
import { dist2d } from "./vec.js";
import type { Creature, GameState, PlayerInput } from "./state.js";
import type { DigSpot, Terrain } from "./terrain.js";

/** 入洞：位置钉在洞口、切 burrow locomotion、复位挖掘进度。 */
function enterBurrow(p: Creature, spot: DigSpot): void {
  p.pos = { ...spot.pos };
  p.burrowId = spot.id;
  p.locomotion = "burrow";
  p.activity = "idle";
  p.digProgress = 0;
}

/** 出洞：恢复 walk，按当前（洞口）位置贴地。 */
function exitBurrow(p: Creature, terrain: Terrain): void {
  p.burrowId = null;
  p.locomotion = "walk";
  p.activity = "idle";
  p.pos.y = terrain.heightAt(p.pos.x, p.pos.z);
}

/**
 * 筑巢完成（M1 postfix N1）：只允许一个家——state.homeNest 是单例，不是数组。若已
 * 有家且尚有存粮，先把旧家的存粮转成一具尸体扔在旧地点，再把 home 挪到新洞：brief
 * 原话的取舍——"stash 不直接转移，而是转成一具尸体留在原地"，保留"东西没凭空消失"
 * 的直觉，同时不必实现真正的库存搬运。Carcass.species 填 "lingshu"：这是一处刻意的
 * 简化——本没有一个"通用干粮"物种，权且借用最常见的草食动物名占位，不代表真的复原出
 * 一只苓鼠尸体，纯粹让这份数据能塞进现有的 Carcass 类型（species 字段本该是具体物种）。
 */
function buildHomeNest(state: GameState, p: Creature, terrain: Terrain): void {
  const old = state.homeNest;
  if (old && old.stash > 0) {
    const oldSpot = terrain.digSpots.find((s) => s.id === old.spotId);
    if (oldSpot) {
      state.carcasses.push({ id: state.nextId++, species: "lingshu", pos: { ...oldSpot.pos }, meat: old.stash });
    }
  }
  state.homeNest = { spotId: p.burrowId!, stash: 0 };
  p.nestProgress = 0;
}

/**
 * 玩家专属系统（M0 NPC 不挖洞），在 movePlayer 之后、tickNeeds 之前执行：
 * - 未挖开的 dig spot 附近（dist2d <= interactRange）按住 interact → activity="digging"，
 *   digProgress 按 DT 累积；达到 digDurationSec → spot.dug=true 并自动入洞。
 * - 已挖开的洞口按 interact（松开后再按的上升沿）→ 入洞；洞中按 interact（同样上升沿）→ 出洞。
 *   interactHeld 记录上一 tick 的 interact 状态，保证一次按键只触发一次进/出洞，不会
 *   在同一次按住里"进洞又出洞"。
 * - 移动输入（moveX/moveZ 非零）取消挖掘：digProgress 归零，且不在同一 tick 处理进/出洞
 *   （moveCreature 对 burrowId !== null 已 early-return，移动本身也不会真的移动玩家）。
 *
 * 筑巢（M1 postfix N1，见 buildHomeNest）：在一个已挖开、玩家占据的洞穴里（p.burrowId
 * !== null）持续按住 E（而不是"释放后再按"的新按下沿）累积 nestProgress，达到
 * TUNING.nestBuildSec 后转为玩家的家。这与"入洞后一次新的按下沿会出洞"并不冲突——
 * 玩家进洞那一下按下沿已经消耗掉了（enterBurrow 分支末尾把 interactHeld 同步成
 * true），只要不释放 E 就不会再产生新的按下沿，所以"持续按住"天然只会走"累积筑巢
 * 进度"这条分支，不会被出洞逻辑打断；只有释放再按（一次新的按下沿）才会触发出洞。
 * 松开 E（未达标）→ nestProgress 归零但不出洞——"可打断"仅指进度作废，不等于"松开
 * 就出洞"（那需要单独再按一次）。已经是家的洞穴（state.homeNest?.spotId ===
 * p.burrowId）不再累积——持续按住时只保留"出洞"这一个语义，避免每 tick 都判一次
 * 早已完成的筑巢阈值。
 *
 * 叼运互斥（M1 postfix N1）：叼着尸体时（p.carryingCarcassId !== null）本系统整体
 * 早退——不能挖洞、不能进出洞、不能筑巢（brief 原话"不能拖回巢穴"）。反过来"叼着时
 * 不能进食"不成立——进食走 eating.ts 的独立守卫，见该文件。
 */
export function tickDigging(state: GameState, terrain: Terrain, input: PlayerInput): void {
  const p = state.creatures.find((c) => c.id === state.playerId);
  if (!p || p.activity === "dead") return;
  if (p.carryingCarcassId !== null) return;

  const moving = input.moveX !== 0 || input.moveZ !== 0;

  if (moving) {
    if (p.burrowId === null) {
      p.digProgress = 0;
      if (p.activity === "digging") p.activity = "idle";
    } else {
      p.nestProgress = 0; // 移动对洞中玩家本就是 no-op（moveCreature 直接 early-return），
                           // 这里只是防御性地保持"打断累积"的语义在洞中同样成立。
    }
    p.interactHeld = input.interact;
    return;
  }

  if (p.burrowId !== null) {
    if (input.interact) {
      if (!p.interactHeld) {
        exitBurrow(p, terrain); // 新按下沿：出洞（见函数头注释——这与筑巢累积不冲突）
      } else if (state.homeNest?.spotId !== p.burrowId) {
        p.nestProgress += DT;
        if (p.nestProgress >= TUNING.nestBuildSec) buildHomeNest(state, p, terrain);
      }
    } else {
      p.nestProgress = 0; // 松开：进度作废（可打断），但不出洞
    }
    p.interactHeld = input.interact;
    return;
  }

  const spot = terrain.digSpots.find((s) => dist2d(p.pos, s.pos) <= TUNING.interactRange);
  if (!spot) {
    if (p.activity === "digging") { p.activity = "idle"; p.digProgress = 0; }
    p.interactHeld = input.interact;
    return;
  }

  if (!spot.dug) {
    if (input.interact) {
      p.activity = "digging";
      p.digProgress += DT;
      if (p.digProgress >= TUNING.digDurationSec) {
        spot.dug = true;
        enterBurrow(p, spot);
      }
    } else if (p.activity === "digging") {
      p.activity = "idle";
    }
  } else if (input.interact && !p.interactHeld) {
    enterBurrow(p, spot);
  }

  p.interactHeld = input.interact;
}
