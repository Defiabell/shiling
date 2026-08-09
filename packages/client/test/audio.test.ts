import { describe, expect, it, vi } from "vitest";
import type { Creature, GameState } from "@shiling/sim";
import {
  CHIRP_MAX_SEC,
  CHIRP_MIN_SEC,
  HEARTBEAT_HP_RATIO_THRESHOLD,
  MASTER_BASE_GAIN,
  PAUSE_DUCK_GAIN,
  computeHeartbeatGainScale,
  computeMasterTarget,
  createAudio,
  generateBrownNoiseSamples,
  generateWhiteNoiseSamples,
  isPlayerCausedHit,
  nextChirpDelaySec,
} from "../src/audio.js";

/** 与 test/simEvents.test.ts 同一套最小 Creature/GameState 字面量惯例。 */
function mkCreature(over: Partial<Creature>): Creature {
  return {
    id: 1, species: "youshou", pos: { x: 0, y: 0, z: 0 }, yaw: 0, hp: 60,
    needs: { hunger: 80, thirst: 80, fatigue: 100 }, locomotion: "walk", activity: "idle",
    aiState: "idle", targetId: null, attackCooldown: 0, feedingCarcassId: null,
    burrowId: null, satiatedTimer: 0, digProgress: 0, interactHeld: false,
    aiDirX: 0, aiDirZ: 1, aiTimer: 0, fleeTime: 0, fleeRecoverTime: 0,
    carryingCarcassId: null, carryHeld: false, nestProgress: 0, ...over,
  };
}
function mkState(over: Partial<GameState>): GameState {
  return { tick: 0, playerId: 1, creatures: [], carcasses: [], playerDead: false, nextId: 100, homeNest: null, ...over };
}

// 固定的伪随机序列——同一份数字既喂给白噪声也喂给棕噪声，保证"棕噪声更平滑"这个
// 比较是在同一组底层随机数上做的公平对比，不是两次独立随机采样的偶然结果。
function fixedRng(seed: number[]): () => number {
  let i = 0;
  return () => seed[i++ % seed.length]!;
}

describe("computeMasterTarget", () => {
  it("muted always wins, regardless of paused", () => {
    expect(computeMasterTarget(true, false)).toBe(0);
    expect(computeMasterTarget(true, true)).toBe(0);
  });
  it("paused ducks to PAUSE_DUCK_GAIN when not muted", () => {
    expect(computeMasterTarget(false, true)).toBe(PAUSE_DUCK_GAIN);
  });
  it("normal playback is MASTER_BASE_GAIN", () => {
    expect(computeMasterTarget(false, false)).toBe(MASTER_BASE_GAIN);
  });
});

describe("computeHeartbeatGainScale", () => {
  it("is minimal right at the threshold", () => {
    const atThreshold = computeHeartbeatGainScale(HEARTBEAT_HP_RATIO_THRESHOLD);
    expect(atThreshold).toBeGreaterThan(0);
    expect(atThreshold).toBeLessThan(0.5);
  });
  it("reaches full scale at hp=0", () => {
    expect(computeHeartbeatGainScale(0)).toBeCloseTo(1, 5);
  });
  it("is monotonically decreasing as hpRatio rises toward the threshold", () => {
    const low = computeHeartbeatGainScale(0.05);
    const mid = computeHeartbeatGainScale(0.15);
    const high = computeHeartbeatGainScale(0.29);
    expect(low).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(high);
  });
  it("clamps defensively for out-of-range input", () => {
    expect(computeHeartbeatGainScale(-1)).toBeCloseTo(1, 5);
    expect(computeHeartbeatGainScale(1)).toBeCloseTo(computeHeartbeatGainScale(HEARTBEAT_HP_RATIO_THRESHOLD), 5);
  });
});

describe("nextChirpDelaySec", () => {
  it("returns CHIRP_MIN_SEC when rng()===0", () => {
    expect(nextChirpDelaySec(() => 0)).toBe(CHIRP_MIN_SEC);
  });
  it("approaches CHIRP_MAX_SEC as rng()→1", () => {
    expect(nextChirpDelaySec(() => 0.999999)).toBeCloseTo(CHIRP_MAX_SEC, 3);
  });
  it("stays within [CHIRP_MIN_SEC, CHIRP_MAX_SEC) for the default rng across many samples", () => {
    for (let i = 0; i < 200; i++) {
      const v = nextChirpDelaySec();
      expect(v).toBeGreaterThanOrEqual(CHIRP_MIN_SEC);
      expect(v).toBeLessThan(CHIRP_MAX_SEC);
    }
  });
});

