import * as THREE from "three";
import { PALETTE } from "./palette.js";
import type { SimEvent } from "./simEvents.js";

/**
 * 屏幕特效（Task 7）：受击红晕 + 死亡墨晕两层全屏 DOM 叠加，外加震屏（camera 位置
 * 加性偏移，由 main.ts 在 followCam.update 之后消费）与冲刺 FOV 弹簧（直接改
 * camera.fov）。DOM 叠加层沿用 atmosphere.ts/hud.ts 已有的"固定 id、幂等挂载、
 * 一次性注入 <style>"套路，不重复发明新模式。
 *
 * z-index=8：高于 atmosphere.ts 的纸纹(5)/暗角(6)，低于 hud.ts 的 #hud(10)。
 *
 * **CRITICAL（code review 抓到的真实 bug，务必保留这段注释）**：`.hud-death`
 * 自身声明 `z-index:20`，但它是 `#hud`（`position:fixed;z-index:10`）的**子元素**，
 * 而 `#hud` 这个 `z-index` 已经让它自己成为一个新的 stacking context——
 * `.hud-death` 的 `z-index:20` 因此只在 `#hud` 内部的兄弟节点之间有意义，
 * 对外层（本文件这两个直接挂在 `document.body` 下的 div）来说，真正参与比较的
 * 是 `#hud` 整体的 `z-index:10`，而不是 `.hud-death` 名义上的 20。也就是说
 * **无论把本文件的 z-index 设成比 20 小的任何数字，只要它 < 10，`.hud-death`
 * 出现的瞬间（`hud.ts` 里 `background:#000` 不透明、`display` 立即从 none 切到
 * flex，没有任何延迟/过渡）就会把还在展开的墨晕动画整个盖住**——两层"谁在谁
 * 上面"这件事本身没错（本来就要求墨晕在死亡文案下面），错的是 `.hud-death`
 * 出现得比墨晕动画（1.2s）快得多，导致动画播放的这 1.2 秒内玩家其实一帧都看
 * 不到墨晕，直接看到的是 hud.ts 那层瞬间显示的纯黑+文字。真正的修复不在这个
 * z-index 数字上，而是让 `hud.ts` 延迟 `DEATH_SPREAD_MS` 再让 `.hud-death`
 * 可见（见 hud.ts 里对应的 `window.setTimeout` 注释）——这样墨晕先把画面自然
 * 铺黑，铺完之后 HUD 的死亡文案再"接上"，而不是被 HUD 瞬间盖住。
 */
const STYLE_ID = "shiling-screenfx-style";
const HURT_ID = "shiling-screenfx-hurt";
const DEATH_ID = "shiling-screenfx-death";
const SCREENFX_Z = 8;

// ---- 受击红晕（hit）----
const HURT_FADE_MS = 300;
const HURT_BOX_SHADOW_ALPHA = 0.55;

// ---- 死亡墨晕（death）----
// 导出给 hud.ts 用：.hud-death 必须延迟这么久再变可见（见上方文件头 CRITICAL 注释），
// 单一数据源，不在两个文件里各写一份 1200 容易改漏其中一处。
export const DEATH_SPREAD_MS = 1200;

// ---- 震屏（随 hit 触发，指数衰减）----
const HIT_SHAKE_INTENSITY = 0.25;
const HIT_SHAKE_DECAY_LAMBDA = 8; // offset ∝ exp(-λt)，λ≈8 时约 0.29s 衰减到起始值的 10%
const HIT_SHAKE_OFFSET_SCALE = 0.3;
// 强度低于此阈值视为"衰减完毕"：不再采样新的随机方向、offset 直接钉零，
// 避免 shakeIntensity 无限趋近 0 但从不真正等于 0，导致 update() 永远多做一点无意义的三角函数运算。
const HIT_SHAKE_EPSILON = 0.001;
// ---- 击杀反馈震屏（Part 1，咬中反馈，postfix-9）----
// 只在玩家自己造成的致命一击上出现，且远比"受伤"震屏（0.25）克制——brief 原话
// "restraint"：每一次撕咬都摆动会喧宾夺主，这里只标记"击杀"这一个节拍，不摆红晕
// （那是 triggerHurt 的专属，见下方 handle() 里两者判据互斥：hit 事件的受害者是
// 玩家自己 vs 不是玩家自己）。复用同一套 shakeIntensity/指数衰减机制，只是数值
// 更小，不需要另开一套震屏状态。
const KILL_SHAKE_INTENSITY = 0.08;

