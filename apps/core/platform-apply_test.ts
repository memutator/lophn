// approval 적용과 한 번 사용(platform#T23)을 실제 core와 임시 LOPHN_HOME의 HTTP route로 본다.
// 소유 command는 시험 전용 team(testing/approval-owner.ts)의 dispatchable `record_owned_note`다.
// 소유 동작이 몇 번 일어났는지는 그 command가 남기는 event 수로, 사용 기록은 approval_uses로 센다.
// 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import type {
  ApprovalAction,
  ApprovalRequest,
  AuthenticatedContext,
  JsonObject,
} from "../../packages/protocol/platform/mod.ts";
import {
  actionOf,
  call,
  codeOf,
  command,
  count,
  createInput,
  decide,
  type Reply,
} from "./testing/approvals-fixture.ts";
import * as approvalOwner from "./testing/approval-owner.ts";
import { type CoreHarness, createCoreHarness } from "./testing/core.ts";

const TARGET = "doc_01h455vb4pex5v6nkc6gd5fdw1";
const OTHER_TARGET = "doc_01h455vb4pex5v6nkc6gd5fdw2";
const APR_ONE = "apr_01h455vb4pex5v6nkc6gd5fdw1";
const APR_TWO = "apr_01h455vb4pex5v6nkc6gd5fdw2";
const APR_THREE = "apr_01h455vb4pex5v6nkc6gd5fdw3";
const APR_MISSING = "apr_01h455vb4pex5v6nkc6gd5fdw9";

const NOTES =
  "select count(*) as n from events where type = 'OwnedNoteRecorded'";
const USES = "select count(*) as n from approval_uses";

type Login = { token: string; context: AuthenticatedContext };

type World = {
  harness: CoreHarness;
  requester: Login;
  user: Login;
  machine: Login;
  stranger: Login;
  agent: Login;
};

async function login(
  harness: CoreHarness,
  actor: "user" | "machine" | "coding_agent" | "agent",
  principal: string,
  operations: string[],
): Promise<Login> {
  const issued = await harness.credential({
    actor,
    principal,
    scope: { operations, targets: {} },
    conditions: {},
  });
  assert(issued.ok, issued.ok ? "" : issued.error.message);
  return issued.value;
}

async function open(): Promise<World> {
  const opened = await createCoreHarness({
    io: true,
    teams: [approvalOwner],
    teamModules: [
      new URL("./testing/approval-owner.ts", import.meta.url).href,
    ],
  });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  const harness = opened.value;
  const apply = "apply_approved_action";
  const reads = ["GetApproval", "ListApprovals"];
  return {
    harness,
    // 요청자: 사람이 아니라 coding agent다. 적용은 고정 호출자(user)나 machine만 한다.
    requester: await login(harness, "coding_agent", "requester-1", [
      "create_approval_request",
      "cancel_approval_request",
      apply,
      "record_owned_note",
      ...reads,
    ]),
    user: await login(harness, "user", "user-1", [
      "grant_approval_request",
      "reject_approval_request",
      apply,
      "record_owned_note",
      ...reads,
    ]),
    machine: await login(harness, "machine", "machine-1", [
      apply,
      "record_owned_note",
      ...reads,
    ]),
    stranger: await login(harness, "coding_agent", "stranger-1", [
      apply,
      "record_owned_note",
      ...reads,
    ]),
    agent: await login(harness, "agent", "agent-1", [
      apply,
      "record_owned_note",
      ...reads,
    ]),
  };
}

function exact(
  note: string,
  extra: {
    caller?: ApprovalAction["caller"];
    targets?: string[];
    comparison?: JsonObject;
    inputHash?: string;
  } = {},
): Promise<ApprovalAction> {
  return actionOf({
    command: "record_owned_note",
    caller: extra.caller ?? "user",
    targets: extra.targets ?? [TARGET],
    value: { note },
    comparison: extra.comparison ?? { basis: approvalOwner.CURRENT_BASIS },
    ...(extra.inputHash === undefined ? {} : { inputHash: extra.inputHash }),
  });
}

