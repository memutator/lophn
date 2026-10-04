import { assert, assertEquals, assertFalse } from "@std/assert";
import type {
  BlobRefRegistration,
  RequestContext,
} from "../../contracts/platform/mod.ts";
import type { Verification } from "../../contracts/problems/mod.ts";
import {
  appendActualSideStart,
  appendRequestObservation,
  handleRequestTest,
} from "./commands.ts";
import { handleRecordVerification } from "./record.ts";
import {
  canonicalRequest,
  type PreparedResultEvidence,
  type TestConnection,
} from "./model.ts";
import { ctx, fakeTx } from "./support.ts";

const HASH = "a".repeat(64);
const HASH_B = "b".repeat(64);
const APP = "app_01ary8h2z3n4p5q6r7s8t9v0wa";
const VRF = "vrf_01ary8h2z3n4p5q6r7s8t9v0wx";

function input(patch: Partial<TestConnection> = {}) {
  return {
    request_key: "key-1",
    kind: "app_test" as const,
    app: APP,
    target: { bundle_hash: HASH, release: null },
    problem: null,
    basis_seq: null,
    reports: [],
    before: null,
    after: null,
    ticket: null,
    test: HASH,
    ...patch,
  };
}

function prepared(value: ReturnType<typeof input>, principal = "user-1") {
  const canonical = canonicalRequest({ ...value, before_bundle_hash: null });
  assert(canonical.ok);
  return () => ({
    request_principal: principal,
    request_key: value.request_key,
    app: value.app,
    request_hash: HASH,
    canonical: canonical.value,
    runner_principal: "runner-1",
    before_bundle_hash: null,
    app_in_scope: true,
    refs_ok: true,
    unavailable: false,
  });
}

function proof(phase: "start_attempt" | "recovery" = "start_attempt") {
  return {
    machine_principal: phase === "recovery" ? "runner-1" : "runner-1",
    phase,
    request_principal: "user-1",
    request_key: "key-1",
    request_hash: HASH,
    app: APP,
    current_runner: "runner-1",
    operation: "observe_test_request" as const,
  };
}

function requester(): RequestContext {
  return ctx({
    principal: "user-1",
    actor: "user",
    scope: { operations: ["RequestTest"], targets: { app: APP } },
  });
}

function runner(principal = "runner-1"): RequestContext {
  return ctx({
    principal,
    actor: "machine",
    scope: {
      operations: ["RecordVerification"],
      targets: {
        app: APP,
        request_principal: "user-1",
        request_key: "key-1",
        request_hash: HASH,
      },
    },
  });
}

const frozen = {
  code: HASH,
  input: HASH,
  expected: HASH,
  method: {
    argv: ["test", "app_test.ts"],
    cwd: ".",
    timeout_ms: 60_000,
    expected_exit_code: 0,
    environment: HASH,
  },
  blueprint: HASH,
  sdk_dependencies: HASH,
  failure_paths: [{ code: "save_failed", test_hash: HASH }],
  symptom: null,
};
const executed = {
  side: "single" as const,
  bundle_hash: HASH,
  test_hash: HASH,
  started_at: "2026-10-04T00:00:02.000Z",
  ended_at: "2026-10-04T00:00:03.000Z",
  exit_code: 0,
  end_reason: "exited" as const,
  runner_version: "1",
  environment: HASH,
  memory_limit_mode: "hard" as const,
  output: HASH,
  output_missing_reason: null,
  truncated: false,
  redaction_notes: [] as string[],
};

function evidence(): PreparedResultEvidence {
  return {
    request_principal: "user-1",
    request_key: "key-1",
    request_hash: HASH,
    runner_principal: "runner-1",
    verification_canonical: "",
    test: HASH,
    execution: HASH,
    observations: HASH,
    frozen,
    execution_evidence: [executed],
    actually_started: true,
    evidence_sufficient: true,
    unstarted_side: null,
    unstarted_reason: null,
  };
}

function verification(patch: Partial<Verification> = {}): Verification {
  return {
    id: VRF,
    request_principal: "user-1",
    request_hash: HASH,
    ...input(),
    execution: HASH,
    result: "pass",
    reason: "ran",
    observations: HASH,
    ...patch,
  };
}

