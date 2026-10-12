import { assert, assertEquals, assertFalse } from "@std/assert";
import { fileLedger } from "./testing/mod.ts";
import { ctx } from "./support.ts";
import {
  accept,
  APP,
  HASH,
  input,
  proof,
  REQUEST_HASH,
  runner,
} from "./fixtures.ts";
import {
  handleStageTestEvidence,
  listOpenTestRequests,
  observeTestRequestCommand,
  productAdmission,
  stagedEvidence,
  startTestSideCommand,
} from "./lifecycle.ts";
import { buildRecord, verificationIdFor } from "./build.ts";
import { deriveAppTest, sha256Bytes } from "./app-test/frozen.ts";
import { judgeRecordable } from "./judge.ts";
import { evidence as fixtureEvidence, executed } from "./fixtures.ts";
import { canonicalHash } from "./canonical.ts";
import { handleRecordVerification } from "./record.ts";
import { blob, verification } from "./fixtures.ts";

// platform이 발급하는 machine credential처럼 task 조건과 같은 task target을 갖는다.
function machine(principal = "runner-1") {
  const base = runner(principal);
  return ctx({
    ...base,
    scope: {
      operations: [
        ...base.scope.operations,
        "ObserveTestRequest",
        "StartTestSide",
        "StageTestEvidence",
      ],
      targets: { task: "problems", ...base.scope.targets },
    },
    conditions: { task: "problems", process: "problems/test-runner" },
  });
}

const observe = (
  tx: Parameters<typeof observeTestRequestCommand.handle>[0],
  caller: Parameters<typeof observeTestRequestCommand.handle>[1],
  body: unknown,
) => observeTestRequestCommand.handle(tx, caller, body as never, {} as never);
const startSide = (
  tx: Parameters<typeof startTestSideCommand.handle>[0],
  caller: Parameters<typeof startTestSideCommand.handle>[1],
  body: unknown,
) => startTestSideCommand.handle(tx, caller, body as never, {} as never);
const stage = (
  tx: Parameters<typeof handleStageTestEvidence>[0],
  caller: Parameters<typeof handleStageTestEvidence>[1],
  body: unknown,
) => handleStageTestEvidence(tx, caller, body as never);

const attempt = (at = "2026-10-04T00:00:01.000Z") => ({
  observation: {
    phase: "start_attempt" as const,
    request_principal: "user-1",
    request_key: "key-1",
    request_hash: REQUEST_HASH,
    at,
    previous_runner: null,
    runner_principal: "runner-1",
    reason: "attempt",
  },
  proof: proof(),
});

Deno.test("problems/tests#R17: 시작 시도는 한 요청에 한 번이고 다시 보내도 두 번째 시도를 남기지 않는다", () => {
  const ledger = fileLedger();
  try {
    assert(ledger.transaction(accept).ok);
    const first = ledger.transaction((tx) => observe(tx, machine(), attempt()));
    assert(first.ok);
    const again = ledger.transaction((tx) =>
      observe(
        tx,
        machine(),
        attempt("2026-10-04T00:00:09.000Z"),
      )
    );
    assertFalse(again.ok);
    assert(!again.ok && again.error.code === "conflict");
    const same = ledger.transaction((tx) => observe(tx, machine(), attempt()));
    assertFalse(same.ok);
    assertEquals(
      ledger.sql.get(
        "select count(*) as n from test_requests where phase = 'start_attempt'",
        [],
      )?.n,
      1n,
    );
  } finally {
    ledger.close();
  }
});

