// RuntimeState projection과 record_* 거절 규칙. IO 없는 순수 규칙이다.
// 우선순위와 숫자는 domain-model apps/runtime 그대로다.
import { err, ok, type Result } from "../../base/mod.ts";
import type { RuntimeReason, RuntimeState } from "../../contracts/apps/mod.ts";
import type { App } from "../../contracts/apps/mod.ts";
import type { RuntimeObservation } from "../../contracts/apps/mod.ts";

// 이 시각 이후에 요청한 stopped가 아직 종료 확인을 못 받으면 true다.
export const TERMINATION_CONFIRM_WINDOW_MS = 10_000;

// live 연결이 ready여도 어떤 field를 볼 수 있어야 running이다.
// 관측이 없으면 과거 event만으로 running이라 하지 않는다(R13).
// unavailable에는 근거가 필요하다(contract refine). 상세 이유는 reason에만 있다(R13).
export const NO_OBSERVATION: RuntimeReason = {
  code: "no_observation",
  summary: "no live observation of the current release",
};

export function stateOf(app: App | null): RuntimeState {
  if (app === null) {
    return { state: "preparing", termination_pending: false };
  }
  // 보관 상태는 stopped다. release 유무보다 우선한다(apps/registration#R8).
  if (app.status !== "active") {
    return { state: "stopped", termination_pending: false };
  }
  if (app.active_release === null) {
    return { state: "preparing", termination_pending: false };
  }
  if (!app.run_enabled) {
    return { state: "stopped", termination_pending: false };
  }
  // run_enabled이고 채택한 release가 있으면 running 관측이 확인되기 전까지
  // 지금 생존을 주장하지 않는다. unavailable의 근거는 관측이 준다.
  return {
    state: "unavailable",
    termination_pending: false,
    reason: NO_OBSERVATION,
  };
}

// stopped 요청 뒤 종료 미확인. 사람의 멈춤과 같은 ready=false의 종료 중을 표시한다(R15).
export function withTerminationPending(
  state: RuntimeState,
): RuntimeState {
  if (state.state !== "stopped" && state.state !== "unavailable") return state;
  return { ...state, termination_pending: true };
}

// unavailable의 근거. 근거가 없는 unavailable은 만들지 않는다(R13).
export function reasonOf(state: RuntimeState): RuntimeReason | undefined {
  return state.state === "unavailable" ? state.reason : undefined;
}

// record_*의 중복 판정. 같은 (app, release, 자식 nonce, 시작 시각, 관측 종류)만 재전송이다.
export type ObservationFact = {
  type: "AppStarted" | "AppStopped" | "AppUnavailable";
  app: string;
  release: string;
  process_nonce?: string;
  started_at?: string;
};

export function factsMatch(
  stored: { process_nonce?: string; started_at?: string },
  input: ObservationFact,
): boolean {
  return (stored.process_nonce ?? undefined) === input.process_nonce &&
    (stored.started_at ?? undefined) === input.started_at;
}

// 자식이 없는 관측(crash loop로 멈춘 상태)은 nonce·시작 시각이 없다(domain-model).
export function childless(fact: ObservationFact): boolean {
  return fact.process_nonce === undefined && fact.started_at === undefined;
}

// record_started의 입력 검사: attestation이 live release를 주장하는지.
export function startedNeedsLive(
  attestation: { release: string | null },
): Result<void> {
  return attestation.release !== null ? ok(undefined) : err({
    code: "invalid_input",
    message: "AppStarted needs a live release",
  });
}

// 현재 App 값과 관측에서 current state를 다시 계산한다. 관측의 ready·accepting은
// live 연결의 실제 검사 통과 때만 true다(R13).
export function projection(
  app: App | null,
  observation: RuntimeObservation | null | undefined,
): RuntimeState {
  const base = stateOf(app);
  if (base.state !== "unavailable") return base;
  if (
    observation === null || observation === undefined ||
    observation.mode !== "live" ||
    observation.release !== app?.active_release ||
    !observation.ready || !observation.accepting
  ) {
    // ready=false 관측의 근거가 있으면 그 reason을 믿는다(R13).
    return observation !== null && observation !== undefined &&
        observation.mode === "live" &&
        observation.release === app?.active_release &&
        observation.reason !== undefined
      ? {
        state: "unavailable",
        termination_pending: false,
        reason: observation.reason,
      }
      : base;
  }
  return { state: "running", termination_pending: false };
}

// stopped 요청이 유예 안에 있는지. 종료 확인 뒤에는 false다(R15).
export function terminationWithinGrace(
  requestedAtMs: number,
  nowMs: number,
  graceMs: number = TERMINATION_CONFIRM_WINDOW_MS,
): boolean {
  return nowMs - requestedAtMs < graceMs;
}
