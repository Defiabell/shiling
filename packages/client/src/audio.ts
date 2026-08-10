import { dist2d, type GameState, type Locomotion, type Vec3 } from "@shiling/sim";
import { SPECIES } from "@shiling/content";
import type { SimEvent } from "./render/simEvents.js";
import { interpolateDayNight } from "./render/palette.js";
import { HOLD_BLACK_MS } from "./render/evolutionFx.js";

/**
 * 程序化 Web Audio 音效（M1 postfix N3）——游戏此前完全无声，这是补上的第一层声音。
 * 不引入任何新依赖、不加载任何音频素材文件：所有声音都用 OscillatorNode/噪声
 * AudioBuffer/BiquadFilterNode/WaveShaperNode/GainNode 包络实时合成，风格克制、
 * 音量保守（brief 原话 "subtle/stylized, NOT harsh"）。
 *
 * **架构要点**：
 * - `createAudio()` 是唯一入口，返回的 `unlock()/handle()/update()/toggleMute()/…`
 *   全部对"AudioContext 还没创建"保持安全 no-op（`graph === null` 时直接早退）——
 *   这让 main.ts 可以在模块顶层就无条件 eager 调用 `createAudio()`（同 particles.ts/
 *   screenFx.ts 的既有模式），而不必等到玩家真正点「入山」。
 * - `AudioContext` 真正的创建/`resume()` 延迟到 `unlock()`——浏览器的自动播放策略
 *   要求这必须由一次真实的用户手势触发；本工程唯一的手势是标题画面「入山」按钮，
 *   main.ts 在 `showTitle()` 的 `onEnter` 回调里调用 `unlock()`（见该调用点注释：
 *   `onEnter` 本身是 title.ts 内部 600ms 淡出 `setTimeout` 之后才触发的，不是点击
 *   事件的同一个调用栈——Safari 对"用户手势"的判定比 Chrome/Firefox 更严格，
 *   `unlock()` 因此额外挂了一次性 `pointerdown`/`keydown` 兜底重试 `resume()`，
 *   覆盖"第一次 resume 因为不在同一手势调用栈内被静默忽略"的情形）。
 * - 三层 Gain 总线：`masterGain`（全局音量+静音/暂停 duck）→ `sfxGain`/`ambientGain`
 *   （一次性音效 vs 持续环境层，各自独立总量，方便以后单独调）。
 * - 两份预生成的 2 秒噪声 `AudioBuffer`（白噪声/棕噪声各一份，创建 context 时生成
 *   一次，此后所有一次性音效通过新建 `AudioBufferSourceNode` 复用同一份 buffer 数据
 *   ——buffer 本身与 source 节点解耦，可以被任意多个 source 同时/先后引用）。白噪声
 *   用于"亮"、瞬态的声音（撕咬/水花）；棕噪声（泄漏积分白噪声，频谱更偏低频、更
 *   "闷"）用于"土/风/水流"这类需要厚重感的声音（挖掘/环境风声/游泳/出入洞）。
 * - 一次性音效播放完全靠 Web Audio 的"自动生命周期管理"：`OscillatorNode`/
 *   `AudioBufferSourceNode` 显式 `.stop(t)` 之后，一旦本模块不再持有引用（每次调用
 *   都是局部变量，函数返回后即失去引用），规范要求实现在证明"不会再产生声音"后
 *   自动 GC 掉整条断开的子图——不需要手动 `.disconnect()`。
 *
 * **ctx 形状的刻意偏离**：架构草案给的 `update()` ctx 类型只有
 * `{playerHunger, playerThirst, playerHp, maxHp, locomotion, paused, started}`，
 * 但"drink：loop gated by activity, not events"这条要求本质上需要每帧知道玩家是否
 * 正在饮水——而 `locomotion`（walk/swim/burrow）与"是否在饮水"是完全独立的两个轴
 * （见 @shiling/sim 的 Activity 类型），草案没有暴露它。这里额外加了一个
 * `drinking: boolean` 字段（main.ts 用 `player.activity === "drinking"` 派生），
 * 是满足"活动持续期间循环，不是靠离散事件"这条行为要求的唯一办法，因此
 * `handle()` 里刻意忽略 `"drink"` 这个 SimEvent（见下方注释），避免同一件事被
 * 两套机制各触发一次。
 *
 * **"玩家造成的一击"判定**：`handle()` 只拿到 `(events, state, playerId)`，没有
 * main.ts 渲染循环里已经算好的 `nearPlayerKillIds`（那是为顿帧/震屏/击杀浮字三个
 * 消费者单独计算的，只包含"致命"一击）。本模块需要的是更宽的集合——"玩家造成的
 * 任意一击，无论是否致命"（撕咬音效本身不分致命与否，只有额外的"深沉一击+下滑
 * 音"和奖励和弦才叠加在致命分支上）。与其往 main.ts 那段已经写满大段注释、经过
 * code review 收紧过的顿帧逻辑里再加一个新 Set，这里选择直接复用同一个"命中位置
 * 是否落在玩家攻击距离内"的一行判定（`isPlayerCausedHit`，与 main.ts 的
 * `PLAYER_HIT_PROXIMITY` 同一套几何、同一个 `SPECIES.youshou.attackRange`）——
 * 单行不等式判定的重复成本远低于跨文件传递一个新 Set 的复杂度。
 *
 * **已知权衡（code review 2026-08-09 追问过）**：这个"距离玩家 attackRange 内"的
 * 判据本质上是近似——main.ts 的同款判据在文档里已经承认过，潭狩猎杀苓鼠、或任意
 * 生物饥饿归零致死，只要恰好发生在玩家 attackRange 内，也会被误判成"玩家造成"。
 * 对震屏/顿帧/击杀浮字这三个既有消费者而言，误判的代价是纯视觉噪声；对本模块新增
 * 的"奖励和弦"而言，误判意味着玩家会听到一声明确暗示"你干掉了它"的音效，而那次
 * 击杀其实与玩家无关——听觉上的误导性比视觉上的更强。这里选择的取舍是：沿用与
 * 既有三个消费者相同的判据、不额外收紧（收紧需要往命中事件里塞攻击者 id 之类的
 * 新字段，牵动 simEvents.ts 的契约），把它当作这一批次接受的已知简化，留给以后
 * 真的在实机 playtest 里被注意到"背景战斗也会响起奖励音"时再回来加攻击者归属。
 *
 * **M1 B6 追加（进化系统收尾音效＋昼夜氛围联动）**：
 * - 蛰伏入眠（`playDormancyDrone`）＋蛰伏中的呼吸声长层（`dormancyBreathGain`，独立持续
 *   源，同 windGain/swimGain 惯例）＋环境层 duck（`computeAmbientTarget`）：三者都是边沿/
 *   状态跟随，不吃任何 SimEvent——蛰伏的开始/结束不产出离散事件，只能在 `update()` 里对比
 *   逐帧传入的 `ctx.dormant` 才能检测。
 * - 觉醒揭示和弦（`playAwakenChord`）：hook 用 `ctx.lastEvolutionTick` 边沿（`state.
 *   lastEvolution?.tick` 的变化），与 evolutionFx.ts 判断"是否真的开奖了"同一个字段——
 *   但故意延后 `HOLD_BLACK_MS`（从该文件导入，唯一数值来源）才响，让和弦大致落在揭示卡
 *   淡入的那一刻，而不是蛰伏刚结束、屏幕还是纯黑的那一帧。
 * - 溪鱼水花变体（`playFishSplash`）／穴獾遁地闷响（`playBurrowVanish`）：分别挂在既有
 *   `"hit"` 事件（按受害者 species 是否为 xiyu 追加判断，见 `findVictimSpecies`）与新增的
 *   `"vanish"` 事件（`simEvents.ts` 的 hiddenTicks 0→>0 边沿，见该文件对应注释）上，与既有
 *   splash/digTick 两个消费者同一套"读 events[]，按 kind 分支"写法。
 * - 昼夜氛围联动：虫鸣间隔（`nextChirpDelaySec` 新增的 `nightAmount` 参数）与风声基准音量
 *   （`computeWindBaseGain`）都按 `interpolateDayNight(ctx.timeOfDay).nightAmount` 缩放——
 *   复用 palette.ts 现成的昼夜插值，不在这个文件里另开一套"现在算不算晚上"的阈值判断
 *   （与 particles.ts 的 `fireflyGainFor` 同一惯例）。
 */

