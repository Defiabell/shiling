import { describe, expect, it, beforeEach } from "vitest";
import * as THREE from "three";
import { buildCreatureModel, setCreatureFx, type AnimateCtx, type CreatureFx } from "../src/render/creatureModels.js";

/**
 * M2 A1（生物动效灵体化）：createLivingAnimate 的各物种分支/CreatureFx 单例都是纯
 * THREE 场景图操作（同 organVisuals.test.ts 的既有取舍），不触碰 document/canvas——
 * 可以在无 jsdom 的 Node 环境下直接跑。modelLibrary 在测试环境下从未被
 * setModelLibrary() 填充，buildCreatureModel 因此始终走 procedural fallback（与
 * production 的 GLB 路径外观不同，但 createLivingAnimate 的动效公式两条路径完全共享，
 * 见该文件 buildGlbCreatureModel 的调用点），足以覆盖本批的行为断言。
 */

function makeCtx(over: Partial<AnimateCtx>): AnimateCtx {
  return { activity: "idle", locomotion: "walk", speedHint: 0, tSec: 0, adrenaline: false, ...over };
}

function makeFx(): CreatureFx & { dustCalls: number[][]; inkCalls: number; bubbleCalls: number; hopTickCalls: number } {
  const fx = {
    dustCalls: [] as number[][],
    inkCalls: 0,
    bubbleCalls: 0,
    hopTickCalls: 0,
    dust(x: number, y: number, z: number, count: number) {
      fx.dustCalls.push([x, y, z, count]);
    },
    inkSmoke() {
      fx.inkCalls++;
    },
    bubble() {
      fx.bubbleCalls++;
    },
    hopTick() {
      fx.hopTickCalls++;
    },
  };
  return fx;
}

/** 每个测试都重装一份记录型 fx——setCreatureFx 是模块级单例，测试之间不能互相沿用上一个的调用计数。 */
let fx: ReturnType<typeof makeFx>;
beforeEach(() => {
  fx = makeFx();
  setCreatureFx(fx);
});

/** 驱动一遍固定步长的 tSec 序列——所有断言都用这个而不是单帧调用，因为跳跃相位/节流累积器需要跨帧才能看出行为。 */
function drive(animate: (ctx: AnimateCtx) => void, ctxFactory: (tSec: number) => AnimateCtx, steps: number, dt = 1 / 60): void {
  for (let i = 0; i < steps; i++) animate(ctxFactory(i * dt));
}

