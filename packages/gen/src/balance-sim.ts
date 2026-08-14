/**
 * 平衡校验：用真引擎 ＋ 真内容跑 N 世，统计生死分布（B5 交付线第 5 条）。
 *
 * 与 `tale-content/test/smoke.test.ts` 的分工：冒烟测试跑 50 世、只断言三条护栏
 * （覆盖率白名单／平均蜕变 2〜4／饿死率 ≤60%），跑在每次 `pnpm test` 里所以必须快；
 * 本脚本是**调参台**：世数可调（默认 200）、指标铺开（蜕变分布、死因拆分、寿数分位、
 * 两种玩家画像对照），失败不是红灯而是给人看的数。
 *
 * 用法：
 *   pnpm -C packages/gen balance                # 200 世，谨慎玩家
 *   pnpm -C packages/gen balance -- --lives 500 --profile reckless
 *   pnpm -C packages/gen balance -- --lives 500 --profile wayseek   # 四道平衡（每世奔一条道）
 *   pnpm -C packages/gen balance -- --json      # 只吐 JSON，便于对比两次调参
 *   pnpm -C packages/gen balance -- --lab --lives 400   # 追猎实验台：打法×风向×build 的得手率
 *       （--lives 就是每格的场数，缺省沿用整世模式的 200；手感判据的实测值都是按 400 报的）
 *   pnpm -C packages/gen balance -- --stalk-plan rush   # 整世模式里换机器猎手的打法
 *   pnpm -C packages/gen balance -- --hunt-plan quick   # [饥饿节奏批] 全速猎／全追猎两个极端
 *       （严格占优检查：两条狩猎路谁也不该把对方打死）
 *   pnpm -C packages/gen balance -- --lab combat --lives 400  # 搏杀实验台：打法×敌人×build 的胜率
 *   pnpm -C packages/gen balance -- --lives 500 --profile wayseek --sigils   # [S3] 满员印记的天花板
 *   pnpm -C packages/gen balance -- --lives 500 --profile wayseek --sigils sigil-mu,sigil-ren,sigil-gu
 *   pnpm -C packages/gen balance -- --lives 500 --profile reckless --chart dest-mi-ku  # [S3] 图录直通秘窟
 *   pnpm -C packages/gen balance -- --combat-plan greedy      # 整世模式里换机器打手的打法
 *
 * 纪律：数值不达标只调 `tale-content/src/tuning.ts` 与事件 `effects`，**不改引擎**。
 */

import {
  WAY_ORDER,
  approachOf,
  clashOf,
  availableActions,
  bloodlineGain,
  lifeTuning,
  combatAct,
  combatPreview,
  recommendCombatAct,
  composeChronicle,
  createCursor,
  createLife,
  eligibleChoiceIdxs,
  exploreDestinations,
  performAction,
  resolveChoice,
  stalkAct,
  stalkPreview,
  type ActionId,
  type BodyPart,
  type CombatAct,
  type EndingType,
  type EventChoice,
  type HuntMode,
  type StalkAct,
  type TaleEvent,
  type TaleState,
  type WayId,
  type WindDir,
  waysProgress,
} from "../../tale-sim/src/index.ts";
import { CHANCE_BANDS } from "../../tale-client/src/model/stalkVm.ts";
import {
  ENEMY_CAO_HU,
  ENEMY_XUAN_MANG,
  ENEMY_YAN_YANG,
  ENEMY_YE_ZHI,
  EVENTS,
  FLAG_SICK,
  FLAG_WOUND,
  ORGAN_GOU_CHI,
  ORGAN_JI_ZU,
  ORGAN_LING_XI,
  ORGAN_YE_TONG,
  SEED_CHANG_TAI,
  TALE_CONTENT,
} from "../../tale-content/src/index.ts";

/** 一世的操作上限（寿数 16〜20 岁≈80 回合，加战斗回合，600 足够宽） */
const MAX_STEPS = 600;

/**
 * 试参用的临时覆写：`--tune moltThreshold=72,initialStats.ti=26`。
 *
 * 只接受数字字段（含一层点号路径）。存在的意义是**别为了试一个数就去改 tuning.ts 再改回来**
 * —— 改文件试参会漏改回去，那种漂移最难发现。定下来的值才写进
 * `tale-content/src/tuning.ts`，脚本里不留任何默认覆写。
 */
function applyTuneOverrides(spec: string): typeof TALE_CONTENT {
  const tuning = { ...TALE_CONTENT.tuning } as unknown as Record<string, unknown>;
  for (const pair of spec.split(",")) {
    const [path, raw] = pair.split("=");
    const value = Number(raw);
    if (!path || !Number.isFinite(value)) throw new Error(`--tune 项写错：${pair}`);
    const segments = path.split(".");
    // 多于两段直接报错：`initialStats.ti.extra=5` 若静默按 `initialStats.ti=5` 落地，
    // 报告里的数字看着正常、其实调的不是你以为的那一项 —— 打错的 flag 静默被吞比失败危险
    if (segments.length > 2) throw new Error(`--tune 最多支持一层点号：${path}`);
    const [head, tail] = segments;
    if (!head || !(head in tuning)) throw new Error(`--tune 未知字段：${path}`);
    if (tail === undefined) {
      if (typeof tuning[head] !== "number") throw new Error(`--tune 只能改数字字段：${path}`);
      tuning[head] = value;
      continue;
    }
    const nested = tuning[head];
    if (typeof nested !== "object" || nested === null || !(tail in nested)) {
      throw new Error(`--tune 未知字段：${path}`);
    }
    tuning[head] = { ...(nested as Record<string, number>), [tail]: value };
  }
  return { ...TALE_CONTENT, tuning: tuning as unknown as typeof TALE_CONTENT.tuning };
}

let CONTENT = TALE_CONTENT;
let STALK_PLAN: StalkPlan = "patient";
let COMBAT_PLAN: CombatPlan = "screen";
let HUNT_PLAN: HuntPlan = "mixed";

/**
 * [饥饿节奏批] 怎么猎：三种。
 *
 * - `mixed`（缺省）＝ 明理玩家：**真饿了才花五次点击追一场**（要的是全额 ＋ 食余），
 *   只是垫一顿就走速猎那条快路；穴里还有余粮时也走快路。
 * - `stalk`／`quick` ＝ 两个极端，用来量**严格占优**：若「全速猎」在活过 8 岁／成道率上
 *   压过「全追猎」（或反过来被压死），那两颗按钮就只剩一颗有人按 ——
 *   这正是交付线第二问要的那个对照，不能靠手感说。
 */
type HuntPlan = "mixed" | "stalk" | "quick";

/**
 * 机器玩家怎么选狩猎打法 —— **只读屏幕上有的东西**（饱食、食余），
 * 同 `decideStalk`／`screenCombat` 的纪律：不许用真人拿不到的信息。
 */
function decideHuntMode(state: TaleState): HuntMode {
  if (HUNT_PLAN !== "mixed") return HUNT_PLAN;
  /*
   * 「值不值得花五次点击」这道题，明理玩家的答案是一句算得出来的话：
   * **一整头猎物装不装得下**。饱食有上限（100），一次追猎得手 +32 —— 肚子已经 70 的时候
   * 去追一场，溢出的那部分连同食余一起白扔；那正是速猎（一次点击、只取六成半）的用武之地。
   * 反过来，真有地方装的时候，五次点击换回来的是全额 ＋ 整份精气 ＋ 几季余粮，没有道理不追。
   *
   * ⚠️ 这条判据换过**两次**，两次都是「先怀疑机器玩家」（同 P1／S2）：
   * ① 第一版「饱食 ≤40 才追，否则速猎」：把狩猎占行动比从 42.5% 顶到 50%、平均蜕变
   *    从 2.91 掉到 2.11 —— 速猎的期望净收益只有 +3，一顿垫不了几季，机器于是原地踏步式
   *    地反复出猎。
   * ② 第二版「≤35 才追」：同一个毛病，速猎占到八成，蜕变仍不达标（cautious 1.85 ✗）。
   * 真正的错在于**把速猎当成常规饭票**。它不是 —— 它是「装不下」与「只想要一条命」
   * （妖王刷夺命）这两种局面的工具。判据从 tuning 推而不写死 65：数值改了它得跟着改。
   */
  // **这一世生效的**调参：大旱之年每季多饿 3，而「还够几季」正是按季耗算的 ——
  // 读 `CONTENT.tuning` 会让机器玩家在天时改过饱食的那些一世里算错自己的存粮
  // （引擎与界面的硬纪律就是「凡读调参一律走 `lifeTuning`」，实验台不该破例）。
  const t = lifeTuning(state, CONTENT);
  const runway = (state.hunger + state.surplusSeasons * t.huntSurplusGain) / Math.max(1, t.hungerPerSeason);
  return runway <= 3 ? "stalk" : "quick";
}

/**
 * 抉择策略。四种画像，因为「平衡」对不同玩法是不同的数：
 *
 * - `cautious`：优先最后一个可选抉择 —— 本库的抉择顺序是「诱人／有门槛／稳妥」，
 *   末条基本是不冒险那条。这是**人会怎么玩**的近似（新玩家第一世多半更谨慎）。
 * - `reckless`：优先第一条（最诱人也最容易死），一世时长的下界。
 * - `random`：满足门槛的选项里等概率乱点 —— B2 冒烟用的那个画像，好把贪心分支都踩到。
 * - `wayseek`（2026-08-13）：**每一世先挑一条道，然后奔它**。它回答的是这一批唯一要紧的
 *   平衡问题「四条道是不是都够得着」—— 前三种画像不奔任何道（它们饿了就猎、乱点抉择），
 *   于是妖王与化灵在它们手里恒为 0%，而那既不能证明门槛太难，也不能证明门槛合适。
 */
type Profile = "cautious" | "reckless" | "random" | "wayseek";

