import { TUNING } from "@shiling/content";
import { DT } from "./sim.js";
import { dist2d } from "./vec.js";
import { getModifiers } from "./organs.js";
import { nearWater } from "./needs.js";
import { addPit } from "./pits.js";
import type { Creature, GameState, PlayerInput } from "./state.js";
import type { DigSpot, Terrain } from "./terrain.js";

/** 入洞：位置钉在洞口、切 burrow locomotion、复位挖掘进度。 */
function enterBurrow(p: Creature, spot: DigSpot): void {
  p.pos = { ...spot.pos };
  p.burrowId = spot.id;
  p.locomotion = "burrow";
  p.activity = "idle";
  p.digProgress = 0;
  p.pitDigProgress = 0; // 防御性收口（M15 P1）：理论上进洞前 pitDigProgress 必然已经是 0
                        // （见 tickPitDig 调用点旁边"E 优先级链"注释——两者互斥场景），一并清零。
}

/** 出洞：恢复 walk，按当前（洞口）位置贴地。 */
function exitBurrow(p: Creature, terrain: Terrain): void {
  p.burrowId = null;
  p.locomotion = "walk";
  p.activity = "idle";
  p.pos.y = terrain.heightAt(p.pos.x, p.pos.z);
}

/**
 * 陷坑挖掘（M15 P1「反制包」，owner feedback「面对高级怪物只能被追上被杀，没有反制
 * 措施，不能设置陷阱」）：与挖点数值同构（累积/打断语义完全照抄 tickDigging 对
 * digProgress 的既有处理——见调用点旁边关于"仅移动才清零、松开只是暂停"的说明），
 * 唯一的区别是完成后不入洞，而是调 addPit 在原地生成一个陷坑。
 *
 * 疲劳净耗损（brief 原话「drains fatigue slightly, i.e. net drain」）：tickNeeds
 * 稍后本 tick 仍会给"未在移动、未在洞里"的生物（挖陷坑复用 activity="digging"，落在
 * tickNeeds 的 else 分支）统一加一份 fatigueRecoverPerSec×DT 的空闲恢复——这里先扣掉
 * "这份恢复 + pitDigFatigueDrainMult 份耗损"，两者相加后净效果正是耗损
 * pitDigFatigueDrainMult×fatigueWalkRecoverPerSec（与 eating.ts 头部注释的
 * decay-compensation 手法同构，只是方向相反：那里是"垫平衰减"，这里是"垫平恢复再
 * 倒扣耗损"）。刻意不在这一行 clamp 到 0——tickNeeds 稍后的 clamp01to100 才是唯一的
 * 钳制点；若在这里先 clamp 到 0 再让 tickNeeds 加回正值，疲劳触底时会被"弹起"，
 * 违背"净耗损、触底后钉住"的设计意图。
 */