Deno.test("problems/tests#R5 R21: 열린 요청 목록은 시작 시도·실제 시작·복구를 구별하고 끝난 요청은 내지 않는다", () => {
  const ledger = fileLedger();
  try {
    assert(ledger.transaction(accept).ok);
    let open = listOpenTestRequests(ledger.sql);
    assertEquals(open.length, 1);
    assertEquals(open[0].attempted, false);
    assertEquals(open[0].current_runner, "runner-1");
    assert(
      ledger.transaction((tx) => observe(tx, machine(), attempt())).ok,
    );
    const side = {
      start: {
        request_principal: "user-1",
        request_key: "key-1",
        request_hash: REQUEST_HASH,
        side: "single" as const,
        started_at: executed.started_at,
        test_hash: input().test,
        bundle_hash: HASH,
      },
      proof: proof(),
    };
    assert(
      ledger.transaction((tx) => startSide(tx, machine(), side)).ok,
    );
    open = listOpenTestRequests(ledger.sql);
    assertEquals(open[0].attempted, true);
    assertEquals(open[0].sides.length, 1);
    assertEquals(open[0].recovered, false);
    // 시작 시도 뒤 복구 runner가 이어받으면 현재 runner가 바뀐다.
    const recovery = {
      observation: {
        phase: "recovery" as const,
        request_principal: "user-1",
        request_key: "key-1",
        request_hash: REQUEST_HASH,
        at: "2026-10-04T00:00:04.000Z",
        previous_runner: "runner-1",
        runner_principal: "runner-2",
        reason: "lost",
      },
      proof: proof("recovery"),
    };
    assert(
      ledger.transaction((tx) => observe(tx, machine("runner-2"), recovery)).ok,
    );
    open = listOpenTestRequests(ledger.sql);
    assertEquals(open[0].current_runner, "runner-2");
    assertEquals(open[0].recovered_at, "2026-10-04T00:00:04.000Z");
    // 결과가 남으면 목록에서 빠진다.
    const stageInput = fixtureEvidence();
    const recorded = ledger.transaction((tx) =>
      handleRecordVerification(tx, machine("runner-2"), {
        verification: verification(),
        blobs: blob("runner-2", verification(), {
          ...stageInput,
          runner_principal: "runner-2",
        }),
      }, { ...stageInput, runner_principal: "runner-2" })
    );
    assert(recorded.ok, JSON.stringify(recorded));
    assertEquals(listOpenTestRequests(ledger.sql).length, 0);
  } finally {
    ledger.close();
  }
});

Deno.test("problems/tests#R2 R3: 결과 근거는 한 요청에 한 번 남고 같은 내용만 다시 받으며 요청과 다른 주체·요청은 거절한다", () => {
  const ledger = fileLedger();
  try {
    assert(ledger.transaction(accept).ok);
    const staged = {
      request_principal: "user-1",
      request_key: "key-1",
      request_hash: REQUEST_HASH,
      evidence: fixtureEvidence(),
    };
    assert(
      ledger.transaction((tx) => stage(tx, machine(), staged))
        .ok,
    );
    assert(
      ledger.transaction((tx) => stage(tx, machine(), staged))
        .ok,
    );
    const changed = {
      ...staged,
      evidence: {
        ...fixtureEvidence(),
        observations_json: { other: 1 },
      },
    };
    const conflict = ledger.transaction((tx) => stage(tx, machine(), changed));
    assert(!conflict.ok && conflict.error.code === "conflict");
    // 다른 요청에 묶인 credential, 다른 주체의 근거는 거절한다.
    const other = ctx({
      ...machine(),
      scope: {
        ...machine().scope,
        targets: { ...machine().scope.targets, request_key: "key-2" },
      },
    });
    assertFalse(
      ledger.transaction((tx) => stage(tx, other, staged)).ok,
    );
    assertFalse(
      ledger.transaction((tx) =>
        stage(tx, machine(), {
          ...staged,
          evidence: { ...fixtureEvidence(), runner_principal: "runner-9" },
        })
      ).ok,
    );
    const read = stagedEvidence(ledger.sql, verification(), "user-1", "key-1");
    assertEquals(read?.runner_principal, "runner-1");
    assertEquals(
      stagedEvidence(ledger.sql, verification(), "user-1", "none"),
      null,
    );
    // 이어받은 runner의 근거는 끊긴 runner의 근거와 따로 남는다.
    const takeover = ledger.transaction((tx) =>
      observe(tx, machine("runner-2"), {
        observation: {
          phase: "recovery" as const,
          request_principal: "user-1",
          request_key: "key-1",
          request_hash: REQUEST_HASH,
          at: "2026-10-04T00:00:04.000Z",
          previous_runner: "runner-1",
          runner_principal: "runner-2",
          reason: "lost",
        },
        proof: proof("recovery"),
      })
    );
    assert(takeover.ok, JSON.stringify(takeover));
    const second = { ...fixtureEvidence(), runner_principal: "runner-2" };
    assert(
      ledger.transaction((tx) =>
        stage(tx, machine("runner-2"), { ...staged, evidence: second })
      ).ok,
    );
    assertEquals(
      stagedEvidence(ledger.sql, verification(), "user-1", "key-1")
        ?.runner_principal,
      "runner-1",
    );
  } finally {
    ledger.close();
  }
});

