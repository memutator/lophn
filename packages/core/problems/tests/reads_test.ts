import { assert, assertEquals, assertFalse } from "@std/assert";
import {
  type ReadSnapshot,
  type RequestContext,
  TargetAuthorization,
} from "../../../protocol/server/mod.ts";
import {
  createIdSource,
  manualClock,
  seededRandom,
} from "../../../base/mod.ts";
import {
  readTestRequest,
  readVerification,
  readVerificationList,
  verificationRecordedVisibility,
} from "./reads.ts";
import { ctx, memorySql, strictTargetAuthorizer } from "./support.ts";
import { VERIFICATION_PAGE_CAP } from "./model.ts";
import { canonicalJson } from "./canonical.ts";
import { verification } from "./fixtures.ts";

const HASH = "c".repeat(64);
const APP = "app_01ary8h2z3n4p5q6r7s8t9v0wa";
const OTHER = "app_01ary8h2z3n4p5q6r7s8t9v0wb";

function snapshot(
  asOf = "20",
): ReadSnapshot & { sql: ReturnType<typeof memorySql> } {
  const sql = memorySql();
  return {
    sql,
    as_of_seq: asOf,
    port<T>(key: { readonly name: string }): T {
      if (key === TargetAuthorization) return strictTargetAuthorizer() as T;
      throw new Error("no port");
    },
  };
}

function seedRequest(sql: ReturnType<typeof memorySql>) {
  sql.run(
    `insert into test_requests (seq, request_principal, request_key, request_hash, phase, accepted, preparation_failed, at, start_unknown, result_ref, runner_principal, reason, payload) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      1,
      "user-1",
      "key-1",
      HASH,
      "accepted",
      1,
      0,
      "2026-10-04T00:00:00.000Z",
      0,
      null,
      "runner-1",
      "accepted",
      "{}",
    ],
  );
  sql.run(
    `insert into test_requests (seq, request_principal, request_key, request_hash, phase, accepted, preparation_failed, at, start_unknown, result_ref, runner_principal, reason, payload) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      2,
      "user-1",
      "key-1",
      HASH,
      "actual_started",
      1,
      0,
      "2026-10-04T00:00:02.000Z",
      0,
      null,
      "runner-1",
      "started",
      "{}",
    ],
  );
}

Deno.test("problems/tests#R5: GetTestRequest는 자기 key만 읽고 시작과 결과를 구별한다", () => {
  const snap = snapshot();
  seedRequest(snap.sql);
  const own = ctx({
    principal: "user-1",
    actor: "user",
    scope: { operations: ["GetTestRequest"], targets: {} },
  });
  const read = readTestRequest(snap, own, { request_key: "key-1" });
  assert(read.ok);
  assertEquals(read.value.request.started_at, "2026-10-04T00:00:02.000Z");
  assertEquals(read.value.request.result_ref, null);
  const other = readTestRequest(
    snap,
    ctx({
      principal: "user-2",
      actor: "user",
      scope: own.scope,
    }),
    { request_key: "key-1" },
  );
  assertFalse(other.ok);
  assertEquals(other.ok ? "" : other.error.code, "not_found");
});

