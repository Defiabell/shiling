/**
 * 凝招屏（招式框）视图模型（纯）。
 *
 * ## 这一层唯一的职责：把引擎给的数如实摆到玩家眼前
 * 与追猎／搏杀两屏同一条纪律：伤害区间、势、冷却、精气代价、槽位占用**全部**来自
 * `forgePreview`／`loreOptions`（引擎），界面**不复刻任何公式**。这里做的只有呈现决定 ——
 * 措辞、印章、以及「换一个部件之后哪几个数变了」怎么标出来。
 *
 * ## 「摊开后果」在这一屏的具体形态（验收第二问）
 * 每一件候选部件的按钮上，写的不是它自己的 payload，而是**换上它之后这一手会变成什么**：
 * 伤害区间、势、冷却、精气四项的**当前值与换上之后的值**。一个只写「齿：伤 ×1.4」的
 * 按钮等于让玩家自己去算总账 —— 那正是追猎屏立下的铁律要消灭的东西。
 */

import {
  BODY_PART_NAMES,
  FORGE_SLOTS,
  FORGE_SLOT_NAMES,
  forgeParts,
  forgePartsForSlot,
  forgeNameValid,
  forgePreview,
  lifeTuning,
  loreOptions,
  organIndex,
  recommendForge,
  skillDamageRange,
  type DamageRange,
  type ForgeBlock,
  type ForgePicks,
  type ForgePreview,
  type ForgeSlot,
  type PartDef,
  type TaleContent,
  type TaleState,
} from "@shiling/tale-sim";
import { ESSENCE_LABELS, ESSENCE_ORDER, SKILL_EFFECT_LABELS } from "./format.js";

/** 一件候选部件在某个槽里的按钮。 */
export interface ForgePartOptionVm {
  partId: string;
  /** 单字名号（「齿」） */
  name: string;
  kind: string;
  /** 这件部件在这个槽里干什么（内容写的那一句） */
  text: string;
  /** 当前选中 */
  selected: boolean;
  /**
   * 换上它之后这一手变成什么 —— **四项恒在**（伤害／势／冷却／精气）。
   *
   * 选中的那一件写的就是当前值；没选中的写换上之后的值。两者用同一套措辞，
   * 玩家才能一眼比出差在哪。
   */
  outcome: string;
  /** 换上它之后精气付不付得起（付不起也照样可选 —— 它是欲望展示位，不是禁区） */
  affordable: boolean;
  /**
   * 点它之后三个槽变成什么 —— **界面只管把这一份递回去**，不自己算下一步。
   *
   * 它已经处理了「这件部件正占着别的槽」那种局面：那时点它 ＝ **两个槽对调**
   * （而不是把按钮灰掉）。灰掉是「原因顶掉后果」的复发（S1 在技能池上专门治过这条），
   * 而对调既保住了后果预览，又比「先把它从那边挪走再点这边」少一次点击。
   */
  picksAfter: ForgePicks;
  /** 点它会顺带把哪个槽换掉（对调时写「与力道对调」）；null ＝ 只换这一个槽 */
  swapNote: string | null;
  /**
   * 这件部件此刻真的按不了的原因；null ＝ 可选。
   *
   * 对调之后那副 picks 不合法（换过去的那一件在对方的槽里没有 payload）才会非空 ——
   * 「已占别的槽」不再走这一支（那一支现在是对调）。
   */
  disabledReason: string | null;
}

/** 招式框里的一个槽。 */
export interface ForgeSlotVm {
  slot: ForgeSlot;
  /** 「起手」「力道」「附加」 */
  label: string;
  /** 这个槽管什么（常驻一行说明 —— 三个槽的分工是这一屏最先要讲清的事） */
  hint: string;
  /** 当前选中的部件名；没有候选时 null */
  pickedName: string | null;
  /** 当前选中那一件在这个槽里干什么 */
  pickedText: string | null;
  options: ForgePartOptionVm[];
}

