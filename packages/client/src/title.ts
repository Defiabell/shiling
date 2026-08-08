import { PALETTE } from "./render/palette.js";

/**
 * 标题画面（variant C「弱光玻璃」——owner 选定方向，取代宝可梦系亮色 restyle）：
 * 全屏暗色遮罩，压在已经在跑的 3D 场景（main.ts 把 `started` 锁在 false，世界静止
 * 在 tick 0，但渲染循环照常跑——见该文件的 gate 注释）之上。渐变底直接复用场景自己
 * 的暮色三色（`PALETTE.skyTop/skyHorizon/skyGlow`——见 atmosphere.ts 的天空穹顶用的
 * 同一份数值），而不是像上一版那样另开一套亮暖色——"深空渐变底复用场景暮色系"，
 * 让标题画面本身就是场景暮色的延伸,不是另一层无关的贴纸。点击「入　山」后本模块
 * 自己负责 600ms 淡出动画 + 卸载 DOM，再回调 onEnter——main.ts 不需要知道淡出的
 * 具体时长/实现，只需要在 onEnter 里把 `started` 置真。
 */

const OVERLAY_ID = "shiling-title-overlay";
const STYLE_ID = "shiling-title-style";

/** 点击到调用 onEnter 之间的墨色淡出时长——brief 明确要求 600ms，CSS transition 与 setTimeout 必须用同一个数，单一数据源。 */
const FADE_MS = 600;

function hexToCssColor(hex: number): string {
  return `#${hex.toString(16).padStart(6, "0")}`;
}

// 深空渐变三色，直接取 atmosphere.ts 天空穹顶用的同一份 PALETTE 数值（"复用场景
// 暮色系"）——不是另起一套字面量，标题背景与场景背景在概念上就是同一件事。
const skyTopHex = hexToCssColor(PALETTE.skyTop);
const skyHorizonHex = hexToCssColor(PALETTE.skyHorizon);
const skyGlowHex = hexToCssColor(PALETTE.skyGlow);

/**
 * 弱光玻璃皮肤 token，字面值与 hud.ts 的 GLASS/ACCENT 分组一致（青色微光同一色
 * 相）——两个模块各自独立声明同一份字面量，延续本工程"每个模块自成一体，不跨模块
 * import UI-only 常量"的既有惯例（旧版 PAPER_HEX/CARD_BORDER 就是同一套做法）。
 */
const GLASS_HAIRLINE = "rgba(255, 255, 255, 0.16)";
const GLOW_CYAN = "rgba(127, 212, 232, 0.55)"; // #7fd4e8，与 hud.ts ACCENT.thirst 同一色相

/**
 * 字体子集不变（restyle 决策，见 hud.ts 头部同一条注释的说明）：本次改动只碰
 * 样式，不碰文案——标题「食灵」、副题「山海之间，吞灵化形」、按钮「入　山」三处
 * 文字与此前完全一致，Ma Shan Zheng 仍然只用在标题一处，字形覆盖范围不变，不需要
 * 重新请求/裁剪 `public/fonts/mashanzheng.woff2`。
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

function ensureStyleInjected(): void {
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
  /* 深空渐变——三色直接抄场景天空穹顶用的 PALETTE.skyTop/skyHorizon/skyGlow（见
     atmosphere.ts 的 SKY_FRAGMENT_SHADER，同一份 mix 逻辑换成 CSS 线性渐变的
     近似）。不再叠纸纹噪底（variant C 的"干净"气质——旧版噪点纹理在这版直接
     去掉，而不是压到几乎不可见，噪点与半透明玻璃层叠加视觉上会显脏）。 */
  background: linear-gradient(180deg, ${skyTopHex} 0%, ${skyHorizonHex} 55%, ${skyGlowHex} 100%);
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
  /* 墨白反转：暗底上改白字，极淡青色 glow 而不是旧版的暖白描边贴纸感——克制、
     不抢场景。text-shadow 叠两层：紧贴的白色柔光收边 + 稍宽的青色氛围光。 */
  color: #ffffff;
  text-shadow: 0 0 12px rgba(255, 255, 255, 0.5), 0 0 40px ${GLOW_CYAN};
}
.title-sub {
  margin: 0;
  font-family: ${SYSTEM_FONT};
  font-size: 15px;
  font-weight: 300;
  letter-spacing: 0.35em;
  color: #c8d2dc;
  opacity: 0.85;
}
.title-enter {
  margin-top: 12px;
  padding: 14px 52px;
  font-family: ${SYSTEM_FONT};
  font-weight: 300;
  font-size: 20px;
  letter-spacing: 0.3em;
  background: rgba(14, 16, 22, 0.5);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  color: #e8ecf2;
  border: none;
  border-radius: 999px; /* 玻璃胶囊，呼应 hud.ts 情境提示 pill 同一形态语言 */
  box-shadow: 0 0 0 1px ${GLASS_HAIRLINE} inset;
  cursor: pointer;
  transition: box-shadow 150ms ease, transform 150ms ease;
}
.title-enter:hover,
.title-enter:focus-visible {
  /* hover 时 cyan glow 亮起——外发光 + hairline 略提亮，不做位移/阴影那套实心
     offset 手法（那是上一版宝可梦皮肤的语言，这版克制、静态玻璃质感为主）。 */
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.28) inset, 0 0 24px -2px ${GLOW_CYAN};
}
.title-enter:active {
  transform: scale(0.97);
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

  ensureStyleInjected();

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;

  // 剥括号惯例（Task 9 controller ruling，沿用至今）：plan/brief 文本里的
  // 《》「」是引用记号，不是要渲染的字符——hud.ts 死亡界面（身死／魂归青丘——
  // 按 R 转世）和 README 的写法都不带括号，标题画面统一同一套惯例。
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
