import { describe, expect, it } from "vitest";
import { SPECIES, TUNING } from "@shiling/content";
import { createSim, getPlayer } from "../src/sim.js";

const idle = { moveX: 0, moveZ: 0, sprint: false, interact: false, attack: false, carry: false, dormant: false };

/** 隔离出一个只有玩家的 sim——排除任何 NPC 在测试期间意外改动玩家 hp/needs 的可能。 */
function soloSim(seed: number): ReturnType<typeof createSim> {
  const sim = createSim(seed);
  const p = getPlayer(sim.state);
  sim.state.creatures = sim.state.creatures.filter((c) => c.id === p.id);
  return sim;
}

const maxHp = SPECIES.youshou!.maxHp;
const threshold = maxHp * TUNING.adrenalineHpFrac;
const WINDOW_TICKS = Math.round(TUNING.adrenalineSec * TUNING.tickHz);
const COOLDOWN_TICKS = Math.round(TUNING.adrenalineCooldownSec * TUNING.tickHz);

describe("adrenaline burst (M15 P1 反制包·濒死爆发)", () => {
  it("edge trigger: hp dropping below adrenalineHpFrac×maxHp starts the window and cooldown", () => {
    const sim = soloSim(11);
    const p = getPlayer(sim.state);
    expect(sim.state.adrenalineTicks).toBe(0);
    expect(sim.state.adrenalineCooldown).toBe(0);
    p.hp = threshold - 1; // 明确跌破阈值
    sim.step(idle);
    expect(sim.state.adrenalineTicks).toBe(WINDOW_TICKS);
    expect(sim.state.adrenalineCooldown).toBe(COOLDOWN_TICKS);
  });

  it("does not trigger while hp stays at/above the threshold", () => {
    const sim = soloSim(11);
    const p = getPlayer(sim.state);
    p.hp = threshold + 5;
    sim.step(idle);
    expect(sim.state.adrenalineTicks).toBe(0);
    expect(sim.state.adrenalineCooldown).toBe(0);
  });

  it("speed ×1.3 applies while the window is active", () => {
    const sim = soloSim(11);
    const p = getPlayer(sim.state);
    p.hp = threshold - 1;
    sim.step(idle); // 触发爆发窗口
    expect(sim.state.adrenalineTicks).toBeGreaterThan(0);

    const moveInput = { moveX: 0, moveZ: 1, sprint: false, interact: false, attack: false, carry: false, dormant: false };
    const start = { x: p.pos.x, z: p.pos.z };
    sim.step(moveInput);
    const distWithAdrenaline = Math.hypot(p.pos.x - start.x, p.pos.z - start.z);

    // 复位回同一个起点，关掉爆发窗口后再走同一份输入——同一个 sim、同一起点、同一帧
    // 移动输入，唯一变量是 adrenalineTicks 是否为正，排除"移动到了不同地形"的干扰。
    p.pos.x = start.x;
    p.pos.z = start.z;
    sim.state.adrenalineTicks = 0;
    sim.step(moveInput);
    const distWithoutAdrenaline = Math.hypot(p.pos.x - start.x, p.pos.z - start.z);

    expect(distWithAdrenaline).toBeCloseTo(distWithoutAdrenaline * TUNING.adrenalineSpeedMult, 5);
  });

  it("sprint costs no fatigue while the window is active", () => {
    const sim = soloSim(11);
    const p = getPlayer(sim.state);
    p.hp = threshold - 1;
    p.needs.fatigue = 80;
    sim.step(idle); // 触发
    expect(sim.state.adrenalineTicks).toBeGreaterThan(0);

    const fatigueBefore = p.needs.fatigue;
    sim.step({ moveX: 0, moveZ: 1, sprint: true, interact: false, attack: false, carry: false, dormant: false });
    // 窗口内冲刺：movePlayer 跳过 fatigueSprintPerSec 扣减，只剩 tickNeeds 的"moving"
    // 恢复速率（fatigueWalkRecoverPerSec）——净变化应该是正的（恢复），不是负的（耗损）。
    expect(p.needs.fatigue).toBeGreaterThan(fatigueBefore);
  });

  // code review 修正：窗口内冲刺不该再要求 fatigue>minSprintFatigue 才能拿到
  // sprintMultiplier(1.85x)——玩家几乎总是"刚冲刺逃命、疲劳已经跌到底线时被咬中"这个
  // 顺序触发爆发，若冲刺加速本身仍卡在这道门槛后面，"冲刺不耗疲劳"就只是省了一笔从来
  // 用不上的开销，速度依旧只有裸的 adrenalineSpeedMult(1.3x)。
  it("sprint speed multiplier (1.85x) still engages even at fatigue===0, compounding with adrenalineSpeedMult", () => {
    const sim = soloSim(11);
    const p = getPlayer(sim.state);
    p.hp = threshold - 1;
    p.needs.fatigue = 0; // 现实场景：刚冲刺逃命耗到底线，紧接着这一下命中跌破血量阈值
    sim.step(idle); // 触发
    expect(sim.state.adrenalineTicks).toBeGreaterThan(0);
    expect(p.needs.fatigue).toBeLessThanOrEqual(TUNING.minSprintFatigue); // 确认真的在门槛以下/persisted

    const moveInput = { moveX: 0, moveZ: 1, sprint: true, interact: false, attack: false, carry: false, dormant: false };
    const start = { x: p.pos.x, z: p.pos.z };
    sim.step(moveInput);
    const distWithSprint = Math.hypot(p.pos.x - start.x, p.pos.z - start.z);

    p.pos.x = start.x;
    p.pos.z = start.z;
    p.needs.fatigue = 0; // 复位——上一步的空闲/移动恢复可能已经把疲劳推回门槛线以上
    sim.step({ ...moveInput, sprint: false }); // 同样零疲劳、同样在爆发窗口内，但不冲刺
    const distWithoutSprint = Math.hypot(p.pos.x - start.x, p.pos.z - start.z);

    // 冲刺应该比不冲刺快 sprintMultiplier(1.85x) 倍——若冲刺被疲劳门槛挡住，两者会相等。
    expect(distWithSprint).toBeCloseTo(distWithoutSprint * TUNING.sprintMultiplier, 4);
    expect(distWithSprint).toBeGreaterThan(distWithoutSprint);
  });

  it("sprint costs fatigue normally when no adrenaline window is active (baseline contrast for the test above)", () => {
    const sim = soloSim(11);
    const p = getPlayer(sim.state);
    p.needs.fatigue = 80;
    expect(sim.state.adrenalineTicks).toBe(0); // 从未触发过
    const fatigueBefore = p.needs.fatigue;
    sim.step({ moveX: 0, moveZ: 1, sprint: true, interact: false, attack: false, carry: false, dormant: false });
    expect(p.needs.fatigue).toBeLessThan(fatigueBefore); // 正常冲刺是净耗损
  });

  it("duration: adrenalineTicks counts down to exactly 0 after adrenalineSec worth of ticks", () => {
    const sim = soloSim(11);
    const p = getPlayer(sim.state);
    p.hp = threshold - 1;
    sim.step(idle);
    expect(sim.state.adrenalineTicks).toBe(WINDOW_TICKS);
    for (let i = 0; i < WINDOW_TICKS - 1; i++) sim.step(idle);
    expect(sim.state.adrenalineTicks).toBe(1);
    sim.step(idle);
    expect(sim.state.adrenalineTicks).toBe(0);
  });

  it("no-refire during cooldown: recovering above threshold then dropping below it again does not reset the window while cooldown>0", () => {
    const sim = soloSim(11);
    const p = getPlayer(sim.state);
    p.hp = threshold - 1;
    sim.step(idle); // 第一次触发
    expect(sim.state.adrenalineTicks).toBe(WINDOW_TICKS);
    expect(sim.state.adrenalineCooldown).toBe(COOLDOWN_TICKS);

    for (let i = 0; i < 5; i++) sim.step(idle); // 窗口仍在进行中
    const ticksBeforeDip = sim.state.adrenalineTicks;
    expect(ticksBeforeDip).toBeGreaterThan(0);

    p.hp = maxHp; // 回升到阈值之上——armed 重新置真
    sim.step(idle);
    p.hp = threshold - 1; // 再次跌破——这是一次真正的新边沿（armed=true），但冷却仍未结束
    sim.step(idle);

    // 没有被重触发：adrenalineTicks 应该继续沿着原窗口的轨迹递减，而不是跳回 WINDOW_TICKS。
    expect(sim.state.adrenalineTicks).toBeLessThan(ticksBeforeDip);
    expect(sim.state.adrenalineTicks).not.toBe(WINDOW_TICKS);
    // 冷却倒数本身也没有被重置成满值。
    expect(sim.state.adrenalineCooldown).toBeLessThan(COOLDOWN_TICKS);
  });

  it("after cooldown fully expires, a fresh below-threshold edge triggers a new window", () => {
    const sim = soloSim(11);
    const p = getPlayer(sim.state);
    p.hp = threshold - 1;
    sim.step(idle); // 第一次触发，冷却 COOLDOWN_TICKS
    expect(sim.state.adrenalineCooldown).toBe(COOLDOWN_TICKS);

    p.hp = maxHp; // 回升，避免"仍在阈值下方"导致 armed 一直是 false
    for (let i = 0; i < COOLDOWN_TICKS; i++) sim.step(idle);
    expect(sim.state.adrenalineCooldown).toBe(0);
    expect(sim.state.adrenalineTicks).toBe(0); // 第一次的窗口早就跑完了

    p.hp = threshold - 1; // 一次全新的边沿：hp 刚才在阈值之上、armed=true，现在跌破
    sim.step(idle);
    expect(sim.state.adrenalineTicks).toBe(WINDOW_TICKS); // 重新触发满值窗口
    expect(sim.state.adrenalineCooldown).toBe(COOLDOWN_TICKS);
  });

  // code review 修正：洞中/蛰伏中 hp 跌破阈值不该白白触发一次爆发（movePlayer 对洞中
  // 玩家整体 no-op，窗口期速度加成完全用不上，60 秒冷却却已经扣下）——tickAdrenaline
  // 现在对 p.burrowId!==null 整体早退，armed/ticks/cooldown 冻结在进洞那一刻的取值，
  // 出洞后才继续判定。
  it("does not trigger (and does not waste armed/cooldown) while the player is burrowed, even if hp drops below the threshold", () => {
    const sim = soloSim(11);
    const p = getPlayer(sim.state);
    p.burrowId = 1; // 随便一个洞口 id——soloSim 已经隔离掉其它生物，不需要真实挖洞
    p.locomotion = "burrow";
    p.hp = threshold - 1; // 洞里"跌破阈值"（例如饿死/渴死判定）
    for (let i = 0; i < 10; i++) sim.step(idle);
    expect(sim.state.adrenalineTicks).toBe(0); // 完全没有触发——早退，连 armed 都没被消费
    expect(sim.state.adrenalineCooldown).toBe(0);
    expect(sim.state.adrenalineArmed).toBe(true); // 冻结在进洞前的取值（出生满血，天然为真）

    // 出洞后，hp 仍然很低——这才是玩家真正需要爆发反制的时刻，应该立刻触发一次真正的边沿。
    p.burrowId = null;
    p.locomotion = "walk";
    sim.step(idle);
    expect(sim.state.adrenalineTicks).toBe(WINDOW_TICKS);
    expect(sim.state.adrenalineCooldown).toBe(COOLDOWN_TICKS);
  });

  it("an already-active window/cooldown freezes while burrowed and resumes counting down after exiting", () => {
    const sim = soloSim(11);
    const p = getPlayer(sim.state);
    p.hp = threshold - 1;
    sim.step(idle); // 触发
    expect(sim.state.adrenalineTicks).toBe(WINDOW_TICKS);
    for (let i = 0; i < 5; i++) sim.step(idle);
    const ticksBeforeBurrow = sim.state.adrenalineTicks;
    const cooldownBeforeBurrow = sim.state.adrenalineCooldown;

    p.burrowId = 1;
    p.locomotion = "burrow";
    for (let i = 0; i < 20; i++) sim.step(idle); // 洞里干等——不该继续消耗窗口/冷却
    expect(sim.state.adrenalineTicks).toBe(ticksBeforeBurrow);
    expect(sim.state.adrenalineCooldown).toBe(cooldownBeforeBurrow);

    p.burrowId = null;
    p.locomotion = "walk";
    sim.step(idle); // 出洞后立刻继续倒数
    expect(sim.state.adrenalineTicks).toBe(ticksBeforeBurrow - 1);
    expect(sim.state.adrenalineCooldown).toBe(cooldownBeforeBurrow - 1);
  });

  it("ecology 8 seeds still healthy — headless idle-input runs never touch player hp, so adrenaline never fires (structural sanity)", () => {
    const sim = createSim(2026);
    for (let i = 0; i < TUNING.tickHz * 30; i++) sim.step(idle);
    // 玩家远离所有威胁的默认出生点+idle 输入下不会掉血，爆发不应无端触发；真正的 8-seed
    // 生态不变量由 ecology.test.ts 独立覆盖（本条只确认这批新增字段没有破坏 headless 跑法）。
    expect(sim.state.adrenalineTicks).toBe(0);
  });
});