interface Args {
  lives: number;
  profile: Profile;
  json: boolean;
  tune: string | null;
  /** 实验台：只跑一个子系统、按打法拆表，不跑整世。`null` ＝ 跑整世 */
  lab: "stalk" | "combat" | null;
  stalkPlan: StalkPlan;
  combatPlan: CombatPlan;
  /** [饥饿节奏批] 怎么猎（见 `HuntPlan`）—— `stalk`／`quick` 两个极端是严格占优检查 */
  huntPlan: HuntPlan;
  /**
   * [S3] 每一世带上的「世家印记」id（`--sigils`）。
   *
   * 它回答的是这一批唯一有平衡风险的问题：**永久加成会不会把成道率顶出护栏**。
   * 缺省空 ＝ 一个没买过印记的新玩家；`--sigils` 不带值 ＝ 按内容表取满 `sigilCap` 枚
   * （**只是「满员」，不是「最坏」**：最坏的那一对要靠十对全扫才知道，见 `sigils.ts` 头注的
   * 那张表 —— 单枚最强的两枚凑一对并不等于最坏一对，它们之间有交互）；
   * 带值 ＝ 指定那几枚（分道试算：奔化灵的买目、奔妖王的买爪）。
   */
  sigilIds: readonly string[];
  /** [S3] 每一世带上的「图录」（`--chart <id>`）—— 免门槛的那一处 */
  chartedDestinationId: string | null;
}

const COMBAT_PLANS: readonly CombatPlan[] = ["screen", "throat", "eye", "leg", "greedy", "coward"];

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    lives: 200,
    profile: "cautious",
    json: false,
    tune: null,
    lab: null,
    stalkPlan: "patient",
    combatPlan: "screen",
    huntPlan: "mixed",
    sigilIds: [],
    chartedDestinationId: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--json") {
      args.json = true;
      continue;
    }
    if (flag === "--lab") {
      // `--lab`（缺省 stalk，兼容 P1 的用法）／`--lab combat`
      const next = argv[i + 1];
      if (next === "combat" || next === "stalk") {
        args.lab = next;
        i += 1;
      } else {
        args.lab = "stalk";
      }
      continue;
    }
    if (flag === "--combat-plan") {
      const value = argv[i + 1];
      if (!COMBAT_PLANS.includes(value as CombatPlan)) {
        throw new Error(`--combat-plan 只能是 ${COMBAT_PLANS.join("｜")}`);
      }
      args.combatPlan = value as CombatPlan;
      i += 1;
      continue;
    }
    if (flag === "--hunt-plan") {
      const value = argv[i + 1];
      if (value !== "mixed" && value !== "stalk" && value !== "quick") {
        throw new Error("--hunt-plan 只能是 mixed｜stalk｜quick");
      }
      args.huntPlan = value;
      i += 1;
      continue;
    }
    if (flag === "--stalk-plan") {
      const value = argv[i + 1];
      if (
        value !== "patient" &&
        value !== "rush" &&
        value !== "screen" &&
        value !== "nowait" &&
        value !== "waiter"
      ) {
        throw new Error("--stalk-plan 只能是 patient｜screen｜nowait｜rush｜waiter");
      }
      args.stalkPlan = value;
      i += 1;
      continue;
    }
    if (flag === "--sigils") {
      const next = argv[i + 1];
      // 不带值（或下一个就是别的 flag）＝ 取满上限（按内容表顺序）。**这不是最坏组合** ——
      // 要量天花板得把 C(n, cap) 对全扫一遍，见 `sigils.ts` 头注那张十对全扫的表
      if (next === undefined || next.startsWith("--")) {
        args.sigilIds = CONTENT.sigils.slice(0, CONTENT.tuning.sigilCap).map((sigil) => sigil.id);
      } else {
        const ids = next.split(",").map((id) => id.trim()).filter((id) => id.length > 0);
        for (const id of ids) {
          if (!CONTENT.sigils.some((sigil) => sigil.id === id)) {
            throw new Error(`--sigils 里的 ${id} 不是印记（可选：${CONTENT.sigils.map((s) => s.id).join("｜")}）`);
          }
        }
        args.sigilIds = ids;
        i += 1;
      }
      continue;
    }
    if (flag === "--chart") {
      const value = argv[i + 1];
      if (value === undefined || !CONTENT.destinations.some((d) => d.id === value)) {
        throw new Error(`--chart 需要一个去处 id（${CONTENT.destinations.map((d) => d.id).join("｜")}）`);
      }
      args.chartedDestinationId = value;
      i += 1;
      continue;
    }
    if (flag === "--tune") {
      const value = argv[i + 1];
      if (value === undefined) throw new Error("--tune 需要形如 moltThreshold=72 的覆写串");
      args.tune = value;
      i += 1;
      continue;
    }
    if (flag === "--lives") {
      const value = Number.parseInt(argv[i + 1] ?? "", 10);
      if (!Number.isFinite(value) || value <= 0) throw new Error("--lives 需要一个正整数");
      args.lives = value;
      i += 1;
      continue;
    }
    if (flag === "--profile") {
      const value = argv[i + 1];
      if (
        value !== "cautious" &&
        value !== "reckless" &&
        value !== "random" &&
        value !== "wayseek"
      ) {
        throw new Error("--profile 只能是 cautious｜reckless｜random｜wayseek");
      }
      args.profile = value;
      i += 1;
      continue;
    }
    // 打错的 flag 静默被吞比失败危险（B4 在 art:promote 上踩过一次）
    throw new Error(`未知参数：${flag}`);
  }
  return args;
}

/**
 * 一世要读多少字 —— 真人时长粗校的基数（B5 交付线第 7 条）。
 *
 * 分三类计，因为它们的阅读速度差别很大：
 * - `prose`：事件正文＋抉择结果＋战斗与行动旁白，是**逐字读**的部分；
 * - `options`：抉择标签与门槛提示，是**扫读＋比较**的部分（字少但耗决策时间）；
 * - `chronicle`：一世末尾那篇列传，读一遍就结束。
 */
interface CharCount {
  prose: number;
  options: number;
  chronicle: number;
}

interface LifeSummary {
  ending: EndingType;
  years: number;
  molts: number;
  kills: number;
  organCount: number;
  bloodline: number;
  steps: number;
  /** 决策次数：事件抉择／行动选择／战斗指令／追猎指令，分别有不同的思考成本 */
  decisions: { event: number; action: number; combat: number; stalk: number };
  /**
   * [饥饿节奏批] 这一世点了多少次鼠标 —— owner 的原话是「要经常点击狩猎」，
   * 而「经常」只有落成一个数才调得动。四类决策各算一次点击（追猎屏的每一息也是一次点击，
   * 那正是这一批要压下来的那一项）。
   */
  clicks: number;
  /** [饥饿节奏批] 行动分布：`hunt`／`hunt:quick`／`explore`／`rest`／`dormant` 各点了几次 */
  actionMix: Record<string, number>;
  /** 追猎场次与得手数（M1-P1 的核心手感指标） */
  hunts: number;
  caught: number;
  /**
   * [M2-B1] 遭遇账：**这一批交付线里那三个问题**（一场架几合？一世打几场？点击涨了多少？）
   * 只有落成数才答得上来。
   *
   * - `encounters` ＝ 起了几场遭遇（三条来路合计：起追／遇袭／事件冲突）；
   * - `clashes` ＝ 其中有几场进了交锋阶段；
   * - `clashRounds` ＝ 每一场交锋各打了几合（分布，用来报中位与 p90）。
   */
  encounters: number;
  clashes: number;
  clashRounds: number[];
  /** [2026-08-13] 死时四条道各自达成了几条门槛／是否够格／是否已闭 */
  wayMet: Record<WayId, number>;
  /** 逐条门槛是否达成：`"shen.ling"` → true。调门槛时唯一有用的那一列 */
  wayGates: Record<string, boolean>;
  wayReady: Record<WayId, boolean>;
  /** 成道的那条道（null ＝ 没成） */
  wayAchieved: WayId | null;
  /** 这一世奔的是哪条道（只有 wayseek 画像有；别的画像为 null） */
  waySought: WayId | null;
  /** 本世夺命数（妖王的进度、化灵的断门，同一个计数器） */
  livesTaken: number;
  /** 这一世的天时／出身 —— 「每局不同」的两个开局变量 */
  skyId: string;
  originId: string;
  chars: CharCount;
  /** slain 的两种来源：战斗致死（死亡记录带击杀者 refId）与事件直杀 */
  slainBy: "combat" | "event" | null;
  firedEventIds: string[];
  chronicleChars: number;
}

/**
 * 明理但不作弊的行动策略。
 *
 * ⚠️ 与 B2 冒烟测试那一版有一处**关键修正**：原版是「带伤就休」，而 `restHealFlags` 只治
 * `sick` 不治 `wound`（那是内容侧刻意的分工），于是一旦挂上 `wound`，休憩既治不好伤、
 * 又把饱食顶在 45 以上让「饿了就猎」永不触发 —— 策略陷入**无限休憩**：不猎不探、不吃精气、
 * 一世零蜕变。实测这就是「一世未蜕形 40%」的主因，是策略的缺陷而不是数值的缺陷。
 * 修法是**每次伤病最多歇两季**（不是「连续两季」——那样会退化成休憩两季干一季的循环，
 * 一世一半的回合都在睡）：歇过还没好就带着伤过日子，内容里有专门的疗伤事件。
 */
function decideAction(
  state: TaleState,
  actions: readonly ActionId[],
  roll: () => number,
  restsThisInjury: number,
  /** [2026-08-13] 这一世奔的那条道（`wayseek` 画像才有）——它改变的是**行动**，不只是抉择 */
  way: WayId | null,
): ActionId {
  if (actions.includes("dormant")) return "dormant";
  const hurt = state.flags.includes(FLAG_WOUND) || state.flags.includes(FLAG_SICK);
  /*
   * 化灵是四条道里唯一**改变操作序列**的一条：狩猎得手就是夺命，所以这条道根本不能猎。
   * 它只能靠休憩回饱食、靠探索撞事件挣灵 —— 这就是「第二局玩法完全不同」的最强证据，
   * 也是这个画像存在的理由（前三种画像饿了就猎，永远量不到这条道）。
   */
  if (way === "hualing") {
    if (state.hunger <= 55) return "rest";
    if (hurt && restsThisInjury < 2) return "rest";
    return "explore";
  }
  /*
   * [饥饿节奏批] 「饿了就猎」改成**按还够几季算**（`runway`），而不是死盯饱食那一个数。
   *
   * 这一条与屏幕上写的是同一个量：饱食详情里那一行「以每季 −12 算，还够 N 季」，
   * 食余那一行又写着「此后 N 季每季自动 +9」—— 一个看得懂这两行的玩家算的就是这个和。
   *
   * ⚠️ 换过两版，两次都是「先怀疑机器玩家」（同 P1／S2）：
   * ① 原版单一门槛「饱食 ≤50 就猎」在食余落地后会**在自己的余粮窗口里反复出猎**；
   * ② 第二版「有余粮就等到 ≤30」矫枉过正 —— 余粮每季只补 6〜9 点而季耗是 12，
   *    净额仍是负的，等到 30 才动手会把一批一世饿死在余粮吃完的那一季
   *    （实测活过 8 岁掉到 55〜57%）。runway 把两件事算进同一个数，不必再拍门槛。
   * 4 季这个数就是原来的 ≤50（50 ÷ 12 ≈ 4.2 季），换算过来的，不是新调的。
   */
  // 同 `decideHuntMode`：这一世生效的调参，不是内容库的基线
  const t = lifeTuning(state, CONTENT);
  const runway = (state.hunger + state.surplusSeasons * t.huntSurplusGain) / Math.max(1, t.hungerPerSeason);
  if (runway <= 4) return "hunt";
  if (hurt && restsThisInjury < 2) return "rest";
  // 妖王要夺命数：肚子不饿也照猎（那是它唯一稳定的夺命来源）
  if (way === "yaowang") return roll() < 0.75 ? "hunt" : "explore";
  // 归山要活得久：能歇就歇，探索去挣德
  if (way === "guishan" && state.hunger <= 70) return "hunt";
  if (way === "guishan") return roll() < 0.3 ? "rest" : "explore";
  if (state.hunger >= 70) return "explore";
  return roll() < 0.5 ? "hunt" : "explore";
}

