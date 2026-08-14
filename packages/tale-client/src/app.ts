/**
 * 屏幕编排与引擎调用。
 *
 * 这是全客户端**唯一**调引擎的地方，也是唯一持有可变状态的地方（`TaleState` 由引擎返回，
 * 这里只搬运不修改）。屏幕模块是纯渲染函数，model/ 是纯视图模型 —— 三层之间不回环。
 *
 * 纪律（引擎 JSDoc 明写、这里逐条落实）：
 * - 拿到非 null 的 `pendingEvent` 必须先 `resolveChoice` 再进下一回合 → `pendingEvent`
 *   非空时行动面板整体禁用。
 * - 战斗日志自己累加 → `over` 非 null 那一刻 `clashOf(state)` 已是 null，末轮日志只能从
 *   `CombatTurn.roundLog` 拿。
 * - 演出播放期间 `busy` 为真、所有按钮禁用 → 防连点把上面两条打穿。
 */

import {
  bloodlineGain,
  combatAct,
  composeChronicle,
  createLife,
  lifeTuning,
  performAction,
  premiseOf,
  resolveChoice,
  stalkAct,
  waysProgress,
  type ActionId,
  type ActionOptions,
  type ChronicleEntry,
  type CombatAct,
  type SynergyDef,
  type TaleEvent,
  type TaleState,
  type TreasureDef,
  type WayId,
  approachOf,
  clashOf,
} from "@shiling/tale-sim";

import { CONTENT, USING_FIXTURE_CONTENT, clearInjectedEvents, injectedEvents, setInjectedEvents } from "./content.js";
import { el, nextFrame } from "./dom.js";
import { endingArt, eventArt, portraitArt } from "./art/assets.js";
import { actionOfButton, buildActionVms } from "./model/actionVm.js";
import { buildDestinationVms, destinationCaption } from "./model/destinationVm.js";
import { buildChronicleVm, buildDeathVm, type ChronicleVm } from "./model/chronicleVm.js";
import { buildCombatVm } from "./model/combatVm.js";
import { diffFloaters, gainedEssenceTypes } from "./model/deltaVm.js";
import { buildDetailVm, detailKey, type DetailSel } from "./model/detailVm.js";
import { buildEventCardVm, type EventCardVm } from "./model/eventVm.js";
import { advanceGuide, buildGuideVm, guideSnapshot, type GuideVm } from "./model/guideVm.js";
import { emptyLog, pushLog, recentLogVm, type LogBuffer, type LogInput, type LogTone } from "./model/logVm.js";
import { buildSeedScreenVm } from "./model/seedVm.js";
import {
  historianConfig,
  postTelemetry,
  reportTelemetry,
  requestChronicle,
  type HistorianConfig,
} from "./ai/historian.js";
import {
  requestScenario,
  scenarioCacheKey,
  scenarioConfig,
  type ScenarioConfig,
} from "./ai/scenario.js";
import type { HistorianResult } from "@shiling/tale-ai";
import { buildStalkVm, type StalkActId } from "./model/stalkVm.js";
import { buildEncounterChromeVm } from "./model/encounterVm.js";
import { buildStatusVm } from "./model/statusVm.js";
import { createFloaterHost, spawnFloaters } from "./fx/floaters.js";
import { playCinematic } from "./fx/cinematic.js";
import { playInkBlot } from "./fx/inkBlot.js";
import { playMoltReveal } from "./fx/moltReveal.js";
import { playSynergyReveal } from "./fx/synergyReveal.js";
import { playTreasureReveal } from "./fx/treasureReveal.js";
import { installMotionClass } from "./fx/motion.js";
import { ESSENCE_RGB, createParticleLayer, type ParticleLayer } from "./fx/particles.js";
import { renderChronicle } from "./screens/chronicleScreen.js";
import { renderPlay, type CenterVm } from "./screens/playScreen.js";
import { renderSeedSelect } from "./screens/seedScreen.js";
import { renderTitle, type ScreenHandle } from "./screens/titleScreen.js";
import {
  browserStorage,
  loadBloodline,
  buyBoon,
  buyChart,
  buyLore,
  buySigil,
  consumeBoon,
  consumeChart,
  noteExploration,
  noteSynergies,
  recordLife,
  saveBloodline,
  unlockSeed,
  type StorageLike,
} from "./persist/bloodline.js";
import { loadGuideDismissed, saveGuideDismissed } from "./persist/guide.js";
import type { Bloodline } from "@shiling/tale-sim";

export type ScreenId = "title" | "seed" | "play" | "chronicle";

/** 出生开场的界面文案（不是内容库的事件正文，是屏幕自己的引导语）。 */
const BIRTH_LEDE = "青丘多狐，草木有灵。你尚不知自己是什么，只知道饿。";

/** 死亡／登神后那颗按钮的字样。 */
const CLOSE_LABELS = { ascend: "登　临", other: "瞑　目" } as const;

/** 引导链走完那句「这条链你已走完：……」停留多久（读完一句的时间），之后永久收起。 */
const GUIDE_COMPLETE_HOLD_MS = 9000;

export interface AppOptions {
  /** 固定随机种子（`?seed=` 传入），用于可复现的手测与 E2E */
  seed?: number;
  storage?: StorageLike | null;
  /**
   * **仅 dev**：出生时额外塞进去的器官 id（`?organs=ye-tong` 传入，见 main.ts）。
   *
   * 只借 tag，不叠 `statMods` —— 与 tale-sim 测试的 `withOrgans` 同体例。存在的理由是
   * P1 的验收标准之一是「带 night-eye 与不带时的体验差异是否明显」，而器官靠真玩要攒好几年，
   * 没有它就只能拿引擎数字讲，拿不到同一场追猎的两张对照截图。
   */
  grantOrganIds?: readonly string[];
  /**
   * **仅 dev**：出生时额外带上的「图鉴知识」（`?lore=xuan-mang` 传入，见 main.ts）。
   *
   * 存在的理由与 `grantOrganIds` 逐字相同：S3 的验收要「同一头猎物、已识与未识的两张
   * 对照截图」，而真玩要先照面、再攒够点数、再转世 —— 拿不到**同一个种子同一场追猎**
   * 的两张图。生产构建里这一段不生效。
   */
  grantLoreEnemyIds?: readonly string[];
  /**
   * [P1] AI 史官的配置。由 main.ts 从 URL ＋ `import.meta.env.DEV` 算出来传进来 ——
   * app.ts 因此不必认识 vite 的 env，测试里也能直接关掉它（缺省即关）。
   */
  ai?: HistorianConfig;
  /**
   * [P2 一世一剧本] 降世时批量生成本世专属事件池的配置。同 `ai`：由 main.ts 算好传进来，
   * 缺省即关（测试与任何非 dev 入口都不该在开局路径上发网络请求）。
   */
  scenario?: ScenarioConfig;
}

export class TaleApp {
  private readonly root: HTMLElement;
  private readonly screenHost: HTMLElement;
  private readonly overlayHost: HTMLElement;
  private readonly floaterHost: HTMLElement;
  private readonly particles: ParticleLayer;
  private readonly storage: StorageLike | null;
  private readonly baseSeed: number;
  private readonly grantOrganIds: readonly string[];
  private readonly grantLoreEnemyIds: readonly string[];

