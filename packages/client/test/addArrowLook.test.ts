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
 *
 * Sign fix (owner playtest feedback 2026-08-10「方向键转视角左右反了」): the
 * signs below were flipped from the original Post-fix-6 version, which had
 * ArrowRight/ArrowUp produce positive dx/negative dy on the (wrong) theory
 * that arrow-look should "mirror dragging right/up" verbatim. That theory
 * doesn't hold given camera.ts's actual eye = target − forward(yaw) placement
 * (see composeMove()'s own independently three.js-verified sign derivation);
 * confirmed both analytically and with a live Playwright probe (real
 * cam.yaw + a fixed-world landmark's projected screen position before/after
 * holding each key) that the old signs turned the view left on ArrowRight and
 * tipped the camera into a bird's-eye look on ArrowUp — backwards on both
 * axes. Owner's direction is now the spec:
 *   ←＝视角向左转，→＝视角向右转
 *   ↑＝视角抬起（更贴近水平仰视），↓＝视角压低（更接近俯视）
 * Mouse-drag signs in camera.ts/input.ts's pointermove handler are
 * unchanged — this fix only touches the arrow-key synthesis site.
 */
describe("computeArrowLook", () => {
  it("no arrow keys held produces a zero delta", () => {
    expect(computeArrowLook(false, false, false, false, 0.016)).toEqual({ dx: 0, dy: 0 });
  });

  it("ArrowRight alone produces a negative dx (turns the view right — see file header sign-fix note) and no dy", () => {
    const { dx, dy } = computeArrowLook(false, true, false, false, 0.016);
    expect(dx).toBeLessThan(0);
    expect(dy).toBe(0);
  });

  it("ArrowLeft alone produces a positive dx of the same magnitude as ArrowRight (turns the view left)", () => {
    const right = computeArrowLook(false, true, false, false, 0.016);
    const left = computeArrowLook(true, false, false, false, 0.016);
    expect(left.dx).toBeCloseTo(-right.dx, 10);
    expect(left.dx).toBeGreaterThan(0);
  });

  it("ArrowUp alone produces a positive dy (tilts the view up — see file header sign-fix note) and no dx", () => {
    const { dx, dy } = computeArrowLook(false, false, true, false, 0.016);
    expect(dy).toBeGreaterThan(0);
    expect(dx).toBe(0);
  });

  it("ArrowDown alone produces a negative dy of the same magnitude as ArrowUp (tilts the view down)", () => {
    const up = computeArrowLook(false, false, true, false, 0.016);
    const down = computeArrowLook(false, false, false, true, 0.016);
    expect(down.dy).toBeCloseTo(-up.dy, 10);
    expect(down.dy).toBeLessThan(0);
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
    // ArrowRight now yields negative dx (sign fix, see file header) — magnitude
    // is still the documented ~2.2 rad/s, just negated.
    expect(cam.yaw).toBeCloseTo(-2.2, 1);
  });

  /**
   * Independent ground-truth checks (code review 2026-08-10 note: the tests
   * above assert self-consistency with this file's own sign-fix comment, not
   * an independently-derived truth — exactly the failure mode that let the
   * previous (wrong) sign ship unnoticed). These two drive the *real*
   * createFollowCamera()/THREE.PerspectiveCamera through project()/position,
   * whose matrixWorld math comes from three.js's own lookAt implementation,
   * entirely independent of any sign reasoning in input.ts or camera.ts.
   * Mirrors composeMove.test.ts's cameraBasis() precedent for the same reason.
   */
  it("independent ground truth: ArrowLeft held turns the live camera's view left — a fixed-world landmark's screen-space X shifts right (classic parallax signature of the *viewer* turning left)", () => {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
    const cam = createFollowCamera(camera);
    cam.update(ORIGIN, { dx: 0, dy: 0 }, 0.016, 0, false, false); // snap to the initial yaw=0 pose
    const landmark = new THREE.Vector3(0, 0, 60); // fixed world point, roughly "ahead" at yaw=0
    const beforeX = landmark.clone().project(camera).x;

    const STEP = 1 / 60;
    for (let elapsed = 0; elapsed < 0.5; elapsed += STEP) {
      const { dx, dy } = computeArrowLook(true, false, false, false, STEP); // ArrowLeft held
      cam.update(ORIGIN, { dx, dy }, STEP, 0, true, false);
    }
    const afterX = landmark.clone().project(camera).x;
    expect(afterX).toBeGreaterThan(beforeX);
  });

  it("independent ground truth: ArrowUp held lowers the live camera toward eye level (camera.position.y decreases — the un-ambiguous geometric definition of 'less overhead, tilted up', no screen-projection sign convention involved)", () => {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
    const cam = createFollowCamera(camera);
    cam.update(ORIGIN, { dx: 0, dy: 0 }, 0.016, 0, false, false);
    const beforeY = camera.position.y;

    const STEP = 1 / 60;
    for (let elapsed = 0; elapsed < 0.3; elapsed += STEP) {
      const { dx, dy } = computeArrowLook(false, false, true, false, STEP); // ArrowUp held
      cam.update(ORIGIN, { dx, dy }, STEP, 0, true, false);
    }
    const afterY = camera.position.y;
    expect(afterY).toBeLessThan(beforeY);
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
