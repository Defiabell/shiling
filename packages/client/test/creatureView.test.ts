import { describe, expect, it } from "vitest";
import type { GameState } from "@shiling/sim";
import { organSignature } from "../src/render/creatureView.js";

describe("organSignature — M1 B5 器官挂件 dirty-check", () => {
  it("empty organs produces a stable (empty) signature", () => {
    expect(organSignature({})).toBe("");
  });

  it("is insensitive to temper changes on the same organId (visuals don't rebuild on tempering alone)", () => {
    const a: GameState["organs"] = { jaw: { organId: "liehe", temper: 20 } };
    const b: GameState["organs"] = { jaw: { organId: "liehe", temper: 87 } };
    expect(organSignature(a)).toBe(organSignature(b));
  });

  it("changes when an organId in a slot is replaced", () => {
    const before: GameState["organs"] = { jaw: { organId: "liehe", temper: 20 } };
    const after: GameState["organs"] = { jaw: { organId: "lve", temper: 20 } };
    expect(organSignature(before)).not.toBe(organSignature(after));
  });

  it("is independent of key insertion order (Object.keys order doesn't leak into the signature)", () => {
    const a: GameState["organs"] = {
      innate: { organId: "shenzhong", temper: 50 },
      jaw: { organId: "liehe", temper: 20 },
    };
    const b: GameState["organs"] = {
      jaw: { organId: "liehe", temper: 20 },
      innate: { organId: "shenzhong", temper: 50 },
    };
    expect(organSignature(a)).toBe(organSignature(b));
  });
});
