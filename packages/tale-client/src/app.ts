/**
 * 屏幕编排与引擎调用。
 *
 * 这是全客户端**唯一**调引擎的地方，也是唯一持有可变状态的地方（`TaleState` 由引擎返回，
 * 这里只搬运不修改）。屏幕模块是纯渲染函数，model/ 是纯视图模型 —— 三层之间不回环。
 *
 * 纪律（引擎 JSDoc 明写、这里逐条落实）：
 * - 拿到非 null 的 `pendingEvent` 必须先 `resolveChoice` 再进下一回合 → `pendingEvent`
 *   非空时行动面板整体禁用。
 * - 战斗日志自己累加 → `over` 非 null 那一刻 `state.combat` 已是 null，末轮日志只能从
 *   `CombatTurn.roundLog` 拿。
 * - 演出播放期间 `busy` 为真、所有按钮禁用 → 防连点把上面两条打穿。
 */

import {
  bloodlineGain,
  combatAct,
  composeChronicle,
  createLife,
  performAction,
  resolveChoice,
  stalkAct,
  type ActionId,
  type ChronicleEntry,
  type TaleEvent,
  type TaleState,
} from "@shiling/tale-sim";

import { CONTENT, USING_FIXTURE_CONTENT } from "./content.js";
import { el, nextFrame } from "./dom.js";
import { endingArt, eventArt, portraitArt } from "./art/assets.js";
import { buildActionVms } from "./model/actionVm.js";
import { buildChronicleVm, buildDeathVm, type ChronicleVm } from "./model/chronicleVm.js";
import { buildCombatVm, type CombatActId } from "./model/combatVm.js";
import { diffFloaters, gainedEssenceTypes } from "./model/deltaVm.js";
import { buildEventCardVm } from "./model/eventVm.js";
import { emptyLog, pushLog, recentLogVm, type LogBuffer, type LogInput, type LogTone } from "./model/logVm.js";
import { buildSeedScreenVm } from "./model/seedVm.js";
import { buildStalkVm, type StalkActId } from "./model/stalkVm.js";
import { buildStatusVm } from "./model/statusVm.js";
import { createFloaterHost, spawnFloaters } from "./fx/floaters.js";
import { playCinematic } from "./fx/cinematic.js";
import { playInkBlot } from "./fx/inkBlot.js";
import { playMoltReveal } from "./fx/moltReveal.js";
import { installMotionClass } from "./fx/motion.js";
import { ESSENCE_RGB, createParticleLayer, type ParticleLayer } from "./fx/particles.js";
import { renderChronicle } from "./screens/chronicleScreen.js";
import { renderPlay, type CenterVm } from "./screens/playScreen.js";
import { renderSeedSelect } from "./screens/seedScreen.js";
import { renderTitle, type ScreenHandle } from "./screens/titleScreen.js";
import {
  browserStorage,
  loadBloodline,
  recordLife,
  saveBloodline,
  unlockSeed,
  type StorageLike,
} from "./persist/bloodline.js";
import type { Bloodline } from "@shiling/tale-sim";

export type ScreenId = "title" | "seed" | "play" | "chronicle";

/** 出生开场的界面文案（不是内容库的事件正文，是屏幕自己的引导语）。 */
const BIRTH_LEDE = "青丘多狐，草木有灵。你尚不知自己是什么，只知道饿。";