// ---------------------------------------------------------------------------
// 总线音量
// ---------------------------------------------------------------------------
export const MASTER_BASE_GAIN = 0.5;
export const PAUSE_DUCK_GAIN = 0.15; // 暂停时的目标——"duck 不是 mute"，面板期间仍隐约有声
const SFX_BUS_GAIN = 0.85;
const AMBIENT_BUS_GAIN = 0.6;
const GAIN_RAMP_TIME_CONSTANT = 0.12; // 静音/暂停切换的平滑时间常数（秒），避免咔哒声

const MUTE_STORAGE_KEY = "shiling-audio-muted";

// ---------------------------------------------------------------------------
// 噪声 buffer
// ---------------------------------------------------------------------------
const NOISE_BUFFER_SEC = 2;
const BROWN_LEAK = 0.02; // 泄漏积分系数——越小越"闷"（低频占比越高）
const BROWN_COMPENSATION = 3.5; // 补偿积分带来的整体幅度衰减，使输出幅度量级与白噪声接近

// ---------------------------------------------------------------------------
// hit（撕咬/受击）
// ---------------------------------------------------------------------------
const PLAYER_ATTACK_RANGE = SPECIES.youshou!.attackRange; // 与 main.ts 的 PLAYER_HIT_PROXIMITY 同源常量
const BITE_BANDPASS_HZ = 1200;
const BITE_Q = 3.5;
const BITE_DURATION_SEC = 0.08;
const BITE_GAIN = 0.32;
const THUMP_FREQ_HZ = 90;
const THUMP_DECAY_SEC = 0.12;
const THUMP_GAIN = 0.34;
const LETHAL_THUMP_FREQ_HZ = 52;
const LETHAL_THUMP_DECAY_SEC = 0.22;
const LETHAL_THUMP_GAIN = 0.4;
const LETHAL_SWEEP_START_HZ = 320;
const LETHAL_SWEEP_END_HZ = 60;
const LETHAL_SWEEP_DURATION_SEC = 0.25;
const LETHAL_SWEEP_GAIN = 0.2;
// 奖励和弦：C 大调五声音阶（C D E G A）的 E5/A5——纯四度，明亮但不刺耳，"叮–叮"两声。
const REWARD_CHIME_NOTES: readonly [number, number] = [659.25, 880.0];
const REWARD_CHIME_NOTE_SEC = 0.14;
const REWARD_CHIME_GAP_SEC = 0.12; // 第二声相对第一声的起始延迟（不是间隔）
const REWARD_CHIME_GAIN = 0.16;

const VICTIM_LOWPASS_HZ = 280;
const VICTIM_DURATION_SEC = 0.16;
const VICTIM_GAIN = 0.34;
const VICTIM_THUMP_FREQ_HZ = 65;
const VICTIM_THUMP_DECAY_SEC = 0.16;
const VICTIM_THUMP_GAIN = 0.3;

// ---------------------------------------------------------------------------
// splash / digTick / carcassGone / burrowToggle
// ---------------------------------------------------------------------------
const SPLASH_START_HZ = 2000;
const SPLASH_END_HZ = 400;
const SPLASH_DURATION_SEC = 0.3;
const SPLASH_GAIN = 0.26;

const DIGTICK_LOWPASS_HZ = 550;
const DIGTICK_DURATION_SEC = 0.1;
const DIGTICK_GAIN = 0.22;

const CARCASS_GONE_DURATION_SEC = 0.5;
const CARCASS_GONE_ATTACK_SEC = 0.15;
const CARCASS_GONE_FREQ1_START = 620;
const CARCASS_GONE_FREQ1_END = 900;
const CARCASS_GONE_FREQ2_START = 930;
const CARCASS_GONE_FREQ2_END = 1350;
const CARCASS_GONE_SECOND_DELAY_SEC = 0.05;
const CARCASS_GONE_GAIN = 0.14;

const BURROW_SWEEP_DURATION_SEC = 0.28;
const BURROW_LOW_HZ = 220;
const BURROW_HIGH_HZ = 1500;
const BURROW_GAIN = 0.28;

// ---------------------------------------------------------------------------
// M2 A1：苓鼠跳跃落地"嗒"声
// ---------------------------------------------------------------------------
// 极轻、偏低音的短促单音——落地跳跃本身没有 SimEvent 可挂（跳跃相位是渲染层
// procedural 动画自己算出来的，见 creatureModels.ts 的 CreatureFx.hopTick），因此
// 这是本文件唯一一个不经过 handle()/update() 的 SimEvent 消费路径、而是直接暴露成
// AudioController 的公开方法（见文件底部 AudioController 接口与 createAudio 的
// 实现）——main.ts 通过 setCreatureFx() 把它接到 creatureModels.ts。
const HOP_TICK_FREQ_HZ = 180;
const HOP_TICK_DECAY_SEC = 0.05;
const HOP_TICK_GAIN = 0.08; // "soft low tick, quiet"（brief 原话）——比 CHIRP_GAIN(0.07) 略高一点，仍明显比大多数一次性音效轻

// ---------------------------------------------------------------------------
// M1 B6：溪鱼水花变体 / 穴獾遁地闷响 / 蛰伏入眠 / 觉醒揭示和弦
// ---------------------------------------------------------------------------
// 溪鱼水花——复用通用 splash 的"白噪声+lowpass 下滑"配方，音调更高、时长更短
// （小鱼的水花，不是玩家整个人下水那种量级）。
const FISH_SPLASH_START_HZ = SPLASH_START_HZ * 1.5;
const FISH_SPLASH_END_HZ = SPLASH_END_HZ * 1.5;
const FISH_SPLASH_DURATION_SEC = 0.16;
const FISH_SPLASH_GAIN = 0.2;

// 穴獾遁地——"existing digTick recipe ×3 quick + lowpass down sweep"（brief 原话）：
// 三连快速刮擦直接复用 DIGTICK_* 三个常量（同一份配方，只是错开时间连播三次），
// 尾部再叠一段更闷、更低的下滑噪声，读作"一下子钻没了"。
const BURROW_VANISH_SCRAPE_COUNT = 3;
const BURROW_VANISH_SCRAPE_GAP_SEC = 0.06;
const BURROW_VANISH_SWEEP_START_HZ = 500;
const BURROW_VANISH_SWEEP_END_HZ = 90;
const BURROW_VANISH_SWEEP_DURATION_SEC = 0.32;
const BURROW_VANISH_SWEEP_GAIN = 0.22;

// 蛰伏入眠——下滑纯音，soft attack，2 秒里从 120Hz 沉到 50Hz。
const DORMANCY_DRONE_START_HZ = 120;
const DORMANCY_DRONE_END_HZ = 50;
const DORMANCY_DRONE_DURATION_SEC = 2;
const DORMANCY_DRONE_ATTACK_SEC = 0.3; // "soft"——比其余一次性音效的默认 attack（几毫秒）明显更慢
const DORMANCY_DRONE_GAIN = 0.2;

// 蛰伏中的呼吸声长层——极慢噪声 swell，~0.25Hz（4 秒一个完整涨落周期）。
const DORMANCY_BREATH_LOWPASS_HZ = 260;
const DORMANCY_BREATH_FREQ_HZ = 0.25;
const DORMANCY_BREATH_GAIN = 0.035; // 比 WIND_BASE_GAIN(0.05) 更轻——"very quiet"（brief 原话）

