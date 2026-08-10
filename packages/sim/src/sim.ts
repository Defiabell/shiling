import { QINGQIU_GRAYBOX, SPECIES, TUNING, type WorldParams } from "@shiling/content";
import { createRng, type Rng } from "./rng.js";
import { v3, type Vec3 } from "./vec.js";
import type { Creature, GameState, PlayerInput } from "./state.js";
import { createTerrain, type DigSpot, type Terrain } from "./terrain.js";
import { movePlayer } from "./movement.js";
import { tickDigging } from "./digging.js";
import { tickEating } from "./eating.js";
import { tickAi } from "./ai.js";
import { tickNeeds } from "./needs.js";
import { tickCarrying } from "./carrying.js";
import { tickTemper } from "./organs.js";
import { tickDormancy } from "./dormancy.js";
import { tickPitSnares } from "./pits.js";
import { tickAdrenaline } from "./adrenaline.js";

export const DT = 1 / TUNING.tickHz;

export type { DigSpot, Terrain };

export interface Sim {
  state: GameState;
  terrain: Terrain;
  step(input: PlayerInput): void;
}

const MAX_REJECTION_ATTEMPTS = 10_000;

/**
 * 在 params.size 范围内 rejection-sample，直到落在陆地且离水线有余量的位置
 * （h > waterLevel + 0.5；该条件已蕴含 !isWater，因为 isWater 等价于 h < waterLevel）。
 */
export function randomLandPos(rng: Rng, terrain: Terrain, params: WorldParams): Vec3 {
  const half = params.size / 2;
  for (let attempt = 0; attempt < MAX_REJECTION_ATTEMPTS; attempt++) {
    const x = rng.range(-half, half);
    const z = rng.range(-half, half);
    const h = terrain.heightAt(x, z);
    if (h > terrain.waterLevel + 0.5) return v3(x, h, z);
  }
  throw new Error("randomLandPos: no land position found after max attempts; check WorldParams");
}

/**
 * randomLandPos 的镜像（M1 B4，水生锁定物种——溪鱼 xiyu——的出生点采样）：rejection-sample
 * 直到落在水域（isWater 为真）。y 直接取 terrain.waterLevel——与 moveCreature/movement.ts
 * 的贴水面惯例一致（游泳生物的 pos.y 从不读 heightAt，见 movement.ts 的 nowWater 分支）。
 */
export function randomWaterPos(rng: Rng, terrain: Terrain, params: WorldParams): Vec3 {
  const half = params.size / 2;
  for (let attempt = 0; attempt < MAX_REJECTION_ATTEMPTS; attempt++) {
    const x = rng.range(-half, half);
    const z = rng.range(-half, half);
    if (terrain.isWater(x, z)) return v3(x, terrain.waterLevel, z);
  }
  throw new Error("randomWaterPos: no water position found after max attempts; check WorldParams");
}

const terrainFactory = createTerrain;

