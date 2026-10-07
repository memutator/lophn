// 개발 fixture 앱 네 개(rate limit 대시보드, 할 일, 캘린더, 일부러 깨지는 앱)로 problems app test를 실제 runner
// 경로로 검증한다(problems#T12). fake driver가 아니다: fixture 원본을 source commit → 봉인 bundle로 만들고,
// runner를 core launch spec의 권한 flag 그대로 띄워(`testRunnerSpec`) 실제 앱 자식·broker·요청별 Deno test 자식으로
// 돌린 뒤, 판정을 core ledger의 RecordVerification으로 남겨 읽는다. 사람 데이터 root(~/.lophn,
// ~/.config/lophn)는 열지 않고 temp lophn home만 쓴다.
//
// 화면 검사 host(shell의 Electron `--app-screen-test`)는 환경 값으로 준다: SCREEN_TEST_HOST(실행 파일)와
// SCREEN_TEST_HOST_MAIN(shell build의 main.cjs). 없으면 화면 검사는 pass가 아니고(R7) 화면 없는 검사만 판정한다.
import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../packages/contracts/platform/mod.ts";
import { screenErrorBoundaries } from "../../packages/problems/tests/adapters/screen-host.ts";
import {
  canonicalRequest,
  type HarnessFailurePath,
} from "../../packages/problems/tests/mod.ts";
import {
  canonicalHash,
  canonicalJson,
  hashCanonical,
} from "../../packages/problems/tests/canonical.ts";
import {
  APP,
  blob,
  input,
  prepared,
  requester,
  runner,
  verification,
  VRF,
} from "../../packages/problems/tests/fixtures.ts";
import { FAILING_BLOB_FIELD } from "../../packages/problems/tests/harness-registration_test.ts";
import { type CommandEnvelope, createLedgerHarness } from "./testing/ledger.ts";
import {
  type BundleVariant,
  type FixtureName,
  type MadeFixture,
  madeFixture,
  runAppTest,
  type RunOutcome,
  type SealedBundle,
  sealedBundle,
  variantBundle,
} from "./testing/problems-app-test.ts";

void FAILING_BLOB_FIELD;
const registration = new URL(
  "../../packages/problems/tests/harness-registration_test.ts",
  import.meta.url,
);
const HOST = Deno.env.get("SCREEN_TEST_HOST");
const HOST_MAIN = Deno.env.get("SCREEN_TEST_HOST_MAIN");
const screenHost = HOST && HOST_MAIN
  ? { command: HOST, args: [HOST_MAIN] }
  : null;
const VIEW_CHECKS = ["feedback", "view_exception"];
const VARIANTS = JSON.parse(
  await Deno.readTextFile(
    new URL(
      "../../packages/problems/tests/testdata/bundle-variants.json",
      import.meta.url,
    ),
  ),
) as BundleVariant[];

const failedChecks = (outcome: RunOutcome): string[] =>
  outcome.result.judgment.observations.checks.filter((check) =>
    check.status === "fail"
  ).map((check) => check.name).sort();

const statusOf = (outcome: RunOutcome, name: string): string | undefined =>
  outcome.result.judgment.observations.checks.find((check) =>
    check.name === name
  )?.status;

// 화면 검사 host가 있으면 모든 필수 검사가 pass이고, 없으면 화면 검사만 pass가 아니다(problems/tests#R7).
function assertCleanRun(outcome: RunOutcome, label: string): void {
  const { judgment, execution } = outcome.result;
  assertEquals(execution.result, "pass", `${label}: ${execution.reason}`);
  assertEquals(execution.exit_code, 0, execution.output_tail);
  if (screenHost) {
    assertEquals(judgment.result, "pass", `${label}: ${judgment.reason}`);
  } else {
    assertEquals(judgment.result, "fail", label);
    assertEquals(failedChecks(outcome), VIEW_CHECKS, label);
  }
  // 통과가 증명하는 범위: 모든 검사가 고정 기준과 입력 범위를 적는다(problems/tests#R12).
  for (const check of judgment.observations.checks) {
    assert(check.coverage.criteria.length > 0, `${label} ${check.name}`);
    assert(check.coverage.input_range.length > 0, `${label} ${check.name}`);
  }
}