// 环境层 duck（蛰伏中）——"duck 不是 mute"，与 PAUSE_DUCK_GAIN 同一设计语言，只是这里
// 只 duck ambientGain（风声/虫鸣/呼吸），不动 sfxGain/masterGain。
const DORMANCY_AMBIENT_DUCK_MULT = 0.55;

// 觉醒揭示和弦——C 大调五声音阶（与既有 REWARD_CHIME_NOTES 同一套音阶体系）里升序的三个音
// C5/E5/G5，轻柔错开起奏（"rising"三音，不是同时砸下去的柱式和弦）。
const AWAKEN_CHORD_NOTES: readonly [number, number, number] = [523.25, 659.25, 783.99];
const AWAKEN_CHORD_NOTE_SEC = 0.55;
const AWAKEN_CHORD_STAGGER_SEC = 0.16;
const AWAKEN_CHORD_ATTACK_SEC = 0.05;
const AWAKEN_CHORD_GAIN = 0.14;
/** 觉醒和弦相对"开奖那一刻"（lastEvolution.tick 变化）的延后——对齐 evolutionFx.ts 的持黑
 *  停顿，让和弦落在揭示卡真正淡入的那一帧，见文件头 M1 B6 段落。 */
const AWAKEN_CHORD_DELAY_SEC = HOLD_BLACK_MS / 1000;

// 昼夜氛围联动——虫鸣/风声都按 nightAmount∈[0,1] 缩放，公式与既有 fireflyGainFor 同一套
// "复用 palette.ts 的插值结果，不另开阈值判断"惯例。
const NIGHT_CHIRP_RATE_MULT_MIN = 0.6; // 满夜时虫鸣间隔压到白天基准的 60%（更频繁）
const NIGHT_WIND_GAIN_MULT_MIN = 0.55; // 满夜时风声基准音量降到白天基准的 55%（更静、更紧张）

// ---------------------------------------------------------------------------
// 持续层：环境风声 / 游泳 / 虫鸣 / 心跳 / 饮水 tick / 死亡淡出
// ---------------------------------------------------------------------------
const WIND_LOWPASS_HZ = 300;
const WIND_BASE_GAIN = 0.05;
const WIND_LFO_DEPTH = 0.02;
const WIND_LFO_FREQ_HZ = 0.06; // 极慢的"呼吸"周期（约 17s），逐帧直接写值不会产生可闻阶梯

const SWIM_LOWPASS_HZ = 550;
const SWIM_TARGET_GAIN = 0.16;
const SWIM_RAMP_TIME_CONSTANT = 0.2;

export const CHIRP_MIN_SEC = 3;
export const CHIRP_MAX_SEC = 9;
const CHIRP_FREQ_MIN_HZ = 4000;
const CHIRP_FREQ_MAX_HZ = 7000;
const CHIRP_DURATION_SEC = 0.07;
const CHIRP_GAIN = 0.07;

export const HEARTBEAT_HP_RATIO_THRESHOLD = 0.3;
const HEARTBEAT_MIN_SCALE = 0.35; // 刚跨过阈值时的最低强度——不是从 0 突然冒出来
const HEARTBEAT_PERIOD_SEC = 1 / 1.2; // 1.2Hz
const HEARTBEAT_PAIR_GAP_SEC = 0.09; // "咚-咚"两响的间隔
const HEARTBEAT_FREQ_HZ = 55;
const HEARTBEAT_DECAY_SEC = 0.11;
const HEARTBEAT_BASE_GAIN = 0.22;
// M15 P1（反制包）：濒死爆发窗口内心跳"tempo up"（brief 原话）——周期乘这个系数
// （<1，节拍更密），只在心跳本就因为 hpRatio<HEARTBEAT_HP_RATIO_THRESHOLD 而跳动时
// 生效（两个阈值都是 0.3，见 tuning.ts 的 adrenalineHpFrac 注释——并非巧合，两者本就是
// 同一个"命悬一线"的判据，各自独立声明常量只是模块边界纪律，不是刻意对齐两个不相关
// 的数字）。
const ADRENALINE_HEARTBEAT_TEMPO_MULT = 0.6;

const DRINK_TICK_RATE_HZ = 3;
const DRINK_TICK_BANDPASS_HZ = 800;
const DRINK_TICK_Q = 2;
const DRINK_TICK_DURATION_SEC = 0.04;
const DRINK_TICK_GAIN = 0.1;

const DEATH_FADE_FREQ_HZ = 50;
const DEATH_FADE_DURATION_SEC = 1.8;
const DEATH_FADE_ATTACK_SEC = 0.05;
const DEATH_FADE_GAIN = 0.3;

// ---------------------------------------------------------------------------
// 失真曲线（受击方是玩家自己时的"轻微失真"）——纯数据，模块加载时算一次即可复用。
// ---------------------------------------------------------------------------
const DISTORTION_CURVE_SAMPLES = 256;
// 显式钉住 ArrayBuffer 泛型参数（TS 5.7+ TypedArray 变成泛型之后，裸 `Float32Array`
// 会默认成更宽的 `Float32Array<ArrayBufferLike>`，与 lib.dom.d.ts 里
// `WaveShaperNode.curve: Float32Array<ArrayBuffer> | null` 的声明不兼容）。
const SOFT_CLIP_CURVE: Float32Array<ArrayBuffer> = (() => {
  const curve = new Float32Array(DISTORTION_CURVE_SAMPLES);
  for (let i = 0; i < DISTORTION_CURVE_SAMPLES; i++) {
    const x = (i / (DISTORTION_CURVE_SAMPLES - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 3);
  }
  return curve;
})();

// ---------------------------------------------------------------------------
// 纯函数（可脱离真实 AudioContext 单测——见 test/audio.test.ts）
// ---------------------------------------------------------------------------

/** [-1,1] 均匀分布白噪声采样，注入 rng 便于测试determinism；生产环境默认 Math.random。 */
export function generateWhiteNoiseSamples(length: number, rng: () => number = Math.random): Float32Array {
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) data[i] = rng() * 2 - 1;
  return data;
}

/**
 * 棕噪声：对白噪声做一次泄漏积分（leaky integrator），频谱能量向低频倾斜，
 * 听感更"闷/厚"（土地摩擦、风、水流的质感）。泄漏系数 BROWN_LEAK 保证积分不会
 * 无界随机游走；BROWN_COMPENSATION 补偿积分导致的整体幅度衰减，最后 clamp 到
 * [-1,1] 防止个别样本溢出。
 */
export function generateBrownNoiseSamples(length: number, rng: () => number = Math.random): Float32Array {
  const data = new Float32Array(length);
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = rng() * 2 - 1;
    last = (last + white * BROWN_LEAK) / (1 + BROWN_LEAK);
    data[i] = Math.max(-1, Math.min(1, last * BROWN_COMPENSATION));
  }
  return data;
}

/** 静音优先于暂停：静音时无论是否暂停都是 0；否则暂停 duck 到 PAUSE_DUCK_GAIN，正常播放是 MASTER_BASE_GAIN。 */
export function computeMasterTarget(muted: boolean, paused: boolean): number {
  if (muted) return 0;
  return paused ? PAUSE_DUCK_GAIN : MASTER_BASE_GAIN;
}

/**
 * 心跳强度随 hp 下降线性增强：hpRatio 恰好在阈值上→HEARTBEAT_MIN_SCALE（刚跨过
 * 阈值，不是从 0 突然冒出来）；hpRatio→0→1（满强度）。超出 [0, 阈值] 的输入会被
 * clamp（调用方本就只在 hpRatio < 阈值 时才调用，这里的 clamp 是防御性的）。
 */
export function computeHeartbeatGainScale(hpRatio: number): number {
  const clamped = Math.min(HEARTBEAT_HP_RATIO_THRESHOLD, Math.max(0, hpRatio));
  const t = 1 - clamped / HEARTBEAT_HP_RATIO_THRESHOLD;
  return HEARTBEAT_MIN_SCALE + (1 - HEARTBEAT_MIN_SCALE) * t;
}

