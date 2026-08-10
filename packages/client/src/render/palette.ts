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
  // M1 B4（新物种，程序化 fallback 模型用——见 creatureModels.ts buildXiyuModel/buildXuehuanModel）：
  xiyuBody: 0x3f8f8a, xiyuFin: 0xbfe8e0, // 溪鱼：银青鳞身、浅青尾鳍（teal，plan 原话"银青"配色）
  xuehuanBody: 0x6b4a30, xuehuanClaw: 0x2e2018, // 穴獾：土褐皮毛、深褐爪（earth，plan 原话"earth-brown"）
  // M1 B5（器官可视化——见 2026-08-10-m1-evolution-plan.md B5 一节，organVisuals.ts 消费）：
  // 12 个可替换器官各自的挂件/材质微调色，按 ORGANS 表同一顺序分组，一处集中改色。
  organFang: 0xe8e2d4, // 裂颌·獠牙锥：骨白
  organFilter: 0xc9c2a8, // 滤颚·滤颚片（B5 补完 plan 未列出的这一件，见 organVisuals.ts 头注）：暗骨黄
  organLimbRing: 0xe8b45f, // 疾足·腕环：暖光，呼应"轻盈迅捷"
  organClaw: 0x3a2e22, // 掘爪·爪锥：深褐土色
  organScale: 0x8fae9c, // 鳞甲·背瓦：冷青灰
  organSpike: 0x5a4a42, // 棘背·背棘锥：深赭
  organGloss: 0xbfe0ea, // 油羽皮·材质光泽 tweak 用的 emissive 色：极淡水光青白
  organMossPatch: 0x4a7a4a, // 苔纹皮·斑片：苔绿
  organFin: 0x7fc4d8, // 鳍尾·鳍片：水青
  organTailOrb: 0xc9a06a, // 平衡尾·端球：土褐（与精气"穴"色同相，呼应"稳"）
  organEyeGlow: 0x9fd8ff, // 夜瞳·发光眼点：冷蓝光
  organNoseGlow: 0xe8c88a, // 灵嗅·鼻光点：暖金光
  // M15 P2（引导链＋巢穴存在感——家巢视觉升级，见 terrainMesh.ts 的 buildHomeNestVisual/
  // buildDugVisual）：土丘/骨堆/枯草三件套的专用色，与既有 scatter*/organ* 色相区分——
  // 这三种读法（"新翻的土""风干的骨头""枯萎的草"）都不该借用任何已有语义的颜色。
  nestMoundEarth: 0x5c4630, // 土丘——新翻浮土，比 scatterWood(0x4a3f35) 更暖更红一档
  nestBoneWhite: 0xd8cfb8, // 骨堆——风吹日晒的骨白，比 organFang(0xe8e2d4，佩戴的器官挂件) 压暗一档，区分"地面散落"与"戴在身上"
  digRimGrassDry: 0x6b6650, // 普通挖点的枯草描边——比家巢草垫(scatterGrass 0x5f7355) 更黄更暗，读作"没人打理的野草"
  // M15 P3（山海经地形与地标——owner feedback「地形太简单，不符合山海经的背景」）：
  // 险峰山地区调色 + 志怪地标（landmarks.ts）专用色，与既有 scatter*/nest* 色相
  // 区分——这几种读法（"崖石""虬曲古木""上古巨兽遗骸""发光灵芝""灵泉光晕"）都不该
  // 借用任何已有语义的颜色。
  mountainRock: 0x565a54,      // 山地区地形色（terrainMesh.ts 的 mask 混合）——比 terrainHigh(0x8b9784) 更冷更灰，读作"裸露崖石"
  mountainPeakSnow: 0xe4e8e2,  // 山地区峰顶留白——比 terrainPeak(0xc9d2c4) 更亮更冷，"崖线之上，白留"
  landmarkTreeTrunk: 0x362a1c,   // 古树——虬曲树干，比 scatterWood(0x4a3f35) 更深更冷一档，读作"年迈枯朽"
  landmarkTreeFoliage: 0x2c3826, // 古树——深色叶簇，比 scatterGrass 更暗更蓝一档，读作"阴翳"
  landmarkStoneRing: 0x74766d,   // 巨石阵——立石本体，比 scatterRock(0x6e6f6a) 更亮一档，"巨石"要比路边碎石更显眼
  landmarkBoneWhite: 0xe2dac2,   // 白骨——上古巨兽遗骸，比 nestBoneWhite(0xd8cfb8，散落小骨) 更亮一档，呼应"巨大"的读法（风化巨骨反而更白）
  landmarkMushroomCap: 0x3d6b5c,  // 发光灵芝——伞盖本体（未受光基色）
  landmarkMushroomGlow: 0x6fe8b8, // 发光灵芝——emissive/加色贴图发光色，青绿灵光
  springGlowRing: 0x7fd4e8,       // 灵泉——水面光环+上浮的灵光颗粒，冷青色（呼应 minimap.ts cardGlow 同一色相）
  // M2 A1（生物动效灵体化——器官灵光，见 organVisuals.ts 的四精气色映射）：每个已装备
  // 器官挂点上那层薄加色光晕的基色，按 organ.affinity 里权重最高的精气类型选取。
  // 与 organ* 系列（挂件本体材质色）刻意区分——灵光是叠加在挂件之上的独立氛围层，不是
  // 挂件颜色本身。
  essenceZuGlow: 0xe8b45f,   // 足·暖橙金
  essenceLinGlow: 0x6fd8e8,  // 鳞·青蓝
  essenceXueGlow: 0x9a7a4a,  // 穴·土棕
  essenceMengGlow: 0xd9432a, // 猛·赤朱
  newOrganShimmer: 0xf5e2a0, // 新生器官尚带神辉（蜕变后 30s 内）——比任一精气色都更亮更金的统一强调色
  // M2 A2（Meshy 山海经布景——owner feedback「布景劣质，能不能生成精致的布景」）：
  // GLB 到位前的瞬时 graybox 占位块统一用一种中性石色，不为 6 个新地标类型各开一色
  // （占位只存活几秒，不值得像上面 landmark* 系列那样逐类型精细调色）。
  landmarkPropPlaceholder: 0x7a7568,
  // 夜间氛围新增两枚 gated 光效（timeOfDay-gated，见 landmarks.ts 的 nightAmount 用法）：
  landmarkDingEmberGlow: 0xe8703d,   // 铜鼎——鼎腹内隐约的余烬暖光，暖橙红
  landmarkSteleShimmer: 0x8fe0e8,    // 石碑——刻纹夜间泛起的幽幽青光，比 springGlowRing 更冷一档，读作"字纹自身在发光"而不是水面反光
  // M2 A3（地表精致化——owner feedback「地图不精致」）：风草场（grassField.ts）/贴地
  // 流雾（groundMist.ts）/飘落物（particles.ts 的 petal 常驻氛围槎位）三件专用色。
  groundMistPale: 0xcfd8d6, // 贴地流雾——不随昼夜变色（只有透明度按 nightAmount 呼吸），固定一种苍白冷灰调，与 PALETTE.fog（随昼夜变色、驱动 scene.fog）刻意区分职责
  petalPink: 0xe0aebc,  // 飘落物——暖粉，"落花"读法
  petalAmber: 0xd6a468, // 飘落物——暖琥珀，"落叶"读法，与 petalPink 交替，见 particles.ts 的 spawnPetal
  // M2 A4（天空远景——owner feedback「整体风格和山海经差很远」）：skyscape.ts 消费的
  // 静态色——远山/云海/日月轮三件的**随时间变化**的色相在 DAYNIGHT_KEYFRAMES 里另开
  // 字段（mountainInk/cloudTint/celestialColor，见下方关键帧块），这里只放"不随昼夜
  // 变化、只随 night-only 可见度呼吸"的三个静态色——同 groundMistPale 的既有分工
  // （呼吸用 nightAmount 驱动透明度，色相本身恒定）。
  moonHaloTint: 0x9fd0e0,  // 月轮夜间光晕——冷淡青，只在夜里随 nightAmount 淡入，见 skyscape.ts 的 haloOpacity
  starTint: 0xeaf2ff,      // 星河星点——冷白，300 颗共用同一基色，逐点只有 alpha（twinkle）不同
  galaxyTint: 0xd6e4f0,    // 银河带——冷白偏蓝，比 starTint 更蓝一档，"云雾般的星带"与"锐利的孤星"刻意区分
} as const;

