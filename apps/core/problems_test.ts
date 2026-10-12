import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../packages/protocol/platform/mod.ts";
import {
  type CommandEnvelope,
  createLedgerHarness,
  type LedgerHarness,
} from "./testing/ledger.ts";
import {
  APP,
  blob,
  evidence,
  executed,
  HASH,
  HASH_B,
  input,
  prepared,
  proof,
  REQUEST_HASH,
  requester,
  runner,
  verification,
} from "../../packages/core/problems/tests/fixtures.ts";
import { FAILING_BLOB_FIELD } from "../../packages/core/problems/tests/harness-registration_test.ts";

const registration = new URL(
  "../../packages/core/problems/tests/harness-registration_test.ts",
  import.meta.url,
);
const nowMs = Date.parse("2026-10-04T00:00:00.000Z");

function credential(
  base: ReturnType<typeof requester>,
  ref: string,
): AuthenticatedContext {
  return { ...base, credential_ref: ref };
}

// ledger gate는 고정 조건만 보고 domain target은 owner port가 판정한다.
// 준비·port 확인 command는 target 없는 credential로 통과시키고,
// owner command는 app·request target이 있는 credential을 쓴다.
const requesterCtx = credential(requester(), "cred-requester");
const runnerCtx = credential({
  ...runner(),
  scope: {
    operations: [
      ...runner().scope.operations,
      "problems.tests.observe-request",
      "problems.tests.start-side",
    ],
    targets: runner().scope.targets,
  },
}, "cred-runner");
const setupCtx = credential({
  ...requester(),
  scope: {
    operations: ["problems.tests.set-admission"],
    targets: {},
  },
}, "cred-setup");
const runnerSetupCtx = credential({
  ...runner(),
  scope: {
    operations: [
      "problems.tests.set-evidence",
      "problems.tests.check-ports",
      "problems.tests.set-blob-failure",
    ],
    targets: {},
  },
}, "cred-runner-setup");
const readerCtx: AuthenticatedContext = credential({
  principal: "user-1",
  actor: "user",
  scope: {
    operations: ["GetTestRequest", "GetVerification", "ListVerifications"],
    targets: { app: APP },
  },
  conditions: { app: APP },
  credential_ref: "cred-reader",
}, "cred-reader");

function envelope(
  command: string,
  key: string,
  input: unknown,
): CommandEnvelope {
  return {
    command,
    input,
    compare: {},
    idempotency_key: key,
    prepared: [],
  };
}

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

function code(result: Result<unknown>, expected: string) {
  assert(!result.ok, "expected failure");
  assertEquals(result.error.code, expected);
}

async function open(): Promise<LedgerHarness> {
  return value(
    await createLedgerHarness({
      registrationModules: [registration],
      credentials: [
        requesterCtx,
        runnerCtx,
        readerCtx,
        setupCtx,
        runnerSetupCtx,
      ],
      nowMs,
    }),
  );
}

async function count(h: LedgerHarness, table: string): Promise<bigint> {
  return value(await h.inspect(`select count(*) as n from ${table}`))[0]
    .n as bigint;
}

const requestInput = () => input();
const admission = () => prepared(input())();

Deno.test("problems/tests#R3 R5: 같은 요청은 같은 접수고 다른 hash는 conflict이며 미실행을 구별한다", async () => {
  const h = await open();
  try {
    value(
      await h.command(
        setupCtx,
        envelope("problems.tests.set-admission", "admit-1", {
          prepared: JSON.stringify(admission()),
        }),
      ),
    );
    const first = value(
      await h.command(
        requesterCtx,
        envelope("RequestTest", "request-1", requestInput()),
      ),
    );
    assertEquals(first.replayed, false);
    assertEquals(first.result, {
      request_key: "key-1",
      accepted: true,
      result_ref: null,
    });
    const retry = value(
      await h.command(
        requesterCtx,
        envelope("RequestTest", "request-1-retry", requestInput()),
      ),
    );
    assertEquals(retry.result, first.result);
    assertEquals(retry.replayed, false);
    const changed = input({ test: HASH_B });
    value(
      await h.command(
        setupCtx,
        envelope("problems.tests.set-admission", "admit-changed", {
          prepared: JSON.stringify(prepared(changed)()),
        }),
      ),
    );
    code(
      await h.command(
        requesterCtx,
        envelope("RequestTest", "request-changed", changed),
      ),
      "conflict",
    );
    const pending = value(
      await h.read(
        { resource: "problems", method: "get-test-request" },
        readerCtx,
        { request_key: "key-1" },
      ),
    ) as { request: Record<string, unknown> };
    assertEquals(pending.request.accepted, true);
    assertEquals(pending.request.started_at, null);
    assertEquals(pending.request.start_attempted_at, null);
    assertEquals(pending.request.result_ref, null);
    assertEquals(await count(h, "test_requests"), 1n);
  } finally {
    await h.close();
  }
});

