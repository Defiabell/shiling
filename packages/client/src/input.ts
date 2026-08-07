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
   * Reads the current held-key/mouse-button state into a PlayerInput,
   * rotating WASD into world-space moveX/moveZ relative to the camera's
   * current yaw. Interact and attack are both reported as held booleans, not
   * edges — sim owns edge detection (e.g. dig-progress accumulation,
   * burrow-exit trigger).
   */
  read(camYaw: number): PlayerInput;
  /** Mouse-drag delta accumulated since the last consume() call (right-button drag only — see pointerdown wiring below). */
  camDelta(): { dx: number; dy: number };
  /** Clears the accumulated drag delta; call once per render frame after the camera has consumed it. */
  consume(): void;
  /**
   * Whether the pointer is currently held down for a camera drag (right
   * button), independent of camDelta() — a drag paused mid-gesture (pointer
   * still down, mouse not moving this frame) still counts as manual input for
   * camera.ts's auto-recenter gate (M0.5 postfix-3): it must not sneak in
   * just because one frame's delta happened to be zero.
   */
  isDragging(): boolean;
}

/**
 * Wires WASD + Shift + E keyboard input, left-click attack, and press-and-
 * drag camera look with the right mouse button on `canvas`.
 *
 * 键位拆分（W2，playtest feedback「单一 E 键在重叠时无法选择操作」）：此前左键单纯拖拽
 * 镜头、E 兼管撕咬+挖掘/进食/饮水。现在拆成三块，互不冲突：
 *   - 左键（button 0）：按住 = 撕咬（PlayerInput.attack）。
 *   - 右键（button 2）：按住拖拽 = 转镜头（原来挂在"任意按键"上的拖拽逻辑收窄到只认
 *     右键；contextmenu 仍然要 preventDefault，否则松开右键拖拽会弹原生菜单）。
 *   - E 键：不变，仍是挖掘/进食/饮水/出洞这些情境交互（PlayerInput.interact）。
 * 两个鼠标按钮各自独立跟踪按下状态，都通过 Pointer Capture 保证在画布外松开也能收到
 * pointerup（避免"按下时在画布内、拖出画布外松开"导致状态卡死在按下）。
 *
 * `isPlayerBurrowed` is an optional escape hatch (Task 8 ledger note): while
 * the player is burrowed the client suppresses movement so a same-tick
 * move+interact can't consume the burrow-exit edge meant for E alone (a
 * fresh direction key held down the instant the player pops out would
 * otherwise register as "moving" on the very same read() that sim uses to
 * detect the exit press).
 */
export function createInput(canvas: HTMLCanvasElement, isPlayerBurrowed: () => boolean = () => false): Input {
  const keys: KeyState = { w: false, a: false, s: false, d: false, shift: false, e: false };
  let dragging = false; // 右键拖拽中
  let attackHeld = false; // 左键按住
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
  // 右键拖拽转镜头，左键仍要 preventDefault contextmenu（右键拖拽松开时不弹原生菜单）。
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button === 2) {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    } else if (e.button === 0) {
      attackHeld = true;
    }
    // 两种按钮都要 capture：保证拖到画布外/松到画布外时仍能收到对应的 pointerup。
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    accumDx += e.clientX - lastX;
    accumDy += e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
  });

  // pointerup 的 e.button 就是"这次被释放的按钮"，按按钮分别清对应的状态。
  //
  // 坑（code review 抓到）：Pointer Capture 是按 (element, pointerId) 设置的，不区分
  // 按钮——鼠标左/中/右键共用同一个 pointerId。如果左右键同时按住、鼠标移到画布外，
  // 这时先松开其中一个按钮：若这里无条件 releasePointerCapture，会把"仍按住的另一个
  // 按钮"也一起丢失 capture——之后那个按钮在画布外松开时，pointerup 根本不会派发到
  // canvas 上（会派发到鼠标实际悬停的元素），导致对应状态（dragging/attackHeld）永远
  // 卡在 true，读作"卡死的自动回正失效"（camera.ts 的 auto-recenter 从此再也不触发）。
  // 修复：只在两个按钮都已松开时才真正释放 capture；`e.buttons`（注意不是 e.button）
  // 是"这次事件处理完之后仍按住的按钮位掩码"，==0 就是"确实都松开了"。
  function endButton(e: PointerEvent): void {
    if (e.button === 2) dragging = false;
    else if (e.button === 0) attackHeld = false;
    if (e.buttons === 0) canvas.releasePointerCapture(e.pointerId);
  }
  // pointercancel 没有可靠的 button 语义（浏览器判定手势被劫持时触发），保守地把两个
  // 按钮的状态一起清掉，避免任何一个卡在"按住"。
  function cancelAllButtons(e: PointerEvent): void {
    dragging = false;
    attackHeld = false;
    canvas.releasePointerCapture(e.pointerId);
  }
  canvas.addEventListener("pointerup", endButton);
  canvas.addEventListener("pointercancel", cancelAllButtons);

  return {
    read(camYaw: number): PlayerInput {
      const interact = keys.e;
      if (isPlayerBurrowed()) {
        return { moveX: 0, moveZ: 0, sprint: false, interact, attack: false };
      }
      const fwd = (keys.w ? 1 : 0) - (keys.s ? 1 : 0);
      const strafe = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
      const { x, z } = composeMove(fwd, strafe, camYaw);
      return {
        moveX: x,
        moveZ: z,
        sprint: keys.shift,
        interact,
        attack: attackHeld,
      };
    },
    camDelta() {
      return { dx: accumDx, dy: accumDy };
    },
    consume() {
      accumDx = 0;
      accumDy = 0;
    },
    isDragging() {
      return dragging;
    },
  };
}