/**
 * 昼夜关键帧（M1 B5）：黎明(0.0)/白昼(0.25)/黄昏(0.5)/夜(0.75) 四点，每点定义 sun 色温/
 * 强度、hemi 天穹/地面/强度、雾色/密度乘子（相对 PALETTE.fogDensity 的乘数，不是绝对值）、
 * 天穹三色。黄昏这一点直接复用既有 PALETTE 静态值——本工程此前的"暮色"美术方向本来
 * 就定在黄昏，零漂移地把它纳入四点循环里的一个采样点，而不是另开一套平行数值。
 * nightAmount（0=白昼..1=夜）是给 particles.ts 的萤火"夜里 gain 更高"用的插值目标——
 * 与其它光照字段共享同一套 smoothstep 插值机制（见 interpolateDayNight），不必另开一条
 * 专门判断"现在算不算晚上"的分支逻辑。
 */
export interface DayNightKeyframe {
  /** 本关键帧对应的 timeOfDay 时刻，[0,1)。 */
  t: number;
  /** 中文名，仅供代码可读性/调试用，不参与任何渲染判定。 */
  name: string;
  sunColor: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  fogColor: number;
  /** 乘在 PALETTE.fogDensity 之上的相对密度，不是绝对密度值。 */
  fogDensityMult: number;
  skyTop: number;
  skyHorizon: number;
  skyGlow: number;
  nightAmount: number;
  /**
   * M2 A4：远山剪影（skyscape.ts 的 buildInkMountains）墨色基调——黎明黛青/白昼
   * 青灰/黄昏绛紫掺暖/夜近黑（owner brief 原话四档）。与 skyTop/skyHorizon/skyGlow
   * 同属"天空整体氛围"的一部分，但这几个已有字段的色相是为天穹渐变调的，直接借用
   * 会让远山读成"和天空一个颜色、没有轮廓"——山海经水墨的"层山"感恰恰要靠山与天
   * 之间有一层若隐若现的色差，所以另开一个独立字段，不复用既有天穹三色。
   *
   * **必须比"看起来该有多深"再深一档**（真实 Playwright 截图判读修正，见
   * skyscape.ts 的 RING_CONFIGS 头注释）：远山所在的天球纬度（u≈0.5，见
   * atmosphere.ts 天穹 shader 的 glow 项）恰好是全天穹最亮的一条带，近圈 opacity
   * 只有 0.5——混合公式 `0.5*ink + 0.5*sky` 意味着即便 ink 是纯黑，能压暗的上限也
   * 只有背景亮度的一半；用一开始"看起来该有的"中等灰蓝/中等青灰色试算，混合结果
   * 幾乎与背景等亮，肉眼完全读不出剪影轮廓（首次实测：图中只有一片模糊色带，找不到
   * 山形）。这里四档全部再压暗一档（非仅夜档），拿到足够的"输入端深度"去抵消
   * "0.5 opacity 削去一半反差"这道数学上限。
   */
  mountainInk: number;
  /** M2 A4：云海（skyscape.ts 的 buildCloudBank）色调——dawn/dusk 暖、midday 近白、night 暗冷（乘 cloudGainFor 的透明度衰减）。 */
  cloudTint: number;
  /** M2 A4：日月轮（skyscape.ts 的 buildCelestialDisc）本体色——暖白日轮／青白月轮。 */
  celestialColor: number;
  /** M2 A4：日月轮直径（世界单位）——夜间月轮明显放大，呼应"山海经巨月"的夸张审美。 */
  celestialSize: number;
}

