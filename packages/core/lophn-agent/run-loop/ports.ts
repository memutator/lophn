import type { Clock, Result } from "../../../base/mod.ts";
import type {
  ModelOutcome,
  RunElapsed,
  ToolResult,
} from "../../../protocol/lophn-agent/mod.ts";
import type { WorkspaceReadOutput } from "../../../protocol/shell/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import type { RoutedInput } from "../../router/ports.ts";
import type { InstructionDeps } from "../instructions/mod.ts";
import type { SkillEntry } from "../extensions/mod.ts";
import type {
  HistoryMessage,
  MaterialSource,
  ModelLimits,
  PromptAssembly,
  PromptInput,
  PromptTool,
  SessionConversation,
  WirePacker,
} from "../prompt-assembly/mod.ts";
import type { ConfirmedFacts, RunLimits } from "./limits.ts";
import type { CallResult } from "./tool-batch.ts";

// agent loop가 밖과 닿는 자리다. loop는 ledger·provider·tool 실행을 직접 부르지 않고 이 port만
// 부른다. 실제 연결(core command·read, provider adapter, 판정·실행기)은 agent runtime이 꽂는다.
// 시계·대기·무작위도 주입한다.

export type StopReason =
  | "user_stopped"
  | "assignment_paused"
  | "assignment_withdrawn";

// 멈춤이 이미 확정됐는지. 사람 멈춤·assignment 멈춤은 core가 run을 끝내므로 loop는 FinishRun을
// 다시 부르지 않고 새 진입만 막는다.
export type StopCheck = { stopped: false } | {
  stopped: true;
  reason: StopReason;
};

// steering 입력 하나. id는 그 입력의 session 기록 message다(반영 기록의 key).
export type SteeringInput = { id: string; input: RoutedInput };

// 아직 model에 반영하지 않은 입력. request는 이 turn을 시작한 입력의 본문 전문이고 steering은 도는
// 중에 들어온 사람의 steer 입력이다.
export type PendingInputs = {
  request: string | null;
  steering: readonly SteeringInput[];
};

// turn이 시작한 입력과 steer를 읽는 길이다. 입력함은 core process의 메모리에 있고 agent runtime은
// 감독 pipe로 읽는다. 연결은 wiring이 한다.
export type TurnInputs = {
  // 이 turn을 시작한 입력. 입력함에서 꺼낸 것이다.
  first(): Promise<Result<RoutedInput | null>>;
  steering(): Promise<Result<readonly SteeringInput[]>>;
};

// turn이 call 입력을 가져갔다는 신호다. wiring이 Router의 `markConsumed`에 끼운다. StartTurn이 시작을 확정하는
// 같은 transaction에서 부른다.
export type CallSignals = {
  consumed(tx: Tx, call: Id<"cal">): Result<void>;
};

// model call 직전마다 읽는 이번 run의 prompt 재료다. 지침·재료는 call마다 새로 읽어 최신이다.
export type RunContext = {
  product: PromptInput["product"];
  role: PromptInput["role"];
  tools: readonly PromptTool[];
  work: PromptInput["work"];
  purpose: string | null;
  run_facts: string | null;
  // 이 run의 요청 앞에 있던 session의 대화다. Compact한 session이면 요약과 그것이 덮은 구간 뒤의 원문이고,
  // 덮은 구간의 원문은 이후 call의 입력에 넣지 않는다.
  session: SessionConversation;
  sources: readonly MaterialSource[];
  skills: readonly SkillEntry[];
  timezone: string | null;
  limits: ModelLimits;
  reserved_output: number;
};

export type ModelCallRequest = {
  assembly: PromptAssembly;
  // 선택한 adapter가 `buildRequest`로 번역한 본문이다.
  body: Record<string, unknown>;
  // 이 call에 반영하는 steering message ID.
  applied: readonly string[];
  kind: "initial" | "retry";
  // retry면 직전 시도의 ModelCall ID.
  retry_of: string | null;
};

// 완결된 시도 하나의 결과. 시작·종료 기록(ledger, usage)은 이 port를 꽂는 쪽이 한다.
export type ModelAttempt = {
  id: string;
  outcome: ModelOutcome;
  text: string;
  // 완전 응답에서만 tool 요청이 있다. 인자는 응답의 JSON 글 그대로다.
  toolCalls: readonly { id: string; name: string; args: string }[];
};