Deno.test("problems/tests#R1 R2 R4: runner만 lifecycle 뒤 결과를 남기고 읽기는 대상·시작·끝을 돌려준다", async () => {
  const h = await open();
  try {
    value(
      await h.command(
        setupCtx,
        envelope("problems.tests.set-admission", "admit-run", {
          prepared: JSON.stringify(admission()),
        }),
      ),
    );
    value(
      await h.command(
        requesterCtx,
        envelope("RequestTest", "request-run", requestInput()),
      ),
    );
    const observation = {
      phase: "start_attempt",
      request_principal: "user-1",
      request_key: "key-1",
      request_hash: REQUEST_HASH,
      at: "2026-10-04T00:00:01.000Z",
      previous_runner: null,
      runner_principal: "runner-1",
      reason: "attempt",
    };
    value(
      await h.command(
        runnerCtx,
        envelope("problems.tests.observe-request", "observe-run", {
          observation,
          proof: proof(),
        }),
      ),
    );
    const started = value(
      await h.read(
        { resource: "problems", method: "get-test-request" },
        readerCtx,
        { request_key: "key-1" },
      ),
    ) as { request: Record<string, unknown> };
    assertEquals(started.request.start_attempted_at, observation.at);
    assertEquals(started.request.started_at, null);
    assertEquals(started.request.result_ref, null);
    value(
      await h.command(
        runnerCtx,
        envelope("problems.tests.start-side", "start-run", {
          start: {
            request_principal: "user-1",
            request_key: "key-1",
            request_hash: REQUEST_HASH,
            side: "single",
            bundle_hash: HASH,
            test_hash: requestInput().test,
            started_at: executed.started_at,
          },
          proof: proof(),
        }),
      ),
    );
    const running = value(
      await h.read(
        { resource: "problems", method: "get-test-request" },
        readerCtx,
        { request_key: "key-1" },
      ),
    ) as { request: Record<string, unknown> };
    assertEquals(running.request.started_at, executed.started_at);
    assertEquals(running.request.result_ref, null);
    const preparedEvidence = evidence();
    value(
      await h.command(
        runnerSetupCtx,
        envelope("problems.tests.set-evidence", "evidence-run", {
          prepared: JSON.stringify(preparedEvidence),
        }),
      ),
    );
    const recorded = value(
      await h.command(
        runnerCtx,
        envelope("RecordVerification", "record-run", {
          verification: verification(),
          blobs: blob(),
        }),
      ),
    );
    assertEquals(
      (recorded.result as { verification: string }).verification,
      verification().id,
    );
    const done = value(
      await h.read(
        { resource: "problems", method: "get-test-request" },
        readerCtx,
        { request_key: "key-1" },
      ),
    ) as { request: Record<string, unknown> };
    assertEquals(done.request.result_ref, verification().id);
    const detail = value(
      await h.read(
        { resource: "problems", method: "get-verification" },
        readerCtx,
        { verification: verification().id, detail: false },
      ),
    ) as { verification: Record<string, unknown> };
    assertEquals(detail.verification.app, APP);
    assertEquals(detail.verification.test, verification().test);
    assertEquals(detail.verification.execution, verification().execution);
    assertEquals(detail.verification.result, "pass");
    assertEquals(detail.verification.reason, "ran");
    assertEquals(detail.verification.observations, verification().observations);
    const listed = value(
      await h.read(
        { resource: "problems", method: "list-verifications" },
        readerCtx,
        { app: APP },
      ),
    ) as { verifications: Record<string, unknown>[] };
    assertEquals(listed.verifications.length, 1);
    assertEquals(listed.verifications[0].id, verification().id);
    assertEquals(await count(h, "verifications"), 1n);
    assertEquals(await count(h, "verification_reports"), 0n);
    assertEquals(await count(h, "test_side_starts"), 1n);
  } finally {
    await h.close();
  }
});

