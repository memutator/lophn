// 앱 bundle에 들어가는 portable file이다. zod와 core를 import하지 않고 type과 상수만 둔다.
import type { SafeReportDetails } from "./sdk-report.ts";

export type ProblemReportCall = (
  name: string,
  message?: string,
  details?: SafeReportDetails,
) => void;
