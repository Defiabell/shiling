import { describe, expect, it } from "vitest";
import { ORGANS, SPECIES, TUNING } from "@shiling/content";
import { createSim, getPlayer } from "../src/sim.js";
import { dist2d } from "../src/vec.js";
import { tickAi } from "../src/ai.js";
import { createRng } from "../src/rng.js";
import type { Terrain } from "../src/terrain.js";

const idle = { moveX: 0, moveZ: 0, sprint: false, interact: false, attack: false, carry: false, dormant: false };

describe("lingshu ai", () => {
  it("flees when player is near", () => {
    const sim = createSim(21);
    const p = getPlayer(sim.state);
    const shu = sim.state.creatures.find((c) => c.species === "lingshu")!;
    p.pos = { ...shu.pos }; p.pos.x += 3; // 进入感知圈
    const d0 = dist2d(p.pos, shu.pos);
    for (let i = 0; i < TUNING.tickHz * 3; i++) sim.step(idle);
    expect(shu.aiState).toBe("flee");
    expect(dist2d(p.pos, shu.pos)).toBeGreaterThan(d0);
  });
  it("grazes when hungry and recovers hunger", () => {
    const sim = createSim(21);
    const p = getPlayer(sim.state);
    p.pos.x = -900; p.pos.z = -900; // 玩家挪出感知范围（clamp 到边界也足够远）
    const shu = sim.state.creatures.find((c) => c.species === "lingshu")!;
    shu.needs.hunger = 30;
    for (let i = 0; i < TUNING.tickHz * 8; i++) sim.step(idle);
    expect(shu.needs.hunger).toBeGreaterThan(30);
  });
  it("does not flee from burrowed player", () => {
    const sim = createSim(21);
    const p = getPlayer(sim.state);
    const shu = sim.state.creatures.find((c) => c.species === "lingshu")!;
    p.pos = { ...shu.pos }; p.pos.x += 3;
    p.burrowId = 1; p.locomotion = "burrow";
    sim.step(idle);
    expect(shu.aiState).not.toBe("flee");
  });

  // M0.5 postfix-3（狩猎不可行修复）：graze 分心——吃草时警觉性降低，威胁检测
  // 半径 ×grazeDistractionFactor（0.55）。senseRadius=10 时缩水到 5.5m，7m 落在
  // 5.5~10 之间，理应不触发 flee；拉近到 4m（低于缩水后的阈值）才应该惊动。
  it("graze distraction: eating shrinks the threat-sense radius so a mid-range player goes unnoticed", () => {
    const sim = createSim(21);
    sim.state.creatures = sim.state.creatures.filter((c) => c.species !== "tanshou"); // 隔离潭狩
    const p = getPlayer(sim.state);
    const shu = sim.state.creatures.find((c) => c.species === "lingshu")!;
    shu.aiState = "graze";
    shu.needs.hunger = 50; // 低于 90，饥饿状态机不会把它切回 wander
    p.pos = { ...shu.pos }; p.pos.x += 7; // 7m：介于 10×0.55=5.5 与 10 之间

    for (let i = 0; i < TUNING.tickHz * 2; i++) sim.step(idle);
    expect(shu.aiState).toBe("graze"); // 分心生效：满感知半径本该在 7m 触发 flee，缩水后不会

    p.pos.x = shu.pos.x + 4; // 拉近到 4m，低于缩水后的 5.5m 阈值
    sim.step(idle);
    expect(shu.aiState).toBe("flee"); // 足够近时分心也挡不住，仍会惊动
  });

  // M0.5 postfix-3：逃跑耐力——连续 flee 超过 fleeFatigueThresholdSec 后单 tick
  // 位移应显著小于疲态前（doFlee 按 fleeFatigueSpeedMult=0.65 缩放速度）。直接
  // 摆 fleeTime 隔离测 doFlee 的速度响应，不依赖真实追出 5 秒（省时、确定性更强，
  // 与 predator.test.ts 里直接摆 aiState/targetId 的做法同风格）。
  it("flee speed drops once fleeTime exceeds the fatigue threshold", () => {
    const sim = createSim(21);
    sim.state.creatures = sim.state.creatures.filter((c) => c.species !== "tanshou"); // 隔离潭狩
    const p = getPlayer(sim.state);
    const shu = sim.state.creatures.find((c) => c.species === "lingshu")!;
    p.pos = { ...shu.pos }; p.pos.x += 3; // 进入感知圈，驱动 flee

    shu.aiState = "flee";
    shu.fleeTime = 0;
    const beforeFresh = { ...shu.pos };
    sim.step(idle);
    const freshDist = dist2d(beforeFresh, shu.pos);

    shu.aiState = "flee"; // 保持 flee（此时玩家仍在感知圈内，实际上不设也会自然维持）
    shu.fleeTime = TUNING.fleeFatigueThresholdSec + 0.1; // 已连续逃跑超过阈值
    const beforeFatigued = { ...shu.pos };
    sim.step(idle);
    const fatiguedDist = dist2d(beforeFatigued, shu.pos);

    expect(fatiguedDist).toBeLessThan(freshDist * 0.8); // 显著更慢（理论值 ×0.65）
  });

  // M1 B2：器官接入——装苔纹皮苓鼠更晚惊动。距离取满淬炼后有效半径与裸半径的中点，
  // 两个数值都从 SPECIES/ORGANS 数据算出来，不手写魔法数字——数据表改动时这条测试
  // 会跟着数据一起变，不会变成"断言的是过期的常量"。
  it("organ modifier: preyNoticeMult delays lingshu noticing the player wearing full-temper taiwenpi (装苔纹皮苓鼠更晚惊动)", () => {
    const rawSenseRadius = SPECIES.lingshu!.senseRadius;
    // temper=100 时 scale=1.0，effective 恰好等于表里的满淬炼值——直接读表，不重复写一遍 0.85。
    const fullTemperPreyNoticeMult = ORGANS.taiwenpi!.effects.preyNoticeMult!;
    const midDist = (rawSenseRadius + rawSenseRadius * fullTemperPreyNoticeMult) / 2; // 落在"缩水后半径"与"裸半径"之间

    function place(sim: ReturnType<typeof createSim>, dist: number) {
      sim.state.creatures = sim.state.creatures.filter((c) => c.species !== "tanshou"); // 隔离
      const p = getPlayer(sim.state);
      const shu = sim.state.creatures.find((c) => c.species === "lingshu")!;
      p.pos = { ...shu.pos }; p.pos.x += dist;
      return { p, shu };
    }

    const baseline = createSim(21);
    const { shu: shuBaseline } = place(baseline, midDist);
    baseline.step(idle);
    expect(shuBaseline.aiState).toBe("flee"); // 无器官：midDist < 裸半径，正常惊动

    const sim = createSim(21);
    sim.state.organs.skin = { organId: "taiwenpi", temper: 100 };
    const { shu } = place(sim, midDist);
    sim.step(idle);
    expect(shu.aiState).not.toBe("flee"); // 满淬炼苔纹皮：有效半径缩到裸半径以下，midDist 未被惊动
  });
});

