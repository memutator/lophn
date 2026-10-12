import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  failurePathName,
  isFailurePathName,
  REDACTION_CANARY,
  UNDECLARED_PROBE_CODE,
  VIEW_HOST_INCONCLUSIVE,
} from "./definitions.ts";
import {
  type AppDriver,
  type HarnessPlan,
  type HarnessPlanCheck,
  type MigrationScenario,
  type ReceivedReport,
  ViewHostInconclusive,
} from "./driver.ts";
import type { Emitter } from "./emit.ts";
import { scanCodeUsage, type SourceFile } from "./source-scan.ts";

// 고정 기준과 따로 관측한 인접 불변식.
export type AdjacentInvariant = { name: string; held: boolean };

type Verdict = {
  met: boolean;
  reason: string;
  evidence: Record<string, unknown>;
  adjacent?: AdjacentInvariant[];
};

const RESERVED = "_exception";
const FEEDBACK = "_feedback";

function has(reports: readonly ReceivedReport[], code: string): boolean {
  return reports.some((report) => report.code === code);
}

async function blueprintHandlerMatch(
  driver: AppDriver,
  plan: HarnessPlan,
): Promise<Verdict> {
  const attestation = await driver.probe();
  const declared = [...plan.commands].sort();
  const registered = [...attestation.commands].sort();
  const same = declared.length === registered.length &&
    declared.every((key, index) => key === registered[index]);
  const bundle = attestation.bundle_hash === plan.bundle_hash;
  const nonce = attestation.process_nonce !== "";
  return {
    met: same && bundle && nonce,
    reason: !bundle
      ? "준비 attestation의 bundle hash가 고정 bundle과 다르다"
      : !same
      ? "blueprint 선언 command와 실제 등록 handler가 다르다"
      : !nonce
      ? "준비 attestation에 process nonce가 없다"
      : "선언 command와 등록 handler가 일치한다",
    evidence: {
      declared,
      registered,
      bundle_hash: attestation.bundle_hash,
      data_schema: attestation.data_schema,
    },
  };
}

function codeUsageStatic(
  plan: HarnessPlan,
  sources: readonly SourceFile[],
): Verdict {
  const usage = scanCodeUsage(sources);
  const declared = new Set(plan.declared_codes);
  const undeclared = usage.literals.filter((use) => !declared.has(use.code));
  const reserved = usage.literals.filter((use) => use.code.startsWith("_"));
  const bad = [...new Set([...undeclared, ...reserved])];
  // dynamic code는 정적으로 확정할 수 없다. 별도 필수 dynamic guard 검사가
  // 선언 밖·예약 code를 거절해야만 app test 전체가 통과한다.
  const met = bad.length === 0;
  return {
    met,
    reason: bad.length > 0
      ? "선언하지 않았거나 예약된 code를 source가 보고한다"
      : usage.dynamic.length > 0
      ? "dynamic code 사용 자리를 기록하고 필수 dynamic guard 검사에서 거절을 확인한다"
      : "source가 보고하는 code는 모두 선언한 code다",
    evidence: {
      used: [...new Set(usage.literals.map((use) => use.code))].sort(),
      undeclared: bad.map((use) => use.code).sort(),
      dynamic_sites: usage.dynamic.length,
    },
  };
}

async function codeUsageDynamic(driver: AppDriver): Promise<Verdict> {
  const undeclared = await driver.reportDirect(UNDECLARED_PROBE_CODE);
  const reserved = await driver.reportDirect(RESERVED);
  const met = !undeclared.accepted && !reserved.accepted;
  return {
    met,
    reason: met
      ? "선언 없는 code와 예약 code의 직접 보고가 거절된다"
      : "선언 없는 code나 예약 code의 직접 보고가 접수된다",
    evidence: {
      undeclared_rejected: !undeclared.accepted,
      reserved_rejected: !reserved.accepted,
    },
  };
}