async function request(
  world: World,
  id: string,
  action: ApprovalAction,
  expiresAt: string | null = null,
): Promise<ApprovalRequest> {
  const created = await call(
    world.harness,
    "approvals/create",
    world.requester.token,
    command(
      await createInput(id, world.requester.context.actor, action, {
        expiresAt,
      }),
    ),
  );
  assertEquals(created.status, 200, JSON.stringify(created.body));
  return created.body["request"] as ApprovalRequest;
}

async function granted(
  world: World,
  id: string,
  action: ApprovalAction,
  expiresAt: string | null = null,
): Promise<ApprovalRequest> {
  const pending = await request(world, id, action, expiresAt);
  const decided = await decide(
    world.harness,
    world.user.token,
    pending,
    "grant",
  );
  assertEquals(decided.status, 200, JSON.stringify(decided.body));
  return decided.body["request"] as ApprovalRequest;
}

function apply(
  world: World,
  login: Login,
  approval: string,
  action: ApprovalAction,
  key = "apply-1",
): Promise<Reply> {
  return call(
    world.harness,
    "approvals/apply",
    login.token,
    command({ approval, action, idempotency_key: key }),
  );
}

async function useOf(
  world: World,
  approval: string,
): Promise<{ use: unknown; status: string }> {
  const read = await call(
    world.harness,
    "approvals/get",
    world.user.token,
    { approval },
  );
  assertEquals(read.status, 200, JSON.stringify(read.body));
  return {
    use: read.body["use"],
    status: (read.body["request"] as { status: string }).status,
  };
}

Deno.test("platform/approvals#R7 #R9: 허락은 저장일 뿐이고 적용은 소유 동작과 사용 기록을 한 번만 확정하며 재호출은 같은 receipt다", async () => {
  const world = await open();
  const { harness } = world;
  try {
    const action = await exact("first");
    await granted(world, APR_ONE, action);

    // 허락이 저장돼도 적용된 것이 아니다. 소유 동작도 사용 기록도 없다(R9).
    assertEquals(await useOf(world, APR_ONE), {
      use: null,
      status: "granted",
    });
    assertEquals(count(harness, NOTES), 0);
    assertEquals(count(harness, USES), 0);

    const applied = await apply(world, world.user, APR_ONE, action);
    assertEquals(applied.status, 200, JSON.stringify(applied.body));
    assertEquals(applied.body["replayed"], false);
    const use = applied.body["use"] as {
      approval: string;
      concern: string;
      receipt: { kind: string; seq: string };
      accepted_seq: string;
    };
    assertEquals(use.approval, APR_ONE);
    assertEquals(use.concern, "test-owner/notes");
    assertEquals(use.receipt.kind, "event");
    assertEquals(use.receipt.seq, use.accepted_seq);
    assertEquals(count(harness, NOTES), 1);
    assertEquals(count(harness, USES), 1);
    // receipt는 소유 command가 남긴 event를 가리킨다.
    assertEquals(
      count(
        harness,
        "select count(*) as n from events where seq = ? and type = 'OwnedNoteRecorded'",
        [Number(use.accepted_seq)],
      ),
      1,
    );
    // 적용 뒤 get이 사용 기록을 보여 준다. 허락 저장과 적용 성공이 구별된다(R9).
    assertEquals((await useOf(world, APR_ONE)).use, use);

    // 다른 키로 다시 불러도(중복 전달) 같은 receipt이고 새 동작·새 행은 없다(R7).
    const again = await apply(world, world.user, APR_ONE, action, "apply-2");
    assertEquals(again.status, 200, JSON.stringify(again.body));
    assertEquals(again.body["replayed"], true);
    assertEquals(again.body["use"], use);
    // 같은 키 재전달도 이전 결과다.
    const same = await apply(world, world.user, APR_ONE, action, "apply-1");
    assertEquals(same.status, 200, JSON.stringify(same.body));
    assertEquals(same.body["use"], use);
    assertEquals(count(harness, NOTES), 1);
    assertEquals(count(harness, USES), 1);

    // 사용된 허락으로 다른 동작을 하지 못한다: 같은 approval에 다른 action을 대면 conflict다.
    const other = await exact("second");
    const swapped = await apply(world, world.user, APR_ONE, other, "apply-3");
    assertEquals(swapped.status, 409, JSON.stringify(swapped.body));
    assertEquals(count(harness, NOTES), 1);

    // machine도 같은 허락의 재호출은 같은 receipt다. 새 동작은 없다.
    const viaMachine = await apply(world, world.machine, APR_ONE, action);
    assertEquals(viaMachine.status, 200, JSON.stringify(viaMachine.body));
    assertEquals(viaMachine.body["use"], use);
    assertEquals(count(harness, NOTES), 1);
  } finally {
    await harness.close();
  }
});

