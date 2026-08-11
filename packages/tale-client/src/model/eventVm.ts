/**
 * 事件卡视图模型（纯）—— 含「未达门槛的抉择置灰并显示原因」的全部文案生成。
 *
 * 这块是刻意做重的：门槛提示是计划里的「build 不同就能选它」的欲望展示位，
 * 所以每条未满足的要求都要能说清「要什么、你现在有多少」。判定口径必须与引擎一致，
 * 因此满足性一律问 `eligibleChoiceIdxs`（引擎正本），本文件只负责把「为什么不满足」
 * 拆出来讲；两者若漂移，测试会先炸。
 */

import {
  eligibleChoiceIdxs,
  organIndex,
  ownedTags,
  type EventChoice,
  type EssenceType,
  type TaleContent,
  type TaleEvent,
  type TaleState,
} from "@shiling/tale-sim";
import { eventArt } from "../art/assets.js";
import { ESSENCE_LABELS, ESSENCE_ORDER, STAT_LABELS, STAT_ORDER } from "./format.js";

export interface MediaAsset {
  kind: "image" | "video";
  src: string;
  /** Ken Burns 缓推镜的落点（0〜1 归一化），缺省居中 */
  focus?: { x: number; y: number };
  /**
   * 画幅比（CSS `aspect-ratio` 的值，如 `"4 / 3"`）。
   *
   * 卡片图位按它开框，图就**整幅显示不裁切** —— B4 的插图是 4:3 册页，立绘是 3:4，
   * 头像 1:1，硬塞进同一个固定高度的横幅会切掉主体（详见 b4-report 第七节）。缺省 4:3。
   */
  aspect?: string;
}

export type RequirementKind = "stat" | "organ" | "essence";

export interface RequirementVm {
  kind: RequirementKind;
  /** 「灵 20」「足之精气 30」「雾目／疾足」 */
  label: string;
  /** 未满足时的现况，如「今 12」；满足时为 null */
  shortfall: string | null;
  met: boolean;
}

export interface ChoiceVm {
  idx: number;
  label: string;
  enabled: boolean;
  requirements: RequirementVm[];
  /** 未满足要求的合并说明，供 title/aria 用；全满足时为空串 */
  deniedSummary: string;
}

export interface EventCardVm {
  eventId: string;
  title: string;
  /** 正文按空行/换行拆段，渲染成多个 <p>，避免一坨 */
  paragraphs: string[];
  media: MediaAsset | null;
  choices: ChoiceVm[];
  /** 全部抉择都不可选 —— 内容 bug 的兜底信号，界面要给一条出路 */
  deadlocked: boolean;
}

/** 事件插图在 public 下的目录（B4 美术管线的产出落点）。路径规则的正本在 `art/assets.ts`。 */
export { ART_DIR } from "../art/assets.js";

/**
 * 把一个 organTag 说成人话：列出内容库里带此 tag 的器官名，用「／」连接。
 *
 * 必须走 `organIndex`（含神种自带器官）—— 只遍历 `content.organs` 会漏掉神种那一枚，
 * 导致「须具 灵蕴」这类门槛显示成空。tag 无人提供时原样回显 tag（内容 bug 可见化）。
 */
export function describeOrganTag(tag: string, content: TaleContent): string {
  const names: string[] = [];
  for (const organ of organIndex(content).values()) {
    if (organ.tags.includes(tag) && !names.includes(organ.name)) names.push(organ.name);
  }
  return names.length > 0 ? names.join("／") : tag;
}

/** 抉择的门槛拆解。met 的口径与引擎 `meetsChoiceRequirement` 逐条对齐。 */
export function describeRequirements(
  state: TaleState,
  choice: EventChoice,
  content: TaleContent,
): RequirementVm[] {
  const out: RequirementVm[] = [];
  const requires = choice.requires;
  if (!requires) return out;

  for (const key of STAT_ORDER) {
    const need = requires.stats?.[key];
    if (need === undefined) continue;
    const have = state.stats[key];
    const met = have >= need;
    out.push({
      kind: "stat",
      label: `${STAT_LABELS[key]} ${need}`,
      shortfall: met ? null : `今 ${Math.round(have)}`,
      met,
    });
  }

  if (requires.organTags && requires.organTags.length > 0) {
    const owned = ownedTags(state, content);
    const met = requires.organTags.some((tag) => owned.has(tag));
    const names = requires.organTags.map((tag) => describeOrganTag(tag, content)).join("／");
    out.push({
      kind: "organ",
      label: `须具 ${names}`,
      shortfall: met ? null : "尚未蜕生",
      met,
    });
  }

  if (requires.essenceMin) {
    for (const type of ESSENCE_ORDER as readonly EssenceType[]) {
      const need = requires.essenceMin[type];
      if (need === undefined) continue;
      const have = state.essence[type];
      const met = have >= need;
      out.push({
        kind: "essence",
        label: `${ESSENCE_LABELS[type]}之精气 ${need}`,
        shortfall: met ? null : `今 ${Math.round(have)}`,
        met,
      });
    }
  }

  return out;
}

function splitParagraphs(body: string): string[] {
  return body
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function buildEventCardVm(
  state: TaleState,
  event: TaleEvent,
  content: TaleContent,
): EventCardVm {
  const eligible = new Set(eligibleChoiceIdxs(state, event, content));
  const choices: ChoiceVm[] = event.choices.map((choice, idx) => {
    const requirements = describeRequirements(state, choice, content);
    const unmet = requirements.filter((requirement) => !requirement.met);
    return {
      idx,
      label: choice.label,
      enabled: eligible.has(idx),
      requirements,
      deniedSummary: unmet
        .map((requirement) =>
          requirement.shortfall ? `${requirement.label}（${requirement.shortfall}）` : requirement.label,
        )
        .join("、"),
    };
  });

  return {
    eventId: event.id,
    title: event.title,
    paragraphs: splitParagraphs(event.body),
    media: event.illustration ? { kind: "image", src: eventArt(event.illustration) } : null,
    choices,
    deadlocked: choices.length > 0 && choices.every((choice) => !choice.enabled),
  };
}
