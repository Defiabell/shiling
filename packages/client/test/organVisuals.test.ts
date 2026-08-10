import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { GameState } from "@shiling/sim";
import { applyOrganVisuals } from "../src/render/organVisuals.js";
import type { CreatureModel } from "../src/render/creatureModels.js";

/**
 * organVisuals.ts 全程只用 THREE.Object3D/Group/Mesh 的场景图操作，不触碰
 * WebGLRenderer/canvas——与 camera.test.ts/composeMove.test.ts 一样可以在纯 Node
 * （无 jsdom）下直接跑，不需要为这个模块专门起 DOM 环境。
 */
function makeFakeModel(): CreatureModel {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.3), new THREE.MeshLambertMaterial({ color: 0x808080 }));
  group.add(body);
  return {
    group,
    mounts: {},
    parts: { body },
    animate: () => {},
    dispose: () => {},
  };
}

function organs(entries: Record<string, string>): GameState["organs"] {
  const out: GameState["organs"] = {};
  for (const [slot, organId] of Object.entries(entries)) {
    (out as Record<string, { organId: string; temper: number }>)[slot] = { organId, temper: 50 };
  }
  return out;
}

describe("applyOrganVisuals — resolveBackAnchor caching (code-review fix: orphaned-anchor leak)", () => {
  it("a back-slot organ synthesizes exactly one anchor Group under model.group, and caches it onto model.mounts.back", () => {
    const model = makeFakeModel();
    expect(model.mounts.back).toBeUndefined();

    const handle = applyOrganVisuals(model, "youshou", organs({ back: "linjia" }));
    expect(model.mounts.back).toBeDefined();
    // body + the synthesized back anchor = 2 direct children of group.
    expect(model.group.children).toHaveLength(2);

    handle.dispose();
    // dispose() only removes the tiles it created (children of the anchor),
    // never the anchor itself — the anchor is permanent scaffolding, same
    // lifecycle as a real head/tail mount.
    expect(model.group.children).toHaveLength(2);
    expect(model.mounts.back).toBeDefined();
  });

  it("rebuilding twice in a row (creatureView's dispose+rebuild-on-organSignature-change pattern) does not accumulate a second orphaned anchor", () => {
    const model = makeFakeModel();

    const first = applyOrganVisuals(model, "youshou", organs({ back: "linjia" }));
    first.dispose();
    const second = applyOrganVisuals(model, "youshou", organs({ back: "jibei" })); // swap linjia -> jibei, still a back-slot organ
    second.dispose();

    // Exactly one anchor (reused, not recreated) plus body — never grows across rebuilds.
    expect(model.group.children).toHaveLength(2);
  });

  it("dispose() removes the organ mesh children (tiles) parented under the cached anchor", () => {
    const model = makeFakeModel();
    const handle = applyOrganVisuals(model, "youshou", organs({ back: "linjia" }));
    const anchor = model.mounts.back!;
    expect(anchor.children.length).toBeGreaterThan(0); // 鳞甲背瓦×5

    handle.dispose();
    expect(anchor.children).toHaveLength(0);
  });
});

describe("applyOrganVisuals — unregistered organId (本命/shenzhong) is a deliberate no-op", () => {
  it("produces zero visual objects and disposes cleanly", () => {
    const model = makeFakeModel();
    const handle = applyOrganVisuals(model, "youshou", organs({ innate: "shenzhong" }));
    expect(model.group.children).toHaveLength(1); // only body, no visuals added
    handle.dispose(); // must not throw
    expect(model.group.children).toHaveLength(1);
  });
});