/**
 * 心跳周期（M15 P1，反制包·濒死爆发"heartbeat tempo up"）：爆发窗口内周期乘
 * ADRENALINE_HEARTBEAT_TEMPO_MULT（<1，节拍更密），否则维持既有的 HEARTBEAT_PERIOD_SEC。
 * 与 computeHeartbeatGainScale 同一惯例——纯函数抽出来单测，不依赖 AudioContext。
 */
export function computeHeartbeatPeriod(adrenaline: boolean): number {
  return adrenaline ? HEARTBEAT_PERIOD_SEC * ADRENALINE_HEARTBEAT_TEMPO_MULT : HEARTBEAT_PERIOD_SEC;
}

/**
 * 下一次虫鸣的等待秒数，均匀分布在 [CHIRP_MIN_SEC, CHIRP_MAX_SEC) 之后再按 `nightAmount`
 * 压缩（M1 B6，昼夜氛围联动）：`nightAmount` 默认 0（白天基准，向后兼容——原有调用点/
 * 测试都只传一个参数）；越接近 1（满夜）间隔越短，下限是基准的 NIGHT_CHIRP_RATE_MULT_MIN
 * 倍，不会无限提速。
 */
export function nextChirpDelaySec(rng: () => number = Math.random, nightAmount = 0): number {
  const clamped = Math.min(1, Math.max(0, nightAmount));
  const mult = 1 - clamped * (1 - NIGHT_CHIRP_RATE_MULT_MIN);
  return (CHIRP_MIN_SEC + rng() * (CHIRP_MAX_SEC - CHIRP_MIN_SEC)) * mult;
}

/**
 * 环境风声的基准音量（M1 B6）——按 `nightAmount` 从 WIND_BASE_GAIN 降到它的
 * NIGHT_WIND_GAIN_MULT_MIN 倍，update() 里的 LFO 呼吸值仍叠加在这个基准之上（呼吸深度
 * WIND_LFO_DEPTH 本身不随昼夜变化，只有基准线降低——夜里更静，不是"呼吸幅度更小"）。
 */
export function computeWindBaseGain(nightAmount: number): number {
  const clamped = Math.min(1, Math.max(0, nightAmount));
  return WIND_BASE_GAIN * (1 - clamped * (1 - NIGHT_WIND_GAIN_MULT_MIN));
}

/** 蛰伏中的环境层（风声/虫鸣/呼吸，均挂在 ambientGain 下）目标音量——"duck 不是 mute"，同
 *  computeMasterTarget 的设计语言，只是这里 duck 的是 ambientGain 而不是 masterGain。 */
export function computeAmbientTarget(dormant: boolean): number {
  return dormant ? AMBIENT_BUS_GAIN * DORMANCY_AMBIENT_DUCK_MULT : AMBIENT_BUS_GAIN;
}

/**
 * "这次命中的受害者是不是溪鱼"（M1 B6，溪鱼水花变体的判据）：非致命命中时受害者仍在
 * state.creatures 里；致命命中时非玩家受害者已被 killCreature 移进 state.carcasses（同一
 * tick 内完成，见 needs.ts 的 killCreature）——两处都查一遍，覆盖两种情形。找不到（理论上
 * 不会发生）时返回 undefined，调用方按"不是鱼"处理。
 */
export function findVictimSpecies(state: GameState, id: number): string | undefined {
  return state.creatures.find((c) => c.id === id)?.species ?? state.carcasses.find((c) => c.id === id)?.species;
}

/**
 * "这一击是玩家造成的吗"——与 main.ts 的 PLAYER_HIT_PROXIMITY 同一几何判据：
 * 命中位置落在玩家当前位置的 attackRange 内。找不到玩家（理论上不会发生，防御性）
 * 时返回 false。
 */
export function isPlayerCausedHit(state: GameState, playerId: number, hitPos: Vec3, attackRange: number): boolean {
  const player = state.creatures.find((c) => c.id === playerId);
  if (!player) return false;
  return dist2d(player.pos, hitPos) <= attackRange;
}

// ---------------------------------------------------------------------------
// 播放辅助（需要真实 AudioContext，不做单测——同 screenFx.ts/particles.ts 的既有取舍）
// ---------------------------------------------------------------------------

interface ToneOptions {
  type: OscillatorType;
  freqStart: number;
  freqEnd?: number;
  durationSec: number;
  peak: number;
  attackSec?: number;
  startDelaySec?: number;
}

/** 一个短促的振荡器音——freqEnd 存在且不同于 freqStart 时做指数扫频（用于"下滑音"/"上扬闪光"）。 */
function playTone(ctx: AudioContext, destination: AudioNode, opts: ToneOptions): void {
  const t0 = ctx.currentTime + (opts.startDelaySec ?? 0);
  const osc = ctx.createOscillator();
  osc.type = opts.type;
  osc.frequency.setValueAtTime(opts.freqStart, t0);
  if (opts.freqEnd !== undefined && opts.freqEnd !== opts.freqStart) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.freqEnd), t0 + opts.durationSec);
  }
  const gain = ctx.createGain();
  const attack = opts.attackSec ?? 0.004;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(opts.peak, t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.durationSec);
  osc.connect(gain).connect(destination);
  osc.start(t0);
  osc.stop(t0 + opts.durationSec + 0.02);
}

interface NoiseBurstOptions {
  filterType: BiquadFilterType;
  freqStart: number;
  freqEnd?: number;
  q?: number;
  durationSec: number;
  peak: number;
  attackSec?: number;
  /** 传入时在 filter 之后串一个 WaveShaperNode——用于"受击方是玩家自己"的轻微失真。 */
  distortionCurve?: Float32Array<ArrayBuffer>;
  rng?: () => number;
  /** M1 B6：镜像 ToneOptions 的同名字段——穴獾遁地闷响需要把 digTick recipe 连播三次、
   *  彼此错开一点点才听得出"连续刮擦"而不是一次更响的突发，见 playBurrowVanish。 */
  startDelaySec?: number;
}

/**
 * 一段经过滤波的噪声突发。`buffer` 是复用的共享 2 秒噪声数据；每次播放从随机偏移
 * 起读一小段（而不是永远从 offset 0 开始）——同一份底层噪声样本被大量不同音效
 * 反复复用，随机起点避免"连续多次同一动作听起来像同一段录音的复制"这种细微的
 * 可闻重复感（对<0.5s 的突发几乎不花额外成本）。
 */
function playNoiseBurst(ctx: AudioContext, destination: AudioNode, buffer: AudioBuffer, opts: NoiseBurstOptions): void {
  const t0 = ctx.currentTime + (opts.startDelaySec ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = opts.filterType;
  filter.frequency.setValueAtTime(opts.freqStart, t0);
  if (opts.freqEnd !== undefined && opts.freqEnd !== opts.freqStart) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(1, opts.freqEnd), t0 + opts.durationSec);
  }
  if (opts.q !== undefined) filter.Q.value = opts.q;

  const gain = ctx.createGain();
  const attack = opts.attackSec ?? 0.005;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(opts.peak, t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.durationSec);

  src.connect(filter);
  let tail: AudioNode = filter;
  if (opts.distortionCurve) {
    const shaper = ctx.createWaveShaper();
    shaper.curve = opts.distortionCurve;
    tail.connect(shaper);
    tail = shaper;
  }
  tail.connect(gain).connect(destination);

  const rng = opts.rng ?? Math.random;
  const maxOffset = Math.max(0, buffer.duration - opts.durationSec - 0.05);
  const offset = rng() * maxOffset;
  src.start(t0, offset);
  src.stop(t0 + opts.durationSec + 0.02);
}

