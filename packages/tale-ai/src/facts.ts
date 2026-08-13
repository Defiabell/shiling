/**
 * 从一世终态提取「AI 史官能写的全部事实」。
 *
 * ## 这一层的全部意义：把「不许编造」变成机制而不是叮嘱
 * prompt 里写十遍「不要编造」也挡不住模型顺手加一头它觉得该有的猛兽。真正管用的是两件事：
 * ①**只给它发生过的事**（本文件）；②**事后按目录逐名核对**（`validate.ts`）。
 * 两者共用同一份 `LifeFacts`，所以「给了什么」与「允许出现什么」不可能漂移。
 *
 * 中段摘录的选法**必须与 `composeChronicle` 完全一致**（birth ＋ molt／combat／once 事件，
 * 按 `chronicleMaxExcerpts` 截断）—— 否则 AI 版与模板版讲的不是同一世，回落时玩家会看到
 * 两份互相矛盾的编年。
 */

import {
  cnNumeral,
  lifeTuning,
  waysProgress,
  type EndingType,
  type OrganSlot,
  type TaleContent,
  type TaleState,
  type WayGate,
  type WayId,
} from "@shiling/tale-sim";
import type { ChronicleExcerpt, LifeFacts, WayFactLine } from "./types.js";

/**
 * 四道的汉字名。
 *
 * 与 tale-client 的 `WAY_LABELS` 是同一份字（那边给界面，这边给 prompt）。
 * 抄一份而不是 import：tale-ai 不许依赖 tale-client（依赖方向是 client → ai）。
 * 漂移由 tale-client 的 `historian.test.ts` 断言两表相等来挡。
 */
export const WAY_LABELS: Record<WayId, string> = {
  shen: "登神",
  yaowang: "妖王",
  guishan: "归山",
  hualing: "化灵",
};

/** 四种收束的汉字名（成道时读的是道名，见 `endingLabelOf`）。 */
export const ENDING_LABELS: Record<EndingType, string> = {
  starve: "饿殍",
  slain: "横死",
  oldage: "寿终",
  ascend: "成道",
};

/** 器官槽位的汉字名（同 tale-client 的 `ORGAN_SLOT_LABELS`）。 */
export const SLOT_LABELS: Record<OrganSlot, string> = {
  eye: "目",
  tooth: "齿",
  hide: "皮",
  limb: "肢",
  gut: "腹",
  spirit: "神",
};

const SEASON_NAMES: readonly string[] = ["春", "夏", "秋", "冬"];

/** 门槛差多少 —— 一句人话，进 prompt 供收束与赞语取材。 */
const GATE_SHORTFALL: Record<string, (short: number) => string> = {
  year: (n) => `寿数差${cnNumeral(n)}岁`,
  ling: (n) => `灵性差${cnNumeral(n)}`,
  de: (n) => `德行差${cnNumeral(n)}`,
  meng: (n) => `猛差${cnNumeral(n)}`,
  lives: (n) => `夺命差${cnNumeral(n)}`,
  divine: () => "未尝食神兽之肉",
  nokill: (n) => `已夺命${cnNumeral(n)}，此道已闭`,
};

function shortfallOf(gate: WayGate): string {
  return (GATE_SHORTFALL[gate.id] ?? ((n: number) => `差${cnNumeral(n)}`))(gate.short);
}

/**
 * 编年前缀：「三岁秋」／「初岁春」。
 *
 * 与 `chronicleTemplates.middleLine` 的渲染结果同形 —— 模板版与 AI 版的中段因此对得上，
 * 玩家读到哪一版都是同一条时间线。
 */
export function excerptPrefix(year: number, season: number, seasonNames: readonly string[]): string {
  const head = year > 0 ? `${cnNumeral(year)}岁` : "初岁";
  return `${head}${seasonNames[season] ?? SEASON_NAMES[season] ?? ""}`;
}

/**
 * 专名目录的别名：内容里叫「穷奇幼崽」，史笔多半只写「穷奇」。
 *
 * 不补这一条的话，一世没见过穷奇而 AI 写了「穷奇」就查不出来（目录里只有全名，
 * 子串匹配不上）—— 编造检查会漏掉最容易被编造的那一类名字。
 */
function nounAliases(name: string): string[] {
  const stripped = name.replace(/(幼崽|之属|遗种)$/u, "");
  return stripped.length >= 2 && stripped !== name ? [name, stripped] : [name];
}

