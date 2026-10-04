import { assert, assertEquals, assertFalse } from "@std/assert";
import { testMethodInputSchema } from "../../contracts/problems/mod.ts";
import {
  canonicalRequest,
  connectionOf,
  type PreparedResultEvidence,
  projectRequest,
  type RequestRecord,
  type StoredSideStart,
  type TestConnection,
  timeoutBounds,
} from "./model.ts";
import { expectedBundle, judgeRecordable } from "./judge.ts";

const HASH = "a".repeat(64);
const HASH_B = "b".repeat(64);
const APP = "app_01ary8h2z3n4p5q6r7s8t9v0wa";
const REL = "rel_01ary8h2z3n4p5q6r7s8t9v0wb";
const REL_B = "rel_01ary8h2z3n4p5q6r7s8t9v0wc";
const PRB = "prb_01ary8h2z3n4p5q6r7s8t9v0wd";
const RPT = "rpt_01ary8h2z3n4p5q6r7s8t9v0we";
const TKT = "tkt_01ary8h2z3n4p5q6r7s8t9v0wf";

function method(timeout = 60_000) {
  return {
    argv: ["test", "app_test.ts"],
    cwd: ".",
    timeout_ms: timeout,
    expected_exit_code: 0,
    environment: HASH,
  };
}

function appTest(): TestConnection {
  return {
    kind: "app_test",
    app: APP,
    target: { bundle_hash: HASH, release: null },
    problem: null,
    basis_seq: null,
    reports: [],
    before: null,
    after: null,
    ticket: null,
    test: HASH,
    before_bundle_hash: null,
  };
}

function reproduction(): TestConnection {
  return {
    kind: "reproduction",
    app: APP,
    target: { bundle_hash: HASH_B, release: REL_B },
    problem: PRB,
    basis_seq: "4",
    reports: [RPT],
    before: REL,
    after: REL_B,
    ticket: null,
    test: HASH,
    before_bundle_hash: HASH,
  };
}

function command(): TestConnection {
  return {
    ...appTest(),
    kind: "test_command",
    ticket: {
      ticket: TKT,
      check_index: 0,
      check_hash: HASH,
      completion_seq: "8",
    },
  };
}

Deno.test("problems/tests#R1: kind별 연결만 받는다", () => {
  assert(canonicalRequest(appTest()).ok);
  assertFalse(canonicalRequest({ ...appTest(), problem: PRB }).ok);
  assertFalse(canonicalRequest({ ...appTest(), reports: [RPT] }).ok);
  assertFalse(canonicalRequest({ ...appTest(), before: REL, after: REL_B }).ok);
  assert(canonicalRequest(reproduction()).ok);
  assertFalse(canonicalRequest({ ...reproduction(), reports: [] }).ok);
  assertFalse(canonicalRequest({ ...reproduction(), before: REL_B }).ok);
  assertFalse(
    canonicalRequest({
      ...reproduction(),
      target: { bundle_hash: HASH, release: REL },
    }).ok,
  );
  assert(canonicalRequest(command()).ok);
  assertFalse(canonicalRequest({ ...appTest(), ticket: command().ticket }).ok);
});

Deno.test("problems/tests#R16: TestMethod timeout은 1~300000ms다", () => {
  assertEquals(timeoutBounds(), { min: 1, max: 300_000 });
  assert(testMethodInputSchema.safeParse(method(1)).success);
  assert(testMethodInputSchema.safeParse(method(300_000)).success);
  assertFalse(testMethodInputSchema.safeParse(method(0)).success);
  assertFalse(testMethodInputSchema.safeParse(method(300_001)).success);
  const missing = method();
  delete (missing as { timeout_ms?: number }).timeout_ms;
  assertFalse(testMethodInputSchema.safeParse(missing).success);
});

