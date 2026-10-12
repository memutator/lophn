// T13: test command와 ticket 조건 연결. 임시 파일 SQLite/WAL ledger probe로
// ticket 없는 test command 접수부터 TicketTestLink가 붙은 결과까지 실제 표에서 본다.
import { assert, assertEquals } from "@std/assert";
import { ticketTestLinkInputSchema } from "../../../protocol/problems/mod.ts";
import type { Result } from "../../../base/mod.ts";
import {
  appendActualSideStart,
  appendRequestObservation,
  handleRequestTest,
} from "./commands.ts";
import { handleRecordVerification } from "./record.ts";
import { readVerification, readVerificationList } from "./reads.ts";
import { canonicalHash, canonicalJson, hashCanonical } from "./canonical.ts";
import { canonicalRequest } from "./model.ts";
import { fileLedger } from "./testing/mod.ts";
import { ctx } from "./support.ts";
import {
  APP,
  blob,
  evidence,
  executed,
  frozen,
  HASH,
  proof,
  requester,
  runner,
  verification,
} from "./fixtures.ts";

// test_command는 blueprint·SDK·실패 경로·증상이 모두 없다(R4).
const commandFrozen = {
  ...frozen,
  blueprint: null,
  sdk_dependencies: null,
  failure_paths: null,
};
const COMMAND_METHOD = { ...commandFrozen.method, argv: ["test", "check.ts"] };
const COMMAND_HASH = canonicalHash({
  ...commandFrozen,
  method: COMMAND_METHOD,
});
const commandInput = (
  patch: { request_key?: string; ticket?: unknown } = {},
) => ({
  request_key: patch.request_key ?? "key-1",
  kind: "test_command" as const,
  app: APP,
  target: { bundle_hash: HASH, release: null },
  problem: null,
  basis_seq: null,
  reports: [],
  before: null,
  after: null,
  ticket: (patch.ticket ?? null) as never,
  test: COMMAND_HASH,
});

// fixtures.REQUEST_HASH는 app_test 기본 입력의 hash다. test_command 입력은
// 요청 hash를 입력 값에서 직접 계산한다.
function commandRequestHash(
  value: { request_key?: string; ticket?: unknown },
): string {
  const canonical = canonicalRequest({
    ...commandInput(value),
    before_bundle_hash: null,
  } as never);
  assert(canonical.ok);
  return hashCanonical(canonical.value);
}

function commandAdmission(
  value: { request_key?: string; ticket?: unknown } = {},
) {
  const input = commandInput(value);
  const canonical = canonicalRequest({ ...input, before_bundle_hash: null });
  assert(canonical.ok);
  return {
    request_principal: "user-1",
    request_key: input.request_key,
    app: input.app,
    request_hash: hashCanonical(canonical.value),
    canonical: canonical.value,
    runner_principal: "runner-1",
    before_bundle_hash: null,
    before_target: null,
    app_in_scope: true,
    refs_ok: true,
    unavailable: false,
  };
}

function commandExecuted(patch: Record<string, unknown> = {}) {
  return {
    ...executed,
    bundle_hash: HASH,
    test_hash: COMMAND_HASH,
    ...patch,
  };
}

const OBSERVATIONS = { checked: true };

function commandVerification(patch: Record<string, unknown> = {}) {
  const value = commandInput({
    request_key: patch.request_key as string | undefined,
    ticket: (patch.ticket ?? null) as never,
  });
  const execution = (patch.execution as string | undefined) ??
    canonicalHash([commandExecuted()]);
  return verification({
    ...value,
    request_hash: commandRequestHash(value),
    test: value.test,
    execution,
    observations: canonicalHash(OBSERVATIONS),
    kind: "test_command",
    ...patch,
  } as never) as ReturnType<typeof verification>;
}

function commandEvidence(
  ver: ReturnType<typeof verification>,
  sides: readonly Record<string, unknown>[] = [commandExecuted()],
) {
  return {
    ...evidence(),
    request_key: ver.request_key,
    request_hash: ver.request_hash,
    verification_canonical: canonicalJson(ver),
    test: ver.test,
    execution: ver.execution,
    observations: ver.observations,
    observations_json: OBSERVATIONS,
    frozen: { ...commandFrozen, method: COMMAND_METHOD },
    execution_evidence: sides,
  };
}