const BLOB_FIELDS = [
  "test",
  "execution",
  "observations",
  "frozen_code",
  "frozen_input",
  "frozen_expected",
  "method_environment",
  "execution_0_environment",
  "execution_0_output",
  "blueprint",
  "sdk_dependencies",
  "failure_save_failed",
];

function blob(principal = "runner-1"): BlobRefRegistration[] {
  return BLOB_FIELDS.map((field) => ({
    owner_kind: "verification",
    owner_key: VRF,
    field,
    registered_seq: "1",
    source: {
      kind: "prepared" as const,
      blob: {
        preparation: "prep-1",
        principal,
        purpose: "frozen_test",
        hash: HASH,
        size_bytes: 12,
      },
    },
  }));
}

Deno.test("problems/tests#R3: 같은 입력은 같은 접수고 다른 입력은 conflict다", () => {
  const tx = fakeTx();
  const first = handleRequestTest(tx, requester(), input(), prepared(input()));
  assert(first.ok);
  const retry = handleRequestTest(tx, requester(), input(), () => {
    throw new Error("retry must not prepare");
  });
  assert(retry.ok);
  assertEquals(retry.value, first.value);
  assertEquals(tx.sql.rows("test_requests").length, 1);
  const changed = handleRequestTest(
    tx,
    requester(),
    input({ test: HASH_B }),
    () => null,
  );
  assertFalse(changed.ok);
  assertEquals(changed.ok ? "" : changed.error.code, "conflict");
  const other = handleRequestTest(
    tx,
    ctx({
      principal: "user-2",
      actor: "user",
      scope: { operations: ["RequestTest"], targets: { app: APP } },
    }),
    input(),
    prepared(input(), "user-2"),
  );
  assert(other.ok);
  assertEquals(tx.sql.rows("test_requests").length, 2);
});

Deno.test("problems/tests#R1: runner machine만 RecordVerification한다", () => {
  const tx = fakeTx();
  assert(handleRequestTest(tx, requester(), input(), prepared(input())).ok);
  assert(
    appendActualSideStart(tx, runner(), {
      request_principal: "user-1",
      request_key: "key-1",
      request_hash: HASH,
      side: "single",
      bundle_hash: HASH,
      test_hash: HASH,
      started_at: "2026-10-04T00:00:02.000Z",
    }, proof()).ok,
  );
  const body = {
    verification: verification(),
    blobs: blob(),
  };
  for (
    const actor of [
      ctx({
        principal: "runner-1",
        actor: "agent:asg_01ary8h2z3n4p5q6r7s8t9v0wg",
      }),
      ctx({
        principal: "runner-1",
        actor: "app:app_01ary8h2z3n4p5q6r7s8t9v0wa",
      }),
      ctx({ principal: "child", actor: "machine", scope: runner().scope }),
    ]
  ) {
    const rejected = handleRecordVerification(tx, actor, body, evidence());
    assertFalse(rejected.ok);
    assertEquals(rejected.ok ? "" : rejected.error.code, "forbidden");
  }
  const recorded = handleRecordVerification(tx, runner(), body, evidence());
  assert(recorded.ok);
  assertEquals(tx.sql.rows("verifications").length, 1);
});

Deno.test("problems/tests#R4: 실제 시작 없는 요청은 Verification이 없다", () => {
  const tx = fakeTx();
  assert(handleRequestTest(tx, requester(), input(), prepared(input())).ok);
  assert(
    appendRequestObservation(tx, runner(), {
      phase: "start_attempt",
      request_principal: "user-1",
      request_key: "key-1",
      request_hash: HASH,
      at: "2026-10-04T00:00:01.000Z",
      previous_runner: null,
      runner_principal: "runner-1",
      reason: "attempt",
    }, proof()).ok,
  );
  const rejected = handleRecordVerification(tx, runner(), {
    verification: verification(),
    blobs: blob(),
  }, evidence());
  assertFalse(rejected.ok);
  assertEquals(tx.sql.rows("verifications").length, 0);
});

