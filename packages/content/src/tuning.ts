/** 全部节奏参数集中于此——试玩调优只改这个文件。 */
export const TUNING = {
  tickHz: 20,
  // 需求值（0..100，100=满）
  hungerDecayPerSec: 0.35,   // 灰盒期加速：约 4.8 分钟耗尽
  thirstDecayPerSec: 0.5,
  // M0.5 postfix-3（狩猎不可行修复）：fatigueSprintPerSec 6→5、sprintMultiplier
  // 1.7→1.85——冲刺更快、耗得更慢，拉长玩家能追猎的窗口。
  fatigueSprintPerSec: 5,
  fatigueRecoverPerSec: 2.5, // 静止或洞中恢复
  fatigueWalkRecoverPerSec: 0.8,
  starveHpPerSec: 1.2,       // 饥/渴归零后掉血
  sprintMultiplier: 1.85,
  minSprintFatigue: 5,        // 疲劳低于此值无法冲刺
  // 进食与饮水
  eatMeatPerSec: 4,          // 每秒从尸体吃掉的肉量
  hungerPerMeat: 1.6,        // 每单位肉回复的饥饿值
  drinkPerSec: 25,
  interactRange: 2.5,        // 交互距离（尸体/水边/挖点）
  // 战斗
  attackCooldownSec: 1.0,
  // 挖洞
  digDurationSec: 4,         // 挖开一个洞口耗时
  burrowFatigueRecoverPerSec: 4,
  // AI
  grazeHungerPerSec: 0.8,    // 苓鼠吃草回复速度（原地 graze）
  aiRepathSec: 2.5,
  predatorEatFromCarcassSec: 20, // 潭狩进食尸体时长（其间不猎杀）
  predatorSatiatedSec: 60,   // 吃饱后的冷却，不主动猎杀
  // M0.5 postfix-3（狩猎不可行修复）：潜行与猎物耐力，见 ai.ts 的 tickLingshu/doFlee。
  grazeDistractionFactor: 0.55, // 吃草时警觉性降低——威胁检测半径 ×此系数，奖励绕后潜近
  fleeFatigueThresholdSec: 5,   // 连续逃跑超过这么久后进入疲态
  fleeFatigueSpeedMult: 0.65,   // 疲态下的逃跑速度倍率
  fleeRecoverSec: 4,            // 回到非 flee 状态需要持续这么久才清空疲态计时
  // M1 postfix N1（叼运/筑巢/储粮）：见 carrying.ts / digging.ts 的筑巢分支。
  carrySpeedMult: 0.75,   // 叼着尸体走路的速度倍率
  nestBuildSec: 12,       // 在已挖开的洞穴里持续按 E 筑巢所需时长
  nestStashCap: 120,      // 巢穴存粮上限（meat 单位，与 Carcass.meat 同一量纲）
  // postfix-9（Part 0，controller ruling on postfix-8 的"储粮进食触达性"待跟进项）：
  // 玩家在自己家巢的洞里休息时自动从 stash 进食，直到 hunger 达到这个上限为止——见
  // eating.ts 的 burrow 分支。95 而不是 100：留一点点"没有完全吃饱"的余地，避免每次
  // 一进洞就立刻在饥饿环顶格卡死不动（同时也让"是否要出门再猎一次"仍然是个真问题）。
  homeNestAutoEatHungerCap: 95,
  // M1 B1（进化系统——见 docs/plans/shiling/2026-08-10-m1-evolution-plan.md）：昼夜时钟与
  // 精气。dayLengthSec/essenceCap 本批（sim.ts 的 timeOfDay 环绕、essence.ts 的 clamp）
  // 就消费；essenceThreshold/dormancyStashCost/dormancySec 是 B3 蛰伏蜕变的触发/消耗参数，
  // 提前一次加齐（避免 B1/B3 分两次动这个文件），本批不读取。
  dayLengthSec: 300,       // 一个完整昼夜循环的秒数（sim.ts 的 timeOfDay += DT/dayLengthSec）
  essenceCap: 200,         // 单类精气上限（essence.ts 的 gainEssence clamp）
  essenceThreshold: 60,    // consumed by B3：蛰伏触发条件之一——任一精气达到此值
  dormancyStashCost: 20,   // consumed by B3：蛰伏触发/维持消耗的 stash 量
  dormancySec: 45,         // consumed by B3：蛰伏持续时长（秒）
} as const;
