// 대화 안 승인 카드의 허락 범위(platform/approvals#R18, R19, R20). 실제 ledger(임시 파일 SQLite)와
// writer의 confirmation registry를 쓴다. 같은 session의 이어지는 호출을 새 request 없이 통과시키는 판정은
// lophn-agent/harness/tool-judgment가 맡고 여기는 허락 범위의 저장과 거절 규칙만 본다. run의 session은
// lophn-agent가 채우는 사실이라 harness_test.ts의 고정 표가 대신한다.

import { assert, assertEquals } from "@std/assert";
import { sha256Hex } from "../../base/mod.ts";
import type { InvocationAcceptConfirmInput } from "../../contracts/apps/mod.ts";
import {
  type ApprovalRequest,
  grantApprovalRequest,
} from "../../contracts/platform/mod.ts";
import { confirmationBinding } from "../identity/mod.ts";
import { confirmAction } from "./confirm.ts";
import {
  RUN_A,
  RUN_B,
  RUN_BARE,
  RUN_C,
  SESSION_A,
  SESSION_B,
} from "./harness_test.ts";
import {
  action,
  APP,
  APPROVAL,
  create,
  credential,
  decide,
  decisionInput,
  failure,
  issue,
  type LedgerHarness,
  machine,
  NOW,
  openHarness,
  requestOf,
  statusOf,
  user,
  value,
} from "./requests_fixture_test.ts";

const OTHER = "apr_01h455vb4pex5v6nkc6gd5fdw2";
const THIRD = "apr_01h455vb4pex5v6nkc6gd5fdw3";
const AGENT = "agent:asg_01h455vb4pex5v6nkc6gd5fdw1" as const;
const agent = credential(AGENT, "agent-1");
const app = credential(`app:${APP}`, "app-1");
const USE_COUNT = "select count(*) as n from approval_uses";

async function granting(
  harness: LedgerHarness,
  id: string,
  scope: unknown,
  key: string,
) {
  const input = { ...(await decisionInput(harness, id)), scope };
  return await decide(
    harness,
    user,
    "grant",
    input,
    key,
    await issue(harness, "grant", input),
  );
}

async function row(
  harness: LedgerHarness,
  id: string,
): Promise<Record<string, unknown>> {
  return value(
    await harness.inspect(
      `select status, session_grantable, grant_scope, grant_session
         from approval_requests where id = ?`,
      [id],
    ),
  )[0];
}

Deno.test("platform/approvals#R19 [agent-I14]: Allow for this session은 그 request를 허락하고 run의 session을 허락 session으로 남긴다", async () => {
  const harness = await openHarness([user, agent]);
  try {
    value(await create(harness, agent, { run: RUN_A, sessionGrantable: true }));
    const granted = requestOf(
      value(await granting(harness, APPROVAL, "session", "g-session")),
    );
    assertEquals(granted["status"], "granted");
    assertEquals(granted["session_grantable"], true);
    assertEquals(granted["grant_scope"], "session");
    assertEquals(granted["grant_session"], SESSION_A);
    const stored = await row(harness, APPROVAL);
    assertEquals(stored["grant_scope"], "session");
    assertEquals(stored["grant_session"], SESSION_A);
    // 허락 event가 범위와 session을 싣는다. 허락한 사람은 user다.
    const events = value(
      await harness.inspect(
        "select actor, payload from events where type = 'ApprovalRequestGranted'",
      ),
    );
    assertEquals(events.length, 1);
    assertEquals(events[0]["actor"], "user");
    const payload = JSON.parse(String(events[0]["payload"]));
    assertEquals(payload.scope, "session");
    assertEquals(payload.session, SESSION_A);
    // 읽기는 같은 값을 돌려준다.
    const read = value(
      await harness.read({ resource: "approvals", method: "get" }, user, {
        approval: APPROVAL,
      }),
    ) as { request: ApprovalRequest };
    assertEquals(read.request.grant_scope, "session");
    assertEquals(read.request.grant_session, SESSION_A);
  } finally {
    await harness.close();
  }
});

Deno.test("platform/approvals#R19 [agent-I14]: 허락 session은 run에서 읽는다 — 같은 session의 다른 run도 그 session이고 다른 session의 run은 그 session이다", async () => {
  const harness = await openHarness([user, agent]);
  try {
    value(await create(harness, agent, { run: RUN_B, sessionGrantable: true }));
    value(
      await create(harness, agent, {
        id: OTHER,
        run: RUN_C,
        sessionGrantable: true,
      }),
    );
    value(await granting(harness, APPROVAL, "session", "g-b"));
    value(await granting(harness, OTHER, "session", "g-c"));
    assertEquals((await row(harness, APPROVAL))["grant_session"], SESSION_A);
    assertEquals((await row(harness, OTHER))["grant_session"], SESSION_B);
    // 허락 session으로 거른다: 다른 session의 허락은 섞이지 않는다.
    const listed = async (session: string) =>
      (value(
        await harness.read({ resource: "approvals", method: "list" }, user, {
          status: "granted",
          grant_session: session,
        }),
      ) as { requests: ApprovalRequest[] }).requests.map((request) =>
        request.id
      );
    assertEquals(await listed(SESSION_A), [APPROVAL]);
    assertEquals(await listed(SESSION_B), [OTHER]);
  } finally {
    await harness.close();
  }
});