Deno.test("problems/tests#R3: 같은 결과 본문은 원 seq, 다른 id는 conflict다", () => {
  const tx = fakeTx();
  assert(handleRequestTest(tx, requester(), input(), prepared(input())).ok);
  assert(
    appendActualSideStart(tx, runner(), {
      request_principal: "user-1",
      request_key: "key-1",
      request_hash: HASH,
      side: "single",
      bundle_hash: HASH,
      test_hash: HASH,
      started_at: "2026-10-04T00:00:02.000Z",
    }, proof()).ok,
  );
  const body = { verification: verification(), blobs: blob() };
  const first = handleRecordVerification(tx, runner(), body, evidence());
  assert(first.ok);
  const retry = handleRecordVerification(tx, runner(), body, evidence());
  assert(retry.ok);
  assertEquals(retry.value.seq, first.value.seq);
  const other = handleRecordVerification(tx, runner(), {
    verification: verification({ id: "vrf_01ary8h2z3n4p5q6r7s8t9v0wy" }),
    blobs: blob(),
  }, evidence());
  assertFalse(other.ok);
  assertEquals(other.ok ? "" : other.error.code, "conflict");
});

Deno.test("problems/tests#R17: recovery의 새 runner만 결과를 쓴다", () => {
  const tx = fakeTx();
  assert(handleRequestTest(tx, requester(), input(), prepared(input())).ok);
  assert(
    appendActualSideStart(tx, runner(), {
      request_principal: "user-1",
      request_key: "key-1",
      request_hash: HASH,
      side: "single",
      bundle_hash: HASH,
      test_hash: HASH,
      started_at: "2026-10-04T00:00:02.000Z",
    }, proof()).ok,
  );
  const before = tx.sql.rows("test_side_starts").length;
  assert(
    appendRequestObservation(tx, runner(), {
      phase: "recovery",
      request_principal: "user-1",
      request_key: "key-1",
      request_hash: HASH,
      at: "2026-10-04T00:00:04.000Z",
      previous_runner: "runner-1",
      runner_principal: "runner-2",
      reason: "replaced",
    }, proof("recovery")).ok,
  );
  const stolen = handleRecordVerification(tx, runner("runner-1"), {
    verification: verification(),
    blobs: blob(),
  }, evidence());
  assertFalse(stolen.ok);
  assertEquals(stolen.ok ? "" : stolen.error.code, "forbidden");
  const recorded = handleRecordVerification(tx, runner("runner-2"), {
    verification: verification(),
    blobs: blob("runner-2"),
  }, { ...evidence(), runner_principal: "runner-2" });
  assert(recorded.ok);
  assertEquals(tx.sql.rows("test_side_starts").length, before);
});

function side(bundle = HASH) {
  return {
    request_principal: "user-1",
    request_key: "key-1",
    request_hash: HASH,
    side: "single" as const,
    bundle_hash: bundle,
    test_hash: HASH,
    started_at: "2026-10-04T00:00:02.000Z",
  };
}

Deno.test("problems/tests#R4: 같은 side 재관측은 같고 다른 bundle은 conflict다", () => {
  const tx = fakeTx();
  assert(handleRequestTest(tx, requester(), input(), prepared(input())).ok);
  const body = side();
  assert(appendActualSideStart(tx, runner(), body, proof()).ok);
  const retry = appendActualSideStart(tx, runner(), body, proof());
  assert(retry.ok);
  assertEquals(tx.sql.rows("test_side_starts").length, 1);
  const changed = appendActualSideStart(tx, runner(), side(HASH_B), proof());
  assertFalse(changed.ok);
  assertEquals(changed.ok ? "" : changed.error.code, "conflict");
  assertEquals(tx.sql.rows("test_side_starts").length, 1);
});

Deno.test("problems/tests#R2: blob 등록 실패는 결과 행이 없다", () => {
  const tx = fakeTx({
    blob: () => ({ ok: false, error: { code: "forbidden", message: "blob" } }),
  });
  assert(handleRequestTest(tx, requester(), input(), prepared(input())).ok);
  assert(appendActualSideStart(tx, runner(), side(), proof()).ok);
  const rejected = handleRecordVerification(
    tx,
    runner(),
    { verification: verification(), blobs: blob() },
    evidence(),
  );
  assertFalse(rejected.ok);
  assertEquals(tx.sql.rows("verifications").length, 0);
});