  private screen: ScreenId = "title";
  private titleHandle: ScreenHandle | null = null;
  private bloodline: Bloodline;
  private state: TaleState | null = null;
  private pendingEvent: TaleEvent | null = null;
  private center: CenterVm = { kind: "narration", key: "boot", title: null, lines: [], media: null, continueLabel: null };
  private log: LogBuffer = emptyLog();
  private freshLogIds: ReadonlySet<number> = new Set();
  private busy = false;
  private lifeIndex = 0;
  private chronicleVm: ChronicleVm | null = null;
  /**
   * [2026-08-13] 上一世的终态 —— 择神种屏那句「上一世你死在归山路上，差德行一二」要读它。
   *
   * 只留一世（不是全部历史）：那句话问的是「刚刚发生了什么」，而血统存档里的
   * `ChronicleEntry` 只有岁数与器官数，算不出差距报告（同 `buildChronicleVm` 要 state 的理由）。
   */
  private lastLife: TaleState | null = null;
  /**
   * [P1 AI 史官] 这一世的作传任务 —— **死亡那一刻就起跑**，`endLife` 到时候只是取货。
   *
   * 存 Promise 而不是结果：整段死亡演出（墨渍 ＋ 结局图 ＝ 5.6s）正是它的工期，
   * 而它自带 6s 总预算与静默回落，所以这里既不需要超时逻辑，也不需要 try／catch。
   */
  private chronicleTask: Promise<HistorianResult | null> | null = null;
  /** 上一次作传的结果（只给 `debugSnapshot` 用 —— 玩法不读它） */
  private lastHistorian: HistorianResult | null = null;
  /** AI 史官的开关与模型（`?ai=0` 关、`?aimodel=` 换），一局定一次 */
  private readonly aiConfig: HistorianConfig;
  /** [P2] 一世一剧本的开关与模型（`?scenario=0` 关、`?scenariomodel=` 换） */
  private readonly scenarioConfig: ScenarioConfig;
  /**
   * [P2] 这一世的生成情况 —— **只给 `debugSnapshot` 与日志用**，玩法一个字都不读它。
   *
   * `injected` 是已经进池子的条数（分批到齐，所以它会在一世之内往上走）。
   */
  private scenarioInfo: { source: "ai" | "cache" | "none" | "pending"; injected: number } = {
    source: "none",
    injected: 0,
  };

  // — 「看得懂」批次：详情浮层与引导链的界面状态（都不进引擎，也不影响任何结算） —

  /** 当前展开的那一处；再点同一处即收起 */
  private detail: DetailSel | null = null;
  /**
   * [2026-08-13] 横带上玩家点开的那条道；`null` ＝ 跟着引擎判的「最接近的那条」。
   *
   * 纯界面状态：不进引擎、不消耗回合、不影响任何结算（切 tab 是查看态，不是操作）。
   * 每世重置 —— 上一世奔妖王不代表这一世也该默认看妖王。
   */
  private wayTab: WayId | null = null;
  /** 引导链走到第几步（每一世重来；走完即永久收起并持久化） */
  private guideIndex = 0;
  private guideDismissed: boolean;
  private guideCompleteShown = false;
  private guideHideTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * 「曾在事件卡上看到一条自己够得着的器官门槛」——引导链第三步的判据。
   *
   * 引擎不记这件事（`TaleState` 里没有「玩家见过什么」），而它恰恰是「进化有啥好处」
   * 被玩家亲眼看到的那一刻，所以由界面累积，同 3D 版 `ObjectiveSnapshot` 的分工。
   */
  private sawOrganGate = false;
  /** 曾点开过「登神之路」详情——引导链第四步的判据 */
  private openedAscend = false;
  /**
   * **真的蛰伏成功过一次**——引导链第二步的判据。
   *
   * 只认 `TurnResult.moltResult` 非空：器官也能由事件的 `addOrganId` 送到手上，
   * 而那条路径不该让「蛰伏是你变强的唯一途径」这一步自动打勾（引擎给两种来源写的是
   * 同一种 `molt` 记录，所以数记录也分不出来）。
   */
  private dormantMolted = false;