Deno.test("platform/approvals#R19 [agent-I14]: session 허락도 그 request 자체는 한 번만 사용된다", async () => {
  const harness = await openHarness([user, agent]);
  try {
    value(await create(harness, agent, { run: RUN_A, sessionGrantable: true }));
    value(await granting(harness, APPROVAL, "session", "g-once-use"));
    const fixed = await action();
    const use = (key: string) =>
      harness.command(user, {
        command: "probe_use_approval",
        input: { approval: APPROVAL, action: fixed, seq: null, concern: null },
        idempotency_key: key,
        compare: {},
        prepared: [],
      });
    value(await use("u-1"));
    assertEquals(failure(await use("u-2")).code, "conflict");
    assertEquals(
      value(await harness.inspect(USE_COUNT))[0]["n"],
      1n,
    );
  } finally {
    await harness.close();
  }
});

Deno.test("platform/approvals#R18 [agent-I14]: Allow once는 그 request 하나만 허락하고 허락 session을 남기지 않는다", async () => {
  const harness = await openHarness([user, agent]);
  try {
    value(await create(harness, agent, { run: RUN_A, sessionGrantable: true }));
    const granted = requestOf(
      value(await granting(harness, APPROVAL, "once", "g-once")),
    );
    assertEquals(granted["status"], "granted");
    assertEquals(granted["grant_scope"], "once");
    assertEquals(granted["grant_session"], null);
    const events = value(
      await harness.inspect(
        "select payload from events where type = 'ApprovalRequestGranted'",
      ),
    );
    const payload = JSON.parse(String(events[0]["payload"]));
    assertEquals(payload.scope, "once");
    assertEquals(payload.session, null);
    const listed = value(
      await harness.read({ resource: "approvals", method: "list" }, user, {
        status: "granted",
        grant_session: SESSION_A,
      }),
    ) as { requests: unknown[] };
    assertEquals(listed.requests, []);
  } finally {
    await harness.close();
  }
});

Deno.test("platform/approvals#R18 [agent-I14]: 범위는 once와 session뿐이고 계속 허락(always) 같은 값은 거절하며 request는 대기로 남는다", async () => {
  const harness = await openHarness([user, agent]);
  try {
    value(await create(harness, agent, { run: RUN_A, sessionGrantable: true }));
    for (const scope of ["always", "forever", "", null]) {
      assertEquals(
        failure(await granting(harness, APPROVAL, scope, `g-${scope}`)).code,
        "invalid_input",
        String(scope),
      );
    }
    assertEquals(await statusOf(harness, APPROVAL), "pending");
  } finally {
    await harness.close();
  }
});

Deno.test("platform/approvals#R18 [agent-I14]: 범위를 모르는 호출은 한 번 허락(once)이고 그 handle은 session 허락을 열지 않는다", async () => {
  const harness = await openHarness([user, agent]);
  try {
    value(await create(harness, agent, { run: RUN_A, sessionGrantable: true }));
    const input = await decisionInput(harness, APPROVAL);
    // scope 칸이 없는 입력으로 내용 기준을 만든 handle(범위를 모르는 기존 호출처)이다.
    const route = grantApprovalRequest;
    const binding = await confirmationBinding(route, input);
    assert(binding);
    const issued = value(
      await harness.confirmation({
        action: "issue",
        request: {
          type: "confirmation_handle_register",
          window_id: "win-legacy",
          target_ref: binding.target,
          content_hash: binding.content,
          allowed_decisions: [route.name],
          expires_at: new Date(NOW + 120_000).toISOString(),
        },
      }),
    ) as { confirmation: string };
    const send = (extra: Record<string, unknown>, key: string) =>
      harness.command(user, {
        command: "grant_approval_request",
        input: { ...input, ...extra },
        idempotency_key: key,
        compare: { created_seq: input["created_seq"] },
        prepared: [],
        confirmation: issued.confirmation,
      });
    // 같은 handle로 session을 허락하지 못한다.
    assertEquals(
      failure(await send({ scope: "session" }, "g-up")).code,
      "forbidden",
    );
    assertEquals(await statusOf(harness, APPROVAL), "pending");
    // scope가 없는 호출은 once다.
    const granted = requestOf(value(await send({}, "g-default")));
    assertEquals(granted["grant_scope"], "once");
    assertEquals(granted["grant_session"], null);
  } finally {
    await harness.close();
  }
});

