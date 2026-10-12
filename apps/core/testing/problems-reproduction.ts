// 개발 fixture 앱의 이전·고친 판으로 problems reproduction test를 실제 runner 경로로 돌리는 시험 도구다
// (problems#T18). 판마다 source commit을 만들어 봉인 bundle을 준비하고, runner를 core launch spec의 권한
// flag 그대로 띄워 `--reproduction-job`으로 before·after를 돌린 뒤, 판정을 core ledger의 RecordVerification으로
// 남겨 읽는다. 사람 데이터 root(~/.lophn, ~/.config/lophn)는 열지 않고 temp lophn home만 쓴다.
import { assert } from "@std/assert";
import { sha256Hex } from "../../../packages/base/mod.ts";
import type { Result } from "../../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../../packages/protocol/platform/mod.ts";
import { launchArgv } from "../../../packages/core/supervision/security/mod.ts";
import type { FrozenTest } from "../../../packages/protocol/problems/mod.ts";
import {
  canonicalRequest,
  reproductionFrozen,
  type ReproductionScenario,
} from "../../../packages/core/problems/tests/mod.ts";
import {
  canonicalHash,
  canonicalJson,
  hashCanonical,
} from "../../../packages/core/problems/tests/canonical.ts";
import {
  APP,
  blob,
  input,
  prepared,
  requester,
  runner,
  verification,
  VRF,
} from "../../../packages/core/problems/tests/fixtures.ts";
import { runnerSockets, testRunnerSpec } from "../problems-runner.ts";
import type {
  ReproductionJob,
  ReproductionJobResult,
} from "../../worker/problems/reproduction-run.ts";
import { type CommandEnvelope, createLedgerHarness } from "./ledger.ts";
import {
  type MadeFixture,
  runnerEnv,
  type SealedBundle,
} from "./problems-app-test.ts";

// 깨지는 앱 fixture(apps#T26 완료 9번)의 reproduction 고정 증상이다. 원래 보고는 `run_broken`의 처리되지
// 않은 TypeError와 fixture_broken 보고다(500 internal). 고친 뒤 기대는 같은 입력의 정상 응답이다.
export const BROKEN_SCENARIO: ReproductionScenario = {
  problem_code: "fixture_broken",
  probe: { command: "run_broken", input: { kind: "type_error" } },
  symptom: { status: 500, error_code: "internal" },
  expectation: { status: 200 },
  adjacent: [{
    name: "mark_kind",
    command: "mark_kind",
    input: { kind: "adjacent", view_session: "reproduction-view" },
    holds: {
      status: 200,
      body: [{ path: ["result", "result", "marked"], equals: "adjacent" }],
    },
  }],
};

export type ReproductionOptions = {
  key: string;
  scenario?: ReproductionScenario;
  timeout_ms?: number;
};

export type ReproductionOutcome = {
  frozen: FrozenTest;
  test_hash: string;
  result: ReproductionJobResult;
  stderr: string;
};

// 고정 시험(FrozenTest)이다. 같은 값을 before·after 양쪽에 적용한다.
export async function reproductionFrozenTest(
  scenario: ReproductionScenario,
  timeout_ms: number,
): Promise<FrozenTest> {
  const fixed = reproductionFrozen(scenario);
  return {
    code: await sha256Hex("problems/tests reproduction harness"),
    input: fixed.input,
    expected: fixed.expected,
    method: {
      argv: ["test", "child_test.ts"],
      cwd: ".",
      timeout_ms,
      expected_exit_code: 0,
      environment: await sha256Hex("problems/tests runner environment"),
    },
    blueprint: null,
    sdk_dependencies: null,
    failure_paths: null,
    symptom: fixed.symptom,
  };
}