async function sdkReceipt(driver: AppDriver): Promise<Verdict> {
  const result = await driver.sdkReceipt();
  const met = result.accepted && result.report !== null;
  return {
    met,
    reason: met
      ? "SDK completion을 기다려 실제 접수를 확인했다"
      : "SDK 보고의 접수를 확인하지 못했다",
    evidence: {
      accepted: result.accepted,
      received: result.report !== null,
      report_id: result.report?.report_id ?? null,
    },
  };
}

async function processException(driver: AppDriver): Promise<Verdict> {
  const reports = await driver.throwUnhandled();
  const met = has(reports, RESERVED);
  return {
    met,
    reason: met
      ? "처리되지 않은 process 예외가 예약 code로 접수된다"
      : "처리되지 않은 process 예외가 접수되지 않았다",
    evidence: { reports: reports.map((report) => report.code) },
  };
}

async function redaction(driver: AppDriver): Promise<Verdict> {
  const result = await driver.reportWithSecret(REDACTION_CANARY);
  const stored = result.report?.stored ?? null;
  const met = result.accepted && stored !== null &&
    !stored.includes(REDACTION_CANARY);
  return {
    met,
    reason: met
      ? "저장 전 redaction이 canary를 지웠다"
      : stored === null
      ? "redaction을 확인할 보고가 접수되지 않았다"
      : "저장되는 보고에 canary가 그대로 남는다",
    evidence: {
      accepted: result.accepted,
      canary_stored: stored === null ? null : stored.includes(REDACTION_CANARY),
    },
  };
}

async function permissionDenial(driver: AppDriver): Promise<Verdict> {
  const result = await driver.attemptDenied();
  return {
    met: result.denied,
    reason: result.denied
      ? "grant 없는 접근이 거절된다"
      : "grant 없는 접근이 거절되지 않았다",
    evidence: { denied: result.denied },
  };
}

async function viewCheck(
  driver: AppDriver,
  kind: "exception" | "feedback",
): Promise<Verdict> {
  if (!driver.view) {
    return {
      met: false,
      reason: "화면 검사를 띄울 수 없어 화면 있는 bundle을 확인하지 못했다",
      evidence: { view_host: false },
    };
  }
  const reports = kind === "exception"
    ? await driver.view.exception()
    : await driver.view.feedback();
  const code = kind === "exception" ? RESERVED : FEEDBACK;
  const met = has(reports, code);
  return {
    met,
    reason: met
      ? kind === "exception"
        ? "view 예외가 예약 code로 접수된다"
        : "깨진 view의 feedback이 예약 code로 접수된다"
      : kind === "exception"
      ? "view 예외가 접수되지 않았다"
      : "feedback이 접수되지 않았다",
    evidence: { reports: reports.map((report) => report.code) },
  };
}

async function migration(
  driver: AppDriver,
  plan: HarnessPlan,
  scenario: MigrationScenario,
): Promise<Verdict> {
  const run = await driver.migrate(scenario);
  const from = scenario === "empty" ? 0 : plan.data.previous_schema;
  const met = run.ok && run.data_schema === plan.data.schema &&
    run.integrity_ok && !run.restored && run.from_schema === from;
  const label = scenario === "empty"
    ? "빈 test DB 전체 migration"
    : "이전 release schema에서 새 schema로의 migration";
  return {
    met,
    reason: met
      ? `${label}이 새 schema까지 적용되고 무결성이 확인됐다`
      : run.restored
      ? `${label}이 중간에 실패해 첫 변경 전 상태로 되돌려졌다`
      : `${label}이 통과하지 못했다`,
    evidence: {
      scenario,
      from_schema: run.from_schema,
      expected_from_schema: from,
      data_schema: run.data_schema,
      target_schema: plan.data.schema,
      integrity_ok: run.integrity_ok,
      restored: run.restored,
    },
  };
}

