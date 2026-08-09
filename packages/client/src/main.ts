import * as THREE from "three";
import { createSim, DT, dist2d, getPlayer, type Creature, type GameState, type PlayerInput, type Terrain } from "@shiling/sim";
import { QINGQIU_GRAYBOX, SPECIES, TUNING } from "@shiling/content";
import { buildTerrainMesh, updateDigSpots, updateHomeNest, updateWater } from "./render/terrainMesh.js";
import { applyInterp, snapshotPrev, syncCreatures, type CreatureViews } from "./render/creatureView.js";
import { setModelLibrary } from "./render/creatureModels.js";
import { loadModelLibrary } from "./render/modelLibrary.js";
import { setupAtmosphere, mountPaperOverlay } from "./render/atmosphere.js";
import { createSimEventDiffer } from "./render/simEvents.js";
import { createParticles } from "./render/particles.js";
import { createScreenFx } from "./render/screenFx.js";
import { createKillMarker } from "./render/killMarker.js";
import { buildScatter } from "./render/scatter.js";
import { createAudio } from "./audio.js";
import { createInput } from "./input.js";
import { createFollowCamera } from "./camera.js";
import { createHud, type HudContext } from "./hud.js";
import { createMinimap } from "./minimap.js";
import { showTitle } from "./title.js";
import { createPauseOverlay } from "./pause.js";

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
// far 500→700（W2，世界 size 240→480 后对角线 ~679m，700 留出安全余量——见 atmosphere.ts
// 顶部 SKY_RADIUS 注释，天空穹顶半径 400 仍然稳稳包住相机可能到达的最远位置）。
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 700);
camera.position.set(0, 60, 80);
camera.lookAt(0, 0, 0);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
// Postfix 7（Meshy GLB 生物模型）：越早发起加载越好——三个 GLB 合计 ~1.8MB，
// 与下面地形/点缀/图集的构建完全无关，kick off 后不 await，title 画面的
// 「入山」按钮门闩在 showTitle() 调用处（下方）单独处理。setModelLibrary 落定
// 后，buildCreatureModel/buildCarcassModel（creatureModels.ts）才会开始用 GLB
// 而不是程序化 graybox——任何单个物种加载失败都只让那个物种保留程序化模型
// （console.warn，见 modelLibrary.ts 的 per-species try/catch），不影响其余两个。
const modelLibraryPromise = loadModelLibrary().then((library) => {
  setModelLibrary(library);
  return library;
});
setupAtmosphere(scene, renderer);
mountPaperOverlay();
const terrainGroup = buildTerrainMesh(sim.terrain, QINGQIU_GRAYBOX);
scene.add(terrainGroup);
// Patch 3c：地表点缀，地形建好之后一次性构建（静态 InstancedMesh，不逐帧更新）。
// W2：额外传入 QINGQIU_GRAYBOX（WorldParams）——scatter.ts 需要 hillAmp 算山地 rocky
// 高度阈值，Terrain 接口本身不暴露它。
buildScatter(scene, sim.terrain, seed, QINGQIU_GRAYBOX);
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
// W2（playtest feedback「要右上角全局小地图」）：右上角实时小地图，静态底图只渲染一次，
// 每帧只按 tick 是否推进决定要不要重绘覆盖层（见 minimap.ts 的 dirty-check）。
// worldSize 直接读 sim.terrain.size（而不是另外传 QINGQIU_GRAYBOX.size）——两者理论上
// 恒等（createSim 默认就用 QINGQIU_GRAYBOX），但从 terrain 实例自己读，不依赖"默认参数
// 与这里手动传入的常量保持同步"这条隐含假设（code review 建议）。
const minimap = createMinimap(sim.terrain, sim.terrain.size);
const particles = createParticles(scene, sim.terrain);
const screenFx = createScreenFx(camera);
const killMarker = createKillMarker(camera);
// M1 postfix N3（程序化音效）：与 particles/screenFx/killMarker 同层的第四个事件消费者，
// eager 创建（不等 started）——createAudio() 本身对"AudioContext 还没创建"保持安全
// no-op（见 audio.ts 头部注释），真正的 AudioContext 创建/resume 延迟到下方
// showTitle() 的 onEnter 回调（唯一的真实用户手势）才发生。
const audio = createAudio();
const eventDiffer = createSimEventDiffer();

