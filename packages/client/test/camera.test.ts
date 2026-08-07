import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { Vec3 } from "@shiling/sim";
import { createFollowCamera } from "../src/camera.js";

const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };
const NO_DRAG = { dx: 0, dy: 0 };

/**
 * M0.5 postfix-3 regression tests for the camera auto-recenter feature
 * (playtest feedback "只能看一个方向"). Drives FollowCamera.update() directly
 * with synthetic deltas/frameDt — no DOM/pointer events needed, mirroring
 * composeMove.test.ts's precedent of unit-testing this package's pure logic
 * against a real THREE.Camera.
 */
describe("createFollowCamera auto-recenter", () => {
  it("manual drag turns yaw immediately (drag sensitivity)", () => {
    const cam = createFollowCamera(new THREE.PerspectiveCamera());
    cam.update(ORIGIN, { dx: 100, dy: 0 }, 0.016, 0, false, false);
    // DRAG_SENSITIVITY = 0.008 (see camera.ts) — 100px * 0.008 = 0.8 rad.
    expect(cam.yaw).toBeCloseTo(0.8, 5);
  });

  it("does not auto-recenter while the player is stationary, no matter how long", () => {
    const cam = createFollowCamera(new THREE.PerspectiveCamera());
    cam.update(ORIGIN, { dx: 100, dy: 0 }, 0.016, 0, false, false); // establish yaw=0.8
    const yawAfterDrag = cam.yaw;
    for (let i = 0; i < 300; i++) {
      cam.update(ORIGIN, NO_DRAG, 0.05, Math.PI, /* isMoving */ false, false); // 15s of idle standing
    }
    expect(cam.yaw).toBeCloseTo(yawAfterDrag, 9); // never nudged toward playerYaw
  });

  it("stays put for AUTO_RECENTER_IDLE_SEC (2s) after a drag, even while moving", () => {
    const cam = createFollowCamera(new THREE.PerspectiveCamera());
    cam.update(ORIGIN, { dx: 100, dy: 0 }, 0.016, 0, true, false); // drag resets the idle timer
    const yawAfterDrag = cam.yaw;
    for (let i = 0; i < 30; i++) {
      cam.update(ORIGIN, NO_DRAG, 0.05, Math.PI, /* isMoving */ true, false); // 1.5s, still under the 2s gate
    }
    expect(cam.yaw).toBeCloseTo(yawAfterDrag, 9); // gated: no easing has happened yet
  });

  it("eases yaw toward playerYaw once idle-after-drag exceeds 2s and the player is moving", () => {
    const cam = createFollowCamera(new THREE.PerspectiveCamera());
    cam.update(ORIGIN, { dx: 100, dy: 0 }, 0.016, 0, true, false); // yaw=0.8
    const yawAfterDrag = cam.yaw;
    for (let i = 0; i < 80; i++) {
      cam.update(ORIGIN, NO_DRAG, 0.05, Math.PI, true, false); // 4s total: past the 2s gate
    }
    // Moved measurably away from the post-drag value, toward the target (PI).
    expect(Math.abs(cam.yaw - yawAfterDrag)).toBeGreaterThan(0.2);
    expect(cam.yaw).toBeGreaterThan(yawAfterDrag);
    expect(cam.yaw).toBeLessThanOrEqual(Math.PI);
  });

  it("eases via the shorter arc across the ±π wrap, not the long way around", () => {
    const cam = createFollowCamera(new THREE.PerspectiveCamera());
    // Drag to yaw ≈ 3.0 (just under +π); target player yaw ≈ -3.0 (just
    // under -π) — the *short* arc crosses the π/-π seam (distance ≈0.28
    // rad), the long way would cross 0 (distance ≈6.0 rad).
    cam.update(ORIGIN, { dx: 3.0 / 0.008, dy: 0 }, 0.016, 0, true, false);
    expect(cam.yaw).toBeCloseTo(3.0, 5);
    const before = cam.yaw;
    cam.update(ORIGIN, NO_DRAG, 2.5, -3.0, true, false); // one big frameDt, past the idle gate in one step
    // Short-arc lerp increases yaw past π (wrapping), it does not decrease
    // toward 0 — confirms the wrap-aware lerpAngle, not a naive subtraction.
    expect(cam.yaw).toBeGreaterThan(before);
  });

  it("an active drag resets the idle timer and takes priority over recenter every frame", () => {
    const cam = createFollowCamera(new THREE.PerspectiveCamera());
    cam.update(ORIGIN, { dx: 100, dy: 0 }, 0.016, 0, true, false); // yaw=0.8
    for (let i = 0; i < 60; i++) {
      cam.update(ORIGIN, NO_DRAG, 0.05, Math.PI, true, false); // 3s: recenter would normally have engaged
    }
    const recenteredYaw = cam.yaw;
    expect(recenteredYaw).toBeGreaterThan(0.8); // sanity: it did move without the interrupting drag below

    // Now repeat from scratch, but interrupt every frame with a zero-delta
    // "still dragging" signal (isDragging=true) — recenter must never engage.
    const cam2 = createFollowCamera(new THREE.PerspectiveCamera());
    cam2.update(ORIGIN, { dx: 100, dy: 0 }, 0.016, 0, true, false);
    const yawAfterDrag2 = cam2.yaw;
    for (let i = 0; i < 60; i++) {
      cam2.update(ORIGIN, NO_DRAG, 0.05, Math.PI, true, /* isDragging */ true);
    }
    expect(cam2.yaw).toBeCloseTo(yawAfterDrag2, 9);
  });
});
