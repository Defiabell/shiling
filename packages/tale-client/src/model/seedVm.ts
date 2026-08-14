/**
 * 神种选择屏视图模型（纯）。
 *
 * 「已解锁 / 可解锁 / 点数不足」三态与解锁花费的判定都在这里，界面只挑样式。
 */

import {
  boonCost,
  chartCost,
  loreCost,
  rollPremise,
  type Bloodline,
  type DestinationDef,
  type EnemyDef,
  type OrganDef,
  type SeedDef,
  type SigilDef,
  type TaleContent,
  type TaleState,
} from "@shiling/tale-sim";
import {
  STAT_LABELS,
  STAT_ORDER,
  WAY_LABELS,
  WAY_SCOPES,
  formatSigned,
  skillMulLine,
} from "./format.js";
import { composeAscendGap } from "./chronicleVm.js";

export type SeedLockState = "unlocked" | "affordable" | "locked";

export interface SeedCardVm {
  id: string;
  name: string;
  desc: string;
  cost: number;
  lock: SeedLockState;
  /** 自带器官（第 0 器官） */
  organName: string;
  organDesc: string;
  organTags: string[];
  /** 「猛 +6」这类一次性加成，无加成时为空数组 */
  statMods: string[];
  /** 有战技则给技名，界面上是很强的选择动机 */
  combatSkillName: string | null;
  /** 还差多少血统点（lock === "locked" 时 > 0） */
  shortfall: number;
}

/**
 * [2026-08-13] 「下一世的世道」预告 ＋ 「换条路试试」的具体理由。
 *
 * 为什么摆在择神种这一屏：这是玩家按下「转世」之后看到的第一屏，也是他**唯一一次**
 * 在开局之前做选择的机会。若这一屏只有三张神种卡，那「第二局」就是从同一个起点再来一次；
 * 而「这一世大旱，上一世你死在归山路上差德行一二 —— 旱年难养德，或者试试妖王」
 * 让他带着一个具体的打算进去。
 *
 * 天时／出身能提前知道，是因为引擎的 `rollPremise(seedNum)` 是纯函数、且降世时那两次抽取
 * 恒在最前（见 `createLife`）—— 界面不掷骰，只是提前问了同一个答案。
 */
export interface NextLifeVm {
  /** 这一世的天时（名字 ＋ 机制那一行） */
  skyName: string;
  skyEffect: string;
  originName: string;
  originEffect: string;
  /** 「此世天时：大旱之年」 */
  caption: string;
  /**
   * 上一世的擦肩而过 ＋ 一条建议换的道；没有前世时为 null。
   *
   * 文案由**数据推**（上一世最接近的那条道、差了什么、这一世的天时），不写死。
   */
  advice: string | null;
  /**
   * [S3] 「这一世可以试着凑 X」—— 最多三条**具体**的建议，全部由数据推。
   *
   * ## 它要治的病
   * owner 的原话：「摸不着头脑、不知道要怎么发展」。`advice` 那一句说的是「换条道试试」
   * （目标），这三条说的是**下一步该干什么**（手段）：再得哪一件器官、还差哪一处门槛、
   * 哪一头兽值得花点数参透。没有它，图鉴就只是一张成绩单。
   *
   * ## 铁律：不许泄露未发现的配方（S1）
   * 第一优先级只从**已发现**的组合里推（`Bloodline.knownSynergyIds`）—— 拿一条还没撞见的
   * 组合去写「再得夜瞳即成夜猎之眼」，等于把这一批的全部本钱（意料之外）当建议送掉。
   * 去处的门槛是公开信息（S2 的设计），所以第二优先级可以放心写。
   */
  quests: string[];
}

/**
 * [S1] 「异变图鉴」的一行。
 *
 * 两种形态，**未发现的那一种不许泄露任何配方**（计划的铁律之一）：
 * - 已发现：名号 ＋ 配方（器官名）＋ 那一手的效果 ＋ 因果一句。
 * - 未发现：只有「？」与一句「尚未撞见」—— 连「要几件器官」都不说
 *   （件数本身就是线索，而这一批的全部本钱是「意料之外」）。
 */