// ---- 冲刺 FOV 弹簧 ----
const SPRINT_FOV_DELTA = 6; // 60→66，起始值取 createScreenFx 调用时的 camera.fov（当前工程里是 60）
const FOV_SPRING_STIFFNESS = 140;
// 临界阻尼（critically damped）：c = 2*sqrt(k)，收敛到目标值且不产生过冲/振荡，
// 读起来像"弹簧"但不会来回弹——冲刺切换是硬边沿（sprint 按下/松开），过冲会显得抖动。
const FOV_SPRING_DAMPING = 2 * Math.sqrt(FOV_SPRING_STIFFNESS);
// brief 要求：camera.updateProjectionMatrix() 仅在 |Δfov|>0.01 时调用——用
// "本地弹簧积分值 fov" 与"上一次实际提交到 camera.fov 的值"的差来判断，
// 不必额外维护一个 lastAppliedFov 变量：camera.fov 本身就是上一次提交的值。
const FOV_APPLY_EPSILON = 0.01;
/**
 * **CRITICAL（code review 抓到的真实 bug）**：这个弹簧用半隐式欧拉（symplectic
 * Euler：先更新速度再用新速度积分位置）离散化，对临界阻尼二阶系统只在
 * `dt < 2/sqrt(FOV_SPRING_STIFFNESS)`（这里是 2/√140≈0.169s）时数值稳定。
 * main.ts 里喂给 update() 的 frameDt 上限是 0.25s（专门为切后台/掉帧恢复
 * 设计的那个 clamp，见 main.ts 对应注释）——0.169s 的稳定阈值比这个上限还小，
 * 意味着任何一次真实的"切回前台/长时间卡顿恢复"都会踩中不稳定区间：实测单帧
 * dt=0.25 会把 fov 从 60 冲到 112.5（远超目标 66），需要后续十几帧才能荡回来，
 * 玩家会看到一次突兀的广角失真闪烁。修复：内部把传入的 frameDt 切成不超过
 * FOV_SPRING_SUBSTEP 的若干小步分别积分，每小步都在稳定阈值以内（留了约 10x
 * 安全余量），不管调用方一次性传多大的 frameDt 进来都不会发散。
 */
const FOV_SPRING_SUBSTEP = 1 / 60;

/**
 * hex → "r, g, b" 十进制字符串，直接位运算拆分（PALETTE 里的十六进制字面量本身
 * 就是字节三元组，不走 three.js 的 sRGB 色彩管理转换）——保证生成的 CSS rgba()
 * 数值与 brief 给出的字面量（如 cinnabar→rgba(194,59,34,·)）精确对应，不受
 * THREE.Color 色彩空间转换的任何影响（对照 atmosphere.ts 里 rawColor 对同一
 * 问题的注释：那里是给 shader uniform 用，这里是给纯 CSS 字符串用，两处各自
 * 用最直接的手段跳过色彩管理，没有共享的必要）。
 */
function hexToRgbTriplet(hex: number): string {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return `${r}, ${g}, ${b}`;
}

