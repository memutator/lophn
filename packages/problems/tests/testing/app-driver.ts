import { createHash } from "node:crypto";
import type {
  AdapterEffects,
  AppDriver,
  HarnessPlan,
  ReceivedReport,
} from "../harness/driver.ts";

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
  | "failure_via_sdk_only"
  | "migration_empty_fails"
  | "migration_upgrade_fails"
  | "read_accepts_invalid_input"
  | "read_writes_business_data"
  | "read_changes_external_state"
  | "confirm_automation_allowed"
  | "external_automation_without_approval"
  | "external_automation_blocked"
  | "secret_needs_approval"
  | "secret_blocked_for_automation"
  | "secret_not_granted"
  | "real_host_contact"
  | "undeclared_double_target"
  | "revert_does_not_restore"
  | "revert_ignores_later_change"
  | "revert_twice_accepted";

export type FixtureDriverOptions = {
  bundle_hash: string;
  // command -> 실패를 주입하면 보고하는 선언 code.
  failure_commands: Record<string, string>;
  commands: string[];
  declared_codes: string[];
  has_view: boolean;
  omit?: readonly FixtureOmission[];
  // 앱 계약 검사 fixture. 없으면 계약 검사에 필요한 선언이 없는 앱이다.
  plan?: Pick<
    HarnessPlan,
    "command_details" | "automations" | "secrets" | "net" | "documents" | "data"
  >;
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
  const plan = options.plan;
  // 업무 데이터는 변경 목록 하나다. 되돌림은 그 변경을 목록에서 뺀다.
  const changes: { id: string; command: string }[] = [];
  const reverted = new Set<string>();
  let externalEffects = 0;
  const state = () =>
    createHash("sha256").update(JSON.stringify(changes)).digest("hex");
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
    migrate(scenario) {
      const target = plan?.data.schema ?? 0;
      const from = scenario === "empty" ? 0 : plan?.data.previous_schema ?? 0;
      const failed = omit.has(
        scenario === "empty"
          ? "migration_empty_fails"
          : "migration_upgrade_fails",
      );
      return Promise.resolve({
        ok: !failed,
        from_schema: from,
        data_schema: failed ? from : target,
        integrity_ok: true,
        restored: failed,
        reason: failed ? "migration step failed" : "migrated",
      });
    },
    probeRead(command) {
      const before = state();
      if (omit.has("read_writes_business_data")) {
        changes.push({ id: `chg_${++counter}`, command });
      }
      if (omit.has("read_changes_external_state")) externalEffects += 1;
      return Promise.resolve({
        invalid_input_rejected: !omit.has("read_accepts_invalid_input"),
        business_before: before,
        business_after: state(),
        external_effects: externalEffects,
      });
    },
    runAutomation(key, approval) {
      const task = plan?.automations.find((item) => item.key === key);
      const command = plan?.command_details.find((item) =>
        item.key === task?.command
      );
      if (command?.effect === "external") {
        const ran = omit.has("external_automation_without_approval")
          ? true
          : approval === "once" && !omit.has("external_automation_blocked");
        return Promise.resolve({
          ran,
          approvals_used: ran && approval === "once" ? 1 : 0,
          reason: ran ? "ran" : "approval required",
        });
      }
      return Promise.resolve({ ran: true, approvals_used: 0, reason: "ran" });
    },
    attemptConfirmAutomation() {
      const allowed = omit.has("confirm_automation_allowed");
      return Promise.resolve({
        refused: !allowed,
        reason: allowed ? "ran" : "confirm commands cannot be automated",
      });
    },
    useSecret(input) {
      const blocked = omit.has("secret_not_granted") ||
        (omit.has("secret_blocked_for_automation") &&
          input.caller === "automation");
      return Promise.resolve({
        allowed: !blocked,
        approvals_requested: omit.has("secret_needs_approval") ? 1 : 0,
      });
    },
    exerciseAdapters() {
      const effects: AdapterEffects = {
        net: (plan?.net ?? []).map(({ host, port }) => ({ host, port })),
        secret_uses: (plan?.secrets ?? []).map((name) => ({ name })),
        document_writes: (plan?.documents ?? []).map((key) => ({ key })),
        real_connections: omit.has("real_host_contact")
          ? ["api.example.com:443"]
          : [],
      };
      if (omit.has("undeclared_double_target")) {
        effects.net.push({ host: "undeclared.example.net", port: 443 });
      }
      return Promise.resolve(effects);
    },
    businessState() {
      return Promise.resolve(state());
    },
    prepareChange() {
      return Promise.resolve();
    },
    change(command) {
      const id = `chg_${++counter}`;
      changes.push({ id, command });
      return Promise.resolve({ ok: true, revert: id, state_after: state() });
    },
    revert(token) {
      const index = changes.findIndex((item) => item.id === token);
      if (reverted.has(token) && !omit.has("revert_twice_accepted")) {
        return Promise.resolve({
          ok: false,
          code: "already_reverted",
          state_after: state(),
        });
      }
      if (index < 0) {
        return Promise.resolve({
          ok: omit.has("revert_twice_accepted"),
          code: omit.has("revert_twice_accepted") ? null : "already_reverted",
          state_after: state(),
        });
      }
      if (
        index < changes.length - 1 && !omit.has("revert_ignores_later_change")
      ) {
        return Promise.resolve({
          ok: false,
          code: "conflict",
          state_after: state(),
        });
      }
      reverted.add(token);
      if (!omit.has("revert_does_not_restore")) changes.splice(index, 1);
      return Promise.resolve({ ok: true, code: null, state_after: state() });
    },
  };
}