  constructor(root: HTMLElement, options: AppOptions = {}) {
    this.root = root;
    this.storage = options.storage === undefined ? browserStorage() : options.storage;
    this.baseSeed = options.seed ?? (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    this.grantOrganIds = options.grantOrganIds ?? [];
    this.grantLoreEnemyIds = options.grantLoreEnemyIds ?? [];
    // 缺省关：没显式给配置的调用方（测试、任何非 dev 入口）不该在死亡路径上发网络请求
    this.aiConfig = options.ai ?? historianConfig("", false);
    this.scenarioConfig = options.scenario ?? scenarioConfig("", false);
    this.bloodline = loadBloodline(this.storage, CONTENT);
    this.lifeIndex = this.bloodline.chronicle.length;
    this.guideDismissed = loadGuideDismissed(this.storage);

    installMotionClass();
    this.screenHost = el("div", { class: "app__screen" });
    const fxHost = el("div", { class: "app__fx", attrs: { "aria-hidden": "true" } });
    this.overlayHost = el("div", { class: "app__overlays" });
    root.append(el("div", { class: "app__bg", attrs: { "aria-hidden": "true" } }), this.screenHost, fxHost, this.overlayHost);
    this.floaterHost = createFloaterHost(root);
    this.particles = createParticleLayer(fxHost, { ambientRate: 1.9, rise: 22 });

    globalThis.addEventListener("keydown", (event) => this.onKey(event));
    globalThis.addEventListener("resize", () => this.syncAmbient());
  }

  // ===== 屏幕切换 =====

  start(): void {
    this.goTitle();
  }

  private swap(node: HTMLElement): void {
    this.titleHandle?.dispose();
    this.titleHandle = null;
    this.screenHost.replaceChildren(node);
  }

  goTitle(): void {
    this.screen = "title";
    this.particles.setAmbient([]);
    // 先拆旧句柄：题字屏自带一层 hold 模式的演出（内含 ResizeObserver ＋偏好监听），
    // 直接 replaceChildren 会把 DOM 换掉但留下那些订阅。
    this.titleHandle?.dispose();
    this.titleHandle = null;
    const handle = renderTitle({
      lives: this.bloodline.chronicle.length,
      bloodlinePoints: this.bloodline.points,
      usingFixtureContent: USING_FIXTURE_CONTENT,
      onStart: () => this.goSeedSelect(),
    });
    this.screenHost.replaceChildren(handle.el);
    this.titleHandle = handle;
  }

  goSeedSelect(): void {
    this.screen = "seed";
    this.particles.setAmbient([]);
    this.renderSeed();
  }

  private renderSeed(): void {
    this.swap(
      renderSeedSelect({
        vm: buildSeedScreenVm(this.bloodline, CONTENT, this.nextSeedNum(), this.lastLife),
        // createLife 在神种 id 不存在时抛错（内容 bug）——同样不让它变成静默死局
        onChoose: (seedId) => void this.safely(async () => this.startLife(seedId)),
        onUnlock: (seedId) => this.tryUnlock(seedId),
        onBuyBoon: (organId) => this.tryBuyBoon(organId),
        // [S3] 另外三类消费走同一条「买不成就什么都不做」的路（判据只有一份，在 persist 层）
        onBuyChart: (destinationId) => this.trySpend(buyChart(this.bloodline, destinationId, CONTENT)),
        onBuySigil: (sigilId) => this.trySpend(buySigil(this.bloodline, sigilId, CONTENT)),
        onBuyLore: (enemyId) => this.trySpend(buyLore(this.bloodline, enemyId, CONTENT)),
        onBack: () => this.goTitle(),
      }),
    );
  }

  private tryUnlock(seedId: string): void {
    const next = unlockSeed(this.bloodline, seedId, CONTENT);
    if (!next) return;
    this.bloodline = next;
    saveBloodline(this.storage, this.bloodline);
    this.renderSeed();
  }

  /**
   * [S1] 买「血脉」——血统点的第二个去处。
   *
   * 买不成（点数不足／没见过这件器官）时 `buyBoon` 返回 null，这里就什么都不做：
   * 界面上那颗按钮本来也是置灰的（同 `tryUnlock` 的约定 —— 判据只有一份，在 persist 层）。
   */
  private tryBuyBoon(organId: string): void {
    this.trySpend(buyBoon(this.bloodline, organId, CONTENT));
  }

  /**
   * [S3] 一次血统消费的落账 —— 四类共用。
   *
   * `null` ＝ 买不成（点数不够／已买过／没见过），这时**什么都不做**：界面上那颗按钮
   * 本来也是置灰的（判据只有一份，在 persist 层）。抽成一处是因为四类的落账动作
   * 逐字相同，而漏掉 `saveBloodline` 的后果是「花了点数、刷新就没了」。
   */
  private trySpend(next: Bloodline | null): void {
    if (!next) return;
    this.bloodline = next;
    saveBloodline(this.storage, this.bloodline);
    this.renderSeed();
  }

  // ===== 一世 =====

  /**
   * 下一世要用的种子数。
   *
   * 抽成方法是因为**择神种屏要提前用它**：`rollPremise(seedNum)` 能在 `createLife` 之前
   * 算出这一世的天时与出身（那两次抽取恒在最前，见引擎 `createLife`）。两处必须是同一条
   * 算式，否则预告的世道与真正降生的世道会不是一个 —— 那种谎最难发现。
   */
  private nextSeedNum(): number {
    return (this.baseSeed + this.lifeIndex * 0x9e3779b1) >>> 0;
  }

  startLife(seedId: string): void {
    // 同一 baseSeed 下每一世换个数：既可复现，又不会世世雷同。
    const seedNum = this.nextSeedNum();
    this.lifeIndex += 1;
    /*
     * [P2] 上一世的剧本到此为止。**必须在 `createLife` 之前清掉** —— 那一份是上一世的
     * 天时／出身生出来的，留着就等于「每一局几乎都一样」，只是这次重复的是 AI 写的那一半。
     */
    clearInjectedEvents();
    /*
     * [S1] 血脉：花过血统点的那一件器官在**降世那一刻**就在身上。
     *
     * 用掉即清（`consumeBoon`）—— 钱在转世屏按下按钮时就付了，若不清，一次付费会变成
     * 世世自带。清完立刻存档：玩家可能在这一世中途关掉浏览器，那时钱已经付了、器官也
     * 已经拿到过，不该在下一次开局时又白拿一件。
     */
    const boonOrganId = this.bloodline.boonOrganId;
    /*
     * [S3] 图录同血脉：一次性，用掉即清。印记与图鉴知识是**永久**的，所以只读不清
     * —— 那两样的钱买的是「世世都在」，清掉等于每一世重收一次费。
     */
    const chartedDestinationId = this.bloodline.chartedDestinationId;
    const born = createLife(seedNum, seedId, CONTENT, {
      boonOrganIds: boonOrganId === null ? [] : [boonOrganId],
      sigilIds: this.bloodline.sigilIds,
      // dev 对照用的额外知识与真买来的合并去重（`createLife` 自己去重）
      loreEnemyIds: [...this.bloodline.loreEnemyIds, ...this.grantLoreEnemyIds],
      chartedDestinationId,
    });
    if (boonOrganId !== null || chartedDestinationId !== null) {
      this.bloodline = consumeChart(consumeBoon(this.bloodline));
      saveBloodline(this.storage, this.bloodline);
    }
    // dev 对照用的额外器官（只借 tag，不叠 statMods）；生产路径下 grantOrganIds 恒为空
    const state =
      this.grantOrganIds.length > 0
        ? { ...born, organIds: [...born.organIds, ...this.grantOrganIds] }
        : born;
    this.state = state;
    this.pendingEvent = null;
    // 上一世的作传任务到这里必然已经取过货；置空是为了让 `commit` 认得出「新的一世」
    this.chronicleTask = null;
    this.log = emptyLog();
    // 引导链按「世」重来：上一世没走完（多半是早死）说明这条链还没讲通。走完过的那份
    // 已经持久化在 guideDismissed 里，不会回来。
    this.guideIndex = 0;
    this.guideCompleteShown = false;
    this.sawOrganGate = false;
    this.openedAscend = false;
    this.dormantMolted = false;
    this.detail = null;
    this.wayTab = null;
    if (this.guideHideTimer !== null) {
      clearTimeout(this.guideHideTimer);
      this.guideHideTimer = null;
    }
    /*
     * [P2 一世一剧本] 降世那一刻起跑，**不 await**。
     *
     * 玩家这边照常进降世屏、照常按第一个行动 —— 头几个回合抽的是手写池。生成分四批并行，
     * 每批落定就热注入（幼年那一批排在最前，见 `generateScenario` 的排序），
     * 于是「先用手写池开局，生成好了再热注入」这件事对玩家是无感的。
     *
     * 起跑之前先试缓存：同一个种子 ＋ 同一枚神种＝同一局，读到就同步注入、一个请求都不发
     * （架构红线 1：同一局重放必须完全一致）。
     */
    this.startScenario(state, seedNum, seedId);
    const birth = state.records.find((record) => record.kind === "birth");
    this.appendLog(state.year, state.season, [{ text: birth?.text ?? "", tone: "omen" }]);
    /*
     * [2026-08-13] 降世屏要交代**这一局的前提**：天时、出身，以及四条道各自要什么。
     *
     * 这一屏是「每局不同」唯一能一次说清的地方 —— 玩家在按下第一个行动之前就该知道
     * 「今年大旱、我是孤生、有四条路可走」。两条前提各带机制那一行（不是风味字），
     * 四道各带门槛数（都从引擎的 `waysProgress` 现算，界面不写第二份门槛）。
     */
    const { sky, origin } = premiseOf(state, CONTENT);
    this.center = {
      kind: "narration",
      key: `birth:${seedId}:${seedNum}`,
      title: "降　世",
      /*
       * 正文三行（出生记录、引导语、四道指路）。**四道清单不进这张卡**，只留一行指路 —— 实机量过：卡片内容想要 652px
       * 而 body 只有 476px，溢出的正好是四道那一段（屏幕上看得见被裁掉半行）。
       * 而四道本来就有两处更好的落点：顶上那条横带常驻显示四条的进度、点 tab 即换、
       * 点开还有每条门槛「怎么长、怎么收束」的完整详情。这一屏只负责让人知道**它们存在**。
       */
      lines: [
        birth?.text ?? "",
        BIRTH_LEDE,
        "四道并列：登神／妖王／归山／化灵，走通任一条即成道 —— 顶上那条横带可逐条查看。",
      ],
      // 降世这一屏用幼兽立绘（3:4 竖构图）：「托身青丘幼兽」说的就是画上这只，
      // 也是一世里第一次让玩家看见「我是什么」。
      media: { kind: "image", src: portraitArt("cub"), aspect: "3 / 4" },
      omens: [
        { kind: "天时", name: sky.name, effect: sky.effect, desc: sky.desc },
        { kind: "出身", name: origin.name, effect: origin.effect, desc: origin.desc },
      ],
      continueLabel: null,
    };
    this.screen = "play";
    this.renderPlayScreen();
  }

  /**
   * [P2] 起一次剧本生成，并把落定的每一批热注入事件池。
   *
   * **永不 await、永不抛错**：这个方法返回时玩家已经可以开打了。
   *
   * 陈旧世的守卫（`this.lifeIndex === token`）非有不可：一世可能在几十秒内就结束
   * （饿殍最短四五岁），而生成要一两分钟。没有这一位，上一世的剧本会在下一世开局之后
   * 才落地并注入 —— 那正是「同一局重放必须一致」要挡的东西，只是方向反了。
   *
   * 同一个判据要**同时递给 `isStale`**：注入停了而落盘没停，等于把玩家没见过的那几批
   * 补进上一局的存档（重放读到的就不是当时玩的那一份），还会把更新的一局挤出缓存。
   */
  private startScenario(state: TaleState, seedNum: number, seedId: string): void {
    const token = this.lifeIndex;
    this.scenarioInfo = { source: this.scenarioConfig.enabled ? "pending" : "none", injected: 0 };
    void requestScenario({
      state,
      content: CONTENT,
      config: this.scenarioConfig,
      cacheKey: scenarioCacheKey(seedNum, seedId),
      storage: this.storage,
      isStale: () => this.lifeIndex !== token,
      onEvents: (events) => {
        if (this.lifeIndex !== token) return;
        setInjectedEvents(events);
        this.scenarioInfo = { ...this.scenarioInfo, injected: injectedEvents().length };
      },
    }).then((outcome) => {
      if (this.lifeIndex !== token) return;
      this.scenarioInfo = { source: outcome.source, injected: injectedEvents().length };
      if (outcome.telemetry) postTelemetry("scenario", outcome.telemetry);
    });
  }

  /**
   * 引导链第三步的判据：这张事件卡上有没有一条**因为器官才点得开**的抉择。
   *
   * 只认 `met` 的那种（灰着的门槛是欲望展示，不是兑现）—— 第三步要教的是
   * 「你蜕的那枚器官刚刚替你开了一条路」，看到一条灰的反而说明还没到。
   */
  private noteOrganGate(card: EventCardVm): void {
    if (this.sawOrganGate) return;
    this.sawOrganGate = card.choices.some(
      (choice) =>
        choice.enabled &&
        choice.requirements.some((requirement) => requirement.kind === "organ" && requirement.met),
    );
  }

  private appendLog(year: number, season: TaleState["season"], inputs: readonly LogInput[]): void {
    const before = this.log.nextId;
    this.log = pushLog(this.log, year, season, inputs);
    const fresh = new Set<number>();
    for (let id = before; id < this.log.nextId; id += 1) fresh.add(id);
    this.freshLogIds = fresh;
  }

  private closeLabel(): string {
    return this.state?.ending === "ascend" ? CLOSE_LABELS.ascend : CLOSE_LABELS.other;
  }

  /**
   * 落定引擎返回的新状态 —— 顺带**在死亡那一刻就把 AI 史官叫起来**。
   *
   * 为什么起点是这里而不是 `endLife`：死后玩家还要读完最后那句旁白、再按一次「瞑目」，
   * 之后才是墨渍（1.2s）与结局演出（4.4s）。把调用提到状态落定的那一刻，
   * 等于把整段阅读时间也算进预算 —— 实机上玩家不可能等到史官（预算 6s，演出已 5.6s）。
   *
   * 四条死亡入口（行动／抉择／追猎／搏杀）都经由这一个方法落状态，所以这件事只写一次。
   */
  private commit(next: TaleState): void {
    this.state = next;
    if (!next.alive && next.ending !== null && this.chronicleTask === null) {
      this.chronicleTask = requestChronicle(next, CONTENT, this.aiConfig, this.lifeKey());
    }
  }

  /** 遥测归拢用：同一世的多次尝试落同一个 key（不进 prompt，只进日志）。 */
  private lifeKey(): string {
    return `${this.baseSeed}:${this.lifeIndex}`;
  }

  /**
   * 死亡那句旁白 —— 引擎只把它写进 `records`，**不进 `notices` 也不进 `roundLog`**。
   *
   * 不捞出来的后果是实测出来的：寿终那一回合，玩家看到的最后一张卡是「蜷于石隙间敛息养神。」
   * 加一颗「瞑目」按钮 —— 一句与死无关的旁白配一个不知为何要按的按钮，人根本不知道自己
   * 刚刚死了（引擎的「寿数已尽，卧于旧穴不复起。」只在后面的演出里出现）。三条死亡入口
   * （行动／抉择／战斗）统一在这里补上。
   */
  private deathLines(state: TaleState): string[] {
    if (state.alive) return [];
    const death = state.records.findLast((record) => record.kind === "death");
    return death ? [death.text] : [];
  }

  /**
   * 一次行动。
   *
   * [S2] `options` 只对探索有意义（去哪一处），而**探索必须给** ——
   * 引擎对「没给去处的 explore」直接抛错，界面这一层不做兜底：兜底会让一个漏传去处的
   * 调用点静默退回 S2 之前的行为（`safely` 会把抛错变成一行提示，那是我们要的信号）。
   */
  async doAction(action: ActionId, options?: ActionOptions): Promise<void> {
    const prev = this.state;
    if (!prev || this.busy || this.pendingEvent || clashOf(prev) || !prev.alive) return;
    this.busy = true;

    const result = performAction(prev, action, CONTENT, options);
    const next = result.state;
    this.commit(next);
    this.pendingEvent = result.pendingEvent;
    // 蛰伏开奖成功过一次（引导链第二步的判据；事件送的器官不算，见字段注释）
    if (result.moltResult) this.dormantMolted = true;
    const dying = this.deathLines(next);
    this.appendLog(prev.year, prev.season, [
      ...result.notices.map((text) => ({ text, tone: noticeTone(text, result.moltResult !== null) })),
      ...dying.map((text) => ({ text, tone: "omen" as LogTone })),
    ]);

    const encounterCenter = result.pendingEvent ? null : this.encounterCenter(next);
    if (result.pendingEvent) {
      const card = buildEventCardVm(next, result.pendingEvent, CONTENT);
      this.noteOrganGate(card);
      this.center = {
        kind: "event",
        key: `event:${result.pendingEvent.id}:${next.rngState}`,
        card,
      };
    } else if (encounterCenter !== null) {
      // 起追：这一季**尚未收束**（引擎把季推进推迟到接近阶段的终局），所以这里不放 continue
      // 按钮，也不能再走 doAction —— 屏幕切到遭遇全屏，下一步只能是 doStalk／doCombat。
      this.center = encounterCenter;
    } else {
      this.center = {
        kind: "narration",
        key: `act:${action}:${next.rngState}`,
        title: null,
        lines: [...result.notices, ...dying],
        media: null,
        continueLabel: next.alive ? null : this.closeLabel(),
      };
    }

    this.renderPlayScreen();
    // 起追那一步季还没推进，没有季耗可忽略（追猎的季耗记在收束那一步的 doStalk 里）
    this.showDelta(prev, next, approachOf(next) ? 0 : seasonHungerCost(prev));

    if (result.moltResult) await playMoltReveal(this.overlayHost, result.moltResult, CONTENT);
    // 异变排在蜕变开奖**之后**：先看清蜕出了什么，再看它与身上旧器官凑出了什么
    await this.revealSynergies(result.newSynergies);
    // [S2] 到过的地方每一步都记（不是死亡时才结算）—— 一世打到一半刷新，去过的不该白去
    this.noteVisited(next);
    await this.revealTreasures(result.newTreasures);

    this.busy = false;
    this.renderPlayScreen();
    // 死亡不在这里自动接演出：最后那句旁白（「饥馑连季，形销骨立而终。」）得先让人读完，
    // 由「瞑目」按钮接 onContinue → endLife。三条死亡入口（行动／抉择／战斗）就此统一。
  }

  async doChoice(idx: number): Promise<void> {
    const prev = this.state;
    const event = this.pendingEvent;
    if (!prev || !event || this.busy || !prev.alive) return;
    this.busy = true;

    const result = resolveChoice(prev, event, idx, CONTENT);
    const next = result.state;
    this.commit(next);
    this.pendingEvent = null;
    const dying = this.deathLines(next);
    this.appendLog(prev.year, prev.season, [
      { text: result.outcomeText, tone: outcomeTone(result) },
      ...dying.map((text) => ({ text, tone: "omen" as LogTone })),
    ]);

    this.center = {
      kind: "narration",
      key: `outcome:${event.id}:${idx}`,
      title: event.title,
      lines: [result.outcomeText, ...dying],
      media: event.illustration ? { kind: "image", src: eventArt(event.illustration) } : null,
      continueLabel: !next.alive ? this.closeLabel() : clashOf(next) ? "迎　敌" : null,
    };

    this.renderPlayScreen();
    this.showDelta(prev, next, 0);
    // 事件送的器官（「垂死应龙」那一类）也可能凑齐一条组合 —— 两条获得器官的路径都要接住
    await this.revealSynergies(result.newSynergies);
    // [S2] 秘藏只从抉择这条路来（挂在某个结果分支的 `findTreasureId` 上）
    this.noteVisited(next);
    await this.revealTreasures(result.newTreasures);

    this.busy = false;
    this.renderPlayScreen();
  }

  /**
   * [S1] 播「异变」揭示，并把新发现记进图鉴（跨世持久化）。
   *
   * 引擎报的是「这一步新凑齐的组合」（它不认识 `Bloodline`），**是否是头一次**由图鉴判：
   * 头一次给完整演出并记档，第二世重新凑齐同一条只给降一档的「异变再现」。
   * 一步里凑齐两条（罕见但可能：一件器官同时补上两个配方的最后一件）就逐条播。
   */
  private async revealSynergies(synergies: readonly SynergyDef[]): Promise<void> {
    if (synergies.length === 0) return;
    for (const synergy of synergies) {
      const first = !this.bloodline.knownSynergyIds.includes(synergy.id);
      const next = noteSynergies(this.bloodline, [synergy.id]);
      if (next !== this.bloodline) {
        this.bloodline = next;
        saveBloodline(this.storage, this.bloodline);
      }
      await playSynergyReveal(this.overlayHost, synergy, CONTENT, first);
    }
  }

  /**
   * [S2] 把「这一世到过哪儿」抄进跨世图鉴（幂等，没有新地方就不写盘）。
   *
   * 每一步之后都调，而不是死亡结算时一次收：一世打到一半刷新页面，去过的地方不该白去。
   * `noteExploration` 没有新东西时返回同一个引用，所以写盘不会每回合都发生。
   *
   * **只记去处与异兽，不记秘藏** —— 秘藏由 `revealTreasures` 逐件记，因为它要在写档**之前**
   * 读一次「这是不是头一回」（同 `revealSynergies` 的形状）。两处分开是为了让那个顺序
   * 由结构保证，而不是靠调用者记得先播后记。
   *
   * [S3] 异兽（`metEnemyIds`）没有揭示演出，所以跟着去处一起记。四条入口（行动／抉择／
   * 追猎／搏杀）都调它：今天新的照面只可能发生在前两条里（起追与开战都在
   * `performAction`／`resolveChoice` 之内），但把后两条也接上，「图鉴不漏」就成了结构性质
   * 而不是一条要靠人记住的不变量。
   */
  private noteVisited(state: TaleState): void {
    const next = noteExploration(this.bloodline, state.visitedDestinationIds, [], state.metEnemyIds);
    if (next === this.bloodline) return;
    this.bloodline = next;
    saveBloodline(this.storage, this.bloodline);
  }

  /**
   * [S2] 播「秘藏」揭示，并把它记进图鉴（跨世持久化）。
   *
   * 与 `revealSynergies` 逐字同形：引擎报的是「这一步新得到的秘藏」（它不认识 `Bloodline`），
   * **是否是头一次**由图鉴判 —— 而判据必须在写档**之前**取，所以记与播都在这一个循环里。
   */
  private async revealTreasures(treasures: readonly TreasureDef[]): Promise<void> {
    if (treasures.length === 0) return;
    for (const treasure of treasures) {
      const first = !this.bloodline.foundTreasureIds.includes(treasure.id);
      const next = noteExploration(this.bloodline, [], [treasure.id]);
      if (next !== this.bloodline) {
        this.bloodline = next;
        saveBloodline(this.storage, this.bloodline);
      }
      const place = CONTENT.destinations.find((item) => item.treasure.id === treasure.id);
      if (!place) continue;
      await playTreasureReveal(this.overlayHost, treasure, place, first);
    }
  }

  /**
   * 追猎的一步。
   *
   * 与 `doCombat` 的形状一样（读 roundLog、按 `over` 决定下一屏），但多一件事：**这一步
   * 可能是整个季的收束**（引擎把季推进与死亡判定压在追猎的终局那一步）。所以只有 `over`
   * 非 null 时才把季耗算进「该忽略的饱食下降」，否则那 −12 会在追猎中途飘出来一次
   * —— 玩家会以为潜行本身在消耗饱食。
   */

  /**
   * [M2-B1] 造遭遇屏的 center —— **两个阶段唯一的入口**。
   *
   * 公共外壳与阶段中段在同一处组装，于是「接近转交锋」在界面上只是 `body` 换了一支，
   * 头、势条、伤牌、四相盘、日志都原样留在屏幕上。M1 那两处各自造 center 的写法
   * 会让这两块屏各自漂移（P2 报告的遗留 5 是同一类毛病）。
   */
  private encounterCenter(state: TaleState): CenterVm | null {
    const approach = approachOf(state);
    const clash = clashOf(state);
    if (!state.encounter || (!approach && !clash)) return null;
    const chrome = buildEncounterChromeVm(state, CONTENT);
    return approach
      ? {
          kind: "encounter",
          key: `enc:${state.encounter.enemyId}:approach:${state.rngState}`,
          chrome,
          body: { kind: "approach", stalk: buildStalkVm(state, approach, CONTENT) },
        }
      : {
          kind: "encounter",
          key: `enc:${state.encounter.enemyId}:clash`,
          chrome,
          body: { kind: "clash", combat: buildCombatVm(state, clash!, CONTENT) },
        };
  }

  async doStalk(act: StalkActId): Promise<void> {
    const prev = this.state;
    if (!prev || !approachOf(prev) || this.busy || !prev.alive) return;
    this.busy = true;

    const turn = stalkAct(prev, act, CONTENT);
    const next = turn.state;
    this.commit(next);
    const dying = this.deathLines(next);
    this.appendLog(prev.year, prev.season, [
      ...turn.roundLog.map((text) => ({ text, tone: stalkTone(act, turn.over) })),
      ...dying.map((text) => ({ text, tone: "omen" as LogTone })),
    ]);

    /*
     * [M2-B1] `over === "combat"` 不再是「另起一场」：同一个遭遇的 `phase` 换成了 clash，
     * 所以这里**照样是遭遇屏**（换的只有中段）—— 玩家不必按一次「迎敌」才看到对手，
     * 而刚刚那四息的日志、势与部位伤都还在原地。
     */
    const encounterCenter = this.encounterCenter(next);
    if (encounterCenter !== null) {
      this.center = encounterCenter;
    } else {
      const title = STALK_END_TITLES[turn.over ?? "escaped"];
      this.center = {
        kind: "narration",
        key: `stalk-end:${turn.over}:${next.rngState}`,
        title,
        lines: [...turn.roundLog, ...dying],
        media: null,
        continueLabel: !next.alive ? this.closeLabel() : null,
      };
    }

    this.noteVisited(next);
    this.busy = false;
    this.renderPlayScreen();
    this.showDelta(prev, next, turn.over === null ? 0 : seasonHungerCost(prev));
  }

  async doCombat(act: CombatAct): Promise<void> {
    const prev = this.state;
    if (!prev || !clashOf(prev) || this.busy || !prev.alive) return;
    this.busy = true;

    const turn = combatAct(prev, act, CONTENT);
    const next = turn.state;
    this.commit(next);
    const dying = this.deathLines(next);
    this.appendLog(prev.year, prev.season, [
      ...turn.roundLog.map((text) => ({ text, tone: "combat" as LogTone })),
      ...dying.map((text) => ({ text, tone: "omen" as LogTone })),
    ]);

    const encounterCenter = turn.over === null ? this.encounterCenter(next) : null;
    if (encounterCenter !== null) {
      this.center = encounterCenter;
    } else {
      const title = COMBAT_END_TITLES[turn.over ?? "dead"];
      this.center = {
        kind: "narration",
        key: `combat-end:${turn.over}:${next.rngState}`,
        title,
        lines: [...turn.roundLog, ...dying],
        media: null,
        continueLabel: next.alive ? null : this.closeLabel(),
      };
    }

    this.noteVisited(next);
    this.busy = false;
    this.renderPlayScreen();
    this.showDelta(prev, next, 0);
  }

  async onContinue(): Promise<void> {
    const state = this.state;
    if (!state || this.busy) return;
    if (!state.alive) {
      await this.endLife();
      return;
    }
    const encounter = this.encounterCenter(state);
    if (encounter) {
      this.center = encounter;
      this.renderPlayScreen();
    }
  }

  /** 一世收束：墨渍 → 死亡（或登神）演出 → 结算血统 → 列传卷轴。 */
  private async endLife(): Promise<void> {
    const state = this.state;
    if (!state || state.alive || state.ending === null) return;
    this.busy = true;
    this.renderPlayScreen();

    const ascending = state.ending === "ascend";
    const blot = ascending ? null : await playInkBlot(this.overlayHost);

    const death = buildDeathVm(state, CONTENT);
    await playCinematic(
      {
        /*
         * B4 的四张结局图（16:9），文件名恒等于 EndingType。
         *
         * [2026-08-13] 四条道共用「登神」那一张会出错：归山是「卧于旧穴而化」，
         * 配一幅白光贯顶的图是在讲另一件事。归山改借**寿终**那一张（山野送终），
         * 其余三条道仍用登神那张。补画四条道各自的结局图是遗留项（美术管线要单独跑）。
         */
        media: { kind: "image", src: endingArt(state.wayAchieved === "guishan" ? "oldage" : state.ending) },
        durationMs: 4400,
        /*
         * 第一行是结局二字（当标题排），第二行是引擎写的那句死亡旁白，第三行是收束统计，
         * **第四行是 M1-P2 的差距报告**（「离登神：差二件器官、灵性差三六。」）——
         * 这一屏原来读完只会想「哦，死了」，差距那一行才把它变成一件没做完的事。
         * 刻意**不放** epitaph：它和引擎的死亡旁白几乎同义，并排两行会读成重复。
         */
        lines: [death.endingLabel, death.lastWords, death.summary, death.gap],
        tintRgb: ascending ? "244,240,228" : "194,59,34",
        motion: ascending ? "rise" : "out",
        label: `${death.endingLabel}：${death.epitaph}`,
        className: ascending ? "cine--ascend" : "cine--death",
      },
      this.overlayHost,
    );

    /*
     * [P1 AI 史官] 取货。任务在**死亡那一刻**就起跑了（见 `commit`），到这里已经跑了
     * 玩家读旁白的时间 ＋ 墨渍 1.2s ＋ 结局演出 4.4s，所以这个 await 实测恒为 0 等待；
     * 万一没跑完，`writeChronicle` 自带 6s 总预算会自己收摊回落模板版 —— 两头都不会干等。
     *
     * 拿不到 AI 版（关掉、无 key、超时、校验打回）就走模板版：这条回落路径与 M0 的行为
     * 逐字相同，卷轴那边分不出这一篇是谁写的（结构与 `praisePrefix` 都由代码定）。
     */
    const drafted = await (this.chronicleTask ?? Promise.resolve(null));
    this.lastHistorian = drafted;
    if (drafted) reportTelemetry(drafted.telemetry);
    const entry: ChronicleEntry = drafted?.entry ?? composeChronicle(state, CONTENT);
    const gain = bloodlineGain(state, CONTENT);
    // [S1] 这一世拥有过的器官进图鉴 —— 「血脉」只卖已发现过的（神种器官由 persist 层挡掉）
    this.bloodline = recordLife(this.bloodline, gain, entry, state.organIds, CONTENT);
    saveBloodline(this.storage, this.bloodline);
    this.chronicleVm = buildChronicleVm(entry, gain, CONTENT, state);
    // 择神种屏那句「换条路试试」要读上一世的终态（差距报告算不出于 ChronicleEntry）
    this.lastLife = state;

    this.screen = "chronicle";
    this.particles.setAmbient([]);
    this.busy = false;
    this.swap(
      renderChronicle({
        vm: this.chronicleVm,
        onReincarnate: () => {
          this.state = null;
          this.pendingEvent = null;
          this.goSeedSelect();
        },
      }),
    );
    blot?.remove();
  }

  // ===== 详情浮层与引导链（纯界面状态，不进引擎） =====

  /**
   * 开／关详情浮层。`null` ＝ 收起（界面点同一处第二次时传的就是 null）。
   *
   * 点开「登神之路」顺带记一笔：那是引导链第四步的判据 —— 第四步要教的正是
   * 「这一世的目标写在顶上那条带里」，而它此前只是一条没人点的进度条。
   */
  private setDetail(sel: DetailSel | null): void {
    this.detail = sel;
    if (sel?.kind === "way") this.openedAscend = true;
    this.renderPlayScreen();
  }

  /**
   * 切换横带展开哪一条道（`null` ＝ 回到「跟着最接近的那条」）。
   *
   * 顺带把详情浮层里那一条也切过去（若正开着某条道的详情）—— 否则玩家点了「化灵」的 tab，
   * 浮层还写着「登神」，读起来是界面在自相矛盾。
   */
  private setWayTab(way: WayId | null): void {
    this.wayTab = way;
    if (this.detail?.kind === "way" && way !== null) this.detail = { kind: "way", way };
    if (way !== null) this.openedAscend = true;
    this.renderPlayScreen();
  }

  private dismissGuide(): void {
    this.guideDismissed = true;
    saveGuideDismissed(this.storage);
    if (this.guideHideTimer !== null) {
      clearTimeout(this.guideHideTimer);
      this.guideHideTimer = null;
    }
    this.hideGuideNode();
  }

  /**
   * 把引导那一行**就地摘掉**，而不是整屏重建。
   *
   * 理由是 `renderPlay` 的既定行为：它每回合整棵重建，而**中央卡带入场动画**（水墨浮现）。
   * 一行提示的消失若走整屏重建，玩家正在读的那张事件卡会莫名重放一次入场 —— 走完引导链
   * 的那一刻恰好可能落在读卡中途（实机撞到过：9 秒的收尾停留正好跨在一张事件卡上）。
   * 顺手摘掉 `play--guided`，否则网格里会剩一条空行的 gap。
   */
  private hideGuideNode(): void {
    this.screenHost.querySelector(".guide")?.remove();
    this.screenHost.querySelector(".play--guided")?.classList.remove("play--guided");
  }

  // ===== 渲染 =====

  /**
   * 引导链的当前一步（顺带推进它）。
   *
   * 推进放在渲染前而不是每个动作里：判据全是**状态**（精气总量、器官数）而不是事件，
   * 于是「一季里同时满足两步」不会卡在中间那一格 —— 同 3D 版 `advanceObjective` 的
   * while 循环，那条是踩出来的。
   */
  private guideVm(state: TaleState): GuideVm | null {
    if (this.guideDismissed) return null;
    this.guideIndex = advanceGuide(
      this.guideIndex,
      guideSnapshot(state, CONTENT, {
        dormantMolted: this.dormantMolted,
        sawOrganGateChoice: this.sawOrganGate,
        openedAscend: this.openedAscend,
      }),
    );
    const vm = buildGuideVm(state, CONTENT, this.guideIndex);
    if (vm.complete && !this.guideCompleteShown) {
      this.guideCompleteShown = true;
      // 即刻持久化：玩家可能在这句话读完前就刷新，重开不该再从第一步教一遍
      saveGuideDismissed(this.storage);
      this.guideHideTimer = setTimeout(() => {
        this.guideHideTimer = null;
        this.guideDismissed = true;
        if (this.screen === "play") this.hideGuideNode();
      }, GUIDE_COMPLETE_HOLD_MS);
    }
    return vm;
  }

  private renderPlayScreen(): void {
    const state = this.state;
    if (!state) return;
    const status = buildStatusVm(state, CONTENT, this.wayTab);
    // 进两个战术全屏时主动收掉详情：那两屏的按钮在右下角，浮层压上去等于挡住操作
    if (this.center.kind === "encounter") this.detail = null;
    const detail = this.detail === null ? null : buildDetailVm(state, CONTENT, this.detail);
    this.swap(
      renderPlay({
        status,
        center: this.center,
        detail,
        guide: this.guideVm(state),
        onDetail: (sel) => this.setDetail(sel),
        onWayTab: (way) => this.setWayTab(way),
        onGuideDismiss: () => this.dismissGuide(),
        actions: buildActionVms(state, CONTENT).map((action) => {
          // 未结算的事件卡在场时，行动面板整体压住（引擎无从强制这条纪律）。
          // highlight 必须一起熄掉 —— 一个禁用却还在发金光呼吸的按钮是在骗点击。
          const blocked = this.pendingEvent !== null || this.center.kind === "event";
          return {
            ...action,
            enabled: action.enabled && !blocked,
            highlight: action.highlight && !blocked,
            disabledReason: blocked ? "先了此事" : action.disabledReason,
          };
        }),
        destinations: buildDestinationVms(state, CONTENT).map((dest) => {
          // 与行动面板同一条纪律：未结算的事件卡在场时整排压住
          const blocked = this.pendingEvent !== null || this.center.kind === "event";
          return {
            ...dest,
            enabled: dest.enabled && !blocked,
            disabledReason: blocked ? "先了此事" : dest.disabledReason,
          };
        }),
        destinationCaption: destinationCaption(buildDestinationVms(state, CONTENT)),
        log: recentLogVm(this.log),
        freshLogIds: this.freshLogIds,
        busy: this.busy,
        /*
         * [饥饿节奏批] 按钮 id → 行动 ＋ 参数的翻译**只在这一处**（同去处那一排）。
         * 「速猎」是 `hunt` 的一个参数而不是第五个行动（见 `ActionOptions.huntMode`），
         * 界面这一层只负责把那颗按钮翻成 `{ huntMode: "quick" }`。
         */
        onAction: (id) =>
          void this.safely(() =>
            this.doAction(actionOfButton(id), id === "hunt-quick" ? { huntMode: "quick" } : undefined),
          ),
        onExplore: (destinationId) =>
          void this.safely(() => this.doAction("explore", { destinationId })),
        onChoice: (idx) => void this.safely(() => this.doChoice(idx)),
        onCombat: (act) => void this.safely(() => this.doCombat(act)),
        onStalk: (act) => void this.safely(() => this.doStalk(act)),
        onContinue: () => void this.safely(() => this.onContinue()),
      }),
    );
    this.syncAmbient();
  }

  /** 把精气柱的屏幕坐标喂给粒子层（每次重建后都要重算）。 */
  private syncAmbient(): void {
    if (this.screen !== "play" || !this.state) {
      this.particles.setAmbient([]);
      return;
    }
    const sources = [];
    for (const [type, rgb] of Object.entries(ESSENCE_RGB)) {
      const node = this.screenHost.querySelector<HTMLElement>(`[data-anchor="essence:${type}"]`);
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      const value = this.state.essence[type as keyof typeof ESSENCE_RGB];
      // 这一世生效的阈值（灵气盛之年更低）—— 粒子的浓度得跟着玩家真正要攒到的那个数走
      const threshold = Math.max(1, lifeTuning(this.state, CONTENT).moltThreshold);
      const intensity = Math.min(1, value / threshold);
      if (intensity <= 0.02) continue;
      sources.push({ x: rect.left + rect.width / 2, y: rect.bottom - 6, rgb, intensity, spreadX: rect.width });
    }
    this.particles.setAmbient(sources);
  }

  /** 数值飘字 ＋ 精气脉冲。渲染之后调用（锚点必须已在 DOM 里）。 */
  private showDelta(prev: TaleState, next: TaleState, ignoreHungerDrop: number): void {
    nextFrame(() => {
      spawnFloaters(this.floaterHost, diffFloaters(prev, next, { ignoreHungerDrop }), (anchor) =>
        this.screenHost.querySelector<HTMLElement>(`[data-anchor="${cssEscape(anchor)}"]`),
      );
      for (const type of gainedEssenceTypes(prev, next)) {
        const node = this.screenHost.querySelector<HTMLElement>(`[data-anchor="essence:${type}"]`);
        if (!node) continue;
        const rect = node.getBoundingClientRect();
        this.particles.burst(rect.left + rect.width / 2, rect.bottom - 8, ESSENCE_RGB[type], 12);
      }
      this.syncAmbient();
    });
  }

  /**
   * 兜住引擎抛出的异常。
   *
   * 今天每个调用点都是可证安全的：按钮的 enabled 用的就是引擎自己抛错前判的那个函数
   * （`availableActions`／`eligibleChoiceIdxs`／`combatPreview.skills` 的 `ready`），
   * 构造上不可能分叉（[S1] 第三个原是 `combatSkillOrgan`，那个函数已随技能池删除）。
   * 但这里的失败模式极不对称 —— 一旦真抛了（内容数据 bug 在 `applyEffects` 里冒出来、
   * 或将来谁给某个 VM 换了个「等价」判断），`void this.doAction()` 会变成一个没人接的
   * rejected promise：`busy` 永远停在 true，此后**每一次点击与按键都静默失效**，界面看着
   * 完好却彻底冻住，玩家和日志里都不留任何线索。所以宁可花这几行把它变成「一条可见的
   * 报错 ＋ 恢复可操作」。
   */
  private async safely(work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      this.busy = false;
      const message = error instanceof Error ? error.message : String(error);
      // eslint 之外还得留个真的排查入口：日志栏给一句人话，控制台留完整堆栈
      console.error("[tale-client] 引擎调用失败", error);
      const state = this.state;
      if (state) {
        this.appendLog(state.year, state.season, [{ text: `此处有异：${message}`, tone: "omen" }]);
        this.renderPlayScreen();
      }
    }
  }