// ---- 顿帧 hitstop（Part 1，postfix-9 捕食特效强化）----
// 玩家造成的致命一击冻结 90ms（受击方 lethal:true 且 id !== playerId——见下方渲染
// 循环里对应的判据/注释），非致命 40ms。这里刻意只是"客户端渲染循环这一帧要不要
// 继续喂 sim.step()"的一个纯展示层 gate，不是往 sim/PlayerInput 里塞任何新字段——
// sim 的纯粹性因此完整保留：GameState 完全不知道"顿帧"这回事，DT/tick 计数器的
// 语义没有任何变化，只是 client 这一侧的墙钟时间在这段窗口内选择性地不去推进它
// （"client-side time dilation only"）。效果类似很多动作游戏的击中定格：真实时间
// 仍在流逝（screenFx/particles 仍然照常吃 frameDt 播放这段时间内已经触发的爆发/
// 震屏），只是模拟世界本身的因果链条在这段窗口内暂停前进。
const LETHAL_HITSTOP_MS = 90;
const NONLETHAL_HITSTOP_MS = 40;
let hitstopEndTime = 0; // performance.now() 时间戳；0 或已过期 = 当前未处于顿帧中
/**
 * "玩家造成"检测（code review 2026-08-09 抓到的真实 bug，务必读完再改动判据）：
 * `id !== playerId` 单独作为"玩家造成"的近似口径不够——hit 事件本身不带攻击者字段，
 * 而能命中"非玩家"生物的不只是玩家攻击，潭狩猎杀苓鼠（ai.ts resolveHunt）和任意生物
 * 的饥饿归零掉血致死（needs.ts tickCreatureNeeds，对全体生物一视同仁，不止潭狩）都会
 * 产出同样形状的 `{kind:"hit", lethal, id, pos}`——这两条路径都是背景常规玩法，不是
 * 稀有边缘情形（世界里有 26 只苓鼠+4 只潭狩，生态测试的不变量就是"苓鼠没绝种"而不是
 * "没有生物死亡"）。如果只用 id!==playerId，一次玩家完全不在场、也看不到的野外死亡
 * 就会把顿帧——这是**全局冻结 sim 步进/玩家操作**，不是纯展示层特效——随机扣到玩家
 * 头上，读起来像卡顿/掉帧 bug，而不是"我打出了一记漂亮的一击"。
 *
 * 修复：额外要求命中位置落在玩家攻击距离内（SPECIES.youshou.attackRange，与
 * eating.ts 的 findAttackTarget 判定用同一个常量）——这个检查是无损的：玩家自己造成
 * 的命中，其 `e.pos`（受害者当帧位置）按 eating.ts 自身的攻击判定，必然已经满足
 * `dist2d(玩家pos, 受害者pos) <= attackRange`，所以真实玩家击杀 100% 通过这道检查、
 * 不会有假阴性；而潭狩/饥饿死亡发生在地图任意角落，玩家恰好站在 2.3m 内的概率可忽略
 * ——这道检查把"玩家造成"从"id 不是我自己"收紧成"离我这么近，基本只能是我干的"。
 */