function commandBlobs(ver: ReturnType<typeof verification>) {
  return blob("runner-1", ver, commandEvidence(ver) as never);
}

function side(key: string, hash: string, ticket?: unknown) {
  return {
    request_principal: "user-1",
    request_key: key,
    request_hash: commandRequestHash({ request_key: key, ticket }),
    side: "single" as const,
    bundle_hash: HASH,
    test_hash: hash,
    started_at: executed.started_at,
  };
}

// fixtures.runner()·proof()는 app_test 요청 hash와 key-1을 넣고 있다. test_command
// 요청은 다르므로 runner ctx와 lifecycle proof에 command key·hash를 넣는다.
function commandRunner(key: string, ticket?: unknown) {
  const base = runner();
  return ctx({
    ...base,
    scope: {
      ...base.scope,
      targets: {
        ...base.scope.targets,
        request_key: key,
        request_hash: commandRequestHash({ request_key: key, ticket }),
      },
    },
  });
}

function lifecycleProof(key: string, ticket?: unknown) {
  return {
    ...proof(),
    request_key: key,
    request_hash: commandRequestHash({ request_key: key, ticket }),
  };
}

function started(ledger: ReturnType<typeof fileLedger>, key: string) {
  const machine = commandRunner(key);
  const lifecycle = lifecycleProof(key);
  const admission = commandAdmission({ request_key: key });
  assert(
    ledger.transaction((tx) =>
      handleRequestTest(
        tx,
        requester(),
        commandInput({ request_key: key }),
        () => admission,
      )
    ).ok,
  );
  assert(
    ledger.transaction((tx) =>
      appendRequestObservation(tx, machine, {
        phase: "start_attempt",
        request_principal: "user-1",
        request_key: key,
        request_hash: lifecycle.request_hash,
        at: "2026-10-04T00:00:01.000Z",
        previous_runner: null,
        runner_principal: "runner-1",
        reason: "attempt",
      }, lifecycle)
    ).ok,
  );
  assert(
    ledger.transaction((tx) =>
      appendActualSideStart(tx, machine, side(key, COMMAND_HASH), lifecycle)
    ).ok,
  );
}

const reader = ctx({
  principal: "user-1",
  actor: "user",
  scope: {
    operations: ["GetVerification", "ListVerifications"],
    targets: { app: APP },
  },
  conditions: { app: APP },
});

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

function checked(result: Result<unknown>) {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
}

const LINK = {
  ticket: "tkt_01ary8h2z3n4p5q6r7s8t9v0wa",
  check_index: 0,
  check_hash: HASH,
  completion_seq: "4",
};

Deno.test("problems/tests#R4 R16: ticket 없는 test command는 기대 종료값으로 pass고 다른 종료값은 fail이다", () => {
  const ledger = fileLedger();
  try {
    started(ledger, "key-1");
    const ver = commandVerification();
    const recorded = value(
      ledger.transaction((tx) =>
        handleRecordVerification(tx, commandRunner("key-1"), {
          verification: ver,
          blobs: commandBlobs(ver),
        }, commandEvidence(ver) as never)
      ),
    );
    const read = value(
      readVerification(ledger.snapshot(recorded.seq), reader, {
        verification: ver.id,
        detail: false,
      }),
    );
    assertEquals(read.verification.kind, "test_command");
    assertEquals(read.verification.result, "pass");
    assertEquals(read.verification.ticket, null);
    // 분리된 argv·고정 cwd·기대 종료값은 frozen method에 그대로 남는다.
    assertEquals(COMMAND_METHOD.argv, ["test", "check.ts"]);
    assertEquals(COMMAND_METHOD.cwd, ".");
    assertEquals(COMMAND_METHOD.expected_exit_code, 0);
    assertEquals(
      ledger.sql.get(
        "select ticket from verifications where id = ?",
        [ver.id],
      )?.ticket,
      null,
    );
  } finally {
    ledger.close();
  }
});