Deno.test("platform/approvals#R5 #R10: 다른 동작·대상·입력·비교 기준·범위 확대는 거절하고 허락은 소비되지 않는다", async () => {
  const world = await open();
  const { harness } = world;
  try {
    const action = await exact("first");
    await granted(world, APR_ONE, action);

    const variants: [string, ApprovalAction][] = [
      ["다른 대상", await exact("first", { targets: [OTHER_TARGET] })],
      [
        "범위 확대(대상 추가)",
        await exact("first", {
          targets: [TARGET, OTHER_TARGET],
        }),
      ],
      ["다른 입력", await exact("changed")],
      [
        "다른 비교 기준",
        await exact("first", {
          comparison: { basis: "stale" },
        }),
      ],
      ["다른 호출자", await exact("first", { caller: "machine" })],
      [
        "다른 command",
        await actionOf({
          command: "record_other_note",
          caller: "user",
          targets: [TARGET],
          value: { note: "first" },
          comparison: { basis: approvalOwner.CURRENT_BASIS },
        }),
      ],
    ];
    for (const [label, changed] of variants) {
      const refused = await apply(world, world.user, APR_ONE, changed);
      assertEquals(refused.status, 409, `${label}: ${JSON.stringify(refused)}`);
      assertEquals(codeOf(refused), "conflict", label);
    }
    // 어느 거절도 소유 동작이나 사용 기록을 남기지 않았다.
    assertEquals(count(harness, NOTES), 0);
    assertEquals(count(harness, USES), 0);
    assertEquals((await useOf(world, APR_ONE)).use, null);

    // 정확한 action은 그대로 한 번 적용된다: 거절이 허락을 소비하지 않았다.
    const applied = await apply(world, world.user, APR_ONE, action, "apply-ok");
    assertEquals(applied.status, 200, JSON.stringify(applied.body));
    assertEquals(count(harness, NOTES), 1);
    assertEquals(count(harness, USES), 1);

    // 저장된 입력 지문이 입력과 다른 request는 정확한 action이어도 적용하지 않는다.
    const forged = await exact("forged", { inputHash: "ab".repeat(32) });
    await granted(world, APR_TWO, forged);
    const refused = await apply(world, world.user, APR_TWO, forged);
    assertEquals(refused.status, 409, JSON.stringify(refused.body));
    assertEquals(count(harness, NOTES), 1);
    assertEquals(count(harness, USES), 1);
  } finally {
    await harness.close();
  }
});

Deno.test("platform/approvals#R4 #R11: 허락되지 않은 request는 적용하지 못하고 낡은 전제의 소유 거절은 사용 기록 없이 전체가 되돌아간다", async () => {
  const world = await open();
  const { harness } = world;
  try {
    // 대기 중인 request는 결정이 아니다.
    const pendingAction = await exact("pending");
    const pending = await request(world, APR_ONE, pendingAction);
    const early = await apply(world, world.user, APR_ONE, pendingAction);
    assertEquals(early.status, 409, JSON.stringify(early.body));

    // 거절·취소된 request도 적용하지 못한다.
    const rejectAction = await exact("rejected");
    const toReject = await request(world, APR_TWO, rejectAction);
    const rejected = await decide(
      harness,
      world.user.token,
      toReject,
      "reject",
    );
    assertEquals(rejected.status, 200, JSON.stringify(rejected.body));
    assertEquals(
      (await apply(world, world.user, APR_TWO, rejectAction)).status,
      409,
    );
    assertEquals(pending.status, "pending");

    // 없는 approval은 not_found다.
    const absent = await apply(world, world.user, APR_MISSING, pendingAction);
    assertEquals(absent.status, 404, JSON.stringify(absent.body));

    // 허락 뒤 전제가 낡았다: 소유 command의 CAS 거절이 전체를 되돌린다. 사용 기록·event가 없다.
    const stale = await exact("stale", { comparison: { basis: "old" } });
    await granted(world, APR_THREE, stale);
    const failed = await apply(world, world.user, APR_THREE, stale);
    assertEquals(failed.status, 409, JSON.stringify(failed.body));
    assertEquals(count(harness, NOTES), 0);
    assertEquals(count(harness, USES), 0);
    assertEquals((await useOf(world, APR_THREE)).use, null);
    // 실패 뒤 재호출도 새 receipt를 만들지 않는다.
    const retry = await apply(world, world.user, APR_THREE, stale, "apply-2");
    assertEquals(retry.status, 409, JSON.stringify(retry.body));
    assertEquals(count(harness, USES), 0);
  } finally {
    await harness.close();
  }
});

