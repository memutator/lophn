// runtime-facing 자리다. 앱 프로세스 안에서 도는 clock(플랫폼 진입 파일)만 내보내며 Zod를 끌어오지
// 않는다. ledger read(`reads.ts`)와 supervisor의 permit(`permits.ts`)은 core·supervisor 조립이 직접
// 부른다. core graph에는 clock이 들어오지 않는다.
export {
  type Acquire,
  type AutomationClock,
  type AutomationPorts,
  type AutomationSpec,
  type AutomationStatus,
  type AutomationWhen,
  CHECK_INTERVAL_MS,
  createAutomationClock,
  DEFAULT_TIMEOUT_MS,
  LATE_TOLERANCE_MS,
  MIN_INTERVAL_MS,
  type Prepared,
  type SkipReason,
  type Started,
} from "./clock.ts";