export interface SynergyRowVm {
  /** 已发现才有 id（未发现的行连 id 都不给界面，免得从 DOM 里读出来） */
  id: string | null;
  known: boolean;
  /** 已发现＝「溃咬」；未发现恒为「？」 */
  name: string;
  /** 已发现＝「狩齿 ＋ 毒腺」；未发现为空串 */
  recipe: string;
  /** 已发现＝那一手的账（伤害倍率／效果／冷却／代价）；未发现为空串 */
  effect: string;
  /** 已发现＝`SynergyDef.reveal` 那一句因果；未发现＝「尚未撞见」 */
  note: string;
}

/**
 * [S2] 「山川图鉴」的一行 —— 一处去处 ＋ 它的秘藏。
 *
 * 与异变图鉴的**信息分配刚好相反**（`destinations.ts` 头注的那张表）：
 * 去处的名号与门槛**恒可见**（那是欲望展示位：知道幽潭要鳞甲＋浮鳔才会去凑），
 * 秘藏的名号**未得则恒为「？」**（那是「意料之外」的全部本钱）。
 */
export interface PlaceRowVm {
  id: string;
  name: string;
  desc: string;
  /** 门槛那一句：「无门槛」／「需 鳞甲、浮鳔」 —— 恒可见 */
  gate: string;
  /** 历代到过 */
  visited: boolean;
  /** 历代得过此地秘藏 */
  treasureKnown: boolean;
  /** 已得＝「渊心珠」；未得恒为「？」 */
  treasureName: string;
  /** 已得＝`TreasureDef.desc`；未得＝一句「此地必有一物，未得其详」 */
  treasureNote: string;
}

/** [S1] 「血脉」商店的一行：一件已发现过的器官，标价、买不买得起、买没买。 */
export interface BoonRowVm {
  organId: string;
  name: string;
  desc: string;
  /** 「肢位 · 猛 +2 灵 +2 体 +2」 */
  meta: string;
  /** 有战技就报技名（这是买它的主要动机） */
  skillName: string | null;
  cost: number;
  affordable: boolean;
  /**
   * 还差多少血统点（够买或已买时为 0）—— 同屏的神种卡也这么写。
   * 只写「买不起」而不写差多少，玩家就不知道「再活一世够不够」。
   */
  shortfall: number;
  /** 已经买下、下一世自带 */
  chosen: boolean;
}

/**
 * [S3] 「异兽图鉴」的一行。
 *
 * 与异变图鉴同一条铁律：**未照面的只有一个「？」**，连名字都不给（DOM 里也读不出来）。
 * 「青丘一共有几头兽」是分母，那不算泄露；「第六头叫穷奇幼崽、猛 34」是内容，那算。
 */
export interface BeastRowVm {
  /** 已照面才有 id（未照面的连 id 都不给界面） */
  id: string | null;
  known: boolean;
  /** 已照面＝「玄蟒」；未照面恒为「？」 */
  name: string;
  /** 已照面＝「猛 26 · 体 34」；未照面为空串 */
  meta: string;
  /** 已照面＝`EnemyDef.desc`；未照面＝「尚未照面」 */
  note: string;
  /** 已花血统点参透（此后追猎／搏杀读得出确数） */
  lore: boolean;
}

/** [S3] 「图鉴知识」商店的一行：一头已照过面的异兽 ＋ 标价。 */
export interface LoreRowVm {
  enemyId: string;
  name: string;
  /** 买到的是什么（一句人话，不是「+X」）——这一项刻意不给数值加成 */
  gain: string;
  cost: number;
  affordable: boolean;
  shortfall: number;
  /** 已参透 */
  owned: boolean;
}

/** [S3] 「世家印记」商店的一行。 */
export interface SigilRowVm {
  sigilId: string;
  name: string;
  desc: string;
  /** 「每世 灵 +2」这类机制那一行 */
  effect: string;
  cost: number;
  affordable: boolean;
  shortfall: number;
  owned: boolean;
}