async function readContract(
  driver: AppDriver,
  plan: HarnessPlan,
): Promise<Verdict> {
  const rows = [];
  for (const command of plan.command_details) {
    if (command.effect !== "read") continue;
    const probe = await driver.probeRead(command.key);
    rows.push({
      command: command.key,
      invalid_input_rejected: probe.invalid_input_rejected,
      business_unchanged: probe.business_before === probe.business_after,
      external_effects: probe.external_effects,
    });
  }
  const met = rows.length > 0 &&
    rows.every((row) => row.invalid_input_rejected && row.business_unchanged);
  const external = rows.every((row) => row.external_effects === 0);
  return {
    met: met && external,
    reason: !rows.every((row) => row.invalid_input_rejected)
      ? "입력 계약을 어긴 입력이 거절되지 않는 read command가 있다"
      : !rows.every((row) => row.business_unchanged)
      ? "read command가 업무 데이터를 바꾼다"
      : !external
      ? "read command가 외부 상태를 바꾼다"
      : "read command는 잘못된 입력을 거절하고 업무·외부 상태를 바꾸지 않는다",
    evidence: { commands: rows },
    adjacent: [{ name: "external_state_unchanged", held: external }],
  };
}

async function automationScope(
  driver: AppDriver,
  plan: HarnessPlan,
): Promise<Verdict> {
  const details = new Map(plan.command_details.map((c) => [c.key, c]));
  const automations = [];
  for (const automation of plan.automations) {
    const command = details.get(automation.command);
    if (!command || command.confirm) {
      automations.push({
        key: automation.key,
        command: automation.command,
        ok: false,
        why: !command ? "undeclared_command" : "confirm_command",
      });
      continue;
    }
    const without = await driver.runAutomation(automation.key, "none");
    if (command.effect === "external") {
      const once = await driver.runAutomation(automation.key, "once");
      automations.push({
        key: automation.key,
        command: automation.command,
        ok: !without.ran && once.ran && once.approvals_used === 1,
        why: without.ran
          ? "ran_without_approval"
          : !once.ran
          ? "blocked_after_approval"
          : once.approvals_used !== 1
          ? "approval_not_once"
          : "approved_once",
      });
    } else {
      automations.push({
        key: automation.key,
        command: automation.command,
        ok: without.ran && without.approvals_used === 0,
        why: without.ran ? "ran" : "blocked",
      });
    }
  }
  const confirms = [];
  for (const command of plan.command_details) {
    if (!command.confirm) continue;
    const attempt = await driver.attemptConfirmAutomation(command.key);
    confirms.push({ command: command.key, refused: attempt.refused });
  }
  const met = automations.every((item) => item.ok) &&
    confirms.every((item) => item.refused);
  return {
    met,
    reason: automations.some((item) => item.why === "confirm_command")
      ? "confirm command를 automation으로 선언했다"
      : confirms.some((item) => !item.refused)
      ? "confirm command가 automation으로 실행된다"
      : !met
      ? "automation이 선언한 범위와 승인 규칙을 따르지 않는다"
      : "automation은 선언한 command를 고정 입력으로 실행하고 external은 한 번 승인한 것만 실행한다",
    evidence: { automations, confirm_commands: confirms },
  };
}

const SECRET_OPERATIONS = ["import", "write", "sync"] as const;

async function secretGrant(
  driver: AppDriver,
  plan: HarnessPlan,
): Promise<Verdict> {
  const rows = [];
  for (const name of plan.secrets) {
    for (const operation of SECRET_OPERATIONS) {
      for (const caller of ["command", "automation"] as const) {
        const used = await driver.useSecret({ name, operation, caller });
        rows.push({
          operation,
          caller,
          allowed: used.allowed,
          approvals_requested: used.approvals_requested,
        });
      }
    }
  }
  const blocked = rows.filter((row) => !row.allowed);
  const asked = rows.filter((row) => row.approvals_requested > 0);
  const met = rows.length > 0 && blocked.length === 0 && asked.length === 0;
  return {
    met,
    reason: blocked.some((row) => row.caller === "automation")
      ? "grant된 secret을 automation이라는 이유로 막는다"
      : blocked.length > 0
      ? "grant된 secret의 사용이 허용되지 않는다"
      : asked.length > 0
      ? "grant된 secret의 호출마다 approval을 요구한다"
      : "grant된 secret의 가져오기·쓰기·동기화가 대역에서 허용된다",
    evidence: {
      secrets: plan.secrets.length,
      attempts: rows.length,
      blocked: blocked.length,
      approvals_requested: asked.length,
    },
  };
}