function tickPitDig(state: GameState, p: Creature, input: PlayerInput): void {
  if (input.interact) {
    p.activity = "digging";
    p.pitDigProgress += DT;
    p.needs.fatigue -= (TUNING.fatigueRecoverPerSec + TUNING.pitDigFatigueDrainMult * TUNING.fatigueWalkRecoverPerSec) * DT;
    if (p.pitDigProgress >= TUNING.pitDigSec) {
      addPit(state, p.pos);
      p.pitDigProgress = 0;
      p.activity = "idle";
    }
  } else if (p.activity === "digging") {
    p.activity = "idle";
  }
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
 *
 * 陷坑（M15 P1「反制包」）与 E 消费者优先级链：整个游戏里 E（interact）同一 tick 可能
 * 被四套系统各自独立读到——本文件的挖点/进出洞/筑巢、eating.ts 的进食、needs.ts 的
 * 饮水，现在再加上本文件新增的"陷坑挖掘"。四者从不真的互相查询对方的判定结果，靠的
 * 是 sim.ts step() 的调用顺序（本文件排最前）+ 各自扫描范围天然大多不重叠这一事实
 * 隐性分出优先级：
 *   1. 挖点/洞口（本文件，interactRange 内存在 dig spot）——最高优先级，命中就直接
 *      return，后面三者今天这一 tick 都不会跑到。
 *   2. 陷坑挖掘（本文件新增的 FALLBACK，见 tickPitDig 调用点）——只在"附近没有挖点"
 *      的前提下，进一步排除"附近有尸体"（留给 eating.ts 的叼起/进食）与"在水边"
 *      （留给 needs.ts 的饮水，用同一份 nearWater 几何判据，见 needs.ts 的导出注释）
 *      之后才轮到；玩家因此必须站在真正开阔、可挖的陆地上才能触发陷坑挖掘，不会跟
 *      饮水/进食在同一次按键上打架。
 *   3/4. 进食、饮水——本文件对它们完全不知情，只是通过"如果附近有尸体/水就不挖陷坑"
 *      间接让位，真正的判定各自留在 eating.ts/needs.ts 内部。
 * client 侧的 HUD 提示（hud.ts 的 contextPrompt）按同一优先级顺序渲染单一提示词，
 * 见该文件顶部注释。
 */
export function tickDigging(state: GameState, terrain: Terrain, input: PlayerInput): void {
  const p = state.creatures.find((c) => c.id === state.playerId);
  if (!p || p.activity === "dead") return;
  // 蛰伏中（M1 B3）：玩家专属输入系统整体锁死，见 dormancy.ts 头部注释——包括出洞，
  // 蛰伏进行中按 E 不会有任何效果。
  if (state.dormancy !== null) return;
  if (p.carryingCarcassId !== null) return;

  const moving = input.moveX !== 0 || input.moveZ !== 0;

  if (moving) {
    if (p.burrowId === null) {
      p.digProgress = 0;
      p.pitDigProgress = 0; // M15 P1：移动同样打断陷坑挖掘（与打断挖点是同一语义）
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
    // 陷坑（M15 P1）：E 优先级链的 FALLBACK——见函数头部注释"E 消费者优先级链"一节。
    // 走到这里已经确定附近没有挖点（上面 `!spot`）；再排除尸体（tickEating 的 E
    // 消费者）与水边（tickNeeds 的饮水 E 消费者，nearWater 与那里同一份实现，见
    // needs.ts 导出注释）之后，剩下的才是"开阔地、没有其它 E 消费者"，轮到陷坑挖掘。
    // 三者判据都是只读几何探测，不改变任何状态，先判后走不会有副作用泄漏。
    const nearCarcass = state.carcasses.some((cc) => dist2d(p.pos, cc.pos) <= TUNING.interactRange);
    if (!nearCarcass && !nearWater(p, terrain)) {
      tickPitDig(state, p, input);
      p.interactHeld = input.interact;
      return;
    }
    // 附近有尸体/水但没有挖点：既不挖挖点也不挖陷坑，原样保留挖掘早退（活着的
    // digProgress/activity 交给 tickEating/tickNeeds 各自的 E 消费者去处理这次按键）。
    if (p.activity === "digging") { p.activity = "idle"; p.digProgress = 0; }
    p.pitDigProgress = 0;
    p.interactHeld = input.interact;
    return;
  }

  if (!spot.dug) {
    if (input.interact) {
      p.activity = "digging";
      // organ modifier（M1 B2）：digSpeedMult（掘爪）等价于把 digDurationSec 除以这个
      // 倍率——累积速度乘 mult 比每次都重算"剩余时长"更简单，效果等价。
      p.digProgress += DT * getModifiers(state).digSpeedMult;
      if (p.digProgress >= TUNING.digDurationSec) {
        spot.dug = true;
        // behaviorStats.digCount（M1 B1，consumed by B3 roll）：挖点完成的瞬间计一次——
        // 这个 if 分支只在 spot.dug 从 false 翻到 true 那一 tick 进入（外层已经是
        // `if (!spot.dug)` 守卫），不会对同一个洞口重复计数。
        state.behaviorStats.digCount += 1;
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
