import { TUNING } from "@shiling/content";
import { dist2d } from "./vec.js";
import type { Creature, GameState, PlayerInput } from "./state.js";
import type { Terrain } from "./terrain.js";

/**
 * 叼运在玩家下巴前方的偏移距离（米）——不进 TUNING（brief 明确只列了
 * carrySpeedMult/nestBuildSec/nestStashCap 三项内容参数），沿用本工程"纯几何/展示
 * 常量就地字面量声明，不污染中央调参表"的既有惯例（例如 camera.ts 的
 * DRAG_SENSITIVITY）。刻意小于 TUNING.interactRange（2.5m）：叼着尸体走动时它本身
 * 仍落在"附近有尸体"的判定范围内——这正是"叼着时按 E 也能就地吃掉它"不需要在
 * eating.ts 里加特判的原因（eating.ts 的尸体扫描本来就是"interactRange 内最近的一
 * 具"，叼着的这具天然会被扫到）。
 */
const CARRY_OFFSET = 1.2;

/** 尸体贴地/贴水面——与 needs.ts 的饮水判定、movement.ts 的落水判定同一条件（h < waterLevel）。 */
function groundAlignedDrop(terrain: Terrain, x: number, z: number): { x: number; y: number; z: number } {
  const inWater = terrain.isWater(x, z);
  return { x, y: inWater ? terrain.waterLevel : terrain.heightAt(x, z), z };
}

/** interactRange 内最近的尸体 id（无则 null）——调用方只在 carryingCarcassId===null
 *  时才会走到这里（拾起分支），天然不会选中自己已经叼着的那具。 */
function nearestCarcassId(state: GameState, p: Creature): number | null {
  let bestId: number | null = null;
  let bestDist = Infinity;
  for (const c of state.carcasses) {
    const d = dist2d(p.pos, c.pos);
    if (d <= TUNING.interactRange && d < bestDist) { bestId = c.id; bestDist = d; }
  }
  return bestId;
}

/**
 * C 键放下：优先在家附近存粮（deposit into state.homeNest.stash，cap
 * TUNING.nestStashCap，溢出部分保留在尸体上照常掉落），否则原地贴地/贴水放下。
 * 调用前 p.carryingCarcassId 必须非 null（由 tickCarrying 保证）。
 */
function dropCarried(state: GameState, terrain: Terrain, p: Creature): void {
  const carcass = state.carcasses.find((c) => c.id === p.carryingCarcassId);
  p.carryingCarcassId = null;
  if (!carcass) return; // 理论上不会发生（见 tickCarrying 顶部的兜底清空），双重保险

  const nest = state.homeNest;
  if (nest) {
    const spot = terrain.digSpots.find((s) => s.id === nest.spotId);
    if (spot && dist2d(p.pos, spot.pos) <= TUNING.interactRange) {
      const room = Math.max(0, TUNING.nestStashCap - nest.stash);
      const deposited = Math.min(carcass.meat, room);
      nest.stash += deposited;
      carcass.meat -= deposited;
      if (carcass.meat <= 0) {
        state.carcasses = state.carcasses.filter((c) => c.id !== carcass.id);
        return;
      }
      // 溢出（cap 已满）：剩余 meat 的尸体照常掉落在当前位置，走下面的贴地分支——
      // 不额外提示，玩家自己能看出尸体还在（HUD 批次二再考虑要不要专门标出"溢出"）。
    }
  }

  const aligned = groundAlignedDrop(terrain, p.pos.x, p.pos.z);
  carcass.pos.x = aligned.x;
  carcass.pos.y = aligned.y;
  carcass.pos.z = aligned.z;
}

/**
 * 叼运系统（玩家专属，M1 postfix N1——「叼运尸体＋筑巢＋储粮」）。
 *
 * tick 顺序：tickEating 之后、tickAi 之前（见 sim.ts step() 的注释）——进食（吃掉自己
 * 叼着的那具尸体，见下方"跨系统联动"一节）可能把 carcass.meat 吃到 <=0 并把它整个从
 * state.carcasses 移除；本系统必须在那之后运行，才能在同一 tick 里看到"尸体已被吃空
 * 移除"这个最终状态，及时清空 carryingCarcassId（本函数顶部的兜底逻辑）。
 *
 * 三个守卫（brief 原话「不能把食物带走/没有筑巢/不能拖回巢穴」——这里对应的是"不能
 * 拖回巢穴"一侧的字面意思：叼着的时候干脆不能钻地）：
 *   - 死亡：函数顶部直接 return（与其它 tick* 系统一致）。
 *   - 洞中（p.burrowId !== null）：拾起分支的守卫之一——已经在洞里，不可能"附近"有
 *     尸体触发拾起，但仍显式写出，防止将来洞口 interactRange 判定变化时悄悄失守。
 *   - 挖掘中（p.activity === "digging"）：同上，显式守卫。
 *   反过来——叼着东西时不能挖洞/进出洞/筑巢——由 digging.ts 顶部的
 *   `if (p.carryingCarcassId !== null) return;` 守卫，不在本文件内处理。
 *
 * 跨系统联动：
 *   - 移动减速（carrySpeedMult）：走 movement.ts 的 movePlayer，本系统不碰速度。
 *   - 攻击禁用：走 eating.ts 攻击分支的 `p.carryingCarcassId === null` 守卫，本系统
 *     不碰攻击判定。
 *   - 叼着时按 E 进食：eating.ts 的尸体扫描不需要任何特判——叼着的尸体因为
 *     CARRY_OFFSET < interactRange，天然会被"interactRange 内最近的一具"扫到。
 */
export function tickCarrying(state: GameState, terrain: Terrain, input: PlayerInput): void {
  const p = state.creatures.find((c) => c.id === state.playerId);
  if (!p || p.activity === "dead") return;

  // 兜底：叼着的尸体这一 tick 若已经被吃空移除（见上方 tick 顺序一节），清空引用，
  // 不让下面的"跟随"逻辑对着一个不存在的 id 空跑。
  if (p.carryingCarcassId !== null && !state.carcasses.some((c) => c.id === p.carryingCarcassId)) {
    p.carryingCarcassId = null;
  }

  if (input.carry && !p.carryHeld) {
    if (p.carryingCarcassId !== null) {
      dropCarried(state, terrain, p);
    } else if (p.burrowId === null && p.activity !== "digging") {
      const foundId = nearestCarcassId(state, p);
      if (foundId !== null) p.carryingCarcassId = foundId;
    }
  }
  p.carryHeld = input.carry;

  if (p.carryingCarcassId === null) return;
  const carcass = state.carcasses.find((c) => c.id === p.carryingCarcassId);
  if (!carcass) return; // 双重保险，理论上已被顶部的兜底清空拦住
  // 跟随：下巴前方偏移（沿玩家 yaw 方向，forward = (sin(yaw), cos(yaw))，与
  // movement.ts 的 `yaw = atan2(nx, nz)` 同一约定），y 直接贴玩家自身高度
  // （brief 原话"y at player pos"，不是贴地/贴水——玩家游泳时叼着的尸体也跟着
  // 浮在玩家所在高度，简单且不违和）。
  carcass.pos.x = p.pos.x + Math.sin(p.yaw) * CARRY_OFFSET;
  carcass.pos.z = p.pos.z + Math.cos(p.yaw) * CARRY_OFFSET;
  carcass.pos.y = p.pos.y;
}