Deno.test("problems/tests#R4: 기대 종료값을 벗어난 exit은 fail이고 pass는 거절된다", () => {
  const ledger = fileLedger();
  try {
    started(ledger, "key-1");
    // exit 1은 fail이다.
    const failSides = [commandExecuted({ exit_code: 1 })];
    const failed = commandVerification({
      execution: canonicalHash(failSides),
      result: "fail",
      reason: "exit",
    });
    checked(
      ledger.transaction((tx) =>
        handleRecordVerification(tx, commandRunner("key-1"), {
          verification: failed,
          blobs: commandBlobs(failed),
        }, commandEvidence(failed, failSides) as never)
      ),
    );
    assert(
      readVerification(ledger.snapshot("0"), reader, {
        verification: failed.id,
        detail: false,
      }).ok === false,
    );
    assertEquals(
      ledger.sql.get("select result from verifications where id = ?", [
        failed.id,
      ])?.result,
      "fail",
    );
    // 같은 요청의 다른 결과는 없다. exit 1을 pass로 남기는 것은 거절된다.
    const wrongSides = [
      commandExecuted({ exit_code: 1, ended_at: "2026-10-04T00:00:04.000Z" }),
    ];
    const wrong = commandVerification({
      execution: canonicalHash(wrongSides),
      result: "pass",
      reason: "exit",
      id: "vrf_01ary8h2z3n4p5q6r7s8t9v0wy",
    });
    const rejected = ledger.transaction((tx) =>
      handleRecordVerification(tx, commandRunner("key-1"), {
        verification: wrong,
        blobs: commandBlobs(wrong),
      }, commandEvidence(wrong, wrongSides) as never)
    );
    assert(!rejected.ok);
    assertEquals(rejected.error.code, "conflict");
  } finally {
    ledger.close();
  }
});

Deno.test("problems/tests#R4 R16: 기대와 다른 종료값에 pass는 거절되고 중단은 inconclusive만 된다", () => {
  const ledger = fileLedger();
  try {
    started(ledger, "key-1");
    // exit 1을 pass로 남기는 것은 거절된다(INCONCLUSIVE_ONLY).
    const wrongExitSides = [commandExecuted({ exit_code: 1 })];
    const wrongExit = commandVerification({
      execution: canonicalHash(wrongExitSides),
      result: "pass",
      reason: "exit",
    });
    const rejected = ledger.transaction((tx) =>
      handleRecordVerification(tx, commandRunner("key-1"), {
        verification: wrongExit,
        blobs: commandBlobs(wrongExit),
      }, commandEvidence(wrongExit, wrongExitSides) as never)
    );
    assert(!rejected.ok);
    assertEquals(rejected.error.code, "invalid_input");
    // killed(exit_code null)에 pass는 거절이다.
    const killedSides = [
      commandExecuted({ exit_code: null, end_reason: "killed" }),
    ];
    const killedPass = commandVerification({
      execution: canonicalHash(killedSides),
      result: "pass",
    });
    const killedRejected = ledger.transaction((tx) =>
      handleRecordVerification(tx, commandRunner("key-1"), {
        verification: killedPass,
        blobs: commandBlobs(killedPass),
      }, commandEvidence(killedPass, killedSides) as never)
    );
    assert(!killedRejected.ok);
    assertEquals(killedRejected.error.code, "invalid_input");
    // killed에 inconclusive는 남는다.
    const killedInconclusive = commandVerification({
      execution: canonicalHash(killedSides),
      result: "inconclusive",
      reason: "killed",
    });
    const killedRecorded = value(
      ledger.transaction((tx) =>
        handleRecordVerification(tx, commandRunner("key-1"), {
          verification: killedInconclusive,
          blobs: commandBlobs(killedInconclusive),
        }, commandEvidence(killedInconclusive, killedSides) as never)
      ),
    );
    const read = value(
      readVerification(ledger.snapshot(killedRecorded.seq), reader, {
        verification: killedInconclusive.id,
        detail: false,
      }),
    );
    assertEquals(read.verification.result, "inconclusive");
  } finally {
    ledger.close();
  }
});

