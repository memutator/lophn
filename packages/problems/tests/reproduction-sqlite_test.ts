import { assert, assertEquals, assertFalse, assertThrows } from "@std/assert";
import { canonicalJson } from "./canonical.ts";
import {
  appendActualSideStart,
  appendRequestObservation,
  handleRequestTest,
} from "./commands.ts";
import { handleRecordVerification } from "./record.ts";
import { readVerification, readVerificationList } from "./reads.ts";
import { blob, executed, HASH, requester } from "./fixtures.ts";
import { beforeBundle, reproductionSetup } from "./reproduction-fixtures.ts";
Deno.test("problems/tests#R2 R3: file two-side reproduction은 before release binding과 두 actual_started를 저장", () => {
  const {
    ledger,
    request,
    hash,
    caller,
    preparedValue,
    lifecycleProof,
    execution,
    result,
  } = reproductionSetup();
  try {
    for (
      const patch of [{ before_target: null }, {
        before_target: { release: request.after!, bundle_hash: beforeBundle },
      }, { before_bundle_hash: HASH }]
    ) {
      assertFalse(
        ledger.transaction((tx) =>
          handleRequestTest(
            tx,
            requester(),
            request,
            () => ({ ...preparedValue, ...patch }),
          )
        ).ok,
      );
    }
    const duplicateRequest = ledger.transaction((tx) =>
      handleRequestTest(tx, requester(), {
        ...request,
        reports: [request.reports[0], request.reports[0]],
      }, () => preparedValue)
    );
    assertFalse(duplicateRequest.ok);
    assertEquals(duplicateRequest.error.code, "invalid_input");
    assertEquals(ledger.sql.all("select * from test_requests", []).length, 0);
    assert(
      ledger.transaction((tx) =>
        handleRequestTest(tx, requester(), request, () => preparedValue)
      ).ok,
    );
    assert(
      ledger.transaction((tx) =>
        appendRequestObservation(tx, caller, {
          phase: "start_attempt",
          request_principal: "user-1",
          request_key: "key-1",
          request_hash: hash,
          at: executed.started_at,
          previous_runner: null,
          runner_principal: caller.principal,
          reason: "attempt",
        }, lifecycleProof)
      ).ok,
    );
    for (const item of execution) {
      const start = {
        request_principal: "user-1",
        request_key: "key-1",
        request_hash: hash,
        side: item.side,
        bundle_hash: item.bundle_hash,
        test_hash: request.test,
        started_at: item.started_at,
      };
      assertFalse(
        ledger.transaction((tx) =>
          appendActualSideStart(tx, caller, {
            ...start,
            bundle_hash: "c".repeat(64),
          }, lifecycleProof)
        ).ok,
      );
      const first = ledger.transaction((tx) =>
        appendActualSideStart(tx, caller, start, lifecycleProof)
      );
      const retry = ledger.transaction((tx) =>
        appendActualSideStart(tx, caller, start, lifecycleProof)
      );
      assert(first.ok && retry.ok && first.value === retry.value);
    }
    assertEquals(
      ledger.sql.get(
        "select count(*) as n from test_requests where phase='actual_started'",
        [],
      )?.n,
      2n,
    );
    const { value, preparedEvidence } = result();
    const beforeRequests = ledger.sql.all("select * from test_requests", []);
    const duplicate = ledger.transaction((tx) =>
      handleRecordVerification(tx, caller, {
        verification: {
          ...value,
          reports: [value.reports[0], value.reports[0]],
        },
        blobs: [],
      }, () => {
        throw new Error("duplicate reports must not prepare evidence");
      })
    );
    assertFalse(duplicate.ok);
    assertEquals(duplicate.error.code, "invalid_input");
    for (
      const table of [
        "probe_events",
        "probe_refs",
        "verifications",
        "verification_reports",
      ]
    ) {
      assertEquals(ledger.sql.all(`select * from ${table}`, []).length, 0);
    }
    assertEquals(
      ledger.sql.all("select * from test_requests", []),
      beforeRequests,
    );

    assert(
      ledger.transaction((tx) =>
        handleRecordVerification(
          {
            ...tx,
            sql: {
              ...tx.sql,
              run(statement, params) {
                const inserted = tx.sql.run(statement, params);
                if (statement.startsWith("insert into verifications")) {
                  assertThrows(() =>
                    tx.sql.run(
                      "insert into verification_reports values (?, ?)",
                      [
                        value.id,
                        "rpt_01ary8h2z3n4p5q6r7s8t9v0wg",
                      ],
                    )
                  );
                }
                return inserted;
              },
            },
          },
          caller,
          {
            verification: value,
            blobs: blob(caller.principal, value, preparedEvidence),
          },
          preparedEvidence,
        )
      ).ok,
    );
    assertEquals(
      ledger.sql.all("select report from verification_reports", []).length,
      2,
    );
    const reader = {
      ...caller,
      scope: {
        ...caller.scope,
        operations: ["GetVerification", "ListVerifications"],
      },
      conditions: { app: caller.scope.targets.app as string },
    };
    const read = readVerification(ledger.snapshot("1"), reader, {
      verification: value.id,
      detail: false,
    });
    assert(read.ok);
    assertEquals(canonicalJson(read.value.verification), canonicalJson(value));
    const snapshot = ledger.snapshot("1");
    const broken = readVerification(
      {
        ...snapshot,
        sql: {
          ...snapshot.sql,
          all(statement, params) {
            const rows = snapshot.sql.all(statement, params);
            return statement.includes("verification_reports")
              ? rows.slice(1)
              : rows;
          },
        },
      },
      reader,
      { verification: value.id, detail: false },
    );
    assertFalse(broken.ok);
    assertEquals(broken.error.code, "internal");
    const list = readVerificationList(ledger.snapshot("1"), reader, {
      app: value.app,
    });
    assert(list.ok);
    assertEquals(list.value.verifications[0].reports, request.reports);
    for (
      const report of [...request.reports, "rpt_01ary8h2z3n4p5q6r7s8t9v0wg"]
    ) {
      assertThrows(() =>
        ledger.sql.run("insert into verification_reports values (?, ?)", [
          value.id,
          report,
        ])
      );
    }
    assertThrows(() =>
      ledger.sql.run("insert into verification_reports values (?, ?)", [
        "vrf_01ary8h2z3n4p5q6r7s8t9v0wz",
        request.reports[0],
      ])
    );
  } finally {
    ledger.close();
  }
});

