export interface SpawnSpec { species: string; count: number }

export interface WorldParams {
  size: number;         // 世界边长（米），以原点为中心
  cell: number;         // 高度图网格间距（米）
  waterLevel: number;   // 水平面高度
  hillAmp: number;      // 丘陵振幅
  digSpotCount: number; // 可挖点数量
  spawns: SpawnSpec[];
}

export const QINGQIU_GRAYBOX: WorldParams = {
  size: 240, cell: 2, waterLevel: -1.5, hillAmp: 9, digSpotCount: 10,
  spawns: [
    { species: "lingshu", count: 12 },
    { species: "tanshou", count: 2 },
  ],
};