function ensureStyleInjected(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  const cinnabar = hexToRgbTriplet(PALETTE.cinnabar);
  // 死亡墨晕用 outlineInk（水墨黑，见 palette.ts 头注释"越陡越浓墨"同一套黑）
  // 而非字面 #000：满足"PALETTE colors only"约束，肉眼观感上与纯黑无法区分
  // （r=20,g=22,b=26），"结束时保持全黑"的要求照样成立。
  const ink = hexToRgbTriplet(PALETTE.outlineInk);
  style.textContent = `
#${HURT_ID} {
  position: fixed;
  inset: 0;
  z-index: ${SCREENFX_Z};
  pointer-events: none;
  box-shadow: inset 0 0 160px 60px rgba(${cinnabar}, ${HURT_BOX_SHADOW_ALPHA});
  opacity: 0;
}
#${HURT_ID}.screenfx-hurt-active {
  animation: screenfx-hurt-fade ${HURT_FADE_MS}ms ease-out forwards;
}
@keyframes screenfx-hurt-fade {
  from { opacity: 1; }
  to { opacity: 0; }
}
#${DEATH_ID} {
  position: fixed;
  inset: 0;
  z-index: ${SCREENFX_Z};
  pointer-events: none;
  background: radial-gradient(circle, rgba(${ink}, 1) 0%, rgba(${ink}, 1) 60%, rgba(${ink}, 0) 100%);
  transform: scale(0);
  transform-origin: 50% 50%;
}
#${DEATH_ID}.screenfx-death-active {
  animation: screenfx-death-spread ${DEATH_SPREAD_MS}ms ease-out forwards;
}
@keyframes screenfx-death-spread {
  from { transform: scale(0); }
  to { transform: scale(3); }
}
`;
  document.head.appendChild(style);
}

/** 幂等地拿到（或创建）一个固定 id 的 fixed-inset div，追加进 document.body。 */
function ensureOverlayDiv(id: string): HTMLDivElement {
  const existing = document.getElementById(id);
  if (existing) return existing as HTMLDivElement;
  const el = document.createElement("div");
  el.id = id;
  document.body.appendChild(el);
  return el;
}

