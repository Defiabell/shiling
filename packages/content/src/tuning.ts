/** 全部节奏参数集中于此——试玩调优只改这个文件。 */
export const TUNING = {
  tickHz: 20,
  // 需求值（0..100，100=满）
  hungerDecayPerSec: 0.35,   // 灰盒期加速：约 4.8 分钟耗尽
  thirstDecayPerSec: 0.5,
  fatigueSprintPerSec: 6,
  fatigueRecoverPerSec: 2.5, // 静止或洞中恢复
  fatigueWalkRecoverPerSec: 0.8,
  starveHpPerSec: 1.2,       // 饥/渴归零后掉血
  sprintMultiplier: 1.7,
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
} as const;
