import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { Vec3 } from "@shiling/sim";
import { computeArrowLook } from "../src/input.js";
import { createFollowCamera } from "../src/camera.js";

const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * Post-fix-6 regression tests for arrow-key camera look (owner feedback
 * "trackpad 用户没有舒适的鼠标按键"). Mirrors composeMove.test.ts's precedent:
 * computeArrowLook() is a pure function extracted specifically so its
 * rate/sign math can be pinned down independently of input.ts's DOM/canvas
 * wiring — the same reason composeMove() was extracted out of read().
 */
describe("computeArrowLook", () => {
  it("no arrow keys held produces a zero delta", () => {
    expect(computeArrowLook(false, false, false, false, 0.016)).toEqual({ dx: 0, dy: 0 });
  });

  it("ArrowRight alone produces a positive dx (mirrors dragging right) and no dy", () => {
    const { dx, dy } = computeArrowLook(false, true, false, false, 0.016);
    expect(dx).toBeGreaterThan(0);
    expect(dy).toBe(0);
  });

  it("ArrowLeft alone produces a negative dx of the same magnitude as ArrowRight", () => {
    const right = computeArrowLook(false, true, false, false, 0.016);
    const left = computeArrowLook(true, false, false, false, 0.016);
    expect(left.dx).toBeCloseTo(-right.dx, 10);
  });

  it("ArrowUp alone produces a negative dy (mirrors dragging up) and no dx", () => {
    const { dx, dy } = computeArrowLook(false, false, true, false, 0.016);
    expect(dy).toBeLessThan(0);
    expect(dx).toBe(0);
  });

  it("ArrowDown alone produces a positive dy of the same magnitude as ArrowUp", () => {
    const up = computeArrowLook(false, false, true, false, 0.016);
    const down = computeArrowLook(false, false, false, true, 0.016);
    expect(down.dy).toBeCloseTo(-up.dy, 10);
  });

  it("opposite arrow keys held together cancel out to zero", () => {
    expect(computeArrowLook(true, true, true, true, 0.016)).toEqual({ dx: 0, dy: 0 });
  });

  it("scales linearly with frameDt", () => {
    const a = computeArrowLook(false, true, false, false, 0.01);
    const b = computeArrowLook(false, true, false, false, 0.02);
    expect(b.dx).toBeCloseTo(a.dx * 2, 10);
  });

  it("pitch:yaw magnitude ratio matches the documented 1.2:2.2 rad/s rate ratio (ARROW_PITCH_RATE:ARROW_YAW_RATE)", () => {
    const yaw = computeArrowLook(false, true, false, false, 0.1);
    const pitch = computeArrowLook(false, false, false, true, 0.1);
    expect(Math.abs(pitch.dy) / Math.abs(yaw.dx)).toBeCloseTo(1.2 / 2.2, 5);
  });

  it("feeds camera.ts to rotate yaw at the documented ~2.2 rad/s over a simulated second — proves input.ts's and camera.ts's independently-declared DRAG_SENSITIVITY literals stay in sync", () => {
    const cam = createFollowCamera(new THREE.PerspectiveCamera());
    const STEP = 1 / 60;
    let elapsed = 0;
    while (elapsed < 1) {
      const { dx, dy } = computeArrowLook(false, true, false, false, STEP);
      cam.update(ORIGIN, { dx, dy }, STEP, 0, true, false);
      elapsed += STEP;
    }
    expect(cam.yaw).toBeCloseTo(2.2, 1);
  });

  it("feeds camera.ts's manual-input auto-recenter suppression the same way a real drag does", () => {
    // Mirrors camera.test.ts's own suppression tests, but driving the delta
    // through computeArrowLook() instead of a synthetic { dx, dy } literal —
    // confirms arrow-key input is indistinguishable from a mouse drag to
    // camera.ts's `manualDrag = isDragging || dx !== 0 || dy !== 0` gate (see
    // camera.ts), so the existing 2s auto-recenter idle timer applies to it.
    const cam = createFollowCamera(new THREE.PerspectiveCamera());
    const { dx, dy } = computeArrowLook(false, true, false, false, 0.016);
    cam.update(ORIGIN, { dx, dy }, 0.016, 0, true, false);
    const yawAfterArrow = cam.yaw;
    // 1.5s of moving with no further arrow input, no drag — under the 2s gate.
    for (let i = 0; i < 30; i++) {
      cam.update(ORIGIN, { dx: 0, dy: 0 }, 0.05, Math.PI, true, false);
    }
    expect(cam.yaw).toBeCloseTo(yawAfterArrow, 9);
  });
});
