/**
 * 首世引导链（交付内容 E）—— 把「吃什么 → 涨什么 → 开什么」牵着走一遍。
 *
 * ## 为什么是这一批里最要紧的一件
 * 属性／精气／器官各自的详情解决的是「这个数是什么」，但**病根是因果链太长**：
 * 猎野雉 → 涨足之精气 → 攒满 90 → 蛰伏 → 开出疾足 → 潜行每步多近 5 步、并解开
 * 「须具 疾足」那类抉择。这条链跨了四个屏、五六个季，玩家自己连不起来，必须被牵一次。
 * 3D 版同一个问题（巢穴系统一直在、owner 玩完不知道有巢穴）就是靠 `objectives.ts`
 * 这条链治好的，这里是它在图文形态下的同一副药：纯客户端、只读状态、四步、可跳过。
 *
 * ## 与 3D 版 `objectives.ts` 的差异
 * 每一步除了目标句，还带一句**用当前数值实例化的提示**（「足 16／90　猎野雉／穴鼠可增」）——
 * 3D 版只有目标句，玩家知道要做什么但不知道离达成有多远。这一句由 `detailVm` 的同一批
 * 推导算出来，与详情浮层同源，不会两处各写一版。
 */

import {
  lifeTuning,
  waysProgress,
  organIndex,
  type EssenceType,
  type OrganDef,
  type TaleContent,
  type TaleState,
} from "@shiling/tale-sim";
import { WAY_GATE_LABELS, WAY_LABELS, ESSENCE_LABELS, ESSENCE_ORDER } from "./format.js";
import { essenceSources, moltPool, organTagGates } from "./detailVm.js";

/**
 * 引导链判定所需的只读快照。
 *
 * 前三项从 `TaleState` 直接读得出；后两项是**界面自己知道、状态里没有**的事
 * （引擎不记「玩家有没有见过一条自己够得着的器官门槛」「有没有点开过登神之路」），
 * 由 `TaleApp` 累积后传进来 —— 同 3D 版 `ObjectiveSnapshot` 的分工。
 */
export interface GuideSnapshot {
  /** 四型精气之和 > 0 ＝ 至少吃到过一次（追猎得手或搏杀取胜才给精气） */
  essenceTotal: number;
  /**
   * **真的蛰伏过一次**（开奖成功），不是「身上多了一枚器官」。
   *
   * 为什么不数 `organIds`：器官也能由事件的 `addOrganId` 直接送到手上（「垂死应龙」那桩事
   * 只要德 ≥20，与精气无关），于是一个走德路线的开局会在**从未按过蛰伏**的情况下让第二步
   * 自动打勾 —— 而第二步要教的恰恰是「蛰伏是你变强的唯一途径」。也不能数 `records` 里的
   * `molt` 记录：引擎给这两条来源写的是同一种记录（见 types.ts 的 `LifeRecord` 纪律）。
   * 唯一干净的信号是 `TurnResult.moltResult` 非空，那只有蛰伏开奖会给，由界面接住。
   */
  dormantMolted: boolean;
  /** 曾在事件卡上看到一条「自己满足 organTags 门槛」的抉择 */
  sawOrganGateChoice: boolean;
  /** 曾点开过「登神之路」详情 */
  openedAscend: boolean;
  /** [2026-08-13] 最接近那条道已达成几项门槛（原「登神四门槛」） */
  gatesMet: number;
}

export function guideSnapshot(
  state: TaleState,
  content: TaleContent,
  ui: { dormantMolted: boolean; sawOrganGateChoice: boolean; openedAscend: boolean },
): GuideSnapshot {
  return {
    essenceTotal: ESSENCE_ORDER.reduce((sum, type) => sum + state.essence[type], 0),
    dormantMolted: ui.dormantMolted,
    sawOrganGateChoice: ui.sawOrganGateChoice,
    openedAscend: ui.openedAscend,
    gatesMet: (() => {
      const progress = waysProgress(state, content);
      return progress.ways.find((way) => way.id === progress.nearest)?.metCount ?? 0;
    })(),
  };
}

