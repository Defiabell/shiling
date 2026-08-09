import type { PlayerInput } from "@shiling/sim";

/** Native key codes we listen for (layout-independent, unlike e.key). */
const GAME_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ShiftLeft",
  "ShiftRight",
  "KeyE",
  // Post-fix-6（owner feedback「trackpad 没有舒适的鼠标按键／不知道有冲刺」）：J 键
  // 撕咬（键盘转主键，左键降级备用，见下方 read() 的 attackHeld || keys.j）+ 方向键
  // 转镜头（见 addArrowLook()）。同一个 Set 兼管 keydown/keyup 的 preventDefault——
  // 方向键默认会滚动页面，必须一并加进来才能拦住。
  "KeyJ",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  // M1 postfix N1（叼运/筑巢/储粮）：C 键叼起/放下附近的尸体，PlayerInput.carry。
  "KeyC",
]);

interface KeyState {
  w: boolean;
  a: boolean;
  s: boolean;
  d: boolean;
  shift: boolean;
  e: boolean;
  j: boolean;
  arrowLeft: boolean;
  arrowRight: boolean;
  arrowUp: boolean;
  arrowDown: boolean;
  c: boolean;
}

/**
 * 方向键转镜头速率（Post-fix-6）。camDelta 的消费方（camera.ts）把 dx/dy 当作"这一帧
 * 的鼠标拖拽像素量"，乘以它自己的 DRAG_SENSITIVITY（0.008 rad/px）换算成弧度——这里
 * 反过来，把"想要的 rad/s"除以同一个系数，换算成每帧要在 accumDx/accumDy 里累加多少
 * 像素等价量。camera.ts 本身不需要知道这份合成量到底来自方向键还是真实拖拽：两者共用
 * 同一个 camDelta()/consume() 通路，auto-recenter 的手动输入判定
 * `isDragging || dx !== 0 || dy !== 0`（见 camera.ts）因此对方向键天然生效，不需要在
 * camera.ts 里再开一条判定分支。
 *
 * DRAG_SENSITIVITY 与 camera.ts 的同名常量必须保持同一个数值——两处各自独立声明字面量
 * （沿用本工程"每个模块自成一体，不跨模块 import UI-only 常量"的既有惯例），改一处记得
 * 同步改另一处。
 */
const ARROW_YAW_RATE = 2.2; // rad/s
const ARROW_PITCH_RATE = 1.2; // rad/s
const DRAG_SENSITIVITY = 0.008;

/**
 * Pure yaw/pitch-held-key → synthetic camDelta conversion, extracted out of
 * addArrowLook() for the same reason composeMove() was extracted out of
 * read() above (see that function's doc comment): lets
 * test/addArrowLook.test.ts pin down the rate/sign math — and, via a
 * camera.ts round-trip, that the two modules' independently-declared
 * DRAG_SENSITIVITY literals stay in sync — without any DOM/canvas wiring.
 */
export function computeArrowLook(
  arrowLeft: boolean,
  arrowRight: boolean,
  arrowUp: boolean,
  arrowDown: boolean,
  frameDt: number,
): { dx: number; dy: number } {
  const yawDir = (arrowRight ? 1 : 0) - (arrowLeft ? 1 : 0);
  const pitchDir = (arrowDown ? 1 : 0) - (arrowUp ? 1 : 0);
  // 符号与鼠标拖拽的 accumDx/accumDy 完全同义："方向右/下"就是视觉上"往右/往下拖拽"
  // 一次——ArrowRight 像拖右（dx 正，yaw 增），ArrowUp 像拖上（dy 负，pitch 增，见
  // camera.ts 的 `pitch = pitch - delta.dy * DRAG_SENSITIVITY`）。
  return {
    dx: (yawDir * ARROW_YAW_RATE * frameDt) / DRAG_SENSITIVITY,
    dy: (pitchDir * ARROW_PITCH_RATE * frameDt) / DRAG_SENSITIVITY,
  };
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
  /**
   * Post-fix-6: accumulates a synthetic camDelta contribution from currently
   * held arrow keys, scaled by frameDt so held-key rotation runs at a fixed
   * rad/s rate independent of frame rate (see ARROW_YAW_RATE/ARROW_PITCH_RATE
   * above). Must be called exactly once per render frame, before the same
   * frame's camDelta()/consume() — it writes into the very same accumulator
   * mouse-drag pointermove uses, so it flows through the existing
   * camDelta()/consume() path (and camera.ts's auto-recenter suppression)
   * without camera.ts needing to know the delta's source.
   */
  addArrowLook(frameDt: number): void;
}