/** 生成一只生物并加入 state.creatures，供 createSim 内部与测试使用。 */
export function spawnCreature(
  state: GameState,
  rng: Rng,
  terrain: Terrain,
  params: WorldParams,
  species: string,
): Creature {
  const def = SPECIES[species];
  if (!def) throw new Error(`unknown species: ${species}`);
  // M1 B4：水生锁定物种（aquatic=true，目前仅溪鱼 xiyu）出生点必须落在水域本身——
  // randomLandPos 会采到陆地点，而 aquatic 生物的 moveCreature 挡水守卫（见
  // movement.ts 的 isTerrainBlocked）会把它钉死在陆地上永远下不了水，这不是"生成即被卡死"
  // 的边缘情形，是每一次出生都会发生。
  const pos = def.aquatic ? randomWaterPos(rng, terrain, params) : randomLandPos(rng, terrain, params);
  // 初始朝向复用 yaw 的随机模式，另起一次采样给 aiDir（游走的初始方向）。
  const initAiAngle = rng.range(0, Math.PI * 2);
  const c: Creature = {
    id: state.nextId++,
    species,
    pos,
    yaw: rng.range(0, Math.PI * 2),
    hp: def.maxHp,
    needs: { hunger: 80, thirst: 80, fatigue: 100 },
    locomotion: def.aquatic ? "swim" : "walk",
    activity: "idle",
    // 苓鼠/溪鱼/穴獾三个食草物种共用 "wander" 起始态（各自的机器——tickFleeingHerbivore/
    // tickBurrowEvader——都从 wander 开始）；潭狩 patrol/hunt/feed；玩家留 "idle"
    // （Task 11 起接了专属的进食/攻击响应，"idle" 只是 AI 派发意义上的"不属于任何 NPC 机器"）。
    aiState: species === "tanshou" ? "patrol" : species === "youshou" ? "idle" : "wander",
    targetId: null,
    attackCooldown: 0,
    feedingCarcassId: null,
    burrowId: null,
    satiatedTimer: 0,
    digProgress: 0,
    interactHeld: false,
    aiDirX: Math.sin(initAiAngle),
    aiDirZ: Math.cos(initAiAngle),
    aiTimer: TUNING.aiRepathSec,
    fleeTime: 0,
    fleeRecoverTime: 0,
    carryingCarcassId: null,
    carryHeld: false,
    nestProgress: 0,
    dormantHeld: false,
    hiddenTicks: 0, // M1 B4：仅穴獾的 tickBurrowEvader 会写非零值，其余物种恒 0
    pitDigProgress: 0, // M15 P1：仅玩家的 tickPitDig 会写非零值，其余物种恒 0
    snaredTicks: 0, // M15 P1：仅潭狩会被 pits.ts 的 tickPitSnares 写非零值，其余物种恒 0
  };
  state.creatures.push(c);
  return c;
}