async function adapterIsolation(
  driver: AppDriver,
  plan: HarnessPlan,
): Promise<Verdict> {
  const effects = await driver.exerciseAdapters();
  const real = effects.real_connections;
  const netOk = effects.net.every((request) =>
    plan.net.some((entry) =>
      entry.host === request.host && entry.port === request.port
    )
  );
  const secretOk = effects.secret_uses.every((use) =>
    plan.secrets.includes(use.name)
  );
  const documentOk = effects.document_writes.every((write) =>
    plan.documents.includes(write.key)
  );
  const met = real.length === 0;
  const declared = netOk && secretOk && documentOk;
  return {
    met: met && declared,
    reason: !met
      ? "대역 밖의 실제 외부 host에 접속했다"
      : !declared
      ? "대역이 선언하지 않은 목적지의 요청을 받았다"
      : "net·secret·문서 쓰기가 고정 대역에만 닿고 실제 외부 접속이 없다",
    evidence: {
      net_requests: effects.net.length,
      secret_uses: effects.secret_uses.length,
      document_writes: effects.document_writes.length,
      real_connections: real.length,
    },
    adjacent: [{
      name: "doubles_received_declared_targets_only",
      held: declared,
    }],
  };
}

function revertCommands(plan: HarnessPlan): string[] {
  return plan.command_details.filter((command) =>
    command.effect === "write" && command.revert.supported
  ).map((command) => command.key);
}

async function revertCheck(
  driver: AppDriver,
  plan: HarnessPlan,
  kind: "restore" | "conflict" | "duplicate",
): Promise<Verdict> {
  const rows = [];
  for (const command of revertCommands(plan)) {
    let ok = false;
    let why = "";
    if (kind === "restore") {
      await driver.prepareChange(command);
      const before = await driver.businessState();
      const change = await driver.change(command);
      const reverted = change.revert === null
        ? null
        : await driver.revert(change.revert);
      const after = await driver.businessState();
      ok = change.ok && change.revert !== null &&
        change.state_after !== before && reverted?.ok === true &&
        after === before;
      why = !change.ok || change.revert === null
        ? "no_revert_material"
        : change.state_after === before
        ? "change_had_no_effect"
        : reverted?.ok !== true
        ? "revert_refused"
        : after !== before
        ? "state_not_restored"
        : "restored";
    } else if (kind === "conflict") {
      const first = await driver.change(command);
      await driver.change(command);
      const before = await driver.businessState();
      const reverted = first.revert === null
        ? null
        : await driver.revert(first.revert);
      const after = await driver.businessState();
      ok = first.revert !== null && reverted?.ok === false &&
        reverted.code === "conflict" && after === before;
      why = first.revert === null
        ? "no_revert_material"
        : reverted?.ok === true
        ? "reverted_over_later_change"
        : reverted?.code !== "conflict"
        ? "not_a_conflict"
        : after !== before
        ? "state_changed"
        : "conflict";
    } else {
      const change = await driver.change(command);
      const first = change.revert === null
        ? null
        : await driver.revert(change.revert);
      const before = await driver.businessState();
      const second = change.revert === null
        ? null
        : await driver.revert(change.revert);
      const after = await driver.businessState();
      ok = first?.ok === true && second?.ok === false && after === before;
      why = first?.ok !== true
        ? "first_revert_failed"
        : second?.ok === true
        ? "duplicate_accepted"
        : after !== before
        ? "state_changed"
        : "refused";
    }
    rows.push({ command, ok, why });
  }
  const met = rows.length > 0 && rows.every((row) => row.ok);
  const reasons = {
    restore: [
      "변경을 되돌리면 원래 업무 상태로 돌아온다",
      "되돌려도 원래 업무 상태로 돌아오지 않는 command가 있다",
    ],
    conflict: [
      "후속 변경 뒤의 되돌림이 conflict로 거절된다",
      "후속 변경 뒤의 되돌림이 conflict로 거절되지 않는 command가 있다",
    ],
    duplicate: [
      "중복 되돌림이 거절된다",
      "중복 되돌림이 거절되지 않는 command가 있다",
    ],
  }[kind];
  return {
    met,
    reason: met ? reasons[0] : reasons[1],
    evidence: { commands: rows },
  };
}

