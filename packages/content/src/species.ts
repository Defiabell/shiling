export type Diet = "herbivore" | "carnivore";

export interface SpeciesDef {
  id: string;
  name: string;       // 中文名，玩家可见
  diet: Diet;
  maxHp: number;
  walkSpeed: number;  // m/s
  swimSpeed: number;  // m/s，canSwim=false 时无效
  canSwim: boolean;
  canDig: boolean;
  meat: number;       // 尸体食物量
  senseRadius: number; // m，发现目标的距离
  attackDamage: number;
  attackRange: number; // m
  fleeDistance: number; // m，逃离到该距离后解除恐慌
}

export const SPECIES: Record<string, SpeciesDef> = {
  youshou: {
    id: "youshou", name: "幼兽", diet: "carnivore",
    maxHp: 60, walkSpeed: 4.5, swimSpeed: 3, canSwim: true, canDig: true,
    // M0.5 postfix-3（狩猎不可行修复）：attackRange 1.6→2.3、attackDamage 12→15——
    // 两口咬死一只苓鼠（25hp/15dmg=2 hits），配合追逃数值收紧后的可行狩猎闭环。
    meat: 20, senseRadius: 25, attackDamage: 15, attackRange: 2.3, fleeDistance: 30,
  },
  lingshu: {
    id: "lingshu", name: "苓鼠", diet: "herbivore",
    // M0.5 postfix-3：senseRadius 14→10（贴近才惊动，给绕后潜近留出空间）、
    // fleeDistance 26→18（脱险阈值同比收紧）。
    // walkSpeed 保留原值 3.8（brief 原定 3.8→3.5，缩小与玩家 4.5 的速度差）——
    // headless ecology 冒烟测试（10 sim-min，seed=2026）验证发现 3.5 会让潭狩
    // 灭绝：lingshu 自身巡游/漂移速度降低会改变它在地图上的随机游走轨迹，与
    // 潭狩独立的巡逻随机游走的相遇概率是蝴蝶效应级敏感——3.8→3.5 这一项单独
    // 就会让两只潭狩在 10 分钟内只撞见一次猎物后再也遇不到，双双饿死
    // （lingshu 种群本身不受影响，稳定在 8~10，问题在潭狩这一侧断粮）。
    // 4.5 vs 3.8 玩家已有稳定速度优势，走位收紧（senseRadius/fleeDistance）
    // 加上 B 段的疲态/分心机制足以支撑可行狩猎，故保留 3.8 换取生态稳定。
    maxHp: 25, walkSpeed: 3.8, swimSpeed: 0, canSwim: false, canDig: false,
    meat: 30, senseRadius: 10, attackDamage: 0, attackRange: 0, fleeDistance: 18,
  },
  tanshou: {
    id: "tanshou", name: "潭狩", diet: "carnivore",
    maxHp: 120, walkSpeed: 5.2, swimSpeed: 4.5, canSwim: true, canDig: false,
    meat: 80, senseRadius: 22, attackDamage: 18, attackRange: 2.2, fleeDistance: 0,
  },
};
