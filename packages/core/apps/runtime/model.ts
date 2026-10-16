// RuntimeState projection. IO 없는 순수 규칙이고 ledger에 저장하지 않는다.
// 우선순위는 domain-model apps/runtime의 표 그대로다.
import type {
  App,
  RuntimeObservation,
  RuntimeReason,
  RuntimeState,
} from "../../../protocol/apps/mod.ts";

// 허용됐고 채택한 release가 있는데 지금 살아 있다는 관측이 없을 때의 근거다.
// 과거 event나 열린 problem으로 생존을 추정하지 않는다.
const NO_OBSERVATION: RuntimeReason = {
  code: "no_observation",
  summary: "no live observation of the current release",
};

// 정지를 요청했지만 OS 종료를 아직 확인하지 못한 자식의 관측 근거다.
// supervisor가 이 reason으로 관측을 내놓고, 종료를 확인하면 관측을 거둔다.
export const TERMINATING: RuntimeReason = {
  code: "terminating",
  summary: "stop requested; the OS has not confirmed the exit",
};

// 관측과 무관하게 App 값만으로 정해지는 상태. running은 관측 없이는 나오지 않는다.
type RuntimeApp = Pick<App, "active_release" | "status" | "run_enabled">;

function fromApp(app: RuntimeApp): RuntimeState {
  if (app.active_release === null) {
    return { state: "preparing", termination_pending: false };
  }
  if (app.status !== "active" || !app.run_enabled) {
    return { state: "stopped", termination_pending: false };
  }
  return {
    state: "unavailable",
    termination_pending: false,
    reason: NO_OBSERVATION,
  };
}

// App 값과 현재 supervisor 관측으로 RuntimeState를 계산한다.
// observation은 현재 연결의 메모리 값이고 null이면 관측이 없다.
export function projection(
  app: RuntimeApp,
  observation: RuntimeObservation | null,
): RuntimeState {
  const base = fromApp(app);
  if (base.state === "stopped") {
    // 멈춤을 요청한 뒤에도 live 자식이 관측되면 OS 종료 확인 전이다.
    return observation !== null && observation.mode === "live"
      ? { ...base, termination_pending: true }
      : base;
  }
  if (base.state !== "unavailable") return base;
  const current = observation !== null && observation.mode === "live" &&
    observation.release === app.active_release;
  if (!current) return base;
  if (observation.ready && observation.accepting) {
    return { state: "running", termination_pending: false };
  }
  // ready=false 관측은 contract가 reason을 필수로 한다. 그 근거를 그대로 보인다.
  return observation.reason === undefined ? base : {
    state: "unavailable",
    termination_pending: false,
    reason: observation.reason,
  };
}