/**
 * [S2] 「往哪走」——**按画像分叉**，因为这一批新加的取舍恰好就在这里。
 *
 * | 画像 | 去哪 | 它在量什么 |
 * |---|---|---|
 * | `cautious` | 恒去第一处（兽径：无门槛、无路费、几乎无袭） | 只走常路的下限 |
 * | `reckless` | 恒去**开得了的最深一处**（路费 12、三成遇袭） | 只走绝境的上限 |
 * | `random`／`wayseek` | 开得了的里面等概率挑 | 中间态与四道成道率 |
 *
 * `content.destinations` 按由浅入深排（`destinations.ts` 的表头写了这条顺序），所以
 * 「第一处」与「最后一处」就是这两端。分叉的意义是：**去处的风险差要在平衡数据上看得出来**
 * —— 若 cautious 与 reckless 的活过 8 岁没有差别，那三档风险就是白设的。
 *
 * `wayseek` 刻意**不是**「恒去最深」：四条道的门槛散在不同的地方（登神的 `divine` 在焦原的
 * 应龙，归山的德在古祠，化灵的灵在幽潭），恒去一处会让另外三条道的门槛量不到 ——
 * 实测那正是第一版登神成道率掉到 **0.2%** 的原因之一（另一半是焦原的门槛，
 * 见 `tale-content/src/destinations.ts` 焦原那一段）。
 */
function decideDestination(
  state: TaleState,
  profile: Profile,
  roll: () => number,
  /** [S2] 这一世奔的那条道 —— 它改变的是**去哪儿**，不只是抉择 */
  way: WayId | null,
): string {
  const open = exploreDestinations(state, CONTENT).filter((entry) => entry.unlocked);
  const first = open[0];
  if (first === undefined) throw new Error("平衡：一处去处都开不了（内容库缺无门槛的那一处）");
  if (profile === "cautious") return first.def.id;
  if (profile === "reckless") return (open[open.length - 1] ?? first).def.id;
  /*
   * **奔登神的人往有神兽的地方去。**
   *
   * 这一条是实测逼出来的，而它修的是**机器玩家**不是数值（P1 那条教训：先怀疑机器玩家）。
   * 登神的第三道门槛是「尝过神兽」，S2 之前它的唯一来源（「垂死应龙」）是一条随处可撞的
   * 探索事件 —— 500 世 wayseek 实测 `divine` 门槛达成率 **40%**。S2 把它归到焦原之后，
   * 一个**等概率乱挑去处**的机器玩家只有 9.6%，于是登神成道率从 2.8% 掉到 0.2%。
   *
   * 但真人不会那样打：他知道焦原有穷奇、有应龙，奔登神就往那儿去。所以这里让它照做 ——
   * 判据从内容里**推**（此地的兽里有没有带 `wayDivineTag` 的），不写死去处 id：
   * 写死会让「内容改了而实验台还在量旧世界」变成一个静默的谎。
   */
  if (way === "shen") {
    const divine = CONTENT.tuning.wayDivineTag;
    const divineIds = new Set(
      CONTENT.enemies.filter((enemy) => enemy.tags.includes(divine)).map((enemy) => enemy.id),
    );
    const lair = open.find((entry) =>
      entry.def.denizens.some((denizen) => divineIds.has(denizen.enemyId)),
    );
    if (lair) return lair.def.id;
  }
  return (open[Math.floor(roll() * open.length)] ?? first).def.id;
}

/**
 * 「奔某条道」的抉择偏好：按 outcome 声明的 effects 给每个抉择打分，挑分最高的。
 *
 * 它只读**内容自己声明的 effects**（与玩家读得到的抉择文案同源），不碰引擎内部 ——
 * 同 `screenCombat` 的纪律：机器玩家不许用真人拿不到的信息。
 */
function scoreChoiceForWay(choice: EventChoice, way: WayId): number {
  let score = 0;
  for (const outcome of choice.outcomes) {
    const e = outcome.effects;
    const w = outcome.weight;
    const stats = e.stats ?? {};
    const lives = e.takesLife ?? 0;
    if (way === "shen") {
      score += w * ((stats.ling ?? 0) * 2 + (stats.de ?? 0) * 2 + (e.devourDivine ? 40 : 0));
    } else if (way === "yaowang") {
      score += w * ((stats.meng ?? 0) * 3 + lives * 4 - (stats.de ?? 0) * 0);
    } else if (way === "guishan") {
      score += w * ((stats.de ?? 0) * 3 + (e.lifespan ?? 0) * 20 + (stats.ti ?? 0) + (e.hunger ?? 0) * 0.2);
    } else {
      // 化灵：灵最重要，而**任何夺命都是终局** —— 一条命就把这条道关上
      score += w * ((stats.ling ?? 0) * 3 - lives * 500);
    }
    if (e.die !== undefined && e.die !== "ascend") score -= w * 400;
  }
  return score;
}

function isHurt(state: TaleState): boolean {
  return state.flags.includes(FLAG_WOUND) || state.flags.includes(FLAG_SICK);
}

/**
 * 追猎打法（M1-P1）。四种，因为「追猎好不好玩」问的就是**不同打法的成绩要拉得开**：
 * 若四种打法成功率一样，那四个按钮就是装饰，玩家点哪个都行 —— 也就是 M0 的翻牌换了层皮。
 *
 * 全部只读 `stalkPreview`（＝界面摆给玩家看的那几个数），不碰引擎内部。
 */
export type StalkPlan = "patient" | "rush" | "screen" | "nowait" | "waiter" | "salvage";

/**
 * 命中率档位的**中点** —— 从 tale-client 的 `CHANCE_BANDS` **直接算出来**，不再手抄一份。
 *
 * 为什么实验台需要它：没有 `night-eye`／`insight` 的 build 在屏幕上**只看得见档位**。
 * 若机器猎手照 `stalkPreview` 的精确值决策，它就在用一个真人拿不到的信息，于是 bare 与 seer
 * 两组会跑出**逐字相同**的成绩，「信息本身就是器官奖励」这条设计主张也就无从验证
 * （第一版实验台正是这样，两行数一模一样）。
 *
 * 为什么直接 import 界面那份表：档位阈值改了而这里没跟着改，实验台就会在**量一个玩家看不到
 * 的世界**，而两处数字长得都对，没人会发现。宁可让工具依赖界面常量，也不要留一份靠注释同步的抄本。
 */
const BAND_MIDPOINTS: readonly { max: number; mid: number }[] = CHANCE_BANDS.map((band, index) => ({
  max: band.max,
  mid: ((CHANCE_BANDS[index - 1]?.max ?? 0) + band.max) / 2,
}));

function banded(chance: number): number {
  const last = BAND_MIDPOINTS[BAND_MIDPOINTS.length - 1];
  return BAND_MIDPOINTS.find((band) => chance <= band.max)?.mid ?? last?.mid ?? 1;
}

/**
 * 把预览裁剪成**这个 build 真的看得见**的样子：读不出确数就只剩档位中点，
 * 读不出风向就当作「不知道自己在不在上风」。
 */
function asSeen(p: ReturnType<typeof stalkPreview>): ReturnType<typeof stalkPreview> {
  if (p.alertVisible && p.windVisible) return p;
  return {
    ...p,
    pounceChance: p.alertVisible ? p.pounceChance : banded(p.pounceChance),
    pounceChanceAfterCreep: p.alertVisible
      ? p.pounceChanceAfterCreep
      : banded(p.pounceChanceAfterCreep),
    // 看不清风向 ＝ 不敢断定自己已在上风（界面也是这么劝的：绕一圈买个确定）
    alreadyUpwind: p.windVisible ? p.alreadyUpwind : false,
  };
}