  // ===== 键盘 =====

  private onKey(event: KeyboardEvent): void {
    if (this.busy || this.overlayHost.childElementCount > 0) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

    if (this.screen !== "play") return;
    // 详情浮层：Esc 收起（点开它的是鼠标，收起它不该也只能用鼠标）
    if (event.key === "Escape" && this.detail !== null) {
      event.preventDefault();
      this.setDetail(null);
      return;
    }
    /*
     * [S2] 数字键的上限从 4 提到 9：行动面板现在是「三颗行动 ＋ 六处去处」，
     * 1〜3 归行动、4〜9 归去处（编号与按钮上印的 `kbd` 逐一对应，见 `destinationBar`）。
     * 战斗／追猎／事件三屏照旧只用前几个 —— 越界时 `buttons[i]` 为 undefined，自然无事发生。
     *
     * [饥饿节奏批] 行动排多了一颗「速猎」，于是**十颗按钮**：1〜4 行动、5〜9 与 **0** 归去处。
     * 「0 ＝ 第十颗」而不是「0 ＝ 无效」：最后那一处（焦原）是四条道之一的必经地，
     * 把它留成唯一一颗按不到的按钮，等于让键盘玩家在那儿必须回去摸鼠标。
     */
    const digit = event.key === "0" ? 10 : Number.parseInt(event.key, 10);
    if (Number.isInteger(digit) && digit >= 1 && digit <= 10) {
      if (this.center.kind === "encounter" || this.center.kind === "event") {
        const selector =
          this.center.kind === "event"
            ? `[data-choice]`
            : this.center.body.kind === "clash"
              ? `[data-combat]`
              : `[data-stalk]`;
        const buttons = this.screenHost.querySelectorAll<HTMLButtonElement>(selector);
        const button = buttons[digit - 1];
        if (button && !button.disabled) {
          event.preventDefault();
          button.click();
        }
        return;
      }
      const actions = this.screenHost.querySelectorAll<HTMLButtonElement>(`[data-action]`);
      const dests = this.screenHost.querySelectorAll<HTMLButtonElement>(`[data-dest]`);
      const button =
        digit <= actions.length ? actions[digit - 1] : dests[digit - 1 - actions.length];
      if (button && !button.disabled) {
        event.preventDefault();
        button.click();
      }
      return;
    }
    if (event.key === "Enter") {
      const button = this.screenHost.querySelector<HTMLButtonElement>("[data-continue]");
      if (button && !button.disabled) {
        event.preventDefault();
        button.click();
      }
    }
  }

