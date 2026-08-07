import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { composeMove } from "../src/input.js";

/**
 * Independently derives the camera's actual screen-right (xAxis) and
 * "into the screen" (−zAxis) world directions for a given yaw by driving a
 * real THREE.PerspectiveCamera through lookAt/matrixWorld — not the trig
 * this file is meant to catch regressions in — so this test can't share a
 * sign mistake with composeMove's own implementation.
 *
 * Mirrors camera.ts's placement: eye = target − forward(camYaw), where
 * forward(yaw) = (sin(yaw), cos(yaw)) is sim's yaw convention. Pitch/orbit
 * height is omitted (radius=1, no vertical offset): cross(up, z) only
 * depends on z's horizontal components, so the resulting xAxis is exactly
 * the same regardless of pitch — height is orthogonal to the question this
 * test is answering (which way is "screen right"). zAxis therefore also
 * stays purely horizontal here, which is required for the −zAxis comparison
 * below (forward/back input never has a Y component either).
 */
function cameraBasis(yaw: number): { xAxis: THREE.Vector3; zAxis: THREE.Vector3 } {
  const camera = new THREE.PerspectiveCamera();
  const target = new THREE.Vector3(0, 0, 0);
  const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  camera.position.copy(target).sub(forward); // eye = target - forward(yaw), same as camera.ts
  camera.up.set(0, 1, 0);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
  const xAxis = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  const zAxis = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2).normalize();
  return { xAxis, zAxis };
}

const YAWS = [0, Math.PI / 4, Math.PI / 2, 2.1, -1.3];

describe("composeMove", () => {
  for (const yaw of YAWS) {
    it(`D (strafe=+1) moves along camera screen-right at yaw=${yaw}`, () => {
      const { xAxis } = cameraBasis(yaw);
      const move = composeMove(0, 1, yaw);
      const moveVec = new THREE.Vector3(move.x, 0, move.z).normalize();
      expect(moveVec.dot(xAxis)).toBeGreaterThan(0.999);
    });

    it(`A (strafe=-1) moves opposite camera screen-right at yaw=${yaw}`, () => {
      const { xAxis } = cameraBasis(yaw);
      const move = composeMove(0, -1, yaw);
      const moveVec = new THREE.Vector3(move.x, 0, move.z).normalize();
      expect(moveVec.dot(xAxis)).toBeLessThan(-0.999);
    });

    it(`W (fwd=+1) moves into the screen (-zAxis) at yaw=${yaw}`, () => {
      const { zAxis } = cameraBasis(yaw);
      const move = composeMove(1, 0, yaw);
      const moveVec = new THREE.Vector3(move.x, 0, move.z).normalize();
      expect(moveVec.dot(zAxis.clone().negate())).toBeGreaterThan(0.999);
    });

    it(`S (fwd=-1) moves out of the screen (+zAxis) at yaw=${yaw}`, () => {
      const { zAxis } = cameraBasis(yaw);
      const move = composeMove(-1, 0, yaw);
      const moveVec = new THREE.Vector3(move.x, 0, move.z).normalize();
      expect(moveVec.dot(zAxis)).toBeGreaterThan(0.999);
    });
  }
});