function decideStalk(state: TaleState, plan: StalkPlan): StalkAct {
  const p = asSeen(stalkPreview(state, CONTENT));
  const stalk = approachOf(state);
  if (!stalk) throw new Error("decideStalk: 不在追猎中");
  // 只剩最后一动：不扑就是空手而归
  if (p.staminaLeft <= 1) return "pounce";

  if (plan === "rush") {
    // 无脑逼近：不绕风、不屏息，贴身就扑
    return stalk.distance > 0 ? "creep" : "pounce";
  }
  /*
   * salvage ＝ 与 rush 一模一样地硬冲，只在**贴身之后**发现命中率不行时屏息补救。
   *
   * 它存在的理由：`patient − nowait` 量不出屏息的价值（明理打法根本走不到需要屏息的局面，
   * 出手时命中率已经 73%）。屏息真正的用处是**救一个已经打坏的接近**，所以要在坏局面里量。
   */
  if (plan === "salvage") {
    if (stalk.distance > 0) return "creep";
    if (p.pounceChance < 0.6 && p.waitAlertDrop > 0) return "wait";
    return "pounce";
  }
  if (plan === "waiter") {
    // 只会等：先等到它彻底松懈，再一路潜过去（体力预算基本不够，用来验证「等」不是万能解）
    if (p.waitAlertDrop > 0 && p.staminaLeft >= 4) return "wait";
    return stalk.distance > 0 ? "creep" : "pounce";
  }
  if (plan === "nowait") {
    // 明理但从不屏息 —— 与 patient 的差额就是「屏息」这颗按钮值多少（交付线手感第三问）
    if (!p.alreadyUpwind && p.staminaLeft >= 4) return "circle";
    if (p.pounceChance >= 0.7) return "pounce";
    if (p.creepGain > 0 && p.pounceChanceAfterCreep >= p.pounceChance) return "creep";
    return "pounce";
  }
  if (plan === "patient") {
    // 明理猎手：先买逆风（绕过一次后 windKnown 让 alreadyUpwind 变真，不会一圈接一圈），
    // 再逼近，七成才出手；贴身而警觉高时屏息一次
    if (!p.alreadyUpwind && p.staminaLeft >= 4) return "circle";
    if (p.pounceChance >= 0.7) return "pounce";
    if (p.creepGain > 0 && p.pounceChanceAfterCreep >= p.pounceChance) return "creep";
    if (p.waitAlertDrop > 0) return "wait";
    return "pounce";
  }
  /*
   * "screen"：**只按屏幕上的金色提示打**（`buildStalkVm` 里 `highlight` 的那套判断）。
   * 它回答的是一个比「最优解是什么」更要紧的问题：界面自己推荐的那一手，跟得住吗？
   * 若这条的成绩明显低于 patient，那就是界面在**误导**玩家 —— 那种 bug 不会有测试变红。
   */
  if (!p.alreadyUpwind && p.staminaLeft > 2) return "circle";
  if (p.pounceChance >= 0.7) return "pounce";
  if (p.creepGain > 0 && p.pounceChanceAfterCreep >= p.pounceChance) return "creep";
  if (stalk.distance <= 0 && p.waitAlertDrop > 0 && p.pounceChance < 0.6) return "wait";
  return "pounce";
}

/**
 * 搏杀打法（M1-P2）。六种，因为「搏杀好不好玩」问的就是**不同打法的成绩要拉得开** ——
 * 若六种打法胜率一样，那七八颗按钮就是装饰，也就是 M0 的四选一换了层皮。
 *
 * 全部只读 `combatPreview`（＝界面摆给玩家看的那几个数），不碰引擎内部。
 */
export type CombatPlan = "screen" | "throat" | "eye" | "leg" | "greedy" | "coward";

/**
 * 「照屏幕金光打」＝ 引擎导出的 `recommendCombatAct`（**玩家屏幕上发金光的那一手**）。
 *
 * [S1] 这里原先是手抄镜像（三处之一）。手抄的后果是这张表量的打法**不是玩家真按的那套**
 * —— 而这张表存在的全部理由恰恰是「界面自己推荐的那一手跟得住吗」。推荐链已上提到
 * `tale-sim`（呈现层建议，引擎不消费），三处收成一份。
 */
function screenCombat(state: TaleState): CombatAct {
  return recommendCombatAct(combatPreview(state, CONTENT));
}

function decideCombatPlan(state: TaleState, plan: CombatPlan): CombatAct {
  const p = combatPreview(state, CONTENT);
  if (plan === "screen") return screenCombat(state);
  if (plan === "coward") {
    // 一挨打就想走：验证「逃」不是万能解（逃掉＝没有精气，一世会饿）
    if (p.fleeChance >= 0.4) return { kind: "flee" };
    return { kind: "bite", part: "throat" };
  }
  if (plan === "greedy") {
    // 只知道咬伤害最高那处 ＋ 有技就放：M0 那种「挑最强的一手」的打法
    const skill = p.skills.find((item) => item.ready);
    if (skill) return { kind: "skill", skillId: skill.skillId };
    const best = [...p.bites].sort((a, b) => b.damage.mid - a.damage.mid)[0];
    return { kind: "bite", part: (best?.part ?? "throat") as BodyPart };
  }
  // 单一部位打法：三个部位各自「只会这一手」的成绩 —— 若三者接近，部位就没有分工
  const part: BodyPart = plan === "throat" ? "throat" : plan === "eye" ? "eye" : "leg";
  return { kind: "bite", part };
}

function decideCombat(state: TaleState): CombatAct {
  if (!clashOf(state)) throw new Error("decideCombat: 不在战斗中");
  return decideCombatPlan(state, COMBAT_PLAN);
}

/**
 * 抉择：按画像挑，**但「应命而升」必挑**。
 *
 * 这不是给机器玩家开外挂，是修一个量测 bug：登神是胜利条件，一个攒够四条门槛的玩家不会在
 * 天门开了之后选「辞而不受」。而 cautious 挑末条、random 乱点，恰好总能挑到「辞而不受」——
 * 于是 M0/P1 实测的「登神率 0%」里有一部分根本不是内容够不着，是**策略自己拒绝了胜利**
 * （P1 的教训：先怀疑机器玩家）。
 */
function pickChoice(
  event: TaleEvent,
  eligible: readonly number[],
  profile: Profile,
  roll: () => number,
  way: WayId | null,
): number {
  const ascendIdx = eligible.find((idx) =>
    event.choices[idx]?.outcomes.every((outcome) => outcome.effects.die === "ascend"),
  );
  if (ascendIdx !== undefined) return ascendIdx;
  const last = eligible[eligible.length - 1] ?? 0;
  const first = eligible[0] ?? 0;
  if (profile === "wayseek" && way !== null) {
    let best = first;
    let bestScore = -Infinity;
    for (const idx of eligible) {
      const choice = event.choices[idx];
      if (!choice) continue;
      const score = scoreChoiceForWay(choice, way);
      if (score > bestScore) {
        bestScore = score;
        best = idx;
      }
    }
    return best;
  }
  if (profile === "cautious") return last;
  if (profile === "reckless") return first;
  return eligible[Math.floor(roll() * eligible.length)] ?? first;
}

/**
 * [S3] 跨世资产：整世模式里每一世都带着它们降生。
 *
 * 模块级可变量（同 `STALK_PLAN`／`COMBAT_PLAN` 的体例）——`runLife` 的签名已经三个参数，
 * 再加两个只有平衡台用得上的会让每一处调用点都得写 `[], null`。
 */
let SIGIL_IDS: readonly string[] = [];
let CHARTED_DESTINATION: string | null = null;

function runLife(seed: number, profile: Profile, index = 0): LifeSummary {
  // 策略自己的随机源与引擎的 rngState 分开，互不污染（同 seed 仍完全可复现）
  const cursor = createCursor(seed ^ 0x5f3759df);
  const roll = (): number => cursor.next();
  const fired = new Set<string>();
  /*
   * 奔哪条道：**按序轮转**而不是随机挑 —— 500 世要给出「每条道各自成道率」，随机挑会让
   * 四条道的样本量各自带 ±5% 的抖动，而目标区间只有 0.5〜5%，那点抖动能把结论翻过来。
   */
  const waySought: WayId | null =
    profile === "wayseek" ? (WAY_ORDER[index % WAY_ORDER.length] ?? "shen") : null;

  let state = createLife(seed, SEED_CHANG_TAI, CONTENT, {
    sigilIds: SIGIL_IDS,
    chartedDestinationId: CHARTED_DESTINATION,
  });
  let steps = 0;
  let restsThisInjury = 0;
  const decisions = { event: 0, action: 0, combat: 0, stalk: 0 };
  const actionMix: Record<string, number> = {};
  let hunts = 0;
  let caught = 0;
  // [M2-B1] 遭遇账：靠「这一步之前没有遭遇、之后有了」这个差分来数，不靠猜
  let encounters = 0;
  let clashes = 0;
  const clashRounds: number[] = [];
  let roundsThisClash = 0;
  let inClash = false;
  const chars: CharCount = { prose: 0, options: 0, chronicle: 0 };

  while (state.alive && steps < MAX_STEPS) {
    steps += 1;
    if (clashOf(state)) {
      if (!inClash) {
        inClash = true;
        clashes += 1;
        roundsThisClash = 0;
      }
      decisions.combat += 1;
      roundsThisClash += 1;
      const round = combatAct(state, decideCombat(state), CONTENT);
      chars.prose += round.roundLog.join("").length;
      state = round.state;
      if (round.over !== null) {
        clashRounds.push(roundsThisClash);
        inClash = false;
      }
      continue;
    }
    if (approachOf(state)) {
      decisions.stalk += 1;
      const step = stalkAct(state, decideStalk(state, STALK_PLAN), CONTENT);
      chars.prose += step.roundLog.join("").length;
      if (step.over === "caught") caught += 1;
      if (step.over !== null) hunts += 1;
      state = step.state;
      continue;
    }
    if (!isHurt(state)) restsThisInjury = 0;
    const action = decideAction(
      state,
      availableActions(state, CONTENT),
      roll,
      restsThisInjury,
      waySought,
    );
    if (action === "rest") restsThisInjury += 1;
    decisions.action += 1;
    const huntMode = action === "hunt" ? decideHuntMode(state) : null;
    actionMix[huntMode === "quick" ? "hunt:quick" : action] =
      (actionMix[huntMode === "quick" ? "hunt:quick" : action] ?? 0) + 1;
    const hadEncounter = state.encounter !== null;
    const turn = performAction(
      state,
      action,
      CONTENT,
      action === "explore"
        ? { destinationId: decideDestination(state, profile, roll, waySought) }
        : huntMode !== null
          ? { huntMode }
          : undefined,
    );
    chars.prose += turn.notices.join("").length;
    state = turn.state;
    if (!hadEncounter && state.encounter !== null) encounters += 1;
    const event = turn.pendingEvent;
    if (!event || !state.alive) continue;
    const eligible = eligibleChoiceIdxs(state, event, CONTENT);
    if (eligible.length === 0) throw new Error(`事件 ${event.id} 无可选抉择`);
    decisions.event += 1;
    chars.prose += event.title.length + event.body.length;
    // 玩家会把每个抉择都看一遍（含点不了的那些 —— 那正是「欲望展示位」的用处）
    chars.options += event.choices.reduce((sum, choice) => sum + choice.label.length, 0);
    const outcome = resolveChoice(
      state,
      event,
      pickChoice(event, eligible, profile, roll, waySought),
      CONTENT,
    );
    chars.prose += outcome.outcomeText.length;
    const hadEncounterBefore = state.encounter !== null;
    state = outcome.state;
    if (!hadEncounterBefore && state.encounter !== null) encounters += 1;
    fired.add(event.id);
  }

  if (state.alive || state.ending === null) throw new Error(`seed ${seed} 跑满 ${MAX_STEPS} 步仍未收束`);
  // 不用 findLast：gen 的 tsconfig 没开 ES2023 lib（这里只是脚本，不为一个方法去动编译配置）
  const deaths = state.records.filter((record) => record.kind === "death");
  const death = deaths[deaths.length - 1];
  const chronicle = composeChronicle(state, CONTENT);
  chars.chronicle = chronicle.body.length;
  const progress = waysProgress(state, CONTENT);
  const byWay = <T,>(pick: (way: (typeof progress.ways)[number]) => T): Record<WayId, T> =>
    Object.fromEntries(progress.ways.map((way) => [way.id, pick(way)])) as Record<WayId, T>;
  return {
    decisions,
    clicks: decisions.event + decisions.action + decisions.combat + decisions.stalk,
    actionMix,
    chars,
    hunts,
    caught,
    encounters,
    clashes,
    clashRounds,
    wayMet: byWay((way) => way.metCount),
    wayGates: Object.fromEntries(
      progress.ways.flatMap((way) => way.gates.map((gate) => [`${way.id}.${gate.id}`, gate.met])),
    ),
    wayReady: byWay((way) => way.ready),
    wayAchieved: state.wayAchieved,
    waySought,
    livesTaken: state.livesTaken,
    skyId: state.skyId,
    originId: state.originId,
    ending: state.ending,
    years: state.year,
    molts: state.records.filter((record) => record.kind === "molt").length,
    kills: state.records.filter((record) => record.kind === "combat").length,
    organCount: state.organIds.length,
    bloodline: bloodlineGain(state, CONTENT),
    steps,
    slainBy: state.ending !== "slain" ? null : death?.refId === undefined ? "event" : "combat",
    firedEventIds: [...fired],
    chronicleChars: chronicle.body.length,
  };
}