export type ChecksInput = {
  driver: AppDriver;
  plan: HarnessPlan;
  emitter: Emitter;
  sources: readonly SourceFile[];
};

function frame(check: HarnessPlanCheck, verdict: Verdict, emitter: Emitter) {
  return emitter.emit({
    name: check.name,
    actual: {
      check_digest: check.digest,
      ...verdict.evidence,
      ...(verdict.adjacent ? { adjacent: verdict.adjacent } : {}),
    },
    expectation_met: verdict.met,
    reason: verdict.reason,
  });
}

// 플랫폼 필수 검사를 실제로 돌려 검사마다 관측 frame 하나를 낸다. 화면 없는
// bundle의 화면 검사처럼 계획이 not_applicable로 둔 검사는 돌리지 않는다.
// 선언 code별 실패 경로는 앱이 쓴 test가 observeFailurePath로 낸다.
export async function runPlatformChecks(
  input: ChecksInput,
): Promise<Result<number>> {
  let count = 0;
  for (const check of input.plan.checks) {
    if (check.source !== "harness" || check.kind !== "platform") continue;
    if (check.status === "not_applicable") continue;
    let verdict: Verdict;
    try {
      verdict = await run(check.name, input);
    } catch (cause) {
      verdict = cause instanceof ViewHostInconclusive
        ? {
          met: false,
          reason: `화면 검사 host가 판정하지 못했다: ${cause.reason}`,
          evidence: { view_host: VIEW_HOST_INCONCLUSIVE },
        }
        : {
          met: false,
          reason: `검사가 실행 중 실패했다: ${
            cause instanceof Error ? cause.name : "error"
          }`,
          evidence: {},
        };
    }
    const sent = frame(check, verdict, input.emitter);
    if (!sent.ok) return sent;
    count += 1;
  }
  return ok(count);
}

function run(name: string, input: ChecksInput): Promise<Verdict> {
  const { driver, plan, sources } = input;
  switch (name) {
    case "blueprint_handler_match":
      return blueprintHandlerMatch(driver, plan);
    case "code_usage_static":
      return Promise.resolve(codeUsageStatic(plan, sources));
    case "code_usage_dynamic":
      return codeUsageDynamic(driver);
    case "sdk_receipt":
      return sdkReceipt(driver);
    case "process_exception":
      return processException(driver);
    case "redaction":
      return redaction(driver);
    case "permission_denial":
      return permissionDenial(driver);
    case "view_exception":
      return viewCheck(driver, "exception");
    case "feedback":
      return viewCheck(driver, "feedback");
    case "migration_empty":
      return migration(driver, plan, "empty");
    case "migration_upgrade":
      return migration(driver, plan, "upgrade");
    case "read_contract":
      return readContract(driver, plan);
    case "automation_scope":
      return automationScope(driver, plan);
    case "secret_grant":
      return secretGrant(driver, plan);
    case "adapter_isolation":
      return adapterIsolation(driver, plan);
    case "revert_restore":
      return revertCheck(driver, plan, "restore");
    case "revert_conflict":
      return revertCheck(driver, plan, "conflict");
    case "revert_duplicate":
      return revertCheck(driver, plan, "duplicate");
    default:
      return Promise.reject(new Error("unknown check"));
  }
}