export function createSim(seed: number, params: WorldParams = QINGQIU_GRAYBOX): Sim {
  const rng = createRng(seed);
  const terrain = terrainFactory(seed, params);
  const state: GameState = {
    tick: 0, playerId: 0, nextId: 1, creatures: [], carcasses: [], playerDead: false, homeNest: null,
    timeOfDay: 0.3, // M1 B1：spawn 初值=上午（[0,1) 环绕，0=黎明）
    essence: { zu: 0, lin: 0, xue: 0, meng: 0 }, // M1 B1：玩家精气，全 0 初始化
    behaviorStats: { swimSec: 0, digCount: 0, sprintSec: 0, kills: 0 }, // M1 B1：全 0 初始化
    // M1 B2：本命「神种」出生即装，占 innate 槽且不可替换；六个可替换槽初始留空
    // （键不存在，不是空对象占位）。temper 初值 50——数据模型定的固定出生值，不是
    // 从任何公式推出来的。
    organs: { innate: { organId: "shenzhong", temper: 50 } },
    hitsTaken: 0, // M1 B2：全 0 初始化，见 state.ts 字段注释
    organsPrevCounters: { digCount: 0, kills: 0, hitsTaken: 0 }, // M1 B2：全 0 初始化
    dormancy: null, // M1 B3：未在蛰伏
    lastEvolution: null, // M1 B3：从未开奖过
    pits: [], // M15 P1：尚未挖出任何陷坑
    adrenalineTicks: 0, // M15 P1：未在濒死爆发窗口
    adrenalineCooldown: 0, // M15 P1：不在冷却中
    adrenalineArmed: true, // M15 P1：出生满血，天然在阈值之上，可以触发下一次边沿
  };

  state.playerId = spawnCreature(state, rng, terrain, params, "youshou").id;
  for (const s of params.spawns) {
    for (let i = 0; i < s.count; i++) spawnCreature(state, rng, terrain, params, s.species);
  }

  return {
    state,
    terrain,
    step(input: PlayerInput) {
      state.tick++;
      // 昼夜时钟（M1 B1，client B5 消费）：[0,1) 环绕，一圈耗时 TUNING.dayLengthSec 秒。
      // 放在 tick 递增之后、其它系统之前——纯粹是"每 tick 必然发生一次"的全局状态更新，
      // 不依赖也不影响任何后续系统的执行顺序。
      state.timeOfDay = (state.timeOfDay + DT / TUNING.dayLengthSec) % 1;
      // 蛰伏（M1 B3）排在系统链最前面：它要在本 tick 决定 state.dormancy 是否为真，
      // 好让紧接着的 movePlayer/tickDigging/tickEating/tickCarrying（玩家专属输入系统）
      // 能各自在自己文件顶部读到这一 tick 最新的 dormancy 状态并整体早退——"least
      // invasive wiring"：本文件不需要在这四个调用点外面包一层 if，四个系统各自守卫
      // 自己（见 dormancy.ts 头部注释）。tickTemper/tickAi/tickNeeds 刻意不受影响
      // （理由同样见 dormancy.ts 头注）。
      tickDormancy(state, input, rng);
      // 系统按序执行；后续任务逐个填入：
      movePlayer(state, terrain, input); // (Task 6)
      tickDigging(state, terrain, input); // (Task 8; 筑巢分支：M1 postfix N1)
      tickEating(state, terrain, input); // (Task 11; 储粮进食分支：M1 postfix N1)
      // 叼运（M1 postfix N1）紧跟在 tickEating 之后：如果玩家边叼边吃（原地按 E 吃掉
      // 自己叼着的那具尸体），tickEating 可能刚把它的 meat 吃到 <=0 并整个移除——
      // tickCarrying 必须在那之后运行才能看到"尸体已被吃空移除"这个最终状态，及时清空
      // carryingCarcassId（见 carrying.ts 头注）。放在 tickAi 之前只是顺着"玩家专属
      // 系统分组在一起，NPC 系统统一殿后"的既有习惯，无强依赖。
      tickCarrying(state, terrain, input);
      // 器官用进（M1 B2）：必须排在 tickDigging/tickEating/tickCarrying 之后——它要 diff
      // 的 digCount/kills 计数器（分别在 tickDigging/tickEating 里递增）和 p.activity===
      // "eating"（tickEating 设置）都要是"本 tick 的最终值"才能被正确判定为"这一 tick
      // 新发生了一次"，不能排在它们前面（会读到上一 tick 的残留值，一律漏判）。必须排在
      // tickAi 之前——tickAi 会跑苓鼠的 preyNoticeMult 判定/潭狩的 damageTakenMult 判定，
      // 这两处都要读"本 tick 生效的 temper 缩放后的 modifiers"，理应用同一批 temper 值，
      // 不应该在同一 tick 内先旧后新地被 tickTemper 抽走一次地基。tanshou 造成的
      // hitsTaken 增量因此要等到下一 tick 才被本函数 diff 出来（见 organs.ts 头注），
      // 一 tick=50ms 的延迟不影响体感。
      tickTemper(state, input);
      tickAi(state, terrain, rng); // (Task 9)
      // 陷坑踩踏判定（M15 P1）：排在 tickAi 之后——要读的是本 tick 潭狩移动结算完的
      // 最终位置（追击/巡逻都可能在 tickAi 内部位移），不能排在它前面读到上一 tick
      // 的残留位置（那样会晚一 tick 才判定到"已经踩进去了"）。
      tickPitSnares(state);
      tickNeeds(state, terrain, input); // (Task 7)
      // 濒死爆发边沿检测（M15 P1）：排在 step() 最后——要读的是本 tick 战斗
      // （tickAi 的 resolveHunt）/饿死（tickNeeds 的 starve 分支）结算完的最终 hp，
      // 见 adrenaline.ts 头部注释的"1 tick 延迟，同 organs.ts hit 触发惯例"论证。
      tickAdrenaline(state);
    },
  };
}

export function getPlayer(state: GameState): Creature {
  const player = state.creatures.find((c) => c.id === state.playerId);
  if (!player) throw new Error(`player not found: id=${state.playerId}`);
  return player;
}
