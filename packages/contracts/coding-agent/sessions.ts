import { z } from "zod";
import { withReadCommon } from "../platform/envelope.ts";
import { idSchema } from "../platform/ids.ts";
import { defineRead } from "../platform/route.ts";
import { atSchema, seqSchema } from "../platform/values.ts";
import { projectIdSchema } from "../documents/values.ts";
import {
  type ConnectionId,
  connectionIdSchema,
  connectionScopeSchema,
} from "./connections.ts";
import { problemSummarySchema } from "../problems/problems.ts";
import { repairStateSchema } from "../problems/problem-detail.ts";
import {
  ticketIdSchema,
  ticketKindSchema,
  ticketReadinessSchema,
} from "./ticket-values.ts";

// terminal host가 TUI env로 넘기는 관측 socket 경로 변수(계획 Q7). 경로만 담고
// credential과 섞지 않는다.
export const LOPHN_TERMINAL_OBSERVE = "LOPHN_TERMINAL_OBSERVE";

// TUI 프로세스 env에는 connection 참조 값만 넘긴다(→ coding-agent/connection).
export const LOPHN_CONNECTION = "LOPHN_CONNECTION";

// lophn이 연 TUI의 shell/terminal 작업 흐름 관측값. ticket 상태와 별개다.
export const SESSION_STATES = [
  "starting",
  "ready",
  "working",
  "waiting_input",
  "ended",
  "unknown",
] as const;

export const sessionStateSchema = z.enum(SESSION_STATES);

export type SessionState = z.infer<typeof sessionStateSchema>;

// process ownership을 credential에서 추정하지 않는다. evidence로만 구분한다.
export const OBSERVATION_ORIGINS = [
  "lophn_terminal",
  "external_terminal",
] as const;

export const observationOriginSchema = z.enum(OBSERVATION_ORIGINS);

export type ObservationOrigin = z.infer<typeof observationOriginSchema>;

export const EVIDENCE_SOURCES = [
  "hook",
  "plugin",
  "extension",
  "protocol",
  "output",
  "process",
  "launch",
] as const;

export const evidenceSourceSchema = z.enum(EVIDENCE_SOURCES);

export type EvidenceSource = z.infer<typeof evidenceSourceSchema>;

export const FRESHNESS = ["fresh", "stale"] as const;

export const freshnessSchema = z.enum(FRESHNESS);

export type Freshness = z.infer<typeof freshnessSchema>;

const safeRefSchema = z.string().min(1).refine(
  (value) => !/\p{Cc}/u.test(value) && !value.startsWith("-"),
  { message: "safe ref" },
);

const safeTextSchema = z.string().min(1).refine(
  (value) => !/\p{Cc}/u.test(value),
  {
    message: "safe text",
  },
);

// adapter별 길이 상한 1,024 code point, 빈 값·leading dash·control character 금지다.
export const PROVIDER_SESSION_META_LIMIT = 1_024;

const metaValueSchema = z.string().refine(
  (value) => {
    const count = [...value].length;
    return count >= 1 && count <= PROVIDER_SESSION_META_LIMIT &&
      !/\p{Cc}/u.test(value) && !value.startsWith("-");
  },
  { message: "provider session value" },
);

// 실제 ID evidence 획득 전 null이다. 터미널·connection·`ses` ID로 채우지 않는다.
export const providerSessionMetadataSchema = z.object({
  kind: metaValueSchema,
  id: metaValueSchema,
  transcript_path: metaValueSchema.optional(),
  source: evidenceSourceSchema,
  acquired_at: atSchema,
});

export type ProviderSessionMetadata = z.infer<
  typeof providerSessionMetadataSchema
>;

export const harnessSessionObservationSchema = z.object({
  harness_id: z.string().min(1),
  environment: z.object({
    kind: z.enum(["host", "wsl", "remote"]),
    identity: safeRefSchema,
  }),
  profile_id: safeRefSchema.nullable(),
  catalog_revision: safeRefSchema,
  adapter_revision: safeRefSchema,
  origin: observationOriginSchema,
  runtime_ref: safeRefSchema.nullable(),
  connection: connectionIdSchema.nullable(),
  ticket: ticketIdSchema.nullable(),
  cwd: z.string().min(1).nullable(),
  provider_session: providerSessionMetadataSchema.nullable(),
  state: sessionStateSchema,
  observed_at: atSchema,
  evidence_source: evidenceSourceSchema,
  evidence_ref: safeRefSchema,
  freshness: freshnessSchema,
  reason: safeTextSchema.nullable(),
}).refine(
  (value) => (value.state === "unknown") === (value.reason !== null),
  { message: "unknown observation needs a reason" },
);

export type HarnessSessionObservation = z.infer<
  typeof harnessSessionObservationSchema
>;

// 관측 socket NDJSON 한 줄. terminal host가 자기 runtime_ref·generation을 붙이고
// payload의 주장 값은 쓰지 않는다(origin 빼고는 payload 주장을 무시한다).
export const observeEnvelopeSchema = z.object({
  runtime_ref: safeRefSchema,
  generation: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  observation: harnessSessionObservationSchema,
});

export type ObserveEnvelope = z.infer<typeof observeEnvelopeSchema>;

// 관측이 이 시간보다 오래되면 현재 상태는 unknown이다(sessions#R6). 무호출이 오래된 것을 process 종료나
// idle로 추정하지 않으려는 보수 값이고 adapter별 값은 검증 뒤에 정한다.
export const OBSERVATION_STALE_AFTER_MS = 15 * 60_000;

