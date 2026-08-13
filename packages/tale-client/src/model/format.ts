/**
 * 纯格式化工具 —— 状态数字 → 界面文案。
 *
 * 全部无 DOM 依赖，单测直接盖。中文文案一律全角标点。
 */

import {
  cnNumeral,
  type CombatSkillDef,
  type CombatSkillEffect,
  type EndingType,
  type EssenceType,
  type OrganSlot,
  type Season,
  type TaleTuning,
  type WayGateId,
  type WayId,
} from "@shiling/tale-sim";

/**
 * 岁数汉字化：0 → "初"，1〜99 → "一"…"九十九"，≥100 退回阿拉伯数字。
 *
 * 数字风格的分工（全局一致，别混）：**散文里的数字一律汉字** —— 状态栏的岁数
 * （「三岁 · 秋 · 青丘」）、列传卷轴的正文与元信息、死亡屏摘要；**只有要横向比对的量值
 * 用阿拉伯数字**（属性／饱食／精气／血统点这些盯着看涨跌的）。列传正文由引擎按 B2 的
 * 模板生成，那边同样是汉字（`{{years|cn}}`），所以卷轴上下不会并置两种数字体系。
 *
 * 汉字数字表只有一份，在 tale-sim（`cnNumeral`）—— 界面与列传模板共用它。
 */
export function formatYearCn(year: number): string {
  const y = Math.floor(year);
  if (!Number.isFinite(y) || y <= 0) return "初";
  return cnNumeral(y);
}

/** 计数汉字化（器官件数、蜕变次数等）：0〜99 给汉字，越界退回阿拉伯数字。 */
export function formatCountCn(count: number): string {
  return cnNumeral(count);
}

export const SEASON_NAMES: readonly [string, string, string, string] = ["春", "夏", "秋", "冬"];

export function formatSeason(season: Season): string {
  return SEASON_NAMES[season];
}

export const REGION_NAMES: Record<string, string> = { qingqiu: "青丘" };

export function formatRegion(region: string): string {
  return REGION_NAMES[region] ?? region;
}

/** 「三岁 · 秋 · 青丘」 */
export function formatWhen(year: number, season: Season, region: string): string {
  return `${formatYearCn(year)}岁 · ${formatSeason(season)} · ${formatRegion(region)}`;
}

export const STAT_LABELS = { meng: "猛", ling: "灵", ti: "体", de: "德" } as const;
export type StatKey = keyof typeof STAT_LABELS;
export const STAT_ORDER: readonly StatKey[] = ["meng", "ling", "ti", "de"];

/**
 * 属性的**一句机制**（不是风味）。
 *
 * 原先这里写的是「搏杀之力」「血肉与寿数」——读完仍然不知道那个数字改变了什么，于是
 * owner 的原话是「每个属性值有啥用……只能乱点」。真正的说明由 `detailVm` 用玩家当前的
 * 数值实例化（「出手底伤 4　·　扑击命中 +4%」），本表只留一句**它管哪一摊**，
 * 用在详情浮层的副标题上，好让人知道点开会看到什么。
 */
export const STAT_SCOPES: Record<StatKey, string> = {
  meng: "搏杀出手与扑击命中",
  ling: "遁走成算、登神与化灵的门槛、抉择",
  ti: "搏杀血量与寿限",
  de: "登神与归山的门槛、抉择",
};

/** 器官槽位的汉字名（`OrganDef.slot` → 屏幕上的字）。 */
export const ORGAN_SLOT_LABELS: Record<OrganSlot, string> = {
  eye: "目",
  tooth: "齿",
  hide: "皮",
  limb: "肢",
  gut: "腹",
  spirit: "神",
};

export const ESSENCE_LABELS: Record<EssenceType, string> = {
  zu: "足",
  lin: "鳞",
  xue: "穴",
  meng: "猛",
};
export const ESSENCE_ORDER: readonly EssenceType[] = ["zu", "lin", "xue", "meng"];

export const ENDING_LABELS: Record<EndingType, string> = {
  starve: "饿殍",
  slain: "横死",
  oldage: "寿终",
  // [2026-08-13] `ascend` 现在读作**成道**，具体哪一条道见 `WAY_LABELS`（`endingLabelOf`）
  ascend: "成道",
};

/** 四条道的汉字名（`WayId` → 屏幕上的字）。 */
export const WAY_LABELS: Record<WayId, string> = {
  shen: "登神",
  yaowang: "妖王",
  guishan: "归山",
  hualing: "化灵",
};