Deno.test("problems/tests#R1: RecordVerification scope가 없는 credential과 다른 principal은 거절된다", async () => {
  const h = await open();
  const agent = "coding_agent:cac_01jgfjjz008000000000000000";
  const appActor = `app:${APP}`;
  const deniedActors = [
    credential({
      ...runner(),
      actor: "user",
      scope: {
        ...runner().scope,
        operations: [...runner().scope.operations],
      },
    }, "cred-user-runner"),
    credential({
      ...runner(),
      actor: agent,
      scope: {
        ...runner().scope,
        operations: [...runner().scope.operations],
      },
    }, "cred-agent"),
    credential({
      ...runner(),
      actor: appActor,
      scope: {
        ...runner().scope,
        operations: [...runner().scope.operations],
      },
    }, "cred-app"),
    credential({
      ...runner(),
      scope: {
        ...runner().scope,
        operations: [
          "observe_test_request",
          "recover_test_request",
        ],
      },
    }, "cred-no-record"),
    credential({
      ...runner(),
      scope: {
        ...runner().scope,
        operations: [...runner().scope.operations],
        targets: { ...runner().scope.targets, request_key: "other-key" },
      },
    }, "cred-other-key"),
  ];
  try {
    for (const ctx of deniedActors) value(await h.setCredential(ctx));
    value(
      await h.command(
        setupCtx,
        envelope("problems.tests.set-admission", "admit-deny", {
          prepared: JSON.stringify(admission()),
        }),
      ),
    );
    value(
      await h.command(
        requesterCtx,
        envelope("RequestTest", "request-deny", requestInput()),
      ),
    );
    value(
      await h.command(
        runnerCtx,
        envelope("problems.tests.observe-request", "observe-deny", {
          observation: {
            phase: "start_attempt",
            request_principal: "user-1",
            request_key: "key-1",
            request_hash: REQUEST_HASH,
            at: "2026-10-04T00:00:01.000Z",
            previous_runner: null,
            runner_principal: "runner-1",
            reason: "attempt",
          },
          proof: proof(),
        }),
      ),
    );
    value(
      await h.command(
        runnerCtx,
        envelope("problems.tests.start-side", "start-deny", {
          start: {
            request_principal: "user-1",
            request_key: "key-1",
            request_hash: REQUEST_HASH,
            side: "single",
            bundle_hash: HASH,
            test_hash: requestInput().test,
            started_at: executed.started_at,
          },
          proof: proof(),
        }),
      ),
    );
    value(
      await h.command(
        runnerSetupCtx,
        envelope("problems.tests.set-evidence", "evidence-deny", {
          prepared: JSON.stringify(evidence()),
        }),
      ),
    );
    const body = { verification: verification(), blobs: blob() };
    for (const [index, ctx] of deniedActors.entries()) {
      code(
        await h.command(
          ctx,
          envelope("RecordVerification", `record-deny-${index}`, body),
        ),
        "forbidden",
      );
    }
    const stranger = credential({
      principal: "user-2",
      actor: "user",
      scope: {
        operations: ["GetTestRequest"],
        targets: {},
      },
      conditions: {},
      credential_ref: "cred-stranger",
    }, "cred-stranger");
    value(await h.setCredential(stranger));
    code(
      await h.read(
        { resource: "problems", method: "get-test-request" },
        stranger,
        { request_key: "key-1" },
      ),
      "not_found",
    );
    assertEquals(await count(h, "verifications"), 0n);
  } finally {
    await h.close();
  }
});