export const DAYNIGHT_KEYFRAMES: readonly DayNightKeyframe[] = [
  {
    t: 0.0, name: "黎明",
    sunColor: 0xf0a878, sunIntensity: 1.1,
    hemiSky: 0x9fb0c8, hemiGround: 0x3a3024, hemiIntensity: 1.05,
    fogColor: 0x4a4652, fogDensityMult: 1.0,
    skyTop: 0x1c2230, skyHorizon: 0x6a5a52, skyGlow: 0xd88a54,
    nightAmount: 0.35,
    // M2 A4：黛青远山 + 暖粉云海 + 低悬暖白日轮（将升未升，见 skyscape.ts 的
    // celestialElevation——t=0 恰好是这条公式的水平线一端）。
    mountainInk: 0x161e26, cloudTint: 0xe6b28f, celestialColor: 0xf2b483, celestialSize: 26,
  },
  {
    t: 0.25, name: "白昼",
    sunColor: 0xfff2d9, sunIntensity: 1.6,
    hemiSky: 0xaac4de, hemiGround: 0x4a4636, hemiIntensity: 1.35,
    fogColor: 0x7c8a97, fogDensityMult: 0.7,
    skyTop: 0x3a5570, skyHorizon: 0xbfd0dc, skyGlow: 0xe8d9b0,
    nightAmount: 0.0,
    // M2 A4：青灰远山（比黎明黛青更冷更浅）+ 近白云海（brief 原话"midday near-white"）+
    // 小而含蓄的暖白日轮（brief 原话"the sky is stylized"——白昼不该被一个抢镜的太阳
    // 分走注意力，celestialSize 是四档里最小的）。
    mountainInk: 0x333c42, cloudTint: 0xf3efe6, celestialColor: 0xfff2d4, celestialSize: 20,
  },
  {
    // 黄昏＝既有静态暮色美术方向的原样数值（PALETTE.sun*/hemi*/fog/sky*），见本块头注释。
    t: 0.5, name: "黄昏",
    sunColor: PALETTE.sunColor, sunIntensity: PALETTE.sunIntensity,
    hemiSky: PALETTE.hemiSky, hemiGround: PALETTE.hemiGround, hemiIntensity: PALETTE.hemiIntensity,
    fogColor: PALETTE.fog, fogDensityMult: 1.0,
    skyTop: PALETTE.skyTop, skyHorizon: PALETTE.skyHorizon, skyGlow: PALETTE.skyGlow,
    nightAmount: 0.65,
    // M2 A4：绛紫掺暖远山（brief 原话——深紫带一点暮色余晖的暖调，与黎明的黛青/白昼的
    // 青灰区分开，读作"晚霞染红了山影"）+ 暖橙云海（比黎明更烈一档，正对着落日）+
    // 低悬暖橙日轮（即将西沉，见 celestialElevation 在 t=0.5 同样落在水平线上）。
    mountainInk: 0x2e1820, cloudTint: 0xdd8f66, celestialColor: 0xf0925a, celestialSize: 28,
  },
  {
    // 夜：hemiGround/hemiIntensity/sunIntensity 三者的具体取值不是随手挑的——见
    // groundLuminance()/palette.test.ts 的"夜不低于白昼地面亮度 40%"回归断言
    // （M0.5「一团黑泥」教训：夜晚绝不能糊成一团看不清）。
    //
    // M1 B5 code-review 修正（真实 Playwright 截图判读发现的差异，见 m1-b5-report.md）：
    // groundLuminance() 只是一个不追求物理精确的粗代理（本文件头注释已言明），实测证明它
    // 系统性高估了夜晚的真实屏幕亮度——原因有二，both 不在这个代理公式的建模范围内：
    // (1) three.js HemisphereLight 对朝上的地面法线主要采样的是 `hemiSky`（天穹光），
    //     不是 `hemiGround`（地面反射光，主要影响朝下的法线）——代理公式当初用
    //     hemiGround 命名"地面亮度"是望文生义的偷懒，真正决定地表可见度的是 hemiSky；
    // (2) ACESFilmicToneMapping 在低光区间的响应曲线远比线性陡峭地把暗部往黑压——
    //     加上夜晚原本就更浓的雾（旧 fogDensityMult 1.15 且 fogColor 很暗），两者叠加
    //     后实测夜/昼地面亮度只有约 22%~26%，远低于这条护栏名义上的 40% 下限。
    // 修正：hemiSky/hemiGround/hemiIntensity/sunIntensity 全面调亮，fogColor 调亮、
    // fogDensityMult 从 1.15 降回 1.0（不再让夜雾额外加码变暗）——色相/氛围不变（仍是
    // 全场四点里最冷、最暗的一档，仍明显区别于黄昏/黎明），只是把"暗到什么程度"的实际
    // 下限往回收。修正后用同一套 Playwright 截图＋像素采样方法实测：夜/昼比值回升到
    // ≥45%（详见报告，数值随每次 dev-server 非确定性地形略有浮动，但稳定不低于该线）。
    t: 0.75, name: "夜",
    sunColor: 0x9fb4d9, sunIntensity: 1.0,
    hemiSky: 0x6a7aa0, hemiGround: 0x454858, hemiIntensity: 1.3,
    fogColor: 0x333a4a, fogDensityMult: 1.0,
    skyTop: 0x05070c, skyHorizon: 0x171c28, skyGlow: 0x2a3550,
    nightAmount: 1.0,
    // M2 A4：近黑远山（brief 原话）——四档里最暗，几乎融进夜空，只留一道极淡的冷光
    // 轮廓（skyscape.ts 的 ring opacity 固定在 0.68/0.48/0.32，颜色本身压到近黑；
    // 三档 opacity 数值的调整依据见 skyscape.ts RING_CONFIGS 头注释）+
    // 昏暗云海（brief"night very dim"，靠 cloudGainFor 把透明度再打折，这里的色相本身
    // 也调暗调冷）+ 硕大青白月轮（brief 原话"山海经 oversized-moon 美学"，celestialSize
    // 是四档里最大的，约白昼日轮的 2.7 倍）。
    mountainInk: 0x0e0f13, cloudTint: 0x4a5568, celestialColor: 0xb9e3ec, celestialSize: 54,
  },
];

