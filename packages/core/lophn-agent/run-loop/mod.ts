export {
  type CoreRead,
  startRuntime,
  type Startup,
  type StartupInput,
} from "./startup.ts";
export { turnSchemaSteps } from "./schema.ts";
export {
  createTurnCommands,
  finishRow as finishTurnRow,
  turnBodyFields,
  type TurnCommandDeps,
} from "./commands.ts";
export { loadTurn, turnRecordOf, type TurnRow, turnRowOf } from "./model.ts";
export { deleteSessionTurns, sessionTurnIds } from "./erase.ts";
export { createTurnReads } from "./reads.ts";
export { type InterruptReason, interruptRunningTurns } from "./interrupt.ts";
export {
  publishAfterCommit,
  type PublishAgentEvent,
  publishTurnEnded,
} from "./turn-events.ts";
export {
  AGENT_EVENT_TOPIC,
  INBOX_CLEAR_TOPIC,
  INBOX_PUT_TOPIC,
} from "./topics.ts";
export {
  type AttemptEnd,
  type AttemptStart,
  callWithinLimits,
  type ConfirmedFacts,
  type GuardedCall,
  type LimitReason,
  type LimitResult,
  limitResult,
  type ModelPurpose,
  TURN_LIMIT_SETTING_KEYS,
  TurnLimiter,
  type TurnLimiterInit,
  type TurnLimits,
  turnLimitSettings,
  turnLimitsOf,
} from "./limits.ts";
export {
  createInboxApplier,
  createLophnInputTransport,
  createTurnSource,
  createTurnStarter,
  type TurnStart,
  type TurnStarter,
} from "./work.ts";
export { createInbox, type Inbox } from "./inbox.ts";
export { createTurnPipe, type TurnPipe } from "./turn-pipe.ts";
export { inputText } from "./input-text.ts";
export { untrustedSource, wrapUntrusted } from "./untrusted.ts";
export {
  type AppOffer,
  computeAgentAppScope,
  type OfferedCommand,
  type ScopeInput,
} from "./scope.ts";
export {
  type AgentCredentialIssuer,
  type AgentTurnCredential,
  beginTurn,
  type BeginTurnDeps,
  type BeginTurnInput,
  createTurnCredentials,
  type StartTurnResult,
  type TurnCredentialOptions,
  type TurnCredentials,
} from "./credentials.ts";
export {
  type TurnActivity,
  type TurnPhase,
  turnStatus,
  type TurnStatusView,
} from "./status.ts";
export { startTurnLoop } from "./loop.ts";
export {
  createTurnDriver,
  type DriveDeps,
  type DriveResult,
  type TurnDriver,
} from "./driver.ts";
export {
  createTurnPreparer,
  type McpSourceOptions,
  type McpToolkit,
  type Preparation,
  type PreparedTurn,
  type PreparerDeps,
  type Toolkit,
  type ToolPorts,
  type TurnPreparer,
} from "./prepare.ts";
export {
  type CorePortsDeps,
  createCorePorts,
  type ToolSetup,
  type TurnSeat,
} from "./core-ports.ts";
export { UNWIRED_TOOL_PORTS } from "./unwired.ts";
export {
  type AgentEventSink,
  type CallSignals,
  type FinishRequest,
  type FinishResult,
  type LoopDeps,
  type LoopEnd,
  type LoopFailureReason,
  type ModelAttempt,
  type ModelCallRequest,
  type ModelPort,
  type Pause,
  type PendingInputs,
  type SteeringInput,
  type StopCheck,
  type StopReason,
  type ToolCallRequest,
  type ToolDone,
  type ToolInfo,
  type ToolPort,
  type TurnContext,
  type TurnInput,
  type TurnInputs,
  type TurnLoopHandle,
  type TurnPorts,
  type TurnSource,
} from "./ports.ts";
export {
  abortableWait,
  isTransientFailure,
  MODEL_RETRY_DEFAULT_MS,
  MODEL_RETRY_MAX,
  modelRetryDelayMs,
  TOOL_RETRY_BASE_MS,
  TOOL_RETRY_MAX,
  toolFailureRetryable,
  toolMayRetry,
  toolRetryDelayMs,
} from "./retry.ts";
export {
  type BatchOutcome,
  type CallResult,
  type ModelToolCall,
  runToolBatch,
} from "./tool-batch.ts";
export { historyResultPart } from "./history.ts";
export { parseToolArgs } from "./tool-batch.ts";
export {
  EXTERNAL_TOOL_OPERATIONS,
  roleOperations,
  RUNTIME_MACHINE_OPERATIONS,
  RUNTIME_MACHINE_ROUTES,
} from "./runtime-access.ts";

// ---- 옛 이름 (이 아래 한 블록) ----
// 다른 단위가 아직 import하는 `Run*` 이름이다. 새 코드는 쓰지 않는다. 그 단위들이 새 이름으로 옮기면 이
// 블록을 지운다. `RunRow`·`loadRun`·`ResumeState`는 waiting-and-recovery가 지워질 때까지 있다.
import { loadTurn, type TurnRow } from "./model.ts";
import { turnSchemaSteps } from "./schema.ts";
import { createTurnCommands, finishRow, turnBodyFields } from "./commands.ts";
import { createTurnReads } from "./reads.ts";
import { deleteSessionTurns, sessionTurnIds } from "./erase.ts";
import { TURN_LIMIT_SETTING_KEYS } from "./limits.ts";
import type { CallResult } from "./tool-batch.ts";
import type { ModelAttempt } from "./ports.ts";
import type { HistoryMessage } from "../prompt-assembly/mod.ts";

export const runSchemaSteps = turnSchemaSteps;
export const createRunCommands = createTurnCommands;
export const runBodyFields = turnBodyFields;
export const finishRunRow = finishRow;
export const createRunReads = createTurnReads;
export const deleteSessionRuns = deleteSessionTurns;
export const sessionRunIds = sessionTurnIds;
export const RUN_LIMIT_SETTING_KEYS = TURN_LIMIT_SETTING_KEYS;

// waiting-and-recovery가 `turns` 기준으로 바뀔 때까지 읽는 모양이다. 없어진 열은 비어 있어 그 쪽의 옛
// 동작은 막힌 채로 둔다.
export type RunRow = Omit<TurnRow, "state"> & {
  state: TurnRow["state"] | "accepted" | "waiting_user";
  assignment: string;
  waiting_on: string | null;
};
export function loadRun(
  lookup: Parameters<typeof loadTurn>[0],
  id: string,
): RunRow | undefined {
  const row = loadTurn(lookup, id);
  return row === undefined
    ? undefined
    : { ...row, assignment: "", waiting_on: null };
}

// 이어 하기 재료의 옛 모양이다. loop는 이어 하지 않는다.
export type ResumeState = {
  history: HistoryMessage[];
  facts: {
    changes: string[];
    unexecuted: string[];
    unknown_effects: string[];
  };
  pending: {
    attempt: ModelAttempt;
    confirmed: CallResult[];
    started: Record<string, string>;
  } | null;
  retry: { previous: string; retries: number; retry_at: string | null } | null;
};