/** [S3] 「图录」商店的一行：一处已到过、且有门槛的去处 ＋ 标价。 */
export interface ChartRowVm {
  destinationId: string;
  name: string;
  /** 「需 鳞甲、浮鳔」—— 买它省掉的就是这一条 */
  gate: string;
  cost: number;
  affordable: boolean;
  shortfall: number;
  /** 已买下（下一世直通此处） */
  chosen: boolean;
}

/**
 * [S1 ＋ S2 ＋ S3] 图鉴（四录）与血统（四事）。
 *
 * 为什么与神种卡同屏：血统点此前**只能**解锁神种（三枚共 13 点），13 点花完后一世产的
 * 3〜8 点永久无处可花 —— owner 的原话「血统没什么用途」说的就是这个。四类消费与四录图鉴
 * 摆在同一屏，转世那一刻的问题才从「按哪枚种」变成「这一世我要带什么、去凑什么」。
 *
 * ## [S3] 「记录」与「货架」分开
 * 图鉴四录（异变／山川／异兽／前传）**一颗按钮都没有** —— 它回答「我见过什么」。
 * 血统四事（血脉／图录／世家印记／图鉴知识）**全是按钮** —— 它回答「这几点花在哪」。
 * 混在一起的后果在 S2 末尾已经看到过：山川那一段既要写秘藏又要挂价钱，读起来是一张
 * 既像成绩单又像账单的东西。
 */
export interface CodexVm {
  /** 已发现的组合数 ／ 全部（「已知 3/10」） */
  knownCount: number;
  total: number;
  caption: string;
  rows: SynergyRowVm[];
  /** 血脉可买的器官（已发现过的，最近发现的在前）；一件都没发现过时为空 */
  boons: BoonRowVm[];
  /** 已选的血脉（下一世自带），null ＝ 没买 */
  chosenBoonName: string | null;
  /** 一件都还没见过时的那句话（不留空白区） */
  boonEmptyNote: string | null;
  /** [S2] 山川图鉴：六处去处 ＋ 各自的秘藏 */
  places: PlaceRowVm[];
  /** 「已至之地 3/6 · 秘藏 1/6」 */
  placeCaption: string;
  /** [S3] 异兽图鉴：八头，未照面的恒为「？」 */
  beasts: BeastRowVm[];
  /** 「已识异兽 5/8」 */
  beastCaption: string;
  /**
   * [S3] 图鉴总览那一条 —— 四个分数并排。
   *
   * 它是这一屏「摸得着的发展方向」的入口：四个分母摆在一起，玩家一眼看得出
   * 「异变才 3/10，而山川已经 5/6」——「这一世该往哪使劲」的第一层答案就在这一行。
   */
  summary: string;
  /** [S3] 图录货架（只列**已到过且有门槛**的去处；兽径与没去过的不上架） */
  charts: ChartRowVm[];
  /** 已买下的图录（下一世直通），null ＝ 没买 */
  chosenChartName: string | null;
  /** 一处有门槛的地方都还没到过时的那句话 */
  chartEmptyNote: string | null;
  /** [S3] 世家印记货架（全部五枚，已受的标出来） */
  sigils: SigilRowVm[];
  /** 「已受 1/3 枚」 */
  sigilCaption: string;
  /** [S3] 图鉴知识货架（只列已照过面的兽） */
  lores: LoreRowVm[];
  /** 「已参透 2/8」 */
  loreCaption: string;
  /** 一头兽都还没照过面时的那句话 */
  loreEmptyNote: string | null;
}

export interface SeedScreenVm {
  points: number;
  cards: SeedCardVm[];
  /** [S1] 异变图鉴 ＋ 血脉 */
  codex: CodexVm;
  /** 前世列传目录，**最新在前** */
  chronicle: { title: string; body: string; ending: string; years: number; organCount: number }[];
  /** 已历几世 */
  lives: number;
  /** [2026-08-13] 下一世的世道预告与「换条路」的理由 */
  next: NextLifeVm;
}