/**
 * Wires WASD + Shift + E keyboard input, left-click attack, and press-and-
 * drag camera look with the right mouse button on `canvas`.
 *
 * 键位拆分（W2，playtest feedback「单一 E 键在重叠时无法选择操作」）：此前左键单纯拖拽
 * 镜头、E 兼管撕咬+挖掘/进食/饮水。现在拆成三块，互不冲突：
 *   - 左键（button 0）：按住 = 撕咬（PlayerInput.attack）。Post-fix-6 起 J 键 OR 进同一个
 *     字段，且键盘转为主键——trackpad 用户没有舒适的左键手势，HUD 提示也改成显示「J」
 *     （见 hud.ts contextPrompt），左键保留作兼容备用，判定逻辑上两者完全等价、没有优先级。
 *   - 右键（button 2）：按住拖拽 = 转镜头（原来挂在"任意按键"上的拖拽逻辑收窄到只认
 *     右键；contextmenu 仍然要 preventDefault，否则松开右键拖拽会弹原生菜单）。Post-fix-6
 *     另加方向键 ←→↑↓ 转镜头（见 addArrowLook()）——同一套 discoverability 修复，键盘
 *     玩家不需要碰鼠标就能兼顾移动/攻击/转镜头三件事。
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
  const keys: KeyState = {
    w: false,
    a: false,
    s: false,
    d: false,
    shift: false,
    e: false,
    j: false,
    arrowLeft: false,
    arrowRight: false,
    arrowUp: false,
    arrowDown: false,
    c: false,
  };
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
      case "KeyJ":
        keys.j = pressed;
        break;
      case "KeyC":
        keys.c = pressed;
        break;
      case "ArrowLeft":
        keys.arrowLeft = pressed;
        break;
      case "ArrowRight":
        keys.arrowRight = pressed;
        break;
      case "ArrowUp":
        keys.arrowUp = pressed;
        break;
      case "ArrowDown":
        keys.arrowDown = pressed;
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
        // 叼运（M1 postfix N1）同样在洞中被屏蔽——sim 侧其实已经不可能在洞中叼着任何
        // 东西（digging.ts 的 carryingCarcassId!==null 早退守卫 + carrying.ts 的
        // burrowId!==null 拾起守卫，两者互斥），这里 carry:false 只是与 attack:false
        // 同一套防御性收口，不依赖 sim 侧的隐含前提。
        return { moveX: 0, moveZ: 0, sprint: false, interact, attack: false, carry: false };
      }
      const fwd = (keys.w ? 1 : 0) - (keys.s ? 1 : 0);
      const strafe = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
      const { x, z } = composeMove(fwd, strafe, camYaw);
      return {
        moveX: x,
        moveZ: z,
        sprint: keys.shift,
        interact,
        // Post-fix-6：J OR 左键，两者完全等价（见文件头注释）。
        attack: attackHeld || keys.j,
        carry: keys.c,
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
    addArrowLook(frameDt: number) {
      const { dx, dy } = computeArrowLook(keys.arrowLeft, keys.arrowRight, keys.arrowUp, keys.arrowDown, frameDt);
      accumDx += dx;
      accumDy += dy;
    },
  };
}