Deno.test("platform/approvals#R3 #R18 [agent-I14]: 고른 범위는 confirmation 내용에 묶여 once용 handle로 session을 허락하지 못한다", async () => {
  const harness = await openHarness([user, agent]);
  try {
    value(await create(harness, agent, { run: RUN_A, sessionGrantable: true }));
    const base = await decisionInput(harness, APPROVAL);
    const once = await issue(harness, "grant", { ...base, scope: "once" });
    assertEquals(
      failure(
        await decide(
          harness,
          user,
          "grant",
          { ...base, scope: "session" },
          "g-widen",
          once,
        ),
      ).code,
      "forbidden",
    );
    assertEquals(await statusOf(harness, APPROVAL), "pending");
    // 맞는 범위의 handle은 통과한다.
    const widened = await issue(harness, "grant", {
      ...base,
      scope: "session",
    });
    const granted = requestOf(
      value(
        await decide(
          harness,
          user,
          "grant",
          { ...base, scope: "session" },
          "g-ok",
          widened,
        ),
      ),
    );
    assertEquals(granted["grant_scope"], "session");
  } finally {
    await harness.close();
  }
});

Deno.test("platform/approvals#R20 [agent-I14]: session_grantable이 아닌 request에 session을 고르면 거절하고 once로는 허락할 수 있다", async () => {
  const harness = await openHarness([user, agent]);
  try {
    value(await create(harness, agent, { run: RUN_A }));
    assertEquals(
      failure(await granting(harness, APPROVAL, "session", "g-no")).code,
      "invalid_input",
    );
    assertEquals(await statusOf(harness, APPROVAL), "pending");
    assertEquals(
      (await row(harness, APPROVAL))["grant_session"],
      null,
    );
    const granted = requestOf(
      value(await granting(harness, APPROVAL, "once", "g-yes")),
    );
    assertEquals(granted["grant_scope"], "once");
  } finally {
    await harness.close();
  }
});

Deno.test("platform/approvals#R20 [agent-I14]: session_grantable은 agent tool call의 ask만 켠다 — 사람·앱·machine 요청과 session 없는 run은 켜지 못한다", async () => {
  const harness = await openHarness([user, machine, app, agent]);
  try {
    for (const [index, ctx] of [user, machine, app].entries()) {
      assertEquals(
        failure(
          await create(harness, ctx, {
            id: `apr_01h455vb4pex5v6nkc6gd5fdw${index + 4}`,
            sessionGrantable: true,
          }),
        ).code,
        "invalid_input",
        ctx.actor,
      );
    }
    // session이 없는 run(주기 회차)의 ask에는 허락을 걸 session이 없다.
    assertEquals(
      failure(
        await create(harness, agent, {
          id: THIRD,
          run: RUN_BARE,
          sessionGrantable: true,
        }),
      ).code,
      "invalid_input",
    );
    assertEquals(
      value(
        await harness.inspect("select count(*) as n from approval_requests"),
      )[
        0
      ]["n"],
      0n,
    );
    // 같은 agent·run이라도 session이 있는 run이면 켠다. 켜지 않는 것도 된다.
    value(
      await create(harness, agent, {
        id: OTHER,
        run: RUN_A,
        sessionGrantable: true,
      }),
    );
    value(await create(harness, agent, { run: RUN_A }));
    assertEquals((await row(harness, OTHER))["session_grantable"], 1n);
    assertEquals((await row(harness, APPROVAL))["session_grantable"], 0n);
  } finally {
    await harness.close();
  }
});

Deno.test("platform/approvals#R20 [agent-I14]: 사람이 확인하는 앱 command(confirm)의 request에는 session 선택이 없다", async () => {
  const harness = await openHarness([user, agent]);
  try {
    const accept: InvocationAcceptConfirmInput = {
      app: "app_01h455vb4pex5v6nkc6gd5fdw2",
      release: "rel_01h455vb4pex5v6nkc6gd5fdw1",
      command: "send_invoice",
      input_hash: await sha256Hex('{"amount":12}'),
      approval: APPROVAL,
      key: "confirm-key-1",
      process_nonce: "nonce-1",
      caller: {
        kind: "agent",
        run: RUN_A,
        tool_call: "tcl_01h455vb4pex5v6nkc6gd5fdw1",
      },
    };
    const confirm = confirmAction(AGENT, accept);
    assertEquals(
      failure(
        await create(harness, agent, {
          run: RUN_A,
          action: confirm,
          sessionGrantable: true,
        }),
      ).code,
      "invalid_input",
    );
    // 켜지 않으면 confirm request도 만들어진다.
    value(await create(harness, agent, { run: RUN_A, action: confirm }));
    assertEquals(
      failure(await granting(harness, APPROVAL, "session", "g-confirm")).code,
      "invalid_input",
    );
    assertEquals(await statusOf(harness, APPROVAL), "pending");
  } finally {
    await harness.close();
  }
});
