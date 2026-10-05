import type { AppDriver, ReceivedReport } from "../harness/driver.ts";

// 보고 경로를 갖춘 앱을 흉내 내는 test용 driver. omit에 든 경로는 일부러
// 뺀다. 각 경로를 하나씩 뺀 fixture가 통과하지 못하는지 확인하는 데 쓴다.
export type FixtureOmission =
  | "sdk_receipt"
  | "process_exception"
  | "redaction"
  | "permission_denial"
  | "view_exception"
  | "feedback"
  | "view_host"
  | "dynamic_guard"
  | "handler"
  | "failure_report"
  | "failure_via_sdk_only";

export type FixtureDriverOptions = {
  bundle_hash: string;
  // command -> 실패를 주입하면 보고하는 선언 code.
  failure_commands: Record<string, string>;
  commands: string[];
  declared_codes: string[];
  has_view: boolean;
  omit?: readonly FixtureOmission[];
};

export function fixtureDriver(options: FixtureDriverOptions): AppDriver {
  const omit = new Set(options.omit ?? []);
  let counter = 0;
  const report = (
    code: string,
    invocation: string | null,
    stored = "",
  ): ReceivedReport => ({
    report_id: `rpt_${++counter}`,
    code,
    invocation_id: invocation,
    stored,
  });
  const reserved = (code: string) => code.startsWith("_");
  return {
    probe() {
      return Promise.resolve({
        bundle_hash: options.bundle_hash,
        commands: omit.has("handler")
          ? options.commands.slice(1)
          : options.commands,
        data_schema: 1,
        process_nonce: "nonce-1",
      });
    },
    invoke(command, _input, inject) {
      const invocation = `inv_${++counter}`;
      const code = options.failure_commands[command];
      const reports: ReceivedReport[] = [];
      if (inject?.inject_failure && code) {
        if (omit.has("failure_via_sdk_only")) {
          // 앱 command는 보고하지 않고 test가 SDK를 따로 부른 것과 같다.
          reports.push(report(code, null));
        } else if (!omit.has("failure_report")) {
          reports.push(report(code, invocation));
        }
      }
      return Promise.resolve({
        invocation_id: invocation,
        outcome: inject?.inject_failure ? "error" : "ok",
        reports,
      });
    },
    reportDirect(code) {
      const allowed = omit.has("dynamic_guard") ||
        (!reserved(code) && options.declared_codes.includes(code));
      return Promise.resolve({
        accepted: allowed,
        reason: allowed ? "accepted" : "rejected",
        report: allowed ? report(code, null) : null,
      });
    },
    sdkReceipt() {
      const accepted = !omit.has("sdk_receipt");
      return Promise.resolve({
        accepted,
        reason: accepted ? "accepted" : "completion not accepted",
        report: accepted
          ? report(options.declared_codes[0] ?? "diag", null)
          : null,
      });
    },
    throwUnhandled() {
      return Promise.resolve(
        omit.has("process_exception") ? [] : [report("_exception", null)],
      );
    },
    reportWithSecret(secret) {
      return Promise.resolve({
        accepted: true,
        reason: "accepted",
        report: report(
          options.declared_codes[0] ?? "diag",
          null,
          omit.has("redaction") ? `leak ${secret}` : "leak [redacted]",
        ),
      });
    },
    attemptDenied() {
      const denied = !omit.has("permission_denial");
      return Promise.resolve({
        denied,
        reason: denied ? "denied" : "allowed",
      });
    },
    view: options.has_view && !omit.has("view_host")
      ? {
        exception: () =>
          Promise.resolve(
            omit.has("view_exception") ? [] : [report("_exception", null)],
          ),
        feedback: () =>
          Promise.resolve(
            omit.has("feedback") ? [] : [report("_feedback", null)],
          ),
      }
      : null,
  };
}
