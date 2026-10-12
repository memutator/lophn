import { type At, idSchema } from "../../protocol/base/mod.ts";
import {
  type Diagnostic,
  diagnosticSchema,
  type InternalErrorClass,
  type ProcessKind,
} from "../../protocol/supervision/mod.ts";

// 관측은 이미 pipe contract가 검사한 사실 하나다. 그 사실이 플랫폼 진단인지
// 앱 귀속 후보인지를 정하는 것이 이 모듈의 답이다(platform/diagnostics#R1).
export type FailureObservation = {
  component: ProcessKind;
  observed_at: At;
  count: number;
  // 관측자가 lophn 내부 오류로 보고한 분류다. 다른 오류 종류 이름은 받지 않는다.
  error_class: InternalErrorClass | null;
  // 소유 팀이 등록한 위치 ID다. 경로·stack·자유 text가 아니다.
  location: string | null;
  // 실패가 앱이던 중 사용 중이던 앱이다. 귀속을 바꾸지 않는다.
  app: string | null;
  // 실패 경로에 앱 코드가 있는가. SDK·desktop frame은 lophn 코드다.
  app_frame: boolean;
};

export type ReportObservation = {
  component: ProcessKind;
  observed_at: At;
  count: number;
  report: string;
};

// 플랫폼 진단과 앱 문제 후보 중 하나다. lophn 내부 실패는 언제나 플랫폼 진단이다.
export type Classification =
  | { outcome: "platform_diagnostic"; diagnostic: Diagnostic }
  | { outcome: "app_attribution"; app: string };

const reportId = idSchema("rpt");
const appId = idSchema("app");

function counted(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("invalid observation count");
  }
  return value;
}

// 등록 component·location은 받는 쪽 registry가 다시 본다. 그래도 wire 모양은 여기서 지킨다.
function diagnosed(diagnostic: Diagnostic): Classification {
  if (!diagnosticSchema.safeParse(diagnostic).success) {
    throw new TypeError("observation is not a registerable diagnostic");
  }
  return { outcome: "platform_diagnostic", diagnostic };
}

// 어느 쪽 코드인지 정하지 못하면 앱 문제로 넘기지 않는다(P11). 출처 불명 관측으로 남긴다.
function unattributed(
  component: ProcessKind,
  observedAt: At,
  count: number,
): Classification {
  return diagnosed({
    type: "diagnostic",
    kind: "unattributed_observation",
    payload: { component, observed_at: observedAt, count },
  });
}

export function classifyFailure(
  observation: FailureObservation,
): Classification {
  const count = counted(observation.count);
  // 앱 코드가 실패를 일으켰다면 그 앱의 귀속 관측이다(apps/runtime, problems/reporting).
  if (observation.app_frame) {
    return observation.app && appId.safeParse(observation.app).success
      ? { outcome: "app_attribution", app: observation.app }
      : unattributed(observation.component, observation.observed_at, count);
  }
  // 내부 오류와 등록 위치가 있으면 앱을 쓰던 중이어도 lophn_internal이다.
  if (observation.error_class && observation.location) {
    return diagnosed({
      type: "diagnostic",
      kind: "lophn_internal",
      payload: {
        component: observation.component,
        observed_at: observation.observed_at,
        error_class: observation.error_class,
        location: observation.location,
        count,
      },
    });
  }
  return unattributed(observation.component, observation.observed_at, count);
}

export function classifyReport(observation: ReportObservation): Classification {
  const count = counted(observation.count);
  // 보고를 읽을 수 없으면 그 보고로 앱 문제를 세울 근거가 없다.
  if (!reportId.safeParse(observation.report).success) {
    return unattributed(observation.component, observation.observed_at, count);
  }
  return diagnosed({
    type: "diagnostic",
    kind: "invalid_report",
    payload: {
      component: observation.component,
      observed_at: observation.observed_at,
      report: observation.report,
      count,
    },
  });
}
