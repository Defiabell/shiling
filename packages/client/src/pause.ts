/**
 * 暂停面板（Post-fix-6，owner feedback「trackpad 没有舒适的鼠标按键／不知道有冲刺」
 * discoverability 修复的姊妹功能——本文件只管暂停时的可见 UI，Esc 边沿检测/`paused`
 * 状态本身留在 main.ts，与 Task 9 的 `started` 门闩同一套模式：main.ts 决定"要不要
 * 暂停"，本模块只负责"暂停时长什么样"）。
 *
 * 弱光玻璃语言（variant C，token 数值与 hud.ts/title.ts 的 GLASS/TEXT 分组一致，但按
 * 本工程"每个模块自成一体，不跨模块 import UI-only 常量"的既有惯例独立声明字面量）：
 * 全屏半透明暗色遮罩（世界仍在遮罩后面"冻结着可见"，不是死亡界面那种全黑不透明——
 * 呼应 main.ts 的 paused gate 语义：只冻结 sim 步进/HUD 更新，渲染循环照常画）+
 * 居中玻璃面板（标题「暂　停」+ 操作说明 list + 底部「Esc 继续」提示）。
 *
 * 独立成模块而不是塞进 hud.ts：暂停面板与 HUD 的数值仪表/情境提示是两种不同生命周期
 * 的东西——HUD 每帧随 sim 状态重新计算，暂停面板只在 `paused` 翻转的那一帧切一次
 * 可见性，不订阅任何逐帧数据，拆开保持各自模块单一职责（沿用 title.ts 独立于 hud.ts
 * 的同一惯例）。
 *
 * pointer-events:auto（不是 #hud 的 none）：这是模态遮罩，暂停期间要在 DOM 层挡住
 * 画布本身新发起的拖拽/点击（键盘 Esc 才是 brief 里设计上唯一的恢复路径），镜像
 * hud.ts 死亡界面同样是 pointer-events:auto 模态的先例。真正兜底的仍是 main.ts
 * 渲染循环里对 followCam.update()/hud.update() 的 `!paused` 跳过——这层 DOM 遮挡
 * 不是万无一失的第二道防线：canvas 的 pointerdown 处理器用了 Pointer Capture
 * （见 input.ts），如果 Esc 恰好在一次右键拖拽"进行中"按下，浏览器仍会把后续
 * pointermove/up 直接派给已经 capture 住的 canvas，绕过这层遮罩——但即便如此，
 * main.ts 那层 gate 已经在跳过 camDelta() 的消费，镜头照样不会转动，只是这层
 * DOM 遮挡本身没能拦住那一次已经在飞行中的手势。
 */

const OVERLAY_ID = "shiling-pause-overlay";
const STYLE_ID = "shiling-pause-style";

