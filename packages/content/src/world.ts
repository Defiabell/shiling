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
// M1 B4（新物种——溪鱼/穴獾）：xiyu 10、xuehuan 8——8-seed ecology 重跑验证过这组密度
// 不会让两个新物种灭绝（见 ecology.test.ts），也未观察到 tanshou 因为多了一种可猎物种
// 而对 lingshu 的捕食压力发生显著转移（tanshou 现在也会游泳猎鱼，但 lingshu 种群规模
// 稳定在既有区间，未重新调过 lingshu/tanshou 的既有密度）。
// M15 P4（owner playtest feedback「洞太稀，被追上前挖不完」）：digSpotCount 24→44——
// 逃生窗口（潭狩追近时能否就近找到一个挖点）主要靠密度，不是靠单个洞挖得多快（那个另见
// tuning.ts 的 digDurationSec 4→3），两处一起改才是完整修复。未重跑 ecology 8-seed 之外
// 的密度调优——digSpots 是纯地形层对象，不参与 ai.ts 的任何捕食/生存判定，因此不会改变
// lingshu/tanshou/xiyu/xuehuan 的种群曲线（见 ecology.test.ts 的 8-seed 灭绝检查）。
export const QINGQIU_GRAYBOX: WorldParams = {
  size: 480, cell: 2, waterLevel: -1.5, hillAmp: 9, digSpotCount: 44,
  spawns: [
    { species: "lingshu", count: 26 },
    { species: "tanshou", count: 4 },
    { species: "xiyu", count: 10 },
    { species: "xuehuan", count: 8 },
  ],
};