// 앱이 쓴 실패 경로 test가 부르는 도우미. 실제 앱 command에 fixture 실패를
// 주입하고, 그 호출 안에서 선언 code의 보고가 접수됐을 때만 통과한다. 호출
// 밖에서 SDK를 직접 부른 보고는 이 호출의 근거가 아니다.
export async function observeFailurePath(input: {
  driver: AppDriver;
  plan: HarnessPlan;
  emitter: Emitter;
  code: string;
  command: string;
  command_input: unknown;
  // 실패를 어디에 주입하는지. 기본은 환경(저장소)이고 `none`은 입력만으로 실패가 난다.
  fault?: "store" | "net" | "none";
}): Promise<Result<boolean>> {
  const name = failurePathName(input.code);
  const check = input.plan.checks.find((item) => item.name === name);
  if (!check || !isFailurePathName(check.name)) {
    return err({ code: "invalid_input", message: "선언하지 않은 실패 경로다" });
  }
  if (!input.plan.commands.includes(input.command)) {
    return err({ code: "invalid_input", message: "선언하지 않은 command다" });
  }
  const invoked = await input.driver.invoke(
    input.command,
    input.command_input,
    { inject_failure: input.fault !== "none", fault: input.fault ?? "store" },
  );
  const via = invoked.reports.find((report) =>
    report.code === input.code && report.invocation_id === invoked.invocation_id
  );
  const direct = invoked.reports.some((report) =>
    report.code === input.code && report.invocation_id === null
  );
  const met = via !== undefined;
  const verdict: Verdict = {
    met,
    reason: met
      ? "주입한 실패가 실제 command에서 선언 code로 접수됐다"
      : direct
      ? "SDK를 직접 부른 보고뿐이라 실제 실패 경로를 통과하지 않았다"
      : "주입한 실패에서 선언 code의 보고가 접수되지 않았다",
    evidence: {
      via: met ? "command" : direct ? "sdk_direct" : "none",
      code: input.code,
      command: input.command,
      invocation_id: invoked.invocation_id,
      report_id: via?.report_id ?? null,
      outcome: invoked.outcome,
    },
  };
  const sent = frame(check, verdict, input.emitter);
  if (!sent.ok) return sent;
  return ok(met);
}

// 앱이 쓴 실패 경로 test가 SDK의 reportProblem만 직접 부른 경우다. 그 보고는 실제 command 호출 안에서
// 나지 않았으므로 선언 code의 실패 경로 근거가 아니다. 보고가 접수됐는지는
// 관측하지만 expectation은 늘 충족되지 않는다.
export async function observeDirectFailurePath(input: {
  driver: AppDriver;
  plan: HarnessPlan;
  emitter: Emitter;
  code: string;
}): Promise<Result<boolean>> {
  const name = failurePathName(input.code);
  const check = input.plan.checks.find((item) => item.name === name);
  if (!check || !isFailurePathName(check.name)) {
    return err({ code: "invalid_input", message: "선언하지 않은 실패 경로다" });
  }
  const direct = await input.driver.reportDirect(input.code);
  const verdict: Verdict = {
    met: false,
    reason: "SDK를 직접 부른 보고뿐이라 실제 실패 경로를 통과하지 않았다",
    evidence: {
      via: "sdk_direct",
      code: input.code,
      command: null,
      invocation_id: null,
      report_id: direct.report?.report_id ?? null,
      outcome: direct.accepted ? "ok" : "error",
    },
  };
  const sent = frame(check, verdict, input.emitter);
  if (!sent.ok) return sent;
  return ok(false);
}