const SYSTEM_FONT = `-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;

// 与 hud.ts 的 GLASS/TEXT 同色相，独立字面量（见头部注释）。
const SCRIM_BG = "rgba(10, 12, 16, 0.55)";
const PANEL_BG = "rgba(14, 16, 22, 0.72)";
const PANEL_HAIRLINE = "rgba(255, 255, 255, 0.14)";
const KEYCAP_BG = "rgba(14, 16, 22, 0.5)";
const KEYCAP_HAIRLINE = "rgba(255, 255, 255, 0.12)";
const TEXT_PRIMARY = "#e8ecf2";
const TEXT_DIM = "#c8d2dc";

/**
 * 操作说明 list 文案，逐行对应 brief 给定文本，标点全角，不做任何拆分/重排。
 * M1 postfix N1（叼运/筑巢/储粮）：E 的互动列表补上"筑巢"，新增 C 一行——与
 * title.ts 的入山提示行同步更新，两处都是"控制说明"的既有惯例，不留其一遗漏。
 * M1 postfix N3（程序化音效）：新增 M 静音一行，同一套惯例。
 * M1 B3（蛰伏蜕变）：新增 V 一行——插在 C 之后、方向键之前，与 title.ts 的入山提示行
 * 同步更新，两处都是"控制说明"的既有惯例，不留其一遗漏。
 */
const OPERATIONS = [
  "W A S D　移动",
  "Shift　冲刺（消耗疲劳）",
  "J（或鼠标左键）　撕咬",
  "E　互动——进食／饮水／挖掘／筑巢／出入洞",
  "C　叼起／放下——存粮或就地放下猎物",
  "V　蛰伏——在自家巢中，精气与储粮足够时开始蜕变",
  "←→　转动视角　↑↓　俯仰",
  "Esc　暂停",
  "M　静音",
];

function ensureStyleInjected(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
#${OVERLAY_ID} {
  position: fixed;
  inset: 0;
  /* 25：低于 title.ts 的标题遮罩(30)，高于 hud.ts 的 #hud(10)——真正参与跨 stacking
     context 比较的是 #hud 整体的 z-index:10，不是它内部子元素 .hud-death 名义上
     的 20（同一个坑见 screenFx.ts 头部注释的详细写法）。且 main.ts 的 paused 守卫
     （started && !playerDead）本就保证暂停面板和死亡界面不会同时出现，这里的排序
     只是维持"数字越大越靠前"的既有惯例，不代表真的会叠在一起比较。 */
  z-index: 25;
  display: none;
  align-items: center;
  justify-content: center;
  background: ${SCRIM_BG};
  pointer-events: auto; /* 模态：挡住画布拖拽/点击，见文件头注释 */
  font-family: ${SYSTEM_FONT};
}
#${OVERLAY_ID}.pause-visible {
  display: flex;
}
.pause-panel {
  min-width: 280px;
  padding: 32px 44px;
  background: ${PANEL_BG};
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-radius: 16px;
  box-shadow: 0 0 0 1px ${PANEL_HAIRLINE} inset;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 22px;
}
.pause-title {
  margin: 0;
  font-size: 26px;
  font-weight: 300;
  letter-spacing: 0.3em;
  color: ${TEXT_PRIMARY};
}
.pause-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 11px;
}
.pause-list li {
  font-size: 14px;
  font-weight: 300;
  letter-spacing: 0.08em;
  color: ${TEXT_DIM};
  white-space: nowrap;
}
.pause-hint {
  margin-top: 2px;
  font-size: 14px;
  font-weight: 300;
  letter-spacing: 0.15em;
  color: ${TEXT_DIM};
}
.pause-keycap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 30px;
  height: 22px;
  padding: 0 6px;
  margin-right: 6px;
  vertical-align: middle;
  border-radius: 6px;
  background: ${KEYCAP_BG};
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  box-shadow: 0 0 0 1px ${KEYCAP_HAIRLINE} inset;
  color: ${TEXT_PRIMARY};
  font-size: 12px;
  font-weight: 400;
  letter-spacing: 0; /* 键帽内文案不继承父级的宽字距，与 hud.ts .hud-death-keycap 同一惯例 */
}
`;
  document.head.appendChild(style);
}

export interface PauseOverlay {
  /** 纯可见性 setter——是否要切换由 main.ts 的 Esc 边沿检测决定，本函数不含任何判断逻辑。 */
  setVisible(visible: boolean): void;
}

/**
 * 幂等挂载暂停面板 DOM（与 showTitle()/mountPaperOverlay() 同一套"重复调用不重复
 * 插入"惯例），默认隐藏。main.ts 只在 Esc 切换 `paused` 的那一帧调用一次 setVisible()，
 * 不逐帧调用——面板内容是静态文案，没有需要每帧刷新的动态数据。
 */
export function createPauseOverlay(): PauseOverlay {
  ensureStyleInjected();

  let overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;

    const panel = document.createElement("div");
    panel.className = "pause-panel";

    const title = document.createElement("h2");
    title.className = "pause-title";
    title.textContent = "暂　停";

    const list = document.createElement("ul");
    list.className = "pause-list";
    for (const line of OPERATIONS) {
      const li = document.createElement("li");
      li.textContent = line;
      list.appendChild(li);
    }

    const hint = document.createElement("div");
    hint.className = "pause-hint";
    const keycap = document.createElement("span");
    keycap.className = "pause-keycap";
    keycap.textContent = "Esc";
    hint.append(keycap, "继续");

    panel.append(title, list, hint);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
  }

  const overlayEl = overlay;
  return {
    setVisible(visible: boolean): void {
      overlayEl.classList.toggle("pause-visible", visible);
    },
  };
}
