import { assert, assertEquals, assertFalse } from "@std/assert";
import { appendActualSideStart, appendRequestObservation } from "./commands.ts";
import { handleRecordVerification } from "./record.ts";
import { fileLedger } from "./sqlite-support.ts";
import { ctx } from "./support.ts";
import {
  accept,
  attempt,
  blob,
  evidence,
  executed,
  HASH,
  proof,
  REQUEST_HASH,
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
Deno.test("problems/tests#R1 R3 R4: scope 없는 lifecycle·직접 start·위조 recovery를 거절하고 두 recovery append", () => {
  const ledger = fileLedger();
  try {
    assert(ledger.transaction(accept).ok);
    assertFalse(
      ledger.transaction((tx) =>
        appendActualSideStart(tx, runner(), side(), proof())
      ).ok,
    );
    for (
      const caller of [
        ctx({ principal: "runner-1", actor: "user", scope: runner().scope }),
        ctx({ principal: "runner-1" }),
        ctx({ principal: "other", scope: runner().scope }),
        ctx({
          ...runner(),
          scope: {
            ...runner().scope,
            targets: { ...runner().scope.targets, request_key: "other" },
          },
        }),
      ]
    ) {
      assertFalse(
        ledger.transaction((tx) =>
          appendRequestObservation(tx, caller, {
            phase: "start_attempt",
            request_principal: "user-1",
            request_key: "key-1",
            request_hash: REQUEST_HASH,
            at: executed.started_at,
            previous_runner: null,
            runner_principal: "runner-1",
            reason: "attempt",
          }, proof())
        ).ok,
      );
    }
    const resultOnly = ctx({
      ...runner(),
      scope: { ...runner().scope, operations: ["RecordVerification"] },
    });
    assertFalse(
      ledger.transaction((tx) =>
        appendRequestObservation(tx, resultOnly, {
          phase: "start_attempt",
          request_principal: "user-1",
          request_key: "key-1",
          request_hash: REQUEST_HASH,
          at: executed.started_at,
          previous_runner: null,
          runner_principal: "runner-1",
          reason: "attempt",
        }, proof())
      ).ok,
    );
    assert(ledger.transaction(attempt).ok);
    assert(
      ledger.transaction((tx) =>
        appendActualSideStart(tx, runner(), side(), proof())
      ).ok,
    );
    const recovery = {
      phase: "recovery" as const,
      request_principal: "user-1",
      request_key: "key-1",
      request_hash: REQUEST_HASH,
      at: "2026-10-04T00:00:04.000Z",
      previous_runner: "runner-1",
      runner_principal: "runner-2",
      reason: "lost",
    };
    assertFalse(
      ledger.transaction((tx) =>
        appendRequestObservation(tx, runner(), recovery, proof("recovery"))
      ).ok,
    );
    assertFalse(
      ledger.transaction((tx) =>
        appendRequestObservation(tx, runner("runner-2"), {
          ...recovery,
          runner_principal: "runner-3",
        }, proof("recovery"))
      ).ok,
    );
    assertFalse(
      ledger.transaction((tx) =>
        appendRequestObservation(tx, runner("runner-2"), {
          ...recovery,
          previous_runner: "stale",
        }, proof("recovery"))
      ).ok,
    );
    assertFalse(
      ledger.transaction((tx) =>
        appendRequestObservation(
          tx,
          ctx({
            ...runner("runner-2"),
            scope: {
              ...runner("runner-2").scope,
              operations: ["RecordVerification"],
            },
          }),
          recovery,
          proof("recovery"),
        )
      ).ok,
    );
    const first = ledger.transaction((tx) =>
      appendRequestObservation(
        tx,
        runner("runner-2"),
        recovery,
        proof("recovery"),
      )
    );
    assert(first.ok);
    const retry = ledger.transaction((tx) =>
      appendRequestObservation(
        tx,
        runner("runner-2"),
        recovery,
        proof("recovery"),
      )
    );
    assert(retry.ok && retry.value === first.value);
    assert(
      ledger.transaction((tx) =>
        appendActualSideStart(tx, runner("runner-2"), side(), {
          ...proof(),
          machine_principal: "runner-2",
          current_runner: "runner-2",
        })
      ).ok,
    );
    const second = ledger.transaction((tx) =>
      appendRequestObservation(tx, runner("runner-3"), {
        ...recovery,
        previous_runner: "runner-2",
        runner_principal: "runner-3",
        at: "2026-10-04T00:00:05.000Z",
      }, {
        ...proof("recovery"),
        machine_principal: "runner-3",
        current_runner: "runner-2",
        next_runner: "runner-3",
      })
    );
    assert(second.ok && second.value > first.value);
    assertEquals(
      ledger.sql.get("select count(*) as n from test_side_starts", [])?.n,
      1n,
    );
    const result = ledger.transaction((tx) =>
      handleRecordVerification(tx, runner("runner-3"), {
        verification: verification(),
        blobs: blob("runner-3"),
      }, { ...evidence(), runner_principal: "runner-3" })
    );
    assert(result.ok);
    assertFalse(
      ledger.transaction((tx) =>
        appendRequestObservation(tx, runner("runner-4"), {
          ...recovery,
          previous_runner: "runner-3",
          runner_principal: "runner-4",
        }, {
          ...proof("recovery"),
          machine_principal: "runner-4",
          current_runner: "runner-3",
          next_runner: "runner-4",
        })
      ).ok,
    );
  } finally {
    ledger.close();
  }
});

Deno.test("problems/tests#R1 R3: lifecycle-only와 result-only privilege는 독립이다", () => {
  const ledger = fileLedger();
  const caller = (principal: string, operation: string) =>
    ctx({
      ...runner(principal),
      scope: { ...runner(principal).scope, operations: [operation] },
    });
  const attemptInput = {
    phase: "start_attempt" as const,
    request_principal: "user-1",
    request_key: "key-1",
    request_hash: REQUEST_HASH,
    at: executed.started_at,
    previous_runner: null,
    runner_principal: "runner-1",
    reason: "attempt",
  };
  const recoveryInput = {
    ...attemptInput,
    phase: "recovery" as const,
    previous_runner: "runner-1",
    runner_principal: "runner-2",
    reason: "lost",
  };
  try {
    assert(ledger.transaction(accept).ok);
    const resultOnly = caller("runner-1", "RecordVerification");
    assertFalse(
      ledger.transaction((tx) =>
        appendRequestObservation(tx, resultOnly, attemptInput, proof())
      ).ok,
    );
    const observeOnly = caller("runner-1", "observe_test_request");
    const observed = ledger.transaction((tx) =>
      appendRequestObservation(tx, observeOnly, attemptInput, proof())
    );
    assert(observed.ok);
    const retry = ledger.transaction((tx) =>
      appendRequestObservation(tx, observeOnly, attemptInput, proof())
    );
    assert(retry.ok && retry.value === observed.value);
    assertFalse(
      ledger.transaction((tx) =>
        appendActualSideStart(tx, resultOnly, side(), proof())
      ).ok,
    );
    assert(
      ledger.transaction((tx) =>
        appendActualSideStart(tx, observeOnly, side(), proof())
      ).ok,
    );
    assertFalse(
      ledger.transaction((tx) =>
        handleRecordVerification(tx, observeOnly, {
          verification: verification(),
          blobs: blob(),
        }, evidence())
      ).ok,
    );
    assertFalse(
      ledger.transaction((tx) =>
        appendRequestObservation(
          tx,
          caller("runner-2", "RecordVerification"),
          recoveryInput,
          proof("recovery"),
        )
      ).ok,
    );
    assertFalse(
      ledger.transaction((tx) =>
        appendRequestObservation(
          tx,
          caller("runner-2", "observe_test_request"),
          recoveryInput,
          proof("recovery"),
        )
      ).ok,
    );
    const recoverOnly = caller("runner-2", "recover_test_request");
    const recovered = ledger.transaction((tx) =>
      appendRequestObservation(
        tx,
        recoverOnly,
        recoveryInput,
        proof("recovery"),
      )
    );
    assert(recovered.ok);
    const recoveryRetry = ledger.transaction((tx) =>
      appendRequestObservation(
        tx,
        recoverOnly,
        recoveryInput,
        proof("recovery"),
      )
    );
    assert(recoveryRetry.ok && recoveryRetry.value === recovered.value);
    const body = { verification: verification(), blobs: blob("runner-2") };
    const prepared = { ...evidence(), runner_principal: "runner-2" };
    assertFalse(
      ledger.transaction((tx) =>
        handleRecordVerification(tx, recoverOnly, body, prepared)
      ).ok,
    );
    assertFalse(
      ledger.transaction((tx) =>
        handleRecordVerification(
          tx,
          caller("runner-2", "observe_test_request"),
          body,
          prepared,
        )
      ).ok,
    );
    assert(
      ledger.transaction((tx) =>
        handleRecordVerification(
          tx,
          caller("runner-2", "RecordVerification"),
          body,
          prepared,
        )
      ).ok,
    );
  } finally {
    ledger.close();
  }
});