function statModLabels(seed: SeedDef): string[] {
  const mods = seed.organ.statMods;
  if (!mods) return [];
  const out: string[] = [];
  for (const key of STAT_ORDER) {
    const value = mods[key];
    if (value === undefined || value === 0) continue;
    out.push(`${STAT_LABELS[key]} ${formatSigned(value)}`);
  }
  return out;
}

/**
 * 「换条路试试」那一句。
 *
 * 三段都从数据推：① 上一世死在哪条道上、差了什么（`composeAscendGap`，与死亡屏同源）；
 * ② 这一世的天时会让那条道更难还是更易（按天时改的那几项判）；③ 建议换的那条道
 * （挑上一世**没走**的、且这一世的天时帮得上的一条）。
 *
 * 不写死是刻意的：写死的建议在第三世就开始重复，而这一屏的全部作用就是让人觉得
 * 「下一局有别的东西可试」。
 */
function composeAdvice(last: TaleState | null, content: TaleContent, skyId: string): string | null {
  if (!last) return null;
  const gap = composeAscendGap(last, content);
  const lastLabel = WAY_LABELS[gap.way];
  const head =
    gap.gapItems.length === 0
      ? `上一世你走通了${lastLabel}。`
      : `上一世你死在${lastLabel}的路上，${gap.gapItems.join("、")}。`;
  /*
   * 建议哪一条：跳过上一世那条，挑「这一世的天时帮得上」的一条。
   * 对应关系写在这里而不是内容里，因为它是**界面的建议**，不是规则（引擎不认识「建议」）。
   */
  const favoured: Record<string, "shen" | "yaowang" | "guishan" | "hualing"> = {
    "sky-drought": "yaowang",
    "sky-beast-tide": "yaowang",
    "sky-spirit-flux": "hualing",
    "sky-early-winter": "guishan",
    "sky-plain": "shen",
  };
  const wanted = favoured[skyId] ?? "shen";
  const suggest = wanted === gap.way ? (gap.way === "shen" ? "guishan" : "shen") : wanted;
  return `${head}这一世不妨试试${WAY_LABELS[suggest]} —— ${WAY_SCOPES[suggest]}。`;
}

/**
 * [S3] 「这一世可以试着凑 X」—— 最多三条，全部由数据推。
 *
 * ## 优先级链（顺序就是「离玩家最近」的顺序）
 * 1. **已发现的组合差一件**：上一世身上已有配方的一部分。这是最强的一条 ——
 *    它同时给出目标（那一手技）、手段（那一件器官）与因果（图鉴上已经写着的那句 reveal）。
 *    ⚠️ 只从 `knownSynergyIds` 里推（S1 铁律：未发现的配方一个字都不许漏）。
 * 2. **没去过的地方差一件**：去处的门槛是**公开**信息（S2 的设计），所以这一条可以写全，
 *    而且历代没到过的那几处正是「秘藏未得」的那几格。
 * 3. **已照面但没参透的兽**：花得起的才写 —— 一条买不起的建议不是建议。
 * 4. **印记还有空位**：世世都在的那一类，摆在最后是因为它不改变「这一世怎么打」。
 *
 * 一条都推不出来时（头一世）给一句兜底：不留空，否则这一段在第一世是消失的，
 * 而第一世恰恰是最需要被告知「这游戏在攒什么」的时候。
 */