export type ModelPort = {
  // 선택한 provider adapter의 `buildRequest` 번역과 opaque 상태 byte 수(prompt-assemble의 pack).
  pack: WirePacker;
  // provider·계정·model을 쓸 수 있는지. 끄면 새 call을 보내지 않는다.
  available(): Promise<boolean>;
  call(
    request: ModelCallRequest,
    signal: AbortSignal,
  ): Promise<Result<ModelAttempt>>;
};

export type ToolInfo = {
  effect: "read" | "write" | "external";
  // 최초 호출의 중복 효과 없음이 계약으로 보장되는 쓰기인지.
  idempotent: boolean;
  // 외부 MCP tool이면 그 서버 이름. 연결 제거 때 새 진입을 막는 단위다.
  server: string | null;
};

export type ToolCallRequest = {
  // 이 tool 요청이 나온 ModelCall.
  model_call: string;
  // 응답 안의 요청 key와 순서.
  key: string;
  order: number;
  name: string;
  // 응답의 JSON을 해석한 값 그대로다. 해석할 수 없으면 원문 글이다. harness가 고치지 않는다.
  input: unknown;
  attempt: 0 | 1;
  // retry면 최초 호출의 ToolCall ID.
  retry_of: string | null;
};

export type ToolDone = {
  kind: "done";
  tool_call: string;
  status: "success" | "failure" | "uncertain" | "not_executed";
  code: string;
  result: ToolResult;
  // 이 call이 만든 질문. 질문은 추정 답으로 진행하지 않으므로 run은 이 질문의 답을 기다린다.
  asked?: string;
};

// 사람의 결정을 기다리는 대상. approval이면 진입하지 않은 고정 call이고, 질문이면 이미 끝난
// 질문 제출 call이다.
export type WaitTarget =
  | { tool_call: string; approval: string }
  | { tool_call: string; question: string };

// 사람의 결정을 기다리는 call. 진입하지 않았고 run은 이 결정 전까지 진행하지 않는다.
export type ToolWaiting = {
  kind: "waiting";
  tool_call: string;
  approval: string;
  result: ToolResult;
};

export type ToolAttempt = ToolDone | ToolWaiting;

export type ToolPort = {
  // 이번 run이 제공한 tool의 정보. 없는 tool이면 undefined다.
  info(name: string): ToolInfo | undefined;
  // 판정→진입→실행→종료 기록의 한 번이다. 재시도·복구는 이 한 번을 다시 부르며 진입 직전 판정을
  // 매번 다시 한다.
  attempt(
    call: ToolCallRequest,
    signal: AbortSignal,
  ): Promise<ToolAttempt>;
  // 사람의 허락 뒤 이미 진입을 기록한 call을 실행하고 끝낸다. 판정·진입 기록은 다시 하지 않는다.
  // 결정 반영(`ResolveRunWait`)이 재검사를 마치고 시작을 기록한 call만 여기로 온다.
  resume(
    call: ToolCallRequest,
    toolCall: string,
    signal: AbortSignal,
  ): Promise<ToolDone>;
  // 진입하지 않고 끝나는 call(없는 tool·잘못된 인자·미실행)을 기록한다.
  close(
    call: ToolCallRequest,
    why: {
      status: "failure" | "not_executed";
      code: string;
      summary: string;
    },
  ): Promise<ToolDone>;
};

export type LoopFailureReason =
  | "model_error"
  | "context_limit"
  | "model_attempt_limit"
  | "stall_limit"
  | "active_limit"
  | "effect_unknown"
  | "configuration_unavailable"
  | "target_unavailable";

export type FinishRequest = {
  outcome:
    | { kind: "completed"; reason: "answer_completed" }
    | { kind: "failed"; reason: LoopFailureReason };
  // machine이 확정한 사실이다. model 본문은 없다.
  facts: ConfirmedFacts;
  // 한도 도달이면 `limitResult`의 사실 요약이다.
  limit: Record<string, unknown> | null;
};

// 정상 종료는 미반영 steering이 없을 때만 확정된다. 있으면 종료하지 않고 다음 판단으로 간다.
export type FinishResult = { finished: true } | {
  finished: false;
  reason: "pending_input";
};