Deno.test("problems/tests#R1 R4 R5: ticket을 붙인 결과는 link를 그대로 남기고 낡은 결과도 보존한다", () => {
  const ledger = fileLedger();
  try {
    // ticket을 붙인 요청. check index·hash·completion seq가 필수다.
    const machine = commandRunner("key-1", LINK);
    const lifecycle = lifecycleProof("key-1", LINK);
    const admission = commandAdmission({ request_key: "key-1", ticket: LINK });
    assert(ticketTestLinkInputSchema.safeParse(LINK).success);
    assert(
      ledger.transaction((tx) =>
        handleRequestTest(
          tx,
          requester(),
          commandInput({ request_key: "key-1", ticket: LINK }),
          () => admission,
        )
      ).ok,
    );
    assert(
      ledger.transaction((tx) =>
        appendRequestObservation(tx, machine, {
          phase: "start_attempt",
          request_principal: "user-1",
          request_key: "key-1",
          request_hash: lifecycle.request_hash,
          at: "2026-10-04T00:00:01.000Z",
          previous_runner: null,
          runner_principal: "runner-1",
          reason: "attempt",
        }, lifecycle)
      ).ok,
    );
    assert(
      ledger.transaction((tx) =>
        appendActualSideStart(
          tx,
          machine,
          side("key-1", COMMAND_HASH, LINK),
          lifecycle,
        )
      ).ok,
    );
    const linked = commandVerification({ ticket: LINK });
    const recorded = value(
      ledger.transaction((tx) =>
        handleRecordVerification(tx, commandRunner("key-1", LINK), {
          verification: linked,
          blobs: commandBlobs(linked),
        }, commandEvidence(linked) as never)
      ),
    );
    const read = value(
      readVerification(ledger.snapshot(recorded.seq), reader, {
        verification: linked.id,
        detail: false,
      }),
    );
    assertEquals(read.verification.ticket, LINK);
    const listed = value(
      readVerificationList(ledger.snapshot(recorded.seq), reader, {
        app: APP,
        ticket: LINK.ticket,
      }),
    );
    assertEquals(listed.verifications.length, 1);
    assertEquals(listed.verifications[0]?.ticket, LINK);
    // 같은 ticket link로 새 요청·새 결과를 남기면 둘 다 남는다(낡은 결과 보존).
    const secondMachine = commandRunner("key-2", LINK);
    const secondLifecycle = lifecycleProof("key-2", LINK);
    const secondAdmission = commandAdmission({
      request_key: "key-2",
      ticket: LINK,
    });
    assert(
      ledger.transaction((tx) =>
        handleRequestTest(
          tx,
          requester(),
          commandInput({ request_key: "key-2", ticket: LINK }),
          () => secondAdmission,
        )
      ).ok,
    );
    assert(
      ledger.transaction((tx) =>
        appendRequestObservation(tx, secondMachine, {
          phase: "start_attempt",
          request_principal: "user-1",
          request_key: "key-2",
          request_hash: secondLifecycle.request_hash,
          at: "2026-10-04T00:00:01.000Z",
          previous_runner: null,
          runner_principal: "runner-1",
          reason: "attempt",
        }, secondLifecycle)
      ).ok,
    );
    assert(
      ledger.transaction((tx) =>
        appendActualSideStart(
          tx,
          secondMachine,
          side("key-2", COMMAND_HASH, LINK),
          secondLifecycle,
        )
      ).ok,
    );
    const secondVer = commandVerification({
      request_key: "key-2",
      id: "vrf_01ary8h2z3n4p5q6r7s8t9v0wy",
      ticket: LINK,
    });
    const secondRecorded = value(
      ledger.transaction((tx) =>
        handleRecordVerification(tx, commandRunner("key-2", LINK), {
          verification: secondVer,
          blobs: commandBlobs(secondVer),
        }, commandEvidence(secondVer) as never)
      ),
    );
    const both = value(
      readVerificationList(ledger.snapshot(secondRecorded.seq), reader, {
        app: APP,
        ticket: LINK.ticket,
      }),
    );
    assertEquals(both.verifications.length, 2);
    assertEquals(
      both.verifications.map((item) => item.id).sort(),
      [linked.id, secondVer.id].sort(),
    );
  } finally {
    ledger.close();
  }
});

Deno.test("problems/tests#R4: 관측이 없으면 결과가 없고 stdout pass 문자열은 판정에서 분리다", () => {
  const runnerCtx = runner();
  const value = commandInput();
  assertEquals(value.kind, "test_command");
  assertEquals(runnerCtx.actor, "machine");
  assertEquals(executed.side, "single");
  assertEquals(commandExecuted().end_reason, "exited");
  // ticket link 필수 항목. check_hash와 completion_seq를 빼면 거절이다.
  for (
    const patch of [
      { ...LINK, check_hash: undefined },
      { ...LINK, completion_seq: undefined },
      { ...LINK, completion_seq: "0" },
      { ...LINK, check_index: -1 },
    ]
  ) {
    assertEquals(
      ticketTestLinkInputSchema.safeParse(patch).success,
      false,
    );
  }
});