function makeNoiseBuffer(ctx: AudioContext, samples: Float32Array): AudioBuffer {
  const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
  buffer.getChannelData(0).set(samples);
  return buffer;
}

// ---------------------------------------------------------------------------
// 音频图
// ---------------------------------------------------------------------------
interface AudioGraph {
  ctx: AudioContext;
  masterGain: GainNode;
  sfxGain: GainNode;
  ambientGain: GainNode;
  whiteBuffer: AudioBuffer;
  brownBuffer: AudioBuffer;
  /** 环境风声的独立 Gain——update() 里逐帧写 LFO 呼吸值。 */
  windGain: GainNode;
  /** 游泳环境音的独立 Gain——update() 里按 locomotion==="swim" 平滑 ramp。 */
  swimGain: GainNode;
  /** M1 B6：蛰伏中的呼吸声长层，独立 Gain——update() 里按 state.dormancy 与 0.25Hz swell 驱动。 */
  dormancyBreathGain: GainNode;
}

function buildGraph(ctx: AudioContext, muted: boolean): AudioGraph {
  const masterGain = ctx.createGain();
  // 初始值只看 muted，不看 paused——安全前提是 unlock()（这个函数唯一的调用点）
  // 只会在 main.ts 的 `started` 从 false 翻到 true 的那一刻调用一次，而那一刻
  // `paused` 恒为 false（Esc 的守卫要求先 started 才能暂停，见 main.ts 对应监听器）。
  // 即便这里的初始值偶然不对，下一帧 update() 里的 applyMasterTarget() 也会立刻
  // 纠正——只是留痕这条"目前恒成立"的前提，防止以后调用点一变而无声跟着错。
  masterGain.gain.value = muted ? 0 : MASTER_BASE_GAIN;
  masterGain.connect(ctx.destination);

  const sfxGain = ctx.createGain();
  sfxGain.gain.value = SFX_BUS_GAIN;
  sfxGain.connect(masterGain);

  const ambientGain = ctx.createGain();
  ambientGain.gain.value = AMBIENT_BUS_GAIN;
  ambientGain.connect(masterGain);

  const bufferLength = Math.floor(ctx.sampleRate * NOISE_BUFFER_SEC);
  const whiteBuffer = makeNoiseBuffer(ctx, generateWhiteNoiseSamples(bufferLength));
  const brownBuffer = makeNoiseBuffer(ctx, generateBrownNoiseSamples(bufferLength));

  // 环境风声——永久存活的循环源，音量完全交给 update() 里的 windGain 逐帧驱动。
  const windSrc = ctx.createBufferSource();
  windSrc.buffer = brownBuffer;
  windSrc.loop = true;
  const windFilter = ctx.createBiquadFilter();
  windFilter.type = "lowpass";
  windFilter.frequency.value = WIND_LOWPASS_HZ;
  const windGain = ctx.createGain();
  windGain.gain.value = WIND_BASE_GAIN;
  windSrc.connect(windFilter).connect(windGain).connect(ambientGain);
  windSrc.start();
  // 已知简化：2 秒 buffer 循环播放的首尾拼接点未做交叉淡入淡出——lowpass 300Hz
  // 已经把瞬态能量削得很低，加上 brief 要求"extremely subtle"，实测量级下拼接点
  // 不构成可闻的咔嗒声，故未额外实现循环缝合（若以后风声调大音量需要重新评估）。

  // 游泳环境音——同样永久存活，音量常态为 0，只在 locomotion==="swim" 时被 ramp 上去。
  const swimSrc = ctx.createBufferSource();
  swimSrc.buffer = brownBuffer;
  swimSrc.loop = true;
  const swimFilter = ctx.createBiquadFilter();
  swimFilter.type = "lowpass";
  swimFilter.frequency.value = SWIM_LOWPASS_HZ;
  const swimGain = ctx.createGain();
  swimGain.gain.value = 0;
  swimSrc.connect(swimFilter).connect(swimGain).connect(ambientGain);
  swimSrc.start();

  // 蛰伏呼吸——同 windSrc/swimSrc 一样永久存活循环源，音量常态为 0，只在 update() 里
  // state.dormancy!==null 时被驱动出一段极慢的 swell（M1 B6）。
  const dormancyBreathSrc = ctx.createBufferSource();
  dormancyBreathSrc.buffer = brownBuffer;
  dormancyBreathSrc.loop = true;
  const dormancyBreathFilter = ctx.createBiquadFilter();
  dormancyBreathFilter.type = "lowpass";
  dormancyBreathFilter.frequency.value = DORMANCY_BREATH_LOWPASS_HZ;
  const dormancyBreathGain = ctx.createGain();
  dormancyBreathGain.gain.value = 0;
  dormancyBreathSrc.connect(dormancyBreathFilter).connect(dormancyBreathGain).connect(ambientGain);
  dormancyBreathSrc.start();

  return { ctx, masterGain, sfxGain, ambientGain, whiteBuffer, brownBuffer, windGain, swimGain, dormancyBreathGain };
}

// ---------------------------------------------------------------------------
// 一次性音效
// ---------------------------------------------------------------------------

function playAttackHit(g: AudioGraph, lethal: boolean): void {
  playNoiseBurst(g.ctx, g.sfxGain, g.whiteBuffer, {
    filterType: "bandpass", freqStart: BITE_BANDPASS_HZ, q: BITE_Q, durationSec: BITE_DURATION_SEC, peak: BITE_GAIN,
  });
  playTone(g.ctx, g.sfxGain, { type: "sine", freqStart: THUMP_FREQ_HZ, durationSec: THUMP_DECAY_SEC, peak: THUMP_GAIN });
  if (!lethal) return;
  // 致命一击额外叠三层："更深一声闷响"+"下滑音"（爽感，与主循环的顿帧同一时刻发生）
  // +"奖励和弦"（呼应已有的「＋肉」浮字视觉，见 killMarker.ts）。
  playTone(g.ctx, g.sfxGain, { type: "sine", freqStart: LETHAL_THUMP_FREQ_HZ, durationSec: LETHAL_THUMP_DECAY_SEC, peak: LETHAL_THUMP_GAIN });
  playTone(g.ctx, g.sfxGain, {
    type: "sine", freqStart: LETHAL_SWEEP_START_HZ, freqEnd: LETHAL_SWEEP_END_HZ,
    durationSec: LETHAL_SWEEP_DURATION_SEC, peak: LETHAL_SWEEP_GAIN,
  });
  playTone(g.ctx, g.sfxGain, { type: "sine", freqStart: REWARD_CHIME_NOTES[0], durationSec: REWARD_CHIME_NOTE_SEC, peak: REWARD_CHIME_GAIN });
  playTone(g.ctx, g.sfxGain, {
    type: "sine", freqStart: REWARD_CHIME_NOTES[1], durationSec: REWARD_CHIME_NOTE_SEC,
    peak: REWARD_CHIME_GAIN, startDelaySec: REWARD_CHIME_GAP_SEC,
  });
}

function playVictimHit(g: AudioGraph): void {
  // 与 playAttackHit 刻意不同的音色：低通(280Hz)而非带通(1200Hz)、棕噪声而非白噪声、
  // 额外叠一层轻微失真（WaveShaper）——"更闷、更沉、带一点破音"，读作"我被打了"而
  // 不是"我打中了"。
  playNoiseBurst(g.ctx, g.sfxGain, g.brownBuffer, {
    filterType: "lowpass", freqStart: VICTIM_LOWPASS_HZ, durationSec: VICTIM_DURATION_SEC,
    peak: VICTIM_GAIN, distortionCurve: SOFT_CLIP_CURVE,
  });
  playTone(g.ctx, g.sfxGain, { type: "sine", freqStart: VICTIM_THUMP_FREQ_HZ, durationSec: VICTIM_THUMP_DECAY_SEC, peak: VICTIM_THUMP_GAIN });
}

