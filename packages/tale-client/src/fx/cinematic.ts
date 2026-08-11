/**
 * 过场演出层（cinematic overlay）——「一张资源 ＋ 时长 ＋ 文案」。
 *
 * 出入参**不绑图片**：`MediaAsset` 是 `{ kind: "image" | "video", src }`，image 走
 * Ken Burns 缓推镜（CSS transform）＋粒子叠加做「伪视频」，video 直接播。owner 点名的
 * image-to-video 接口一上线，只要把内容里的 kind 换成 "video"、src 换成 mp4，这里
 * 一行都不用改 —— 这是 B4 与将来真视频的接缝，所以刻意做成资源描述而非图片路径。
 *
 * 用在四处：题字（hold 模式，当标题屏背景）、蜕变、死亡、登神。
 */

import { el } from "../dom.js";
import type { MediaAsset } from "../model/eventVm.js";
import { createParticleLayer } from "./particles.js";
import { prefersReducedMotion } from "./motion.js";

export type CinematicMotion = "in" | "out" | "pan-left" | "pan-right" | "rise";

export interface CinematicCue {
  media: MediaAsset;
  /** 演出时长（毫秒）。`hold` 为真时只用于文案节奏，不自动结束。 */
  durationMs: number;
  /** 逐行文案，按时长前 60% 依次淡入。全角标点。 */
  lines?: string[];
  /** 粒子色 "r,g,b"；缺省不叠粒子 */
  tintRgb?: string;
  /** 真 = 不自动结束（题字屏当背景用），靠 skip()／dispose() 收场 */
  hold?: boolean;
  /** 允许点击／回车／空格／Esc 跳过，缺省 true（hold 模式下无跳过按钮） */
  skippable?: boolean;
  /** 无障碍标签：屏幕阅读器读这句，而不是读一张装饰图 */
  label?: string;
  motion?: CinematicMotion;
  /** 额外类名，供各屏做局部配色 */
  className?: string;
}

export interface CinematicHandle {
  el: HTMLElement;
  /** 演出自然结束或被跳过时 resolve（只 resolve 一次） */
  done: Promise<void>;
  skip(): void;
  dispose(): void;
}

/** 单条文案的淡入时机：铺在时长的前 60%，最少间隔 380ms。 */
function lineDelays(count: number, durationMs: number): number[] {
  if (count === 0) return [];
  const span = Math.max(380 * count, durationMs * 0.6);
  const step = span / count;
  return Array.from({ length: count }, (_, i) => Math.round(step * i * 0.86) + 220);
}

export function createCinematic(cue: CinematicCue): CinematicHandle {
  const reduced = prefersReducedMotion();
  const skippable = cue.skippable !== false;
  const motion: CinematicMotion = cue.motion ?? "in";

  const media =
    cue.media.kind === "video"
      ? el("video", {
          class: "cine__media-el",
          attrs: {
            src: cue.media.src,
            autoplay: "",
            muted: "",
            playsinline: "",
            loop: cue.hold ? "" : null,
            preload: "auto",
          },
        })
      : el("img", {
          class: `cine__media-el cine__media-el--kb kb-${motion}`,
          attrs: { src: cue.media.src, alt: "" },
        });
  if (cue.media.kind === "video") (media as HTMLVideoElement).muted = true;
  if (cue.media.focus) {
    media.style.objectPosition = `${(cue.media.focus.x * 100).toFixed(1)}% ${(cue.media.focus.y * 100).toFixed(1)}%`;
  }

  const fxHost = el("div", { class: "cine__fx", attrs: { "aria-hidden": "true" } });
  const lines = cue.lines ?? [];
  const delays = lineDelays(lines.length, cue.durationMs);
  // 文案是**内容**不是装饰：放进 aria-live 区，逐行淡入时会被读出来。
  // 早先把 role="img" ＋ aria-label 挂在外层，屏幕阅读器会把整棵子树当成一张图，
  // 死亡／登神的旁白对读屏用户等于不存在。
  const caption = el(
    "div",
    { class: "cine__caption", attrs: { role: "status", "aria-live": "polite" } },
    lines.map((line, i) =>
      el("p", {
        class: "cine__line",
        text: line,
        style: reduced ? "opacity:1;transform:none" : `animation-delay:${delays[i] ?? 0}ms`,
      }),
    ),
  );

  const root = el(
    "div",
    {
      class: `cine${cue.className ? ` ${cue.className}` : ""}${cue.hold ? " cine--hold" : ""}`,
      attrs: {
        role: "group",
        "aria-label": cue.label ?? lines.join(" "),
      },
    },
    [
      // 画面本身是氛围，读屏跳过；文案与「跳过」按钮才是可达内容
      el("div", { class: "cine__media", attrs: { "aria-hidden": "true" } }, [media]),
      el("div", { class: "cine__scrim", attrs: { "aria-hidden": "true" } }),
      fxHost,
      caption,
    ],
  );

  let settle: (() => void) | null = null;
  const done = new Promise<void>((resolve) => {
    settle = resolve;
  });
  let finished = false;
  // 定时器句柄的类型在 DOM（number）与 @types/node（Timeout）下不同，
  // 用 ReturnType 取当前环境的真实类型，别硬写 number。
  let timer: ReturnType<typeof globalThis.setTimeout> | null = null;

  function finish(): void {
    if (finished) return;
    finished = true;
    if (timer !== null) globalThis.clearTimeout(timer);
    timer = null;
    settle?.();
  }

  const particles =
    cue.tintRgb && !reduced ? createParticleLayer(fxHost, { ambientRate: 5, rise: 34 }) : null;
  if (particles && cue.tintRgb) {
    // 面状常驻源：整幅画面下缘往上飘，像香灰或灵尘
    particles.setAmbient([
      { x: 0, y: 0, rgb: cue.tintRgb, intensity: 0 },
    ]);
    // 真正的发射点要等布局出来才知道宽高，交给下面的 rAF
    requestAnimationFrame(() => {
      const rect = fxHost.getBoundingClientRect();
      particles.setAmbient([
        {
          x: rect.width * 0.5,
          y: rect.height * 0.92,
          rgb: cue.tintRgb ?? "232,180,95",
          intensity: 0.85,
          spreadX: rect.width * 0.9,
        },
      ]);
    });
  }

  if (skippable) {
    root.classList.add("cine--skippable");
    root.addEventListener("click", () => finish());
    if (!cue.hold) {
      root.append(
        el("button", {
          class: "cine__skip",
          text: "跳过",
          attrs: { type: "button" },
          on: { click: () => finish() },
        }),
      );
    }
  }

  const onKey = (event: KeyboardEvent): void => {
    if (!skippable) return;
    if (event.key === "Enter" || event.key === " " || event.key === "Escape") finish();
  };
  if (skippable) globalThis.addEventListener("keydown", onKey);

  if (!cue.hold) {
    timer = globalThis.setTimeout(finish, Math.max(0, cue.durationMs));
  }

  return {
    el: root,
    done,
    skip: finish,
    dispose() {
      finish();
      globalThis.removeEventListener("keydown", onKey);
      particles?.dispose();
      root.remove();
    },
  };
}

/** 便捷用法：挂到 host（缺省 body）上播完即拆。 */
export async function playCinematic(cue: CinematicCue, host?: HTMLElement): Promise<void> {
  const handle = createCinematic(cue);
  (host ?? document.body).append(handle.el);
  // 入场淡入靠 CSS 的 .cine 动画，出场这里手动淡出，避免突然消失
  await handle.done;
  handle.el.classList.add("cine--out");
  await new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, prefersReducedMotion() ? 0 : 420);
  });
  handle.dispose();
}
