import { getPlayer, type GameState, type Terrain } from "@shiling/sim";

/**
 * 右上角实时小地图（W2，playtest feedback「要右上角全局小地图」）。纯 Canvas 2D，不用
 * three.js——只是把 sim 已有的 Terrain/GameState 数据映射到一张 2D 俯视图上。
 *
 * 两层 canvas 叠放（同一个卡片容器内，绝对定位 inset:0）：
 *   - base：地形色底图，只在 createMinimap() 时渲染一次，此后永不重绘（heightAt 采样
 *     的是静态高度图，不会变）。
 *   - overlay：玩家/生物/尸体/挖点/视野锥，每帧按 dirty-check（state.tick 是否推进）
 *     决定要不要清空重绘——静止/暂停时零开销。
 *
 * 皮肤说明（variant C「弱光玻璃」——owner 已定 HUD 整体方向，这是正式重皮，不再是
 * 临时视觉）：圆形玻璃罗盘，外框玻璃圆环 + hairline + 微光 glow（比稿 mockup 的
 * `.cmap`），地形色带整体调暗调冷一档融入玻璃底色，玩家点改 amber 带 glow。所有
 * 颜色/尺寸仍收在下面这一个 SKIN 常量块里。
 */

const SKIN = {
  cssSize: 148, // CSS px 边长（圆形卡片外接正方形）
  dpr: 2, // 画布物理像素 = cssSize * dpr，供 retina 清晰度
  cardBg: "rgba(14, 16, 22, 0.45)", // 玻璃底（mockup .cmap）
  cardHairline: "rgba(255, 255, 255, 0.14)", // inset 描边（mockup .cmap 的第一层 box-shadow）
  cardGlow: "rgba(127, 212, 232, 0.25)", // 外发光（mockup .cmap 的第二层 box-shadow）
  cardBlur: "5px",
  // mockup 的 `.cmap` 有 padding:6px，内层 `.cmapin` 只填满 padding 之后剩下的空间——
  // 露出一圈能看见玻璃底色+hairline 的窄边。两张 canvas 若直接 inset:0 铺满整张卡片，
  // 地形像素会一路铺到卡片最外沿，把 hairline 描边和内嵌发光整个盖住（实测截图验证
  // 过：不留这圈 padding，hairline/glow 视觉上完全读不出来，只剩下"圆形裁切的地图"，
  // 不像玻璃罗盘）。canvas 的物理像素分辨率按这个缩小后的边长算，不是整张卡片边长。
  innerPad: 6,
  // top:16（不再像旧皮肤那样为右上角的状态徽章预留占位——variant C 把状态字
  // 挪到小地图正下方，见 hud.ts 的 .hud-status-text 头部注释，两处坐标要同步核对）。
  top: 16,
  right: 16,

  baseGridRes: 120, // 静态底图采样网格边长（120×120）

  // 地形色带：在旧亮色版本基础上调暗调冷一档（降饱和+压亮度），融入半透明深色
  // 玻璃底，不再是一张"贴在卡片上的独立地图"，而是从玻璃里透出来的暗色地貌。
  bandWater: "#33505e",
  bandSwamp: "#3c4438",
  bandMeadow: "#4c5648",
  bandRocky: "#656d64",
  bandPeak: "#93998f",

  playerColor: "#e8b45f", // amber，与 HUD 饥饿环同一强调色
  playerGlow: "rgba(232, 180, 95, 0.85)",
  playerGlowBlur: 8,
  lingshuColor: "#c8d2dc",
  lingshuRadius: 2,
  tanshouColor: "#e0452b",
  tanshouRadius: 3,
  carcassColor: "#5f6862",
  carcassRadius: 2,
  digSpotColor: "#5a4a38",
  digSpotDugColor: "#332a20",
  digSpotRadius: 3,

  viewConeColor: "rgba(232, 236, 242, 0.14)",
  viewConeHalfAngle: Math.PI / 6, // 30°
  playerMarkerSize: 6,
} as const;