function composeQuests(
  bloodline: Bloodline,
  content: TaleContent,
  last: TaleState | null,
): string[] {
  const owned = new Set(last?.organIds ?? []);
  const quests: string[] = [];
  const organNameOf = (id: string): string => organName(content, id);

  /** 得了这一件器官会顺带开哪几处地方（门槛的其余部分上一世已在身上） */
  const opensWith = (organId: string): DestinationDef[] =>
    content.destinations.filter(
      (place) =>
        place.requiresOrganIds.includes(organId) &&
        place.requiresOrganIds.every((id) => id === organId || owned.has(id)),
    );

  // 1. 已发现的组合，差一件就齐（差得越少排越前；同数按内容表顺序）
  const nearSynergies = content.synergies
    .filter((synergy) => bloodline.knownSynergyIds.includes(synergy.id))
    .map((synergy) => ({
      synergy,
      missing: synergy.organIds.filter((id) => !owned.has(id)),
    }))
    .filter((item) => item.missing.length === 1 && item.missing.length < item.synergy.organIds.length);
  const nearest = nearSynergies[0];
  if (nearest) {
    const missingId = nearest.missing[0] ?? "";
    const have = nearest.synergy.organIds.filter((id) => owned.has(id)).map(organNameOf);
    const opened = opensWith(missingId);
    const boon = bloodline.knownOrganIds.includes(missingId)
      ? `（血脉 ${boonCost(missingId, content)} 即可带上）`
      : "";
    quests.push(
      `上一世你已有${have.join("、")}，再得${organNameOf(missingId)}即成「${nearest.synergy.name}」${
        opened.length > 0 ? `，${opened.map((place) => place.name).join("、")}随之而开` : ""
      }。${boon}`,
    );
  }

  /*
   * 2. 历代没到过的地方，且**只差一件**门槛。
   *
   * 排序按门槛件数**倒序**：过滤之后还留着的双件门槛，说明上一世已经凑齐了它的一半 ——
   * 「已经走到一半」比「从头开始」更值得摆在前面。措辞也跟着分两种：差一件里的一件，
   * 与「这一处只要一件」不是同一句话（后者对头一世的玩家才是真的，写成「只差」是在撒谎）。
   */
  const nearPlace = [...content.destinations]
    .filter((place) => place.requiresOrganIds.length > 0)
    .filter((place) => !bloodline.knownDestinationIds.includes(place.id))
    .map((place) => ({ place, missing: place.requiresOrganIds.filter((id) => !owned.has(id)) }))
    .filter((item) => item.missing.length === 1)
    .sort((a, b) => b.place.requiresOrganIds.length - a.place.requiresOrganIds.length)[0];
  if (nearPlace) {
    const missingId = nearPlace.missing[0] ?? "";
    const gate = nearPlace.place.requiresOrganIds.map(organNameOf).join("、");
    const halfway = nearPlace.missing.length < nearPlace.place.requiresOrganIds.length;
    quests.push(
      halfway
        ? `${nearPlace.place.name}历代未至 —— 门槛是${gate}，上一世你已有其一，只差${organNameOf(missingId)}。那儿有一物，青丘没有第二处。`
        : `${nearPlace.place.name}历代未至 —— 门槛只要一件${gate}。那儿有一物，青丘没有第二处。`,
    );
  }

  // 3. 已照面、还没参透、且**买得起**的那一头（越凶的越值得写在前面）
  const loreTarget = [...content.enemies]
    .filter(
      (enemy) =>
        bloodline.knownEnemyIds.includes(enemy.id) &&
        !bloodline.loreEnemyIds.includes(enemy.id) &&
        bloodline.points >= loreCost(enemy.id, content),
    )
    .sort((a, b) => b.meng - a.meng)[0];
  if (loreTarget && quests.length < 3) {
    quests.push(
      `${loreTarget.name}你已照过面 —— 血统 ${loreCost(loreTarget.id, content)} 可参透它，此后追猎读得出确切警觉、搏杀读得出它下一手要干什么。`,
    );
  }

  // 4. 印记还有空位（世世都在的那一类）
  const sigilLeft = content.tuning.sigilCap - bloodline.sigilIds.length;
  const cheapest = content.sigils
    .filter((sigil) => !bloodline.sigilIds.includes(sigil.id))
    .sort((a, b) => a.cost - b.cost)[0];
  if (sigilLeft > 0 && cheapest && quests.length < 3) {
    quests.push(
      `世家印记还可再受 ${sigilLeft} 枚（每枚血统 ${cheapest.cost}）—— 那是唯一世世都在的东西。`,
    );
  }

  if (quests.length > 0) return quests.slice(0, 3);
  return [
    `图鉴上还是一片问号：异变 ${content.synergies.length} 格、山川 ${content.destinations.length} 处、异兽 ${content.enemies.length} 头。先活过一世，蜕一件形，自会撞见第一格。`,
  ];
}

