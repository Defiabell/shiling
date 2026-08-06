import * as THREE from "three";
import { createSim } from "@shiling/sim";
import { QINGQIU_GRAYBOX } from "@shiling/content";
import { buildTerrainMesh } from "./render/terrainMesh.js";

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
scene.add(buildTerrainMesh(sim.terrain, QINGQIU_GRAYBOX));
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
renderer.setAnimationLoop(() => renderer.render(scene, camera));