interface GuideStepDef {
  id: string;
  text: string;
  isDone(snap: GuideSnapshot): boolean;
  /** 用当前状态实例化的一句「离达成有多远／往哪走」 */
  hint(state: TaleState, content: TaleContent): string;
}

/** 本世**蜕出来**的器官（去掉 [0] 那枚神种；神种不在 `content.organs` 里，走 `organIndex`）。 */
function moltedOrgans(state: TaleState, content: TaleContent): OrganDef[] {
  const index = organIndex(content);
  return state.organIds
    .slice(1)
    .map((id) => index.get(id))
    .filter((organ): organ is OrganDef => organ !== undefined);
}

/** 精气最高的那一型 —— 引导链的提示一律围着它讲（也是蛰伏真正会拿去蜕形的那一型）。 */
function topEssence(state: TaleState): EssenceType {
  return ESSENCE_ORDER.reduce(
    (top, type) => (state.essence[type] > state.essence[top] ? type : top),
    ESSENCE_ORDER[0] ?? "zu",
  );
}

export const GUIDE_STEPS: readonly GuideStepDef[] = [
  {
    id: "hunt",
    text: "先猎一次 —— 得食，也得精气",
    isDone: (snap) => snap.essenceTotal > 0,
    hint: (state, content) => {
      // 这一世生效的调参：大旱之年这一句必须写 −15 而不是基线的 −12
      const t = lifeTuning(state, content);
      // [饥饿节奏批] 第一步就要把「追猎 vs 速猎」说清：新玩家看到两颗猎字按钮，
      // 而这条引导正是他会读的那一句 —— 不写分别，他只会随手点一颗
      return `饱食 ${Math.round(state.hunger)}／${t.hungerMax}，每季 −${t.hungerPerSeason}；追猎得手 +${t.huntFoodGain} 饱食 ＋ 整份精气 ＋ 食余，速猎一击即走但只得六成`;
    },
  },
  {
    id: "molt",
    text: "把一型精气攒满，去蛰伏 —— 那是你变强的唯一途径",
    isDone: (snap) => snap.dormantMolted,
    hint: (state, content) => {
      const type = topEssence(state);
      const label = ESSENCE_LABELS[type];
      const value = Math.round(state.essence[type]);
      // **不点名会开出哪一件**：开奖是「加权抽三件、再等权抽一」（引擎 `resolveMolt`），
      // 报单件等于多数时候在骗人。这条链要教的是「攒哪一型 → 会往哪个方向长」。
      const pool = moltPool(state, content, type)
        .slice(0, lifeTuning(state, content).moltCandidateCount)
        .map((organ) => organ.name)
        .join("／");
      const prey = essenceSources(state, content, type)
        .filter((source) => source.huntable)
        .slice(0, 2)
        .map((source) => source.name)
        .join("／");
      const chain = prey.length > 0 ? `猎${prey} → ` : "";
      const outcome = pool.length > 0 ? `偏${label}的器官（${pool}）` : "新器官";
      return `${chain}${label} ${value}／${lifeTuning(state, content).moltThreshold} → 蛰伏 → ${outcome}`;
    },
  },
  {
    id: "gate",
    text: "用新器官解开一条原本锁着的抉择",
    isDone: (snap) => snap.sawOrganGateChoice,
    hint: (state, content) => {
      // 已蜕的器官里，哪一枚认得住抉择 —— 这一句就是「进化有啥好处」的兑现
      for (const organ of moltedOrgans(state, content)) {
        const gates = organTagGates(content, organ.tags);
        if (gates.length > 0) {
          return `你的${organ.name}认得 ${gates.length} 处抉择 —— 去探索，撞见时它不再是灰的`;
        }
      }
      return "先蜕一枚器官；带 tag 的器官会在事件里点开原本灰掉的那一条";
    },
  },
  {
    /*
     * [2026-08-13] 第四步从「点开登神之路」改成「点开顶上那条横带，四条道任选一条」——
     * 这一批之后目标不再只有一个，而「这一世我该奔哪条」正是玩家要学会问的那句话。
     * 提示报的是**最接近的那条道**的逐条门槛（横带缺省展开的也是它，首尾对得上）。
     */
    id: "ways",
    text: "点开顶上那条横带 —— 四条道并列，先看清这一世最近的是哪条",
    isDone: (snap) => snap.openedAscend || snap.gatesMet > 0,
    hint: (state, content) => {
      const progress = waysProgress(state, content);
      const way = progress.ways.find((item) => item.id === progress.nearest);
      if (!way) return "顶上那条横带就是这一世的目标";
      const gates = way.gates
        .map((gate) => `${WAY_GATE_LABELS[gate.id]} ${gate.have}／${gate.need}`)
        .join(" · ");
      return `最近的是${WAY_LABELS[way.id]}：${gates}`;
    },
  },
];

