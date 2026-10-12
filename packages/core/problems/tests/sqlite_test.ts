import { assert, assertEquals, assertFalse, assertThrows } from "@std/assert";
import { appendActualSideStart, handleRequestTest } from "./commands.ts";
import { handleRecordVerification } from "./record.ts";
import {
  readTestRequest,
  readVerification,
  readVerificationList,
  verificationRecordedVisibility,
} from "./reads.ts";
import { loadRecords } from "./records.ts";
import { canonicalJson } from "./canonical.ts";
import { fileLedger } from "./testing/mod.ts";
import { ctx } from "./support.ts";
import {
  accept,
  APP,
  attempt,
  blob,
  evidence,
  executed,
  frozen,
  HASH,
  input,
  prepared,
  proof,
  REQUEST_HASH,
  requester,
  runner,
  TEST_HASH,
  verification,
} from "./fixtures.ts";

const side = () => ({
  request_principal: "user-1",
  request_key: "key-1",
  request_hash: REQUEST_HASH,
  side: "single" as const,
  bundle_hash: HASH,
  test_hash: TEST_HASH,
  started_at: executed.started_at,
});
const body = () => ({ verification: verification(), blobs: blob() });
function started(ledger: ReturnType<typeof fileLedger>) {
  assert(ledger.transaction(accept).ok);
  assert(ledger.transaction(attempt).ok);
  assert(
    ledger.transaction((tx) =>
      appendActualSideStart(tx, runner(), side(), proof())
    ).ok,
  );
}

