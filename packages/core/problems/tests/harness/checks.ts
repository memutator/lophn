import { ok, type Result } from "../../../../base/mod.ts";
import type {
  AppDriver,
  HarnessPlan,
  HarnessPlanCheck,
  RewindRun,
} from "./driver.ts";
import type { MigrationScenario } from "./driver.ts";
import type { Emitter } from "./emit.ts";

type Verdict = {
  met: boolean;
  reason: string;
  evidence: Record<string, unknown>;
};

async function blueprintHandlerMatch(
  driver: AppDriver,
  plan: HarnessPlan,
): Promise<Verdict> {
  const attestation = await driver.probe();
  const declared = [...plan.app_api].sort();
  const registered = [...attestation.app_api].sort();
  const same = declared.length === registered.length &&
    declared.every((key, index) => key === registered[index]);
  const bundle = attestation.bundle_hash === plan.bundle_hash;
  const nonce = attestation.process_nonce !== "";
  const accepted: string[] = [];
  if (same && bundle && nonce) {
    for (const api of declared) {
      if (!await driver.rejectsInvalidInput(api)) accepted.push(api);
    }
  }
  return {
    met: same && bundle && nonce && accepted.length === 0,
    reason: !bundle
      ? "준비 attestation의 bundle hash가 고정 bundle과 다르다"
      : !same
      ? "blueprint 선언 app-api와 실제 등록 handler가 다르다"
      : !nonce
      ? "준비 attestation에 process nonce가 없다"
      : accepted.length > 0
      ? "입력 계약을 어긴 입력이 거절되지 않는 app-api가 있다"
      : "선언 app-api와 등록 handler가 일치하고 잘못된 입력은 거절된다",
    evidence: {
      declared,
      registered,
      invalid_input_accepted: accepted,
      bundle_hash: attestation.bundle_hash,
      data_schema: attestation.data_schema,
    },
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

async function rewind(
  driver: AppDriver,
  plan: HarnessPlan,
): Promise<Verdict> {
  // write app-api를 선언 순서대로 부른다. 앞선 호출이 만든 상태가 뒤 호출의 앞선 상태가 된다.
  const runs: Record<string, RewindRun> = {};
  for (const api of plan.write_api) runs[api] = await driver.rewind(api);
  const failed = Object.entries(runs).filter(([, run]) =>
    !(run.called && run.changed && run.applied && run.restored)
  );
  return {
    met: failed.length === 0,
    reason: failed.length === 0
      ? "write app-api마다 뒤집은 changeset을 적용하면 호출 전 상태로 돌아온다"
      : `되돌리지 못한 write app-api가 있다: ${
        failed.map(([api, run]) => `${api}(${run.reason})`).join(", ")
      }`,
    evidence: { runs },
  };
}

type ChecksInput = {
  driver: AppDriver;
  plan: HarnessPlan;
  emitter: Emitter;
};

function frame(check: HarnessPlanCheck, verdict: Verdict, emitter: Emitter) {
  return emitter.emit({
    name: check.name,
    actual: { check_digest: check.digest, ...verdict.evidence },
    expectation_met: verdict.met,
    reason: verdict.reason,
  });
}

// test 자식이 구동하는 필수 검사를 실제로 돌려 검사마다 관측 frame 하나를 낸다.
// 계획이 not_applicable로 둔 검사는 돌리지 않는다.
export async function runChecks(input: ChecksInput): Promise<Result<number>> {
  let count = 0;
  for (const check of input.plan.checks) {
    if (check.source !== "harness" || check.status === "not_applicable") {
      continue;
    }
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
  const { driver, plan } = input;
  switch (name) {
    case "blueprint_handler_match":
      return blueprintHandlerMatch(driver, plan);
    case "rewind":
      return rewind(driver, plan);
    case "migration_empty":
      return migration(driver, plan, "empty");
    case "migration_upgrade":
      return migration(driver, plan, "upgrade");
    default:
      return Promise.reject(new Error("unknown check"));
  }
}
