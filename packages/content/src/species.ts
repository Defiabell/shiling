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
    meat: 20, senseRadius: 25, attackDamage: 12, attackRange: 1.6, fleeDistance: 30,
  },
  lingshu: {
    id: "lingshu", name: "苓鼠", diet: "herbivore",
    maxHp: 25, walkSpeed: 3.8, swimSpeed: 0, canSwim: false, canDig: false,
    meat: 30, senseRadius: 14, attackDamage: 0, attackRange: 0, fleeDistance: 26,
  },
  tanshou: {
    id: "tanshou", name: "潭狩", diet: "carnivore",
    maxHp: 120, walkSpeed: 5.2, swimSpeed: 4.5, canSwim: true, canDig: false,
    meat: 80, senseRadius: 22, attackDamage: 18, attackRange: 2.2, fleeDistance: 0,
  },
};
