// 앱 bundle에 들어가는 portable file이다. zod와 core를 import하지 않고 type과 상수만 둔다.
import type {
  ObservationInvocationEvidence,
  ReportCompletion,
  ReportProblemResult,
  SafeReportDetails,
} from "./sdk-report.ts";

export interface ProblemReportCall {
  (
    name: string,
    message: string,
    details?: SafeReportDetails,
  ): ReportProblemResult;
  // 같은 report id의 고정 발생을 다시 보낸다. details를 넘기면 그 본문만 바꾼 재전송이다.
  retransmit?(
    reportId: string,
    details?: SafeReportDetails,
  ): Promise<ReportCompletion> | null;
}

export type ProblemReportRequest = {
  report_id: string;
  name: string;
  message: string;
  observed_at: string;
  details?: SafeReportDetails;
  invocation?: ObservationInvocationEvidence | null;
};