/** 一句话说清这条道要什么（横带的 tab 悬停、降世屏的四道清单都用它）。 */
export const WAY_SCOPES: Record<WayId, string> = {
  shen: "灵德双修，且尝过神兽",
  yaowang: "以杀立威 —— 夺命够多，猛够高",
  guishan: "活得久而德厚 —— 寿终即成道",
  hualing: "灵性极高，且一世不杀一命",
};

/**
 * 死亡／成道屏的门楣题字。
 *
 * 四条道各一句：`ENDING_LABELS.ascend` 只是「成道」两个字，而玩家要读到的是**哪一种**成 ——
 * 归山那句尤其不能与登神共用（一个是白光贯顶，一个是卧于旧穴）。
 */
export const WAY_EPITAPHS: Record<WayId, string> = {
  shen: "白光贯顶，脱兽籍而列神班。",
  yaowang: "众兽伏于道左，山中之事自此决于你。",
  guishan: "寿数既满，德亦既厚 —— 山野送之。",
  hualing: "一世未曾饮血，形骸随风而散。",
};

/** 结局的门楣二字：成道时报**道名**（登神／妖王／归山／化灵），其余照 `ENDING_LABELS`。 */
export function endingLabelOf(ending: EndingType, way: WayId | null): string {
  return ending === "ascend" && way !== null ? WAY_LABELS[way] : ENDING_LABELS[ending];
}

/** 结局的一句话定性：同上分道。 */
export function epitaphOf(ending: EndingType, way: WayId | null): string {
  return ending === "ascend" && way !== null ? WAY_EPITAPHS[way] : ENDING_EPITAPHS[ending];
}

/**
 * 死亡屏的一句话定性（列传正文之外的门楣题字）。
 *
 * [M1-P2] `oldage` 改成**明确的失败**：原句「寿数既尽，卧于旧穴而化」读起来像一件圆满的事，
 * 而 owner 验收 M0 的原话是「最后寿终正寝，让人没有再次玩的欲望」。中性的收尾不会让人
 * 追问「我差了什么」—— 这一屏的下一行正是差距报告，题字得先把人推到那个问题上。
 */
export const ENDING_EPITAPHS: Record<EndingType, string> = {
  starve: "饥馑连季，形销骨立。",
  slain: "力尽爪牙之下，血沃荒原。",
  oldage: "终未成器，与草木同朽。",
  ascend: "白光贯顶，脱兽籍而列神班。",
};

/** 门槛的汉字名（`WayGate.id` → 屏幕上那一个字）。同一个 id 在不同道里需求值不同，字一样。 */
export const WAY_GATE_LABELS: Record<WayGateId, string> = {
  year: "寿",
  ling: "灵",
  de: "德",
  meng: "猛",
  lives: "杀",
  divine: "神",
  nokill: "净",
};

/**
 * 差距报告里的说法：「灵性差九」「差两条命」。
 *
 * 措辞刻意用「差多少」而不是「有多少」：`8/15` 是一个读数，「差七岁」是一件没做完的事 ——
 * 两者信息量相同，后者才会让人想再开一世（M1-P2 立的规矩，这里沿用）。
 *
 * `nokill` 是**唯一的 max 类门槛**，`short` 读作「已经夺了几条命」，所以它的说法是
 * 「已夺三命」而不是「差三命」—— 那不是努力就能补上的差距，是这条道已经关了。
 */
export const WAY_GATE_SHORTFALL: Record<WayGateId, (short: number) => string> = {
  year: (short) => `寿数差${formatCountCn(short)}岁`,
  ling: (short) => `灵性差${formatCountCn(short)}`,
  de: (short) => `德行差${formatCountCn(short)}`,
  meng: (short) => `勇猛差${formatCountCn(short)}`,
  lives: (short) => `尚须夺命${formatCountCn(short)}`,
  divine: () => "未尝神兽",
  nokill: (short) => `已夺${formatCountCn(short)}命`,
};

/** 门槛「怎么长」—— 详情浮层里那一行「往哪走」。 */
export const WAY_GATE_HOWTO: Record<WayGateId, string> = {
  year: "活下去：每年四季，别饿死也别被打死（寿限由体质定，抉择里的寿元能加）",
  ling: "抉择里那些「看懂了什么」的分支，加雾目／灵犀之类的器官",
  de: "抉择里那些不占便宜的选项 —— 器官几乎不给德",
  meng: "吃猛之精气蜕出的器官，加抉择里那些硬碰硬的分支",
  lives: "追猎得手与搏杀取胜各算一条命（事件里明写杀生的抉择也算）",
  divine: "战胜带神性的兽，或与垂死的神物结一次缘",
  nokill: "不狩猎得手、不搏杀取胜、不选明写杀生的抉择 —— 靠探索与休憩活着",
};