describe("isPlayerCausedHit", () => {
  const state = mkState({ playerId: 1, creatures: [mkCreature({ id: 1, pos: { x: 0, y: 0, z: 0 } })] });

  it("true when the hit landed within attack range of the player", () => {
    expect(isPlayerCausedHit(state, 1, { x: 1, y: 0, z: 0 }, 2.3)).toBe(true);
  });
  it("false when the hit is far away (likely background ecology, not the player)", () => {
    expect(isPlayerCausedHit(state, 1, { x: 50, y: 0, z: 50 }, 2.3)).toBe(false);
  });
  it("false when the player cannot be found (defensive)", () => {
    expect(isPlayerCausedHit(state, 999, { x: 0, y: 0, z: 0 }, 2.3)).toBe(false);
  });
});

describe("generateWhiteNoiseSamples", () => {
  it("produces the requested length, all within [-1, 1]", () => {
    const samples = generateWhiteNoiseSamples(1000);
    expect(samples.length).toBe(1000);
    for (const s of samples) {
      expect(s).toBeGreaterThanOrEqual(-1);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
  it("is deterministic given a fixed rng", () => {
    const rng = fixedRng([0, 0.5, 1]);
    expect(Array.from(generateWhiteNoiseSamples(3, rng))).toEqual([-1, 0, 1]);
  });
});

describe("generateBrownNoiseSamples", () => {
  it("produces the requested length, clamped within [-1, 1]", () => {
    const samples = generateBrownNoiseSamples(1000);
    expect(samples.length).toBe(1000);
    for (const s of samples) {
      expect(s).toBeGreaterThanOrEqual(-1);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
  it("is smoother (smaller sample-to-sample deltas) than white noise from the same rng sequence", () => {
    const seed = Array.from({ length: 500 }, (_, i) => (Math.sin(i * 12.9898) * 43758.5453) % 1).map((v) => Math.abs(v));
    const white = generateWhiteNoiseSamples(500, fixedRng(seed));
    const brown = generateBrownNoiseSamples(500, fixedRng(seed));
    const avgDelta = (arr: Float32Array): number => {
      let sum = 0;
      for (let i = 1; i < arr.length; i++) sum += Math.abs(arr[i]! - arr[i - 1]!);
      return sum / (arr.length - 1);
    };
    expect(avgDelta(brown)).toBeLessThan(avgDelta(white));
  });
});

describe("createAudio() before unlock()", () => {
  it("reports no AudioContext yet", () => {
    const audio = createAudio();
    expect(audio.getContextState()).toBe("none");
    expect(audio.getMasterGainValue()).toBe(0);
  });
  it("handle()/update() are safe no-ops (no AudioContext/window touched)", () => {
    const audio = createAudio();
    const state = mkState({ playerId: 1, creatures: [mkCreature({ id: 1 })] });
    expect(() => audio.handle([{ kind: "splash", id: 1, pos: { x: 0, y: 0, z: 0 } }], state, 1)).not.toThrow();
    expect(() =>
      audio.update(0.016, {
        playerHunger: 80, playerThirst: 80, playerHp: 60, maxHp: 60,
        locomotion: "walk", drinking: false, paused: false, started: true,
      }),
    ).not.toThrow();
  });
  it("toggleMute() flips state and its return value matches isMuted()", () => {
    const audio = createAudio();
    const initial = audio.isMuted();
    const toggled = audio.toggleMute();
    expect(toggled).toBe(!initial);
    expect(audio.isMuted()).toBe(toggled);
    const toggledBack = audio.toggleMute();
    expect(toggledBack).toBe(initial);
  });

  /**
   * 真正的跨会话持久化（code review 2026-08-09 抓到的测试缺口）：上面那条测试只在
   * 同一个 createAudio() 实例上来回切换，从没验证过 readMutedFromStorage() 真的从
   * localStorage 读回过写进去的值。本项目 vitest 没配 jsdom（见 vitest.config.ts），
   * Node 22+ 的全局 `localStorage` 已声明但取值 undefined，直接调用会抛，audio.ts
   * 自己的 try/catch 会默默吞掉——这意味着不手动注入一个假的 Storage 实现，"持久化"
   * 这条行为在当前测试环境下根本不可达。这里用 vi.stubGlobal 换一个内存实现的
   * Storage，构造两个独立的 createAudio() 实例，证明第二个实例确实读到了第一个
   * 实例写进去的值——而不仅仅是同一个闭包变量的读写。
   */
  it("persists mute across separate createAudio() instances via localStorage", () => {
    const store = new Map<string, string>();
    const fakeStorage = {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
      clear: () => { store.clear(); },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() { return store.size; },
    } satisfies Storage;
    vi.stubGlobal("localStorage", fakeStorage);
    try {
      const first = createAudio();
      expect(first.isMuted()).toBe(false); // 空 store：默认未静音
      first.toggleMute();
      expect(first.isMuted()).toBe(true);

      const second = createAudio(); // 独立实例、独立闭包，唯一共享的是 fakeStorage
      expect(second.isMuted()).toBe(true); // 真的从 store 里读回了 first 写下的值
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