/** 招式册里已有的一手。 */
export interface ForgedRowVm {
  id: string;
  name: string;
  /** 「凝」自拟／「古」古法 */
  glyph: string;
  /** 「齿·鬃·毒」或古法名 */
  source: string;
  /** 「伤 9〜12 · 附毒·数合不起势 · 冷却 3 合 · 耗势 3」 */
  effect: string;
  /** 「已付 猛精气 18」 */
  paid: string;
}

/** 古法货架上的一条。 */
export interface LoreRowVm {
  synergyId: string;
  name: string;
  /** 「狩齿 ＋ 毒腺」；未发现过的写「？」 */
  recipe: string;
  /** 已发现过（跨世图鉴）—— 没发现过的不许泄露配方与成品 */
  known: boolean;
  /** 因果一句（`SynergyDef.reveal`）；未发现过为 null */
  reveal: string | null;
  effect: string;
  /** 「习得 猛精气 26 · 槽 1」 */
  cost: string;
  enabled: boolean;
  disabledReason: string | null;
}

export interface ForgeVm {
  /** 「精气 猛 24 · 鳞 18 …」—— 四型全列（凝哪一手付哪一型，得先看得见都有多少） */
  essenceLine: string;
  /** 「招式册 2／4」 */
  slotLine: string;
  /** 手上有哪几件部件（「齿 目 鬃 爪 毒」）—— 一行就说清「我能拼什么」 */
  partsLine: string;
  /** 三个槽；拼不出来（部件不够）时为空数组 */
  slots: ForgeSlotVm[];
  /**
   * 成品那一行：「伤 9〜12 · 附毒·数合不起势 · 断其腿 · 势 3 · 冷却 3」。
   * 拼不出来时为 null。
   */
  resultEffect: string | null;
  /** 「代价：猛之精气 18 · 槽 2/4」 */
  resultCost: string | null;
  /** 命名框的预填值（玩家不改就用它） */
  defaultName: string | null;
  /** 命名框此刻该显示什么（玩家打过字就是他打的，否则是预填值） */
  nameValue: string;
  /** 凝成按钮可按 */
  canForge: boolean;
  /** 凝不成的原因；`canForge` 为真时 null */
  blockedReason: string | null;
  /** 拼不出来时的那一句（缺哪一类部件） */
  emptyReason: string | null;
  forged: ForgedRowVm[];
  lore: LoreRowVm[];
  /** 引擎建议现在凝这一手（界面据它给招式册入口一点金光）—— 与搏杀屏的推荐同一个定位 */
  recommended: boolean;
}

const SLOT_HINT: Record<ForgeSlot, string> = {
  open: "定这一手的基础动作与伤害系数，也定它按猛还是按灵算、付哪一型精气。",
  force: "定力道加成与「断伤」—— 顺带断它一处，整场都算数。",
  addon: "定附带效果 —— 十档里的一档。",
};

function damageText(range: DamageRange): string {
  return range.min === range.max ? String(range.mid) : `${range.min}〜${range.max}`;
}

/** 「伤 9〜12」或明说「不出伤」—— 不许省（省一个词换来一次歧义，S1 那条）。 */
function damageLine(range: DamageRange): string {
  return range.mid > 0 ? `伤 ${damageText(range)}` : "不出伤";
}

/** 一手招的账：伤害／效果／断伤／势／冷却。招式册、成品行、候选按钮共用这一份措辞。 */
function skillLine(preview: ForgePreview): string {
  const parts = [`伤 ${damageText(preview.damage)}`, SKILL_EFFECT_LABELS[preview.effect]];
  if (preview.woundPart) parts.push(`断其${BODY_PART_NAMES[preview.woundPart]}`);
  parts.push(`势 ${preview.cost.momentum}`, `冷却 ${preview.cost.cooldown} 合`);
  return parts.join(" · ");
}

/** 「猛之精气 18」 */
function essenceText(type: keyof typeof ESSENCE_LABELS, amount: number): string {
  return `${ESSENCE_LABELS[type]}之精气 ${amount}`;
}