/** 带符号的增量文案：+6 / −2 / 0 用全角减号，避免与连字符混淆。 */
export function formatSigned(value: number): string {
  if (value > 0) return `+${value}`;
  if (value < 0) return `−${Math.abs(value)}`;
  return "0";
}

const CN_DIGITS = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"] as const;

/**
 * 概率的汉字读法：0.72 → 「七成二」。整成时省掉零（0.7 → 「七成」）。
 *
 * 追猎屏、搏杀屏与属性详情共用一份 —— 同一个游戏里「命中七成四」与「遁走 66%」两种读法
 * 并置，玩家要在脑子里换算两次单位。
 *
 * `zeroLabel` 是唯一的方言：搏杀屏的「招反击」写 `无` 比写 `〇成` 短且更像话，
 * 而量表类读数要的是「〇成」这个量。除此之外三处逐字同解。
 */
export function chanceCn(chance: number, zeroLabel = "〇成"): string {
  const tenths = Math.round(chance * 100);
  if (tenths >= 100) return "十成";
  if (tenths <= 0) return zeroLabel;
  const shi = Math.floor(tenths / 10);
  const yu = tenths % 10;
  const head = CN_DIGITS[shi] ?? "〇";
  return yu === 0 ? `${head}成` : `${head}成${CN_DIGITS[yu] ?? ""}`;
}

/** 百分比（0〜1 → 0〜100 整数），越界夹紧。 */
export function toPercent(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  return Math.round(Math.min(1, Math.max(0, ratio)) * 100);
}

/**
 * [S1] 十档技能效果的**短读法** —— 搏杀屏按钮、异变图鉴、器官 chip 共用这一份。
 *
 * 为什么必须共用：`CombatSkillEffect` 的值是引擎钩子的英文 id（`venom`／`thorns`），
 * 而这一屏是楷体古卷。三处各写一份的话，「反刺」哪天在图鉴里就会变成「thorns」——
 * 那种漂移只有实机读文字时才发现（同 `ORGAN_SLOT_LABELS` 上提的理由）。
 *
 * 详情浮层里那一版更长（把 tuning 的数实例化出来），见 `detailVm.SKILL_EFFECT_DETAIL`。
 * 这里刻意压到 6〜8 字：186px 宽的按钮上，一句「附毒·它数合不得起势」会把那一行从两行
 * 撑成三行，十来颗按钮就多滚一整行（实机量的）。**信息不减，字数减** —— 完整的账在详情里。
 */
export const SKILL_EFFECT_LABELS: Record<CombatSkillEffect, string> = {
  venom: "附毒·数合不起势",
  bleed: "流血·每合自损",
  stun: "顿挫·下合只守",
  blind: "蒙目·多半打空",
  armor: "护体·受伤减半",
  thorns: "反刺·它打你自伤",
  brace: "硬受·这合免伤",
  bolt: "必定脱身",
  insight: "明识·读得出意图",
  heal: "回血",
};

/**
 * [S1] 一个技的账，**按倍率读**：「伤 ×2.6 · 附毒·数合不起势 · 冷却 4 合 · 代价 自伤 3」。
 *
 * 两处共用：异变揭示演出与转世屏的图鉴 —— 那两处都**不在战斗中**，算不出真实伤害区间
 * （`combatPreview` 要求 `state.combat` 非空），所以只能报倍率。
 *
 * 与搏杀屏按钮上那一行（`combatVm.skillEffectText`）的分工是**有意的**：按钮在战斗中，
 * 报的是引擎算好的**真实区间**（「伤 7〜9」）。同一个技在两处读法不同，因为一处有上下文、
 * 一处没有 —— 若图鉴也写「伤 7〜9」，那就是拿某一世的猛去许诺下一世（界面不许承诺
 * 引擎不保证的事）。
 */
export function skillMulLine(skill: CombatSkillDef, tuning: TaleTuning): string {
  const mul = skill.damageMul ?? tuning.organSkillDamageMul;
  const parts: string[] = [
    mul <= 0 ? "不出伤" : `伤 ×${mul}${skill.stat === "ling" ? "（按灵算）" : ""}`,
  ];
  for (const effect of skill.effects ?? []) parts.push(SKILL_EFFECT_LABELS[effect]);
  parts.push(`冷却 ${skill.cooldown ?? tuning.combatSkillCooldown} 合`);
  if (skill.cost) {
    parts.push(
      skill.cost.kind === "hp"
        ? `代价 自伤 ${skill.cost.amount}`
        : `代价 ${ESSENCE_LABELS[skill.cost.type]}之精气 ${skill.cost.amount}`,
    );
  }
  return parts.join(" · ");
}
