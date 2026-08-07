import * as THREE from "three";
import type { Vec3 } from "@shiling/sim";

/** Orbit radius from the follow target, in world units. */
const RADIUS = 14;
/**
 * Elevation angle above the horizontal plane, in radians. Clamped away from
 * dead-flat (disorienting, clips into terrain/creatures on slopes) and
 * dead-overhead (loses the third-person "behind the shoulder" read).
 */
const PITCH_MIN = 0.15;
const PITCH_MAX = 1.2;
const DEFAULT_PITCH = 0.5;
/** Radians of yaw/pitch turned per pixel of drag. */
const DRAG_SENSITIVITY = 0.005;
/**
 * Fraction of the remaining distance to the ideal orbit position closed each
 * update() call. Smooths the camera's own motion (sudden yaw/pitch flicks)
 * without adding a felt delay to "where is the player" — the target itself
 * is expected to already be the render-frame-interpolated mesh position, not
 * the raw once-per-fixed-step sim position.
 */
const FOLLOW_LERP = 0.2;

export interface FollowCamera {
  update(target: Vec3, delta: { dx: number; dy: number }): void;
  /** Current horizontal facing angle, using sim's forward-vector convention (sin(yaw), cos(yaw)) — see movement.ts. */
  yaw: number;
}

/**
 * Third-person orbit/follow camera: fixed radius and clamped pitch around a
 * moving target, with yaw steered by accumulated horizontal mouse drag and
 * pitch by vertical drag. `yaw` is exposed so input.ts can rotate WASD into
 * camera-relative world directions using the same convention sim's
 * `c.yaw = atan2(nx, nz)` produces, so "forward" always means "away from the
 * camera, into the screen".
 */
export function createFollowCamera(camera: THREE.Camera): FollowCamera {
  let pitch = DEFAULT_PITCH;
  let initialized = false;
  const idealPos = new THREE.Vector3();
  const targetVec = new THREE.Vector3();

  const cam: FollowCamera = {
    yaw: 0,
    update(target, delta) {
      cam.yaw += delta.dx * DRAG_SENSITIVITY;
      pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, pitch - delta.dy * DRAG_SENSITIVITY));

      targetVec.set(target.x, target.y, target.z);
      const horizontalRadius = RADIUS * Math.cos(pitch);
      const height = RADIUS * Math.sin(pitch);
      // Camera sits behind the target along -forward (forward = (sin(yaw), cos(yaw))),
      // so lookAt(target) faces the same direction WASD treats as "forward".
      idealPos.set(
        target.x - horizontalRadius * Math.sin(cam.yaw),
        target.y + height,
        target.z - horizontalRadius * Math.cos(cam.yaw),
      );

      if (!initialized) {
        // Snap on the very first frame instead of gliding in from main.ts's
        // pre-follow-cam placeholder camera pose.
        camera.position.copy(idealPos);
        initialized = true;
      } else {
        camera.position.lerp(idealPos, FOLLOW_LERP);
      }
      camera.lookAt(targetVec);
      // Task 7 (screen shake): main.ts adds a small additive offset to
      // camera.position right after this update() call returns (from
      // screenFx.ts's getShakeOffset()). This module intentionally stays
      // unaware of shake — its only job is "orbit around a moving target" —
      // so main.ts must call followCam.update() BEFORE applying the shake
      // offset each frame, never the other way around (this method
      // unconditionally overwrites camera.position from idealPos/lerp, which
      // would wipe out an offset applied before it ran).
    },
  };
  return cam;
}