Deno.test("platform/approvals#R12: 기한에 도달하면 허락된 request도 새 사용을 거절하고 granted 기록은 보존된다", async () => {
  const world = await open();
  const { harness } = world;
  try {
    const action = await exact("deadline");
    const expiresAt = new Date(harness.clock.nowMs() + 60_000).toISOString();
    await granted(world, APR_ONE, action, expiresAt);

    // 기한 직전에는 사용할 수 있다. 같은 시험에서 다른 approval로 경계를 본다.
    const early = await exact("early");
    await granted(world, APR_TWO, early, expiresAt);
    harness.clock.advance(59_999);
    // 테스트 시계는 writer와 공유되지 않아 민 시각을 알려야 한다.
    await harness.sweepTicketClaims();
    const before = await apply(world, world.user, APR_TWO, early);
    assertEquals(before.status, 200, JSON.stringify(before.body));
    assertEquals(count(harness, NOTES), 1);

    // 기한 경계부터는 거절한다.
    harness.clock.advance(1);
    await harness.sweepTicketClaims();
    const late = await apply(world, world.user, APR_ONE, action);
    assertEquals(late.status, 409, JSON.stringify(late.body));
    assertEquals(codeOf(late), "conflict");
    assertEquals(count(harness, NOTES), 1);
    assertEquals(count(harness, USES), 1);
    // 허락 기록은 그대로 granted이고 기한이 지났다고 expired로 바뀌지 않는다.
    assertEquals(await useOf(world, APR_ONE), { use: null, status: "granted" });
    // 이미 사용한 허락의 재호출은 새 사용이 아니라 같은 receipt다.
    const replay = await apply(world, world.user, APR_TWO, early, "apply-2");
    assertEquals(replay.status, 200, JSON.stringify(replay.body));
    assertEquals(replay.body["replayed"], true);
  } finally {
    await harness.close();
  }
});

Deno.test("platform/approvals#R3 #R7: 고정 호출자와 machine 밖의 자격(다른 coding agent·agent·요청자)은 적용하지 못하고 없는 request와 똑같이 답한다", async () => {
  const world = await open();
  const { harness } = world;
  try {
    const action = await exact("authority");
    await granted(world, APR_ONE, action);
    const absent = await apply(world, world.stranger, APR_MISSING, action);

    // 다른 coding agent와 요청자 자신: 적용 권한이 없고 존재도 알려 주지 않는다.
    for (const outsider of [world.stranger, world.requester]) {
      const refused = await apply(world, outsider, APR_ONE, action);
      assertEquals(refused.status, 404, JSON.stringify(refused.body));
      assertEquals(refused.status, absent.status);
      assertEquals(refused.body, absent.body);
    }
    // agent 자격은 run 없는 command를 부르지 못한다. 어느 쪽이든 적용되지 않는다.
    const byAgent = await apply(world, world.agent, APR_ONE, action);
    assert(byAgent.status >= 400, JSON.stringify(byAgent.body));
    assertEquals(count(harness, NOTES), 0);
    assertEquals(count(harness, USES), 0);
    assertEquals((await useOf(world, APR_ONE)).use, null);

    // 고정 호출자(user)와 machine은 적용한다.
    const applied = await apply(world, world.machine, APR_ONE, action);
    assertEquals(applied.status, 200, JSON.stringify(applied.body));
    assertEquals(count(harness, NOTES), 1);
  } finally {
    await harness.close();
  }
});
