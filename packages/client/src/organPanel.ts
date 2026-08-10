import type { GameState } from "@shiling/sim";
import { ORGANS, type OrganSlot } from "@shiling/content";
import { ORGAN_PANEL_SLOTS, SLOT_LABELS } from "./render/organVisuals.js";

/**
 * 器官面板（M1 B5）：Tab 开合的玻璃面板，7 行（六个可替换槎位 + 本命），每行展示
 * 槎位名 + 器官名（或「——」）+ 志怪词条（小字）+ 淬炼度细条。C 案弱光玻璃语言，
 * token 数值与 pause.ts 同色相（独立字面量，见该文件头注释里"每个模块自成一体"的
 * 既有惯例）。
 *
 * 与 pause.ts 的差异：pause 面板内容静态、只在可见性翻转那一帧写一次；本面板的内容
 * （器官名/temper）会在打开着的时候持续变化（蜕变发生、temper 用进增长），因此
 * `update(state)` 每渲染帧都被调用，内部对每一行做 dirty-check（只有真的变了才写 DOM），
 * 不可见时提前 return，避免白白算一遍 7 行的字符串拼接。
 */

const OVERLAY_ID = "shiling-organpanel-overlay";
const STYLE_ID = "shiling-organpanel-style";

const SYSTEM_FONT = `-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;

const PANEL_BG = "rgba(14, 16, 22, 0.72)";
const PANEL_HAIRLINE = "rgba(255, 255, 255, 0.14)";
const TRACK_BG = "rgba(255, 255, 255, 0.09)";
const TEXT_PRIMARY = "#e8ecf2";
const TEXT_DIM = "#c8d2dc";
const TEMPER_COLOR = "#7fd4e8"; // 与 hud.ts ACCENT.thirst 同一色相，呼应"淬炼"这条冷光读法

function ensureStyleInjected(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
#${OVERLAY_ID} {
  position: fixed;
  inset: 0;
  z-index: 24; /* 高于 #hud(10)/evofx(22)，低于暂停面板(25)——见 pause.ts 头部 z-index 注释同一套排序惯例 */
  display: none;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  font-family: ${SYSTEM_FONT};
}
#${OVERLAY_ID}.organpanel-visible { display: flex; }
.organpanel-panel {
  min-width: 320px;
  padding: 28px 36px;
  background: ${PANEL_BG};
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-radius: 16px;
  box-shadow: 0 0 0 1px ${PANEL_HAIRLINE} inset;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.organpanel-title {
  margin: 0 0 12px;
  font-size: 20px;
  font-weight: 300;
  letter-spacing: 0.3em;
  color: ${TEXT_PRIMARY};
  text-align: center;
}
.organpanel-row {
  display: grid;
  grid-template-columns: 44px 96px 1fr;
  align-items: center;
  gap: 10px;
  padding: 7px 0;
}
.organpanel-slot {
  font-size: 13px;
  font-weight: 300;
  letter-spacing: 0.1em;
  color: ${TEXT_DIM};
}
.organpanel-name {
  font-size: 15px;
  font-weight: 300;
  letter-spacing: 0.08em;
  color: ${TEXT_PRIMARY};
}
.organpanel-name.organpanel-empty {
  color: ${TEXT_DIM};
  opacity: 0.6;
}
.organpanel-detail {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.organpanel-flavor {
  font-size: 11px;
  font-weight: 300;
  letter-spacing: 0.04em;
  color: ${TEXT_DIM};
  opacity: 0.8;
}
.organpanel-temper-track {
  width: 100%;
  height: 3px;
  border-radius: 999px;
  background: ${TRACK_BG};
  overflow: hidden;
}
.organpanel-temper-fill {
  height: 100%;
  width: 0%;
  border-radius: inherit;
  background: ${TEMPER_COLOR};
  transition: width 200ms linear;
}
`;
  document.head.appendChild(style);
}

