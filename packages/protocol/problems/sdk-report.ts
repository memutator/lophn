import type { LophnError, Result } from "../../base/mod.ts";

// Portable policy entry: no schema runtime or contracts root in an app bundle.
export const REPORTING_LIMITS = {
  sdk_pending_count: 32,
  sdk_pending_bytes: 4_194_304,
  collector_pending_count: 128,
  collector_pending_bytes: 16_777_216,
  collector_concurrent_assembly: 4,
  automatic_body_bytes: 262_144,
  new_reports_per_window: 20,
  window_ms: 60_000,
  snapshot_assembly_ms: 2_000,
  snapshot_frames: 32,
  snapshot_large_bytes: 2_359_296,
  log_lines: 30,
  log_bytes: 65_536,
  stack_bytes: 16_384,
  feedback_text_scalars: 500,
  feedback_state_bytes: 65_536,
  feedback_png_long_side: 1_600,
  feedback_png_bytes: 2_097_152,
  feedback_total_bytes: 3_145_728,
} as const;
export const REPORT_RETRY_DELAYS_MS = [250, 1_000, 3_000] as const;
export type ReportTransportError = LophnError | {
  code: "response_lost";
  message: string;
};
export function isRetryableReportError(error: ReportTransportError): boolean {
  return error.code === "unavailable" || error.code === "response_lost";
}
export type ReportAcceptance =
  & {
    report: string;
    snapshot: string;
  }
  & ({ problem: string; diagnostic_scope: null } | {
    problem: null;
    diagnostic_scope: string;
  });
export type ReportCompletion =
  | { status: "accepted"; acceptance: ReportAcceptance }
  | { status: "failed"; reason: ReportTransportError };
export type ReportStatus = { status: "pending" } | ReportCompletion;
export type ReportProblemResult = {
  report_id: string;
  // Implementations resolve a final VALUE; never reject on transport failure.
  completion: Promise<ReportCompletion>;
};
export type SafeReportDetails =
  | null
  | boolean
  | number
  | string
  | SafeReportDetails[]
  | { [key: string]: SafeReportDetails };
export interface ReportProblem {
  (code: string, details?: SafeReportDetails): ReportProblemResult;
  // 같은 report id의 고정 발생을 다시 보낸다. details를 넘기면 그 본문만 바꾼 재전송이다.
  retransmit?(
    reportId: string,
    details?: SafeReportDetails,
  ): Promise<ReportCompletion> | null;
}
export type ObservationMissingReason = { reason: string };
export type ObservationInvocationEvidence = {
  id: string;
  record_missing_reason: ObservationMissingReason | null;
};
export type ReportProblemInput = {
  report_id: string;
  code: string;
  observed_at: string;
  text?: string;
  details?: SafeReportDetails;
  invocation?: ObservationInvocationEvidence | null;
};
// Retry resends this same frozen input; no command rerun or snapshot assembly.
export type ReportTransport<I = ReportProblemInput> = (
  input: Readonly<I>,
) => Promise<Result<ReportAcceptance, ReportTransportError>>;
export type ExceptionObservationKind =
  | "error"
  | "unhandledrejection"
  | "render_error"
  | "process_exit";
// Raw strings are ephemeral authenticated collector input, never stored output.
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