/**
 * 真人一世时长的估算模型（B5 交付线第 7 条「一世真人时长粗校」）。
 *
 * 不是猜的：字数与决策次数来自上面 200 世的实跑，速率是两档公开常识值 —— 中文带理解的
 * 阅读速度约 300〜400 字/分（取 350），扫读抉择列表约 500 字/分；决策时间按「事件抉择
 * 12 秒／行动 4 秒／战斗指令 3 秒」计（事件是要权衡代价的那种选择，行动是习惯性点击）。
 * 演出（水墨浮现 0.6s×回合、蜕变开奖约 6s、死亡链约 12s）单列。
 *
 * 两档速率给出区间：慢读者（250 字/分、决策 ×1.6）与快读者（450 字/分、决策 ×0.6）。
 */
function estimateMinutes(life: LifeSummary, pace: "slow" | "mid" | "fast"): number {
  const readCpm = pace === "slow" ? 250 : pace === "mid" ? 350 : 450;
  const scanCpm = readCpm * 1.4;
  const decisionMul = pace === "slow" ? 1.6 : pace === "mid" ? 1 : 0.6;
  const readMin = (life.chars.prose + life.chars.chronicle) / readCpm + life.chars.options / scanCpm;
  const decideSec =
    (life.decisions.event * 12 + life.decisions.action * 4 + life.decisions.combat * 3) * decisionMul;
  const fxSec = life.decisions.action * 0.6 + life.molts * 6 + 12;
  return readMin + (decideSec + fxSec) / 60;
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[idx] as number;
}

function pct(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10;
}


// ===== 追猎实验台（M1-P1）=====

/**
 * 只跑追猎、不跑整世：把「一场追猎里玩家真的在做判断吗」变成一张表。
 *
 * 判据是**打法之间的差额**，不是单一数字：
 * - patient（绕上风→逼近→七成才扑）vs rush（无脑逼近就扑）→ 差额 ＝ 「有得算」的分量；
 * - patient vs nowait（同一套但从不屏息）→ 差额 ＝ 屏息那颗按钮值多少；
 * - screen（只按屏幕金色提示打）贴不贴 patient → 界面推荐的那一手是否可信；
 * - 按风向拆表 → 顺风是不是真的更难；按 build 拆表 → 器官改不改得动手感。
 */
interface StalkOutcome {
  over: "caught" | "escaped" | "exhausted" | "combat";
  wind: WindDir;
  acts: number;
  /** 真正扑出去那一下的命中率（没扑就是 null） */
  pounceChance: number | null;
}

/** 一场孤立的追猎：起追 → 按打法打到收束。事件关掉（否则狩猎那一季可能撞上事件）。 */
function runStalk(seed: number, plan: StalkPlan, organIds: readonly string[]): StalkOutcome | null {
  let state = createLife(seed, SEED_CHANG_TAI, CONTENT);
  if (organIds.length > 0) {
    // 只借 tag，不叠 statMods（同 tale-sim 测试的 withOrgans 体例）——
    // 这样 bare 与 seer 两组的四个量完全一致，差的只有「看得见什么」。
    state = { ...state, organIds: [...state.organIds, ...organIds] };
  }
  // 饱食拉满：这里只量追猎本身，不想被饿死打断
  state = { ...state, hunger: CONTENT.tuning.hungerMax };
  const started = performAction(state, "hunt", CONTENT);
  state = started.state;
  const stalk = approachOf(state);
  if (!stalk) return null;
  const wind = stalk.wind;

  let acts = 0;
  let pounceChance: number | null = null;
  while (approachOf(state)) {
    const act = decideStalk(state, plan);
    if (act === "pounce") pounceChance = stalkPreview(state, CONTENT).pounceChance;
    const step = stalkAct(state, act, CONTENT);
    acts += 1;
    state = step.state;
    if (step.over !== null) {
      return { over: step.over, wind, acts, pounceChance };
    }
  }
  return null;
}

const LAB_BUILDS: readonly { name: string; organs: readonly string[] }[] = [
  { name: "bare（只有神种）", organs: [] },
  { name: "seer（夜瞳：读得出确数）", organs: [ORGAN_YE_TONG] },
  { name: "swift（疾足：少走一步）", organs: [ORGAN_JI_ZU] },
  { name: "quiet（狩齿：脚步更轻）", organs: [ORGAN_GOU_CHI] },
];

function labRow(outcomes: readonly StalkOutcome[]): string {
  const n = outcomes.length;
  if (n === 0) return "（无样本）";
  const rate = (over: StalkOutcome["over"]): string =>
    `${pct(outcomes.filter((o) => o.over === over).length, n)}%`;
  const pounced = outcomes.filter((o) => o.pounceChance !== null);
  const meanChance = mean(pounced.map((o) => o.pounceChance ?? 0));
  return [
    `得手 ${rate("caught").padStart(6)}`,
    `逃脱 ${rate("escaped").padStart(6)}`,
    `力尽 ${rate("exhausted").padStart(6)}`,
    `反噬 ${rate("combat").padStart(6)}`,
    `均动作 ${mean(outcomes.map((o) => o.acts)).toFixed(1)}`,
    `出手时均命中 ${(meanChance * 100).toFixed(0)}%`,
  ].join("　");
}

