// 全局水墨氛围调色板：天空/雾/光照/地形/生物/UI 全部从这里取色，
// 后续任务只 import PALETTE，不在各处散落十六进制字面量。
export const PALETTE = {
  skyTop: 0x11151c, skyHorizon: 0x3a4656, skyGlow: 0x8a6f4d, // 暮色
  // W2：世界扩大到 480，视距要稍微拉长一点点才不会让雾墙贴脸（配合 main.ts 的
  // 相机 far 500→700），0.0055→0.0045。
  fog: 0x38424f, fogDensity: 0.0045,
  hemiSky: 0x8fa3bf, hemiGround: 0x2e2a24, hemiIntensity: 1.15,
  sunColor: 0xe8b45f, sunIntensity: 1.35, sunPos: [60, 100, 20] as const, // 灯火暖光
  terrainLow: 0x4f5d54, terrainMid: 0x66755f, terrainHigh: 0x8b9784, terrainPeak: 0xc9d2c4,
  terrainShore: 0x3c4a44, slopeInkFactor: 0.35, // 越陡越浓墨
  terrainSwamp: 0x454f34, // W2 地貌分层：沼泽湿度带（贴水低平地）比 terrainShore 更暗的橄榄绿
  waterDeep: 0x1f3340, waterSurface: 0x2e5266, waterOpacity: 0.8,
  playerBody: 0xd98a3d, playerBelly: 0xe8cfa8,
  lingshuBody: 0xddd8c9, lingshuEar: 0xb9917a,
  tanshouBody: 0x5d2a2e, tanshouHead: 0x3d1c20, tanshouEye: 0xd9b23d,
  carcass: 0x6b6259, outlineInk: 0x14161a,
  cinnabar: 0xc23b22, lampWarm: 0xe8b45f, // UI 朱砂/灯火
  scatterGrass: 0x5f7355, scatterRock: 0x6e6f6a, scatterWood: 0x4a3f35, // 地表点缀（Patch 3c）
  scatterSwampReed: 0x5c6b3e, // W2 地貌分层：沼泽芦苇——比 scatterGrass 更黄绿、更暗
} as const;