// 沼泽湿度带上限，与 terrainMesh.ts/scatter.ts 的 swampMax = waterLevel + 0.9 同一公式
// （见那两个文件顶部注释）——三处保持同一个"moisture proxy"边界，视觉/小地图/点缀
// 才能对得上同一片沼泽。
const SWAMP_MOISTURE_OFFSET = 0.9;

const STYLE_ID = "shiling-minimap-style";

const MINIMAP_CSS = `
.minimap-card {
  position: fixed;
  top: ${SKIN.top}px;
  right: ${SKIN.right}px;
  width: ${SKIN.cssSize}px;
  height: ${SKIN.cssSize}px;
  background: ${SKIN.cardBg};
  backdrop-filter: blur(${SKIN.cardBlur});
  -webkit-backdrop-filter: blur(${SKIN.cardBlur});
  border-radius: 50%; /* 圆形玻璃罗盘——两张方形 canvas 的四角靠 overflow:hidden 裁成圆 */
  box-shadow: 0 0 0 1px ${SKIN.cardHairline} inset, 0 0 24px -6px ${SKIN.cardGlow};
  overflow: hidden;
  pointer-events: none;
  z-index: 10;
}
.minimap-canvas {
  position: absolute;
  /* inset 而非 0——留出 SKIN.innerPad 那圈玻璃底色/hairline，见 SKIN.innerPad
     的注释：canvas 不能铺到卡片最外沿，否则地形像素会盖住描边/发光。 */
  inset: ${SKIN.innerPad}px;
  display: block;
}
`;

function ensureStyleInjected(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = MINIMAP_CSS;
  document.head.appendChild(style);
}

