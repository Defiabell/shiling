/**
 * 精气粒子层 —— 单张 canvas ＋固定 128 粒子池。
 *
 * 约束来自计划：**一层 canvas、128 池**。所以这里没有对象分配（池预建、字段复用）、
 * 没有第二块画布，rAF 循环在「池全空且无常驻源」时自行停摆，不空转烧电。
 *
 * `prefers-reduced-motion` 下**不启循环、不吐任何粒子**（画布仍留在 DOM 里但恒为空白 ——
 * 系统开关可以中途改回来，留着这块空画布才能当场恢复，不必重建整层）。减少动画的正解是
 * 没有动画，不是把动画调慢。
 */

import { onMotionPreferenceChange, prefersReducedMotion } from "./motion.js";

const POOL_SIZE = 128;

interface Particle {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  /** "232,180,95" 形式，便于按透明度合成 */
  rgb: string;
}

/** 常驻发射源：状态栏上的一根精气柱。intensity 0〜1 决定吐粒频率。 */
export interface AmbientSource {
  x: number;
  y: number;
  rgb: string;
  intensity: number;
  /** 面状发射的横向散布（像素），缺省 6 */
  spreadX?: number;
}

export interface ParticleLayerOptions {
  /** 常驻源每秒最多吐几粒（intensity=1 时） */
  ambientRate?: number;
  /** 粒子整体上浮速度（像素/秒） */
  rise?: number;
  className?: string;
}

export interface ParticleLayer {
  canvas: HTMLCanvasElement;
  /** 一次性喷发（吞食精气、蜕变定格、飘字锚点） */
  burst(x: number, y: number, rgb: string, count?: number): void;
  /** 覆盖常驻源列表（每帧按 intensity 吐粒） */
  setAmbient(sources: readonly AmbientSource[]): void;
  /** 布局变化后重算画布尺寸 */
  resize(): void;
  dispose(): void;
}

/**
 * 造一层粒子画布并挂到 host 内（host 需为 position 非 static 的容器）。
 *
 * canvas 是 `pointer-events:none` 的装饰层，永不吃点击。
 */
export function createParticleLayer(
  host: HTMLElement,
  options: ParticleLayerOptions = {},
): ParticleLayer {
  const ambientRate = options.ambientRate ?? 2.2;
  const rise = options.rise ?? 26;
  const canvas = document.createElement("canvas");
  canvas.className = options.className ?? "fx-particles";
  canvas.setAttribute("aria-hidden", "true");
  host.append(canvas);

  const ctx = canvas.getContext("2d");
  const pool: Particle[] = Array.from({ length: POOL_SIZE }, () => ({
    alive: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0,
    maxLife: 1,
    size: 2,
    rgb: "232,180,95",
  }));
  let cursor = 0;
  let ambient: readonly AmbientSource[] = [];
  let ambientCredit = 0;
  let raf = 0;
  let last = 0;
  let disposed = false;
  let width = 0;
  let height = 0;

  function resize(): void {
    const rect = host.getBoundingClientRect();
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function spawn(x: number, y: number, rgb: string, spreadX: number, energetic: boolean): void {
    // 环形游标：池满时覆盖最老的一粒 —— 上限是硬的，宁可丢最老的也不越界分配。
    const particle = pool[cursor];
    cursor = (cursor + 1) % POOL_SIZE;
    if (!particle) return;
    particle.alive = true;
    particle.x = x + (Math.random() - 0.5) * spreadX;
    particle.y = y + (Math.random() - 0.5) * 4;
    particle.vx = (Math.random() - 0.5) * (energetic ? 46 : 12);
    particle.vy = -rise * (0.6 + Math.random() * 0.9) * (energetic ? 1.7 : 1);
    particle.maxLife = energetic ? 0.7 + Math.random() * 0.6 : 1.1 + Math.random() * 1.1;
    particle.life = particle.maxLife;
    particle.size = energetic ? 1.6 + Math.random() * 2.4 : 1.1 + Math.random() * 1.6;
    particle.rgb = rgb;
  }

  function anyAlive(): boolean {
    for (const particle of pool) if (particle.alive) return true;
    return false;
  }

  function tick(now: number): void {
    if (disposed || !ctx) return;
    const dt = last === 0 ? 0.016 : Math.min(0.05, (now - last) / 1000);
    last = now;

    // 常驻吐粒：按总强度累积配额，避免每源各自取整导致低强度永不发射。
    let totalIntensity = 0;
    for (const source of ambient) totalIntensity += Math.max(0, Math.min(1, source.intensity));
    if (totalIntensity > 0) {
      ambientCredit += totalIntensity * ambientRate * dt;
      while (ambientCredit >= 1) {
        ambientCredit -= 1;
        let roll = Math.random() * totalIntensity;
        for (const source of ambient) {
          const weight = Math.max(0, Math.min(1, source.intensity));
          roll -= weight;
          if (roll <= 0) {
            spawn(source.x, source.y, source.rgb, source.spreadX ?? 6, false);
            break;
          }
        }
      }
    } else {
      ambientCredit = 0;
    }

    ctx.clearRect(0, 0, width, height);
    for (const particle of pool) {
      if (!particle.alive) continue;
      particle.life -= dt;
      if (particle.life <= 0) {
        particle.alive = false;
        continue;
      }
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vy += 6 * dt; // 极轻的回落，避免笔直上升显得机械
      particle.vx *= 0.985;
      const ratio = particle.life / particle.maxLife;
      const alpha = ratio < 0.25 ? ratio / 0.25 : Math.min(1, (1 - ratio) * 4 + 0.15);
      ctx.fillStyle = `rgba(${particle.rgb},${(alpha * 0.72).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fill();
    }

    if (anyAlive() || totalIntensity > 0) {
      raf = requestAnimationFrame(tick);
    } else {
      raf = 0;
      last = 0;
      ctx.clearRect(0, 0, width, height);
    }
  }

  function wake(): void {
    if (disposed || raf !== 0 || prefersReducedMotion()) return;
    last = 0;
    raf = requestAnimationFrame(tick);
  }

  const observer =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          resize();
        })
      : null;
  observer?.observe(host);

  const offMotion = onMotionPreferenceChange((reduced) => {
    if (reduced) {
      if (raf !== 0) cancelAnimationFrame(raf);
      raf = 0;
      for (const particle of pool) particle.alive = false;
      ctx?.clearRect(0, 0, width, height);
    } else {
      wake();
    }
  });

  resize();

  return {
    canvas,
    burst(x, y, rgb, count = 10) {
      if (prefersReducedMotion()) return;
      for (let i = 0; i < count; i += 1) spawn(x, y, rgb, 10, true);
      wake();
    },
    setAmbient(sources) {
      ambient = sources;
      if (sources.some((source) => source.intensity > 0)) wake();
    },
    resize,
    dispose() {
      disposed = true;
      if (raf !== 0) cancelAnimationFrame(raf);
      observer?.disconnect();
      offMotion();
      canvas.remove();
    },
  };
}

/**
 * 精气四型 → 粒子色。取自 3D 版 palette 的 `essence*Glow`，保持跨版本同一套语义色；
 * 只有「穴」提亮了一档（3D 里的 0x9a7a4a 是三维加色光晕，落到 2D 暗底上几乎看不见），
 * 与 CSS token `--e-xue` 同值。
 */
export const ESSENCE_RGB = {
  zu: "232,180,95",
  lin: "111,216,232",
  xue: "184,145,90",
  meng: "217,67,42",
} as const;
