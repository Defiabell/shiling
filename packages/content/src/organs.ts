import type { EssenceType } from "./species.js";

/**
 * 器官槽位（M1 B2，见 docs/plans/shiling/2026-08-10-m1-evolution-plan.md 数据模型）：
 * 六个可替换槽，每槽两个候选器官（数值见下方 ORGANS 表）。
 */
export type OrganSlot = "jaw" | "limbs" | "back" | "skin" | "tail" | "sense";

/**
 * 器官效果（满淬炼时的效果值，sim/src/organs.ts 的 getModifiers 按 temper 缩放后聚合）。
 * 全部可选：乘子字段默认 1（不生效），加数字段默认 0（不生效）——OrganDef.effects 只需
 * 写出该器官真正拥有的字段，其余留空。
 */
export interface OrganEffects {
  walkSpeedMult?: number;
  swimSpeedMult?: number;
  sprintFatigueMult?: number;
  attackDamageAdd?: number;
  damageTakenMult?: number;
  digSpeedMult?: number;
  eatSpeedMult?: number;
  senseRadiusAdd?: number;
  preyNoticeMult?: number;
}

export interface OrganDef {
  id: string;
  name: string; // 中文名，玩家可见
  /**
   * "innate" 是本命神种专属的第七槽（不在 OrganSlot 六个可替换槽之列，也不参与 B3 的
   * 五因子开奖候选池）——OrganDef.slot 的类型比 OrganSlot 宽一格，就是为了让 shenzhong
   * 这一条数据能落在这里，而不必新开一张表。GameState.organs 的键类型
   * `OrganSlot | "innate"` 与此对应。
   */
  slot: OrganSlot | "innate";
  flavor: string; // 志怪词条：山海经「食之……」句式
  effects: OrganEffects;
  /** 开奖权重（B3 消费，点积）：候选器官所在槽为空/待开奖时，按精气构成加权抽取。 */
  affinity: Partial<Record<EssenceType, number>>;
}

/**
 * M1 器官池：12 个可替换器官（每槽 2 个）＋ 本命「神种」。id 用不带声调的拼音（与
 * SPECIES 的 youshou/lingshu/tanshou 同一命名惯例），name 是玩家可见的中文名。
 * 数值表见 docs/plans/shiling/2026-08-10-m1-evolution-plan.md 的 B2 一节，逐字对应，
 * 未做任何平衡改动。
 */
export const ORGANS: Record<string, OrganDef> = {
  liehe: {
    id: "liehe", name: "裂颌", slot: "jaw",
    flavor: "食之，颌裂如钳，一击必创。",
    effects: { attackDamageAdd: 6 },
    affinity: { meng: 1 },
  },
  lve: {
    id: "lve", name: "滤颚", slot: "jaw",
    flavor: "食之，颚滤如网，啖物倍速。",
    effects: { eatSpeedMult: 1.5 },
    affinity: { zu: 0.5, lin: 0.5 },
  },
  jizu: {
    id: "jizu", name: "疾足", slot: "limbs",
    flavor: "食之，其足如风，行不知倦。",
    effects: { walkSpeedMult: 1.15, sprintFatigueMult: 0.8 },
    affinity: { zu: 1 },
  },
  juezhua: {
    id: "juezhua", name: "掘爪", slot: "limbs",
    flavor: "食之，爪利如凿，穿地成穴。",
    effects: { digSpeedMult: 2, attackDamageAdd: 2 },
    affinity: { xue: 1 },
  },
  linjia: {
    id: "linjia", name: "鳞甲", slot: "back",
    flavor: "食之，鳞坚如甲，刀兵不入。",
    effects: { damageTakenMult: 0.7, walkSpeedMult: 0.95 },
    affinity: { lin: 0.7, meng: 0.3 },
  },
  jibei: {
    id: "jibei", name: "棘背", slot: "back",
    flavor: "食之，背生棘刺，远物皆察。",
    effects: { damageTakenMult: 0.85, senseRadiusAdd: 2 },
    affinity: { meng: 0.6, xue: 0.4 },
  },
  youyupi: {
    id: "youyupi", name: "油羽皮", slot: "skin",
    flavor: "食之，肤泽如油，入水不濡。",
    effects: { swimSpeedMult: 1.3 },
    affinity: { lin: 1 },
  },
  taiwenpi: {
    id: "taiwenpi", name: "苔纹皮", slot: "skin",
    flavor: "食之，皮生苔纹，隐于草莱。",
    effects: { preyNoticeMult: 0.85 },
    affinity: { zu: 0.6, xue: 0.4 },
  },
  qiwei: {
    id: "qiwei", name: "鳍尾", slot: "tail",
    flavor: "食之，尾如鱼鳍，破浪疾行。",
    effects: { swimSpeedMult: 1.25 },
    affinity: { lin: 1 },
  },
  pinghengwei: {
    id: "pinghengwei", name: "平衡尾", slot: "tail",
    flavor: "食之，尾能自衡，奔而不殆。",
    effects: { sprintFatigueMult: 0.85 },
    affinity: { zu: 1 },
  },
  yetong: {
    id: "yetong", name: "夜瞳", slot: "sense",
    flavor: "食之，瞳夜自明，视幽如昼。",
    effects: { senseRadiusAdd: 6 },
    affinity: { meng: 0.5, xue: 0.5 },
  },
  lingxiu: {
    id: "lingxiu", name: "灵嗅", slot: "sense",
    flavor: "食之，鼻通百里，风迹可辨。",
    effects: { senseRadiusAdd: 3, preyNoticeMult: 0.92 },
    affinity: { zu: 0.4, xue: 0.6 },
  },
  /**
   * 本命「神种」：玩家出生自带，装在 "innate" 槽，不可替换（不参与 B3 的开奖/替换逻辑，
   * createSim 里直接预装，temper 初值 50）。affinity 留空——它从不进入五因子开奖的候选池
   * （ORGAN_LIST 已过滤掉它），点积权重对它没有意义。
   */
  shenzhong: {
    id: "shenzhong", name: "神种", slot: "innate",
    flavor: "生而为灵，未食已得；本命所系，行止自若。",
    effects: { walkSpeedMult: 1.05 },
    affinity: {},
  },
};

/**
 * B3 五因子开奖的候选池：12 个可替换器官，不含本命神种（神种预装且不可替换，从不参与
 * 蛰伏蜕变的候选抽取）。顺序即上方数据表的顺序（Object.values 保留插入顺序）。
 */
export const ORGAN_LIST: OrganDef[] = Object.values(ORGANS).filter((o) => o.slot !== "innate");
