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
/**
 * Radians of yaw/pitch turned per pixel of drag.
 * M0.5 postfix-3 (playtest feedback "只能看一个方向" — dragging felt too
 * sluggish to actually re-aim): 0.005 × 1.6.
 */
const DRAG_SENSITIVITY = 0.008;
/**
 * Seconds of no manual drag input before auto-recenter is *armed* (M0.5
 * postfix-3). This timer accumulates independent of whether the player is
 * moving — only whether they're dragging — so it's already primed the
 * instant they start walking after standing idle for a while; it does not
 * require a *fresh* 2s of moving-without-dragging to engage. `isMoving` is
 * checked separately, only at the point of applying the ease (see
 * update() below), so recenter still never yanks the camera while the
 * player stands still deciding where to look. Manual drag always wins:
 * the `manualDrag` branch resets this timer to 0 every frame a drag is
 * detected, so recenter can only ever fire from a clean idle window, never
 * fight an active drag.
 */
const AUTO_RECENTER_IDLE_SEC = 2;
/**
 * Fraction-per-second of the remaining yaw gap closed once auto-recenter is
 * active: `min(1, AUTO_RECENTER_LERP * frameDt)` each frame, shortest-arc.
 */
const AUTO_RECENTER_LERP = 2.5;
/**
 * Fraction of the remaining distance to the ideal orbit position closed each
 * update() call. Smooths the camera's own motion (sudden yaw/pitch flicks)
 * without adding a felt delay to "where is the player" — the target itself
 * is expected to already be the render-frame-interpolated mesh position, not
 * the raw once-per-fixed-step sim position.
 */
const FOLLOW_LERP = 0.2;

export interface FollowCamera {
  /**
   * @param target Follow target position (render-interpolated mesh position).
   * @param delta Mouse-drag delta accumulated this frame (px); non-zero means
   *   a manual drag happened.
   * @param frameDt Render-frame duration in seconds — drives both the
   *   auto-recenter idle timer and its easing rate.
   * @param playerYaw Player's current facing (sim yaw convention) — the
   *   auto-recenter target angle.
   * @param isMoving Whether the player is actively moving this frame; auto-
   *   recenter only engages while moving (standing still never yanks the camera).
   * @param isDragging Whether the pointer is currently held down, even if
   *   this exact frame's delta happens to be {0,0} (e.g. paused mid-drag) —
   *   still counts as manual and must not let auto-recenter sneak in.
   */
  update(
    target: Vec3,
    delta: { dx: number; dy: number },
    frameDt: number,
    playerYaw: number,
    isMoving: boolean,
    isDragging: boolean,
  ): void;
  /** Current horizontal facing angle, using sim's forward-vector convention (sin(yaw), cos(yaw)) — see movement.ts. */
  yaw: number;
}

/** Shortest-path angle lerp so yaw doesn't spin the long way around across the ±π wrap (mirrors creatureView.ts's lerpAngle). */
function lerpAngle(a: number, b: number, t: number): number {
  let diff = (b - a) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  else if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
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
  // Seconds since the last manual drag input (M0.5 postfix-3, auto-recenter).
  // Starts at 0 (not Infinity) so a player who never touches the mouse still
  // has to wait out one AUTO_RECENTER_IDLE_SEC window like anyone else,
  // rather than recentering instantly on the very first moving frame.
  let idleSinceDragSec = 0;

  const cam: FollowCamera = {
    yaw: 0,
    update(target, delta, frameDt, playerYaw, isMoving, isDragging) {
      const manualDrag = isDragging || delta.dx !== 0 || delta.dy !== 0;
      if (manualDrag) {
        // Manual input always wins: apply the drag and immediately reset the
        // idle clock, so auto-recenter (below) can never start fighting an
        // active drag — it only ever resumes counting from a clean window.
        cam.yaw += delta.dx * DRAG_SENSITIVITY;
        pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, pitch - delta.dy * DRAG_SENSITIVITY));
        idleSinceDragSec = 0;
      } else {
        idleSinceDragSec += frameDt;
        // Auto-recenter: once the player has been moving with no manual drag
        // for AUTO_RECENTER_IDLE_SEC, ease yaw toward the player's own facing
        // (shortest arc) so the camera settles in behind them without input.
        if (isMoving && idleSinceDragSec >= AUTO_RECENTER_IDLE_SEC) {
          cam.yaw = lerpAngle(cam.yaw, playerYaw, Math.min(1, AUTO_RECENTER_LERP * frameDt));
        }
      }

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