export interface Minimap {
  /** Call once per render frame (after started gate, mirroring hud.update's own gating in main.ts). */
  update(state: GameState, camYaw: number): void;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * 高度→地貌色带。不依赖 hillAmp（Terrain 接口本身不暴露它）：先在 renderBaseLayer 里
 * 扫一遍网格拿到实际采样到的最高点 maxH，再用 swampMax..maxH 的相对比例三等分出
 * 草甸/山地/山顶——比照 terrainMesh.ts 的"三段线性插值"思路，但这里只是离散选色
 * （小地图分辨率低，不需要连续渐变）。
 */
function bandColor(h: number, waterLevel: number, swampMax: number, aboveSpan: number): string {
  if (h < waterLevel) return SKIN.bandWater;
  if (h < swampMax) return SKIN.bandSwamp;
  const t = clamp01((h - swampMax) / aboveSpan);
  if (t < 0.5) return SKIN.bandMeadow;
  if (t < 0.85) return SKIN.bandRocky;
  return SKIN.bandPeak;
}

/** 世界坐标 → 画布像素坐标：纯缩放+平移，北=世界 -z（不随镜头旋转，"north-up"）。 */
function worldToMap(wx: number, wz: number, half: number, pxSize: number): { x: number; y: number } {
  return {
    x: ((wx + half) / (2 * half)) * pxSize,
    y: ((wz + half) / (2 * half)) * pxSize,
  };
}

/** 底图只渲染一次：逐格采样 heightAt，按高度分带填色，永不重绘。 */
function renderBaseLayer(ctx: CanvasRenderingContext2D, terrain: Terrain, worldSize: number, pxSize: number): void {
  const half = worldSize / 2;
  const res = SKIN.baseGridRes;
  const cell = pxSize / res;
  const swampMax = terrain.waterLevel + SWAMP_MOISTURE_OFFSET;

  const heights: Float32Array = new Float32Array(res * res);
  let maxH = -Infinity;
  for (let iz = 0; iz < res; iz++) {
    const wz = -half + ((iz + 0.5) / res) * worldSize;
    for (let ix = 0; ix < res; ix++) {
      const wx = -half + ((ix + 0.5) / res) * worldSize;
      const h = terrain.heightAt(wx, wz);
      heights[iz * res + ix] = h;
      if (h > maxH) maxH = h;
    }
  }
  const aboveSpan = Math.max(1e-6, maxH - swampMax);

  for (let iz = 0; iz < res; iz++) {
    for (let ix = 0; ix < res; ix++) {
      const h = heights[iz * res + ix]!;
      ctx.fillStyle = bandColor(h, terrain.waterLevel, swampMax, aboveSpan);
      // +1px 冗余避免相邻格之间出现亚像素缝隙（抗锯齿导致的可见细纹）。
      ctx.fillRect(ix * cell, iz * cell, cell + 1, cell + 1);
    }
  }
}

/**
 * 玩家三角标记：不用 ctx.rotate（避免"画布 y 朝下、角度约定容易搞反"的坑），直接用
 * 前向量 (dirX, dirY)（已经是地图空间坐标，见 worldToMap 的纯缩放映射——世界前向量
 * 分量原样搬进地图空间，不需要额外翻转）算出尖端+两个底角三个点，per-frame 只做向量
 * 加减法。variant C：amber 填色 + canvas shadowBlur 发光——用完立刻把 shadowBlur
 * 清零（下一帧/下一个绘制调用不应该继承这个状态，Canvas 2D 的 shadow* 是 ctx 全局态,
 * 不会随 fill() 自动重置）。
 */
function drawPlayerMarker(ctx: CanvasRenderingContext2D, cx: number, cy: number, dirX: number, dirY: number, size: number): void {
  const perpX = -dirY;
  const perpY = dirX;
  const tipX = cx + dirX * size;
  const tipY = cy + dirY * size;
  const baseCx = cx - dirX * size * 0.6;
  const baseCy = cy - dirY * size * 0.6;
  const leftX = baseCx + perpX * size * 0.55;
  const leftY = baseCy + perpY * size * 0.55;
  const rightX = baseCx - perpX * size * 0.55;
  const rightY = baseCy - perpY * size * 0.55;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(leftX, leftY);
  ctx.lineTo(rightX, rightY);
  ctx.closePath();
  ctx.fillStyle = SKIN.playerColor;
  ctx.shadowColor = SKIN.playerGlow;
  ctx.shadowBlur = SKIN.playerGlowBlur;
  ctx.fill();
  // 立刻复位两者——见函数头注释，shadow* 是 ctx 全局态。shadowColor 单独复位
  // 是 code review 补的一处完整性收尾：blur=0 时残留的 shadowColor 目前不会
  // 产生任何可见效果，但如果后面哪天新增一处只设 shadowBlur、忘了设
  // shadowColor 的绘制调用，会静默继承这里的 amber——两个字段一起清才是
  // 真正的"这次绘制的发光状态不外溢"。
  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";
}

/** 视野锥：camYaw 的正前方 ±viewConeHalfAngle 的扇形，半径到卡片边缘。 */
function drawViewCone(ctx: CanvasRenderingContext2D, cx: number, cy: number, dirX: number, dirY: number, radius: number, halfAngle: number): void {
  const baseAngle = Math.atan2(dirY, dirX);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, radius, baseAngle - halfAngle, baseAngle + halfAngle);
  ctx.closePath();
  ctx.fillStyle = SKIN.viewConeColor;
  ctx.fill();
}