// 지금 보이는 상태다. 관측이 없거나 낡았거나 수집이 끊겼으면 unknown이다(R6, R10). ended는 낡아도 ended다.
export function observationAt(
  observation: HarnessSessionObservation | null,
  now: string,
): { state: SessionState; freshness: Freshness; reason: string | null } {
  if (observation === null) {
    return { state: "unknown", freshness: "stale", reason: "관측이 없다" };
  }
  if (observation.state === "ended") {
    return { state: "ended", freshness: observation.freshness, reason: null };
  }
  if (observation.freshness === "stale") {
    return {
      state: "unknown",
      freshness: "stale",
      reason: observation.reason ?? "낡은 관측이다",
    };
  }
  const age = Date.parse(now) - Date.parse(observation.observed_at);
  if (!(age <= OBSERVATION_STALE_AFTER_MS)) {
    return { state: "unknown", freshness: "stale", reason: "관측이 낡았다" };
  }
  return {
    state: observation.state,
    freshness: "fresh",
    reason: observation.reason,
  };
}

// 같은 runtime_ref·generation의 새 관측을 받는다. ended는 늦은 작업 event로 되살리지 않고, 새 관측에 ID
// evidence가 없으면 지난 evidence를 지키며 지우지 않는다(R6, R7).
export function acceptObservation(
  current: HarnessSessionObservation | null,
  incoming: HarnessSessionObservation,
): HarnessSessionObservation {
  if (current === null) return incoming;
  if (current.state === "ended") return current;
  if (incoming.provider_session === null && current.provider_session !== null) {
    return { ...incoming, provider_session: current.provider_session };
  }
  return incoming;
}

// 연결된 process가 끝났다는 host evidence다. ticket 완료나 claim 해제가 아니다(R6, R9).
export function endedByProcessExit(
  current: HarnessSessionObservation,
  now: string,
): HarnessSessionObservation {
  return {
    ...current,
    state: "ended",
    observed_at: now,
    evidence_source: "process",
    evidence_ref: "process-exit",
    freshness: "fresh",
    reason: null,
  };
}

// 수집 끊김·lophn 재시작 같은 이유로 지금 모른다는 표시다. 마지막 evidence는 지난 값으로 남고 ended는 그대로다
// (R6, R10).
export function unknownObservation(
  current: HarnessSessionObservation,
  reason: string,
): HarnessSessionObservation {
  if (current.state === "ended") return current;
  return { ...current, state: "unknown", freshness: "stale", reason };
}

// `/v1/coding_agent_sessions/summary` 요청 입력(architecture 5.3). app 단위 paging
// cursor를 받는다.
export const CodingAgentSessionSummaryInputSchema = z.strictObject({
  app: idSchema("app").optional(),
  cursor: z.string().min(1).optional(),
});

export const codingAgentSessionSummaryQuerySchema =
  CodingAgentSessionSummaryInputSchema;

// summary는 읽은 범위 ticket·문제 요약만 준다. 본문·전체 log·첨부·repair-context
// 를 넣지 않는다(→ coding-agent/guides).
export const remainingCheckCountsSchema = z.object({
  ticket: ticketIdSchema,
  completion_seq: seqSchema,
  conditions: z.array(z.number().int()).min(1),
  reason: safeTextSchema,
});

export type RemainingCheckCounts = z.infer<typeof remainingCheckCountsSchema>;

export const CodingAgentSessionSummarySchema = z.object({
  connection: connectionIdSchema,
  scope: connectionScopeSchema,
  observed_seq: seqSchema,
  observed_at: atSchema,
  // repair_state는 문제 상세의 수리 작업 상태다. coding agent가 맡을 수 있는 문제(ready_to_hand_off·
  // in_progress)와 사람이 먼저 할 일이 있는 문제를 hook이 가르는 근거다(guides#R23).
  problems: z.array(problemSummarySchema.extend({ repair_state: repairStateSchema }))
    .max(12),
  tickets: z.array(
    z.object({
      id: ticketIdSchema,
      app: idSchema("app"),
      kind: ticketKindSchema,
      title: z.string().min(1),
      state: z.enum(["open", "check_failed"]),
      readiness: ticketReadinessSchema,
      // 이 ticket이 고치는 문제다. hook이 보여 주는 문제의 ticket을 고른다.
      problems: z.array(idSchema("prb")).max(12),
    }),
  ).max(20),
  claims: z.array(
    z.object({
      ticket: ticketIdSchema,
      connection: connectionIdSchema,
      claim_seq: seqSchema,
      expires_at: atSchema,
    }),
  ).max(12),
  remaining_checks: z.array(remainingCheckCountsSchema).max(20),
  project: projectIdSchema.nullable(),
  folder: z.string().min(1).nullable(),
  claim_rule: z.string().min(1),
  next_cursor: z.string().min(1).nullable(),
}).refine((value) => (value.project === null) === (value.folder === null), {
  message: "project and folder must be both set or both null",
});

export type CodingAgentSessionSummary = z.infer<
  typeof CodingAgentSessionSummarySchema
>;

// 인증 실패를 빈 결과로 바꾸지 않는다(architecture 5.3).
export const codingAgentSessionSummaryOutputSchema = withReadCommon(
  z.object({
    summary: CodingAgentSessionSummarySchema,
  }),
);

export const codingAgentSessionSummary = defineRead({
  resource: "coding_agent_sessions",
  method: "summary",
  name: "CodingAgentSessionSummary",
  input: CodingAgentSessionSummaryInputSchema,
  output: codingAgentSessionSummaryOutputSchema,
  actors: ["coding_agent"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});

export const SESSION_ROUTES = [codingAgentSessionSummary] as const;

export type CodingAgentSessionSummaryRoute = typeof codingAgentSessionSummary;

export type { ConnectionId };