Deno.test("problems/tests#R1 R2 R3 R5: file WAL bigint handler 접수→시작→결과→read와 전체 본문 retry", () => {
  const ledger = fileLedger();
  try {
    assertEquals(
      ledger.sql.get("PRAGMA journal_mode", [])?.journal_mode,
      "wal",
    );
    assert(ledger.transaction(accept).ok);
    const own = ctx({
      principal: "user-1",
      actor: "user",
      scope: { operations: ["GetTestRequest"], targets: {} },
    });
    const pending = readTestRequest(ledger.snapshot("0"), own, {
      request_key: "key-1",
    });
    assert(pending.ok && pending.value.request.accepted);
    assertEquals(pending.value.request.started_at, null);
    const wide = (1n << 53n) + 3n;
    ledger.sql.run(
      "insert into test_requests select ?, request_principal, request_key, request_hash, 'actual_started', accepted, preparation_failed, '2026-10-04T00:00:00.000Z', 0, result_ref, runner_principal, previous_runner, 'unknown', payload from test_requests where seq=1",
      [wide],
    );
    assertEquals(loadRecords(ledger.sql, "user-1", "key-1")[1].seq, wide);
    assert(ledger.transaction(attempt).ok);
    assertEquals(loadRecords(ledger.sql, "user-1", "key-1")[2].seq, wide + 1n);
    assert(
      ledger.transaction((tx) =>
        appendActualSideStart(tx, runner(), side(), proof())
      ).ok,
    );
    ledger.sql.run("insert into probe_events values (?, null, '{}')", [wide]);
    const first = ledger.transaction((tx) =>
      handleRecordVerification(tx, runner(), body(), evidence())
    );
    assert(first.ok);
    assertEquals(first.value.seq, String(wide + 1n));
    ledger.db.exec("PRAGMA foreign_keys=OFF");
    for (
      const parent of [verification().id, "vrf_01ary8h2z3n4p5q6r7s8t9v0wz"]
    ) {
      assertThrows(() =>
        ledger.sql.run("insert into verification_reports values (?, ?)", [
          parent,
          "rpt_01ary8h2z3n4p5q6r7s8t9v0we",
        ])
      );
    }
    ledger.db.exec("PRAGMA foreign_keys=ON");
    const retry = ledger.transaction((tx) =>
      handleRecordVerification(tx, runner(), {
        verification: verification(),
        blobs: [],
      }, () => {
        throw new Error("expired preparation must not be reused");
      })
    );
    assert(retry.ok);
    assertEquals(retry.value.seq, first.value.seq);
    const beforeRetry = ledger.sql.all("select * from test_requests", []);
    for (
      const denied of [
        ctx({ ...runner(), scope: { ...runner().scope, operations: [] } }),
        runner("old-runner"),
        ctx({
          ...runner(),
          scope: { ...runner().scope, targets: { app: APP } },
        }),
        ...["app", "request_principal", "request_key", "request_hash"].map(
          (key) => {
            const targets = { ...runner().scope.targets };
            delete targets[key];
            return ctx({ ...runner(), scope: { ...runner().scope, targets } });
          },
        ),
        ctx({
          ...runner(),
          scope: {
            ...runner().scope,
            targets: { ...runner().scope.targets, unknown: "yes" },
          },
        }),
        ctx({ ...runner(), principal: "test-child" }),
      ]
    ) {
      const deniedRetry = ledger.transaction((tx) =>
        handleRecordVerification(tx, denied, {
          verification: verification(),
          blobs: [],
        }, () => {
          throw new Error("denied retry must not prepare evidence");
        })
      );
      assertFalse(deniedRetry.ok);
      assertEquals(deniedRetry.error.code, "forbidden");
      assertEquals(
        ledger.sql.all("select * from test_requests", []),
        beforeRetry,
      );
    }
    for (
      const patch of [
        { reason: "changed" },
        { result: "fail" as const },
        { execution: HASH },
        { observations: HASH },
        { test: HASH },
        { reports: ["rpt_01ary8h2z3n4p5q6r7s8t9v0we"] },
        {
          ticket: {
            ticket: "tkt_01ary8h2z3n4p5q6r7s8t9v0wf",
            check_index: 0,
            check_hash: HASH,
            completion_seq: "4",
          },
        },
      ]
    ) {
      const changed = ledger.transaction((tx) =>
        handleRecordVerification(tx, runner(), {
          verification: verification(patch),
          blobs: [],
        }, null)
      );
      assertFalse(changed.ok);
      assertEquals(changed.error.code, "conflict");
    }
    const reader = ctx({
      scope: {
        operations: ["GetVerification"],
        targets: {
          app: APP,
          request_principal: "user-1",
          request_key: "key-1",
          request_hash: REQUEST_HASH,
        },
      },
      conditions: { app: APP },
    });
    assert(
      readVerification(ledger.snapshot(first.value.seq), reader, {
        verification: verification().id,
        detail: false,
      }).ok,
    );
    assertFalse(
      readVerification(ledger.snapshot("0"), reader, {
        verification: verification().id,
        detail: false,
      }).ok,
    );
    assertEquals(
      Number(ledger.sql.get("select count(*) as n from probe_refs", [])?.n),
      blob().length,
    );
  } finally {
    ledger.close();
  }
});

Deno.test("problems/tests#R2: actual canonical digest와 required blob 거절은 event까지 rollback", () => {
  const ledger = fileLedger();
  try {
    started(ledger);
    for (
      const patch of [
        { frozen: { ...frozen, input: "b".repeat(64) } },
        { execution_evidence: [{ ...executed, runner_version: "forged" }] },
        { observations_json: { checked: false } },
        { verification_canonical: "" },
      ]
    ) {
      const rejected = ledger.transaction((tx) =>
        handleRecordVerification(tx, runner(), body(), {
          ...evidence(),
          ...patch,
        })
      );
      assertFalse(rejected.ok);
    }
    for (
      const bad of [
        [],
        blob().slice(1),
        blob().map((b, i) => i === 0 ? { ...b, owner_key: "wrong" } : b),
        blob().map((b, i) =>
          i === 0 && b.source.kind === "prepared"
            ? {
              ...b,
              source: {
                kind: "prepared" as const,
                blob: { ...b.source.blob, principal: "other" },
              },
            }
            : b
        ),
        blob().map((b, i) =>
          i === 0 && b.source.kind === "prepared"
            ? {
              ...b,
              source: {
                kind: "prepared" as const,
                blob: { ...b.source.blob, purpose: "wrong" },
              },
            }
            : b
        ),
      ]
    ) {
      assertFalse(
        ledger.transaction((tx) =>
          handleRecordVerification(tx, runner(), {
            verification: verification(),
            blobs: bad,
          }, evidence())
        ).ok,
      );
    }
    ledger.failBlobs(true);
    assertFalse(
      ledger.transaction((tx) =>
        handleRecordVerification(tx, runner(), body(), evidence())
      ).ok,
    );
    assertEquals(
      ledger.sql.get("select count(*) as n from verifications", [])?.n,
      0n,
    );
    assertEquals(
      ledger.sql.get("select count(*) as n from probe_events", [])?.n,
      0n,
    );
    assertEquals(
      ledger.sql.get("select count(*) as n from probe_refs", [])?.n,
      0n,
    );
    const bad = prepared(input())();
    assertFalse(
      ledger.transaction((tx) =>
        handleRequestTest(
          tx,
          requester(),
          { ...input(), request_key: "other" },
          () => ({ ...bad, request_key: "other", request_hash: HASH }),
        )
      ).ok,
    );
  } finally {
    ledger.close();
  }
});

