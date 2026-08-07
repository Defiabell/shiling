import { generatePaperNoiseDataUrl } from "./render/atmosphere.js";
import { PALETTE } from "./render/palette.js";

/**
 * 标题画面（宝可梦系明快游戏 UI restyle）：全屏亮暖底遮罩，压在已经在跑的 3D
 * 场景（main.ts 把 `started` 锁在 false，世界静止在 tick 0，但渲染循环照常跑
 * ——见该文件的 gate 注释）之上。此前的水墨版本靠半透明纸色让背后场景隐约透
 * 出；这一版改为接近不透明的亮暖渐变（呼应 hud.ts 卡片同一套暖纸白/亮色语
 * 言），噪点纹理仍然复用同一份 `generatePaperNoiseDataUrl()`（只是现在叠在
 * 渐变上做纸感颗粒，不再承担"半透明可视深度"的角色）。点击「入　山」后本模
 * 块自己负责 600ms 淡出动画 + 卸载 DOM，再回调 onEnter——main.ts 不需要知道
 * 淡出的具体时长/实现，只需要在 onEnter 里把 `started` 置真。
 */

const OVERLAY_ID = "shiling-title-overlay";
const STYLE_ID = "shiling-title-style";
const NOISE_TILE_SIZE = 256;

/** 点击到调用 onEnter 之间的墨色淡出时长——brief 明确要求 600ms，CSS transition 与 setTimeout 必须用同一个数，单一数据源。 */
const FADE_MS = 600;

function hexToCssColor(hex: number): string {
  return `#${hex.toString(16).padStart(6, "0")}`;
}

const cinnabarHex = hexToCssColor(PALETTE.cinnabar); // #c23b22 — 按钮底色，与 hud.ts 的朱砂强调色同源

/**
 * 亮色 UI 常量，字面值与 hud.ts 的 CARD.border/TEXT.ink 分组一致（#2b2b33
 * 同时是"文字主色"与"卡片/按钮描边"）——两个模块各自独立声明同一份字面量，
 * 延续本工程"每个模块自成一体，不跨模块 import UI-only 常量"的既有惯例
 * （旧版 PAPER_HEX 就是同一套做法）。拆成 INK/CARD_BORDER 两个名字纯粹是
 * 让各调用点表达自己的语义，不是两份独立数据。
 */
const INK = "#2b2b33";
const CARD_BORDER = "#2b2b33";

/**
 * 字体子集不变（restyle 决策，见 hud.ts 头部同一条注释的说明）：本次改动
 * 只碰样式，不碰文案——标题「食灵」、副题「山海之间，吞灵化形」、按钮
 * 「入　山」三处文字与此前完全一致，Ma Shan Zheng 现在只用在标题一处（副题
 * /按钮改用系统字体），字形覆盖范围只会变得更宽松，不需要重新请求/裁剪
 * `public/fonts/mashanzheng.woff2`。
 */
const FONT_CSS = `
@font-face {
  font-family: "Ma Shan Zheng";
  src: url("/fonts/mashanzheng.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
`;

