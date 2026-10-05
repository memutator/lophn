import { assert, assertEquals, assertFalse, assertThrows } from "@std/assert";
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
  accept,
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

const start = () => ({
  request_principal: "user-1",
  request_key: "key-1",
  request_hash: REQUEST_HASH,
  side: "single" as const,
  bundle_hash: HASH,
  test_hash: TEST_HASH,
  started_at: executed.started_at,
});
const observation = (
  phase: "start_unknown" | "preparation_failed" | "start_attempt",
) => ({
  phase,
  request_principal: "user-1",
  request_key: "key-1",
  request_hash: REQUEST_HASH,
  at: phase === "start_attempt" ? executed.started_at : null,
  previous_runner: null,
  runner_principal: "runner-1",
  reason: phase,
});

Deno.test("problems/tests#R4: start_unknown와 preparation_failed 뒤 신규 시작 없고 같은 관측만 retry", () => {
  for (const phase of ["start_unknown", "preparation_failed"] as const) {
    const ledger = fileLedger();
    try {
      assert(ledger.transaction(accept).ok);
      assert(ledger.transaction(attempt).ok);
      const value = observation(phase);
      const lifecycleProof = { ...proof(), phase };
      const first = ledger.transaction((tx) =>
        appendRequestObservation(tx, runner(), value, lifecycleProof)
      );
      const retry = ledger.transaction((tx) =>
        appendRequestObservation(tx, runner(), value, lifecycleProof)
      );
      assert(first.ok && retry.ok && first.value === retry.value);
      assertFalse(
        ledger.transaction((tx) =>
          appendRequestObservation(
            tx,
            runner(),
            observation("start_attempt"),
            proof(),
          )
        ).ok,
      );
      assertFalse(
        ledger.transaction((tx) =>
          appendActualSideStart(tx, runner(), start(), proof())
        ).ok,
      );
      assertFalse(
        ledger.transaction((tx) =>
          handleRecordVerification(tx, runner(), {
            verification: verification(),
            blobs: blob(),
          }, evidence())
        ).ok,
      );
      assertEquals(
        ledger.sql.get("select count(*) as n from verifications", [])?.n,
        0n,
      );
    } finally {
      ledger.close();
    }
  }
});

Deno.test("problems/tests#R4: 실제 timeout·killed·runner_lost·근거 부족은 inconclusive만 기록", () => {
  for (
    const reason of [
      "timeout",
      "killed",
      "runner_lost",
      "insufficient",
    ] as const
  ) {
    const ledger = fileLedger();
    try {
      assert(ledger.transaction(accept).ok);
      assert(ledger.transaction(attempt).ok);
      assert(
        ledger.transaction((tx) =>
          appendActualSideStart(tx, runner(), start(), proof())
        ).ok,
      );
      const before = ledger.sql.all("select * from test_requests", []);
      const rejectedFailure = ledger.transaction((tx) =>
        appendRequestObservation(
          tx,
          runner(),
          observation("preparation_failed"),
          { ...proof(), phase: "preparation_failed" },
        )
      );
      assertFalse(rejectedFailure.ok);
      assertEquals(rejectedFailure.error.code, "conflict");
      assertEquals(ledger.sql.all("select * from test_requests", []), before);
      const execution = [{
        ...executed,
        end_reason: reason === "insufficient" ? "exited" as const : reason,
      }];
      for (const outcome of ["pass", "fail"] as const) {
        const value = verification({
          execution: canonicalHash(execution),
          result: outcome,
        });
        const preparedEvidence = {
          ...evidence(),
          verification_canonical: canonicalJson(value),
          execution: value.execution,
          execution_evidence: execution,
          evidence_sufficient: reason !== "insufficient",
        };
        assertFalse(
          ledger.transaction((tx) =>
            handleRecordVerification(tx, runner(), {
              verification: value,
              blobs: blob("runner-1", value, preparedEvidence),
            }, preparedEvidence)
          ).ok,
        );
      }
      const value = verification({
        execution: canonicalHash(execution),
        result: "inconclusive",
      });
      const preparedEvidence = {
        ...evidence(),
        verification_canonical: canonicalJson(value),
        execution: value.execution,
        execution_evidence: execution,
        evidence_sufficient: reason !== "insufficient",
      };
      assert(
        ledger.transaction((tx) =>
          handleRecordVerification(tx, runner(), {
            verification: value,
            blobs: blob("runner-1", value, preparedEvidence),
          }, preparedEvidence)
        ).ok,
      );
    } finally {
      ledger.close();
    }
  }
});