Deno.test("problems/tests#R4: 시작 전·근거 부족은 pass가 되지 않는다", () => {
  const verification = {
    ...connectionOf(appTest()),
    id: "vrf_01ary8h2z3n4p5q6r7s8t9v0wx",
    request_key: "key-1",
    request_principal: "user-1",
    request_hash: HASH,
    execution: HASH,
    result: "pass" as const,
    reason: "ran",
    observations: HASH,
  };
  const frozen = {
    code: HASH,
    input: HASH,
    expected: HASH,
    method: method(),
    blueprint: HASH,
    sdk_dependencies: HASH,
    failure_paths: [{ code: "save_failed", test_hash: HASH }],
    symptom: null,
  };
  const execution = {
    side: "single" as const,
    bundle_hash: HASH,
    test_hash: HASH,
    started_at: "2026-10-04T00:00:00.000Z",
    ended_at: "2026-10-04T00:00:01.000Z",
    exit_code: null,
    end_reason: "timeout" as const,
    runner_version: "1",
    environment: HASH,
    memory_limit_mode: "hard" as const,
    output: HASH,
    output_missing_reason: null,
    truncated: false,
    redaction_notes: ["secret"],
  };
  const evidence = (
    patch: Partial<PreparedResultEvidence>,
  ): PreparedResultEvidence => ({
    request_principal: "user-1",
    request_key: "key-1",
    request_hash: HASH,
    runner_principal: "runner-1",
    verification_canonical: "",
    observations_json: {},
    test: HASH,
    execution: HASH,
    observations: HASH,
    execution_evidence: [execution],
    frozen,
    actually_started: true,
    evidence_sufficient: true,
    unstarted_side: null,
    unstarted_reason: null,
    ...patch,
  });
  const stored: StoredSideStart[] = [{
    request_principal: "user-1",
    request_key: "key-1",
    request_hash: HASH,
    runner_principal: "runner-1",
    side: "single",
    started_at: "2026-10-04T00:00:00.000Z",
    test_hash: HASH,
    bundle_hash: HASH,
  }];
  assertFalse(
    judgeRecordable(
      verification,
      evidence({
        execution_evidence: [{ ...execution, end_reason: "start_failed" }],
        actually_started: false,
      }),
      stored,
    ).ok,
  );
  for (const end_reason of ["timeout", "killed", "runner_lost"] as const) {
    const judged = judgeRecordable(
      verification,
      evidence({
        execution_evidence: [{ ...execution, end_reason }],
      }),
      stored,
    );
    assertFalse(judged.ok);
    assertEquals(judged.ok ? "" : judged.error.code, "invalid_input");
  }
  assert(
    judgeRecordable(
      { ...verification, result: "inconclusive" },
      evidence({
        evidence_sufficient: false,
      }),
      stored,
    ).ok,
  );
  assert(
    judgeRecordable(
      verification,
      evidence({
        execution_evidence: [{
          ...execution,
          end_reason: "exited",
          exit_code: 0,
        }],
      }),
      stored,
    ).ok,
  );
  const wrongExit = {
    ...execution,
    end_reason: "exited" as const,
    exit_code: 1,
  };
  const commandFrozen = {
    ...frozen,
    blueprint: null,
    sdk_dependencies: null,
    failure_paths: null,
  };
  const commandExit = judgeRecordable(
    { ...verification, kind: "test_command", result: "pass" },
    evidence({ frozen: commandFrozen, execution_evidence: [wrongExit] }),
    stored,
  );
  assertFalse(commandExit.ok);
  const beforeOnly: StoredSideStart = {
    ...stored[0],
    side: "before",
    bundle_hash: HASH,
  };
  const reproduced = {
    ...connectionOf(reproduction()),
    id: verification.id,
    request_key: "key-1",
    request_principal: "user-1",
    request_hash: HASH,
    execution: HASH,
    observations: HASH,
  };
  const oneSide = judgeRecordable(
    { ...reproduced, result: "pass", reason: "ran" },
    evidence({
      execution_evidence: [{
        ...execution,
        side: "before",
        end_reason: "exited",
        exit_code: 0,
      }],
    }),
    [beforeOnly],
    reproduction(),
  );
  assertFalse(oneSide.ok);
  const inconclusive = judgeRecordable(
    { ...reproduced, result: "inconclusive", reason: "after did not start" },
    evidence({
      frozen: {
        ...frozen,
        blueprint: null,
        sdk_dependencies: null,
        failure_paths: null,
        symptom: HASH,
      },
      execution_evidence: [{
        ...execution,
        side: "before",
        end_reason: "exited",
        exit_code: 0,
      }],
      observations_json: {
        execution_not_started: { side: "after", reason: "after start_failed" },
      },
      unstarted_reason: "after start_failed",
      unstarted_side: "after",
    }),
    [beforeOnly],
    reproduction(),
  );
  assert(inconclusive.ok);
  const bundle = expectedBundle(reproduction(), "before", HASH);
  assert(bundle.ok);
  assertEquals(bundle.value, HASH);
  const after = expectedBundle(reproduction(), "after", HASH);
  assert(after.ok);
  assertEquals(after.value, HASH_B);
});

Deno.test("problems/tests#R3: 같은 canonical은 같고 다른 입력은 다르다", () => {
  const first = canonicalRequest(appTest());
  const second = canonicalRequest(appTest());
  assert(first.ok && second.ok);
  assertEquals(first.value, second.value);
  const changed = canonicalRequest({ ...appTest(), test: HASH_B });
  assert(changed.ok);
  assert(first.value !== changed.value);
});

Deno.test("problems/tests#R5: 요청 기록은 미실행·실패·시작·결과를 구별한다", () => {
  const base = {
    seq: 1n,
    request_principal: "user-1",
    request_key: "key-1",
    request_hash: HASH,
    accepted: true,
    preparation_failed: false,
    at: null,
    start_unknown: false,
    result_ref: null,
    runner_principal: "runner-1",
    reason: "accepted",
    payload: appTest(),
  } satisfies Omit<RequestRecord, "phase">;
  const waiting = projectRequest([{ ...base, phase: "accepted" }]);
  assertEquals(waiting?.accepted, true);
  assertEquals(waiting?.started_at, null);
  assertEquals(waiting?.result_ref, null);
  const failed = projectRequest([
    { ...base, phase: "accepted" },
    {
      ...base,
      seq: 2n,
      phase: "preparation_failed",
      preparation_failed: true,
      reason: "prep",
    },
  ]);
  assertEquals(failed?.preparation_failed, true);
  assertEquals(failed?.accepted, false);
  const attempted = projectRequest([
    { ...base, phase: "accepted" },
    {
      ...base,
      seq: 2n,
      phase: "start_attempt",
      at: "2026-10-04T00:00:01.000Z",
    },
  ]);
  assertEquals(attempted?.start_attempted_at, "2026-10-04T00:00:01.000Z");
  assertEquals(attempted?.started_at, null);
  const started = projectRequest([
    { ...base, phase: "accepted" },
    {
      ...base,
      seq: 3n,
      phase: "actual_started",
      at: "2026-10-04T00:00:02.000Z",
    },
    {
      ...base,
      seq: 4n,
      phase: "result_ref",
      result_ref: "vrf_01ary8h2z3n4p5q6r7s8t9v0wx",
    },
  ]);
  assertEquals(started?.started_at, "2026-10-04T00:00:02.000Z");
  assertEquals(started?.result_ref, "vrf_01ary8h2z3n4p5q6r7s8t9v0wx");
});