Deno.test("problems/tests#R1 R20: 제품 접수 준비는 app test와 reproduction만 받고 test_command와 앱이 없는 요청은 받지 않는다", () => {
  const request = input();
  const facts = {
    runner_principal: "problems-test-runner",
    app_registered: true,
    refs_ok: true,
    before_target: null,
  };
  const prepared = productAdmission({ principal: "user-1" }, request, facts);
  assertEquals(prepared?.unavailable, false);
  assertEquals(prepared?.runner_principal, "problems-test-runner");
  assertEquals(prepared?.request_principal, "user-1");
  assertEquals(prepared?.request_hash.length, 64);
  const command = productAdmission(
    { principal: "user-1" },
    { ...request, kind: "test_command" },
    facts,
  );
  assertEquals(command?.unavailable, true);
  const missing = productAdmission({ principal: "user-1" }, request, {
    ...facts,
    app_registered: false,
  });
  assertEquals(missing?.app_in_scope, false);
  assertEquals(APP, request.app);
});

Deno.test("problems/tests#R2 R4: 결과 근거는 만든 canonical의 hash만 적고 저장할 blob의 bytes도 같이 낸다", () => {
  const frozen = fixtureEvidence().frozen;
  const executions = [executed];
  const built = buildRecord({
    id: verificationIdFor("user-1", "key-1", REQUEST_HASH),
    request_principal: "user-1",
    request_key: "key-1",
    request_hash: REQUEST_HASH,
    runner_principal: "runner-1",
    connection: { ...input(), before_bundle_hash: null },
    frozen,
    executions,
    observations: { checked: true },
    result: "pass",
    reason: "ran",
    sufficient: true,
  });
  assert(built.ok, JSON.stringify(built));
  assertEquals(built.value.verification.test, canonicalHash(frozen));
  assertEquals(built.value.verification.execution, canonicalHash(executions));
  // Verification이 직접 가리키는 blob은 bytes의 sha256이 hash와 같다.
  for (const [hash, bytes] of built.value.contents) {
    assertEquals(sha256Bytes(bytes), hash);
  }
  assertEquals(
    verificationIdFor("user-1", "key-1", REQUEST_HASH),
    verificationIdFor("user-1", "key-1", REQUEST_HASH),
  );
  // 요청 hash는 key를 싣지 않으므로 같은 내용의 다른 요청은 key가 ID를 가른다.
  assert(
    verificationIdFor("user-1", "key-1", REQUEST_HASH) !==
      verificationIdFor("user-1", "key-2", REQUEST_HASH),
  );
  assert(
    /^vrf_[0-7][0-9a-hjkmnp-tv-z]{25}$/.test(
      verificationIdFor("user-1", "key-1", REQUEST_HASH),
    ),
  );
  // 실제 시작이 없는 근거는 기록할 수 없고, runner_lost 같은 끝은 inconclusive만 받는다.
  const lost = buildRecord({
    id: verificationIdFor("user-1", "key-1", REQUEST_HASH),
    request_principal: "user-1",
    request_key: "key-1",
    request_hash: REQUEST_HASH,
    runner_principal: "runner-1",
    connection: { ...input(), before_bundle_hash: null },
    frozen,
    executions: [{ ...executed, end_reason: "runner_lost", exit_code: null }],
    observations: { runner_lost: true },
    result: "pass",
    reason: "x",
    sufficient: false,
  });
  assert(lost.ok);
  const judged = judgeRecordable(
    lost.value.verification,
    lost.value.evidence,
    [{
      request_principal: "user-1",
      request_key: "key-1",
      request_hash: REQUEST_HASH,
      runner_principal: "runner-1",
      side: "single",
      bundle_hash: HASH,
      test_hash: input().test,
      started_at: executed.started_at,
    }],
    { ...input(), before_bundle_hash: null },
  );
  assertFalse(judged.ok);
  // 같은 근거로 inconclusive를 적으면 기록할 수 있다(runner_lost).
  const inconclusive = buildRecord({
    id: verificationIdFor("user-1", "key-1", REQUEST_HASH),
    request_principal: "user-1",
    request_key: "key-1",
    request_hash: REQUEST_HASH,
    runner_principal: "runner-1",
    connection: { ...input(), before_bundle_hash: null },
    frozen,
    executions: [{ ...executed, end_reason: "runner_lost", exit_code: null }],
    observations: { runner_lost: true },
    result: "inconclusive",
    reason: "runner_lost",
    sufficient: false,
  });
  assert(inconclusive.ok);
  const accepted = judgeRecordable(
    inconclusive.value.verification,
    inconclusive.value.evidence,
    [{
      request_principal: "user-1",
      request_key: "key-1",
      request_hash: REQUEST_HASH,
      runner_principal: "runner-1",
      side: "single",
      bundle_hash: HASH,
      test_hash: input().test,
      started_at: executed.started_at,
    }],
    { ...input(), before_bundle_hash: null },
  );
  assert(accepted.ok, JSON.stringify(accepted));
});

