import { describe, expect, it } from "vitest";
import { TUNING } from "@shiling/content";
import { createSim, getPlayer } from "../src/sim.js";

const idle = { moveX: 0, moveZ: 0, sprint: false, interact: false, attack: false, carry: false, dormant: false };

describe("headless ecology", () => {
  it("runs 10 sim-minutes without collapse or NaN", () => {
    const sim = createSim(2026);
    const p = getPlayer(sim.state);
    p.pos.x = -900; p.pos.z = -900; // 玩家旁观（clamp 到角落）
    p.needs.hunger = 100; p.needs.thirst = 100;
    for (let i = 0; i < TUNING.tickHz * 600; i++) {
      p.needs.hunger = 100; p.needs.thirst = 100; // 旁观者不死
      sim.step(idle);
    }
    for (const c of sim.state.creatures) {
      expect(Number.isFinite(c.pos.x)).toBe(true);
      expect(Number.isFinite(c.pos.y)).toBe(true);
      expect(Number.isFinite(c.pos.z)).toBe(true);
      expect(Math.abs(c.pos.x)).toBeLessThanOrEqual(sim.terrain.size / 2);
    }
    const lingshu = sim.state.creatures.filter((c) => c.species === "lingshu").length;
    expect(lingshu).toBeGreaterThan(0); // 苓鼠没有被灭绝
    expect(sim.state.creatures.some((c) => c.species === "tanshou")).toBe(true);
  });
  it("two sims with same seed and same inputs stay identical", () => {
    const a = createSim(7), b = createSim(7);
    for (let i = 0; i < TUNING.tickHz * 60; i++) { a.step(idle); b.step(idle); }
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
  });

  // M1 B4：扩展不变量——溪鱼(xiyu)/穴獾(xuehuan) 加入后，10 sim-分钟内四个野生物种
  // （lingshu/tanshou/xiyu/xuehuan）均不应灭绝。8 seeds（2026 + 1..7）逐一验证，console.log
  // 打印每个 seed 的最终种群数供批次报告引用（M1 B4 report 消费，见 plan 里的
  // "report survivals; retune spawn counts if needed"）。
  it("extended invariant: xiyu and xuehuan (and the existing two species) do not go extinct across 8 seeds", () => {
    const seeds = [2026, 1, 2, 3, 4, 5, 6, 7];
    for (const seed of seeds) {
      const sim = createSim(seed);
      const p = getPlayer(sim.state);
      p.pos.x = -900; p.pos.z = -900; // 玩家旁观
      p.needs.hunger = 100; p.needs.thirst = 100;
      for (let i = 0; i < TUNING.tickHz * 600; i++) {
        p.needs.hunger = 100; p.needs.thirst = 100;
        sim.step(idle);
      }
      const counts: Record<string, number> = {};
      for (const c of sim.state.creatures) counts[c.species] = (counts[c.species] ?? 0) + 1;
      console.log(`[ecology 8-seed] seed=${seed}`, JSON.stringify(counts));
      for (const c of sim.state.creatures) {
        expect(Number.isFinite(c.pos.x)).toBe(true);
        expect(Number.isFinite(c.pos.y)).toBe(true);
        expect(Number.isFinite(c.pos.z)).toBe(true);
      }
      expect(counts.lingshu ?? 0).toBeGreaterThan(0);
      expect(counts.xiyu ?? 0).toBeGreaterThan(0);
      expect(counts.xuehuan ?? 0).toBeGreaterThan(0);
      expect(counts.tanshou ?? 0).toBeGreaterThan(0);
    }
  });
});