// runner를 core launch spec이 정한 권한 그대로 띄워 reproduction 한 건을 돌린다.
export async function runReproduction(
  made: MadeFixture,
  before: SealedBundle,
  after: SealedBundle,
  options: ReproductionOptions,
): Promise<ReproductionOutcome> {
  const scenario = options.scenario ?? BROKEN_SCENARIO;
  const timeout = options.timeout_ms ?? 120_000;
  const spec = testRunnerSpec({ dataRoot: made.home, deno: Deno.execPath() });
  assert(spec, "runner launch spec was refused");
  await Deno.mkdir(`${made.home}/work/problems/tests/sock`, {
    recursive: true,
  });
  const frozen = await reproductionFrozenTest(scenario, timeout);
  const testHash = canonicalHash(frozen);
  const job: ReproductionJob = {
    request_key: options.key,
    slot: 0,
    work: `${made.home}/work/problems/tests/${options.key}`,
    sockets: runnerSockets(made.home, 0),
    before: { bundle: before.path, bundle_hash: before.bundleHash },
    after: { bundle: after.path, bundle_hash: after.bundleHash },
    scenario,
    test_hash: testHash,
    timeout_ms: timeout,
    deno: Deno.execPath(),
    environment: {
      ...(Deno.env.get("HOME") ? { home: Deno.env.get("HOME")! } : {}),
      ...(Deno.env.get("DENO_DIR")
        ? { denoDir: Deno.env.get("DENO_DIR")! }
        : {}),
    },
  };
  const child = new Deno.Command(Deno.execPath(), {
    args: [...launchArgv(spec), "--reproduction-job"],
    clearEnv: true,
    env: runnerEnv(made, spec.kind),
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(JSON.stringify(job)));
  await writer.close();
  const output = await child.output();
  const stderr = new TextDecoder().decode(output.stderr);
  assert(
    output.success,
    `runner exited ${output.code}\n${stderr}\n${
      new TextDecoder().decode(output.stdout)
    }`,
  );
  const parsed = JSON.parse(new TextDecoder().decode(output.stdout)) as
    | { ok: true; value: ReproductionJobResult }
    | { ok: false; error: { code: string; message: string } };
  assert(parsed.ok, parsed.ok ? "" : JSON.stringify(parsed.error) + stderr);
  return { frozen, test_hash: testHash, result: parsed.value, stderr };
}

const BEFORE_RELEASE = "rel_01ary8h2z3n4p5q6r7s8t9v0wb";
const AFTER_RELEASE = "rel_01ary8h2z3n4p5q6r7s8t9v0wc";
const PROBLEM = "prb_01ary8h2z3n4p5q6r7s8t9v0wd";
const REPORT = "rpt_01ary8h2z3n4p5q6r7s8t9v0wf";

export type RecordedReproduction = {
  result: string;
  reason: string;
  test: string;
  observations: string;
  kind: string;
  target_bundle: string;
  // 기록된 시작 side의 bundle hash다.
  sides: { side: string; bundle_hash: string }[];
};

// core ledger(writer Worker)에 RequestTest → 시작 → RecordVerification을 실제 명령으로 남기고 읽는다.
// 시작한 side마다 시작을 남기고, 한쪽만 시작했으면 시작한 side의 실행과 미시작 이유만 남는다. 요청의 대상
// bundle hash·고정 시험 hash·판정·observations는 방금 돌린 실제 값이다.
export async function recordReproductionThroughCore(
  before: SealedBundle,
  after: SealedBundle,
  outcome: ReproductionOutcome,
): Promise<RecordedReproduction> {
  const { judgment, executions, not_started } = outcome.result;
  const request = input({
    kind: "reproduction",
    target: { bundle_hash: after.bundleHash, release: AFTER_RELEASE },
    problem: PROBLEM,
    basis_seq: "4",
    reports: [REPORT],
    before: BEFORE_RELEASE,
    after: AFTER_RELEASE,
    test: outcome.test_hash,
  });
  const canonical = canonicalRequest({
    ...request,
    before_bundle_hash: null,
  });
  assert(canonical.ok);
  const requestHash = hashCanonical(canonical.value);
  const admission = {
    ...prepared(request)(),
    request_hash: requestHash,
    before_bundle_hash: before.bundleHash,
    before_target: { release: BEFORE_RELEASE, bundle_hash: before.bundleHash },
  };
  const sides = executions.map((execution) => ({
    side: execution.side,
    bundle_hash: execution.bundle_hash,
    test_hash: outcome.test_hash,
    started_at: execution.started_at,
    ended_at: execution.ended_at,
    exit_code: execution.exit_code,
    end_reason: execution.end_reason,
    runner_version: "1",
    environment: outcome.frozen.method.environment,
    memory_limit_mode: (execution.mode ?? "hard") as "hard" | "soft",
    // 자식 출력 원문은 이 시험이 저장하지 않으므로 hash를 적지 않고 이유를 둔다.
    output: null,
    output_missing_reason: "runner output is not stored in this test",
    truncated: false,
    redaction_notes: [] as string[],
  }));
  const observations = judgment.observations;
  const executionHash = canonicalHash(sides);
  const observationsHash = canonicalHash(observations);
  const recorded = verification({
    ...request,
    request_hash: requestHash,
    execution: executionHash,
    result: judgment.result,
    reason: judgment.reason,
    observations: observationsHash,
  });
  const evidence = {
    request_principal: "user-1",
    request_key: request.request_key,
    request_hash: requestHash,
    runner_principal: "runner-1",
    verification_canonical: canonicalJson(recorded),
    observations_json: observations,
    test: outcome.test_hash,
    execution: executionHash,
    observations: observationsHash,
    frozen: outcome.frozen,
    execution_evidence: sides,
    actually_started: true,
    evidence_sufficient: true,
    unstarted_side: not_started?.side ?? null,
    unstarted_reason: not_started?.reason ?? null,
  };
  const proof = {
    machine_principal: "runner-1",
    phase: "start_attempt" as const,
    request_principal: "user-1",
    request_key: request.request_key,
    request_hash: requestHash,
    app: APP,
    current_runner: "runner-1",
    next_runner: null,
    operation: "observe_test_request" as const,
  };
  const withCredential = (
    base: ReturnType<typeof requester>,
    ref: string,
  ): AuthenticatedContext => ({ ...base, credential_ref: ref });
  const requesterCtx = withCredential(requester(), "cred-requester");
  const runnerBase = runner();
  const runnerCtx = withCredential({
    ...runnerBase,
    scope: {
      operations: [
        ...runnerBase.scope.operations,
        "problems.tests.observe-request",
        "problems.tests.start-side",
      ],
      targets: { ...runnerBase.scope.targets, request_hash: requestHash },
    },
  }, "cred-runner");
  const setupCtx = withCredential({
    ...requester(),
    scope: { operations: ["problems.tests.set-admission"], targets: {} },
  }, "cred-setup");
  const runnerSetupCtx = withCredential({
    ...runnerBase,
    scope: {
      operations: [
        "problems.tests.set-evidence",
        "problems.tests.check-ports",
        "problems.tests.set-blob-failure",
      ],
      targets: {},
    },
  }, "cred-runner-setup");
  const readerCtx: AuthenticatedContext = {
    principal: "user-1",
    actor: "user",
    scope: {
      operations: ["GetTestRequest", "GetVerification", "ListVerifications"],
      targets: { app: APP },
    },
    conditions: { app: APP },
    credential_ref: "cred-reader",
  };
  const envelope = (
    command: string,
    key: string,
    body: unknown,
  ): CommandEnvelope => ({
    command,
    input: body,
    compare: {},
    idempotency_key: key,
    prepared: [],
  });
  const value = <T>(done: Result<T>): T => {
    assert(done.ok, done.ok ? undefined : JSON.stringify(done.error));
    return done.value;
  };
  const registration = new URL(
    "../../../packages/core/problems/tests/harness-registration_test.ts",
    import.meta.url,
  );
  const h = value(
    await createLedgerHarness({
      registrationModules: [registration],
      credentials: [
        requesterCtx,
        runnerCtx,
        readerCtx,
        setupCtx,
        runnerSetupCtx,
      ],
      nowMs: Date.parse("2026-10-07T00:00:00.000Z"),
    }),
  );
  try {
    value(
      await h.command(
        setupCtx,
        envelope("problems.tests.set-admission", "admit", {
          prepared: JSON.stringify(admission),
        }),
      ),
    );
    value(
      await h.command(
        requesterCtx,
        envelope("RequestTest", "request", request),
      ),
    );
    value(
      await h.command(
        runnerCtx,
        envelope("problems.tests.observe-request", "attempt", {
          observation: {
            phase: "start_attempt",
            request_principal: "user-1",
            request_key: request.request_key,
            request_hash: requestHash,
            at: executions[0].started_at,
            previous_runner: null,
            runner_principal: "runner-1",
            reason: "attempt",
          },
          proof,
        }),
      ),
    );
    for (const execution of executions) {
      value(
        await h.command(
          runnerCtx,
          envelope("problems.tests.start-side", `start-${execution.side}`, {
            start: {
              request_principal: "user-1",
              request_key: request.request_key,
              request_hash: requestHash,
              side: execution.side,
              bundle_hash: execution.bundle_hash,
              test_hash: outcome.test_hash,
              started_at: execution.started_at,
            },
            proof,
          }),
        ),
      );
    }
    value(
      await h.command(
        runnerSetupCtx,
        envelope("problems.tests.set-evidence", "evidence", {
          prepared: JSON.stringify(evidence),
        }),
      ),
    );
    const saved = value(
      await h.command(
        runnerCtx,
        envelope("RecordVerification", "record", {
          verification: recorded,
          blobs: blob("runner-1", recorded, evidence),
        }),
      ),
    );
    assert((saved.result as { verification: string }).verification === VRF);
    const read = value(
      await h.read(
        { resource: "problems", method: "get-verification" },
        readerCtx,
        { verification: VRF, detail: false },
      ),
    ) as { verification: Record<string, unknown> };
    const stored = read.verification;
    return {
      result: String(stored.result),
      reason: String(stored.reason),
      test: String(stored.test),
      observations: String(stored.observations),
      kind: String(stored.kind),
      target_bundle: String(
        (stored.target as { bundle_hash: string }).bundle_hash,
      ),
      sides: sides.map((item) => ({
        side: item.side,
        bundle_hash: item.bundle_hash,
      })),
    };
  } finally {
    await h.close();
  }
}