/** 每帧（dirty）重绘的覆盖层：视野锥 + 挖点 + 尸体 + 生物 + 玩家。 */
function drawOverlay(ctx: CanvasRenderingContext2D, terrain: Terrain, worldSize: number, pxSize: number, state: GameState, camYaw: number): void {
  ctx.clearRect(0, 0, pxSize, pxSize);
  const half = worldSize / 2;
  const toMap = (wx: number, wz: number) => worldToMap(wx, wz, half, pxSize);

  const player = getPlayer(state);
  const pMap = toMap(player.pos.x, player.pos.z);

  const camDirX = Math.sin(camYaw);
  const camDirY = Math.cos(camYaw);
  drawViewCone(ctx, pMap.x, pMap.y, camDirX, camDirY, pxSize * 0.55, SKIN.viewConeHalfAngle);

  for (const spot of terrain.digSpots) {
    const m = toMap(spot.pos.x, spot.pos.z);
    ctx.beginPath();
    ctx.arc(m.x, m.y, SKIN.digSpotRadius, 0, Math.PI * 2);
    if (spot.dug) {
      ctx.fillStyle = SKIN.digSpotDugColor;
      ctx.fill();
    } else {
      ctx.strokeStyle = SKIN.digSpotColor;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  for (const c of state.carcasses) {
    const m = toMap(c.pos.x, c.pos.z);
    ctx.beginPath();
    ctx.arc(m.x, m.y, SKIN.carcassRadius, 0, Math.PI * 2);
    ctx.fillStyle = SKIN.carcassColor;
    ctx.fill();
  }

  for (const c of state.creatures) {
    if (c.id === player.id || c.activity === "dead") continue;
    const m = toMap(c.pos.x, c.pos.z);
    if (c.species === "lingshu") {
      ctx.beginPath();
      ctx.arc(m.x, m.y, SKIN.lingshuRadius, 0, Math.PI * 2);
      ctx.fillStyle = SKIN.lingshuColor;
      ctx.fill();
    } else if (c.species === "tanshou") {
      ctx.beginPath();
      ctx.arc(m.x, m.y, SKIN.tanshouRadius, 0, Math.PI * 2);
      ctx.fillStyle = SKIN.tanshouColor;
      ctx.fill();
    }
  }

  const dirX = Math.sin(player.yaw);
  const dirY = Math.cos(player.yaw);
  drawPlayerMarker(ctx, pMap.x, pMap.y, dirX, dirY, SKIN.playerMarkerSize);
}

/**
 * 挂载右上角小地图。`terrain`/`worldSize` 只在构建时用一次（渲染静态底图 + 后续 update
 * 里的坐标映射），不持有对 sim 的额外依赖。
 */
export function createMinimap(terrain: Terrain, worldSize: number): Minimap {
  ensureStyleInjected();

  const root = document.getElementById("hud");
  if (!root) throw new Error("createMinimap: #hud container not found in DOM");

  const card = document.createElement("div");
  card.className = "minimap-card";

  const baseCanvas = document.createElement("canvas");
  baseCanvas.className = "minimap-canvas";
  const overlayCanvas = document.createElement("canvas");
  overlayCanvas.className = "minimap-canvas";

  // 画布物理像素分辨率按"卡片边长 - 两侧 innerPad"算——canvas 的 CSS 尺寸由
  // .minimap-canvas 的 inset:innerPad 决定（见上面 CSS），这里必须用同一个缩小后
  // 的边长，否则 retina 分辨率会算多，且 worldToMap 的映射比例会跟实际显示尺寸不一致。
  const pxSize = (SKIN.cssSize - SKIN.innerPad * 2) * SKIN.dpr;
  baseCanvas.width = pxSize;
  baseCanvas.height = pxSize;
  overlayCanvas.width = pxSize;
  overlayCanvas.height = pxSize;

  card.appendChild(baseCanvas);
  card.appendChild(overlayCanvas);
  root.appendChild(card);

  const baseCtx = baseCanvas.getContext("2d");
  const overlayCtx = overlayCanvas.getContext("2d");
  if (!baseCtx || !overlayCtx) throw new Error("createMinimap: 2D context unavailable");

  renderBaseLayer(baseCtx, terrain, worldSize, pxSize);

  let lastTick = -1;

  return {
    update(state: GameState, camYaw: number): void {
      if (state.tick === lastTick) return; // dirty-check：tick 未推进（暂停/掉帧空转）就跳过整帧重绘
      lastTick = state.tick;
      drawOverlay(overlayCtx, terrain, worldSize, pxSize, state, camYaw);
    },
  };
}
