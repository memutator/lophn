// approval 대기의 재시작 복구(platform#T22가 이어받은 platform#T43 연결, platform/approvals#R4 #R6,
// platform/backup-and-migration#R16)를 실제 core와 임시 LOPHN_HOME에서 본다. 사람 데이터 root는
// 열지 않는다. core를 끄고 같은 홈으로 다시 띄운다.
import { assert, assertEquals } from "@std/assert";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import type {
  ApprovalRequest,
  AuthenticatedContext,
} from "../../packages/contracts/platform/mod.ts";
import { observeApprovals } from "../../packages/platform/approvals/mod.ts";
import { checkRestart } from "../../packages/platform/backup-and-migration/mod.ts";
import { type Core, startCore } from "./core.ts";
import {
  actionOf,
  call,
  command,
  createInput,
  decide,
  type Server,
} from "./testing/approvals-fixture.ts";

const NOW = Date.UTC(2024, 0, 1);
const USER_TOKEN = "e".repeat(43);
const REQUESTER_TOKEN = "f".repeat(43);
const REQUESTER = "coding_agent:cac_01arz3ndektsv4rrffq69g5fav";
const TARGET = "doc_01h455vb4pex5v6nkc6gd5fdw1";
const PENDING = "apr_01h455vb4pex5v6nkc6gd5fdw1";
const GRANTED = "apr_01h455vb4pex5v6nkc6gd5fdw2";
const REJECTED = "apr_01h455vb4pex5v6nkc6gd5fdw3";

function context(
  actor: string,
  operations: string[],
  ref: string,
): AuthenticatedContext {
  return {
    principal: actor,
    actor,
    scope: { operations, targets: {} },
    conditions: {},
    credential_ref: ref,
  } as AuthenticatedContext;
}

async function start(home: string, generation: number) {
  const clock = manualClock(NOW);
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [],
    clock,
    // 시작마다 다른 seed다. 같은 seed는 같은 credential ref를 만들어 기록이 겹친다.
    random: seededRandom(21 + generation),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  const core = started.value;
  for (
    const [credential, token] of [
      [
        context(REQUESTER, [
          "create_approval_request",
          "GetApproval",
          "ListApprovals",
        ], `cred-requester-${generation}`),
        REQUESTER_TOKEN,
      ],
      [
        context("user", [
          "grant_approval_request",
          "reject_approval_request",
          "GetApproval",
          "ListApprovals",
        ], `cred-user-${generation}`),
        USER_TOKEN,
      ],
    ] as const
  ) {
    const accepted = await core.acceptTestCredential?.(credential, token);
    assert(accepted?.ok);
    assert((await core.record(credential)).ok);
  }
  const server: Server = {
    port: core.port,
    dataRoot: core.dataRoot,
    clock,
    confirmation: (body) =>
      core.confirmation?.(body) ??
        Promise.resolve({ ok: false as const, error: { message: "없다" } }),
  };
  return { core, server, clock };
}

async function ask(
  server: Server,
  id: string,
  note: string,
): Promise<ApprovalRequest> {
  const created = await call(
    server,
    "approvals/create",
    REQUESTER_TOKEN,
    command(
      await createInput(
        id,
        REQUESTER,
        await actionOf({
          command: "record_owned_note",
          caller: "user",
          targets: [TARGET],
          value: { note },
        }),
      ),
    ),
  );
  assertEquals(created.status, 200, JSON.stringify(created.body));
  return created.body["request"] as ApprovalRequest;
}

async function stateOf(server: Server, id: string): Promise<string> {
  const read = await call(server, "approvals/get", USER_TOKEN, {
    approval: id,
  });
  assertEquals(read.status, 200, JSON.stringify(read.body));
  return (read.body["request"] as { status: string }).status;
}

Deno.test("platform/approvals#R4 #R6 platform/backup-and-migration#R16: 재시작 점검은 끝나지 않은 approval 대기를 표의 실제 상태로 관측하고 대기는 그대로 이어진다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-approval-restart-" });
  let first: Core | undefined;
  let second: Core | undefined;
  try {
    const opened = await start(home, 1);
    first = opened.core;
    const pending = await ask(opened.server, PENDING, "pending");
    const granted = await ask(opened.server, GRANTED, "granted");
    const rejected = await ask(opened.server, REJECTED, "rejected");
    const grantedDecision = await decide(
      opened.server,
      USER_TOKEN,
      granted,
      "grant",
    );
    assertEquals(grantedDecision.status, 200, JSON.stringify(grantedDecision));
    const grantedSeq = (grantedDecision.body["request"] as ApprovalRequest)
      .closed_seq!;
    const rejectedDecision = await decide(
      opened.server,
      USER_TOKEN,
      rejected,
      "reject",
    );
    assertEquals(
      rejectedDecision.status,
      200,
      JSON.stringify(rejectedDecision),
    );
    await first.shutdown();
    first = undefined;

    // 끈 ledger를 다시 열어 점검한다. 끝난 결정(거절)은 관측에 없고, 미결정 대기와
    // 허락됐지만 적용되지 않은 request는 표의 실제 상태로 나온다.
    const checked = await checkRestart(`${home}/lophn.db`, {
      clock: manualClock(NOW),
      owners: [observeApprovals],
    });
    assert(checked.ok, checked.ok ? "" : checked.error.message);
    const byTarget = new Map(
      checked.value.observations.map((entry) => [entry.target, entry]),
    );
    assertEquals(byTarget.get(PENDING), {
      target: PENDING,
      baseSeq: pending.created_seq,
      outcome: "not_started",
      evidence: [`approval_requests:${PENDING}:pending`],
    });
    // 허락됐지만 적용 기록이 없다: 기준 위치는 허락 결정 event다.
    assertEquals(byTarget.get(GRANTED), {
      target: GRANTED,
      baseSeq: grantedSeq,
      outcome: "not_started",
      evidence: [
        `approval_requests:${GRANTED}:granted`,
        `approval_uses:${GRANTED}:none`,
      ],
    });
    assertEquals(byTarget.has(REJECTED), false);
    // 모든 대상을 확정하지 못하는 영역은 unknown과 안전한 이유로 남는다(전역 barrier 없음).
    assertEquals(byTarget.get("ledger-head")?.outcome, "unknown");

    // 같은 홈으로 다시 띄운다. 대기는 결정되지 않은 채 그대로고, 이어서 사람이 새 handle로
    // 결정할 수 있다. 끝난 결정은 다시 열리지 않는다.
    const reopened = await start(home, 2);
    second = reopened.core;
    assertEquals(await stateOf(reopened.server, PENDING), "pending");
    assertEquals(await stateOf(reopened.server, GRANTED), "granted");
    assertEquals(await stateOf(reopened.server, REJECTED), "rejected");
    const late = await decide(
      reopened.server,
      USER_TOKEN,
      rejected,
      "grant",
    );
    assert(late.status >= 400, JSON.stringify(late.body));
    assertEquals(await stateOf(reopened.server, REJECTED), "rejected");
    const decided = await decide(
      reopened.server,
      USER_TOKEN,
      pending,
      "reject",
    );
    assertEquals(decided.status, 200, JSON.stringify(decided.body));
    assertEquals(await stateOf(reopened.server, PENDING), "rejected");
  } finally {
    await first?.shutdown();
    await second?.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});