interface RowHandle {
  nameEl: HTMLDivElement;
  flavorEl: HTMLDivElement;
  fillEl: HTMLDivElement;
  lastOrganId: string; // "" = 空槎位
  lastTemperPct: number;
}

export interface OrganPanelRowContent {
  slotLabel: string;
  organName: string | null; // null = 「——」
  flavor: string;
  temperPct: number; // 0..100，空槎位为 0
}

/**
 * 单行内容的纯函数核心——不依赖 DOM，直接查 ORGANS 表。导出供
 * organPanel.test.ts 直接断言。
 */
export function buildOrganRowContent(slot: OrganSlot | "innate", equipped: GameState["organs"][OrganSlot | "innate"]): OrganPanelRowContent {
  const slotLabel = SLOT_LABELS[slot];
  if (!equipped) return { slotLabel, organName: null, flavor: "", temperPct: 0 };
  const def = ORGANS[equipped.organId];
  return {
    slotLabel,
    organName: def?.name ?? equipped.organId,
    flavor: def?.flavor ?? "",
    temperPct: Math.max(0, Math.min(100, equipped.temper)),
  };
}

export interface OrganPanel {
  setVisible(visible: boolean): void;
  isVisible(): boolean;
  /** 每渲染帧调用一次；内部先判可见性再判每行是否真的变化（dirty-check）。 */
  update(state: GameState): void;
}

export function createOrganPanel(): OrganPanel {
  ensureStyleInjected();

  let overlay = document.getElementById(OVERLAY_ID) as HTMLDivElement | null;
  const rows: RowHandle[] = [];

  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;

    const panel = document.createElement("div");
    panel.className = "organpanel-panel";

    const title = document.createElement("h2");
    title.className = "organpanel-title";
    title.textContent = "器　官";
    panel.appendChild(title);

    for (const slot of ORGAN_PANEL_SLOTS) {
      const row = document.createElement("div");
      row.className = "organpanel-row";

      const slotEl = document.createElement("div");
      slotEl.className = "organpanel-slot";
      slotEl.textContent = SLOT_LABELS[slot];

      const nameEl = document.createElement("div");
      nameEl.className = "organpanel-name organpanel-empty";
      nameEl.textContent = "——";

      const detailEl = document.createElement("div");
      detailEl.className = "organpanel-detail";
      const flavorEl = document.createElement("div");
      flavorEl.className = "organpanel-flavor";
      const trackEl = document.createElement("div");
      trackEl.className = "organpanel-temper-track";
      const fillEl = document.createElement("div");
      fillEl.className = "organpanel-temper-fill";
      trackEl.appendChild(fillEl);
      detailEl.append(flavorEl, trackEl);

      row.append(slotEl, nameEl, detailEl);
      panel.appendChild(row);

      rows.push({ nameEl, flavorEl, fillEl, lastOrganId: "", lastTemperPct: -1 });
    }

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
  }

  const overlayEl = overlay;
  let visible = false;

  return {
    setVisible(v: boolean): void {
      visible = v;
      overlayEl.classList.toggle("organpanel-visible", v);
    },
    isVisible(): boolean {
      return visible;
    },
    update(state: GameState): void {
      if (!visible) return;
      ORGAN_PANEL_SLOTS.forEach((slot, i) => {
        const handle = rows[i]!;
        const content = buildOrganRowContent(slot, state.organs[slot]);
        const organKey = content.organName ?? "";
        if (organKey !== handle.lastOrganId) {
          handle.nameEl.textContent = content.organName ?? "——";
          handle.nameEl.classList.toggle("organpanel-empty", content.organName === null);
          handle.flavorEl.textContent = content.flavor;
          handle.lastOrganId = organKey;
        }
        const roundedPct = Math.round(content.temperPct);
        if (roundedPct !== handle.lastTemperPct) {
          handle.fillEl.style.width = `${roundedPct}%`;
          handle.lastTemperPct = roundedPct;
        }
      });
    },
  };
}
