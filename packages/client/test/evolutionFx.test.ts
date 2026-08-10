import { describe, expect, it } from "vitest";
import { buildCeremonyContent } from "../src/render/evolutionFx.js";

describe("buildCeremonyContent — M1 B5 揭示卡内容", () => {
  it("looks up name/flavor/slot label for a real organ, no replaced line when replacedId is null", () => {
    const content = buildCeremonyContent({ organId: "liehe", slot: "jaw", replacedId: null });
    expect(content.name).toBe("裂颌");
    expect(content.flavor).toBe("食之，颌裂如钳，一击必创。");
    expect(content.slotLabel).toBe("颌");
    expect(content.replacedName).toBeNull();
  });

  it("resolves the replaced organ's own display name when replacedId is set", () => {
    const content = buildCeremonyContent({ organId: "jizu", slot: "limbs", replacedId: "juezhua" });
    expect(content.name).toBe("疾足");
    expect(content.replacedName).toBe("掘爪");
  });

  it("maps every OrganSlot to its Chinese label correctly", () => {
    expect(buildCeremonyContent({ organId: "linjia", slot: "back", replacedId: null }).slotLabel).toBe("脊背");
    expect(buildCeremonyContent({ organId: "youyupi", slot: "skin", replacedId: null }).slotLabel).toBe("皮膜");
    expect(buildCeremonyContent({ organId: "qiwei", slot: "tail", replacedId: null }).slotLabel).toBe("尾");
    expect(buildCeremonyContent({ organId: "yetong", slot: "sense", replacedId: null }).slotLabel).toBe("窍");
  });

  it("falls back gracefully (does not throw) for an unrecognized organId", () => {
    const content = buildCeremonyContent({ organId: "bogus", slot: "jaw", replacedId: null });
    expect(content.name).toBe("bogus");
    expect(content.flavor).toBe("");
  });
});
