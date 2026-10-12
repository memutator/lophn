// confirm 앱 command의 approval request 규칙(platform/approvals#R8, platform#T32). 규칙 함수와
// 실제 ledger(임시 파일 SQLite)의 생성·허락 command를 본다. 소유 접수와 한 번 사용까지의 끝에서 끝은
// apps/core/platform-confirm_test.ts가 실제 core로 본다.
import { assert, assertEquals } from "@std/assert";
import { sha256Hex } from "../../base/mod.ts";
import type { InvocationAcceptConfirmInput } from "../../protocol/apps/mod.ts";
import type {
  ApprovalAction,
  ApprovalRequest,
} from "../../protocol/platform/mod.ts";
import {
  checkConfirmAction,
  CONFIRM_COMMAND,
  CONFIRM_CONCERN,
  confirmAction,
} from "./confirm.ts";
import {
  APP,
  APPROVAL,
  credential,
  decide,
  decisionInput,
  effect,
  failure,
  issue,
  openHarness,
  statusOf,
  user,
  value,
} from "./requests_fixture_test.ts";

const CALLEE = "app_01h455vb4pex5v6nkc6gd5fdw2";
const RELEASE = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const NEXT_RELEASE = "rel_01h455vb4pex5v6nkc6gd5fdw2";
const INVOCATION_RUN = "run_01h455vb4pex5v6nkc6gd5fdw1";
const TOOL_CALL = "tcl_01h455vb4pex5v6nkc6gd5fdw1";
const OTHER = "apr_01h455vb4pex5v6nkc6gd5fdw2";
const THIRD = "apr_01h455vb4pex5v6nkc6gd5fdw3";
const AGENT = "agent:asg_01h455vb4pex5v6nkc6gd5fdw1";

// 다른 앱(APP)이 CALLEE의 command를 부르는 호출이다. 요청자는 그 앱 자신이다.
const appActor = `app:${APP}` as const;
const app = credential(appActor, "app-1");

async function accept(
  overrides: Partial<InvocationAcceptConfirmInput> = {},
  approval = APPROVAL,
): Promise<InvocationAcceptConfirmInput> {
  return {
    app: CALLEE,
    release: RELEASE,
    command: "send_invoice",
    input_hash: await sha256Hex('{"amount":12,"to":"kim"}'),
    approval,
    key: "confirm-key-1",
    process_nonce: "nonce-1",
    caller: {
      kind: "app",
      app: APP,
      release: RELEASE,
      parent_invocation: null,
    },
    ...overrides,
  };
}

async function create(
  harness: Awaited<ReturnType<typeof openHarness>>,
  requester: typeof app | typeof user,
  id: string,
  fixed: ApprovalAction,
  key = `create-${id}`,
) {
  return await harness.command(requester, {
    command: "create_approval_request",
    input: {
      id,
      requester: requester.actor,
      run: null,
      reason: "송장 보내기는 외부 전송이라 확인이 필요하다",
      effect: effect("kim@example.com 으로 송장 전송"),
      action: fixed,
      expires_at: null,
      session_grantable: false,
    },
    idempotency_key: key,
    compare: {},
    prepared: [],
  });
}

Deno.test("platform/approvals#R8: confirm action은 정확한 앱·release·command·입력과 실제 호출 주체에 묶인다", async () => {
  const fixed = confirmAction(appActor, await accept());
  assertEquals(fixed.concern, CONFIRM_CONCERN);
  assertEquals(fixed.command, CONFIRM_COMMAND);
  assertEquals(fixed.caller, appActor);
  assertEquals(fixed.targets, [CALLEE, RELEASE]);
  assertEquals(fixed.comparison, { release: RELEASE });
  // 만든 action은 요청 규칙을 통과한다.
  assert(checkConfirmAction(APPROVAL, appActor, fixed).ok);
  // 같은 입력이면 같은 지문이고, release 하나만 달라도 지문이 다르다(새 request가 필요하다).
  assertEquals(confirmAction(appActor, await accept()), fixed);
  const next = confirmAction(appActor, await accept({ release: NEXT_RELEASE }));
  assert(next.binding_hash !== fixed.binding_hash);
  assert(next.input_hash !== fixed.input_hash);
  // confirm이 아닌 action은 이 규칙이 건드리지 않는다.
  assert(
    checkConfirmAction(APPROVAL, appActor, { ...fixed, command: "record" }).ok,
  );
});