// M1 B4：溪鱼 xiyu 复用 tickFleeingHerbivore（species-generic，见 ai.ts 头部注释）——本节
// 只补一条水生锁定专属的行为断言（"苓鼠行为不变"这条 regression 由上面整块既有测试原样
// 跑通即证明，不需要为它专门再写一份）。
describe("xiyu (溪鱼) aquatic AI", () => {
  it("flees when a threat (player) approaches, but never leaves the water (aquatic lock holds under AI control too)", () => {
    const sim = createSim(21);
    sim.state.creatures = sim.state.creatures.filter((c) => c.species === "youshou" || c.species === "xiyu");
    const p = getPlayer(sim.state);
    const fish = sim.state.creatures.find((c) => c.species === "xiyu")!;
    expect(sim.terrain.isWater(fish.pos.x, fish.pos.z)).toBe(true);
    p.pos = { ...fish.pos }; p.pos.x += 3; // 进入 senseRadius(8)

    let sawFlee = false;
    for (let i = 0; i < TUNING.tickHz * 3; i++) {
      sim.step(idle);
      // 每一步都必须仍在水里——doFlee/doWander 交给 moveCreature 的地形挡行判定
      // （isTerrainBlocked 的水生镜像）是唯一的强制手段，AI 本身不知道"我是不是鱼"。
      expect(sim.terrain.isWater(fish.pos.x, fish.pos.z)).toBe(true);
      if (fish.aiState === "flee") sawFlee = true;
    }
    expect(sawFlee).toBe(true);
  });
});