export function createScreenFx(camera: THREE.PerspectiveCamera): {
  /**
   * `playerId` 驱动受伤红晕/死亡墨晕（只认玩家自己的 hit/death）。`killIds`
   * （Part 1，postfix-9；code review 2026-08-09 收紧）：main.ts 集中算好的"本 tick
   * 里玩家造成的致命一击"受害者 id 集合——驱动 triggerKillShake，不是简单的
   * `id!==playerId`（那样潭狩猎杀苓鼠/任意生物饥饿致死也会误触发震屏，见 main.ts
   * PLAYER_HIT_PROXIMITY 头部注释）。
   */
  handle(events: SimEvent[], playerId: number, killIds: Set<number>): void;
  /** 每渲染帧调用一次：推进震屏衰减 + FOV 弹簧。sprinting 已经是"冲刺且实际在移动"这个组合判断的结果（由 main.ts 派生），本函数不再重复判断"是否在动"。 */
  update(frameDt: number, sprinting: boolean): void;
  /** camera 加性偏移，供 main.ts 在 followCam.update() 之后叠加进 camera.position。返回同一个复用对象（见下方"零分配"注释），调用方不应保留跨帧引用、每帧读值即用即弃。 */
  getShakeOffset(): { x: number; y: number };
} {
  ensureStyleInjected();
  const hurtEl = ensureOverlayDiv(HURT_ID);
  const deathEl = ensureOverlayDiv(DEATH_ID);

  // ---- 震屏状态：闭包里的纯数字 + 一个复用的 {x,y} 输出对象，update() 全程零分配 ----
  let shakeIntensity = 0;
  const shakeOffset = { x: 0, y: 0 };

  // ---- FOV 弹簧状态：restFov 取 createScreenFx 调用时相机的当前 fov（main.ts 里是 60），
  // 不硬编码字面量 60，万一以后 main.ts 改了初始 FOV 这里也跟着走。 ----
  const restFov = camera.fov;
  let fov = restFov;
  let fovVelocity = 0;

  function triggerHurt(): void {
    shakeIntensity = HIT_SHAKE_INTENSITY;
    // 重新触发 CSS 动画：先摘掉 class、强制一次 reflow，再挂回去——如果只是重复
    // add 同一个已经生效的 class，class 列表没有变化，浏览器不会重新播放同一个
    // animation（连续受击时后一下的红晕会被前一下"吃掉"，没有视觉反馈）。
    hurtEl.classList.remove("screenfx-hurt-active");
    void hurtEl.offsetWidth;
    hurtEl.classList.add("screenfx-hurt-active");
  }

  function triggerDeath(): void {
    // 死亡只会发生一次（playerDead 单向边沿，见 simEvents.ts），不需要重新触发逻辑；
    // add class 后 CSS animation-fill-mode:forwards 让 scale(3) 状态永久保持（"结束时保持全黑"）。
    deathEl.classList.add("screenfx-death-active");
  }

  /**
   * 击杀反馈震屏（Part 1，postfix-9）——只摆动，不摆红晕（那是 triggerHurt 的专属，
   * 见 handle() 里两者互斥的判据）。`Math.max`：万一同一 tick 玩家自己也挨了一下
   * （罕见但不是不可能——冲上去同归于尽的一击），更强的受伤震屏不该被这里的小数值
   * 覆盖掉，取两者较大值。
   */
  function triggerKillShake(): void {
    shakeIntensity = Math.max(shakeIntensity, KILL_SHAKE_INTENSITY);
  }

  function handle(events: SimEvent[], playerId: number, killIds: Set<number>): void {
    for (const e of events) {
      if (e.kind === "hit" && e.id === playerId) triggerHurt();
      else if (e.kind === "death" && e.id === playerId) triggerDeath();
      else if (e.kind === "hit" && killIds.has(e.id)) triggerKillShake();
    }
  }

  function update(frameDt: number, sprinting: boolean): void {
    // ---- 震屏：指数衰减强度；每帧用衰减后的强度重新采样一个随机方向 ----
    // （brief："offset=强度×随机单位向量×0.3，每帧衰减"——每帧都是新的随机方向，
    // 不是固定方向只让长度衰减，这样读起来才是"抖"而不是"平滑滑向原位"）。
    if (shakeIntensity > HIT_SHAKE_EPSILON) {
      shakeIntensity *= Math.exp(-HIT_SHAKE_DECAY_LAMBDA * frameDt);
      if (shakeIntensity <= HIT_SHAKE_EPSILON) {
        shakeIntensity = 0;
        shakeOffset.x = 0;
        shakeOffset.y = 0;
      } else {
        const angle = Math.random() * Math.PI * 2;
        shakeOffset.x = Math.cos(angle) * shakeIntensity * HIT_SHAKE_OFFSET_SCALE;
        shakeOffset.y = Math.sin(angle) * shakeIntensity * HIT_SHAKE_OFFSET_SCALE;
      }
    } else {
      shakeOffset.x = 0;
      shakeOffset.y = 0;
    }

    // ---- 冲刺 FOV：临界阻尼弹簧朝目标值收敛；只在真正跨过 0.01 阈值时才提交给
    // camera 并调用 updateProjectionMatrix（避免静止/匀速冲刺时每帧都做这次矩阵重算）。
    // 按 FOV_SPRING_SUBSTEP 切成若干小步积分（见该常量上方的 CRITICAL 注释——
    // 一次性用完整的大 frameDt 积分会在掉帧恢复时数值发散）；updateProjectionMatrix
    // 仍然只在"这一整帧"结束后判断一次，不会因为拆了小步而多调用。
    const targetFov = sprinting ? restFov + SPRINT_FOV_DELTA : restFov;
    let remaining = frameDt;
    while (remaining > 0) {
      const step = Math.min(remaining, FOV_SPRING_SUBSTEP);
      const accel = (targetFov - fov) * FOV_SPRING_STIFFNESS - fovVelocity * FOV_SPRING_DAMPING;
      fovVelocity += accel * step;
      fov += fovVelocity * step;
      remaining -= step;
    }
    if (Math.abs(fov - camera.fov) > FOV_APPLY_EPSILON) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  function getShakeOffset(): { x: number; y: number } {
    return shakeOffset;
  }

  return { handle, update, getShakeOffset };
}