/**
 * 拼装界面。`picks` 为 null ＝ 还没打开过／部件不足，由调用方决定是否用
 * `defaultForgePicks` 预填（那一步在 `app` 里做，因为它是一次**状态变更**）。
 */
export function buildForgeVm(
  state: TaleState,
  content: TaleContent,
  picks: ForgePicks | null,
  knownSynergyIds: readonly string[],
  /** 玩家在命名框里打过的字；null ＝ 没动过（用预填值） */
  typedName: string | null = null,
): ForgeVm {
  const owned = forgeParts(state, content);
  const index = organIndex(content);
  // 四型的顺序归 `format.ESSENCE_ORDER`（状态栏的精气柱也念它）—— 两处顺序不一致
  // 会让玩家在招式框里找错那一根柱子
  const essenceLine = ESSENCE_ORDER.map(
    (type) => `${ESSENCE_LABELS[type]} ${state.essence[type]}`,
  ).join(" · ");
  // 一律走 `lifeTuning`（吃天时／出身的 `tuningDelta`）—— `forgePreview` 走的就是它，
  // 这里读 `content.tuning` 会让屏幕上的「招式册 2／4」与代价行的「槽 2/5」自相矛盾
  const t = lifeTuning(state, content);
  const slotsMax = t.forgeSlots;
  const forged: ForgedRowVm[] = state.forgedSkills.map((entry) => ({
    id: entry.id,
    name: entry.name,
    glyph: entry.loreId === null ? "凝" : "古",
    source:
      entry.parts === null
        ? (content.synergies.find((item) => item.id === entry.loreId)?.name ?? "古法")
        : FORGE_SLOTS.map(
            (slot) => content.parts.find((part) => part.id === entry.parts?.[slot])?.name ?? "？",
          ).join("·"),
    effect: [
      // 伤害那一格**恒在**（S1 技能按钮那条铁律的同一形状）：在四手之间挑一手打时，
      // 最该看的正是这个数。招式册摆在主界面上，所以用不依赖交锋态的 `skillDamageRange`
      damageLine(skillDamageRange(state, content, entry.skill)),
      ...(entry.skill.effects ?? []).map((effect) => SKILL_EFFECT_LABELS[effect]),
      ...(entry.skill.woundPart ? [`断其${BODY_PART_NAMES[entry.skill.woundPart]}`] : []),
      `冷却 ${entry.cost.cooldown} 合`,
      `耗势 ${entry.cost.momentum}`,
    ].join(" · "),
    paid: `已付 ${essenceText(entry.cost.essenceType, entry.cost.essence)}`,
  }));

  const knownSet = new Set(knownSynergyIds);
  const lore: LoreRowVm[] = loreOptions(state, content).map((option) => {
    /*
     * **未发现过的古法不许泄露配方与成品**（沿用 S1 图鉴那条铁律：devtools 是玩家伸手
     * 就能开的东西）。判据是跨世图鉴 `Bloodline.knownSynergyIds` —— 引擎不认识跨世资产，
     * 所以这一位只能由客户端把着。已经凑齐了配方（`missingOrganIds` 为空）当然也算见过。
     */
    const known = knownSet.has(option.synergyId) || option.missingOrganIds.length === 0;
    const def = content.synergies.find((item) => item.id === option.synergyId);
    return {
      synergyId: option.synergyId,
      name: known ? option.name : "？",
      recipe: known
        ? option.organIds.map((id) => index.get(id)?.name ?? id).join(" ＋ ")
        : "？",
      known,
      reveal: known ? (def?.reveal ?? null) : null,
      effect: known
        ? [
            option.damage.mid > 0 ? `伤 ${damageText(option.damage)}` : "不出伤",
            ...(option.skill.effects ?? []).map((effect) => SKILL_EFFECT_LABELS[effect]),
            `冷却 ${option.cost.cooldown} 合`,
            `耗势 ${option.cost.momentum}`,
          ].join(" · ")
        : "尚未识得此法。",
      cost: known ? `习得 ${essenceText(option.cost.essenceType, option.cost.essence)} · 槽 1` : "",
      enabled: option.ready,
      disabledReason: known ? loreBlockText(option.blocked, option, index, slotsMax) : "尚未识得",
    };
  });

  const base = {
    essenceLine,
    slotLine: `招式册 ${state.forgedSkills.length}／${slotsMax}`,
    partsLine:
      owned.length === 0 ? "身内尚无可拆之物。" : owned.map((part) => part.name).join(" "),
    forged,
    lore,
    recommended: recommendForge(state, content) !== null,
  };

  /*
   * picks 与身上的部件不同步（蜕变／失去器官之后招式框还开着）时**退回「拼不出来」**，
   * 不把一副脏 picks 喂给 `forgePreview` —— 那会抛错，而抛错在这个项目里会打进
   * `safely` 的 console.error，与「E2E 0 控制台报错」直接冲突。
   */
  const usable =
    picks !== null &&
    FORGE_SLOTS.every((slot) => {
      const part = owned.find((candidate) => candidate.id === picks[slot]);
      return part !== undefined && part[slot] !== undefined;
    }) &&
    new Set(FORGE_SLOTS.map((slot) => picks[slot])).size === FORGE_SLOTS.length;

  if (!usable || picks === null) {
    return {
      ...base,
      slots: [],
      resultEffect: null,
      resultCost: null,
      defaultName: null,
      nameValue: typedName ?? "",
      canForge: false,
      blockedReason: null,
      emptyReason: emptySlotReason(state, content),
    };
  }

  const preview = forgePreview(state, content, picks);
  const nameOk = forgeNameValid(typedName ?? "", t);
  const slots: ForgeSlotVm[] = FORGE_SLOTS.map((slot) => {
    const picked = content.parts.find((part) => part.id === picks[slot]) ?? null;
    return {
      slot,
      label: FORGE_SLOT_NAMES[slot],
      hint: SLOT_HINT[slot],
      pickedName: picked?.name ?? null,
      pickedText: picked?.[slot]?.text ?? null,
      options: forgePartsForSlot(state, content, slot).map((part) =>
        optionVm(state, content, picks, slot, part),
      ),
    };
  });

  return {
    ...base,
    slots,
    resultEffect: skillLine(preview),
    resultCost: `代价：${essenceText(preview.cost.essenceType, preview.cost.essence)}（现有 ${preview.essenceHave}） · 槽 ${preview.slotsUsed + 1}/${preview.slotsMax}`,
    defaultName: preview.defaultName,
    nameValue: typedName ?? preview.defaultName,
    /*
     * 名号不合法时**按钮置灰并说明原因**，而不是让引擎去抛错 —— 引擎抛错在这个项目里
     * 会打到控制台（`safely` 的 console.error），而 E2E 的判据之一就是「0 控制台报错」。
     * 判据本身来自引擎（`forgeNameValid`），两边不各写一份。
     */
    canForge: preview.ready && nameOk,
    blockedReason: nameOk
      ? forgeBlockText(preview)
      : `名号只许 ${t.forgeNameMaxChars} 字以内的汉字`,
    emptyReason: null,
  };
}