  // ===== 调试出口（E2E 与手测用，只读） =====

  debugSnapshot(): {
    screen: ScreenId;
    center: CenterVm["kind"];
    busy: boolean;
    state: TaleState | null;
    bloodline: Bloodline;
    pendingEventId: string | null;
    /** 当前展开的详情（`detailKey` 的值），没开则 null —— E2E 据此对账「点开的是哪一处」 */
    detail: string | null;
    /** 引导链：第几步／那两句话／有没有走完。验收第三问就查它 */
    guide: { step: number; total: number; text: string; hint: string; complete: boolean } | null;
    /**
     * [P1] 这一世的列传是谁写的。E2E 靠它区分「AI 版」与「静默回落的模板版」——
     * 光看屏幕上的字分不出来（两版结构一样，那正是回落该有的样子）。
     */
    ai: {
      enabled: boolean;
      model: string;
      source: "ai" | "template" | null;
      fallbackReason: string | null;
      totalMs: number | null;
      costUsd: number | null;
    };
    /**
     * [P2] 这一世的剧本生成情况。E2E 靠它判「注进去了几条」「是新生成的还是读的缓存」——
     * 光看屏幕分不出来（那正是这一批该有的样子：生成事件与手写事件在卡片上长得一模一样）。
     *
     * `injectedIds` 让「同一种子重放两次是否逐字一致」这一问可以机械比对。
     */
    scenario: {
      enabled: boolean;
      model: string;
      source: "ai" | "cache" | "none" | "pending";
      injected: number;
      injectedIds: string[];
    };
  } {
    const state = this.state;
    return {
      screen: this.screen,
      center: this.center.kind,
      busy: this.busy,
      state,
      bloodline: this.bloodline,
      pendingEventId: this.pendingEvent?.id ?? null,
      detail: this.detail === null ? null : detailKey(this.detail),
      ai: {
        enabled: this.aiConfig.enabled,
        model: this.aiConfig.model,
        source: this.lastHistorian?.source ?? null,
        fallbackReason: this.lastHistorian?.telemetry.fallbackReason ?? null,
        totalMs: this.lastHistorian?.telemetry.totalMs ?? null,
        costUsd: this.lastHistorian?.telemetry.costUsd ?? null,
      },
      scenario: {
        enabled: this.scenarioConfig.enabled,
        model: this.scenarioConfig.model,
        source: this.scenarioInfo.source,
        injected: this.scenarioInfo.injected,
        injectedIds: injectedEvents().map((event) => event.id),
      },
      // 只读：不推进 guideIndex（推进只在渲染那一条路上发生），照实报当前那一步
      guide: state && !this.guideDismissed ? buildGuideVm(state, CONTENT, this.guideIndex) : null,
    };
  }
}

