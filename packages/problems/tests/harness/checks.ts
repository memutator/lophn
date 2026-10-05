import { err, ok, type Result } from "../../../base/mod.ts";
import {
  failurePathName,
  isFailurePathName,
  REDACTION_CANARY,
  UNDECLARED_PROBE_CODE,
} from "./definitions.ts";
import type {
  AppDriver,
  HarnessPlan,
  HarnessPlanCheck,
  ReceivedReport,
} from "./driver.ts";
import type { Emitter } from "./emit.ts";
import { scanCodeUsage, type SourceFile } from "./source-scan.ts";

type Verdict = {
  met: boolean;
  reason: string;
  evidence: Record<string, unknown>;
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
  const met = bad.length === 0 && usage.dynamic.length === 0;
  return {
    met,
    reason: bad.length > 0
      ? "선언하지 않았거나 예약된 code를 source가 보고한다"
      : usage.dynamic.length > 0
      ? "code를 literal이 아닌 값으로 정해 정적으로 확인할 수 없다"
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

export type ChecksInput = {
  driver: AppDriver;
  plan: HarnessPlan;
  emitter: Emitter;
  sources: readonly SourceFile[];
};

function frame(check: HarnessPlanCheck, verdict: Verdict, emitter: Emitter) {
  return emitter.emit({
    name: check.name,
    actual: { check_digest: check.digest, ...verdict.evidence },
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
      verdict = {
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
    default:
      return Promise.reject(new Error("unknown check"));
  }
}

// 앱이 쓴 실패 경로 test가 부르는 도우미. 실제 앱 command에 fixture 실패를
// 주입하고, 그 호출 안에서 선언 code의 보고가 접수됐을 때만 통과한다. 호출
// 밖에서 SDK를 직접 부른 보고는 이 호출의 근거가 아니다(problem-codes#R9).
export async function observeFailurePath(input: {
  driver: AppDriver;
  plan: HarnessPlan;
  emitter: Emitter;
  code: string;
  command: string;
  command_input: unknown;
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
    { inject_failure: true },
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