/** 死亡／登神后那颗按钮的字样。 */
const CLOSE_LABELS = { ascend: "登　临", other: "瞑　目" } as const;

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

  constructor(root: HTMLElement, options: AppOptions = {}) {
    this.root = root;
    this.storage = options.storage === undefined ? browserStorage() : options.storage;
    this.baseSeed = options.seed ?? (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    this.grantOrganIds = options.grantOrganIds ?? [];
    this.bloodline = loadBloodline(this.storage, CONTENT);
    this.lifeIndex = this.bloodline.chronicle.length;

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
        vm: buildSeedScreenVm(this.bloodline, CONTENT),
        // createLife 在神种 id 不存在时抛错（内容 bug）——同样不让它变成静默死局
        onChoose: (seedId) => void this.safely(async () => this.startLife(seedId)),
        onUnlock: (seedId) => this.tryUnlock(seedId),
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

  // ===== 一世 =====

  startLife(seedId: string): void {
    // 同一 baseSeed 下每一世换个数：既可复现，又不会世世雷同。
    const seedNum = (this.baseSeed + this.lifeIndex * 0x9e3779b1) >>> 0;
    this.lifeIndex += 1;
    const born = createLife(seedNum, seedId, CONTENT);
    // dev 对照用的额外器官（只借 tag，不叠 statMods）；生产路径下 grantOrganIds 恒为空
    const state =
      this.grantOrganIds.length > 0
        ? { ...born, organIds: [...born.organIds, ...this.grantOrganIds] }
        : born;
    this.state = state;
    this.pendingEvent = null;
    this.log = emptyLog();
    const birth = state.records.find((record) => record.kind === "birth");
    this.appendLog(state.year, state.season, [{ text: birth?.text ?? "", tone: "omen" }]);
    this.center = {
      kind: "narration",
      key: `birth:${seedId}:${seedNum}`,
      title: "降　世",
      lines: [birth?.text ?? "", BIRTH_LEDE],
      // 降世这一屏用幼兽立绘（3:4 竖构图）：「托身青丘幼兽」说的就是画上这只，
      // 也是一世里第一次让玩家看见「我是什么」。
      media: { kind: "image", src: portraitArt("cub"), aspect: "3 / 4" },
      continueLabel: null,
    };
    this.screen = "play";
    this.renderPlayScreen();
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

  async doAction(action: ActionId): Promise<void> {
    const prev = this.state;
    if (!prev || this.busy || this.pendingEvent || prev.combat || !prev.alive) return;
    this.busy = true;

    const result = performAction(prev, action, CONTENT);
    const next = result.state;
    this.state = next;
    this.pendingEvent = result.pendingEvent;
    const dying = this.deathLines(next);
    this.appendLog(prev.year, prev.season, [
      ...result.notices.map((text) => ({ text, tone: noticeTone(text, result.moltResult !== null) })),
      ...dying.map((text) => ({ text, tone: "omen" as LogTone })),
    ]);

    if (result.pendingEvent) {
      this.center = {
        kind: "event",
        key: `event:${result.pendingEvent.id}:${next.rngState}`,
        card: buildEventCardVm(next, result.pendingEvent, CONTENT),
      };
    } else if (next.stalk) {
      // 起追：这一季**尚未收束**（引擎把季推进推迟到追猎的终局），所以这里不放 continue 按钮，
      // 也不能再走 doAction —— 屏幕切到追猎全屏，下一步只能是 doStalk。
      this.center = {
        kind: "stalk",
        key: `stalk:${next.stalk.preyId}:${next.rngState}`,
        stalk: buildStalkVm(next, next.stalk, CONTENT),
      };
    } else if (next.combat) {
      this.center = { kind: "combat", key: `combat:${next.combat.enemyId}`, combat: buildCombatVm(next, next.combat, CONTENT) };
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
    this.showDelta(prev, next, next.stalk ? 0 : seasonHungerCost(prev));

    if (result.moltResult) await playMoltReveal(this.overlayHost, result.moltResult, CONTENT);

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
    this.state = next;
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
      continueLabel: !next.alive ? this.closeLabel() : next.combat ? "迎　敌" : null,
    };

    this.busy = false;
    this.renderPlayScreen();
    this.showDelta(prev, next, 0);
  }

  /**
   * 追猎的一步。
   *
   * 与 `doCombat` 的形状一样（读 roundLog、按 `over` 决定下一屏），但多一件事：**这一步
   * 可能是整个季的收束**（引擎把季推进与死亡判定压在追猎的终局那一步）。所以只有 `over`
   * 非 null 时才把季耗算进「该忽略的饱食下降」，否则那 −12 会在追猎中途飘出来一次
   * —— 玩家会以为潜行本身在消耗饱食。
   */
  async doStalk(act: StalkActId): Promise<void> {
    const prev = this.state;
    if (!prev || !prev.stalk || this.busy || !prev.alive) return;
    this.busy = true;

    const turn = stalkAct(prev, act, CONTENT);
    const next = turn.state;
    this.state = next;
    const dying = this.deathLines(next);
    this.appendLog(prev.year, prev.season, [
      ...turn.roundLog.map((text) => ({ text, tone: stalkTone(act, turn.over) })),
      ...dying.map((text) => ({ text, tone: "omen" as LogTone })),
    ]);

    if (turn.over === null && next.stalk) {
      this.center = {
        kind: "stalk",
        key: `stalk:${next.stalk.preyId}:${next.rngState}`,
        stalk: buildStalkVm(next, next.stalk, CONTENT),
      };
    } else {
      const title = STALK_END_TITLES[turn.over ?? "escaped"];
      this.center = {
        kind: "narration",
        key: `stalk-end:${turn.over}:${next.rngState}`,
        title,
        lines: [...turn.roundLog, ...dying],
        media: null,
        continueLabel: !next.alive ? this.closeLabel() : next.combat ? "迎　敌" : null,
      };
    }

    this.busy = false;
    this.renderPlayScreen();
    this.showDelta(prev, next, turn.over === null ? 0 : seasonHungerCost(prev));
  }

  async doCombat(act: CombatActId): Promise<void> {
    const prev = this.state;
    if (!prev || !prev.combat || this.busy || !prev.alive) return;
    this.busy = true;

    const turn = combatAct(prev, act, CONTENT);
    const next = turn.state;
    this.state = next;
    const dying = this.deathLines(next);
    this.appendLog(prev.year, prev.season, [
      ...turn.roundLog.map((text) => ({ text, tone: "combat" as LogTone })),
      ...dying.map((text) => ({ text, tone: "omen" as LogTone })),
    ]);

    if (turn.over === null && next.combat) {
      this.center = {
        kind: "combat",
        key: `combat:${next.combat.enemyId}`,
        combat: buildCombatVm(next, next.combat, CONTENT),
      };
    } else {
      const title = turn.over === "win" ? "得　胜" : turn.over === "fled" ? "遁　去" : "力　尽";
      this.center = {
        kind: "narration",
        key: `combat-end:${turn.over}:${next.rngState}`,
        title,
        lines: [...turn.roundLog, ...dying],
        media: null,
        continueLabel: next.alive ? null : this.closeLabel(),
      };
    }

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
    if (state.combat) {
      this.center = {
        kind: "combat",
        key: `combat:${state.combat.enemyId}`,
        combat: buildCombatVm(state, state.combat, CONTENT),
      };
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

    const death = buildDeathVm(state);
    await playCinematic(
      {
        // B4 的四张结局图（16:9），文件名恒等于 EndingType —— 饿殍／横死／寿终／登神各一张
        media: { kind: "image", src: endingArt(state.ending) },
        durationMs: 4400,
        // 第一行是结局二字（当标题排），第二行是引擎写的那句死亡旁白，第三行是收束统计。
        // 刻意**不放** epitaph：它和引擎的 deathStarve 旁白几乎同义，并排两行会读成重复。
        lines: [death.endingLabel, death.lastWords, death.summary],
        tintRgb: ascending ? "244,240,228" : "194,59,34",
        motion: ascending ? "rise" : "out",
        label: `${death.endingLabel}：${death.epitaph}`,
        className: ascending ? "cine--ascend" : "cine--death",
      },
      this.overlayHost,
    );

    const entry: ChronicleEntry = composeChronicle(state, CONTENT);
    const gain = bloodlineGain(state);
    this.bloodline = recordLife(this.bloodline, gain, entry);
    saveBloodline(this.storage, this.bloodline);
    this.chronicleVm = buildChronicleVm(entry, gain, CONTENT);

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

  // ===== 渲染 =====

  private renderPlayScreen(): void {
    const state = this.state;
    if (!state) return;
    const status = buildStatusVm(state, CONTENT);
    this.swap(
      renderPlay({
        status,
        center: this.center,
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
        log: recentLogVm(this.log),
        freshLogIds: this.freshLogIds,
        busy: this.busy,
        onAction: (id) => void this.safely(() => this.doAction(id)),
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
      const intensity = Math.min(1, value / Math.max(1, CONTENT.tuning.moltThreshold));
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
   * （`availableActions`／`eligibleChoiceIdxs`／`combatSkillOrgan`），构造上不可能分叉。
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
    const digit = Number.parseInt(event.key, 10);
    if (Number.isInteger(digit) && digit >= 1 && digit <= 4) {
      const selector =
        this.center.kind === "combat"
          ? `[data-combat]`
          : this.center.kind === "stalk"
            ? `[data-stalk]`
            : this.center.kind === "event"
              ? `[data-choice]`
              : `[data-action]`;
      const buttons = this.screenHost.querySelectorAll<HTMLButtonElement>(selector);
      const button = buttons[digit - 1];
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
  } {
    return {
      screen: this.screen,
      center: this.center.kind,
      busy: this.busy,
      state: this.state,
      bloodline: this.bloodline,
      pendingEventId: this.pendingEvent?.id ?? null,
    };
  }
}

/** `data-anchor` 里只会出现 `[a-z:]`，但拼选择器时仍防一手引号注入。 */
function cssEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

function seasonHungerCost(state: TaleState): number {
  return CONTENT.tuning.hungerPerSeason + (state.season === 3 ? CONTENT.tuning.winterHungerExtra : 0);
}

function noticeTone(text: string, molted: boolean): LogTone {
  if (molted && text.includes("蜕")) return "molt";
  if (text.includes("猎得") || text.includes("饱食")) return "gain";
  if (text.includes("当道") || text.includes("盯上")) return "combat";
  return "plain";
}

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
