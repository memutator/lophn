import { assert, assertEquals, assertFalse } from "@std/assert";
import {
  appendActualSideStart,
  appendRequestObservation,
  handleRequestTest,
} from "./commands.ts";
import { handleRecordVerification } from "./record.ts";
import { ctx, fakeTx } from "./support.ts";

import {
  APP,
  attempt,
  blob,
  evidence,
  HASH,
  HASH_B,
  input,
  prepared,
  proof,
  REQUEST_HASH,
  requester,
  runner,
  TEST_HASH,
  verification,
} from "./fixtures.ts";

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
  assert(attempt(tx).ok);
  assert(
    appendActualSideStart(tx, runner(), {
      request_principal: "user-1",
      request_key: "key-1",
      request_hash: REQUEST_HASH,
      side: "single",
      bundle_hash: HASH,
      test_hash: TEST_HASH,
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
  assert(attempt(tx).ok);
  assert(
    appendRequestObservation(tx, runner(), {
      phase: "start_attempt",
      request_principal: "user-1",
      request_key: "key-1",
      request_hash: REQUEST_HASH,
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
  assert(attempt(tx).ok);
  assert(
    appendActualSideStart(tx, runner(), {
      request_principal: "user-1",
      request_key: "key-1",
      request_hash: REQUEST_HASH,
      side: "single",
      bundle_hash: HASH,
      test_hash: TEST_HASH,
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
  assert(attempt(tx).ok);
  assert(
    appendActualSideStart(tx, runner(), {
      request_principal: "user-1",
      request_key: "key-1",
      request_hash: REQUEST_HASH,
      side: "single",
      bundle_hash: HASH,
      test_hash: TEST_HASH,
      started_at: "2026-10-04T00:00:02.000Z",
    }, proof()).ok,
  );
  const before = tx.sql.rows("test_side_starts").length;
  assert(
    appendRequestObservation(tx, runner("runner-2"), {
      phase: "recovery",
      request_principal: "user-1",
      request_key: "key-1",
      request_hash: REQUEST_HASH,
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
    request_hash: REQUEST_HASH,
    side: "single" as const,
    bundle_hash: bundle,
    test_hash: TEST_HASH,
    started_at: "2026-10-04T00:00:02.000Z",
  };
}

Deno.test("problems/tests#R4: 같은 side 재관측은 같고 다른 bundle은 conflict다", () => {
  const tx = fakeTx();
  assert(handleRequestTest(tx, requester(), input(), prepared(input())).ok);
  assert(attempt(tx).ok);
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
  assert(attempt(tx).ok);
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

Deno.test("coding-agent/mcp-server#R33: 요청 timeout은 접수 기록에 남고 같은 key의 다른 timeout은 conflict다", () => {
  const tx = fakeTx();
  const timed = { ...input(), timeout_ms: 90_000 };
  const first = handleRequestTest(tx, requester(), timed, prepared(timed));
  assert(first.ok);
  const stored = JSON.parse(
    String(tx.sql.rows("test_requests")[0].payload),
  ) as { request_timeout_ms?: number };
  assertEquals(stored.request_timeout_ms, 90_000);
  const same = handleRequestTest(tx, requester(), timed, () => {
    throw new Error("retry must not prepare");
  });
  assert(same.ok);
  const other = handleRequestTest(
    tx,
    requester(),
    { ...timed, timeout_ms: 30_000 },
    () => null,
  );
  assertFalse(other.ok);
  assertEquals(other.ok ? "" : other.error.code, "conflict");
  const none = handleRequestTest(tx, requester(), input(), () => null);
  assertFalse(none.ok);
});