function playSplash(g: AudioGraph): void {
  playNoiseBurst(g.ctx, g.sfxGain, g.whiteBuffer, {
    filterType: "lowpass", freqStart: SPLASH_START_HZ, freqEnd: SPLASH_END_HZ,
    durationSec: SPLASH_DURATION_SEC, peak: SPLASH_GAIN, attackSec: 0.01,
  });
}

function playDigTick(g: AudioGraph): void {
  playNoiseBurst(g.ctx, g.sfxGain, g.brownBuffer, {
    filterType: "lowpass", freqStart: DIGTICK_LOWPASS_HZ, durationSec: DIGTICK_DURATION_SEC,
    peak: DIGTICK_GAIN, attackSec: 0.002,
  });
}

/** M2 A1：苓鼠跳跃落地"嗒"声——见文件头常量区注释。 */
function playHopTickSound(g: AudioGraph): void {
  playTone(g.ctx, g.sfxGain, { type: "sine", freqStart: HOP_TICK_FREQ_HZ, durationSec: HOP_TICK_DECAY_SEC, peak: HOP_TICK_GAIN });
}

function playCarcassGone(g: AudioGraph): void {
  playTone(g.ctx, g.sfxGain, {
    type: "sine", freqStart: CARCASS_GONE_FREQ1_START, freqEnd: CARCASS_GONE_FREQ1_END,
    durationSec: CARCASS_GONE_DURATION_SEC, peak: CARCASS_GONE_GAIN, attackSec: CARCASS_GONE_ATTACK_SEC,
  });
  playTone(g.ctx, g.sfxGain, {
    type: "sine", freqStart: CARCASS_GONE_FREQ2_START, freqEnd: CARCASS_GONE_FREQ2_END,
    durationSec: CARCASS_GONE_DURATION_SEC, peak: CARCASS_GONE_GAIN, attackSec: CARCASS_GONE_ATTACK_SEC,
    startDelaySec: CARCASS_GONE_SECOND_DELAY_SEC,
  });
}

function playBurrowToggle(g: AudioGraph, entered: boolean): void {
  const [freqStart, freqEnd] = entered ? [BURROW_HIGH_HZ, BURROW_LOW_HZ] : [BURROW_LOW_HZ, BURROW_HIGH_HZ];
  playNoiseBurst(g.ctx, g.sfxGain, g.brownBuffer, {
    filterType: "lowpass", freqStart, freqEnd, durationSec: BURROW_SWEEP_DURATION_SEC, peak: BURROW_GAIN, attackSec: 0.02,
  });
}

/** 溪鱼水花变体（M1 B6）——playSplash 的高音调、短时长版本，见文件头常量注释。 */
function playFishSplash(g: AudioGraph): void {
  playNoiseBurst(g.ctx, g.sfxGain, g.whiteBuffer, {
    filterType: "lowpass", freqStart: FISH_SPLASH_START_HZ, freqEnd: FISH_SPLASH_END_HZ,
    durationSec: FISH_SPLASH_DURATION_SEC, peak: FISH_SPLASH_GAIN, attackSec: 0.008,
  });
}

/** 穴獾遁地闷响（M1 B6）——digTick 配方连播三次（错开 BURROW_VANISH_SCRAPE_GAP_SEC）
 *  再叠一段更闷更低的下滑噪声，见文件头常量注释。 */
function playBurrowVanish(g: AudioGraph): void {
  for (let i = 0; i < BURROW_VANISH_SCRAPE_COUNT; i++) {
    playNoiseBurst(g.ctx, g.sfxGain, g.brownBuffer, {
      filterType: "lowpass", freqStart: DIGTICK_LOWPASS_HZ, durationSec: DIGTICK_DURATION_SEC,
      peak: DIGTICK_GAIN, attackSec: 0.002, startDelaySec: i * BURROW_VANISH_SCRAPE_GAP_SEC,
    });
  }
  playNoiseBurst(g.ctx, g.sfxGain, g.brownBuffer, {
    filterType: "lowpass", freqStart: BURROW_VANISH_SWEEP_START_HZ, freqEnd: BURROW_VANISH_SWEEP_END_HZ,
    durationSec: BURROW_VANISH_SWEEP_DURATION_SEC, peak: BURROW_VANISH_SWEEP_GAIN, attackSec: 0.02,
    startDelaySec: BURROW_VANISH_SCRAPE_COUNT * BURROW_VANISH_SCRAPE_GAP_SEC,
  });
}

/** 蛰伏入眠（M1 B6）——2 秒的下滑纯音，soft attack，见文件头常量注释。 */
function playDormancyDrone(g: AudioGraph): void {
  playTone(g.ctx, g.sfxGain, {
    type: "sine", freqStart: DORMANCY_DRONE_START_HZ, freqEnd: DORMANCY_DRONE_END_HZ,
    durationSec: DORMANCY_DRONE_DURATION_SEC, peak: DORMANCY_DRONE_GAIN, attackSec: DORMANCY_DRONE_ATTACK_SEC,
  });
}

/**
 * 陷坑触发闷响（M15 P1「反制包」）——brief 原话"short heavy thump (audio recipe
 * reuse)"：直接复用 LETHAL_THUMP_* 三个常量（低频、稍长衰减，本就是"沉重一击"配方
 * 的既有落点），不新开一套数值。
 */
function playPitSnareThump(g: AudioGraph): void {
  playTone(g.ctx, g.sfxGain, { type: "sine", freqStart: LETHAL_THUMP_FREQ_HZ, durationSec: LETHAL_THUMP_DECAY_SEC, peak: LETHAL_THUMP_GAIN });
}

/** 觉醒揭示和弦（M1 B6）——五声音阶三音升序错开起奏，见文件头常量注释。 */
function playAwakenChord(g: AudioGraph): void {
  AWAKEN_CHORD_NOTES.forEach((freq, i) => {
    playTone(g.ctx, g.sfxGain, {
      type: "sine", freqStart: freq, durationSec: AWAKEN_CHORD_NOTE_SEC, peak: AWAKEN_CHORD_GAIN,
      attackSec: AWAKEN_CHORD_ATTACK_SEC, startDelaySec: AWAKEN_CHORD_DELAY_SEC + i * AWAKEN_CHORD_STAGGER_SEC,
    });
  });
}

// ---------------------------------------------------------------------------
// 公开类型
// ---------------------------------------------------------------------------

export interface AudioUpdateContext {
  playerHunger: number;
  playerThirst: number;
  playerHp: number;
  maxHp: number;
  locomotion: Locomotion;
  /** 见文件头"ctx 形状的刻意偏离"——驱动饮水 tick 循环，架构草案的字段列表没有它。 */
  drinking: boolean;
  paused: boolean;
  started: boolean;
  /** M1 B6：state.dormancy!==null 直传——驱动入眠边沿/呼吸声长层/环境层 duck，见文件头 M1 B6 段落。 */
  dormant: boolean;
  /** M1 B6：state.lastEvolution?.tick ?? null——与 evolutionFx.ts 同一个"读后不清除，按 tick 判新"字段，驱动觉醒和弦边沿。 */
  lastEvolutionTick: number | null;
  /** M1 B6：state.timeOfDay 直传——驱动昼夜氛围联动（虫鸣/风声），见文件头 M1 B6 段落。 */
  timeOfDay: number;
  /**
   * M15 P1（反制包）：state.adrenalineTicks>0 直传。不做任何边沿检测（不像 dormant 那样
   * 驱动入眠/呼吸声的状态机）——只在心跳已经因为低血量而跳动时（hpRatio<
   * HEARTBEAT_HP_RATIO_THRESHOLD）临时把节拍调快，见 update() 里的心跳周期计算。
   */
  adrenaline: boolean;
}