const SYSTEM_FONT = `-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;

function ensureStyleInjected(noiseDataUrl: string): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
${FONT_CSS}
#${OVERLAY_ID} {
  position: fixed;
  inset: 0;
  z-index: 30; /* 高于 hud.ts 的 #hud(10)、screenFx.ts(8)、atmosphere.ts 的纸纹/暗角(5/6)——标题必须盖住一切 */
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 28px;
  /* 亮暖渐变 + 噪点纹理叠在同一层背景上（多重 background，不必再像
     atmosphere.ts 那样叠两个 div）：渐变负责"亮"这个基调，噪点用
     multiply 压一层纸纤维颗粒感，两者都不追求透出背后场景——这版不再是
     半透明卷轴叠影，而是一整块不透明的亮色标题背板。 */
  background-image: linear-gradient(160deg, #fff8ec 0%, #ffe1a0 60%, #ffcf7e 100%), url(${noiseDataUrl});
  background-repeat: no-repeat, repeat;
  background-size: cover, ${NOISE_TILE_SIZE}px ${NOISE_TILE_SIZE}px;
  background-blend-mode: normal, multiply;
  opacity: 1;
  transition: opacity ${FADE_MS}ms ease;
  font-family: ${SYSTEM_FONT};
}
#${OVERLAY_ID}.title-fade-out {
  opacity: 0;
  pointer-events: none;
}
.title-main {
  writing-mode: vertical-rl;
  margin: 0;
  font-family: "Ma Shan Zheng", "STKaiti", "KaiTi", serif; /* 唯二书法字体用点之一（另一处见 hud.ts 的 .hud-death-title） */
  font-size: 120px;
  font-weight: 400;
  letter-spacing: 0.15em;
  color: ${INK};
  /* 4px 白描边 + 柔光晕，让墨色大字从暖底噪点纹理里跳出来（贴纸/logo 感，
     宝可梦标题常见手法）。-webkit-text-stroke 在 Chromium/Firefox 均生效；
     paint-order 保证描边画在填色下面，不会把笔画中间的细节吃掉。 */
  -webkit-text-stroke: 4px #fff;
  paint-order: stroke fill;
  text-shadow: 0 0 20px rgba(255, 255, 255, 0.7);
}
.title-sub {
  margin: 0;
  font-family: ${SYSTEM_FONT};
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.25em;
  color: ${INK};
  opacity: 0.75;
}
.title-enter {
  margin-top: 12px;
  padding: 16px 56px;
  font-family: ${SYSTEM_FONT};
  font-weight: 700;
  font-size: 24px;
  letter-spacing: 0.2em;
  background: ${cinnabarHex};
  color: #fff;
  border: 3px solid ${CARD_BORDER};
  border-radius: 20px; /* 大圆角矩形，呼应 hud.ts 死亡卡同一档圆角 */
  box-shadow: 0 4px 0 rgba(43, 43, 51, 0.35); /* 实心 offset 阴影，不用 blur */
  cursor: pointer;
  transition: transform 150ms ease, box-shadow 150ms ease;
}
.title-enter:hover,
.title-enter:focus-visible {
  transform: translateY(-2px);
  box-shadow: 0 6px 0 rgba(43, 43, 51, 0.35); /* 抬起时阴影加深，强化"离开桌面"的立体感 */
}
.title-enter:active {
  transform: translateY(2px);
  box-shadow: 0 1px 0 rgba(43, 43, 51, 0.35); /* 按下感——阴影几乎吃掉，贴回桌面 */
}
`;
  document.head.appendChild(style);
}

/**
 * 挂载全屏标题遮罩；点击「入　山」触发 600ms 淡出，淡出结束后自己把 DOM 摘掉
 * 再调 onEnter（main.ts 在 onEnter 里把 `started` 置真，具体见 main.ts 头部
 * gate 注释）。`{ once: true }` 防止淡出过程中重复点击二次触发。
 */
export function showTitle(onEnter: () => void): void {
  // 幂等 guard，对齐 atmosphere.ts 的 mountPaperOverlay()/screenFx.ts 的
  // ensureOverlayDiv() 同一套"重复调用不重复挂载"惯例——main.ts 目前只在
  // 模块顶层调用一次，不会真的撞上，但保持这个约定比让 showTitle 是本文件
  // 唯一的例外更省心（且能防住"以后不小心调了第二次"的隐性 bug：没有这个
  // guard 的话第二次调用会重复插入一份 DOM/监听器，而不是像现在这样直接
  // no-op）。
  if (document.getElementById(OVERLAY_ID)) return;

  const noiseDataUrl = generatePaperNoiseDataUrl();
  ensureStyleInjected(noiseDataUrl);

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;

  // 剥括号惯例（Task 9 controller ruling，沿用至今）：plan/brief 文本里的
  // 《》「」是引用记号，不是要渲染的字符——hud.ts 死亡界面（身死／魂归青丘——
  // 按 R 转世／食灵）和 README 的写法都不带括号，标题画面统一同一套惯例。
  const main = document.createElement("h1");
  main.className = "title-main";
  main.textContent = "食灵";

  const sub = document.createElement("p");
  sub.className = "title-sub";
  sub.textContent = "山海之间，吞灵化形";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "title-enter";
  button.textContent = "入　山"; // U+3000 表意全角空格，视觉上比普通空格更宽——呼应《食灵》的疏朗排布

  overlay.append(main, sub, button);
  document.body.appendChild(overlay);

  button.addEventListener(
    "click",
    () => {
      overlay.classList.add("title-fade-out");
      window.setTimeout(() => {
        overlay.remove();
        onEnter();
      }, FADE_MS);
    },
    { once: true },
  );
}