/**
 * 一件候选部件的按钮 —— **写的是换上它之后这一手变成什么**，不是这件部件自己的 payload。
 *
 * 这是这一屏「摊开后果」的落点（验收第二问）：玩家不该为了比较两件部件而自己去做加法。
 */
function optionVm(
  state: TaleState,
  content: TaleContent,
  picks: ForgePicks,
  slot: ForgeSlot,
  part: PartDef,
): ForgePartOptionVm {
  const selected = picks[slot] === part.id;
  /*
   * 这件部件正占着别的槽时 **点它 ＝ 两个槽对调**，而不是把按钮灰掉。
   *
   * 灰掉会让这颗按钮只剩一句「已占力道」而没有后果 —— 那正是 S1 在技能池上治过的
   * 「原因顶掉后果」。对调之后它照样摊得开后果，而且比「先把它从那边挪走、再点这边」
   * 少一次点击（owner 的纪律：凝招不得显著推高点击）。
   */
  const conflict = FORGE_SLOTS.find((other) => other !== slot && picks[other] === part.id);
  const picksAfter: ForgePicks =
    conflict === undefined
      ? { ...picks, [slot]: part.id }
      : { ...picks, [slot]: part.id, [conflict]: picks[slot] };
  /*
   * 对调之后那副 picks 未必合法（换过去的那一件在对方的槽里可能没有 payload）——
   * 那时才退回灰按钮，并写清是**哪一件**放不进去。这一支不许抛错：招式框每重画一次
   * 就要给每颗按钮算一次预览，一次抛错会打进 `safely` 的 console.error，
   * 而 E2E 的判据之一是「0 控制台报错」。
   */
  const swapped = conflict !== undefined && content.parts.find((p) => p.id === picks[slot])?.[conflict] === undefined;
  if (swapped) {
    const stuck = content.parts.find((p) => p.id === picks[slot])?.name ?? "？";
    return {
      partId: part.id,
      name: part.name,
      kind: part.kind,
      text: part[slot]?.text ?? "",
      selected: false,
      outcome: "",
      affordable: state.essence[part.essenceType] > 0,
      picksAfter: picks,
      swapNote: null,
      disabledReason: `换不动 —— ${stuck}放不进${FORGE_SLOT_NAMES[conflict as ForgeSlot]}`,
    };
  }
  const preview = forgePreview(state, content, picksAfter);
  return {
    partId: part.id,
    name: part.name,
    kind: part.kind,
    text: part[slot]?.text ?? "",
    selected,
    outcome: `${skillLine(preview)} · ${essenceText(preview.cost.essenceType, preview.cost.essence)}`,
    affordable: preview.affordable,
    picksAfter,
    swapNote: conflict === undefined ? null : `与${FORGE_SLOT_NAMES[conflict]}对调`,
    disabledReason: null,
  };
}