/** `data-anchor` 里只会出现 `[a-z:]`，但拼选择器时仍防一手引号注入。 */
function cssEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

/**
 * 这一季的季耗 —— **必须用这一世生效的调参**（大旱之年 −15 而不是基线的 −12）。
 *
 * 它的用途是把季耗从飘字里减掉（否则玩家会以为潜行本身在消耗饱食）；用错数会让飘字
 * 少减 3 点，屏幕上就凭空多出一个 −3。
 */
function seasonHungerCost(state: TaleState): number {
  const t = lifeTuning(state, CONTENT);
  return t.hungerPerSeason + (state.season === 3 ? t.winterHungerExtra : 0);
}

function noticeTone(text: string, molted: boolean): LogTone {
  if (molted && text.includes("蜕")) return "molt";
  if (text.includes("猎得") || text.includes("饱食")) return "gain";
  if (text.includes("当道") || text.includes("盯上")) return "combat";
  return "plain";
}

/** 搏杀收束四态的门楣题字（[M1-P2] `escaped` 是新的：它走了，你什么也没拿到）。 */
const COMBAT_END_TITLES: Record<"win" | "fled" | "dead" | "escaped", string> = {
  win: "得　胜",
  fled: "遁　去",
  dead: "力　尽",
  escaped: "失　之",
};

/** 追猎收束四态的门楣题字。 */
const STALK_END_TITLES: Record<"caught" | "escaped" | "exhausted" | "combat", string> = {
  caught: "得　手",
  escaped: "失　之",
  exhausted: "力　尽",
  combat: "反　噬",
};

/**
 * 追猎旁白的色调。
 *
 * 按**动作与结局**判，不按文本判 —— 追猎的旁白是内容侧可换的变体（每头猎物各写一套），
 * 靠关键词匹配（`noticeTone` 那种）会在内容改一个字的时候悄悄失效。
 */
function stalkTone(act: StalkActId, over: "caught" | "escaped" | "exhausted" | "combat" | null): LogTone {
  if (over === "caught") return "gain";
  if (over === "combat") return "combat";
  if (over === "escaped" || over === "exhausted") return "loss";
  return act === "pounce" ? "combat" : "plain";
}

function outcomeTone(result: { delta: { die?: unknown; startCombat?: unknown; addOrganId?: unknown } }): LogTone {
  if (result.delta.die) return "omen";
  if (result.delta.startCombat) return "combat";
  if (result.delta.addOrganId) return "molt";
  return "plain";
}
