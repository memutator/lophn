import type { LophnError, Result } from "../../base/mod.ts";

// Portable policy entry: no schema runtime or contracts root in an app bundle.
export const REPORTING_LIMITS = {
  sdk_pending_count: 32,
  sdk_pending_bytes: 4_194_304,
  automatic_body_bytes: 262_144,
} as const;
export const REPORT_RETRY_DELAYS_MS = [250, 1_000, 3_000] as const;
export type ReportTransportError = LophnError | {
  code: "response_lost";
  message: string;
};
export function isRetryableReportError(error: ReportTransportError): boolean {
  return error.code === "unavailable" || error.code === "response_lost";
}
// 앱 log에 줄을 썼다는 broker 응답이다.
export type ReportAcceptance = { written: true };
export type ReportCompletion =
  | { status: "accepted"; acceptance: ReportAcceptance }
  | { status: "failed"; reason: ReportTransportError };
export type SafeReportDetails =
  | null
  | boolean
  | number
  | string
  | SafeReportDetails[]
  | { [key: string]: SafeReportDetails };
export type ObservationMissingReason = { reason: string };
export type ObservationInvocationEvidence = {
  id: string;
  record_missing_reason: ObservationMissingReason | null;
};
// Retry resends this same frozen input; no command rerun.
export type ReportTransport<I> = (
  input: Readonly<I>,
) => Promise<Result<ReportAcceptance, ReportTransportError>>;
export type ExceptionObservationKind =
  | "error"
  | "unhandledrejection"
  | "render_error"
  | "process_exit";
// Raw strings are ephemeral authenticated app log input, never stored output.
export type ExceptionObservationError = {
  name: string;
  message: string | null;
  message_missing_reason: ObservationMissingReason | null;
  stack: string | null;
  stack_missing_reason: ObservationMissingReason | null;
};
export type ExceptionObservationInput = {
  report_id: string;
  observed_at: string;
  observation: ExceptionObservationKind;
  error: ExceptionObservationError | null;
  error_missing_reason: ObservationMissingReason | null;
  invocation: ObservationInvocationEvidence | null;
};
export type ExceptionObserverTransport<I = ExceptionObservationInput> =
  ReportTransport<I>;
// Observers do not preventDefault or turn the original failure into success.
export type InstallExceptionObserver<I = ExceptionObservationInput> = (
  transport: ExceptionObserverTransport<I>,
) => () => void;
