import { z } from "zod";
import { atSchema } from "../base/values.ts";
import {
  type ConnectionId,
  connectionIdSchema,
} from "./connections.ts";
import { ticketIdSchema } from "./ticket/values.ts";

// terminal host가 TUI env로 넘기는 관측 socket 경로 변수다. 경로만 담고
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

// 관측이 이 시간보다 오래되면 현재 상태는 unknown이다. 무호출이 오래된 것을 process 종료나
// idle로 추정하지 않으려는 보수 값이고 adapter별 값은 검증 뒤에 정한다.
export const OBSERVATION_STALE_AFTER_MS = 15 * 60_000;

// 지금 보이는 상태다. 관측이 없거나 낡았거나 수집이 끊겼으면 unknown이다. ended는 낡아도 ended다.
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
// evidence가 없으면 지난 evidence를 지키며 지우지 않는다.
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

// 연결된 process가 끝났다는 host evidence다. ticket 완료나 claim 해제가 아니다.
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

// 수집 끊김·lophn 재시작 같은 이유로 지금 모른다는 표시다. 마지막 evidence는 지난 값으로 남고 ended는 그대로다.
export function unknownObservation(
  current: HarnessSessionObservation,
  reason: string,
): HarnessSessionObservation {
  if (current.state === "ended") return current;
  return { ...current, state: "unknown", freshness: "stale", reason };
}

export type { ConnectionId };