describe("苓鼠 lingshu — 跳跃 locomotion", () => {
  it("moving: bounces (position.y oscillates) and squash-stretches between the documented bounds", () => {
    const model = buildCreatureModel("lingshu");
    const baseY = model.group.position.y;
    const scaleYSamples: number[] = [];
    const heightSamples: number[] = [];
    drive(
      model.animate,
      (tSec) => makeCtx({ activity: "moving", speedHint: 2, tSec }),
      120,
    );
    // 再跑一遍记录采样（上面那遍只是让相位稳定，避免第一帧 frameDt=0 的边界干扰采样）
    for (let i = 0; i < 60; i++) {
      model.group.position.y = baseY; // 每帧手动复位到 baseline，模拟 applyInterp 在 animate() 之前重写过 position.y
      model.animate(makeCtx({ activity: "moving", speedHint: 2, tSec: 2 + i / 60 }));
      heightSamples.push(model.group.position.y - baseY);
      scaleYSamples.push(model.parts.body.scale.y);
    }
    expect(Math.max(...heightSamples)).toBeGreaterThan(0.15); // 顶点接近 0.25
    expect(Math.min(...heightSamples)).toBeLessThan(0.05); // 落地接近 0
    expect(Math.max(...scaleYSamples)).toBeGreaterThan(1.0); // 顶点拉伸 1.1×baseline
    expect(Math.min(...scaleYSamples)).toBeLessThan(1.0); // 落地压缩 0.85×baseline
  });

  it("landing edge fires exactly one dust puff (3 particles) + one hop tick per hop cycle", () => {
    const model = buildCreatureModel("lingshu");
    // speedHint=2 → period = clamp(0.9/2, 0.25, 0.6) = 0.45s；跑 3 个完整周期，dt 足够细。
    drive(model.animate, (tSec) => makeCtx({ activity: "moving", speedHint: 2, tSec }), Math.round((0.45 * 3) / (1 / 240)), 1 / 240);
    expect(fx.hopTickCalls).toBeGreaterThanOrEqual(2);
    expect(fx.hopTickCalls).toBeLessThanOrEqual(4); // 3 个周期，边界误差容忍 ±1
    expect(fx.hopTickCalls).toBe(fx.dustCalls.length); // 每次落地都成对触发
    for (const call of fx.dustCalls) expect(call[3]).toBe(3); // 3 particles per brief
  });

  it("idle: no hop dust/tick fires, and ear-area breathing pulses the head mount scale", () => {
    const model = buildCreatureModel("lingshu");
    const head = model.mounts.head!;
    const scales = new Set<number>();
    for (let i = 0; i < 60; i++) {
      model.animate(makeCtx({ activity: "idle", speedHint: 0, tSec: i / 30 }));
      scales.add(Math.round(head.scale.x * 1000) / 1000);
    }
    expect(fx.hopTickCalls).toBe(0);
    expect(fx.dustCalls.length).toBe(0);
    expect(scales.size).toBeGreaterThan(1); // 头部缩放确实在变化（呼吸），不是常数 1
  });
});

describe("潭狩 tanshou — 低伏潜行 + 尾迹 + 眼睛脉冲", () => {
  it("moving below the hunt-speed proxy emits ink smoke at the baseline ~2/s rate", () => {
    const model = buildCreatureModel("tanshou");
    drive(model.animate, (tSec) => makeCtx({ activity: "moving", speedHint: 3, tSec }), 240, 1 / 60); // 4s @ 60fps
    // 4s × 2/s ≈ 8 次，容忍节流边界误差。
    expect(fx.inkCalls).toBeGreaterThanOrEqual(6);
    expect(fx.inkCalls).toBeLessThanOrEqual(9);
  });

  it("moving above the hunt-speed proxy roughly doubles the ink emission rate", () => {
    const huntingModel = buildCreatureModel("tanshou");
    drive(huntingModel.animate, (tSec) => makeCtx({ activity: "moving", speedHint: 8, tSec }), 240, 1 / 60);
    const huntingCount = fx.inkCalls;

    fx = makeFx();
    setCreatureFx(fx);
    const walkingModel = buildCreatureModel("tanshou");
    drive(walkingModel.animate, (tSec) => makeCtx({ activity: "moving", speedHint: 3, tSec }), 240, 1 / 60);
    const walkingCount = fx.inkCalls;

    expect(huntingCount).toBeGreaterThan(walkingCount * 1.5);
  });

  it("stopping resets the ink-trail accumulator (no burst of leftover ink on the next move)", () => {
    const model = buildCreatureModel("tanshou");
    drive(model.animate, (tSec) => makeCtx({ activity: "moving", speedHint: 3, tSec }), 30, 1 / 60); // ~0.5s，攒了快 1 次但没触发
    model.animate(makeCtx({ activity: "idle", speedHint: 0, tSec: 30 / 60 }));
    const before = fx.inkCalls;
    model.animate(makeCtx({ activity: "moving", speedHint: 3, tSec: 30 / 60 + 1 / 60 }));
    expect(fx.inkCalls).toBe(before); // 单帧不该立刻补发一次残留的累积量
  });

  it("body lowers by the documented crouch offset every frame (cumulative-safe, relies on caller re-lerping position.y first)", () => {
    const model = buildCreatureModel("tanshou");
    const baseY = model.group.position.y;
    model.group.position.y = baseY; // 模拟 applyInterp 刚写过一次
    model.animate(makeCtx({ activity: "idle", speedHint: 0, tSec: 0 }));
    expect(model.group.position.y).toBeLessThan(baseY);
    expect(model.group.position.y).toBeCloseTo(baseY - 0.04, 3);
  });
});

