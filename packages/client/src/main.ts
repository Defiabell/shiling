import * as THREE from "three";
import { createSim, DT } from "@shiling/sim";
import { QINGQIU_GRAYBOX } from "@shiling/content";
import { buildTerrainMesh, updateDigSpots } from "./render/terrainMesh.js";
import { applyInterp, snapshotPrev, syncCreatures, type CreatureViews } from "./render/creatureView.js";
import { createInput } from "./input.js";
import { createFollowCamera } from "./camera.js";

// 种子只在 client 边界产生（Date.now() 非确定性），sim 内部逻辑仍保持确定性。
const sim = createSim(Date.now() >>> 0);
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0e0f12, 80, 220);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 500);
camera.position.set(0, 60, 80);
camera.lookAt(0, 0, 0);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x30281f, 1.0));
const sun = new THREE.DirectionalLight(0xfff2d9, 1.2);
sun.position.set(60, 100, 20);
scene.add(sun);
const terrainGroup = buildTerrainMesh(sim.terrain, QINGQIU_GRAYBOX);
scene.add(terrainGroup);
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

const views: CreatureViews = new Map();
let acc = 0;
let last = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  // 单帧最多补 0.25s 模拟时间：切后台/掉帧恢复时不会因为一次性追赶太多步而卡死。
  acc += Math.min(0.25, (now - last) / 1000);
  last = now;
  while (acc >= DT) {
    snapshotPrev(views);
    sim.step(input.read(followCam.yaw));
    // 每个定步之后立刻同步一次视图：prevPos/currPos 对应"这一步之前→之后"，
    // 而不是攒够多步才同步一次导致的粗插值；同时完成 view 的增删（生/死/尸体腐烂）。
    syncCreatures(scene, sim.state, views);
    acc -= DT;
  }
  applyInterp(views, acc / DT);
  updateDigSpots(terrainGroup, sim.terrain);
  // Follow the render-interpolated mesh position (not the raw once-per-step
  // sim position) so the camera reads smooth even when a slow frame makes
  // the while-loop above run several fixed steps back-to-back. Keyed by
  // `creature:${id}` per CreatureViews' convention (see creatureView.ts).
  const playerView = views.get(`creature:${sim.state.playerId}`);
  if (playerView) followCam.update(playerView.mesh.position, input.camDelta());
  input.consume();
  renderer.render(scene, camera);
});