function bodyResult(
  outcome: RunOutcome,
  name: string,
): Record<string, unknown> {
  const probe = outcome.result.domain.find((item) => item.name === name);
  assert(probe, `domain probe ${name} did not run`);
  const body = probe.body as { result?: { result?: unknown } } | null;
  return (body?.result?.result ?? {}) as Record<string, unknown>;
}

// core ledger(writer Worker)에 RequestTest → 시작 → RecordVerification을 실제 명령으로 남기고 읽는다. 요청의 대상
// bundle hash·고정 시험 hash·판정·observations는 방금 돌린 실제 값이다.
async function recordThroughCore(
  bundle: SealedBundle,
  outcome: RunOutcome,
): Promise<{ result: string; test: string; bundle: string }> {
  const target = { bundle_hash: bundle.bundleHash, release: null };
  const request = input({ target, test: outcome.test_hash });
  const canonical = canonicalRequest({ ...request, before_bundle_hash: null });
  assert(canonical.ok);
  const requestHash = hashCanonical(canonical.value);
  const { judgment, execution } = outcome.result;
  const observationsHash = canonicalHash(judgment.observations);
  const executed = {
    side: "single" as const,
    bundle_hash: bundle.bundleHash,
    test_hash: outcome.test_hash,
    started_at: execution.started_at,
    ended_at: new Date().toISOString(),
    exit_code: execution.exit_code ?? 0,
    end_reason: "exited" as const,
    runner_version: "1",
    environment: outcome.frozen.method.environment,
    memory_limit_mode: (execution.mode ?? "hard") as "hard" | "soft",
    // 자식 출력 원문은 이 시험이 저장하지 않으므로 hash를 적지 않고 이유를 둔다.
    output: null,
    output_missing_reason: "runner output is not stored in this test",
    truncated: false,
    redaction_notes: [] as string[],
  };
  const executionHash = canonicalHash([executed]);
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
    observations_json: judgment.observations,
    test: outcome.test_hash,
    execution: executionHash,
    observations: observationsHash,
    frozen: outcome.frozen,
    execution_evidence: [executed],
    actually_started: true,
    evidence_sufficient: true,
    unstarted_side: null,
    unstarted_reason: null,
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
  const opened = await createLedgerHarness({
    registrationModules: [registration],
    credentials: [
      requesterCtx,
      runnerCtx,
      readerCtx,
      setupCtx,
      runnerSetupCtx,
    ],
    nowMs: Date.parse("2026-10-07T00:00:00.000Z"),
  });
  const h = value(opened);
  try {
    value(
      await h.command(
        setupCtx,
        envelope("problems.tests.set-admission", "admit", {
          prepared: JSON.stringify(prepared(request)()),
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
            at: execution.started_at,
            previous_runner: null,
            runner_principal: "runner-1",
            reason: "attempt",
          },
          proof,
        }),
      ),
    );
    value(
      await h.command(
        runnerCtx,
        envelope("problems.tests.start-side", "start", {
          start: {
            request_principal: "user-1",
            request_key: request.request_key,
            request_hash: requestHash,
            side: "single",
            bundle_hash: bundle.bundleHash,
            test_hash: outcome.test_hash,
            started_at: execution.started_at,
          },
          proof,
        }),
      ),
    );
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
    assertEquals(
      (saved.result as { verification: string }).verification,
      VRF,
    );
    const read = value(
      await h.read(
        { resource: "problems", method: "get-verification" },
        readerCtx,
        { verification: VRF, detail: false },
      ),
    ) as { verification: Record<string, unknown> };
    // 읽은 값이 방금 돌린 실제 판정이다.
    assertEquals(read.verification.observations, observationsHash);
    return {
      result: String(read.verification.result),
      test: String(read.verification.test),
      bundle: String(
        (read.verification.target as { bundle_hash: string }).bundle_hash,
      ),
    };
  } finally {
    await h.close();
  }
}