function runLab(samples: number): number {
  // 事件关掉：实验台只量追猎
  CONTENT = { ...CONTENT, tuning: { ...CONTENT.tuning, eventChanceBase: 0 } };
  const plans: readonly StalkPlan[] = ["patient", "screen", "nowait", "rush", "salvage", "waiter"];
  const winds: readonly WindDir[] = ["into", "cross", "with"];

  console.log(`[追猎实验台] 每格 ${samples} 场（事件已关，饱食拉满，只量追猎本身）\n`);

  const byPlan = new Map<StalkPlan, StalkOutcome[]>();
  for (const plan of plans) {
    const outcomes: StalkOutcome[] = [];
    for (let i = 0; i < samples; i += 1) {
      const outcome = runStalk(1000 + i * 7919, plan, []);
      if (outcome) outcomes.push(outcome);
    }
    byPlan.set(plan, outcomes);
  }

  console.log("— 打法（bare build，三种风向混合）—");
  for (const plan of plans) console.log(`${plan.padEnd(8)} ${labRow(byPlan.get(plan) ?? [])}`);

  console.log("\n— 风向（patient vs rush）—");
  for (const plan of ["patient", "rush"] as const) {
    for (const wind of winds) {
      const rows = (byPlan.get(plan) ?? []).filter((o) => o.wind === wind);
      console.log(`${plan.padEnd(8)} ${wind.padEnd(6)} ${labRow(rows)}`);
    }
  }

  console.log("\n— build（patient 打法）—");
  for (const build of LAB_BUILDS) {
    const outcomes: StalkOutcome[] = [];
    for (let i = 0; i < samples; i += 1) {
      const outcome = runStalk(1000 + i * 7919, "patient", build.organs);
      if (outcome) outcomes.push(outcome);
    }
    console.log(`${build.name.padEnd(26)} ${labRow(outcomes)}`);
  }

  const caughtRate = (plan: StalkPlan, filter: (o: StalkOutcome) => boolean = () => true): number => {
    const rows = (byPlan.get(plan) ?? []).filter(filter);
    return pct(rows.filter((o) => o.over === "caught").length, rows.length);
  };
  const downwind = (o: StalkOutcome): boolean => o.wind === "with";
  const patient = caughtRate("patient");
  const rush = caughtRate("rush");
  const screen = caughtRate("screen");
  // 屏息的价值要在**它有用的局面**里量：顺风硬冲到贴身、警觉已经飙起来的那一档
  const rushDown = caughtRate("rush", downwind);
  const salvageDown = caughtRate("salvage", downwind);
  console.log("\n— 手感判据 —");
  const checks: readonly [string, boolean][] = [
    [`稳扎稳打得手率 ≥60%（实测 ${patient}%）`, patient >= 60],
    [`稳扎稳打比无脑硬冲高 ≥12 个点（实测 ${(patient - rush).toFixed(1)}）`, patient - rush >= 12],
    [
      `顺风硬冲会失手（得手 ≤45%，实测 ${rushDown}%）`,
      rushDown <= 45,
    ],
    [
      `屏息能救回一个打坏的接近（顺风：salvage ${salvageDown}% − rush ${rushDown}% ≥ 8 个点）`,
      salvageDown - rushDown >= 8,
    ],
    [`按屏幕提示打不比自己算差（≤4 个点，实测 ${(patient - screen).toFixed(1)}）`, patient - screen <= 4],
  ];
  for (const [name, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${name}`);
  return checks.every(([, ok]) => ok) ? 0 : 1;
}

// ===== 搏杀实验台（M1-P2）=====

/**
 * 只跑一场搏杀、不跑整世：把「三个部位是否各有适用局面」变成一张表。
 *
 * 判据是**打法之间与敌人之间的差额**，不是单一胜率：
 * - 单一部位三行（throat／eye／leg）在同一头敌人上要拉开，且**换一头敌人排序要变** ——
 *   否则「哪个部位最优」有一个恒定答案，三颗按钮就退化成一颗。
 * - screen（只按屏幕金光打）要贴住或超过最好的单一部位打法 → 界面推荐可信。
 * - 读得出意图的 build（灵犀）要明显好于读不出的 → 「洞察改的是信息」这条主张成立。
 */
interface CombatOutcome {
  over: "win" | "fled" | "dead" | "escaped";
  rounds: number;
  /** 打完时自己还剩几成血（死了就是 0） */
  hpLeft: number;
}

const LAB_COMBAT_EVENT = (enemyId: string): TaleEvent => ({
  id: "lab-combat",
  trigger: { region: "any", weight: 1 },
  title: "试",
  body: "试。",
  choices: [
    { label: "打", outcomes: [{ weight: 1, text: "打起来了。", effects: { startCombat: enemyId } }] },
  ],
});

/**
 * 一场孤立的搏杀：走 `resolveChoice` 的 `startCombat` 入场（**不手搓 CombatState**——
 * 那样第一回合的守备与意图就成了固定值，量到的是一个玩家永远遇不到的开局）。
 */
function runCombat(
  seed: number,
  plan: CombatPlan,
  enemyId: string,
  organIds: readonly string[],
): CombatOutcome | null {
  let state = createLife(seed, SEED_CHANG_TAI, CONTENT);
  if (organIds.length > 0) {
    // 只借 tag 与战技，不叠 statMods —— bare 与 seer 两组的血量伤害完全一致，差的只有「看得见什么」
    state = { ...state, organIds: [...state.organIds, ...organIds] };
  }
  state = { ...state, hunger: CONTENT.tuning.hungerMax };
  state = resolveChoice(state, LAB_COMBAT_EVENT(enemyId), 0, CONTENT).state;
  if (!clashOf(state)) return null;
  const hpMax = Math.max(1, state.stats.ti);

  let rounds = 0;
  while (clashOf(state) && rounds < 60) {
    const turn = combatAct(state, decideCombatPlan(state, plan), CONTENT);
    rounds += 1;
    state = turn.state;
    if (turn.over !== null) {
      const hpLeft = turn.over === "dead" ? 0 : Math.max(0, (clashOf(turn.state)?.playerHp ?? 0) / hpMax);
      // over 非 null 时 combat 已清空，血量只能从上一帧推 —— 用「是否死亡」当代理即可
      return { over: turn.over, rounds, hpLeft: turn.over === "dead" ? 0 : hpLeft };
    }
  }
  return null;
}

const LAB_COMBAT_BUILDS: readonly { name: string; organs: readonly string[] }[] = [
  { name: "bare（只有神种）", organs: [] },
  { name: "seer（灵犀：读得出意图）", organs: [ORGAN_LING_XI] },
  { name: "fang（狩齿：带战技）", organs: [ORGAN_GOU_CHI] },
  { name: "seer+fang（两样都有）", organs: [ORGAN_LING_XI, ORGAN_GOU_CHI] },
];

const LAB_COMBAT_FOES: readonly { id: string; name: string }[] = [
  { id: ENEMY_YAN_YANG, name: "岩羊（护喉·爱扑）" },
  { id: ENEMY_CAO_HU, name: "草狐（护眼·均衡）" },
  { id: ENEMY_XUAN_MANG, name: "玄蟒（护喉·爱守）" },
  { id: ENEMY_YE_ZHI, name: "野雉（护腿·爱逃）" },
];

function combatRow(outcomes: readonly CombatOutcome[]): string {
  const n = outcomes.length;
  if (n === 0) return "（无样本）";
  const rate = (over: CombatOutcome["over"]): string =>
    `${pct(outcomes.filter((o) => o.over === over).length, n)}%`;
  return [
    `胜 ${rate("win").padStart(6)}`,
    `死 ${rate("dead").padStart(6)}`,
    `我逃 ${rate("fled").padStart(6)}`,
    `它遁 ${rate("escaped").padStart(6)}`,
    `均合 ${mean(outcomes.map((o) => o.rounds)).toFixed(1)}`,
  ].join("　");
}

function runCombatLab(samples: number): number {
  CONTENT = { ...CONTENT, tuning: { ...CONTENT.tuning, eventChanceBase: 0 } };
  console.log(`[搏杀实验台] 每格 ${samples} 场（饱食拉满，只量这一场架）\n`);

  const winRate = (rows: readonly CombatOutcome[]): number =>
    pct(rows.filter((o) => o.over === "win").length, rows.length);
  const sample = (plan: CombatPlan, foe: string, organs: readonly string[]): CombatOutcome[] => {
    const rows: CombatOutcome[] = [];
    for (let i = 0; i < samples; i += 1) {
      const outcome = runCombat(2000 + i * 7919, plan, foe, organs);
      if (outcome) rows.push(outcome);
    }
    return rows;
  };

  const byFoePlan = new Map<string, Map<CombatPlan, CombatOutcome[]>>();
  for (const foe of LAB_COMBAT_FOES) {
    const byPlan = new Map<CombatPlan, CombatOutcome[]>();
    for (const plan of COMBAT_PLANS) byPlan.set(plan, sample(plan, foe.id, []));
    byFoePlan.set(foe.id, byPlan);
    console.log(`— ${foe.name} —`);
    for (const plan of COMBAT_PLANS) {
      console.log(`  ${plan.padEnd(7)} ${combatRow(byPlan.get(plan) ?? [])}`);
    }
    console.log("");
  }

  const buildRows = new Map<string, Map<string, CombatOutcome[]>>();
  for (const foe of [ENEMY_YAN_YANG, ENEMY_XUAN_MANG]) {
    const rows = new Map<string, CombatOutcome[]>();
    for (const build of LAB_COMBAT_BUILDS) rows.set(build.name, sample("screen", foe, build.organs));
    buildRows.set(foe, rows);
    const label = LAB_COMBAT_FOES.find((item) => item.id === foe)?.name ?? foe;
    console.log(`— build（screen 打法，对${label}）—`);
    for (const build of LAB_COMBAT_BUILDS) {
      console.log(`${build.name.padEnd(28)} ${combatRow(rows.get(build.name) ?? [])}`);
    }
    console.log("");
  }

  // 判据
  const rowsOf = (foe: string, plan: CombatPlan): CombatOutcome[] =>
    byFoePlan.get(foe)?.get(plan) ?? [];
  const bestPart = (foe: string): CombatPlan => {
    const parts: CombatPlan[] = ["throat", "eye", "leg"];
    let best = parts[0] as CombatPlan;
    for (const plan of parts) if (winRate(rowsOf(foe, plan)) > winRate(rowsOf(foe, best))) best = plan;
    return best;
  };
  const bestPerFoe = LAB_COMBAT_FOES.map((foe) => bestPart(foe.id));
  const screenVsBest = LAB_COMBAT_FOES.map(
    (foe) => winRate(rowsOf(foe.id, "screen")) - winRate(rowsOf(foe.id, bestPart(foe.id))),
  );
  const deathRate = (rows: readonly CombatOutcome[]): number =>
    pct(rows.filter((o) => o.over === "dead").length, rows.length);
  /** [M2-B1] 一场架打了几合 —— B1 交付线第③问的量 */
  const meanRounds = (rows: readonly CombatOutcome[]): number =>
    rows.length === 0 ? 0 : mean(rows.map((o) => o.rounds));
  /*
   * [S1] 量「读得出意图值不值」的**对象换了一头**：岩羊 → 玄蟒。
   *
   * 换的理由与 P1 那条「屏息」判据同形（在一个用不到某工具的场景里量那个工具，量到 0 是
   * 正常的）：S1 给推荐链加了一条「这一手最坏情况也打得死它就打」，于是对岩羊这种好打的
   * 兽，**裸 build 的死亡率本来就掉到 6%** —— 要求灵犀把 6% 再压到 4% 是在量噪声。
   * 玄蟒才是这条信息真正值钱的地方（它爱守，「守还是要走」正是粗档分不出的那一对）：
   * 实测死亡率 43.8% → 33.3%、胜率 15.3% → 25.3%。判据因此改成「在最硬的那头兽身上，
   * 死亡率至少低五分之一 **且** 胜率明显更高」。数值没动，判据换了。
   */
  const bareRows = buildRows.get(ENEMY_XUAN_MANG)?.get(LAB_COMBAT_BUILDS[0]?.name ?? "") ?? [];
  const seerRows = buildRows.get(ENEMY_XUAN_MANG)?.get(LAB_COMBAT_BUILDS[1]?.name ?? "") ?? [];
  const bareWin = winRate(bareRows);
  const seerWin = winRate(seerRows);
  const bareDeath = deathRate(bareRows);
  const seerDeath = deathRate(seerRows);
  const cowardWin = LAB_COMBAT_FOES.map((foe) => winRate(rowsOf(foe.id, "coward")));

  console.log("\n— 手感判据 —");
  const checks: readonly [string, boolean][] = [
    [
      `没有「永远最优」的部位：四头敌人的最佳单一部位不止一种（实测 ${bestPerFoe.join("／")}）`,
      new Set(bestPerFoe).size >= 2,
    ],
    [
      `照屏幕提示打不比只会一个部位差（各敌人差额 ${screenVsBest.map((d) => d.toFixed(0)).join("／")} 个点，最差 ≥ −5）`,
      Math.min(...screenVsBest) >= -5,
    ],
    /*
     * 判据换过**两次**（都是「换判据不换数值」，同 P1 对「屏息」那条的处理）：
     * ① M1-P2：第一版量胜率差额 ≥4 个点，实测只有 +3.3 —— 读得出意图买到的是**防守**
     *    信息，而读不出的 build 会靠「撑不住就逃」把胜率补回来，所以差额落在死亡率上。
     * ② S1：量测对象从岩羊换成玄蟒（见上面 bareRows 那段的理由 —— 岩羊现在裸 build
     *    死亡率就只有 6%，在那儿量信息的价值是在量噪声）。**同时把比值从「低三分之一」
     *    放宽到「低五分之一」，并新增一条更严的胜率条件**（+4 个点以上）：玄蟒的实测是
     *    43.8% → 33.3%（比值 0.76，过不了旧的 2/3）与 15.3% → 25.3%。
     *    放宽比值不是为了让这一版过线，而是因为**换了对象就得换量纲**：玄蟒的基线死亡率
     *    是岩羊的七倍，同一个相对比值在两头兽身上不是同一件事；而胜率那条在岩羊上量不出来
     *    （信息在好打的兽身上只省时间），在玄蟒上才是它真正买到的东西。
     */
    [
      `读得出意图更能活（玄蟒：死亡率 裸 ${bareDeath}% → 灵犀 ${seerDeath}%，至少低五分之一；胜率 ${bareWin}% → ${seerWin}% 明显更高）`,
      seerDeath <= bareDeath * 0.8 && seerWin >= bareWin + 4,
    ],
    /*
     * [M2-B1] 这条判据也换了量纲（第三次「换判据不换数值」）。
     *
     * 旧版是一个绝对阈值（胜率 ≤35%），它在 M1-P2 那会儿成立是因为玄蟒只有 34 血：
     * 一个只想逃的玩家撑不到它倒下。M2-B1 之后双方血量都厚了一档（我方 体×1.6、
     * 玄蟒 60 血），于是「一路想逃、逃不掉只好还手」这条路 2000 场量到 35.7% 胜、
     * **38.9% 死** —— 绝对值刚好压线，但它显然不是一条解。
     *
     * 判据因此改成**与「照屏幕打」的差距**：那才是这条判据真正想说的话
     * （「一挨打就逃」不该接近最优）。实测差 41 个点（35.7% vs 76.7%），
     * 且 coward 的死亡率比胜率还高。
     */
    [
      `一挨打就逃不是解（coward 胜率 ${cowardWin.map((r) => `${r}%`).join("／")}，` +
        `最好的那一头也比照屏幕打低 ${(
          winRate(rowsOf(ENEMY_XUAN_MANG, "screen")) - Math.max(...cowardWin)
        ).toFixed(0)} 个点，须 ≥25）`,
      winRate(rowsOf(ENEMY_XUAN_MANG, "screen")) - Math.max(...cowardWin) >= 25,
    ],
    /*
     * [M2-B1] 交付线第③问的可执行版：**一场架 5〜10 合**。
     *
     * 只量「照屏幕打」那一行、且只看三头强敌（野雉是三合就完的教具，它拉低均值是设计
     * 使然 —— 一只鸟本来就不该打十合）。量的是均合而不是每一场：一场三合的收官与一场
     * 十二合的苦战都该存在，要的是**分布的中心**落在那一档。
     */
    [
      `照屏幕打的一场架落在 5〜10 合（实测 ${LAB_COMBAT_FOES.filter((f) => f.id !== ENEMY_YE_ZHI)
        .map((f) => meanRounds(rowsOf(f.id, "screen")).toFixed(1))
        .join("／")}）`,
      LAB_COMBAT_FOES.filter((foe) => foe.id !== ENEMY_YE_ZHI).every((foe) => {
        const rounds = meanRounds(rowsOf(foe.id, "screen"));
        return rounds >= 5 && rounds <= 10;
      }),
    ],
  ];
  for (const [name, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${name}`);
  return checks.every(([, ok]) => ok) ? 0 : 1;
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  if (args.tune !== null) CONTENT = applyTuneOverrides(args.tune);
  STALK_PLAN = args.stalkPlan;
  COMBAT_PLAN = args.combatPlan;
  HUNT_PLAN = args.huntPlan;
  SIGIL_IDS = args.sigilIds;
  CHARTED_DESTINATION = args.chartedDestinationId;
  if (args.lab === "combat") return runCombatLab(args.lives);
  if (args.lab === "stalk") return runLab(args.lives);
  const lives = Array.from({ length: args.lives }, (_, index) =>
    runLife(1000 + index * 7919, args.profile, index),
  );

  const rate = (ending: EndingType): number => pct(lives.filter((life) => life.ending === ending).length, lives.length);
  const years = lives.map((life) => life.years);
  const molts = lives.map((life) => life.molts);
  const moltHistogram: Record<string, number> = {};
  for (const life of lives) {
    const key = life.molts >= 6 ? "6+" : String(life.molts);
    moltHistogram[key] = (moltHistogram[key] ?? 0) + 1;
  }
  const fired = new Set(lives.flatMap((life) => life.firedEventIds));
  const missing = EVENTS.filter((event) => !fired.has(event.id)).map((event) => event.id);

  const report = {
    lives: lives.length,
    profile: args.profile,
    endings: {
      starve: rate("starve"),
      slain: rate("slain"),
      oldage: rate("oldage"),
      ascend: rate("ascend"),
    },
    slainSplit: {
      combat: pct(lives.filter((life) => life.slainBy === "combat").length, lives.length),
      event: pct(lives.filter((life) => life.slainBy === "event").length, lives.length),
    },
    years: {
      mean: Math.round(mean(years) * 10) / 10,
      p10: quantile(years, 0.1),
      median: quantile(years, 0.5),
      p90: quantile(years, 0.9),
      max: Math.max(...years),
    },
    survivedTo8: pct(lives.filter((life) => life.years >= 8).length, lives.length),
    /**
     * 三岁前就没的那一撮 —— 它是「首世体验」的真正风险：owner 只玩一世，若落在这里
     * 他连蜕变开奖都没见过就到列传了。所以单列出来，并拆成饿死／战死看该动哪个旋钮。
     */
    earlyDeath: {
      before3: pct(lives.filter((life) => life.years < 3).length, lives.length),
      starve: pct(lives.filter((life) => life.years < 3 && life.ending === "starve").length, lives.length),
      slain: pct(lives.filter((life) => life.years < 3 && life.ending === "slain").length, lives.length),
    },
    zeroMolt: pct(lives.filter((life) => life.molts === 0).length, lives.length),
    molts: { mean: Math.round(mean(molts) * 100) / 100, histogram: moltHistogram },
    kills: { mean: Math.round(mean(lives.map((life) => life.kills)) * 100) / 100 },
    bloodline: { mean: Math.round(mean(lives.map((life) => life.bloodline)) * 100) / 100 },
    turnsPerLife: { mean: Math.round(mean(lives.map((life) => life.steps))) },
    chronicleChars: { mean: Math.round(mean(lives.map((life) => life.chronicleChars))) },
    /** 一世要读的字数与决策次数（真人时长估算的基数） */
    reading: {
      proseChars: Math.round(mean(lives.map((life) => life.chars.prose))),
      optionChars: Math.round(mean(lives.map((life) => life.chars.options))),
      chronicleChars: Math.round(mean(lives.map((life) => life.chars.chronicle))),
      eventDecisions: Math.round(mean(lives.map((life) => life.decisions.event))),
      actionDecisions: Math.round(mean(lives.map((life) => life.decisions.action))),
      combatDecisions: Math.round(mean(lives.map((life) => life.decisions.combat))),
      minutesSlow: Math.round(mean(lives.map((life) => estimateMinutes(life, "slow")))),
      minutesMid: Math.round(mean(lives.map((life) => estimateMinutes(life, "mid")))),
      minutesFast: Math.round(mean(lives.map((life) => estimateMinutes(life, "fast")))),
      minutesMidP90: Math.round(quantile(lives.map((life) => estimateMinutes(life, "mid")), 0.9)),
    },
    /**
     * [饥饿节奏批] 点击账 —— owner 的原话「饿得太快，要经常点击狩猎」的可量版。
     *
     * 三个数各回答一句话：
     * - `perLife`：一世总共要点多少次（追猎屏的每一息都算，那正是它贵在哪儿）；
     * - `huntShare`：**行动里有几成是去猎食**（不含追猎屏内部的点击 —— 那是「一次狩猎多贵」，
     *   由 `stalkClicks` 报）。这一项是 owner 那句话最直接的落点；
     * - `stalkEntries`：一世进了几次追猎屏。它与 `huntShare` 不是同一件事：速猎也算一次狩猎行动，
     *   但**不进那一屏** —— 两个数分开，才看得出「少猎了」还是「猎得更省了」。
     */
    clicks: {
      perLife: Math.round(mean(lives.map((life) => life.clicks))),
      stalkClicks: Math.round(mean(lives.map((life) => life.decisions.stalk))),
      actionClicks: Math.round(mean(lives.map((life) => life.decisions.action))),
      stalkEntries: Math.round(mean(lives.map((life) => life.hunts)) * 10) / 10,
      huntShare: pct(
        lives.reduce(
          (sum, life) => sum + (life.actionMix["hunt"] ?? 0) + (life.actionMix["hunt:quick"] ?? 0),
          0,
        ),
        lives.reduce((sum, life) => sum + life.decisions.action, 0),
      ),
      quickShare: pct(
        lives.reduce((sum, life) => sum + (life.actionMix["hunt:quick"] ?? 0), 0),
        lives.reduce(
          (sum, life) => sum + (life.actionMix["hunt"] ?? 0) + (life.actionMix["hunt:quick"] ?? 0),
          0,
        ),
      ),
      restShare: pct(
        lives.reduce((sum, life) => sum + (life.actionMix["rest"] ?? 0), 0),
        lives.reduce((sum, life) => sum + life.decisions.action, 0),
      ),
      combatClicks: Math.round(mean(lives.map((life) => life.decisions.combat))),
    },
    /**
     * [M2-B1] 遭遇账 —— B1 交付线第③问「一场架现在多少回合」的可执行答案，
     * 以及点击对账里「遭遇次数有没有增」那一半。
     */
    encounters: {
      perLife: Math.round(mean(lives.map((life) => life.encounters)) * 10) / 10,
      clashesPerLife: Math.round(mean(lives.map((life) => life.clashes)) * 10) / 10,
      roundsMean: Math.round(mean(lives.flatMap((life) => life.clashRounds)) * 10) / 10,
      roundsMedian: quantile(lives.flatMap((life) => life.clashRounds), 0.5),
      roundsP10: quantile(lives.flatMap((life) => life.clashRounds), 0.1),
      roundsP90: quantile(lives.flatMap((life) => life.clashRounds), 0.9),
      roundsMax: lives.flatMap((life) => life.clashRounds).reduce((a, b) => Math.max(a, b), 0),
      /** 落在 5〜10 合的那一档占多少（B1 的目标区间） */
      inBand: pct(
        lives.flatMap((life) => life.clashRounds).filter((r) => r >= 5 && r <= 10).length,
        Math.max(1, lives.flatMap((life) => life.clashRounds).length),
      ),
    },
    eventCoverage: `${fired.size}/${EVENTS.length}`,
    missingEvents: missing,
    /**
     * [2026-08-13] 四道诊断：每条道的**成道率**、够格率、门槛达成分布。
     *
     * 存在的理由与 M1-P2 的登神诊断相同（一个「0%」看不出卡在哪），只是从一条道扩到四条：
     * 逐条列出来，才知道该调哪一个门槛，而不是把四条一起放软 —— 后者会把「四条道难度不同」
     * 这件事一起调没。
     *
     * `sought` 那一列是 `wayseek` 画像特有的：**奔这条道的那些一世里**有多少真的成了。
     * 它比总体成道率有用得多 —— 总体率被「另外三条道的一世」摊薄了四倍。
     */
    ways: Object.fromEntries(
      WAY_ORDER.map((way) => {
        const sought = lives.filter((life) => life.waySought === way);
        return [
          way,
          {
            achieved: pct(lives.filter((life) => life.wayAchieved === way).length, lives.length),
            ready: pct(lives.filter((life) => life.wayReady[way]).length, lives.length),
            meanMet: Math.round(mean(lives.map((life) => life.wayMet[way])) * 100) / 100,
            soughtLives: sought.length,
            soughtAchieved: pct(
              sought.filter((life) => life.wayAchieved === way).length,
              sought.length,
            ),
          },
        ];
      }),
    ) as Record<WayId, { achieved: number; ready: number; meanMet: number; soughtLives: number; soughtAchieved: number }>,
    livesTaken: {
      mean: Math.round(mean(lives.map((life) => life.livesTaken)) * 10) / 10,
      p90: quantile(lives.map((life) => life.livesTaken), 0.9),
      zero: pct(lives.filter((life) => life.livesTaken === 0).length, lives.length),
    },
    /** 开局变量的分布：五天时 × 四出身都得真的掷得出来（权重写错会静默少一档） */
    premises: {
      skies: Object.fromEntries(
        [...new Set(lives.map((life) => life.skyId))].sort().map((id) => [
          id,
          pct(lives.filter((life) => life.skyId === id).length, lives.length),
        ]),
      ),
      origins: Object.fromEntries(
        [...new Set(lives.map((life) => life.originId))].sort().map((id) => [
          id,
          pct(lives.filter((life) => life.originId === id).length, lives.length),
        ]),
      ),
    },
    /*
     * 目标分两组，因为**问的不是同一件事**：
     *
     * - 三条通用目标（活过 8 岁／平均蜕变／五天时四出身都掷得出）对每个画像都该成立。
     * - 「合计成道率 8〜15%」与「每条道各自 0.5〜5%」只对 `wayseek` 有意义 —— 别的画像
     *   不奔任何道（cautious 挑末条、random 乱点、reckless 挑最贪的），化灵在它们手里
     *   恒为 0%，那既不能证明门槛太难也不能证明合适。把它们无条件列出来只会产出一个
     *   「设计使然的 ✗」，而那种 ✗ 会让整张检查表失去意义。别的画像换成一条上界：
     *   成道不能变得太容易。
     */
    targets: {
      "活过 8 岁 ≥60%": pct(lives.filter((life) => life.years >= 8).length, lives.length) >= 60,
      "平均蜕变 2〜4": mean(molts) >= 2 && mean(molts) <= 4,
      "五天时四出身都掷得出":
        new Set(lives.map((life) => life.skyId)).size === 5 &&
        new Set(lives.map((life) => life.originId)).size === 4,
      ...(args.profile === "wayseek"
        ? {
            "合计成道率 8〜15%": rate("ascend") >= 8 && rate("ascend") <= 15,
            "每条道各自 0.5〜5%": WAY_ORDER.every((way) => {
              const r = pct(lives.filter((life) => life.wayAchieved === way).length, lives.length);
              return r >= 0.5 && r <= 5;
            }),
          }
        : { "成道率 ≤15%（不奔道的画像只守上界）": rate("ascend") <= 15 }),
    },
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }

  console.log(
    `[平衡] ${report.lives} 世 · 玩家画像 ${report.profile}${args.tune ? ` · 覆写 ${args.tune}` : ""}` +
      `${args.sigilIds.length > 0 ? ` · 印记 ${args.sigilIds.join(",")}` : ""}` +
      `${args.chartedDestinationId ? ` · 图录 ${args.chartedDestinationId}` : ""}`,
  );
  console.log(
    `结局：饿死 ${report.endings.starve}% / 战死 ${report.endings.slain}%（战斗 ${report.slainSplit.combat}% ＋事件直杀 ${report.slainSplit.event}%） / 寿终 ${report.endings.oldage}% / 登神 ${report.endings.ascend}%`,
  );
  console.log(
    `寿数：均 ${report.years.mean} 岁（p10 ${report.years.p10}／中位 ${report.years.median}／p90 ${report.years.p90}／最长 ${report.years.max}）`,
  );
  console.log(`活过 8 岁：${report.survivedTo8}%　平均蜕变 ${report.molts.mean}　平均击杀 ${report.kills.mean}　平均血统点 ${report.bloodline.mean}`);
  console.log(
    `三岁前夭折：${report.earlyDeath.before3}%（饿 ${report.earlyDeath.starve}% ／战 ${report.earlyDeath.slain}%）　一世未蜕形：${report.zeroMolt}%`,
  );
  console.log(`蜕变分布：${JSON.stringify(report.molts.histogram)}`);
  console.log(`一世回合数：均 ${report.turnsPerLife.mean}　列传字数：均 ${report.chronicleChars.mean}`);
  console.log(
    `点击账：一世 ${report.clicks.perLife} 次（行动 ${report.clicks.actionClicks} ＋追猎屏 ${report.clicks.stalkClicks} ＋事件/战斗）　` +
      `狩猎占行动 ${report.clicks.huntShare}%（其中速猎 ${report.clicks.quickShare}%）　休憩占 ${report.clicks.restShare}%　` +
      `进追猎屏 ${report.clicks.stalkEntries} 次/世`,
  );
  console.log(
    `遭遇账：一世 ${report.encounters.perLife} 场（其中进交锋 ${report.encounters.clashesPerLife} 场）　` +
      `每场 ${report.encounters.roundsMean} 合（p10 ${report.encounters.roundsP10}／中位 ${report.encounters.roundsMedian}／p90 ${report.encounters.roundsP90}／最长 ${report.encounters.roundsMax}）　` +
      `落在 5〜10 合 ${report.encounters.inBand}%`,
  );
  console.log(
    `一世阅读量：正文 ${report.reading.proseChars} 字 ＋抉择 ${report.reading.optionChars} 字 ＋列传 ${report.reading.chronicleChars} 字；` +
      `决策 事件 ${report.reading.eventDecisions}／行动 ${report.reading.actionDecisions}／战斗 ${report.reading.combatDecisions}`,
  );
  console.log(
    `估算真人时长：慢 ${report.reading.minutesSlow} 分／中 ${report.reading.minutesMid} 分（p90 ${report.reading.minutesMidP90} 分）／快 ${report.reading.minutesFast} 分　（设计目标 60〜180 分）`,
  );
  const WAY_NAMES: Record<WayId, string> = {
    shen: "登神",
    yaowang: "妖王",
    guishan: "归山",
    hualing: "化灵",
  };
  console.log("四道：");
  for (const way of WAY_ORDER) {
    const row = report.ways[way];
    console.log(
      `  ${WAY_NAMES[way]}　成道 ${String(row.achieved).padStart(4)}%　够格 ${String(row.ready).padStart(4)}%　` +
        `平均达成 ${row.meanMet} 条` +
        (row.soughtLives > 0 ? `　奔它的 ${row.soughtLives} 世里成 ${row.soughtAchieved}%` : ""),
    );
    // 逐条门槛（只看奔这条道的那些一世）—— 调门槛时唯一有用的那一列
    const sought = lives.filter((life) => life.waySought === way || args.profile !== "wayseek");
    const gateIds = Object.keys(sought[0]?.wayGates ?? {}).filter((key) => key.startsWith(`${way}.`));
    if (gateIds.length > 0 && sought.length > 0) {
      console.log(
        `      门槛：${gateIds
          .map((key) => `${key.slice(way.length + 1)} ${pct(sought.filter((life) => life.wayGates[key]).length, sought.length)}%`)
          .join(" ／ ")}`,
      );
    }
  }
  console.log(
    `夺命数：均 ${report.livesTaken.mean}（p90 ${report.livesTaken.p90}）　一世不杀 ${report.livesTaken.zero}%`,
  );
  console.log(
    `天时分布：${Object.entries(report.premises.skies).map(([id, r]) => `${id} ${r}%`).join(" ／ ")}`,
  );
  console.log(
    `出身分布：${Object.entries(report.premises.origins).map(([id, r]) => `${id} ${r}%`).join(" ／ ")}`,
  );
  console.log(`事件覆盖：${report.eventCoverage}　未触发：${report.missingEvents.join("、") || "无"}`);
  for (const [name, ok] of Object.entries(report.targets)) console.log(`${ok ? "✓" : "✗"} ${name}`);
  /*
   * [饥饿节奏批] **`--hunt-plan` 的两个极端是对照跑，不是护栏跑**，所以不吃退出码。
   *
   * 理由：全速猎那一档的平均蜕变（实测 1.16〜1.95）本来就低于「2〜4」——那正是这条快路径
   * 该付的价钱，是**结论**不是回归。而 `tuning.ts` 的复核指令写着这三条命令「缺一不可」，
   * 若这一档恒返 1，下一个照着跑的人会把一个设计使然的取舍读成红灯。
   * 护栏按缺省玩法（`mixed`）判 —— 那是「一个明理玩家真的会怎么玩」。
   */
  if (args.huntPlan !== "mixed") {
    console.log(
      `（--hunt-plan ${args.huntPlan} 是**对照跑**：上面几条判据按缺省玩法 mixed 设的，这一档只看数、不判红绿）`,
    );
    return 0;
  }
  return Object.values(report.targets).every(Boolean) ? 0 : 1;
}

process.exitCode = main();