Deno.test("problems/tests#R4: 저장된 preparation_failed와 실제 시작이 모순되어도 신규 result는 거절", () => {
  const ledger = fileLedger();
  try {
    assert(ledger.transaction(accept).ok);
    assert(ledger.transaction(attempt).ok);
    assert(
      ledger.transaction((tx) =>
        appendActualSideStart(tx, runner(), start(), proof())
      ).ok,
    );
    ledger.sql.run(
      "insert into test_requests select seq+1, request_principal, request_key, request_hash, 'preparation_failed', accepted, 1, null, 0, null, runner_principal, previous_runner, 'legacy failure', payload from test_requests order by seq desc limit 1",
      [],
    );
    const before = ledger.sql.all("select * from test_requests", []);
    const result = ledger.transaction((tx) =>
      handleRecordVerification(tx, runner(), {
        verification: verification(),
        blobs: [],
      }, () => {
        throw new Error("preparation_failed must not prepare result");
      })
    );
    assertFalse(result.ok);
    assertEquals(result.error.code, "conflict");
    assertEquals(ledger.sql.all("select * from test_requests", []), before);
    for (
      const table of [
        "probe_refs",
        "probe_events",
        "verifications",
        "verification_reports",
      ]
    ) {
      assertEquals(ledger.sql.all(`select * from ${table}`, []).length, 0);
    }
  } finally {
    ledger.close();
  }
});

Deno.test("problems/tests#R2: digest가 맞아도 command FrozenTest와 before side를 app_test로 받지 않는다", () => {
  const ledger = fileLedger();
  try {
    const fixed = {
      ...frozen,
      blueprint: null,
      sdk_dependencies: null,
      failure_paths: null,
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
          ...observation("start_attempt"),
          request_hash: admission.request_hash,
        }, lifecycleProof)
      ).ok,
    );
    assertFalse(
      ledger.transaction((tx) =>
        appendActualSideStart(tx, caller, {
          ...start(),
          side: "before",
          request_hash: admission.request_hash,
          test_hash: request.test,
        }, lifecycleProof)
      ).ok,
    );
    assert(
      ledger.transaction((tx) =>
        appendActualSideStart(tx, caller, {
          ...start(),
          request_hash: admission.request_hash,
          test_hash: request.test,
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
      frozen: fixed,
      request_hash: admission.request_hash,
      test: request.test,
      execution: value.execution,
      verification_canonical: canonicalJson(value),
      execution_evidence: execution,
    };
    assertFalse(
      ledger.transaction((tx) =>
        handleRecordVerification(tx, caller, {
          verification: value,
          blobs: blob("runner-1", value, preparedEvidence),
        }, preparedEvidence)
      ).ok,
    );
  } finally {
    ledger.close();
  }
});

Deno.test("problems/tests#R2: canonical helper는 deep·large·accessor·cycle·non-JSON을 bounded 거절", () => {
  let deep: unknown = null;
  for (let i = 0; i < 40; i++) deep = { nested: deep };
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  let accessed = false;
  const accessor = {
    get value() {
      accessed = true;
      return "x";
    },
  };
  const hiddenIndex = new Array(1);
  Object.defineProperty(hiddenIndex, "0", {
    get() {
      accessed = true;
      return "x";
    },
  });
  Object.defineProperty(hiddenIndex, "extra", { value: "x", enumerable: true });
  const inheritedIndex = new Array(1);
  const prototype = Object.create(Array.prototype);
  Object.defineProperty(prototype, "0", {
    get() {
      accessed = true;
      return "x";
    },
  });
  Object.setPrototypeOf(inheritedIndex, prototype);
  Object.defineProperty(inheritedIndex, "extra", {
    value: "x",
    enumerable: true,
  });
  const extraArray = ["x"];
  Object.defineProperty(extraArray, "extra", { value: "x" });
  for (
    const value of [
      hiddenIndex,
      inheritedIndex,
      extraArray,
      deep,
      { text: "x".repeat(300000) },
      cycle,
      accessor,
      new Date(),
      undefined,
      1n,
    ]
  ) assertThrows(() => canonicalJson(value));
  assertFalse(accessed);
  assertEquals(canonicalHash({ b: 1, a: 2 }), canonicalHash({ a: 2, b: 1 }));
});
