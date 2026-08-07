import type { PlayerInput } from "@shiling/sim";

/** Native key codes we listen for (layout-independent, unlike e.key). */
const GAME_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft", "ShiftRight", "KeyE"]);

interface KeyState {
  w: boolean;
  a: boolean;
  s: boolean;
  d: boolean;
  shift: boolean;
  e: boolean;
}

/**
 * Rotates a (fwd, strafe) input pair into world-space XZ using the camera's
 * current yaw. Pure and side-effect-free on purpose — extracted out of
 * read() so test/composeMove.test.ts can pin it down against three.js's own
 * camera.lookAt basis independently of the rest of this module's DOM wiring.
 *
 * Forward-vector convention matches sim's `c.yaw = atan2(nx, nz)` (see
 * movement.ts): forward at yaw=0 is (0, +1). moveCreature normalizes the
 * resulting vector itself (norm2d), so a diagonal press producing a
 * non-unit magnitude here is fine.
 *
 * Sign fix (user-reported "A/D 左右相反", M0.5 first playtest): camera.ts
 * places the camera at `target − r·forward(camYaw)` and calls
 * `camera.lookAt(target)`. three.js's lookAt basis (Matrix4.lookAt) computes
 * `zAxis = normalize(eye − target)` and `xAxis = normalize(up × zAxis)` —
 * for this placement that resolves to `xAxis = forward(camYaw − π/2)`, i.e.
 * screen-right is the yaw **minus** a quarter turn, not plus. The strafe
 * terms below are therefore negated relative to the naive "right =
 * forward(yaw+π/2)" assumption; see composeMove.test.ts for the
 * independent, three.js-driven proof.
 */
export function composeMove(fwd: number, strafe: number, camYaw: number): { x: number; z: number } {
  const sin = Math.sin(camYaw);
  const cos = Math.cos(camYaw);
  return {
    x: sin * fwd - cos * strafe,
    z: cos * fwd + sin * strafe,
  };
}

export interface Input {
  /**
   * Reads the current held-key/drag state into a PlayerInput, rotating WASD
   * into world-space moveX/moveZ relative to the camera's current yaw.
   * Interact is reported as a held boolean, not an edge — sim owns edge
   * detection (e.g. dig-progress accumulation, burrow-exit trigger).
   */
  read(camYaw: number): PlayerInput;
  /** Mouse-drag delta accumulated since the last consume() call. */
  camDelta(): { dx: number; dy: number };
  /** Clears the accumulated drag delta; call once per render frame after the camera has consumed it. */
  consume(): void;
}

/**
 * Wires WASD + Shift + E keyboard input and press-and-drag mouse look on
 * `canvas`. `isPlayerBurrowed` is an optional escape hatch (Task 8 ledger
 * note): while the player is burrowed the client suppresses movement so a
 * same-tick move+interact can't consume the burrow-exit edge meant for E
 * alone (a fresh direction key held down the instant the player pops out
 * would otherwise register as "moving" on the very same read() that sim
 * uses to detect the exit press).
 */
export function createInput(canvas: HTMLCanvasElement, isPlayerBurrowed: () => boolean = () => false): Input {
  const keys: KeyState = { w: false, a: false, s: false, d: false, shift: false, e: false };
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let accumDx = 0;
  let accumDy = 0;

  function setKey(code: string, pressed: boolean): void {
    switch (code) {
      case "KeyW":
        keys.w = pressed;
        break;
      case "KeyA":
        keys.a = pressed;
        break;
      case "KeyS":
        keys.s = pressed;
        break;
      case "KeyD":
        keys.d = pressed;
        break;
      case "ShiftLeft":
      case "ShiftRight":
        keys.shift = pressed;
        break;
      case "KeyE":
        keys.e = pressed;
        break;
    }
  }

  window.addEventListener("keydown", (e) => {
    if (e.repeat) return; // OS key-repeat would otherwise just re-set the same held flag over and over
    if (!GAME_KEYS.has(e.code)) return;
    e.preventDefault(); // held Space/arrows scroll the page by default; WASD/Shift/E don't, but guard defensively
    setKey(e.code, true);
  });

  window.addEventListener("keyup", (e) => {
    if (!GAME_KEYS.has(e.code)) return;
    e.preventDefault();
    setKey(e.code, false);
  });

  // Pointer Events (not mouse events) so touch/pen drag works the same way;
  // Pointer Lock is explicitly out of scope for this task (per brief).
  // touch-action: none stops mobile browsers from hijacking the drag
  // gesture for page pan/pinch-zoom before pointermove ever reaches us.
  canvas.style.touchAction = "none";
  // Any button starts a drag (including right-click); suppress the native
  // context menu so releasing a right-click drag doesn't pop it up.
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    accumDx += e.clientX - lastX;
    accumDy += e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
  });

  function endDrag(e: PointerEvent): void {
    dragging = false;
    canvas.releasePointerCapture(e.pointerId);
  }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  return {
    read(camYaw: number): PlayerInput {
      const interact = keys.e;
      if (isPlayerBurrowed()) {
        return { moveX: 0, moveZ: 0, sprint: false, interact };
      }
      const fwd = (keys.w ? 1 : 0) - (keys.s ? 1 : 0);
      const strafe = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
      const { x, z } = composeMove(fwd, strafe, camYaw);
      return {
        moveX: x,
        moveZ: z,
        sprint: keys.shift,
        interact,
      };
    },
    camDelta() {
      return { dx: accumDx, dy: accumDy };
    },
    consume() {
      accumDx = 0;
      accumDy = 0;
    },
  };
}
