import * as THREE from "three";
import { createSim, DT, dist2d, getPlayer, type Creature, type GameState, type PlayerInput, type Terrain } from "@shiling/sim";
import { QINGQIU_GRAYBOX, SPECIES, TUNING } from "@shiling/content";
import { buildTerrainMesh, updateDigSpots, updateWater } from "./render/terrainMesh.js";
import { applyInterp, snapshotPrev, syncCreatures, type CreatureViews } from "./render/creatureView.js";
import { setupAtmosphere, mountPaperOverlay } from "./render/atmosphere.js";
import { createSimEventDiffer } from "./render/simEvents.js";
import { createParticles } from "./render/particles.js";
import { createScreenFx } from "./render/screenFx.js";
import { buildScatter } from "./render/scatter.js";
import { createInput } from "./input.js";
import { createFollowCamera } from "./camera.js";
import { createHud, type HudContext } from "./hud.js";
import { showTitle } from "./title.js";

// 种子只在 client 边界产生（Date.now() 非确定性），sim 内部逻辑仍保持确定性。
// 捕获成变量（而不是像原先那样直接内联进 createSim(...)）：Patch 3c 的地表
// 点缀（scatter.ts）要用同一个种子做 rejection-sample，"reuse the sim seed
// so scatter is deterministic per world" ——如果不捕获就没有第二次读取的机会。
const seed = Date.now() >>> 0;
const sim = createSim(seed);
const scene = new THREE.Scene();
// 背景交给天空穹顶接管（setupAtmosphere 里的 SphereGeometry + ShaderMaterial），
// 不再用 renderer 清屏色 / 单一 scene.background 顶替。
scene.background = null;
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 500);
camera.position.set(0, 60, 80);
camera.lookAt(0, 0, 0);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
setupAtmosphere(scene, renderer);
mountPaperOverlay();
const terrainGroup = buildTerrainMesh(sim.terrain, QINGQIU_GRAYBOX);
scene.add(terrainGroup);
// Patch 3c：地表点缀，地形建好之后一次性构建（静态 InstancedMesh，不逐帧更新）。
buildScatter(scene, sim.terrain, seed);
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Movement is suppressed while the player is burrowed (Task 8 ledger note):
// otherwise a direction key already held down at the moment of burrow-exit
// would ride along on the very same read() sim uses to detect the E-press
// edge, and the client would be feeding a same-tick move+interact into a
// state transition meant to be interact-only.
function isPlayerBurrowed(): boolean {
  const player = sim.state.creatures.find((c) => c.id === sim.state.playerId);
  return player !== undefined && player.burrowId !== null;
}
const input = createInput(renderer.domElement, isPlayerBurrowed);
const followCam = createFollowCamera(camera);
const hud = createHud();
const particles = createParticles(scene, sim.terrain);
const screenFx = createScreenFx(camera);
const eventDiffer = createSimEventDiffer();
// **CRITICAL（见 simEvents.ts 头部 JSDoc 的快照契约）**：sim.state 是同一个对象、
// 每次 step() 原地 mutate；prevSnapshot 必须是每步之前对 differ 实际读取字段的
// 独立深拷贝，否则 prev/curr 会变成同一份引用，事件流会静默永远清零。这里严格
// 照抄 JSDoc 里给的写法：只拷贝 differ 用到的字段（不 clone 整份含 terrain 的
// GameState，省一点没必要的深拷贝体积）。
let prevSnapshot: GameState | null = null;

/**
 * Mirrors needs.ts's private drinking check (Task 7): "in water" or an
 * 8-direction interactRange ring sample. Not exported by @shiling/sim (it's
 * an eating.ts/needs.ts implementation detail), so the HUD's read-only
 * proximity probe duplicates the same geometry here rather than reaching
 * into sim internals.
 */
function nearWater(pos: Creature["pos"], terrain: Terrain): boolean {
  if (terrain.isWater(pos.x, pos.z)) return true;
  const r = TUNING.interactRange;
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const sx = pos.x + Math.sin(angle) * r;
    const sz = pos.z + Math.cos(angle) * r;
    if (terrain.isWater(sx, sz)) return true;
  }
  return false;
}

/**
 * Per-render-frame proximity/target probe for the HUD's context prompt.
 * Read-only: never mutates sim state, only re-derives the same distance
 * checks tickDigging/tickEating/tickNeeds use internally so the prompt
 * tracks what interact would actually do this tick.
 *
 * Known graybox simplification (Task 16 brief only specifies these 5 prompt
 * strings, with no distinct "enter an already-dug burrow" copy): nearDigSpot
 * is true for *any* spot in range regardless of `spot.dug`, so "E 挖掘"
 * still shows right after exiting a burrow (exitBurrow leaves the player
 * standing on the now-dug spot) even though pressing E there re-enters
 * instantly instead of running a fresh dig-progress accumulation. Flag for
 * Task 17 playtest if this reads as misleading in practice.
 */
