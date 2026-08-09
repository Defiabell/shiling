export type Diet = "herbivore" | "carnivore";

/** 精气类型（M1 进化系统，见 docs/plans/shiling/2026-08-10-m1-evolution-plan.md 数据模型）：足/鳞/穴/猛。 */
export type EssenceType = "zu" | "lin" | "xue" | "meng";

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
  /** 该物种鲜尸被吃时喂养的精气类型（M1 B1，sim/src/essence.ts 的 gainEssence 消费）。 */
  essenceType: EssenceType;
  /** 每单位 meat 吃到嘴里换算的精气量（M1 B1）；现有三物种统一 0.5 占位，无特殊平衡诉求。 */
  essenceYieldPerMeat: number;
  /**
   * 水生锁定（M1 B4，溪鱼 xiyu 专属，其余物种恒 false）：与 canSwim=false 的挡水守卫互为
   * 镜像——canSwim=false 是"旱鸭子不能下水"，aquatic=true 是反过来"离不开水"（陆地对它
   * 是墙）。sim/src/movement.ts 的 isTerrainBlocked 是唯一的判定入口，spawnCreature 也据此
   * 选择 randomWaterPos 而非 randomLandPos 作为出生点采样源（见 sim.ts）。
   */
  aquatic: boolean;
}

export const SPECIES: Record<string, SpeciesDef> = {
  youshou: {
    id: "youshou", name: "幼兽", diet: "carnivore",
    maxHp: 60, walkSpeed: 4.5, swimSpeed: 3, canSwim: true, canDig: true,
    // M0.5 postfix-3（狩猎不可行修复）：attackRange 1.6→2.3、attackDamage 12→15——
    // 两口咬死一只苓鼠（25hp/15dmg=2 hits），配合追逃数值收紧后的可行狩猎闭环。
    meat: 20, senseRadius: 25, attackDamage: 15, attackRange: 2.3, fleeDistance: 30,
    // M1 B1：youshou 是玩家物种，正常玩法里不会被吃（没有"吃玩家鲜尸获得精气"这个
    // 场景），essenceType/essenceYieldPerMeat 纯占位——给个和其它物种一致的默认值
    // （zu/0.5），只是为了让 SpeciesDef 字段全物种齐整，不代表任何平衡设计意图。
    essenceType: "zu", essenceYieldPerMeat: 0.5, aquatic: false,
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
    // M1 B1：苓鼠是地面食草兽，喂"足"精——名字本身就是"善走"的志怪意象来源。
    essenceType: "zu", essenceYieldPerMeat: 0.5, aquatic: false,
  },
  tanshou: {
    id: "tanshou", name: "潭狩", diet: "carnivore",
    maxHp: 120, walkSpeed: 5.2, swimSpeed: 4.5, canSwim: true, canDig: false,
    meat: 80, senseRadius: 22, attackDamage: 18, attackRange: 2.2, fleeDistance: 0,
    // M1 B1：潭狩凶猛掠食者，喂"猛"精。
    essenceType: "meng", essenceYieldPerMeat: 0.5, aquatic: false,
  },
  // M1 B4（新物种）：溪鱼 xiyu——水生猎物，essence lin（鳞）。水生锁定
  // （aquatic=true，见 SpeciesDef.aquatic 字段注释）：walkSpeed=0 是刻意的，不是遗漏——
  // 陆地对它是墙（moveCreature/isTerrainBlocked 的镜像挡水守卫），从来不会真正用到
  // walkSpeed 这个数值，写 0 只是让"离开水就完全无法移动"这件事在数据层面也读得出来。
  // 无攻击手段（attackDamage/attackRange=0，与苓鼠同一惯例）：被潭狩（会游泳）与玩家
  // 捕食，见 ai.ts tickFleeingHerbivore（复用苓鼠机器，水生锁定由地形判定本身处理，
  // 不需要机器内部感知"我是不是鱼"）。
  xiyu: {
    id: "xiyu", name: "溪鱼", diet: "herbivore",
    maxHp: 10, walkSpeed: 0, swimSpeed: 3.2, canSwim: true, canDig: false,
    meat: 15, senseRadius: 8, attackDamage: 0, attackRange: 0, fleeDistance: 14,
    essenceType: "lin", essenceYieldPerMeat: 0.5, aquatic: true,
  },
  // M1 B4（新物种）：穴獾 xuehuan——地面猎物，essence xue（穴）。不与苓鼠共用"flee"
  // 逃跑策略——受惊后走 ai.ts 专属的 tickBurrowEvader（遁地 channel→隐匿→重现），
  // fleeDistance 字段仍按 plan 数值写全（SpeciesDef 要求全字段齐整），但 tickBurrowEvader
  // 不消费它——威胁判定只看 senseRadius，逃脱手段是钻地不是拉开距离。
  xuehuan: {
    id: "xuehuan", name: "穴獾", diet: "herbivore",
    maxHp: 30, walkSpeed: 3.2, swimSpeed: 0, canSwim: false, canDig: true,
    meat: 35, senseRadius: 12, attackDamage: 0, attackRange: 0, fleeDistance: 20,
    essenceType: "xue", essenceYieldPerMeat: 0.5, aquatic: false,
  },
};