Deno.test("problems/tests#R5: scope predicates는 forbidden 51행 뒤 allowed 결과를 읽고 event seq도 묶는다", () => {
  const ledger = fileLedger();
  try {
    started(ledger);
    assert(
      ledger.transaction((tx) =>
        handleRecordVerification(tx, runner(), body(), evidence())
      ).ok,
    );
    for (let index = 2; index < 54; index++) {
      ledger.sql.run(
        "insert into verifications select ?, ?, ?, request_hash, kind, app, target_bundle_hash, target_release, problem, basis_seq, before_release, after_release, ticket, ticket_check_index, ticket_check_hash, ticket_completion_seq, test, execution, result, reason, observations, ?, ? from verifications where recorded_seq='1'",
        [
          "vrf_" + String(index).padStart(26, "0"),
          index === 53 ? "allowed" : "forbidden",
          `key-${index}`,
          String(index),
          canonicalJson(
            verification({
              id: "vrf_" + String(index).padStart(26, "0"),
              request_principal: index === 53 ? "allowed" : "forbidden",
              request_key: `key-${index}`,
            }),
          ),
        ],
      );
    }
    const reader = ctx({
      scope: {
        operations: ["ListVerifications", "GetVerification"],
        targets: { app: APP, request_principal: "allowed" },
      },
      conditions: { app: APP },
    });
    const list = readVerificationList(ledger.snapshot("53"), reader, {
      app: APP,
    });
    assert(list.ok);
    assertEquals(list.value.verifications.length, 1);
    assertEquals(list.value.verifications[0].request_principal, "allowed");
    assertEquals(list.value.next_cursor, null);
    assertFalse(
      readVerificationList(
        ledger.snapshot("53"),
        ctx({
          ...reader,
          scope: { ...reader.scope, targets: { app: APP, arbitrary: "yes" } },
        }),
        { app: APP },
      ).ok,
    );
    const event = {
      seq: "1",
      type: "VerificationRecorded" as const,
      subject: verification().id,
      actor: "machine" as const,
      run: null,
      at: executed.ended_at,
      payload: {
        kind: "app_test" as const,
        app: APP,
        target: input().target,
        result: "pass" as const,
        test: TEST_HASH,
        execution: verification().execution,
      },
    };
    const denied = verificationRecordedVisibility.handle(
      ledger.snapshot("53"),
      reader,
      event,
    );
    assert(denied.ok && !denied.value);
    const open = ctx({
      scope: { operations: ["GetVerification"], targets: { app: APP } },
    });
    const altered = verificationRecordedVisibility.handle(
      ledger.snapshot("53"),
      open,
      { ...event, seq: "2" },
    );
    assert(altered.ok && !altered.value);
    const shown = verificationRecordedVisibility.handle(
      ledger.snapshot("53"),
      open,
      event,
    );
    assert(shown.ok && shown.value);
  } finally {
    ledger.close();
  }
});
