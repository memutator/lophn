import { assert, assertEquals, assertFalse } from "@std/assert";
import { canonicalHash, canonicalJson } from "./canonical.ts";
import {
  appendActualSideStart,
  appendRequestObservation,
  handleRequestTest,
} from "./commands.ts";
import { handleRecordVerification } from "./record.ts";
import { fileLedger } from "./testing/mod.ts";
import { ctx } from "./support.ts";
import {
  blob,
  evidence,
  executed,
  frozen,
  HASH,
  input,
  prepared,
  proof,
  requester,
  runner,
  verification,
} from "./fixtures.ts";
const beforeBundle = "b".repeat(64);
Deno.test("problems/tests#R2: 같은 code의 서로 다른 failure path hash는 index owner key로 둘 다 영구 등록", () => {
  const ledger = fileLedger();
  try {
    const fixed = {
      ...frozen,
      failure_paths: [{ code: "save_failed", test_hash: HASH }, {
        code: "save_failed",
        test_hash: beforeBundle,
      }],
    };
    const request = input({ test: canonicalHash(fixed) });
    const admission = prepared(request)();
    const caller = ctx({
      ...runner(),
      scope: {
        ...runner().scope,
        targets: {
          ...runner().scope.targets,
          request_hash: admission.request_hash,
        },
      },
    });
    const lifecycleProof = { ...proof(), request_hash: admission.request_hash };
    assert(
      ledger.transaction((tx) =>
        handleRequestTest(tx, requester(), request, () => admission)
      ).ok,
    );
    assert(
      ledger.transaction((tx) =>
        appendRequestObservation(tx, caller, {
          phase: "start_attempt",
          request_principal: "user-1",
          request_key: "key-1",
          request_hash: admission.request_hash,
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
          request_hash: admission.request_hash,
          side: "single",
          bundle_hash: HASH,
          test_hash: request.test,
          started_at: executed.started_at,
        }, lifecycleProof)
      ).ok,
    );
    const execution = [{ ...executed, test_hash: request.test }];
    const value = verification({
      ...request,
      request_hash: admission.request_hash,
      execution: canonicalHash(execution),
    });
    const preparedEvidence = {
      ...evidence(),
      request_hash: admission.request_hash,
      verification_canonical: canonicalJson(value),
      test: request.test,
      execution: value.execution,
      frozen: fixed,
      execution_evidence: execution,
    };
    const blobs = blob(caller.principal, value, preparedEvidence);
    const failures = blobs.filter((b) =>
      b.owner_kind === "verification_failure_path"
    );
    assertEquals(failures.map((b) => b.owner_key), [
      `${value.id}:0`,
      `${value.id}:1`,
    ]);
    assertFalse(
      ledger.transaction((tx) =>
        handleRecordVerification(tx, caller, {
          verification: value,
          blobs: blobs.filter((b) => b.owner_key !== `${value.id}:1`),
        }, preparedEvidence)
      ).ok,
    );
    assert(
      ledger.transaction((tx) =>
        handleRecordVerification(
          tx,
          caller,
          { verification: value, blobs },
          preparedEvidence,
        )
      ).ok,
    );
    assertEquals(
      ledger.sql.get(
        "select count(*) as n from probe_refs where binding like '%verification_failure_path%'",
        [],
      )?.n,
      2n,
    );
  } finally {
    ledger.close();
  }
});