/** DAYNIGHT_KEYFRAMES 去掉 t/name 之后、真正参与渲染插值的字段形状。 */
export type ResolvedDayNight = Omit<DayNightKeyframe, "t" | "name">;

function smoothstep01(x: number): number {
  const c = x < 0 ? 0 : x > 1 ? 1 : x;
  return c * c * (3 - 2 * c);
}

/** hex 十六进制颜色按分量线性插值（不经过任何色彩空间转换，纯字节数值运算）。 */
function lerpHexColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

function lerpNum(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * 找到 timeOfDay 落在哪两个相邻关键帧之间，并算出两者间 smoothstep 缓动后的混合系数
 * alpha（0=完全是 a，1=完全是 b）。循环环绕：最后一个关键帧（夜，t=0.75）与第一个
 * （黎明，t=0.0，视作下一圈的 1.0）之间也走同一套逻辑，不需要特殊分支。
 * 导出供测试直接断言边界/环绕行为。
 */
export function findDayNightBracket(timeOfDay: number): { a: DayNightKeyframe; b: DayNightKeyframe; alpha: number } {
  const t = ((timeOfDay % 1) + 1) % 1;
  const n = DAYNIGHT_KEYFRAMES.length;
  for (let i = 0; i < n; i++) {
    const a = DAYNIGHT_KEYFRAMES[i]!;
    const b = DAYNIGHT_KEYFRAMES[(i + 1) % n]!;
    const bT = i === n - 1 ? b.t + 1 : b.t; // 环绕：夜→黎明这一段的终点是下一圈的 1.0
    if (t >= a.t && t < bT) {
      const alpha = smoothstep01((t - a.t) / (bT - a.t));
      return { a, b, alpha };
    }
  }
  // 防御性兜底：above 循环按构造应当穷尽 [0,1) 的每一点，仅浮点边界极端情况可能落到这里。
  return { a: DAYNIGHT_KEYFRAMES[n - 1]!, b: DAYNIGHT_KEYFRAMES[0]!, alpha: 1 };
}

/**
 * 按 timeOfDay 平滑插值出当前时刻的完整光照/雾/天穹取值——atmosphere.ts 的
 * `updateAtmosphere()` 与 particles.ts 的萤火夜间 gain 共用同一个函数，是这套昼夜数值
 * 唯一的解析入口（不在两处各自重复一份插值逻辑）。
 */
export function interpolateDayNight(timeOfDay: number): ResolvedDayNight {
  const { a, b, alpha } = findDayNightBracket(timeOfDay);
  return {
    sunColor: lerpHexColor(a.sunColor, b.sunColor, alpha),
    sunIntensity: lerpNum(a.sunIntensity, b.sunIntensity, alpha),
    hemiSky: lerpHexColor(a.hemiSky, b.hemiSky, alpha),
    hemiGround: lerpHexColor(a.hemiGround, b.hemiGround, alpha),
    hemiIntensity: lerpNum(a.hemiIntensity, b.hemiIntensity, alpha),
    fogColor: lerpHexColor(a.fogColor, b.fogColor, alpha),
    fogDensityMult: lerpNum(a.fogDensityMult, b.fogDensityMult, alpha),
    skyTop: lerpHexColor(a.skyTop, b.skyTop, alpha),
    skyHorizon: lerpHexColor(a.skyHorizon, b.skyHorizon, alpha),
    skyGlow: lerpHexColor(a.skyGlow, b.skyGlow, alpha),
    nightAmount: lerpNum(a.nightAmount, b.nightAmount, alpha),
    // M2 A4：与上面 8 个既有字段同一套 lerp 机制，不另开分支——skyscape.ts 的
    // updateSkyscape() 与 updateAtmosphere()/fireflyGainFor 等共用这一个解析入口。
    mountainInk: lerpHexColor(a.mountainInk, b.mountainInk, alpha),
    cloudTint: lerpHexColor(a.cloudTint, b.cloudTint, alpha),
    celestialColor: lerpHexColor(a.celestialColor, b.celestialColor, alpha),
    celestialSize: lerpNum(a.celestialSize, b.celestialSize, alpha),
  };
}

/**
 * 地面亮度的粗略代理（M0.5「一团黑泥」教训的量化护栏）：hemi 天穹色贡献（`hemiSky`，
 * 不是 `hemiGround`——见下方 code-review 更正说明） + sun 的小比例掠射贡献
 * （SUN_GROUND_LUMINANCE_FACTOR——方向光只有很小一部分实际落在朝上的地面法线上，不是
 * 全额计入）。不追求物理精确，只用于 palette.test.ts 断言"夜不低于白昼地面亮度 40%"
 * 这条设计护栏——真正的画面明暗以实机/Playwright 截图判读为准，这里只是一个可回归的
 * 数值下限。
 *
 * **M1 B5 code-review 更正（用哪个 hemi 分量才对）**：THREE.HemisphereLight 的
 * `color`（此文件里叫 `hemiSky`）是法线朝上时采样到的光色，`groundColor`
 * （`hemiGround`）只在法线朝下时才起主导作用——本工程的地面网格法线绝大部分朝上，
 * 因此"地面到底有多亮"这件事物理上主要由 `hemiSky` 决定，用 `hemiGround` 是最初实现
 * 时望文生义的命名陷阱（"ground luminance" ≠ "groundColor"）。首次实测（真实
 * Playwright 截图＋像素采样，见 m1-b5-report.md）用旧公式验证"≥40%"这条护栏时通过，
 * 但真实渲染画面的夜/昼地面亮度比值只有约 22%~26%——换成 `hemiSky` 之后这个代理与
 * 实测数值的量级才对得上，不再是一个"内部自洽但脱离真实渲染"的假护栏。
 */
const SUN_GROUND_LUMINANCE_FACTOR = 0.15;

function hexLuminance(hex: number): number {
  const r = (hex >> 16) & 0xff, g = (hex >> 8) & 0xff, b = hex & 0xff;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export function groundLuminance(kf: Pick<ResolvedDayNight, "hemiSky" | "hemiIntensity" | "sunColor" | "sunIntensity">): number {
  return hexLuminance(kf.hemiSky) * kf.hemiIntensity + hexLuminance(kf.sunColor) * kf.sunIntensity * SUN_GROUND_LUMINANCE_FACTOR;
}
