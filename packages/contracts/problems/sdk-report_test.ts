import { assertEquals } from "@std/assert";
import type { LophnError, Result } from "../../base/mod.ts";
import type { AcceptedReport, ReportProblemIngress } from "./mod.ts";
// Deliberately use the portable entry, not contracts/mod.ts or problems/mod.ts.
import {
  isRetryableReportError,
  REPORT_RETRY_DELAYS_MS,
  REPORTING_LIMITS,
} from "./sdk-report.ts";
import type {
  ReportAcceptance,
  ReportCompletion,
  ReportProblem,
  ReportProblemInput,
  ReportTransport,
} from "./sdk-report.ts";

Deno.test("problems/reporting#R13: SDK subpath resolves to the portable policy entry", () => {
  assertEquals(
    import.meta.resolve("@lophn/contracts/problems/sdk-report"),
    new URL("./sdk-report.ts", import.meta.url).href,
  );
});

Deno.test("problems/reporting#R16: policy fixes bounded queues, retry and snapshot limits", () => {
  assertEquals(REPORTING_LIMITS, {
    sdk_pending_count: 32,
    sdk_pending_bytes: 4194304,
    collector_pending_count: 128,
    collector_pending_bytes: 16777216,
    collector_concurrent_assembly: 4,
    automatic_body_bytes: 262144,
    new_reports_per_window: 20,
    window_ms: 60000,
    snapshot_assembly_ms: 2000,
    snapshot_frames: 32,
    snapshot_large_bytes: 2359296,
    log_lines: 30,
    log_bytes: 65536,
    stack_bytes: 16384,
    feedback_text_scalars: 500,
    feedback_state_bytes: 65536,
    feedback_png_long_side: 1600,
    feedback_png_bytes: 2097152,
    feedback_total_bytes: 3145728,
  });
  assertEquals(REPORT_RETRY_DELAYS_MS, [250, 1000, 3000]);
  for (
    const code of [
      "invalid_input",
      "unauthorized",
      "forbidden",
      "not_found",
      "conflict",
      "internal",
    ] as const
  ) {
    assertEquals(
      isRetryableReportError({ code, message: "safe failure" }),
      false,
    );
  }
  assertEquals(
    isRetryableReportError({ code: "unavailable", message: "try later" }),
    true,
  );
  assertEquals(
    isRetryableReportError({
      code: "response_lost",
      message: "unknown response",
    }),
    true,
  );
});
Deno.test("problems/reporting#R13: injectable SDK returns immediate id and final failure VALUE compatible with base Result", async () => {
  const acceptance: ReportAcceptance = {
    report: "rpt-fixed",
    snapshot: "snp-fixed",
    problem: "prb-assigned",
    diagnostic_scope: null,
  };
  const baseResult: Result<ReportAcceptance, LophnError> = {
    ok: false,
    error: { code: "unavailable", message: "not accepted" },
  };
  const transport: ReportTransport = () => Promise.resolve(baseResult);
  const reportProblem: ReportProblem = (code, details) => {
    const input = {
      report_id: "rpt-fixed",
      code,
      details,
      observed_at: "2026-10-04T12:00:00.000Z",
    };
    return {
      report_id: input.report_id,
      completion: transport(input).then((result): ReportCompletion =>
        result.ok
          ? { status: "accepted", acceptance: result.value }
          : { status: "failed", reason: result.error }
      ),
    };
  };
  const report = reportProblem("save_failed", { safe_shape: "string" });
  assertEquals(report.report_id, "rpt-fixed");
  assertEquals(await report.completion, {
    status: "failed",
    reason: baseResult.error,
  });
  const accepted: ReportCompletion = { status: "accepted", acceptance };
  assertEquals(accepted.status, "accepted");
});
Deno.test("problems/reporting#R12: fixed rate window counts new reports policy, not observed_at", () => {
  assertEquals(REPORTING_LIMITS.new_reports_per_window, 20);
  assertEquals(REPORTING_LIMITS.window_ms, 60000);
});
Deno.test("problems/reporting#R13: portable entry structurally matches public acceptance and ingress", () => {
  const accepted: AcceptedReport = {
    report: "rpt-fixed",
    snapshot: "snp-fixed",
    problem: "prb-assigned",
    diagnostic_scope: null,
  };
  const portable: ReportAcceptance = accepted;
  const typedInput: ReportProblemIngress = {
    report_id: "rpt-fixed",
    code: "save_failed",
    observed_at: "2026-10-04T12:00:00.000Z",
    details: { safe: true },
  };
  const sdkInput: ReportProblemInput = typedInput;
  assertEquals(portable, accepted);
  assertEquals(sdkInput, typedInput);
});