Deno.test("platform/approvals#R8: 요청자와 접수 caller의 종류·주체가 어긋나면 만들지 못한다", async () => {
  const direct = await accept({ caller: { kind: "direct" } });
  assert(
    checkConfirmAction(APPROVAL, "user", confirmAction("user", direct)).ok,
  );
  const byAgent = await accept({
    caller: { kind: "agent", run: INVOCATION_RUN, tool_call: TOOL_CALL },
  });
  assert(checkConfirmAction(APPROVAL, AGENT, confirmAction(AGENT, byAgent)).ok);

  const refused: [string, string, ApprovalAction][] = [
    // 다른 앱이 부른 호출을 사람이나 다른 앱의 이름으로 올리지 못한다.
    ["앱 호출을 user 요청자로", "user", confirmAction("user", await accept())],
    [
      "앱 호출을 다른 앱 요청자로",
      "app:app_01h455vb4pex5v6nkc6gd5fdw9",
      confirmAction(
        "app:app_01h455vb4pex5v6nkc6gd5fdw9",
        await accept(),
      ),
    ],
    // 사람이 직접 부른 호출을 agent가 대신 올리지 못한다.
    ["직접 호출을 agent 요청자로", AGENT, confirmAction(AGENT, direct)],
    ["agent 호출을 user 요청자로", "user", confirmAction("user", byAgent)],
    // 요청자와 action의 호출 주체가 다르다.
    [
      "action caller가 요청자와 다름",
      appActor,
      { ...confirmAction("user", await accept()) },
    ],
    // 사람이 확인하는 호출의 caller가 아니다.
    [
      "automation caller",
      "machine",
      confirmAction(
        "machine",
        await accept({ caller: { kind: "automation", key: "nightly" } }),
      ),
    ],
    [
      "system caller",
      "machine",
      confirmAction("machine", await accept({ caller: { kind: "system" } })),
    ],
  ];
  for (const [label, requester, fixed] of refused) {
    const checked = checkConfirmAction(APPROVAL, requester, fixed);
    assert(!checked.ok, label);
    assertEquals(checked.error.code, "invalid_input", label);
  }
});

Deno.test("platform/approvals#R8: 입력·대상·비교 기준·지문이 접수 입력과 맞지 않으면 만들지 못한다", async () => {
  const fixed = confirmAction(appActor, await accept());
  const tampered: [string, ApprovalAction][] = [
    [
      "다른 approval id의 입력",
      confirmAction(appActor, await accept({}, OTHER)),
    ],
    ["대상에 release 없음", { ...fixed, targets: [CALLEE] }],
    ["대상 순서 바뀜", { ...fixed, targets: [RELEASE, CALLEE] }],
    ["다른 release 대상", { ...fixed, targets: [CALLEE, NEXT_RELEASE] }],
    ["비교 기준의 다른 release", {
      ...fixed,
      comparison: { release: NEXT_RELEASE },
    }],
    ["비교 기준에 release 없음", { ...fixed, comparison: {} }],
    ["입력 지문이 입력과 다름", {
      ...fixed,
      input_hash: await sha256Hex("다른 입력"),
    }],
    ["binding 지문이 내용과 다름", {
      ...fixed,
      binding_hash: await sha256Hex("다른 binding"),
    }],
    ["blob 입력", {
      ...fixed,
      input: { kind: "blob", sha256: await sha256Hex("큰 입력") },
    }],
    ["접수 schema 밖의 입력", {
      ...fixed,
      input: { kind: "inline", value: { app: CALLEE } },
    }],
    ["다른 concern", { ...fixed, concern: "apps/permissions" }],
  ];
  for (const [label, changed] of tampered) {
    const checked = checkConfirmAction(APPROVAL, appActor, changed);
    assert(!checked.ok, label);
    assertEquals(checked.error.code, "invalid_input", label);
  }
});