export interface AudioController {
  /**
   * 必须在真实用户手势的处理路径里调用（本工程是标题「入山」按钮的 onEnter 回调）。
   * 幂等：AudioContext 只会被创建一次，重复调用只会尝试 resume()。
   */
  unlock(): void;
  handle(events: SimEvent[], state: GameState, playerId: number): void;
  update(frameDt: number, ctx: AudioUpdateContext): void;
  /**
   * M2 A1：唯一一个不经过 handle()/update() 的公开播放方法——跳跃落地是渲染层
   * procedural 动画自己算出来的相位边沿，没有 SimEvent 可挂（见文件头常量区注释）。
   * 由 main.ts 通过 creatureModels.ts 的 `setCreatureFx()` 接到这里。
   */
  playHopTick(): void;
  /** M 键——切换静音并持久化到 localStorage，返回切换后的状态。 */
  toggleMute(): boolean;
  /** 静音开关的当前值（不需要 AudioContext 已创建）。 */
  isMuted(): boolean;
  /** Dev/Playwright 探针：masterGain 的实时数值（静音/暂停 duck 生效后的结果）。unlock() 之前返回 0。 */
  getMasterGainValue(): number;
  /** Dev/Playwright 探针：AudioContext.state，unlock() 之前返回 "none"。 */
  getContextState(): string;
}

function readMutedFromStorage(): boolean {
  try {
    return localStorage.getItem(MUTE_STORAGE_KEY) === "1";
  } catch {
    return false; // 隐私模式/无 localStorage 环境下静默回退到"未静音"
  }
}