describe("幼兽 youshou — 小跑 + 撕咬墨斩弧 + 肾上腺素速度线", () => {
  function findMeshChild(root: THREE.Object3D, predicate: (m: THREE.Mesh) => boolean): THREE.Mesh | null {
    let found: THREE.Mesh | null = null;
    root.traverse((obj) => {
      if (!found && obj instanceof THREE.Mesh && predicate(obj)) found = obj;
    });
    return found;
  }

  it("gains a jaw mount used as the strike-slash anchor", () => {
    const model = buildCreatureModel("youshou");
    expect(model.mounts.jaw).toBeDefined();
  });

  it("attacking edge lights up the jaw slash sprite, which fades back to 0 over ~0.15s", () => {
    const model = buildCreatureModel("youshou");
    const jaw = model.mounts.jaw!;
    const slash = findMeshChild(jaw, (m) => m.material instanceof THREE.MeshBasicMaterial)!;
    expect(slash).toBeTruthy();
    const slashMat = slash.material as THREE.MeshBasicMaterial;

    model.animate(makeCtx({ activity: "idle", speedHint: 0, tSec: 0 }));
    expect(slashMat.opacity).toBe(0);

    model.animate(makeCtx({ activity: "attacking", speedHint: 0, tSec: 1 / 60 }));
    expect(slashMat.opacity).toBe(1); // 触发帧本身不参与衰减，读满亮

    // 持续 attacking 不重触发（不应该一直卡在峰值）——继续推进到超过 0.15s。
    for (let i = 2; i < 12; i++) model.animate(makeCtx({ activity: "attacking", speedHint: 0, tSec: i / 60 }));
    expect(slashMat.opacity).toBe(0); // 0.15s 早已耗尽
  });

  it("sprint landing spawns dust; adrenaline speed lines only light up above the sprint proxy while adrenaline is active", () => {
    const model = buildCreatureModel("youshou");
    // group 的红色 (cinnabar) speed-line 材质——找到它们逐帧检查 opacity。
    const cinnabarPlanes: THREE.Mesh[] = [];
    model.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshBasicMaterial && obj.material.color.getHex() === 0xc23b22) {
        cinnabarPlanes.push(obj);
      }
    });
    expect(cinnabarPlanes.length).toBe(3);

    drive(model.animate, (tSec) => makeCtx({ activity: "moving", speedHint: 8, tSec, adrenaline: false }), 60, 1 / 60);
    expect(cinnabarPlanes.every((m) => (m.material as THREE.MeshBasicMaterial).opacity === 0)).toBe(true); // 没有 adrenaline，速度线不亮

    drive(model.animate, (tSec) => makeCtx({ activity: "moving", speedHint: 8, tSec: 1 + tSec, adrenaline: true }), 30, 1 / 60);
    expect(cinnabarPlanes.some((m) => (m.material as THREE.MeshBasicMaterial).opacity > 0)).toBe(true);

    expect(fx.dustCalls.length).toBeGreaterThan(0); // 冲刺落地尘确实触发过
  });
});