/** 器官槽位的单字读法（与蜕变卷轴同一套字）。 */
const SLOT_GLYPH: Record<string, string> = {
  eye: "窍",
  tooth: "颌",
  hide: "皮",
  limb: "肢",
  gut: "腑",
  spirit: "神",
};

/** 组合技那一手的账（按倍率读，与异变揭示演出共用 `skillMulLine`）。 */
function synergySkillText(content: TaleContent, id: string): string {
  const synergy = content.synergies.find((item) => item.id === id);
  return synergy ? skillMulLine(synergy.skill, content.tuning) : "";
}

function organName(content: TaleContent, id: string): string {
  return content.organs.find((organ) => organ.id === id)?.name ?? id;
}

function organMeta(organ: OrganDef): string {
  const slot = SLOT_GLYPH[organ.slot] ?? organ.slot;
  const mods = STAT_ORDER.filter((key) => (organ.statMods?.[key] ?? 0) !== 0).map(
    (key) => `${STAT_LABELS[key]} ${formatSigned(organ.statMods?.[key] ?? 0)}`,
  );
  return [`${slot}位`, ...mods].join(" · ");
}

/**
 * [S1] 图鉴 ＋ 血脉。
 *
 * **顺序恒定**（按 `content.synergies`）而不是「已发现的排前面」：位置固定，玩家才会记住
 * 「第三格还是问号」—— 那一格就是他下一世想去凑的东西。若已发现的往前挤，问号的位置
 * 每世都在动，图鉴就只是一个计数器。
 */