Deno.test("problems/tests#R1: tx-local typed port는 tx마다 새 구현이고 같은 tx에서는 같다", async () => {
  const h = await open();
  try {
    const first = value(
      await h.command(
        runnerSetupCtx,
        envelope("problems.tests.check-ports", "ports-1", {}),
      ),
    ).result as { admission: number; evidence: number };
    const second = value(
      await h.command(
        runnerSetupCtx,
        envelope("problems.tests.check-ports", "ports-2", {}),
      ),
    ).result as { admission: number; evidence: number };
    assertEquals(first, { admission: 1, evidence: 1 });
    assertEquals(second, { admission: 2, evidence: 2 });
  } finally {
    await h.close();
  }
});

Deno.test("problems/tests#R3: blob 등록 실패와 handler err는 결과 행을 남기지 않고 요청 기록은 append-only다", async () => {
  const h = await open();
  try {
    value(
      await h.command(
        setupCtx,
        envelope("problems.tests.set-admission", "admit-rollback", {
          prepared: JSON.stringify(admission()),
        }),
      ),
    );
    value(
      await h.command(
        requesterCtx,
        envelope("RequestTest", "request-rollback", requestInput()),
      ),
    );
    value(
      await h.command(
        runnerCtx,
        envelope("problems.tests.observe-request", "observe-rollback", {
          observation: {
            phase: "start_attempt",
            request_principal: "user-1",
            request_key: "key-1",
            request_hash: REQUEST_HASH,
            at: "2026-10-04T00:00:01.000Z",
            previous_runner: null,
            runner_principal: "runner-1",
            reason: "attempt",
          },
          proof: proof(),
        }),
      ),
    );
    value(
      await h.command(
        runnerCtx,
        envelope("problems.tests.start-side", "start-rollback", {
          start: {
            request_principal: "user-1",
            request_key: "key-1",
            request_hash: REQUEST_HASH,
            side: "single",
            bundle_hash: HASH,
            test_hash: requestInput().test,
            started_at: executed.started_at,
          },
          proof: proof(),
        }),
      ),
    );
    const before = await count(h, "test_requests");
    const failingEvidence = evidence();
    const failingVerification = verification();
    const failing = blob("runner-1", failingVerification, failingEvidence);
    assert(
      failing.some((reference) => reference.field === FAILING_BLOB_FIELD),
    );
    value(
      await h.command(
        runnerSetupCtx,
        envelope("problems.tests.set-evidence", "evidence-fail-blob", {
          prepared: JSON.stringify(failingEvidence),
        }),
      ),
    );
    value(
      await h.command(
        runnerSetupCtx,
        envelope("problems.tests.set-blob-failure", "blob-fail-on", {
          field: FAILING_BLOB_FIELD,
        }),
      ),
    );
    code(
      await h.command(
        runnerCtx,
        envelope("RecordVerification", "record-fail-blob", {
          verification: failingVerification,
          blobs: failing,
        }),
      ),
      "unavailable",
    );
    assertEquals(await count(h, "verifications"), 0n);
    assertEquals(await count(h, "verification_reports"), 0n);
    assertEquals(await count(h, "test_blob_refs"), 0n);
    assertEquals(await count(h, "test_requests"), before);
    value(
      await h.command(
        runnerSetupCtx,
        envelope("problems.tests.set-evidence", "evidence-clear", {
          prepared: null,
        }),
      ),
    );
    code(
      await h.command(
        runnerCtx,
        envelope("RecordVerification", "record-handler-err", {
          verification: verification(),
          blobs: blob(),
        }),
      ),
      "forbidden",
    );
    assertEquals(await count(h, "verifications"), 0n);
    assertEquals(await count(h, "test_requests"), before);
    code(
      await h.probeWrite(
        "update test_requests set reason = 'rewritten' where seq = 1",
      ),
      "invalid_input",
    );
    code(
      await h.probeWrite("delete from test_requests where seq = 1"),
      "invalid_input",
    );
    assertEquals(
      value(await h.inspect("select reason from test_requests where seq = 1"))[
        0
      ].reason,
      "accepted",
    );
  } finally {
    await h.close();
  }
});

Deno.test("problems/tests#R1: 철회한 credential의 command는 거절된다", async () => {
  const h = await open();
  try {
    value(await h.revokeCredential(requesterCtx.credential_ref));
    code(
      await h.command(
        requesterCtx,
        envelope("RequestTest", "request-revoked", requestInput()),
      ),
      "unauthorized",
    );
  } finally {
    await h.close();
  }
});