const PLAYER_HIT_PROXIMITY = SPECIES.youshou!.attackRange;
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
 * tracks what E (interact) or the left mouse button (attack) would actually
 * do this tick — nearPrey specifically mirrors eating.ts's attack-target scan
 * (findAttackTarget), which is now gated on input.attack, not input.interact
 * (W2 key split); the other three flags still correspond to interact.
 *
 * Known graybox simplification (Task 16 brief only specifies these 5 prompt
 * strings, with no distinct "enter an already-dug burrow" copy): nearDigSpot
 * is true for *any* spot in range regardless of `spot.dug`, so "E 挖掘"
 * still shows right after exiting a burrow (exitBurrow leaves the player
 * standing on the now-dug spot) even though pressing E there re-enters
 * instantly instead of running a fresh dig-progress accumulation. Flag for
 * Task 17 playtest if this reads as misleading in practice.
 *
 * M1 postfix N1（叼运/筑巢/储粮）additions: carrying/nearNest/stash/inOwnBurrow
 * mirror the same "read-only re-derivation of what sim would do this tick"
 * discipline as the five flags above — nearNest specifically re-scans
 * terrain.digSpots for state.homeNest?.spotId (sim itself only stores the id,
 * not a cached position) rather than reaching into digging.ts/eating.ts
 * internals.
 */