export function collectLifeFacts(state: TaleState, content: TaleContent): LifeFacts {
  if (state.alive || state.ending === null) {
    throw new Error("collectLifeFacts: 一世尚未结束，无从作传");
  }
  const ending: EndingType = state.ending;
  const seasonNames = content.chronicleTemplates.seasonNames ?? SEASON_NAMES;
  const birth = state.records.find((record) => record.kind === "birth");
  const seed = content.seeds.find((candidate) => candidate.id === birth?.refId);
  const organDefs = [...content.organs, ...content.seeds.map((item) => item.organ)];
  const organById = new Map(organDefs.map((organ) => [organ.id, organ]));
  const enemyById = new Map(content.enemies.map((enemy) => [enemy.id, enemy]));

  const onceEventIds = new Set(
    content.events.filter((event) => event.trigger.once).map((event) => event.id),
  );
  // 选法逐字照抄 composeChronicle —— 两版列传必须讲同一条时间线
  const picked = state.records
    .filter(
      (record) =>
        record.kind === "molt" ||
        record.kind === "combat" ||
        (record.kind === "event" && record.refId !== undefined && onceEventIds.has(record.refId)),
    )
    .slice(0, Math.max(0, lifeTuning(state, content).chronicleMaxExcerpts));

  const excerpts: ChronicleExcerpt[] = [birth, ...picked]
    .filter((record): record is NonNullable<typeof record> => record !== undefined)
    .map((record) => ({
      prefix: excerptPrefix(record.year, record.season, seasonNames),
      kind: record.kind,
      text: record.text,
    }));

  const moltNames = state.records
    .filter((record) => record.kind === "molt")
    .map((record) => (record.refId === undefined ? null : (organById.get(record.refId)?.name ?? null)))
    .filter((name): name is string => name !== null);
  const killedNames = state.records
    .filter((record) => record.kind === "combat")
    .map((record) => (record.refId === undefined ? null : (enemyById.get(record.refId)?.name ?? null)))
    .filter((name): name is string => name !== null);
  const deathRecord = state.records.findLast((record) => record.kind === "death");
  const killerName =
    ending === "slain" && deathRecord?.refId !== undefined
      ? (enemyById.get(deathRecord.refId)?.name ?? null)
      : null;

  const organs = state.organIds
    .map((id) => organById.get(id))
    .filter((organ): organ is NonNullable<typeof organ> => organ !== undefined)
    .map((organ) => ({ name: organ.name, slotLabel: SLOT_LABELS[organ.slot], desc: organ.desc }));

  const progress = waysProgress(state, content);
  const wayId: WayId = state.wayAchieved ?? progress.nearest;
  const wayProgressLine = progress.ways.find((item) => item.id === wayId) ?? progress.ways[0];
  const nearestWay: WayFactLine = {
    id: wayId,
    label: WAY_LABELS[wayId],
    met: wayProgressLine?.metCount ?? 0,
    total: wayProgressLine?.gates.length ?? 0,
    shortfalls: (wayProgressLine?.gates ?? []).filter((gate) => !gate.met).map(shortfallOf),
  };

  const catalog = new Set<string>();
  for (const organ of organDefs) for (const alias of nounAliases(organ.name)) catalog.add(alias);
  for (const enemy of content.enemies) for (const alias of nounAliases(enemy.name)) catalog.add(alias);
  for (const item of content.seeds) for (const alias of nounAliases(item.name)) catalog.add(alias);

  /*
   * 白名单＝这一世**真实出现过**的专名，四个来源：终局身上的器官（神种器官出生自带，
   * 也是事实）、蜕出过的器官、搏杀取胜与咬死自己的兽、神种自己，外加**全量 records 文本里
   * 出现过的目录专名**。
   *
   * 最后那一条不能省：一世里遇过白泽、见过垂死应龙都写在 records 里，史官当然写得 ——
   * 漏掉它会把「写了真事」判成编造，而一次假打回既花钱又多半换来更差的一稿。
   * 判据用全量 records（不是进了传的那几条摘录）：摘录是**入传的取舍**，不是发生与否的判据。
   */
  const allowed = new Set<string>();
  for (const organ of organs) for (const alias of nounAliases(organ.name)) allowed.add(alias);
  for (const name of moltNames) for (const alias of nounAliases(name)) allowed.add(alias);
  for (const name of killedNames) for (const alias of nounAliases(name)) allowed.add(alias);
  if (killerName !== null) for (const alias of nounAliases(killerName)) allowed.add(alias);
  if (seed) for (const alias of nounAliases(seed.name)) allowed.add(alias);
  const recordedText = state.records.map((record) => record.text).join("\n");
  for (const noun of catalog) if (recordedText.includes(noun)) allowed.add(noun);

  return {
    seedName: seed?.name ?? "无名神种",
    seedDesc: seed?.desc ?? "",
    skyName: content.skies.find((item) => item.id === state.skyId)?.name ?? "",
    skyDesc: content.skies.find((item) => item.id === state.skyId)?.desc ?? "",
    originName: content.origins.find((item) => item.id === state.originId)?.name ?? "",
    originDesc: content.origins.find((item) => item.id === state.originId)?.desc ?? "",
    years: state.year,
    yearsCn: state.year > 0 ? cnNumeral(state.year) : "未及一",
    ending,
    endingLabel: ending === "ascend" && state.wayAchieved !== null ? WAY_LABELS[state.wayAchieved] : ENDING_LABELS[ending],
    way: state.wayAchieved,
    wayLabel: state.wayAchieved === null ? null : WAY_LABELS[state.wayAchieved],
    stats: state.stats,
    organs,
    moltNames,
    killedNames,
    killerName,
    livesTaken: state.livesTaken,
    moltCount: moltNames.length,
    killCount: killedNames.length,
    excerpts,
    deathText: deathRecord?.text ?? "",
    nearestWay,
    // 用 seed 而不是 rngState：同一局重放的终态 rngState 相同，但 seed 更直白地「就是这一局」
    variant: Math.abs(state.seed) >>> 0,
    allowedNouns: [...allowed],
    catalogNouns: [...catalog],
  };
}
