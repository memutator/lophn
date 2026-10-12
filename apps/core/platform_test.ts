// 제품 core가 platform approvals·notifications 모듈을 조립하는지 본다(platform#T17, T21, T22,
// T29). 팀 등록 없이(teams: []) 임시 LOPHN_HOME의 실제 core를 띄우고 HTTP route로만 확인한다.
// route는 contract ROUTES가 소유하므로 조립은 command·read·schema만 더한다. 사람 데이터 root는
// 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { fingerprint } from "../../packages/base/mod.ts";
import {
  type ApprovalAction,
  approvalBinding,
  type AuthenticatedContext,
  grantApprovalRequest,
} from "../../packages/protocol/server/mod.ts";
import { confirmationBinding } from "../../packages/core/server/identity/mod.ts";
import { type CoreHarness, createCoreHarness } from "./testing/core.ts";

type Reply = { status: number; body: Record<string, unknown> };

async function call(
  harness: CoreHarness,
  path: string,
  token: string,
  body: unknown,
): Promise<Reply> {
  const response = await fetch(
    `http://127.0.0.1:${harness.port}/v1/${path}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    },
  );
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

function command(
  input: unknown,
  extra: { compare?: unknown; confirmation?: string } = {},
) {
  return {
    input,
    idempotency_key: `k-${crypto.randomUUID()}`,
    compare: extra.compare ?? {},
    prepared: [],
    ...(extra.confirmation === undefined
      ? {}
      : { confirmation: extra.confirmation }),
  };
}

function codeOf(reply: Reply): unknown {
  return (reply.body["error"] as { code?: unknown } | undefined)?.code;
}

async function login(
  harness: CoreHarness,
  actor: "user" | "machine" | "coding_agent",
  principal: string,
  operations: string[],
): Promise<{ token: string; context: AuthenticatedContext }> {
  const issued = await harness.credential({
    actor,
    principal,
    scope: { operations, targets: {} },
    conditions: {},
  });
  assert(issued.ok, issued.ok ? "" : issued.error.message);
  return issued.value;
}

async function actionFor(caller: string): Promise<ApprovalAction> {
  const draft = {
    concern: "apps/invocations",
    command: "record_started",
    caller: caller as ApprovalAction["caller"],
    targets: ["app_01h455vb4pex5v6nkc6gd5fdw1"],
    input: {
      kind: "inline" as const,
      value: { release: "rel_01h455vb4pex5v6nkc6gd5fdw1" },
    },
    input_hash: "ab".repeat(32),
    comparison: { release: "rel_01h455vb4pex5v6nkc6gd5fdw1" },
  };
  return {
    ...draft,
    binding_hash: await fingerprint(
      approvalBinding({ ...draft, binding_hash: "ab".repeat(32) }),
    ),
  };
}

async function createInput(id: string, requester: string) {
  return {
    id,
    requester,
    run: null,
    reason: "배포 전 확인이 필요하다",
    effect: {
      changes: "release 하나를 시작한다",
      external: null,
      reversible: false,
      reversibility: "시작한 뒤에는 되돌리지 못한다",
    },
    action: await actionFor(requester),
    expires_at: null,
  };
}

const APR_ONE = "apr_01h455vb4pex5v6nkc6gd5fdw1";
const APR_TWO = "apr_01h455vb4pex5v6nkc6gd5fdw2";

const READS = ["GetApproval", "ListApprovals"];

Deno.test("platform/approvals#R17: 요청자와 사람은 pending 요청을 읽고, 다른 connection의 요청은 없는 것과 똑같이 답한다", async () => {
  const opened = await createCoreHarness({ teams: [], io: true });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  const harness = opened.value;
  try {
    const owner = await login(harness, "coding_agent", "coding-agent-1", [
      "create_approval_request",
      ...READS,
    ]);
    const stranger = await login(harness, "coding_agent", "coding-agent-2", [
      ...READS,
    ]);
    const user = await login(harness, "user", "user-1", [...READS]);

    const created = await call(
      harness,
      "approvals/create",
      owner.token,
      command(await createInput(APR_ONE, owner.context.actor)),
    );
    assertEquals(created.status, 200, JSON.stringify(created.body));

    // 요청자와 사람은 읽고 목록에서 본다.
    for (const reader of [owner, user]) {
      const got = await call(harness, "approvals/get", reader.token, {
        approval: APR_ONE,
      });
      assertEquals(got.status, 200, JSON.stringify(got.body));
      const request = got.body["request"] as { id: string; status: string };
      assertEquals([request.id, request.status], [APR_ONE, "pending"]);
      const listed = await call(harness, "approvals/list", reader.token, {});
      assertEquals(listed.status, 200, JSON.stringify(listed.body));
      assertEquals(
        (listed.body["requests"] as { id: string }[]).map((r) => r.id),
        [APR_ONE],
      );
    }

    // 다른 connection은 존재를 알 수 없다. 없는 id와 상태·오류 모양이 같다.
    const hidden = await call(harness, "approvals/get", stranger.token, {
      approval: APR_ONE,
    });
    const absent = await call(harness, "approvals/get", stranger.token, {
      approval: APR_TWO,
    });
    assertEquals(hidden.status, absent.status);
    assertEquals(codeOf(hidden), "not_found");
    assertEquals(hidden.body, absent.body);
    const strangerList = await call(
      harness,
      "approvals/list",
      stranger.token,
      {},
    );
    assertEquals(strangerList.status, 200);
    assertEquals(strangerList.body["requests"], []);
  } finally {
    await harness.close();
  }
});

Deno.test("platform/approvals#R3: handle 없는 허락·거절은 거절되고 coding agent 자격은 handle이 있어도 결정하지 못한다", async () => {
  const opened = await createCoreHarness({ teams: [], io: true });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  const harness = opened.value;
  try {
    const owner = await login(harness, "coding_agent", "coding-agent-1", [
      "create_approval_request",
      "grant_approval_request",
      "reject_approval_request",
      ...READS,
    ]);
    const user = await login(harness, "user", "user-1", [
      "grant_approval_request",
      "reject_approval_request",
      ...READS,
    ]);
    const created = await call(
      harness,
      "approvals/create",
      owner.token,
      command(await createInput(APR_ONE, owner.context.actor)),
    );
    assertEquals(created.status, 200, JSON.stringify(created.body));
    const request = created.body["request"] as {
      created_seq: string;
      action: ApprovalAction;
    };
    const decision = {
      approval: APR_ONE,
      created_seq: request.created_seq,
      binding_hash: request.action.binding_hash,
    };
    const compare = { created_seq: request.created_seq };

    // handle 칸이 없는 요청은 입구에서 거절된다. user 자격으로도 안 된다.
    for (
      const [path, input] of [
        ["approvals/grant", decision],
        ["approvals/reject", { ...decision, closed_reason: null }],
      ] as const
    ) {
      const bare = await call(
        harness,
        path,
        user.token,
        command(input, { compare }),
      );
      assertEquals(bare.status, 400, JSON.stringify(bare.body));
      assertEquals(codeOf(bare), "invalid_input");
    }
    // 형식만 맞고 발급한 적 없는 handle은 writer 실행기가 거절한다.
    const unissued = await call(
      harness,
      "approvals/grant",
      user.token,
      command(decision, { compare, confirmation: "B".repeat(43) }),
    );
    assertEquals(unissued.status, 403, JSON.stringify(unissued.body));
    assertEquals(codeOf(unissued), "forbidden");

    // 사람이 본 내용으로 발급한 handle이 있어도 coding agent 자격은 결정하지 못한다.
    const binding = await confirmationBinding(grantApprovalRequest, decision);
    assert(binding);
    const issue = async () => {
      const issued = await harness.confirmation({
        action: "issue",
        request: {
          type: "confirmation_handle_register",
          window_id: "win-grant",
          target_ref: binding.target,
          content_hash: binding.content,
          allowed_decisions: ["grant_approval_request"],
          expires_at: new Date(harness.clock.nowMs() + 120_000).toISOString(),
        },
      });
      assert(issued.ok, issued.ok ? "" : issued.error.message);
      return (issued.value as { confirmation: string }).confirmation;
    };
    const byAgent = await call(
      harness,
      "approvals/grant",
      owner.token,
      command(decision, { compare, confirmation: await issue() }),
    );
    assertEquals(byAgent.status, 403, JSON.stringify(byAgent.body));
    const stillPending = await call(harness, "approvals/get", user.token, {
      approval: APR_ONE,
    });
    assertEquals(
      (stillPending.body["request"] as { status: string }).status,
      "pending",
    );

    // 사람의 보호된 결정(handle)으로만 상태가 바뀌고, 같은 handle은 다시 쓰지 못한다.
    const handle = await issue();
    const granted = await call(
      harness,
      "approvals/grant",
      user.token,
      command(decision, { compare, confirmation: handle }),
    );
    assertEquals(granted.status, 200, JSON.stringify(granted.body));
    assertEquals(
      (granted.body["request"] as { status: string }).status,
      "granted",
    );
    const replay = await call(
      harness,
      "approvals/grant",
      user.token,
      command(decision, { compare, confirmation: handle }),
    );
    assert(replay.status >= 400, JSON.stringify(replay.body));
    const read = await call(harness, "approvals/get", owner.token, {
      approval: APR_ONE,
    });
    assertEquals(
      (read.body["request"] as { status: string }).status,
      "granted",
    );
  } finally {
    await harness.close();
  }
});

Deno.test("platform/notifications#R1 #R5: approval 요청 계기가 listable notification을 만들고 읽음 표시가 남는다", async () => {
  const opened = await createCoreHarness({ teams: [], io: true });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  const harness = opened.value;
  try {
    const owner = await login(harness, "coding_agent", "coding-agent-1", [
      "create_approval_request",
    ]);
    const user = await login(harness, "user", "user-1", [
      "ListNotifications",
      "GetNotification",
      "mark_notification_read",
    ]);
    const created = await call(
      harness,
      "approvals/create",
      owner.token,
      command(await createInput(APR_ONE, owner.context.actor)),
    );
    assertEquals(created.status, 200, JSON.stringify(created.body));

    // core 안 notifications 구독자가 event를 받아 notification을 만든다.
    type Listed = {
      notification: { id: string; read_at: string | null; source_seq: string };
      source_event: string;
    };
    let items: Listed[] = [];
    for (let attempt = 0; attempt < 100 && items.length === 0; attempt++) {
      const listed = await call(harness, "notifications/list", user.token, {});
      assertEquals(listed.status, 200, JSON.stringify(listed.body));
      items = listed.body["notifications"] as Listed[];
      if (items.length === 0) await new Promise((r) => setTimeout(r, 100));
    }
    assertEquals(items.length, 1);
    assertEquals(items[0].source_event, "ApprovalRequestCreated");
    assertEquals(items[0].notification.read_at, null);
    const id = items[0].notification.id;

    const got = await call(harness, "notifications/get", user.token, {
      notification: id,
    });
    assertEquals(got.status, 200, JSON.stringify(got.body));

    // 읽음은 한 번 표시되고 반복은 바뀌지 않는다. 승인 상태는 그대로다(R6).
    const marked = await call(
      harness,
      "notifications/read",
      user.token,
      command({ notification: id }),
    );
    assertEquals(marked.status, 200, JSON.stringify(marked.body));
    assertEquals(marked.body["changed"], true);
    const readAt = (marked.body["notification"] as { read_at: string }).read_at;
    assert(typeof readAt === "string");
    const again = await call(
      harness,
      "notifications/read",
      user.token,
      command({ notification: id }),
    );
    assertEquals(again.body["changed"], false);
    assertEquals(
      (again.body["notification"] as { read_at: string }).read_at,
      readAt,
    );
    const unread = await call(harness, "notifications/list", user.token, {
      unread_only: true,
    });
    assertEquals(unread.body["notifications"], []);

    // 같은 source 사실은 notification을 늘리지 않는다: 구독자를 더 돌려도 하나다.
    await new Promise((r) => setTimeout(r, 600));
    const all = await call(harness, "notifications/list", user.token, {});
    assertEquals((all.body["notifications"] as unknown[]).length, 1);
  } finally {
    await harness.close();
  }
});

Deno.test("platform/api#R2: platform 모듈은 team 등록 없이 approvals·notifications route를 한 번만 등록한다", async () => {
  const opened = await createCoreHarness({ teams: [], io: true });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  const harness = opened.value;
  try {
    const user = await login(harness, "user", "user-1", ["ListApprovals"]);
    // 등록되지 않은 command라는 거절이 아니라 읽기 응답이 온다.
    const listed = await call(harness, "approvals/list", user.token, {});
    assertEquals(listed.status, 200, JSON.stringify(listed.body));
    assertEquals(listed.body["requests"], []);
  } finally {
    await harness.close();
  }
});