function computeHudContext(terrain: Terrain, state: GameState, player: Creature): HudContext {
  const nearDigSpot = terrain.digSpots.some((spot) => dist2d(player.pos, spot.pos) <= TUNING.interactRange);
  const nearCarcass = state.carcasses.some((c) => dist2d(player.pos, c.pos) <= TUNING.interactRange);
  const attackRange = SPECIES.youshou!.attackRange;
  const nearPrey = state.creatures.some(
    (c) => c.id !== player.id && c.activity !== "dead" && c.burrowId === null && dist2d(player.pos, c.pos) <= attackRange,
  );
  const homeNestSpot = state.homeNest ? terrain.digSpots.find((s) => s.id === state.homeNest!.spotId) : undefined;
  const nearNest = homeNestSpot !== undefined && dist2d(player.pos, homeNestSpot.pos) <= TUNING.interactRange;
  const inOwnBurrow = player.burrowId !== null && state.homeNest?.spotId === player.burrowId;
  // postfix-9 Part 2：筑巢进度百分比——只有 nestProgress>0（正在累积，见 digging.ts
  // 的筑巢分支）才非零；换算用到的 TUNING.nestBuildSec 留在 main.ts 算好再传给
  // hud.ts（该模块刻意不 import TUNING，见 hud.ts 头部注释）。
  const nestBuildPct = player.nestProgress > 0 ? Math.min(100, (player.nestProgress / TUNING.nestBuildSec) * 100) : 0;
  return {
    nearWater: nearWater(player.pos, terrain),
    nearCarcass,
    nearDigSpot,
    nearPrey,
    carrying: player.carryingCarcassId !== null,
    nearNest,
    stash: state.homeNest?.stash ?? 0,
    inOwnBurrow,
    nestBuildPct,
  };
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
//
// Postfix 7：这次首同步特意挪到 modelLibraryPromise resolve 之后（而不是像
// Task 9 原先那样立即同步）——syncCreatures 只在"视图不存在"时才 build 新
// 模型，一旦某个 creature 的 view 已经用程序化 graybox 建好，后续 GLB 加载完成
// 也不会重建替换（没有热替换机制）。既然「入山」按钮本来就要等 GLB 加载完才能点
// （title.ts 的 modelsReady 门闩），backdrop 生物索性也晚一点点出现，用户看到的
// 第一帧就已经是最终 GLB 模型，不会有"先程序化、点开后永远程序化"的视觉不一致。
modelLibraryPromise.then(() => {
  syncCreatures(scene, sim.state, views);
});

// Task 9 gate：`started` 锁在 false 时，渲染循环照常跑（地形/生物/粒子/水面
// 全部继续用 tSec 播视觉动画，backdrop 是"活的"），但下面的 `if (started)`
// 块不会喂 sim.step、也不会更新 HUD——世界的模拟状态冻结在 tick 0。
// showTitle() 的 onEnter 回调把 started 置真，从那一帧起 sim 正常步进；
// acc（fixed-step 累加器）也刻意留在 if 内部才开始累加，避免标题画面挂着的
// 这段时间被计入 frameDt 后，点击瞬间攒出一大坨 acc 触发追赶式连续 step。
let started = false;
showTitle(modelLibraryPromise, () => {
  started = true;
  // 音频解锁必须挂在这里（唯一的真实用户手势路径）——见 audio.ts 头部注释关于
  // Safari 手势判定比 Chrome/Firefox 更严格的说明（title.ts 的 onEnter 是点击后
  // 600ms 淡出 setTimeout 才触发的，unlock() 内部已经为此加了兜底重试）。
  audio.unlock();
});

// Post-fix-6（owner feedback「trackpad 用户没有舒适的鼠标按键／不知道有冲刺」）：Esc
// 暂停/继续，与上面的 `started` 门闩同一套模式——`paused` 冻结 acc 累加/sim.step/
// hud.update/followCam.update()/震屏与冲刺 FOV（screenFx.update()）/方向键转镜头
// （见下方渲染循环里几处新增的 `&& !paused`／`if (!paused)`），但 applyInterp/
// updateWater/particles.update 这些纯吃 tSec/frameDt 的 backdrop 动画无条件继续
// 执行——世界的模拟状态与镜头都冻在暂停那一刻，backdrop 继续"活"，跟 Task 9 的
// `started` gate 时期标题画面背后的处理完全同一个套路。
// followCam.update()/震屏偏移那两处整段跳过而不是"传 0 delta"——原因见下方那处调用点
// 旁边的注释（避免 shake 在暂停期间因为 base 位置没有被 followCam 重新计算而悄悄叠加）；
// screenFx.update() 同理单独 gate（见其调用点旁边的注释：不冻结的话震屏衰减/冲刺 FOV
// 弹簧会拿真实 frameDt 继续推进，画面并没有真的"冻住"）。
let paused = false;
const pauseOverlay = createPauseOverlay();
window.addEventListener("keydown", (e) => {
  if (e.code !== "Escape") return;
  if (e.repeat) return; // 边沿检测：长按 Esc 不应该每帧来回切换
  // 守卫（brief 原话）：标题画面（started 还是 false）和死亡画面（playerDead）都不响应
  // Esc——玩家还没入山/已经身死时，暂停这个概念本身就不成立，不该凭空冒出暂停面板。
  if (!started || sim.state.playerDead) return;
  paused = !paused;
  pauseOverlay.setVisible(paused);
});

// M1 postfix N3：M 键切换静音。与 Esc 同一套"独立 edge-detect 监听器"模式，刻意不走
// input.ts 的 GAME_KEYS/KeyState——那套机制是给 PlayerInput 里持续按住语义的字段用的
// （W/A/S/D/Shift/E/J/C/方向键），静音是一次按下切换一次的离散开关，语义上与 Esc 暂停
// 完全同构，所以复用同一处理方式而不是塞进 input.ts（也不需要 preventDefault：M 键
// 没有任何浏览器默认行为）。不依赖 `started`——标题画面期间也允许切换（音频尚未解锁
// 时 toggleMute() 仍会更新状态并持久化，只是没有实际声音可静）。
window.addEventListener("keydown", (e) => {
  if (e.code !== "KeyM") return;
  if (e.repeat) return;
  audio.toggleMute();
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
    // M0.5 postfix-3 verification hooks: getPlayerYaw feeds the camera
    // auto-recenter check (compare followCam.yaw against the player's actual
    // facing); getCreatures gives an external Playwright script enough to
    // find a grazing vs. wandering lingshu and drive the hunting loop
    // end-to-end without reaching into sim internals from outside.
    getPlayerYaw: () => getPlayer(sim.state).yaw,
    getCreatures: () =>
      sim.state.creatures.map((c) => ({
        id: c.id,
        species: c.species,
        x: c.pos.x,
        z: c.pos.z,
        hp: c.hp,
        aiState: c.aiState,
        activity: c.activity,
      })),
    // Postfix 7 verification hook: killCreature moves a dead non-player
    // creature out of state.creatures and into state.carcasses (see
    // creatureView.ts's carcassKey doc comment) — an external Playwright
    // script needs this to find exactly where a kill's carcass landed so it
    // can frame a screenshot on it, instead of guessing an offset from the
    // prey's last position before it died.
    getCarcasses: () => sim.state.carcasses.map((c) => ({ id: c.id, species: c.species, x: c.pos.x, z: c.pos.z })),
    // W2 verification hooks: read-only probes so an external Playwright script
    // can locate specific biome bands (water/swamp/meadow/rocky) and confirm
    // the E-drinking/left-click-attack key split without reaching into sim
    // internals or hardcoding coordinates against a non-deterministic
    // (Date.now()-seeded) dev-server world.
    isWater: (x: number, z: number) => sim.terrain.isWater(x, z),
    heightAt: (x: number, z: number) => sim.terrain.heightAt(x, z),
    getThirst: () => getPlayer(sim.state).needs.thirst,
    getWorldSize: () => sim.terrain.size,
    getLastInput: () => lastInput,
    // Post-fix-6 verification hooks: getTick lets an external Playwright
    // script assert sim.state.tick is frozen across the pause window (no acc
    // accumulation/sim.step while `paused`) and resumes advancing once
    // unpaused; getPlayerId lets it pick a non-player creature out of
    // getCreatures() to J-attack (the player's own species, "youshou", is not
    // otherwise distinguishable from getCreatures() alone).
    getTick: () => sim.state.tick,
    getPlayerId: () => sim.state.playerId,
    // Post-fix-6 verification hook: lets an external Playwright script assert
    // camera.fov itself is frozen during pause (screenFx.update()'s sprint-FOV
    // spring is gated by `!paused` — see that call site's comment; before that
    // fix this value kept drifting toward the sprint target every paused frame).
    getCameraFov: () => camera.fov,
    // M1 postfix N1（叼运/筑巢/储粮）verification hooks: expose just enough
    // read-only state for an external Playwright script to drive the whole
    // pickup→carry→drop/deposit/nest-build/stash-eat loop without reaching
    // into sim internals or re-deriving distance math the sim already owns.
    getPlayerCarrying: () => getPlayer(sim.state).carryingCarcassId,
    getPlayerBurrowId: () => getPlayer(sim.state).burrowId,
    getPlayerHunger: () => getPlayer(sim.state).needs.hunger,
    getHomeNest: () => sim.state.homeNest,
    getDigSpots: () => sim.terrain.digSpots.map((s) => ({ id: s.id, x: s.pos.x, z: s.pos.z, dug: s.dug })),
    // M1 postfix N3（程序化音效）验证钩子：音频是否真的在播只能靠人耳判断，但下面三个
    // 探针能结构性地确认——AudioContext 是否已经在「入山」点击后创建（getAudioContextState）、
    // M 键静音是否真的翻转了状态（getAudioMuted）、暂停/静音是否真的把 masterGain 数值
    // duck 下去了（getAudioMasterGain，读的是 AudioParam 的实时 `.value`，需要在切换后
    // 等 GAIN_RAMP_TIME_CONSTANT 那点平滑过渡时间再探测才会稳定）。
    getAudioContextState: () => audio.getContextState(),
    getAudioMuted: () => audio.isMuted(),
    getAudioMasterGain: () => audio.getMasterGainValue(),
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
  // 不依赖这里是否 step 过）。Post-fix-6：`paused` 复用同一个 gate（`&& !paused`），
  // 暂停时同样不累加 acc/不喂 sim.step；`last = now` 那两行留在这个 if 之外保持
  // 无条件执行（上面已经是这样，未改动）——恢复时 frameDt 只是"这一帧到上一帧"的
  // 正常间隔，不会因为暂停期间攒下的墙钟时间被塞进 acc 而在恢复瞬间触发一次追赶式
  // 连续 step（与 title gate 当年解决的是同一个坑，见本文件顶部对应注释）。
  // 顿帧（Part 1，postfix-9）：与 `paused` 同一套 gate 写法（见下方 while 条件），
  // 但由命中事件触发、时限极短（40/90ms）——`hitstopped` 只在本帧顶部算一次，
  // 用的是这一帧的 `now`，与 `paused` 一样冻结 acc 累加/sim.step，不是只跳过
  // "drain" 这一步本身：如果只让 while 循环空转而 acc 照样累加，解冻瞬间会因为
  // 攒下的墙钟时间一次性触发多步追赶式 step，读起来像"倒放快进"而不是干净的一次
  // 定格——与 title/pause 两个既有 gate 要避免的坑是同一个（见本文件顶部对应注释）。
  const hitstopped = now < hitstopEndTime;
  if (started && !paused && !hitstopped) {
    acc += frameDt;
  }
  while (started && !paused && !hitstopped && acc >= DT) {
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
      // "玩家造成"判定集中在这一处算好，往下游三个消费者传同一份结果——见
      // PLAYER_HIT_PROXIMITY 头部注释：id!==playerId 单独用不够，还要求命中位置在
      // 玩家攻击距离内。同一个循环顺带驱动顿帧（含非致命，40ms 档同样要收紧判据，
      // 潭狩打苓鼠的每一次非致命命中此前也会误触发）。
      const playerPos = getPlayer(sim.state).pos;
      const nearPlayerKillIds = new Set<number>(); // 本 tick 里"玩家造成的致命一击"受害者 id 集合
      for (const e of events) {
        if (e.kind !== "hit" || e.id === sim.state.playerId) continue;
        if (dist2d(playerPos, e.pos) > PLAYER_HIT_PROXIMITY) continue; // 不在玩家攻击距离内——大概率是潭狩/饥饿致死，不是玩家
        const freezeMs = e.lethal ? LETHAL_HITSTOP_MS : NONLETHAL_HITSTOP_MS;
        hitstopEndTime = Math.max(hitstopEndTime, now + freezeMs);
        if (e.lethal) nearPlayerKillIds.add(e.id);
      }
      particles.handle(events, { waterLevel: sim.terrain.waterLevel }, nearPlayerKillIds);
      // 同一份 events[] 喂给屏幕特效（Task 7）：只关心玩家自己的 hit/death 与
      // 自己造成的击杀震屏（Part 1），与 particles.handle 平级消费、互不干扰
      // （各自只读，不改 events）。
      screenFx.handle(events, sim.state.playerId, nearPlayerKillIds);
      // 击杀浮字「＋肉」（Part 1）：同一套消费模式，第三个平级消费者。
      killMarker.handle(events, nearPlayerKillIds);
      // 音效（postfix N3）：第四个平级消费者，同一份 events[]，只读不改。不复用
      // nearPlayerKillIds（那个 Set 只含"致命"一击）——audio.ts 内部自己按命中位置
      // 与玩家攻击距离的关系重新判定"是否玩家造成"（见 audio.ts 头部注释），因为它
      // 需要覆盖"玩家造成但非致命"这个更宽的集合，且不想往这段已经过 code review
      // 收紧的顿帧逻辑里再加一个新 Set。
      audio.handle(events, sim.state, sim.state.playerId);
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
    // 顿帧一旦在本帧触发，本帧不再继续追加步进——即便 acc 还有余量，也要立刻让画面
    // 定格在这一击的瞬间，不等到下一帧才生效（`hitstopped` 只在本帧顶部算过一次，
    // 循环条件本身不会因为 hitstopEndTime 刚被改写而重新求值）。
    if (now < hitstopEndTime) break;
  }
  // Wall-clock seconds — the sole phase source model.animate's sin/spring
  // formulas key off of (Task 4). The water-surface animation below (Task 5)
  // reuses this same tSec, hence hoisting it out here instead of computing
  // it inline in either call.
  const tSec = now / 1000;
  applyInterp(views, acc / DT, tSec);
  updateDigSpots(terrainGroup, sim.terrain);
  updateHomeNest(terrainGroup, sim.terrain, sim.state.homeNest);
  updateWater(tSec);
  // 顿帧期间 particles.update()/killMarker.update() 依然无条件执行（brief 明确要求
  // "do NOT gate screenFx/particles update — the burst must play through the
  // freeze"）：爆发特效/浮字要在冻结的这几十毫秒里继续播完，不能被顿帧一起冻住，
  // 否则玩家会先看到"世界定格"而爆发效果却也跟着卡住不动，读起来像卡顿而不是顿帧。
  particles.update(frameDt, tSec);
  killMarker.update(frameDt);
  // 冲刺 FOV 的判据是"冲刺键按住 AND 玩家确实在移动"（brief 原话），不是单看
  // sprint 键——按住 Shift 站着不动/贴墙顶住不该拉 FOV。player.activity==="moving"
  // 是 movement.ts 权威写入的结果（见该文件 moveCreature），比在渲染层重新判断
  // "moveX/moveZ 是否非零"更准（后者拿不到"贴墙被挡住"之类的宽高衰减细节）。
  const player = getPlayer(sim.state);
  // 音效持续层（postfix N3）：与 particles/killMarker 一样每渲染帧无条件调用一次——
  // audio.ts 内部自己按 ctx.started/paused 决定要不要真正推进心跳/风声/虫鸣/游泳环境
  // 音（见该文件 update() 的门控注释），main.ts 这里不需要重复 `if (started)` 包一层。
  // drinking 是 activity 轴而非 locomotion 轴（两者独立，见 @shiling/sim 的 Activity/
  // Locomotion 类型），audio.ts 的 update() ctx 需要它来驱动"饮水 tick 循环"，故在这里
  // 单独派生。maxHp 直接读 SPECIES.youshou（玩家物种恒定），与 main.ts 别处
  // `SPECIES.youshou!.attackRange` 同一惯例。
  audio.update(frameDt, {
    playerHunger: player.needs.hunger,
    playerThirst: player.needs.thirst,
    playerHp: player.hp,
    maxHp: SPECIES.youshou!.maxHp,
    locomotion: player.locomotion,
    drinking: player.activity === "drinking",
    paused,
    started,
  });
  // Post-fix-6（code review 抓到的真实 bug）：screenFx.update() 必须同样按
  // `!paused` 冻结——它内部用真实 frameDt 推进震屏指数衰减 + 冲刺 FOV 弹簧，并
  // 直接写 camera.fov/调用 updateProjectionMatrix()，如果不冻结，暂停期间画面
  // 会继续"震屏慢慢平息"或者"FOV 慢慢弹回/弹到冲刺目标值"——与"世界视觉上冻在
  // 暂停那一刻"这个 gate 的核心承诺直接矛盾（尤其是"受击瞬间按 Esc"或"冲刺切换
  // 瞬间按 Esc"这两种时机下肉眼可见）。sprinting 的计算本身不需要挪进 if——
  // 单纯算一个布尔值不产生任何副作用，真正有副作用的是 update() 调用本身。
  const sprinting = (lastInput?.sprint ?? false) && player.activity === "moving";
  if (!paused) {
    screenFx.update(frameDt, sprinting);
  }
  // Follow the render-interpolated mesh position (not the raw once-per-step
  // sim position) so the camera reads smooth even when a slow frame makes
  // the while-loop above run several fixed steps back-to-back. Keyed by
  // `creature:${id}` per CreatureViews' convention (see creatureView.ts).
  const playerView = views.get(`creature:${sim.state.playerId}`);
  // Post-fix-6：这一整块（方向键合成拖拽量 + followCam.update() + 震屏叠加）在
  // `paused` 时整段跳过，不是"传 0 delta 但仍调用"——跳过 followCam.update() 意味着
  // camera.position 这一帧完全不被触碰，精确停在暂停前最后一帧算出的位置（"冻结的
  // 镜头看冻结的世界"）。如果只跳过方向键合成量而仍然调用 followCam.update()/叠加
  // shake，camDelta() 仍可能因为鼠标拖拽（input.ts 不知道 paused，pointermove 照样
  // 攒 accumDx/accumDy）而转动镜头；如果反过来只跳过 followCam.update() 但仍叠加
  // shake，会在一个没有被 followCam 重新算过的旧 camera.position 上反复加 shake，
  // 越叠越偏（followCam.update() 本该在每帧先把 position 摆回 idealPos 再让 shake
  // 叠加在"干净"的那个基准上——见下面注释）。两处必须一起跳过。
  if (playerView && !paused) {
    // 方向键转镜头：先把本帧的合成拖拽量叠进 accumDx/accumDy，再走原有的
    // camDelta()/consume() 通路——这样自动回正的 2s 抑制计时器（camera.ts 的
    // idleSinceDragSec）天然把方向键也当成"手动拖拽"处理，不需要在 camera.ts 里
    // 再开一条判定分支（见 input.ts addArrowLook() 头部注释）。
    input.addArrowLook(frameDt);
    // isMoving mirrors the sprint-FOV gate just above (activity==="moving" is
    // movement.ts's authoritative signal); auto-recenter (M0.5 postfix-3)
    // only engages while the player is actually walking/running somewhere,
    // never while standing still deciding where to look.
    followCam.update(playerView.mesh.position, input.camDelta(), frameDt, player.yaw, player.activity === "moving", input.isDragging());
    // 震屏偏移必须在 followCam.update() 之后叠加——followCam 每帧都会把
    // camera.position 摆回"目标 + 轨道半径"算出的位置，若震屏偏移加在它之前会被
    // 直接覆盖掉（见 camera.ts update() 里的注释）。
    const shake = screenFx.getShakeOffset();
    camera.position.x += shake.x;
    camera.position.y += shake.y;
  }
  // input.consume() 必须无条件每帧调用，不能塞进下面的 `if (started)`——
  // followCam.update() 在它上面（标题画面期间——此时 `paused` 恒为 false，见
  // 下方 Esc 监听器的守卫，Post-fix-6 的 gate 在这个场景里完全不生效）已经读过
  // 一次 input.camDelta()（Task 9 之前就是这个顺序，未改动），如果只在 started
  // 时才 consume，标题画面淡出期间（title.ts 的 `.title-fade-out` 会把
  // pointer-events 提前设成 none——即 600ms 淡出动画播放中、onEnter/started
  // 还没真正置真的这段窗口，canvas 已经能重新接收拖拽）攒下的 dx/dy 永远清不掉，
  // 会被 followCam 每一帧重复叠加成越转越远的镜头（code review 抓到的真实
  // bug）。暂停期间（`paused` 为真，此时 followCam.update() 会被跳过）道理不变：
  // 这一帧攒下的 dx/dy 同样必须清掉，否则恢复的第一帧会突然吃到一大坨积压的
  // 拖拽/方向键增量。
  // Task 9 gate：只有 HUD 更新需要按 started 冻结——标题画面还在时 HUD 应
  // 保持 createHud() 刚建好时的初始空状态，藏在标题遮罩底下，直到玩家点
  // 「入山」。Post-fix-6：`paused` 复用同一个 gate——sim.state 在暂停期间本来就
  // 不会变（上面的 while 循环已经跳过），这里额外加 `&& !paused` 严格来说只是
  // 省掉几次必然得到同一结果的 dirty-check 比较，但语义上更直接地对应 brief 的
  // "no hud.update" 要求，而不是依赖"反正数据没变所以更新也没用"这层隐含推论。
  input.consume();
  if (started && !paused) {
    hud.update(sim.state, computeHudContext(sim.terrain, sim.state, player));
    // followCam.yaw（镜头朝向，不是玩家朝向）驱动小地图的视野锥——与 HUD 同样按
    // started 冻结，标题画面期间不在小地图上跑动画。
    minimap.update(sim.state, followCam.yaw);
  }
  renderer.render(scene, camera);
});
