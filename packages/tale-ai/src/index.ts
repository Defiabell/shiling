/**
 * `@shiling/tale-ai` 公开出口 —— AI 史官（P1）。
 *
 * 依赖方向恒为 **tale-client → tale-ai → tale-sim**。`tale-sim`／`tale-content` 不得
 * import 本包（架构红线 1：引擎里不能有任何外部输入，否则「同种子同操作＝同终态」不成立）。
 * 本包的产物只有一样东西：一段中文文本，替换列传正文。它不改任何玩法数值。
 */

export { collectLifeFacts, excerptPrefix, ENDING_LABELS, SLOT_LABELS, WAY_LABELS } from "./facts.js";
export { callChat, type ChatMessage, type ChatRequest, type ChatResponse } from "./gateway.js";
export { writeChronicle, type HistorianInput } from "./historian.js";
export {
  OPENING_ANGLES,
  SYSTEM_PROMPT,
  assembleBody,
  buildMessages,
  factsBlock,
  openingAngle,
  retryMessages,
  styleAnchors,
  type PromptInput,
} from "./prompt.js";
export {
  COPY_SPAN_LIMIT,
  DEFAULT_LIMITS,
  longestSharedSpan,
  parseDraft,
  validateDraft,
  type DraftLimits,
  type ParseResult,
} from "./validate.js";

// — P2 一世一剧本（降世时批量生成本世专属事件池）—
export {
  assembleEvent,
  buildSlots,
  combatableEnemies,
  gateableTags,
  mergeEffects,
  midpointDraft,
  organsWithTag,
  type SlotContext,
} from "./scenario/slots.js";
export {
  SCENARIO_SYSTEM_PROMPT,
  buildScenarioMessages,
  premiseBlock,
  retryScenarioMessages,
  slotBlock,
  styleAnchor,
  styleAnchors as scenarioStyleAnchors,
  writtenDigest,
  type ScenarioPromptInput,
} from "./scenario/prompt.js";
export {
  SCENARIO_COPY_SPAN,
  SCENARIO_LIMITS,
  auditEvent,
  dominancePairs,
  parseScenarioReply,
  validateEventDraft,
  type DraftLimits as ScenarioDraftLimits,
  type ScenarioParseResult,
  type ValidateContext,
} from "./scenario/validate.js";
export {
  SCENARIO_PACK_VERSION,
  catalogNouns,
  generateScenario,
  type ScenarioInput,
} from "./scenario/generate.js";
export {
  ACTION_LABELS,
  BUDGET_KEYS,
  DEFAULT_SCENARIO_OPTIONS,
  GENERATED_ID_PREFIX,
  SLOT_COUNT,
  type BatchStat,
  type BudgetKey,
  type BudgetRange,
  type ChoiceDraft,
  type ChoiceSpec,
  type EffectBudget,
  type EventDraft,
  type FixedEffects,
  type OutcomeDraft,
  type OutcomeSpec,
  type PremiseEcho,
  type ScenarioOptions,
  type ScenarioPack,
  type ScenarioResult,
  type ScenarioTelemetry,
  type SlotSpec,
  type TradeoffKind,
} from "./scenario/types.js";

export {
  DEFAULT_HISTORIAN_OPTIONS,
  type CallStat,
  type ChronicleDraft,
  type ChronicleExcerpt,
  type HistorianOptions,
  type HistorianResult,
  type HistorianTelemetry,
  type LifeFacts,
  type WayFactLine,
} from "./types.js";
