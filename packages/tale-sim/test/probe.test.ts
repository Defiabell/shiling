import { describe, expect, it } from "vitest";
import { clashOf, combatAct, createLife } from "../src/index.js";
import { ENEMY_QIONG_QI, FIXTURE_CONTENT, FIXTURE_SEED_ID, contentWithoutEvents, enterCombat } from "./fixtures.js";

describe("probe", () => {
  it("stage", () => {
    const staged = FIXTURE_CONTENT.enemies.map((e) =>
      e.id === ENEMY_QIONG_QI
        ? { ...e, hp: 100, intentBias: { pounce: 0, bite: 0, guard: 1, flee: 0 },
            stages: [{ at: 1, name: "A", text: "" }, { at: 0.5, name: "B", text: "变了" }] }
        : e,
    );
    const content = contentWithoutEvents({ tuning: { combatDamageJitter: 0 }, enemies: staged });
    let s = enterCombat(createLife(1, FIXTURE_SEED_ID, content), ENEMY_QIONG_QI, content, {
      enemyHp: 60, guardPart: "eye", intent: { kind: "guard", text: "守。" },
    });
    for (let i = 0; i < 4; i += 1) {
      const t = combatAct(s, { kind: "bite", part: "throat" }, content);
      s = t.state;
      console.log("hp", clashOf(s)?.enemyHp, "stage", s.encounter?.stage, "enemyHpDef", content.enemies.find(e=>e.id===ENEMY_QIONG_QI)?.hp);
    }
    expect(true).toBe(true);
  });
});