Deno.test("problems/tests#R2: release 없는 bundle hash 결과를 읽는다", () => {
  const snap = snapshot();
  snap.sql.run(
    `insert into verifications (id, request_principal, request_key, request_hash, kind, app, target_bundle_hash, target_release, problem, basis_seq, before_release, after_release, ticket, ticket_check_index, ticket_check_hash, ticket_completion_seq, test, execution, result, reason, observations, recorded_seq, verification_canonical) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      "vrf_01ary8h2z3n4p5q6r7s8t9v0wx",
      "user-1",
      "key-1",
      HASH,
      "app_test",
      APP,
      HASH,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      HASH,
      HASH,
      "pass",
      "ran",
      HASH,
      "3",
      canonicalJson(
        verification({
          request_hash: HASH,
          target: { bundle_hash: HASH, release: null },
          test: HASH,
          execution: HASH,
          observations: HASH,
        }),
      ),
    ],
  );
  const reader: RequestContext = ctx({
    principal: "user-1",
    actor: "user",
    scope: {
      operations: ["GetVerification", "blob.read"],
      targets: { app: APP },
    },
    conditions: { app: APP },
  });
  const read = readVerification(snap, reader, {
    verification: "vrf_01ary8h2z3n4p5q6r7s8t9v0wx",
    detail: true,
  });
  assert(read.ok);
  assertEquals(read.value.verification.target.release, null);
  assertEquals(read.value.verification.target.bundle_hash, HASH);
  const hidden = readVerification(
    snap,
    ctx({
      principal: "user-1",
      actor: "user",
      scope: { operations: ["GetVerification"], targets: { app: OTHER } },
      conditions: { app: OTHER },
    }),
    {
      verification: "vrf_01ary8h2z3n4p5q6r7s8t9v0wx",
      detail: false,
    },
  );
  assertFalse(hidden.ok);
  assertEquals(hidden.ok ? "" : hidden.error.code, "forbidden");
});

Deno.test("problems/tests#R5: list는 범위 밖 count를 세지 않고 고정 cap을 쓴다", () => {
  const snap = snapshot("1000");
  const ids = createIdSource({
    clock: manualClock(1_700_000_000_000),
    random: seededRandom(1),
  });
  for (let index = 1; index <= VERIFICATION_PAGE_CAP + 2; index++) {
    const id = ids.newId("vrf");
    snap.sql.run(
      `insert into verifications (id, request_principal, request_key, request_hash, kind, app, target_bundle_hash, target_release, problem, basis_seq, before_release, after_release, ticket, ticket_check_index, ticket_check_hash, ticket_completion_seq, test, execution, result, reason, observations, recorded_seq, verification_canonical) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        "user-1",
        `key-${index}`,
        HASH,
        "app_test",
        index === 1 ? OTHER : APP,
        HASH,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        HASH,
        HASH,
        "pass",
        "ran",
        HASH,
        String(index),
        canonicalJson(
          verification({
            id,
            request_key: `key-${index}`,
            request_hash: HASH,
            app: index === 1 ? OTHER : APP,
            target: { bundle_hash: HASH, release: null },
            test: HASH,
            execution: HASH,
            observations: HASH,
          }),
        ),
      ],
    );
  }
  const listed = readVerificationList(
    snap,
    ctx({
      principal: "user-1",
      actor: "user",
      scope: { operations: ["ListVerifications"], targets: { app: APP } },
    }),
    { app: APP },
  );
  assert(listed.ok);
  assertEquals(listed.value.verifications.length, VERIFICATION_PAGE_CAP);
  assert(listed.value.verifications.every((item) => item.app === APP));
  assertEquals(listed.value.next_cursor !== null, true);
});