function computeHudContext(terrain: Terrain, state: GameState, player: Creature): HudContext {
  const nearDigSpot = terrain.digSpots.some((spot) => dist2d(player.pos, spot.pos) <= TUNING.interactRange);
  const nearCarcass = state.carcasses.some((c) => dist2d(player.pos, c.pos) <= TUNING.interactRange);
  const attackRange = SPECIES.youshou!.attackRange;
  const nearPrey = state.creatures.some(
    (c) => c.id !== player.id && c.activity !== "dead" && c.burrowId === null && dist2d(player.pos, c.pos) <= attackRange,
  );
  return { nearWater: nearWater(player.pos, terrain), nearCarcass, nearDigSpot, nearPrey };
}

const views: CreatureViews = new Map();
let acc = 0;
let last = performance.now();
// 最近一次 sim.step() 用的 input——渲染帧尾部要判断"冲刺且实际在动"时，读的是
// 已经参与过 sim 权威判定的这一份，而不是重新调一次 input.read()（后者不仅要
// 再算一遍三角函数，语义上也该是"驱动了当前这一步"的那份输入，不是"读取时刻"
// 恰好碰到的键盘状态——两者在慢帧/一帧多步时可能不是同一份）。掉帧导致本帧
// while 循环一次都没跑时，沿用上一帧的值（冲刺/移动状态没有理由在没有新 sim
// 步进的情况下突变）。
let lastInput: PlayerInput | null = null;

// Task 9：世界在 createSim() 里已经把所有生物 spawn 好了（见 sim.ts 的
// spawnCreature），这里先同步一次视图，让标题画面背后的"活的青丘"在用户点击
// 「入山」之前就已经能看到生物模型——它们的 idle 呼吸/摆尾动画只吃下面
// applyInterp 传的 tSec（wall-clock），不依赖 sim 是否已经 step 过，所以不必
// 等第一次 sim.step() 才出现在场景里。
syncCreatures(scene, sim.state, views);

// Task 9 gate：`started` 锁在 false 时，渲染循环照常跑（地形/生物/粒子/水面
// 全部继续用 tSec 播视觉动画，backdrop 是"活的"），但下面的 `if (started)`
// 块不会喂 sim.step、也不会更新 HUD——世界的模拟状态冻结在 tick 0。
// showTitle() 的 onEnter 回调把 started 置真，从那一帧起 sim 正常步进；
// acc（fixed-step 累加器）也刻意留在 if 内部才开始累加，避免标题画面挂着的
// 这段时间被计入 frameDt 后，点击瞬间攒出一大坨 acc 触发追赶式连续 step。
let started = false;
showTitle(() => {
  started = true;
});

// Post-fix-1 verification hook (Bug 1, A/D 左右相反): dev-only, tree-shaken
// out of production builds (`import.meta.env.DEV` is a Vite compile-time
// constant, so `pnpm build` drops this whole block — see vite build output).
// Exposes just enough read-only state for an external Playwright script to
// assert the real running app's player-position delta matches the fixed
// camera-relative strafe basis, without permanently wiring any test-only
// globals into the production bundle.
if (import.meta.env.DEV) {
  (window as unknown as { __shiling: unknown }).__shiling = {
    getPlayerPos: () => {
      const p = getPlayer(sim.state).pos;
      return { x: p.x, y: p.y, z: p.z };
    },
    getCamYaw: () => followCam.yaw,
    enter: () => {
      started = true;
    },
    // Verification-only teleport (never used by gameplay code): warps the
    // player to a given XZ so a Playwright script can reliably frame close-up
    // screenshots (e.g. near world origin, where particles.ts's firefly
    // spread is centered) instead of waiting on a random spawn/walk.
    warpTo: (x: number, z: number) => {
      const p = getPlayer(sim.state).pos;
      p.x = x;
      p.z = z;
      p.y = sim.terrain.heightAt(x, z);
    },
  };
}