Deno.test("problems/tests#R4: partial reproduction은 저장 observations의 다른 side 미시작 이유와 inconclusive가 필요", () => {
  const {
    ledger,
    request,
    hash,
    caller,
    preparedValue,
    lifecycleProof,
    execution,
    result,
  } = reproductionSetup();
  try {
    assert(
      ledger.transaction((tx) =>
        handleRequestTest(tx, requester(), request, () => preparedValue)
      ).ok,
    );
    assert(
      ledger.transaction((tx) =>
        appendRequestObservation(tx, caller, {
          phase: "start_attempt",
          request_principal: "user-1",
          request_key: "key-1",
          request_hash: hash,
          at: executed.started_at,
          previous_runner: null,
          runner_principal: caller.principal,
          reason: "attempt",
        }, lifecycleProof)
      ).ok,
    );
    assert(
      ledger.transaction((tx) =>
        appendActualSideStart(tx, caller, {
          request_principal: "user-1",
          request_key: "key-1",
          request_hash: hash,
          side: "before",
          bundle_hash: beforeBundle,
          test_hash: request.test,
          started_at: executed.started_at,
        }, lifecycleProof)
      ).ok,
    );
    assertFalse(
      ledger.transaction((tx) =>
        appendRequestObservation(tx, caller, {
          phase: "preparation_failed",
          request_principal: "user-1",
          request_key: request.request_key,
          request_hash: hash,
          at: null,
          previous_runner: null,
          runner_principal: caller.principal,
          reason: "failed",
        }, { ...lifecycleProof, phase: "preparation_failed" })
      ).ok,
    );
    for (
      const observations of [{ checked: true }, {
        execution_not_started: { side: "before", reason: "failed" },
      }]
    ) {
      const { value, preparedEvidence } = result(
        [execution[0]],
        observations,
        "inconclusive",
      );
      assertFalse(
        ledger.transaction((tx) =>
          handleRecordVerification(tx, caller, {
            verification: value,
            blobs: blob(caller.principal, value, preparedEvidence),
          }, {
            ...preparedEvidence,
            unstarted_side: "after",
            unstarted_reason: "failed",
          })
        ).ok,
      );
    }
    const observations = {
      execution_not_started: { side: "after", reason: "failed" },
    };
    const pass = result([execution[0]], observations, "pass");
    assertFalse(
      ledger.transaction((tx) =>
        handleRecordVerification(tx, caller, {
          verification: pass.value,
          blobs: blob(caller.principal, pass.value, pass.preparedEvidence),
        }, {
          ...pass.preparedEvidence,
          unstarted_side: "after",
          unstarted_reason: "failed",
        })
      ).ok,
    );
    const final = result([execution[0]], observations, "inconclusive");
    assert(
      ledger.transaction((tx) =>
        handleRecordVerification(tx, caller, {
          verification: final.value,
          blobs: blob(caller.principal, final.value, final.preparedEvidence),
        }, {
          ...final.preparedEvidence,
          unstarted_side: "after",
          unstarted_reason: "failed",
        })
      ).ok,
    );
  } finally {
    ledger.close();
  }
});
