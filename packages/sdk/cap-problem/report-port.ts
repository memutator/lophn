import type {
  ReportProblemResult,
  SafeReportDetails,
} from "@lophn/protocol/problems/sdk-report";
import type { ProblemReportCall } from "../../protocol/problems/sdk-problem.ts";

// 앱 진입점이 설치하는 보고 통로의 symbol. 앱 code는 reportProblem만 부르고 transport를 모른다.
// 같은 module이 두 번 load돼도 먼저 설치된 reporter를 쓴다.
export const REPORTER_PORT = Symbol.for("lophn.cap-problem");

type Store = Record<symbol, unknown>;

// 진입점이 transport를 넣어 만든 reporter를 설치한다. 이미 설치돼 있으면 그대로 둔다.
export function installProblemReporter(reporter: ProblemReportCall): void {
  const store = globalThis as Store;
  if (typeof store[REPORTER_PORT] === "function") return;
  store[REPORTER_PORT] = reporter;
}

// 앱이 이름과 message로 보고한다. 진입점이 reporter를 설치하지 않았으면(단위 test·로컬 실행) 보내지
// 않고 실패 값을 돌려준다. 업무 흐름에 던지지 않는다.
function installedReporter(): ProblemReportCall | undefined {
  const installed = (globalThis as Store)[REPORTER_PORT];
  return typeof installed === "function"
    ? installed as ProblemReportCall
    : undefined;
}

export const reportProblem: ProblemReportCall = Object.assign(
  (
    name: string,
    message: string,
    details?: SafeReportDetails,
  ): ReportProblemResult => {
    const installed = installedReporter();
    if (installed) return installed(name, message, details);
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
  },
  {
    retransmit(reportId: string, details?: SafeReportDetails) {
      return installedReporter()?.retransmit?.(reportId, details) ?? null;
    },
  },
);
