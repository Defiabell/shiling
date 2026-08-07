export interface SpawnSpec { species: string; count: number }

export interface WorldParams {
  size: number;         // 世界边长（米），以原点为中心
  cell: number;         // 高度图网格间距（米）
  waterLevel: number;   // 水平面高度
  hillAmp: number;      // 丘陵振幅
  digSpotCount: number; // 可挖点数量
  spawns: SpawnSpec[];
}

// W2（playtest feedback「地图太小、地貌单调」）：size 240→480（同一个 cell=2 网格间距下
// 分辨率仍是 241×241 顶点，够细）、digSpotCount 10→24、spawns 按新面积重新调过密度
// （lingshu 12→26、tanshou 2→4——四则不是简单按 4x 面积等比例放大，见 ecology 冒烟测试后
// 的调优记录：世界面积×4 但种群只放大约 2~2.2x，密度反而下降，靠 senseRadius/aiRepathSec
// 不变的前提下这组数字经过重跑 ecology.test.ts 验证不会灭绝/断粮）。
export const QINGQIU_GRAYBOX: WorldParams = {
  size: 480, cell: 2, waterLevel: -1.5, hillAmp: 9, digSpotCount: 24,
  spawns: [
    { species: "lingshu", count: 26 },
    { species: "tanshou", count: 4 },
  ],
};