function buildCodexVm(bloodline: Bloodline, content: TaleContent): CodexVm {
  const known = new Set(bloodline.knownSynergyIds);
  const rows: SynergyRowVm[] = content.synergies.map((synergy) =>
    known.has(synergy.id)
      ? {
          id: synergy.id,
          known: true,
          name: synergy.name,
          recipe: synergy.organIds.map((id) => organName(content, id)).join(" ＋ "),
          effect: synergySkillText(content, synergy.id),
          note: synergy.reveal,
        }
      : { id: null, known: false, name: "？", recipe: "", effect: "", note: "尚未撞见" },
  );
  const boons: BoonRowVm[] = [...bloodline.knownOrganIds]
    .reverse()
    .map((id) => content.organs.find((organ) => organ.id === id))
    .filter((organ): organ is OrganDef => organ !== undefined)
    .map((organ) => {
      const cost = boonCost(organ.id, content);
      return {
        organId: organ.id,
        name: organ.name,
        desc: organ.desc,
        meta: organMeta(organ),
        skillName: organ.combatSkill?.name ?? null,
        cost,
        // [S1] 与 `buyBoon` **逐条同形**（一世只带一件，买过就整排锁住）——
        // 界面的置灰是那条规则的镜像，不许比它更严也不许更松
        affordable: bloodline.boonOrganId === null && bloodline.points >= cost,
        shortfall: Math.max(0, cost - bloodline.points),
        chosen: bloodline.boonOrganId === organ.id,
      };
    });
  const chosen = boons.find((boon) => boon.chosen);
  const visited = new Set(bloodline.knownDestinationIds);
  const found = new Set(bloodline.foundTreasureIds);
  const places: PlaceRowVm[] = content.destinations.map((destination) => {
    const gate =
      destination.requiresOrganIds.length === 0
        ? "无门槛 —— 何时都去得"
        : `需 ${destination.requiresOrganIds.map((id) => organName(content, id)).join("、")}`;
    const treasureKnown = found.has(destination.treasure.id);
    return {
      id: destination.id,
      name: destination.name,
      desc: destination.desc,
      gate,
      visited: visited.has(destination.id),
      treasureKnown,
      // 未得的秘藏**只渲染一个「？」**：不给 id、不给名字，DOM 里也读不出来（同 S1 图鉴的铁律）
      treasureName: treasureKnown ? destination.treasure.name : "？",
      treasureNote: treasureKnown ? destination.treasure.desc : "此地必有一物，未得其详。",
    };
  });
  /*
   * [S3] 异兽图鉴 ＋ 三个新货架。
   *
   * 三处判据全部**镜像 persist 层**（`buyLore`／`buySigil`／`buyChart`）而不是自己再写一遍：
   * S1 的血脉踩过这个坑 —— 同一条规则两套语义，而花钱的那一份是松的。
   */
  const metEnemies = new Set(bloodline.knownEnemyIds);
  const loreOwned = new Set(bloodline.loreEnemyIds);
  const beasts: BeastRowVm[] = content.enemies.map((enemy) =>
    metEnemies.has(enemy.id)
      ? {
          id: enemy.id,
          known: true,
          name: enemy.name,
          meta: beastMeta(enemy),
          note: enemy.desc,
          lore: loreOwned.has(enemy.id),
        }
      : { id: null, known: false, name: "？", meta: "", note: "尚未照面", lore: false },
  );
  const lores: LoreRowVm[] = content.enemies
    .filter((enemy) => metEnemies.has(enemy.id))
    .map((enemy) => {
      const cost = loreCost(enemy.id, content);
      const owned = loreOwned.has(enemy.id);
      return {
        enemyId: enemy.id,
        name: enemy.name,
        gain: "追猎读得出确切警觉与命中 · 搏杀读得出它下一手",
        cost,
        affordable: !owned && bloodline.points >= cost,
        shortfall: owned ? 0 : Math.max(0, cost - bloodline.points),
        owned,
      };
    });
  const sigilOwned = new Set(bloodline.sigilIds);
  const sigilFull = sigilOwned.size >= content.tuning.sigilCap;
  const sigils: SigilRowVm[] = content.sigils.map((sigil) => {
    const owned = sigilOwned.has(sigil.id);
    return {
      sigilId: sigil.id,
      name: sigil.name,
      desc: sigil.desc,
      effect: sigilEffect(sigil),
      cost: sigil.cost,
      // 与 `buySigil` 逐条同形：已受／满员／点数不够，三者任一即买不得
      affordable: !owned && !sigilFull && bloodline.points >= sigil.cost,
      shortfall: owned ? 0 : Math.max(0, sigil.cost - bloodline.points),
      owned,
    };
  });
  const charts: ChartRowVm[] = content.destinations
    // 只上架「历代到过 ＋ 有门槛」的：兽径的 `chartCost` 恒 0（判据在引擎，界面不写第二条 if）
    .filter((place) => visited.has(place.id) && chartCost(place.id, content) > 0)
    .map((place) => {
      const cost = chartCost(place.id, content);
      const chosenChart = bloodline.chartedDestinationId === place.id;
      return {
        destinationId: place.id,
        name: place.name,
        gate: `需 ${place.requiresOrganIds.map((id) => organName(content, id)).join("、")}`,
        cost,
        affordable: bloodline.chartedDestinationId === null && bloodline.points >= cost,
        // 已买下的那一行 `shortfall` 归零（同 `lores`／`sigils`）——买过之后点数已经扣掉了，
        // 再报一个「尚差 N」是在说一件已经不成立的事
        shortfall: chosenChart ? 0 : Math.max(0, cost - bloodline.points),
        chosen: chosenChart,
      };
    });

  return {
    knownCount: known.size,
    total: content.synergies.length,
    caption: `已知异变 ${known.size}/${content.synergies.length}`,
    rows,
    boons,
    chosenBoonName: chosen?.name ?? null,
    boonEmptyNote:
      boons.length > 0
        ? null
        : "还没有蜕出过任何器官 —— 活过一世、蜕一件形，这里就有东西可带了。",
    places,
    placeCaption: `已至之地 ${visited.size}/${places.length} · 秘藏 ${found.size}/${places.length}`,
    beasts,
    beastCaption: `已识异兽 ${metEnemies.size}/${content.enemies.length}`,
    summary: [
      `已知异变 ${known.size}/${content.synergies.length}`,
      `已至之地 ${visited.size}/${places.length}`,
      `秘藏 ${found.size}/${places.length}`,
      `已识异兽 ${metEnemies.size}/${content.enemies.length}`,
      `历代 ${bloodline.chronicle.length} 篇`,
    ].join(" · "),
    charts,
    chosenChartName: charts.find((row) => row.chosen)?.name ?? null,
    chartEmptyNote:
      charts.length > 0
        ? null
        : "还没到过任何一处有门槛的地方 —— 图录是走到过才画得出来的东西。",
    sigils,
    sigilCaption: `已受 ${sigilOwned.size}/${content.tuning.sigilCap} 枚`,
    lores,
    loreCaption: `已参透 ${loreOwned.size}/${content.enemies.length}`,
    loreEmptyNote:
      lores.length > 0 ? null : "还没跟任何一头兽照过面 —— 追一次、打一架，这里就有东西可参了。",
  };
}