Deno.test("platform/approvals#R8: 요청자는 실제 호출 주체로 남고 사람의 허락은 별도 결정이다", async () => {
  const harness = await openHarness([app, user]);
  try {
    const fixed = confirmAction(appActor, await accept());
    value(await create(harness, app, APPROVAL, fixed));
    const read = value(
      await harness.read({ resource: "approvals", method: "get" }, user, {
        approval: APPROVAL,
      }),
    ) as { request: ApprovalRequest };
    assertEquals(read.request.requester, appActor);
    assertEquals(read.request.action.caller, appActor);
    assertEquals(read.request.status, "pending");

    // 요청한 앱은 자기 요청을 허락하지 못한다(R3).
    const input = await decisionInput(harness, APPROVAL);
    assertEquals(
      failure(
        await decide(
          harness,
          app,
          "grant",
          input,
          "grant-app",
          await issue(harness, "grant", input),
        ),
      ).code,
      "forbidden",
    );
    assertEquals(await statusOf(harness, APPROVAL), "pending");

    // 사람이 허락해도 요청자는 그대로이고, 결정은 사람의 event로 따로 남는다.
    value(
      await decide(
        harness,
        user,
        "grant",
        input,
        "grant-user",
        await issue(harness, "grant", input),
      ),
    );
    assertEquals(await statusOf(harness, APPROVAL), "granted");
    const rows = value(
      await harness.inspect(
        `select type, actor from events where subject = ? order by seq`,
        [APPROVAL],
      ),
    ).map((row) => [row["type"], row["actor"]]);
    assertEquals(rows, [
      ["ApprovalRequestCreated", appActor],
      ["ApprovalRequestGranted", "user"],
    ]);
    const after = value(
      await harness.read({ resource: "approvals", method: "get" }, user, {
        approval: APPROVAL,
      }),
    ) as { request: ApprovalRequest };
    assertEquals(after.request.requester, appActor);
  } finally {
    await harness.close();
  }
});

Deno.test("platform/approvals#R8: 규칙에 어긋난 confirm 요청은 request도 event도 만들지 않는다", async () => {
  const harness = await openHarness([app, user]);
  try {
    const good = confirmAction(appActor, await accept());
    // 사람이 요청자인 척 앱 호출을 올린다.
    const asUser = await create(harness, user, APPROVAL, good);
    assertEquals(failure(asUser).code, "invalid_input");
    // 지문을 바꾼다.
    const forged = await create(harness, app, APPROVAL, {
      ...good,
      input_hash: await sha256Hex("다른 입력"),
    });
    assertEquals(failure(forged).code, "invalid_input");
    // 다른 approval id의 입력을 이 id로 올린다.
    const reused = await create(
      harness,
      app,
      OTHER,
      confirmAction(appActor, await accept()),
    );
    assertEquals(failure(reused).code, "invalid_input");
    const rows = value(
      await harness.inspect("select count(*) as n from approval_requests", []),
    );
    assertEquals(rows[0]["n"], 0n);
    const events = value(
      await harness.inspect(
        "select count(*) as n from events where type = 'ApprovalRequestCreated'",
        [],
      ),
    );
    assertEquals(events[0]["n"], 0n);
  } finally {
    await harness.close();
  }
});

Deno.test("platform/approvals#R8: 같은 호출에는 approval 하나만 있고 다른 호출이나 거절 뒤에는 새로 만들 수 있다", async () => {
  const harness = await openHarness([app, user]);
  try {
    value(
      await create(
        harness,
        app,
        APPROVAL,
        confirmAction(appActor, await accept()),
      ),
    );
    // agent의 사전 질문과 앱의 confirm이 같은 호출을 따로 요청해도 두 번째는 첫 approval을 가리킨다.
    const duplicate = await create(
      harness,
      app,
      OTHER,
      confirmAction(appActor, await accept({}, OTHER)),
    );
    assertEquals(failure(duplicate).code, "conflict");
    const error = duplicate.ok ? undefined : duplicate.error;
    assertEquals(error?.details, { approval: APPROVAL });
    assertEquals(await statusOf(harness, OTHER), "undefined");

    // 다른 호출(다른 key, 다른 입력)은 별개다.
    value(
      await create(
        harness,
        app,
        THIRD,
        confirmAction(appActor, await accept({ key: "confirm-key-2" }, THIRD)),
      ),
    );

    // 첫 request를 사람이 거절하면 같은 호출을 다시 올릴 수 있다(거절 억제는 같은 계보의 R16이 맡는다).
    const input = await decisionInput(harness, APPROVAL, null);
    value(
      await decide(
        harness,
        user,
        "reject",
        input,
        "reject-1",
        await issue(harness, "reject", input),
      ),
    );
    value(
      await create(
        harness,
        app,
        OTHER,
        confirmAction(appActor, await accept({}, OTHER)),
      ),
    );
    assertEquals(await statusOf(harness, OTHER), "pending");
  } finally {
    await harness.close();
  }
});