export function createAudio(): AudioController {
  let muted = readMutedFromStorage();
  let graph: AudioGraph | null = null;

  // update() 每帧都会先落这个值，即使 graph 还不存在——保证 unlock() 之后第一次
  // applyMasterTarget() 用到的 lastPaused 已经是最新的，不依赖调用顺序假设。
  let lastPaused = false;

  let windPhaseSec = 0;
  let chirpTimer = nextChirpDelaySec();
  let heartbeatPhaseSec = 0;
  let drinkTickTimer = 0;
  let deathFadePlayed = false;
  // M1 B6：蛰伏/觉醒边沿检测——同 deathFadePlayed 的写法，只在 `started` 门闩之后才被
  // update() 触碰（见该函数早退分支），标题画面/音频未解锁期间不会误判"边沿"。
  let wasDormant = false;
  let dormancyBreathPhaseSec = 0;
  // 初值 null（不是 -1）：state.lastEvolution 从未开奖过时恰好也是 null，两者语义对齐，
  // 第一次真正的开奖（tick 变成一个具体数字）才会被判定为"边沿"，不会在游戏刚开始时
  // 误触发。
  let lastEvolutionTickSeen: number | null = null;

  function applyMasterTarget(g: AudioGraph): void {
    const target = computeMasterTarget(muted, lastPaused);
    g.masterGain.gain.setTargetAtTime(target, g.ctx.currentTime, GAIN_RAMP_TIME_CONSTANT);
  }

  function unlock(): void {
    if (!graph) {
      // 防御性 try/catch（同 modelLibrary.ts 的 per-species 加载失败 console.warn
      // 惯例）：极少数不支持 Web Audio 的环境下，`new AudioContext()` 本身就会抛——
      // graph 保持 null，之后所有 handle()/update() 调用继续安全 no-op，游戏本体
      // 不受影响，只是从此静音，而不是卡在标题画面或抛出未捕获异常。
      try {
        const ctx = new AudioContext();
        graph = buildGraph(ctx, muted);
      } catch (err) {
        console.warn("[audio] Web Audio 初始化失败，本次会话将保持静音：", err);
        return;
      }
    }
    const g = graph;
    if (g.ctx.state !== "running") {
      void g.ctx.resume();
      // Safari 对"这次 resume() 是否真的在用户手势内"判定更严格——onEnter 是
      // title.ts 600ms 淡出 setTimeout 之后才触发的，未必总能算数。挂一次性兜底：
      // 玩家接下来的第一次点击/按键（大概率是移动/攻击）再补一次 resume()。
      const retryResume = (): void => { void g.ctx.resume(); };
      window.addEventListener("pointerdown", retryResume, { once: true });
      window.addEventListener("keydown", retryResume, { once: true });
    }
  }

  function handle(events: SimEvent[], state: GameState, playerId: number): void {
    if (!graph) return;
    const g = graph;
    for (const e of events) {
      switch (e.kind) {
        case "hit":
          if (e.id === playerId) playVictimHit(g);
          else if (isPlayerCausedHit(state, playerId, e.pos, PLAYER_ATTACK_RANGE)) playAttackHit(g, e.lethal);
          // M1 B6：溪鱼水花变体——独立于上面两支判据（不管这一击是不是玩家造成的），
          // 只要受害者是溪鱼就叠一层水花，见 findVictimSpecies 头部注释。
          if (findVictimSpecies(state, e.id) === "xiyu") playFishSplash(g);
          break;
        case "splash":
          playSplash(g);
          break;
        case "digTick":
          playDigTick(g);
          break;
        case "eatingTick":
          // M2 A1：刻意不响——brief 只要求"进食"这个动作强化视觉侧的节奏碎屑
          // （particles.ts 消费同一事件），未提及新增音效；这里的 case 只是满足 SimEvent
          // 穷尽性检查，不是遗漏（若以后要加咀嚼音再回来补）。
          break;
        case "carcassGone":
          playCarcassGone(g);
          break;
        case "burrowToggle":
          playBurrowToggle(g, e.entered);
          break;
        case "vanish":
          // M1 B6：穴獾遁地隐匿——见 simEvents.ts 的 hiddenTicks 0→>0 判据注释。
          playBurrowVanish(g);
          break;
        case "pitSnare":
          // M15 P1：陷坑触发——见文件头常量区 playPitSnareThump 的注释（LETHAL_THUMP_*
          // 配方复用）。
          playPitSnareThump(g);
          break;
        case "adrenaline":
          // 刻意不响：濒死爆发本身没有独立的"触发音"，听觉反馈完全靠下方 update() 的
          // 心跳提速（本就在 hpRatio<阈值时持续跳动，见文件头 M1 B6 段落与本 case 的
          // 姊妹字段 ctx.adrenaline）——再叠一个离散音效会与心跳的连续节拍互相打架。
          break;
        case "drink":
          // 刻意忽略：饮水音由 update() 里的 ctx.drinking 门控循环驱动，不吃这个边沿
          // 事件（见文件头"ctx 形状的刻意偏离"）。
          break;
        case "death":
          // 刻意忽略：玩家自己的死亡淡出由 update() 里 hp<=0 的边沿检测触发（那里才
          // 拿到逐帧的 hp，能干净地做"只播一次"），非玩家死亡在这版调色板里没有
          // 单独的声音（已经由对应的 lethal hit 一并覆盖）。
          break;
        default: {
          // 穷尽性守卫，同 particles.ts 的 handle() 同一套写法——SimEvent 以后新增
          // 分支时这里会编译不通过，强制来改这个文件而不是静默漏处理。
          const _exhaustive: never = e;
          void _exhaustive;
        }
      }
    }
  }

  function update(frameDt: number, uctx: AudioUpdateContext): void {
    lastPaused = uctx.paused;
    if (!graph) return;
    const g = graph;
    applyMasterTarget(g);
    if (!uctx.started) return;

    // M1 B6：昼夜氛围联动的唯一插值入口——风声基准/虫鸣间隔都从这一个数字派生，
    // 不在本文件里另开一套"现在算不算晚上"的阈值判断（见文件头 M1 B6 段落）。
    const nightAmount = interpolateDayNight(uctx.timeOfDay).nightAmount;

    // ---- 死亡边沿 + 心跳（互斥：死亡时心跳停摆，只留一声低沉淡出） ----
    const dead = uctx.playerHp <= 0;
    if (dead) {
      if (!deathFadePlayed) {
        deathFadePlayed = true;
        playTone(g.ctx, g.sfxGain, {
          type: "sine", freqStart: DEATH_FADE_FREQ_HZ, durationSec: DEATH_FADE_DURATION_SEC,
          peak: DEATH_FADE_GAIN, attackSec: DEATH_FADE_ATTACK_SEC,
        });
      }
      heartbeatPhaseSec = 0;
    } else {
      const hpRatio = uctx.maxHp > 0 ? uctx.playerHp / uctx.maxHp : 1;
      if (hpRatio < HEARTBEAT_HP_RATIO_THRESHOLD) {
        heartbeatPhaseSec += frameDt;
        const scale = computeHeartbeatGainScale(hpRatio);
        // 濒死爆发窗口内心跳提速（M15 P1）：只影响节拍密度（周期），不影响 scale
        // （音量强度仍只看 hpRatio），见 computeHeartbeatPeriod 的头部注释。
        const period = computeHeartbeatPeriod(uctx.adrenaline);
        // while（非 if）：万一某一帧 frameDt 异常大（掉帧恢复），不会漏掉本该发生的
        // 多次心跳节拍——同 simEvents.ts digTick 节流累加器的同一套写法。
        while (heartbeatPhaseSec >= period) {
          heartbeatPhaseSec -= period;
          const peak = HEARTBEAT_BASE_GAIN * scale;
          playTone(g.ctx, g.sfxGain, { type: "sine", freqStart: HEARTBEAT_FREQ_HZ, durationSec: HEARTBEAT_DECAY_SEC, peak });
          playTone(g.ctx, g.sfxGain, {
            type: "sine", freqStart: HEARTBEAT_FREQ_HZ, durationSec: HEARTBEAT_DECAY_SEC, peak,
            startDelaySec: HEARTBEAT_PAIR_GAP_SEC,
          });
        }
      } else {
        heartbeatPhaseSec = 0; // hp 回升到阈值以上——重新进入低血量时从一次完整的双响开始，不残留半截相位
      }
      // 心跳与环境风声一样不受 `paused` 门控（见下方虫鸣的门控注释对比）——暂停时
      // hp 本就冻结不变，心跳继续以同一强度轻声跳动，呼应"duck 不是 mute，面板期间
      // 仍是活的"这条 brief 设计意图。
    }

    // ---- 游泳环境音：平滑跟随 locomotion，进出水面不产生咔哒声 ----
    g.swimGain.gain.setTargetAtTime(
      uctx.locomotion === "swim" ? SWIM_TARGET_GAIN : 0,
      g.ctx.currentTime,
      SWIM_RAMP_TIME_CONSTANT,
    );

    // ---- 蛰伏入眠边沿 + 呼吸声长层 + 环境层 duck（M1 B6） ----
    // 入眠边沿只可能发生在 sim 真正 step 过的那一帧（V 触发蛰伏需要 sim.step 消费
    // input.dormant），而 sim.step 只在 !paused 时才跑（见 main.ts 渲染循环）——因此
    // 这里不需要像虫鸣那样额外套一层 `!uctx.paused` 才安全，边沿本身已经隐含了这个前提。
    if (uctx.dormant && !wasDormant) {
      playDormancyDrone(g);
    }
    // 呼吸相位持续推进（不在退出蛰伏时清零，同 windPhaseSec 的写法——都是"从不重置的
    // 连续相位"，不是"倒计时累加器"，重置与否不影响下一次进入蛰伏时听起来是否自然）。
    dormancyBreathPhaseSec += frameDt;
    const breathSwell = uctx.dormant
      ? DORMANCY_BREATH_GAIN * (0.5 + 0.5 * Math.sin(dormancyBreathPhaseSec * DORMANCY_BREATH_FREQ_HZ * Math.PI * 2))
      : 0;
    // setTargetAtTime（不是直接写 .value）：呼吸声在蛰伏边沿需要平滑起落，避免非蛰伏
    // 状态下这层突然从 0 跳变或跳回 0 产生咔哒声；GAIN_RAMP_TIME_CONSTANT(0.12s) 远小于
    // 呼吸周期（4s），不会把 swell 本身削平。
    g.dormancyBreathGain.gain.setTargetAtTime(breathSwell, g.ctx.currentTime, GAIN_RAMP_TIME_CONSTANT);
    g.ambientGain.gain.setTargetAtTime(computeAmbientTarget(uctx.dormant), g.ctx.currentTime, GAIN_RAMP_TIME_CONSTANT);
    wasDormant = uctx.dormant;

    // ---- 觉醒揭示和弦边沿（M1 B6）：见文件头常量区 AWAKEN_CHORD_DELAY_SEC 的注释——
    // playAwakenChord 内部已经把延后叠进每个音符的 startDelaySec，这里只管边沿检测
    // 本身，不需要额外 setTimeout。 ----
    if (uctx.lastEvolutionTick !== null && uctx.lastEvolutionTick !== lastEvolutionTickSeen) {
      lastEvolutionTickSeen = uctx.lastEvolutionTick;
      playAwakenChord(g);
    }

    // ---- 环境风声呼吸：极慢 LFO，逐帧直接写值（周期~17s，60fps 阶梯量化听不出来）；
    // 基准音量按 nightAmount 缩放（M1 B6，昼夜氛围联动——夜里更静更紧张）。 ----
    windPhaseSec += frameDt;
    g.windGain.gain.value = computeWindBaseGain(nightAmount) + Math.sin(windPhaseSec * WIND_LFO_FREQ_HZ * Math.PI * 2) * WIND_LFO_DEPTH;

    // ---- 虫鸣：只在 !paused 时推进倒计时——暂停="世界冻结"，不该冒出新的离散事件
    // （与心跳/风声的选择不同：这两个是持续存在的氛围底噪，虫鸣是主动触发的新事件，
    // brief 原文明确写了 "only when !paused && started" 挂在这一条上）。间隔按
    // nightAmount 压缩（M1 B6）——夜里虫鸣更频繁。
    if (!uctx.paused) {
      chirpTimer -= frameDt;
      if (chirpTimer <= 0) {
        chirpTimer = nextChirpDelaySec(Math.random, nightAmount);
        const freq = CHIRP_FREQ_MIN_HZ + Math.random() * (CHIRP_FREQ_MAX_HZ - CHIRP_FREQ_MIN_HZ);
        playTone(g.ctx, g.ambientGain, { type: "sine", freqStart: freq, durationSec: CHIRP_DURATION_SEC, peak: CHIRP_GAIN, attackSec: 0.01 });
      }
    }

    // ---- 饮水 tick：活动持续期间循环触发，不是靠 "drink" 这个边沿事件 ----
    if (uctx.drinking && !uctx.paused) {
      drinkTickTimer += frameDt;
      const interval = 1 / DRINK_TICK_RATE_HZ;
      while (drinkTickTimer >= interval) {
        drinkTickTimer -= interval;
        playNoiseBurst(g.ctx, g.sfxGain, g.whiteBuffer, {
          filterType: "bandpass", freqStart: DRINK_TICK_BANDPASS_HZ, q: DRINK_TICK_Q,
          durationSec: DRINK_TICK_DURATION_SEC, peak: DRINK_TICK_GAIN, attackSec: 0.002,
        });
      }
    } else {
      drinkTickTimer = 0;
    }
  }

  function toggleMute(): boolean {
    muted = !muted;
    try {
      localStorage.setItem(MUTE_STORAGE_KEY, muted ? "1" : "0");
    } catch {
      /* 隐私模式等环境下写入失败——静音状态仍在本次会话内生效，只是不跨会话持久化 */
    }
    if (graph) applyMasterTarget(graph);
    return muted;
  }

  function playHopTick(): void {
    if (!graph) return;
    playHopTickSound(graph);
  }

  return {
    unlock,
    handle,
    update,
    playHopTick,
    toggleMute,
    isMuted: () => muted,
    getMasterGainValue: () => (graph ? graph.masterGain.gain.value : 0),
    getContextState: () => (graph ? graph.ctx.state : "none"),
  };
}