Deno.test("problems/tests#R6 R12: app test의 고정 시험은 bundle 사본에서 정하고 모든 hash가 저장할 blob의 sha256이다", async () => {
  const bundle = await Deno.makeTempDir({ prefix: "lophn-frozen-" });
  try {
    await Deno.mkdir(`${bundle}/tests`);
    await Deno.writeTextFile(
      `${bundle}/blueprint.json`,
      JSON.stringify({
        sdk_dependencies: [{ name: "@lophn/sdk", version: "1.0.0" }],
        problem_codes: [],
        screens: [],
      }),
    );
    await Deno.writeTextFile(
      `${bundle}/tests/app-test.json`,
      JSON.stringify({
        failure_paths: [{
          code: "save_failed",
          command: "save",
          fault: "none",
        }],
        inputs: { save: { title: "x" } },
      }),
    );
    const derived = await deriveAppTest(bundle, HASH);
    assert(derived.ok, derived.ok ? "" : derived.reason);
    const { frozen, blobs, test_hash } = derived.value;
    assertEquals(test_hash, canonicalHash(frozen));
    // 같은 bundle이면 같은 시험이다(요청한 쪽과 runner가 같은 hash를 얻는다).
    const again = await deriveAppTest(bundle, HASH);
    assert(again.ok);
    assertEquals(again.value.test_hash, test_hash);
    const hashes = [
      test_hash,
      frozen.code,
      frozen.input,
      frozen.expected,
      frozen.method.environment,
      frozen.blueprint!,
      frozen.sdk_dependencies!,
      ...frozen.failure_paths!.map((path) => path.test_hash),
    ];
    for (const hash of hashes) {
      const bytes = blobs.get(hash);
      assert(bytes !== undefined, `blob for ${hash} is not stored`);
      assertEquals(sha256Bytes(bytes), hash);
    }
    // 다른 bundle hash는 다른 시험이다.
    const other = await deriveAppTest(bundle, "b".repeat(64));
    assert(other.ok && other.value.test_hash !== test_hash);
    // 시험 자료가 없는 bundle은 이유를 돌려준다.
    await Deno.remove(`${bundle}/tests/app-test.json`);
    const none = await deriveAppTest(bundle, HASH);
    assertFalse(none.ok);
  } finally {
    await Deno.remove(bundle, { recursive: true });
  }
});