Deno.test("problems/tests#R5: 제한 target이 다른 결과는 없는 것과 같다", () => {
  const snap = snapshot();
  snap.sql.run(
    `insert into verifications (id, request_principal, request_key, request_hash, kind, app, target_bundle_hash, target_release, problem, basis_seq, before_release, after_release, ticket, ticket_check_index, ticket_check_hash, ticket_completion_seq, test, execution, result, reason, observations, recorded_seq, verification_canonical) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      "vrf_01ary8h2z3n4p5q6r7s8t9v0wx",
      "user-1",
      "key-1",
      HASH,
      "app_test",
      APP,
      HASH,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      HASH,
      HASH,
      "pass",
      "ran",
      HASH,
      "3",
      canonicalJson(
        verification({
          request_hash: HASH,
          target: { bundle_hash: HASH, release: null },
          test: HASH,
          execution: HASH,
          observations: HASH,
        }),
      ),
    ],
  );
  const restricted = ctx({
    principal: "user-2",
    actor: "user",
    scope: {
      operations: ["GetVerification", "ListVerifications"],
      targets: {
        app: APP,
        request_principal: "user-2",
        request_key: "other",
        request_hash: "b".repeat(64),
      },
    },
    conditions: { app: APP },
  });
  const read = readVerification(snap, restricted, {
    verification: "vrf_01ary8h2z3n4p5q6r7s8t9v0wx",
    detail: false,
  });
  assertFalse(read.ok);
  assertEquals(read.ok ? "" : read.error.code, "not_found");
  const listed = readVerificationList(snap, restricted, { app: APP });
  assert(listed.ok);
  assertEquals(listed.value.verifications.length, 0);
  assertEquals(listed.value.next_cursor, null);
  const own = ctx({
    ...restricted,
    principal: "user-1",
    scope: {
      ...restricted.scope,
      targets: {
        app: APP,
        request_principal: "user-1",
        request_key: "key-1",
        request_hash: HASH,
      },
    },
  });
  const ownRead = readVerification(snap, own, {
    verification: "vrf_01ary8h2z3n4p5q6r7s8t9v0wx",
    detail: false,
  });
  assert(ownRead.ok);
  const noOperation = readVerification(
    snap,
    ctx({ ...own, scope: { ...own.scope, operations: [] } }),
    { verification: "vrf_01ary8h2z3n4p5q6r7s8t9v0wx", detail: false },
  );
  assertEquals(noOperation.ok ? "" : noOperation.error.code, "forbidden");
});

Deno.test("problems/tests#R5: 잘못된 cursor는 invalid_input이다", () => {
  const snap = snapshot();
  const reader = ctx({
    scope: { operations: ["ListVerifications"], targets: { app: APP } },
  });
  for (const cursor of ["abc", "-1", "", "00", String(1n << 63n)]) {
    const listed = readVerificationList(snap, reader, { app: APP, cursor });
    assertFalse(listed.ok);
    assertEquals(listed.ok ? "" : listed.error.code, "invalid_input");
  }
  const wide = ((1n << 53n) + 5n).toString();
  const listed = readVerificationList(snap, reader, { app: APP, cursor: wide });
  assert(listed.ok);
  assertEquals(listed.value.verifications.length, 0);
});

Deno.test("problems/tests#R2: 저장된 결과와 다른 event payload는 보이지 않는다", () => {
  const snap = snapshot();
  snap.sql.run(
    `insert into verifications (id, request_principal, request_key, request_hash, kind, app, target_bundle_hash, target_release, problem, basis_seq, before_release, after_release, ticket, ticket_check_index, ticket_check_hash, ticket_completion_seq, test, execution, result, reason, observations, recorded_seq, verification_canonical) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      "vrf_01ary8h2z3n4p5q6r7s8t9v0wx",
      "user-1",
      "key-1",
      HASH,
      "app_test",
      APP,
      HASH,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      HASH,
      HASH,
      "pass",
      "ran",
      HASH,
      "3",
      canonicalJson(
        verification({
          request_hash: HASH,
          target: { bundle_hash: HASH, release: null },
          test: HASH,
          execution: HASH,
          observations: HASH,
        }),
      ),
    ],
  );
  const reader = ctx({
    scope: { operations: ["GetVerification"], targets: { app: APP } },
  });
  const envelope = {
    seq: "3",
    type: "VerificationRecorded" as const,
    subject: "vrf_01ary8h2z3n4p5q6r7s8t9v0wx",
    actor: "machine" as const,
    run: null,
    at: "2026-10-04T00:00:03.000Z",
  };
  const hidden = verificationRecordedVisibility.handle(snap, reader, {
    ...envelope,
    payload: {
      kind: "app_test",
      app: APP,
      target: { bundle_hash: "b".repeat(64), release: null },
      result: "fail",
      test: "b".repeat(64),
      execution: "b".repeat(64),
    },
  });
  assert(hidden.ok);
  assertEquals(hidden.value, false);
  const shown = verificationRecordedVisibility.handle(snap, reader, {
    ...envelope,
    payload: {
      kind: "app_test",
      app: APP,
      target: { bundle_hash: HASH, release: null },
      result: "pass",
      test: HASH,
      execution: HASH,
    },
  });
  assert(shown.ok);
  assertEquals(shown.value, true);
});