describe("溪鱼 xiyu — 游曳 + 气泡 + 偶发冲刺", () => {
  it("moving emits bubbles at the documented ~2/s rate and rolls side to side", () => {
    const model = buildCreatureModel("xiyu");
    const rolls = new Set<number>();
    for (let i = 0; i < 180; i++) {
      model.animate(makeCtx({ activity: "moving", speedHint: 1, tSec: i / 60 }));
      rolls.add(Math.round(model.parts.body.rotation.z * 1000));
    }
    expect(fx.bubbleCalls).toBeGreaterThanOrEqual(4); // 3s × 2/s = 6，容忍边界
    expect(fx.bubbleCalls).toBeLessThanOrEqual(8);
    expect(rolls.size).toBeGreaterThan(1);
  });

  it("idle stops bubble emission", () => {
    const model = buildCreatureModel("xiyu");
    drive(model.animate, (tSec) => makeCtx({ activity: "idle", speedHint: 0, tSec }), 300, 1 / 60);
    expect(fx.bubbleCalls).toBe(0);
  });

  it("dart burst happens at least once within one full period window and briefly stretches scale.z above 1", () => {
    const model = buildCreatureModel("xiyu");
    let maxScaleZ = 1;
    for (let i = 0; i < 60 * 12; i++) {
      // 12s，覆盖 XIYU_DART_PERIOD_SEC(5s) × jitter 上限的最坏情况
      model.animate(makeCtx({ activity: "moving", speedHint: 0.5, tSec: i / 60 }));
      maxScaleZ = Math.max(maxScaleZ, model.parts.body.scale.z);
    }
    expect(maxScaleZ).toBeGreaterThan(1.05);
  });
});

describe("穴獾 xuehuan — 拱地 waddle / 遁地 channel 颤抖尘暴", () => {
  it("walking waddles (rotation.z oscillates) without any dust", () => {
    const model = buildCreatureModel("xuehuan");
    const rolls = new Set<number>();
    for (let i = 0; i < 120; i++) {
      model.animate(makeCtx({ activity: "moving", speedHint: 1.5, tSec: i / 60 }));
      rolls.add(Math.round(model.parts.body.rotation.z * 1000));
    }
    expect(rolls.size).toBeGreaterThan(1);
    expect(fx.dustCalls.length).toBe(0);
  });

  it("channeling (activity===digging) shakes violently and fires a heavy, high-rate dust burst", () => {
    const model = buildCreatureModel("xuehuan");
    drive(model.animate, (tSec) => makeCtx({ activity: "digging", speedHint: 0, tSec }), 60, 1 / 60); // 1s @ XUEHUAN_CHANNEL_DUST_RATE_HZ=3.5
    expect(fx.dustCalls.length).toBeGreaterThanOrEqual(2);
    expect(fx.dustCalls.length).toBeLessThanOrEqual(5);
    for (const call of fx.dustCalls) expect(call[3]).toBeGreaterThan(8); // "heavy"——比苓鼠落地噗尘(3)/普通挖洞(8)更大
  });

  it("channel dust accumulator resets once channeling ends", () => {
    const model = buildCreatureModel("xuehuan");
    drive(model.animate, (tSec) => makeCtx({ activity: "digging", speedHint: 0, tSec }), 10, 1 / 60); // 累积但不到阈值
    model.animate(makeCtx({ activity: "idle", speedHint: 0, tSec: 10 / 60 }));
    const before = fx.dustCalls.length;
    model.animate(makeCtx({ activity: "digging", speedHint: 0, tSec: 10 / 60 + 1 / 60 }));
    expect(fx.dustCalls.length).toBe(before);
  });
});

describe("尾摆幅度随速度线性增长（M2 A1 修正——原实现只有频率随速度变化）", () => {
  it("higher speedHint produces a larger tail-wag amplitude envelope", () => {
    function tailAmplitude(speedHint: number): number {
      const model = buildCreatureModel("lingshu");
      let maxAbs = 0;
      for (let i = 0; i < 60; i++) {
        model.animate(makeCtx({ activity: "moving", speedHint, tSec: i / 60 }));
        maxAbs = Math.max(maxAbs, Math.abs(model.mounts.tail!.rotation.y));
      }
      return maxAbs;
    }
    expect(tailAmplitude(6)).toBeGreaterThan(tailAmplitude(0.5));
  });
});