// M1 B4：穴獾 xuehuan 专属的 tickBurrowEvader（遁地 channel→隐匿→重现）。
describe("xuehuan (穴獾) burrow-evasion AI", () => {
  const CHANNEL_TICKS = Math.round(TUNING.xuehuanChannelSec * TUNING.tickHz);
  const HIDDEN_TICKS = Math.round(TUNING.xuehuanHiddenSec * TUNING.tickHz);

  /** 隔离到玩家+穴獾，排除其它物种的 AI/rng 消费干扰。 */
  function isolateToBadger(sim: ReturnType<typeof createSim>) {
    sim.state.creatures = sim.state.creatures.filter((c) => c.species === "youshou" || c.species === "xuehuan");
  }

  it("channels for xuehuanChannelSec once a threat enters senseRadius, then transitions into hiding", () => {
    const sim = createSim(21);
    isolateToBadger(sim);
    const p = getPlayer(sim.state);
    const badger = sim.state.creatures.find((c) => c.species === "xuehuan")!;
    p.pos = { ...badger.pos }; p.pos.x += 5; // 进入 senseRadius(12)

    sim.step(idle);
    expect(badger.aiState).toBe("channel");
    expect(badger.activity).toBe("digging");
    expect(badger.hiddenTicks).toBe(0);

    for (let i = 1; i < CHANNEL_TICKS; i++) {
      sim.step(idle);
      expect(badger.aiState).toBe("channel"); // channel 未提前完成
      expect(badger.hiddenTicks).toBe(0);
    }
    sim.step(idle); // 最后一 tick：channel 完成，转入隐匿
    expect(badger.hiddenTicks).toBeGreaterThan(0);
    expect(badger.activity).toBe("idle");
  });

  it("stays hidden for xuehuanHiddenSec, then reappears ~8m from the vanish point and resumes wandering (deterministic)", () => {
    function runCycle(seed: number) {
      const sim = createSim(seed);
      isolateToBadger(sim);
      const p = getPlayer(sim.state);
      const badger = sim.state.creatures.find((c) => c.species === "xuehuan")!;
      p.pos = { ...badger.pos }; p.pos.x += 5;
      const vanishPos = { ...badger.pos };

      // CHANNEL_TICKS+1：触发 tick 本身不消耗 aiTimer（只是设定 1.2s 起点），随后
      // 需要 CHANNEL_TICKS 次 -= DT 才能把它降到 <=0——与上面那条 channel 测试用的
      // 是同一个 +1 换算，不是两处各自拍的魔法数字。
      for (let i = 0; i < CHANNEL_TICKS + 1; i++) sim.step(idle);
      expect(badger.hiddenTicks).toBeGreaterThan(0);

      for (let i = 0; i < HIDDEN_TICKS - 1; i++) {
        sim.step(idle);
        expect(badger.hiddenTicks).toBeGreaterThan(0); // 隐匿期间不提前重现
      }
      sim.step(idle); // 倒数最后一 tick：重现
      return { badger, vanishPos };
    }

    const a = runCycle(21);
    expect(a.badger.hiddenTicks).toBe(0);
    expect(a.badger.aiState).toBe("wander");
    expect(a.badger.activity).toBe("idle");
    expect(a.badger.locomotion).toBe("walk");
    expect(dist2d(a.vanishPos, a.badger.pos)).toBeCloseTo(TUNING.xuehuanReappearDist, 3);

    // 确定性：同 seed、同输入序列，重现到完全一致的位置——同 seed 同 roll 同一套纪律。
    const b = runCycle(21);
    expect(b.badger.pos).toEqual(a.badger.pos);
  });

  it("dying mid-channel (killed by the player) follows the normal death path — channel provides no special protection", () => {
    const sim = createSim(21);
    isolateToBadger(sim);
    const p = getPlayer(sim.state);
    const badger = sim.state.creatures.find((c) => c.species === "xuehuan")!;
    const atk = SPECIES.youshou!;
    p.pos = { ...badger.pos }; p.pos.x += atk.attackRange - 0.1; // 攻击距离内，同时也在 senseRadius(12) 内
    expect(SPECIES.xuehuan!.maxHp).toBe(atk.attackDamage * 2); // 两下打死，两下都落在 channel(24 tick) 窗口内

    // 第 1 tick：命中（cooldown 起始为 0）+ 感知到威胁转入 channel（tickEating 排在 tickAi 之前）。
    sim.step({ ...idle, attack: true });
    expect(badger.hp).toBeCloseTo(SPECIES.xuehuan!.maxHp - atk.attackDamage, 6);
    expect(badger.aiState).toBe("channel");

    // 冷却 attackCooldownSec=1.0s=20 tick，第 21 次 step 时冷却正好耗尽，第二刀落地——
    // 仍在 channel 窗口（CHANNEL_TICKS=24）内，验证"打断 channel 唯一手段是打死它"。
    for (let i = 0; i < 20; i++) sim.step({ ...idle, attack: true });

    expect(badger.hp).toBeLessThanOrEqual(0);
    expect(badger.activity).toBe("dead");
    expect(badger.hiddenTicks).toBe(0); // 从未进入隐匿——正常死亡，不是遁地
    expect(sim.state.creatures.some((c) => c.id === badger.id)).toBe(false); // killCreature 已将其移出 creatures[]
    expect(sim.state.carcasses.some((c) => c.id === badger.id)).toBe(true); // 留下一具正常尸体
  });

  it("a hidden xuehuan is excluded from the player's attack scan (findAttackTarget)", () => {
    const sim = createSim(21);
    isolateToBadger(sim);
    const p = getPlayer(sim.state);
    const badger = sim.state.creatures.find((c) => c.species === "xuehuan")!;
    p.pos = { ...badger.pos }; p.pos.x += 0.1; // 贴脸距离，正常情况下必中
    badger.hiddenTicks = 40; // 手动构造"隐匿中"
    const hpBefore = badger.hp;
    sim.step({ ...idle, attack: true });
    expect(badger.hp).toBe(hpBefore); // 摸不到——隐匿排除了它作为攻击目标
  });

  it("a hidden xuehuan is excluded from tanshou's prey scan (nearestPrey)", () => {
    const sim = createSim(21);
    sim.state.creatures = sim.state.creatures.filter((c) => c.species === "tanshou" || c.species === "xuehuan");
    const tan = sim.state.creatures.find((c) => c.species === "tanshou")!;
    const badger = sim.state.creatures.find((c) => c.species === "xuehuan")!;
    tan.pos = { ...badger.pos }; tan.pos.x += 3; // 进入潭狩 senseRadius(22)
    badger.hiddenTicks = 40; // 手动构造"隐匿中"
    sim.step(idle);
    expect(tan.aiState).toBe("patrol"); // 未被选为目标——隐匿期间对捕食者也不可见
    expect(tan.targetId).toBeNull();
  });

  // M15 P2 rider（P1 报告「未确认」一节标注的预先存在 bug，Playwright 长会话里已经真实
  // 复现两次——见 m15-p1-report.md）：randomLandPosNear 的 rejection-sample 在病态地形
  // 下会耗尽 REAPPEAR_MAX_ATTEMPTS 次仍找不到陆地点。用一个"处处是水"的假 Terrain 直接
  // 驱动 tickAi（绕开 sim.step，不依赖真实地图恰好有这样一块被水包围的孤岛/半岛，
  // 100% 确定性复现"badger surrounded by water"），验证不再抛异常崩溃整个 tick 循环，
  // 而是先有界重试（每次多隐藏 1 秒）、耗尽后原地兜底重现。
  it("reappear stall fallback: an all-water pathological terrain never throws — bounded retries then reappears in place", () => {
    const sim = createSim(21);
    isolateToBadger(sim);
    const p = getPlayer(sim.state);
    const badger = sim.state.creatures.find((c) => c.species === "xuehuan")!;
    p.pos = { ...badger.pos }; p.pos.x += 5; // 进入 senseRadius(12)，触发 channel
    const vanishPos = { ...badger.pos };

    // 病态地形：heightAt 恒低于 waterLevel——8m 半径圆环上任何角度采样都是水，
    // randomLandPosNear 保证每一轮都耗尽 1000 次尝试后返回 null。digSpots 留空，
    // 本测试不涉及挖点。terrain.size/waterLevel 沿用真实 sim.terrain 的量级，
    // 只替换 heightAt/isWater 两个判定函数。
    const allWaterTerrain: Terrain = {
      size: sim.terrain.size,
      waterLevel: sim.terrain.waterLevel,
      digSpots: [],
      heightAt: () => sim.terrain.waterLevel - 1,
      isWater: () => true,
    };
    const rng = createRng(7); // 与 sim 内部 rng 无关——直接调 tickAi，绕开 sim.step

    // 有界安全阀：channel(24 tick)+hidden(80 tick)+3 次耗尽重试(各 20 tick)≈164 tick，
    // 1000 留足余量而不是真的"无限循环等它恢复"——一旦 hidden→wander 的转场发生就立即
    // break，不依赖这个上限本身当断言。
    let prevAiState = badger.aiState;
    let recovered = false;
    expect(() => {
      for (let i = 0; i < 1000 && !recovered; i++) {
        tickAi(sim.state, allWaterTerrain, rng);
        if (prevAiState === "hidden" && badger.aiState === "wander") recovered = true;
        prevAiState = badger.aiState;
      }
    }).not.toThrow();

    expect(recovered).toBe(true);
    expect(badger.hiddenTicks).toBe(0);
    expect(badger.activity).toBe("idle");
    expect(badger.locomotion).toBe("walk");
    expect(badger.reappearStallCount).toBe(0); // 耗尽兜底成功后清零，不是跨周期累积
    // 原地重现：channel/隐匿期间从不移动，兜底刻意保留 x/z 不变（见 ai.ts reappear() 头注）。
    expect(badger.pos.x).toBeCloseTo(vanishPos.x, 9);
    expect(badger.pos.z).toBeCloseTo(vanishPos.z, 9);
  });
});
