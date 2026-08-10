import { describe, expect, it, vi } from "vitest";
import {
  FLAVOR_TOASTS,
  checkFlavorToastTriggers,
  isFlavorToastShown,
  markFlavorToastShown,
  type FlavorToastShownState,
} from "../src/flavorToast.js";

describe("FLAVOR_TOASTS — content matches brief verbatim", () => {
  it("has exactly the mountain/spring ids and text, in this order", () => {
    expect(FLAVOR_TOASTS).toEqual([
      { id: "mountain", text: "险峰之地，古兽出没" },
      { id: "spring", text: "灵泉滋养" },
    ]);
  });
});

describe("checkFlavorToastTriggers — pure edge detection", () => {
  const notShown: FlavorToastShownState = { mountainShown: false, springShown: false };
  const bothShown: FlavorToastShownState = { mountainShown: true, springShown: true };

  it("neither triggers when both conditions are false", () => {
    expect(checkFlavorToastTriggers(notShown, { inMountainZone: false, nearSpringDrinking: false })).toEqual({
      mountain: false,
      spring: false,
    });
  });

  it("mountain triggers in isolation when inMountainZone flips true and not yet shown", () => {
    expect(checkFlavorToastTriggers(notShown, { inMountainZone: true, nearSpringDrinking: false })).toEqual({
      mountain: true,
      spring: false,
    });
  });

  it("spring triggers in isolation when nearSpringDrinking flips true and not yet shown", () => {
    expect(checkFlavorToastTriggers(notShown, { inMountainZone: false, nearSpringDrinking: true })).toEqual({
      mountain: false,
      spring: true,
    });
  });

  it("both can trigger in the same frame if both conditions are true and neither was shown yet", () => {
    expect(checkFlavorToastTriggers(notShown, { inMountainZone: true, nearSpringDrinking: true })).toEqual({
      mountain: true,
      spring: true,
    });
  });

  it("never re-triggers an id that's already shown, even while its condition stays true", () => {
    expect(checkFlavorToastTriggers(bothShown, { inMountainZone: true, nearSpringDrinking: true })).toEqual({
      mountain: false,
      spring: false,
    });
  });

  it("each id's shown-state is independent of the other's condition", () => {
    // mountain 已展示过，但仍站在山地区里（条件持续为真）——不该重触发；spring 从未
    // 展示过且条件刚好也为真——该触发。两者互不影响对方的判定。
    const mountainOnly: FlavorToastShownState = { mountainShown: true, springShown: false };
    expect(checkFlavorToastTriggers(mountainOnly, { inMountainZone: true, nearSpringDrinking: true })).toEqual({
      mountain: false,
      spring: true,
    });
  });
});

/**
 * localStorage 持久化：本工程 vitest 未配置 jsdom（见 audio.test.ts/objectives.test.ts
 * 头部注释），手动 vi.stubGlobal 换一个内存 Storage 实现，同两处既有惯例。
 */
function stubFakeStorage(): Map<string, string> {
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
  return store;
}

describe("isFlavorToastShown / markFlavorToastShown — persistence, per-id independence", () => {
  it("defaults to not-shown on an empty store, for both ids", () => {
    stubFakeStorage();
    try {
      expect(isFlavorToastShown("mountain")).toBe(false);
      expect(isFlavorToastShown("spring")).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("marking one id shown does not affect the other id's stored flag", () => {
    const store = stubFakeStorage();
    try {
      markFlavorToastShown("mountain");
      expect(isFlavorToastShown("mountain")).toBe(true);
      expect(isFlavorToastShown("spring")).toBe(false);
      expect(store.get("shiling.flavorToastShown.mountain")).toBe("1");
      expect(store.has("shiling.flavorToastShown.spring")).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("privacy-mode-like failure (getItem/setItem throw): isFlavorToastShown() falls back to false, markFlavorToastShown() does not throw", () => {
    const throwingStorage = {
      getItem: () => { throw new Error("SecurityError"); },
      setItem: () => { throw new Error("SecurityError"); },
      removeItem: () => { throw new Error("SecurityError"); },
      clear: () => { throw new Error("SecurityError"); },
      key: () => { throw new Error("SecurityError"); },
      length: 0,
    } satisfies Storage;
    vi.stubGlobal("localStorage", throwingStorage);
    try {
      expect(isFlavorToastShown("mountain")).toBe(false);
      expect(() => markFlavorToastShown("spring")).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