function forgeBlockText(preview: ForgePreview): string | null {
  switch (preview.blocked) {
    case "ok":
      return null;
    case "slots":
      return `招式册已满（${preview.slotsUsed}／${preview.slotsMax}）—— 先忘掉一手`;
    default:
      return `${ESSENCE_LABELS[preview.cost.essenceType]}精气不足（需 ${preview.cost.essence}，现有 ${preview.essenceHave}）`;
  }
}

function loreBlockText(
  blocked: ForgeBlock,
  option: { missingOrganIds: string[]; cost: { essenceType: keyof typeof ESSENCE_LABELS; essence: number }; essenceHave: number },
  index: Map<string, { name: string }>,
  slotsMax: number,
): string | null {
  switch (blocked) {
    case "ok":
      return null;
    case "learned":
      return "已在册中";
    case "missing":
      return `尚缺 ${option.missingOrganIds.map((id) => index.get(id)?.name ?? id).join("、")}`;
    case "slots":
      return `招式册已满（${slotsMax}）—— 先忘掉一手`;
    default:
      return `${ESSENCE_LABELS[option.cost.essenceType]}精气不足（需 ${option.cost.essence}，现有 ${option.essenceHave}）`;
  }
}

/**
 * 拼不出来时**说清缺的是哪一类部件** —— 「部件不足」四个字对玩家的下一步毫无指示，
 * 而「尚缺一件能作附加的部件（毒腺、穴爪、雾目之类）」是一句他明天就能照做的话。
 */
function emptySlotReason(state: TaleState, content: TaleContent): string {
  const missing = FORGE_SLOTS.filter(
    (slot) => forgePartsForSlot(state, content, slot).length === 0,
  );
  if (missing.length > 0) {
    return `尚缺一件能作${missing.map((slot) => FORGE_SLOT_NAMES[slot]).join("／")}的部件 —— 再蜕一件器官试试。`;
  }
  return "三个槽各要一件不同的部件 —— 手上还不够，再蜕一件器官试试。";
}
