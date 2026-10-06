import type {
  ReportProblem,
  ReportProblemResult,
  SafeReportDetails,
} from "@lophn/contracts/problems/sdk-report";

// 앱 진입점이 설치하는 보고 통로의 symbol. 앱 code는 reportProblem만 부르고 transport를 모른다
// (apps/sdk#R26, R33). 같은 module이 두 번 load돼도 먼저 설치된 reporter를 쓴다.
export const REPORTER_PORT = Symbol.for("lophn.cap-problem");

type Store = Record<symbol, unknown>;

// 진입점이 transport를 넣어 만든 reporter를 설치한다. 이미 설치돼 있으면 그대로 둔다.
export function installProblemReporter(reporter: ReportProblem): void {
  const store = globalThis as Store;
  if (typeof store[REPORTER_PORT] === "function") return;
  store[REPORTER_PORT] = reporter;
}

// 앱이 선언 code로 보고한다. 진입점이 reporter를 설치하지 않았으면(단위 test·로컬 실행) 보내지 않고
// 실패 값을 돌려준다. 업무 흐름에 던지지 않는다.
export const reportProblem: ReportProblem = (
  code: string,
  details?: SafeReportDetails,
): ReportProblemResult => {
  const installed = (globalThis as Store)[REPORTER_PORT];
  if (typeof installed === "function") {
    return (installed as ReportProblem)(code, details);
  }
  return {
    report_id: "",
    completion: Promise.resolve({
      status: "failed",
      reason: {
        code: "unavailable",
        message: "problem reporting is not installed",
      },
    }),
  };
};