Deno.test(
  "problems/tests#R6 R7 R8 R9 R12 R15 R18: 세 fixture와 깨지는 앱이 core launch spec의 runner로 app test를 돌려 자기 관측을 남기고 RecordVerification으로 읽힌다",
  async (t) => {
    const made = new Map<FixtureName, MadeFixture>();
    const sealed = new Map<FixtureName, SealedBundle>();
    try {
      const names: FixtureName[] = [
        "rate-limit-dashboard",
        "todo",
        "calendar",
        "broken",
      ];
      const runs = new Map<FixtureName, RunOutcome>();
      for (const name of names) {
        await t.step(
          `${name}: 봉인 bundle을 만들고 runner로 app test를 돈다`,
          async () => {
            const fixture = await madeFixture(name);
            made.set(name, fixture);
            const bundle = await sealedBundle(fixture);
            sealed.set(name, bundle);
            const outcome = await runAppTest(fixture, bundle, {
              key: `fixture-${name}`,
              screen_host: screenHost,
            });
            runs.set(name, outcome);
            assertCleanRun(outcome, name);
          },
        );
      }
      await t.step("rate limit 대시보드는 기간·시간대·coverage를 낸다", () => {
        const report = bodyResult(
          runs.get("rate-limit-dashboard")!,
          "period_timezone_coverage",
        );
        const period = report["period"] as { timezone: string };
        assertEquals(period.timezone, "Asia/Seoul");
        assert(typeof report["coverage"] === "string");
        assert(typeof report["freshness"] === "string");
      });
      await t.step(
        "할 일은 변환한 blob 파일과 후속 변경 뒤 되돌림 충돌을 남긴다",
        () => {
          const outcome = runs.get("todo")!;
          const exported =
            outcome.files["/tmp/lophn-todo/export/domain-export.md"];
          assert(exported?.includes("- [ ] Exported todo"), String(exported));
          assertEquals(statusOf(outcome, "revert_conflict"), "pass");
          assertEquals(statusOf(outcome, "revert_restore"), "pass");
          assertEquals(statusOf(outcome, "revert_duplicate"), "pass");
        },
      );
      await t.step(
        "캘린더는 확인되지 않은 외부 효과와 거절된 읽기를 구별한다",
        () => {
          const outcome = runs.get("calendar")!;
          const create = outcome.result.domain.find((item) =>
            item.name === "create_effect_unconfirmed"
          )!;
          // POST가 5xx로 끝나 상대에 닿았는지 모르는 효과는 원인을 모르는 오류다.
          assertEquals(create.status, 500);
          assert(create.reports.includes("external_calendar_unavailable"));
          const sync = outcome.result.domain.find((item) =>
            item.name === "sync_refused"
          )!;
          // 읽기는 효과가 없어 거절된 사실만 남는다.
          assertEquals(sync.status, 503);
          assert(sync.reports.includes("external_calendar_unavailable"));
          assertEquals(statusOf(outcome, "secret_grant"), "pass");
          assertEquals(statusOf(outcome, "automation_scope"), "pass");
          assertEquals(statusOf(outcome, "adapter_isolation"), "pass");
        },
      );
      await t.step(
        "깨지는 앱은 선언 실패 경로·exception·view 오류를 collector 접수로 낸다",
        () => {
          const outcome = runs.get("broken")!;
          const reports = outcome.result.forwarded.filter((item) =>
            item.kind === "report"
          ).map((item) => item.code);
          assert(reports.includes("fixture_broken"));
          assert(reports.includes("fixture_misconfigured"));
          // 모든 접수는 이 요청의 test scope로 갔다(운영 문제에 묶이지 않는다).
          for (const item of outcome.result.forwarded) {
            assert(item.scope.startsWith("app-test-"));
          }
          const exceptions = outcome.result.forwarded.filter((item) =>
            item.kind === "exception"
          );
          // process 예외 한 건에 더해 host가 있으면 화면 오류(probe 셋과 화면 자신의 오류)와 feedback이 온다.
          assert(exceptions.length >= 1);
          if (screenHost) {
            assert(exceptions.length >= 5, String(exceptions.length));
            assert(
              outcome.result.forwarded.some((item) => item.kind === "feedback"),
            );
          }
          assertEquals(statusOf(outcome, "process_exception"), "pass");
          assertEquals(statusOf(outcome, "code_usage_dynamic"), "pass");
        },
      );
      await t.step(
        "판정은 core ledger의 RecordVerification으로 남아 같은 bundle hash로 읽힌다",
        async () => {
          const outcome = runs.get("broken")!;
          const bundle = sealed.get("broken")!;
          const read = await recordThroughCore(bundle, outcome);
          assertEquals(read.result, outcome.result.judgment.result);
          assertEquals(read.bundle, bundle.bundleHash);
          assertEquals(read.test, outcome.test_hash);
        },
      );

      // testdata 변형은 각자 fail이다. 변형은 봉인 bundle 사본에 작은 고침을 걸거나 고정 시험을 바꾼다.
      for (const variant of VARIANTS) {
        await t.step(
          `${variant.requirement}: 변형 ${variant.name}은 fail이다`,
          async () => {
            const base = sealed.get(variant.base) ??
              await (async () => {
                const fixture = await madeFixture(variant.base);
                made.set(variant.base, fixture);
                const bundle = await sealedBundle(fixture);
                sealed.set(variant.base, bundle);
                return bundle;
              })();
            const fixture = made.get(variant.base)!;
            const changed = variant.patch || variant.blueprint_add_automation ||
                variant.rename
              ? await variantBundle(fixture, base, variant)
              : base;
            const file = JSON.parse(
              await Deno.readTextFile(`${base.path}/tests/app-test.json`),
            ) as { failure_paths: HarnessFailurePath[] };
            const paths = variant.failure_paths === "none"
              ? []
              : variant.failure_paths === "direct"
              ? file.failure_paths.map((path) => ({
                code: path.code,
                direct: true,
              }))
              : undefined;
            const outcome = await runAppTest(fixture, changed, {
              key: `variant-${variant.name}`,
              screen_host: screenHost,
              ...(paths === undefined ? {} : { failure_paths: paths }),
            });
            assertEquals(outcome.result.judgment.result, "fail", variant.name);
            const failed = failedChecks(outcome);
            for (const name of variant.expect_fail) {
              assert(
                failed.includes(name),
                `${variant.name}: ${name} did not fail (${failed})`,
              );
            }
            for (const name of variant.expect_pass ?? []) {
              assertEquals(
                statusOf(outcome, name),
                "pass",
                `${variant.name}: ${name}`,
              );
            }
            // 바꾼 것만 실패하고 나머지는 그대로다: 화면 검사 host가 없을 때의 화면 검사만 더 실패한다.
            const unexpected = failed.filter((name) =>
              !variant.expect_fail.includes(name) &&
              !(screenHost === null && VIEW_CHECKS.includes(name))
            );
            assertEquals(unexpected, [], variant.name);
            if (variant.name === "no-root-boundary") {
              const screens = [{ key: "panel", path: "panel/index.html" }];
              assertEquals(
                [
                  ...await screenErrorBoundaries({
                    bundle_screens_dir: `${base.path}/screens`,
                    screens,
                  }),
                ],
                ["panel"],
              );
              assertEquals(
                [
                  ...await screenErrorBoundaries({
                    bundle_screens_dir: `${changed.path}/screens`,
                    screens,
                  }),
                ],
                [],
              );
            }
          },
        );
      }
    } finally {
      for (const fixture of made.values()) await fixture.dispose();
    }
  },
);