export type RunPorts = {
  stop(): Promise<StopCheck>;
  inputs(): Promise<Result<PendingInputs>>;
  context(): Promise<Result<RunContext>>;
  // relay `workspace.read`. page 없이 첫 page, 있으면 그 page다.
  view(
    input: { session: string; page?: number },
  ): Promise<Result<WorkspaceReadOutput>>;
  model: ModelPort;
  tools: ToolPort;
  // 시간 값만 저장한다(CheckpointRun).
  checkpoint(elapsed: RunElapsed): Promise<void>;
  // 완전한 tool 없는 답을 남긴다(RecordMessage).
  answer(text: string): Promise<Result<void>>;
  // 사람의 결정을 기다리는 run 상태로 옮긴다(WaitRun).
  wait(request: WaitTarget): Promise<Result<void>>;
  finish(request: FinishRequest): Promise<Result<FinishResult>>;
};

export type LoopDeps = {
  // 기록 시각과 단조 ms.
  clock: Clock;
  // 대기. 신호가 중단되면 "aborted"로 일찍 돌아온다.
  wait(ms: number, signal: AbortSignal): Promise<"elapsed" | "aborted">;
  // 진행 중인 호출의 한도 timer. 없으면 실제 timer를 쓴다.
  deadline?(ms: number, signal: AbortSignal): Promise<"elapsed" | "aborted">;
  random(): number;
  // 지침 읽기와 전송 본문 redaction. 화면 글의 redaction도 같은 것을 쓴다.
  instructions: InstructionDeps;
  ports: RunPorts;
  // 중단을 요청한 호출이 이 시간 안에 돌아오지 않으면 결과를 기다리지 않고 불명확으로 둔다.
  abortGraceMs?: number;
};

// 저장된 경계에서 같은 run을 잇는 재료다. 이력과
// 사실은 ledger에서 다시 만든 것이고, 이미 확정한 model 응답과 tool 결과는 다시 부르지 않는다.
export type ResumeState = {
  history: HistoryMessage[];
  facts: {
    changes: string[];
    unexecuted: string[];
    unknown_effects: string[];
  };
  // 완전하게 받았지만 아직 다 처리하지 않은 마지막 model 응답. 있으면 첫 turn은 model을 부르지
  // 않고 이 응답의 남은 일(tool call, 답 기록)부터 잇는다.
  pending: {
    attempt: ModelAttempt;
    // 이미 확정한 call의 결과(요청 key의 순서대로).
    confirmed: CallResult[];
    // 사람의 허락으로 진입이 이미 기록된 call: 요청 key → ToolCall ID. 판정 없이 실행한다.
    started: Record<string, string>;
  } | null;
  // 일시 실패 뒤 retry를 기다리는 중이었다. 예정 시각과 쓴 횟수를 그대로 잇는다.
  retry: { previous: string; retries: number; retry_at: string | null } | null;
};

export type RunInput = {
  run: string;
  limits: RunLimits;
  elapsed: RunElapsed;
  // 지금까지 센 model 시도(실패·retry 포함).
  attempts: number;
  // 세션이 없으면(주기 run) null이다. 화면은 no_session으로 준다.
  session: string | null;
  // 복구·결정 뒤 재개일 때 ledger에서 다시 만든 상태. 새 run은 없다.
  resume?: ResumeState;
};

export type LoopEnd =
  | { kind: "finished"; outcome: FinishRequest["outcome"] }
  // 사람이 멈췄다. run은 core가 이미 끝냈다.
  | { kind: "stopped"; reason: StopReason }
  // 사람의 결정을 기다린다. 재개는 기다림 해소기와 복구가 한다.
  | ({ kind: "waiting" } & WaitTarget)
  // 끝낼 이유는 확정했지만 FinishRun을 확정하지 못했다. 끝남으로 가정하지 않는다.
  | {
    kind: "finish_failed";
    outcome: FinishRequest["outcome"];
    error: { code: string; message: string };
  };

export type RunLoopHandle = {
  done: Promise<LoopEnd>;
  // 멈춤이 접수됐다는 신호(core event). 새 진입을 막고 진행 호출에 중단을 요청한다.
  stop(reason: StopReason): void;
  // provider를 끄거나 MCP 서버 연결을 제거했다는 신호. 새 진입을 막고 진행 호출을 취소한다.
  revoke(change: { provider: true } | { server: string }): void;
};