/**
 * 走完全链的收尾句 —— **这一批的验收第三问就靠它**：
 * 「吃什么→涨什么→开什么」必须被完整讲过一次，而且是用玩家真的走过的那条路讲。
 */
export function guideChainSummary(state: TaleState, content: TaleContent): string {
  const organs = moltedOrgans(state, content);
  /*
   * 挑哪一枚器官来复述这条链：优先「能开抉择**且**是从某型精气开出来的」那一枚 ——
   * 只按「能开抉择」挑会挑中龙涎（affinity 刻意留空，唯一来源是事件），于是链条的头
   * 只能写成泛泛的「猎食 → 精气」，而这一句的全部意义就是说清**猎什么涨什么**。
   */
  const gated = organs.filter((candidate) => organTagGates(content, candidate.tags).length > 0);
  const fromEssence = (candidate: OrganDef): boolean =>
    ESSENCE_ORDER.some((type) => (candidate.affinity[type] ?? 0) > 0);
  const organ =
    gated.find(fromEssence) ?? organs.find(fromEssence) ?? gated[0] ?? organs[0];
  const type = organ ? ESSENCE_ORDER.find((candidate) => (organ.affinity[candidate] ?? 0) > 0) : undefined;
  const prey = type
    ? essenceSources(state, content, type)
        .filter((source) => source.huntable)
        .slice(0, 1)
        .map((source) => source.name)[0]
    : undefined;
  const head = prey && type ? `猎${prey} → ${ESSENCE_LABELS[type]}之精气` : "猎食 → 精气";
  const tail = organ
    ? `蛰伏 → ${organ.name} → 它认得的那些抉择`
    : "蛰伏 → 新器官 → 它认得的那些抉择";
  return `这条链你已走完：${head}满 ${lifeTuning(state, content).moltThreshold} → ${tail}。往后自己走。`;
}

export interface GuideVm {
  /** 第几步（1 起），走完时等于 total + 1 */
  step: number;
  total: number;
  text: string;
  hint: string;
  /** 全链走完的收尾句（此时 text 即 summary、hint 为空） */
  complete: boolean;
}

/**
 * 纯状态转移：能连吃掉几步就吃几步（同 3D 版 `advanceObjective`）。
 *
 * 用 while 而不是单次 if：玩家一口气满足两步（吃到精气那一季正好也蜕了形）时，
 * 卡片不该卡在中间那一格等下一回合。
 */
export function advanceGuide(index: number, snap: GuideSnapshot): number {
  let next = Math.max(0, index);
  while (next < GUIDE_STEPS.length && GUIDE_STEPS[next]!.isDone(snap)) next += 1;
  return next;
}

export function buildGuideVm(state: TaleState, content: TaleContent, index: number): GuideVm {
  if (index >= GUIDE_STEPS.length) {
    return {
      step: GUIDE_STEPS.length + 1,
      total: GUIDE_STEPS.length,
      text: guideChainSummary(state, content),
      hint: "",
      complete: true,
    };
  }
  const step = GUIDE_STEPS[index]!;
  return {
    step: index + 1,
    total: GUIDE_STEPS.length,
    text: step.text,
    hint: step.hint(state, content),
    complete: false,
  };
}
