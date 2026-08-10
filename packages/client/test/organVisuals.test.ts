import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { GameState } from "@shiling/sim";
import { applyOrganVisuals } from "../src/render/organVisuals.js";
import type { CreatureModel } from "../src/render/creatureModels.js";
import { PALETTE } from "../src/render/palette.js";

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

/**
 * M2 A1 灵光测试专用——带一个 head mount 的模型（liehe/lve/yetong/lingxiu 四个器官
 * 的 builder 都要求 `model.mounts.head` 存在，否则早退返回零几何体，见 organVisuals.ts
 * 各自 builder 的 `if (!head) return { objects: [] };`）。不改动 `makeFakeModel()` 本身
 * ——既有测试（back-slot 锚点/dispose 计数）依赖 `mounts: {}` 时 `model.group.children`
 * 的精确长度，加一个 head mount 会让那些计数断言全部错位。
 */
function makeFakeModelWithHead(): CreatureModel {
  const model = makeFakeModel();
  const head = new THREE.Group();
  model.group.add(head);
  model.mounts.head = head;
  return model;
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

/** 按材质颜色（hex）收集 model.group 子树里全部 MeshBasicMaterial 网格——M2 A1 的灵光/新生光环/流光点都是 MeshBasicMaterial，用颜色区分"哪一层"。 */
function findMeshesByColor(root: THREE.Object3D, hex: number): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshBasicMaterial && obj.material.color.getHex() === hex) {
      found.push(obj);
    }
  });
  return found;
}

describe("applyOrganVisuals — M2 A1 器官灵光（essence-mapped glow + pulse）", () => {
  it("liehe（jaw，affinity meng:1，有 head mount 时走主路径）：灵光锚在器官自己第一枚网格（獠牙）上，取 essenceMengGlow 主色，且随 update() 呼吸脉冲", () => {
    const model = makeFakeModelWithHead();
    const handle = applyOrganVisuals(model, "youshou", organs({ jaw: "liehe" }));
    const glows = findMeshesByColor(model.group, PALETTE.essenceMengGlow);
    expect(glows).toHaveLength(1);
    // 主路径断言：灵光的父节点必须是 liehe 自己建的獠牙网格（head 的子节点），
    // 不是 model.parts.body（fallback 分支）——见下面另一条 headless 测试对照。
    expect(glows[0]!.parent).not.toBe(model.parts.body);
    expect(model.mounts.head!.children).toContain(glows[0]!.parent);
    const material = glows[0]!.material as THREE.MeshBasicMaterial;

    const opacities = new Set<number>();
    for (let i = 0; i < 20; i++) {
      handle.update(i / 10, null, Infinity);
      opacities.add(Math.round(material.opacity * 1000) / 1000);
      expect(material.opacity).toBeGreaterThanOrEqual(0.14);
      expect(material.opacity).toBeLessThanOrEqual(0.36);
    }
    expect(opacities.size).toBeGreaterThan(1); // 确实在脈动，不是常数
  });

  it("liehe 在没有 head mount 时（buildLiehe 早退返回零几何体）灵光回退锚在 model.parts.body 上", () => {
    const model = makeFakeModel(); // 无 head mount
    applyOrganVisuals(model, "youshou", organs({ jaw: "liehe" }));
    const glows = findMeshesByColor(model.group, PALETTE.essenceMengGlow);
    expect(glows).toHaveLength(1);
    expect(glows[0]!.parent).toBe(model.parts.body);
  });

  it("jizu（limbs，affinity zu:1）的灵光取 essenceZuGlow 主色——不同精气→不同色", () => {
    const model = makeFakeModel();
    applyOrganVisuals(model, "youshou", organs({ limbs: "jizu" }));
    expect(findMeshesByColor(model.group, PALETTE.essenceZuGlow)).toHaveLength(1);
  });

  it("dispose() 清除灵光网格（同挂件本体一并清理，不残留）", () => {
    const model = makeFakeModel();
    const handle = applyOrganVisuals(model, "youshou", organs({ jaw: "liehe" }));
    expect(findMeshesByColor(model.group, PALETTE.essenceMengGlow)).toHaveLength(1);
    handle.dispose();
    expect(findMeshesByColor(model.group, PALETTE.essenceMengGlow)).toHaveLength(0);
  });
});

describe("applyOrganVisuals — M2 A1「新生器官尚带神辉」30s 窗口", () => {
  it("只有 evolvedSlot 匹配的那个器官会点亮金色光环+流光点，其它已装备器官不受影响", () => {
    const model = makeFakeModel();
    const handle = applyOrganVisuals(model, "youshou", organs({ jaw: "liehe", limbs: "jizu" }));
    const shimmerMeshes = findMeshesByColor(model.group, PALETTE.newOrganShimmer);
    // 每个器官 1 个 halo + 4 个流光点 = 5 个金色网格；两个器官共 10 个。
    expect(shimmerMeshes).toHaveLength(10);

    handle.update(0, "jaw", 5); // jaw 刚蜕变 5s 前
    const lit = shimmerMeshes.filter((m) => (m.material as THREE.MeshBasicMaterial).opacity > 0);
    const unlit = shimmerMeshes.filter((m) => (m.material as THREE.MeshBasicMaterial).opacity === 0);
    expect(lit).toHaveLength(5); // jaw 的 halo+4 spark 点亮
    expect(unlit).toHaveLength(5); // limbs 的完全不亮
  });

  it("30s 之后金色光效完全褪去，即使仍是同一个 evolvedSlot", () => {
    const model = makeFakeModel();
    const handle = applyOrganVisuals(model, "youshou", organs({ jaw: "liehe" }));
    const shimmerMeshes = findMeshesByColor(model.group, PALETTE.newOrganShimmer);

    handle.update(0, "jaw", 29.9);
    expect(shimmerMeshes.some((m) => (m.material as THREE.MeshBasicMaterial).opacity > 0)).toBe(true);

    handle.update(0, "jaw", 30);
    expect(shimmerMeshes.every((m) => (m.material as THREE.MeshBasicMaterial).opacity === 0)).toBe(true);
  });

  it("evolvedSlot 为 null（从未蜕变过/非玩家视图）时金色光效恒不点亮", () => {
    const model = makeFakeModel();
    const handle = applyOrganVisuals(model, "youshou", organs({ jaw: "liehe" }));
    const shimmerMeshes = findMeshesByColor(model.group, PALETTE.newOrganShimmer);
    handle.update(0, null, Infinity);
    expect(shimmerMeshes.every((m) => (m.material as THREE.MeshBasicMaterial).opacity === 0)).toBe(true);
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