renderer.setAnimationLoop(() => {
  const now = performance.now();
  const frameDt = Math.min(0.25, (now - last) / 1000);
  last = now;
  // 单帧最多补 0.25s 模拟时间：切后台/掉帧恢复时不会因为一次性追赶太多步而卡死。
  // Task 9 gate：`started` 为 false 时完全跳过这个 if 块（不喂 sim.step，acc
  // 也不累加）——世界冻结在 tick 0；下面 applyInterp 等视觉更新仍无条件执行，
  // 让 backdrop 继续"活"（生物 idle 动画、水面、粒子都只吃 tSec/frameDt，
  // 不依赖这里是否 step 过）。
  if (started) {
    acc += frameDt;
  }
  while (started && acc >= DT) {
    snapshotPrev(views);
    lastInput = input.read(followCam.yaw);
    sim.step(lastInput);
    // 每个定步之后立刻同步一次视图：prevPos/currPos 对应"这一步之前→之后"，
    // 而不是攒够多步才同步一次导致的粗插值；同时完成 view 的增删（生/死/尸体腐烂）。
    syncCreatures(scene, sim.state, views);
    // 事件 diff 必须紧跟在这一步 sim.step() 之后、prevSnapshot 更新之前调用——
    // prevSnapshot 此时还是"上一步之后"的快照，curr 是"这一步之后"的最新状态，
    // 正是 differ 要比较的那一对（见 simEvents.ts JSDoc 里的调用顺序范式）。
    const events = eventDiffer(prevSnapshot, sim.state, DT);
    if (events.length > 0) {
      particles.handle(events, { waterLevel: sim.terrain.waterLevel });
      // 同一份 events[] 喂给屏幕特效（Task 7）：只关心玩家自己的 hit/death，
      // 与 particles.handle 平级消费、互不干扰（各自只读，不改 events）。
      screenFx.handle(events, sim.state.playerId);
    }
    prevSnapshot = structuredClone({
      creatures: sim.state.creatures,
      carcasses: sim.state.carcasses,
      playerDead: sim.state.playerDead,
      playerId: sim.state.playerId,
      tick: sim.state.tick,
      nextId: sim.state.nextId,
    }) as GameState;
    acc -= DT;
  }
  // Wall-clock seconds — the sole phase source model.animate's sin/spring
  // formulas key off of (Task 4). The water-surface animation below (Task 5)
  // reuses this same tSec, hence hoisting it out here instead of computing
  // it inline in either call.
  const tSec = now / 1000;
  applyInterp(views, acc / DT, tSec);
  updateDigSpots(terrainGroup, sim.terrain);
  updateWater(tSec);
  particles.update(frameDt, tSec);
  // 冲刺 FOV 的判据是"冲刺键按住 AND 玩家确实在移动"（brief 原话），不是单看
  // sprint 键——按住 Shift 站着不动/贴墙顶住不该拉 FOV。player.activity==="moving"
  // 是 movement.ts 权威写入的结果（见该文件 moveCreature），比在渲染层重新判断
  // "moveX/moveZ 是否非零"更准（后者拿不到"贴墙被挡住"之类的宽高衰减细节）。
  const player = getPlayer(sim.state);
  const sprinting = (lastInput?.sprint ?? false) && player.activity === "moving";
  screenFx.update(frameDt, sprinting);
  // Follow the render-interpolated mesh position (not the raw once-per-step
  // sim position) so the camera reads smooth even when a slow frame makes
  // the while-loop above run several fixed steps back-to-back. Keyed by
  // `creature:${id}` per CreatureViews' convention (see creatureView.ts).
  const playerView = views.get(`creature:${sim.state.playerId}`);
  if (playerView) followCam.update(playerView.mesh.position, input.camDelta());
  // 震屏偏移必须在 followCam.update() 之后叠加——followCam 每帧都会把
  // camera.position 摆回"目标 + 轨道半径"算出的位置，若震屏偏移加在它之前会被
  // 直接覆盖掉（见 camera.ts update() 里的注释）。
  const shake = screenFx.getShakeOffset();
  camera.position.x += shake.x;
  camera.position.y += shake.y;
  // input.consume() 必须无条件每帧调用，不能塞进下面的 `if (started)`——
  // followCam.update() 在它上面已经无条件读过 input.camDelta() 一次（Task 9
  // 之前就是这个顺序，未改动），如果只在 started 时才 consume，标题画面淡出
  // 期间（title.ts 的 `.title-fade-out` 会把 pointer-events 提前设成
  // none——即 600ms 淡出动画播放中、onEnter/started 还没真正置真的这段窗口，
  // canvas 已经能重新接收拖拽）攒下的 dx/dy 永远清不掉，会被 followCam
  // 每一帧重复叠加成越转越远的镜头（code review 抓到的真实 bug）。
  // Task 9 gate：只有 HUD 更新需要按 started 冻结——标题画面还在时 HUD 应
  // 保持 createHud() 刚建好时的初始空状态，藏在标题遮罩底下，直到玩家点
  // 「入山」。
  input.consume();
  if (started) {
    hud.update(sim.state, computeHudContext(sim.terrain, sim.state, player));
  }
  renderer.render(scene, camera);
});
