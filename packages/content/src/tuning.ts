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
  // M1 B2（器官系统——见上面 B1 同一份计划文档的 B2 一节）：temper（淬炼度）缩放公式与
  // 用进增长速率。全部节奏参数集中在这里，sim/src/organs.ts 的 getModifiers/tickTemper
  // 只读不改字面量。
  temperScaleBase: 0.6,    // effective = 1+(v-1)*(temperScaleBase+temperScaleSpan*t/100)（乘子）
  temperScaleSpan: 0.4,    // 或 v*(temperScaleBase+temperScaleSpan*t/100)（加数），t=temper(0..100)
  temperGainPerSecUse: 0.35, // 持续使用类效果（swim/sprint/eat）每秒 temper 增量
  temperGainKill: 6,         // jaw 系（attackDamageAdd）器官：玩家亲手击杀时的一次性增量
  temperGainDigComplete: 8,  // limbs 系（digSpeedMult）器官：挖洞完成时的一次性增量
  temperGainHitTaken: 3,     // back 系（damageTakenMult）器官：玩家被直接命中时的一次性增量
  temperGainPassivePerSec: 0.05, // sense/prey 系（senseRadiusAdd/preyNoticeMult）被动缓慢增长速率
  // M1 B3（蛰伏蜕变——见上面同一份计划文档的 B3 一节）：五因子开奖的槽位惩罚，与蛰伏期间
  // 由储粮供给的加速代谢倍率。全部节奏参数集中在这里，sim/src/dormancy.ts 只读不改字面量。
  rollOccupiedSlotPenalty: 0.3, // 候选器官所在槽已被占用时的权重折扣（鼓励换槽而非刷同槽）
  dormancyHungerDecayMult: 1.5, // 蛰伏期间饥饿衰减倍率（相对 hungerDecayPerSec 的基础 1x）
  // Part 0（B3 controller ruling，B4 批次一并落地）：蛰伏触发新增第四条件——thirst 必须
  // 先饮足到这个地板值。蛰伏 45 秒期间口渴不受任何补偿（feedFromStash 只补饥饿，见
  // dormancy.ts 头部关于这个已知设计缺口的讨论），这个地板防止玩家在自己巢穴里蛰伏
  // 睡到渴死——寓意"蛰伏前必须饮足"，不是修复口渴衰减本身。
  dormancyThirstMin: 40,
  // M1 B4（新物种——溪鱼/穴獾）：穴獾遁地逃脱节奏，见 sim/src/ai.ts 的 tickBurrowEvader。
  xuehuanChannelSec: 1.2, // 「遁地」channel 时长——期间原地不动、activity="digging"，可被击杀打断（正常死亡，非特殊打断逻辑）
  xuehuanHiddenSec: 4, // 隐匿倒数——期间从渲染与目标选择中排除（Creature.hiddenTicks）
  xuehuanReappearDist: 8, // 隐匿结束后重现的距离（米）——固定半径、随机角度，见 ai.ts 的 randomLandPosNear

  // M15 P1（反制包——见 docs/plans/shiling 对应计划）：陷坑，见 sim/src/digging.ts 的
  // pit-dig 分支与 sim/src/pits.ts。
  pitDigSec: 3,          // 在开阔地（非挖点/非水边/非尸体旁）持续按住 E 挖好一个陷坑所需时长
  maxPits: 3,            // 同时存活的陷坑上限——挖第 4 个会移除最旧的一个（先进先出）
  pitSnareSec: 3,        // 潭狩踩中陷坑后定身的时长
  pitTriggerRadius: 0.9, // 潭狩与陷坑中心的触发距离（米）
  pitPromptRadius: 35,   // HUD「E 挖陷坑」提示只在潭狩进入这个半径时才显示，避免提示常驻噪音
  pitDigFatigueDrainMult: 2, // 挖陷坑期间的疲劳净耗损＝此倍数×fatigueWalkRecoverPerSec（见 digging.ts）

  // M15 P1：濒死爆发，见 sim/src/adrenaline.ts。
  adrenalineHpFrac: 0.3,     // hp 跌破 maxHp×此比例的那一刻触发（真正的边沿，非电平判定）
  adrenalineSpeedMult: 1.3,  // 触发窗口内整体移动速度倍率（不论是否在冲刺）
  adrenalineSec: 4,          // 触发窗口时长——期间冲刺不消耗疲劳
  adrenalineCooldownSec: 60, // 冷却时长，期间即使 hp 再次跌破阈值也不会重触发

  // M15 P1：棘背威慑，见 sim/src/ai.ts 的 resolveHunt。
  spineDeterrenceMult: 0.65, // 目标玩家装备棘背(jibei)时，潭狩的放弃追猎距离(senseRadius×1.5)再乘此系数
} as const;
