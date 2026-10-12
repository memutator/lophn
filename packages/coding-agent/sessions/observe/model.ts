// harness별 normalizer가 공유하는 값과 observation 조립이다(coding-agent/sessions#R6–R9, T39). 순수 함수이고
// 시각은 호출자가 준다(architecture). normalizer는 payload의 native event 하나를 상태 evidence로 바꿀 뿐 ticket
// claim·connection·process 소유를 건드리지 않고(R9), payload가 주장하는 runtime_ref·origin·connection·ticket은
// 쓰지 않는다. 그 값은 terminal host가 자기 등록 channel에서 붙인다(R8).
import {
  type EvidenceSource,
  type HarnessId,
  type HarnessSessionObservation,
  providerSessionMetadataSchema,
  type SessionState,
} from "../../../protocol/coding-agent/mod.ts";
import {
  ADAPTER_REVISION,
  CATALOG_REVISION,
  NATIVE_ENVIRONMENT,
} from "../../harnesses/mod.ts";

export type ObserveContext = {
  // receiver가 찍는 수신 시각이다. native timestamp는 evidence 시각으로 쓰지 않는다.
  now: string;
};

// native event 하나가 가리키는 상태 evidence다. 상태를 바꾸지 않는 event는 normalizer가 null을 낸다.
export type Evidence = {
  state: SessionState;
  source: EvidenceSource;
  // 어떤 native event인지 가리키는 안전한 참조다. payload 원문이 아니다.
  ref: string;
  // native ID는 harness가 실제로 준 값뿐이다. 없으면 null이고 다른 ID로 채우지 않는다(R7).
  session: { kind: string; id: string; transcriptPath: string | null } | null;
  cwd: string | null;
  reason: string | null;
};

export type Normalizer = (
  payload: Record<string, unknown>,
) => Evidence | null;

export function textOf(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

export function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

// 절대 경로만 cwd evidence다. 상대·빈 값은 없는 것으로 둔다.
export function cwdOf(value: unknown): string | null {
  const text = textOf(value);
  return text !== null && text.startsWith("/") && !/\p{Cc}/u.test(text)
    ? text
    : null;
}

export function observationOf(
  harness: HarnessId,
  evidence: Evidence,
  context: ObserveContext,
): HarnessSessionObservation {
  const session = evidence.session === null
    ? null
    : providerSessionMetadataSchema.safeParse({
      kind: evidence.session.kind,
      id: evidence.session.id,
      ...(evidence.session.transcriptPath === null
        ? {}
        : { transcript_path: evidence.session.transcriptPath }),
      source: evidence.source,
      acquired_at: context.now,
    });
  return {
    harness_id: harness,
    environment: NATIVE_ENVIRONMENT,
    profile_id: null,
    catalog_revision: CATALOG_REVISION,
    adapter_revision: ADAPTER_REVISION,
    // helper는 lophn이 연 process인지 모른다. 소유 표시는 host가 자기 runtime에만 붙인다(R8).
    origin: "external_terminal",
    runtime_ref: null,
    connection: null,
    ticket: null,
    cwd: evidence.cwd,
    // 검증을 통과한 evidence만 ID가 된다.
    provider_session: session !== null && session.success ? session.data : null,
    state: evidence.state,
    observed_at: context.now,
    evidence_source: evidence.source,
    evidence_ref: evidence.ref,
    freshness: "fresh",
    reason: evidence.reason,
  };
}
