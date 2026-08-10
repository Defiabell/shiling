import { describe, expect, it } from "vitest";
import { buildOrganRowContent } from "../src/organPanel.js";
import { ORGAN_PANEL_SLOTS, SLOT_LABELS } from "../src/render/organVisuals.js";

describe("buildOrganRowContent — M1 B5 器官面板行内容", () => {
  it("an empty slot shows null organName and 0 temper", () => {
    const row = buildOrganRowContent("jaw", undefined);
    expect(row.slotLabel).toBe("颌");
    expect(row.organName).toBeNull();
    expect(row.flavor).toBe("");
    expect(row.temperPct).toBe(0);
  });

  it("an equipped slot resolves name/flavor from ORGANS and clamps temper into [0,100]", () => {
    const row = buildOrganRowContent("limbs", { organId: "jizu", temper: 42 });
    expect(row.slotLabel).toBe("肢");
    expect(row.organName).toBe("疾足");
    expect(row.flavor).toBe("食之，其足如风，行不知倦。");
    expect(row.temperPct).toBe(42);
  });

  it("clamps an out-of-range temper defensively (theoretically unreachable via real gameplay)", () => {
    expect(buildOrganRowContent("jaw", { organId: "liehe", temper: 140 }).temperPct).toBe(100);
    expect(buildOrganRowContent("jaw", { organId: "liehe", temper: -5 }).temperPct).toBe(0);
  });

  it("innate (本命) row resolves 神种 correctly, even though it never appears via the B3 roll", () => {
    const row = buildOrganRowContent("innate", { organId: "shenzhong", temper: 50 });
    expect(row.slotLabel).toBe("本命");
    expect(row.organName).toBe("神种");
  });
});

describe("ORGAN_PANEL_SLOTS — 面板行顺序契约", () => {
  it("has exactly 7 rows: six replaceable slots + innate, each with a label", () => {
    expect(ORGAN_PANEL_SLOTS).toHaveLength(7);
    for (const slot of ORGAN_PANEL_SLOTS) {
      expect(SLOT_LABELS[slot]).toBeTruthy();
    }
  });
});