/** 异兽图鉴那一行的两个数（已照面才给）。 */
function beastMeta(enemy: EnemyDef): string {
  return `猛 ${enemy.meng} · 体 ${enemy.hp}`;
}

/** 印记的机制那一行（属性与饱食两种形态，读法与器官卡同体例）。 */
function sigilEffect(sigil: SigilDef): string {
  const parts = STAT_ORDER.filter((key) => (sigil.statMods[key] ?? 0) !== 0).map(
    (key) => `${STAT_LABELS[key]} ${formatSigned(sigil.statMods[key] ?? 0)}`,
  );
  if (sigil.hungerBonus) parts.push(`起手饱食 ${formatSigned(sigil.hungerBonus)}`);
  return `每世 ${parts.join(" ") || "—"}`;
}

/**
 * @param nextSeedNum 下一世将要用的种子数（`TaleApp` 按 `baseSeed + lifeIndex × φ` 算）——
 *   有了它才能**提前**问出这一世的天时与出身（`rollPremise` 是纯函数，与 `createLife` 同解）
 * @param lastLife 上一世的终态；没有前世时传 null
 */
export function buildSeedScreenVm(
  bloodline: Bloodline,
  content: TaleContent,
  nextSeedNum: number,
  lastLife: TaleState | null = null,
): SeedScreenVm {
  const unlocked = new Set(bloodline.unlockedSeedIds);
  const cards: SeedCardVm[] = content.seeds.map((seed) => {
    const isUnlocked = unlocked.has(seed.id) || seed.cost <= 0;
    const shortfall = Math.max(0, seed.cost - bloodline.points);
    const lock: SeedLockState = isUnlocked ? "unlocked" : shortfall === 0 ? "affordable" : "locked";
    return {
      id: seed.id,
      name: seed.name,
      desc: seed.desc,
      cost: seed.cost,
      lock,
      organName: seed.organ.name,
      organDesc: seed.organ.desc,
      organTags: seed.organ.tags,
      statMods: statModLabels(seed),
      combatSkillName: seed.organ.combatSkill?.name ?? null,
      shortfall: isUnlocked ? 0 : shortfall,
    };
  });

  const { sky, origin } = rollPremise(nextSeedNum, content);
  return {
    points: bloodline.points,
    cards,
    codex: buildCodexVm(bloodline, content),
    next: {
      skyName: sky.name,
      skyEffect: sky.effect,
      originName: origin.name,
      originEffect: origin.effect,
      caption: `此世天时　${sky.name} · ${origin.name}`,
      advice: composeAdvice(lastLife, content, sky.id),
      quests: composeQuests(bloodline, content, lastLife),
    },
    chronicle: [...bloodline.chronicle].reverse().map((entry) => ({
      title: entry.title,
      body: entry.body,
      ending: entry.ending,
      years: entry.years,
      organCount: entry.organCount,
    })),
    lives: bloodline.chronicle.length,
  };
}
