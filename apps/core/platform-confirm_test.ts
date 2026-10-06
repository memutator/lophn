// 사람이 확인해야 하는 앱 command의 approval 사용(platform#T32, flow use-app-command 4~5단계)을
// 실제 core와 임시 LOPHN_HOME의 HTTP route로 본다. 접수 command는
// apps의 실제 dispatchable `invocation.accept_confirm`(packages/apps/invocations/confirm.ts)이고
// apps의 실제 invocations 표와 event를 쓴다. 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { sha256Hex } from "../../packages/base/mod.ts";
import type { InvocationAcceptConfirmInput } from "../../packages/contracts/apps/mod.ts";
import type {
  ApprovalAction,
  ApprovalRequest,
  AuthenticatedContext,
} from "../../packages/contracts/platform/mod.ts";
import { confirmAction } from "../../packages/platform/approvals/mod.ts";
import { createLedgerRegistration as createAppsRegistration } from "./apps.ts";
import {
  call,
  codeOf,
  command,
  count,
  createInput,
  decide,
  inspect,
  type Reply,
} from "./testing/approvals-fixture.ts";
import { type CoreHarness, createCoreHarness } from "./testing/core.ts";

const CALLEE = "app_01h455vb4pex5v6nkc6gd5fdw2";
const RELEASE = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const NEXT_RELEASE = "rel_01h455vb4pex5v6nkc6gd5fdw2";
const APR_ONE = "apr_01h455vb4pex5v6nkc6gd5fdw1";
const APR_TWO = "apr_01h455vb4pex5v6nkc6gd5fdw2";
const APR_THREE = "apr_01h455vb4pex5v6nkc6gd5fdw3";

const INVOCATIONS = "select count(*) as n from invocations";
const USES = "select count(*) as n from approval_uses";
const ACCEPTED =
  "select count(*) as n from events where type = 'InvocationAccepted'";

type Login = { token: string; context: AuthenticatedContext };

type World = {
  harness: CoreHarness;
  // 다른 앱: 이 앱이 CALLEE의 command를 부르는 호출의 실제 요청자다.
  caller: Login;
  user: Login;
  machine: Login;
};

async function login(
  harness: CoreHarness,
  actor: "user" | "machine" | "app",
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
    teams: [{ createLedgerRegistration: createAppsRegistration }],
    teamModules: [new URL("./apps.ts", import.meta.url).href],
  });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  const harness = opened.value;
  const reads = ["GetApproval", "ListApprovals", "invocations.get"];
  const apply = "apply_approved_action";
  return {
    harness,
    caller: await login(harness, "app", "app-1", [
      "create_approval_request",
      "cancel_approval_request",
      apply,
      ...reads,
    ]),
    user: await login(harness, "user", "user-1", [
      "create_approval_request",
      "grant_approval_request",
      "reject_approval_request",
      apply,
      ...reads,
    ]),
    machine: await login(harness, "machine", "machine-1", [
      apply,
      "invocation.accept_confirm",
      ...reads,
    ]),
  };
}

async function accept(
  world: World,
  approval: string,
  overrides: Partial<InvocationAcceptConfirmInput> = {},
): Promise<InvocationAcceptConfirmInput> {
  const requester = world.caller.context.actor.slice("app:".length);
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
      app: requester,
      release: RELEASE,
      parent_invocation: null,
    },
    ...overrides,
  };
}

function request(
  world: World,
  login: Login,
  id: string,
  action: ApprovalAction,
  expiresAt: string | null = null,
): Promise<Reply> {
  const input = createInput(id, login.context.actor, action, { expiresAt });
  return call(world.harness, "approvals/create", login.token, command(input));
}

async function granted(
  world: World,
  login: Login,
  id: string,
  action: ApprovalAction,
  expiresAt: string | null = null,
): Promise<ApprovalRequest> {
  const created = await request(world, login, id, action, expiresAt);
  assertEquals(created.status, 200, JSON.stringify(created.body));
  const decided = await decide(
    world.harness,
    world.user.token,
    created.body["request"] as ApprovalRequest,
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
  key: string,
): Promise<Reply> {
  return call(
    world.harness,
    "approvals/apply",
    login.token,
    command({ approval, action, idempotency_key: key }),
  );
}

Deno.test("platform/approvals#R8 #R7: 다른 앱의 confirm 호출은 사람이 허락해도 요청자가 유지되고 접수와 approval 사용이 한 transaction에서 한 번만 일어난다", async () => {
  const world = await open();
  const { harness } = world;
  try {
    const action = confirmAction(
      world.caller.context.actor,
      await accept(world, APR_ONE),
    );
    const decided = await granted(world, world.caller, APR_ONE, action);
    assertEquals(decided.requester, world.caller.context.actor);
    assertEquals(decided.status, "granted");
    // 허락만으로는 접수도 사용도 없다.
    assertEquals(count(harness, INVOCATIONS), 0);
    assertEquals(count(harness, USES), 0);

    const applied = await apply(world, world.machine, APR_ONE, action, "a-1");
    assertEquals(applied.status, 200, JSON.stringify(applied.body));
    assertEquals(applied.body["replayed"], false);
    const use = applied.body["use"] as {
      concern: string;
      receipt: { kind: string; seq: string };
      accepted_seq: string;
    };
    assertEquals(use.concern, "apps/invocations");
    assertEquals(use.receipt.kind, "event");
    // 접수 event가 사용 기록의 근거이고 같은 transaction의 invocation 행이 approval을 가리킨다.
    assertEquals(
      count(
        harness,
        "select count(*) as n from events where seq = ? and type = 'InvocationAccepted'",
        [Number(use.accepted_seq)],
      ),
      1,
    );
    const rows = inspect(
      harness,
      "select id, actor, approval, status, started_at from invocations",
    );
    assertEquals(rows.length, 1);
    assertEquals(rows[0]["approval"], APR_ONE);
    assertEquals(rows[0]["status"], "accepted");
    assertEquals(rows[0]["started_at"], null);
    // Invocation의 actor는 원래 요청자이고 사람이 아니다. 사람의 결정은 approval의 event에 따로 있다.
    assertEquals(rows[0]["actor"], world.caller.context.actor);
    const read = await call(
      harness,
      "invocations/get",
      world.user.token,
      { invocation: rows[0]["id"] },
    );
    assertEquals(read.status, 200, JSON.stringify(read.body));
    const invocation = read.body["invocation"] as {
      actor: string;
      approval: string;
      caller: { kind: string };
    };
    assertEquals(invocation.actor, world.caller.context.actor);
    assertEquals(invocation.approval, APR_ONE);
    assertEquals(invocation.caller.kind, "app");
    assertEquals(
      inspect(
        harness,
        "select actor from events where subject = ? and type = 'ApprovalRequestGranted'",
        [APR_ONE],
      ).map((row) => row["actor"]),
      ["user"],
    );

    // 동일 요청 재전송은 같은 접수를 돌려주고 새 접수·새 사용이 없다.
    const again = await apply(world, world.machine, APR_ONE, action, "a-2");
    assertEquals(again.status, 200, JSON.stringify(again.body));
    assertEquals(again.body["replayed"], true);
    assertEquals(again.body["use"], applied.body["use"]);
    assertEquals(count(harness, INVOCATIONS), 1);
    assertEquals(count(harness, ACCEPTED), 1);
    assertEquals(count(harness, USES), 1);
  } finally {
    await harness.close();
  }
});

Deno.test("platform/approvals#R7 #R9: 허락 뒤 apply 전에 접수 command를 직접 부르면 없는 command와 같게 거절되고 아무것도 남지 않으며 apply가 한 번만 사용을 기록한다", async () => {
  const world = await open();
  const { harness } = world;
  try {
    const exact = await accept(world, APR_ONE);
    const action = confirmAction(world.caller.context.actor, exact);
    await granted(world, world.caller, APR_ONE, action);

    // machine 자격으로 직접 부르면 허락된 approval이어도 접수·proof가 나오지 않는다.
    const direct = await call(
      harness,
      "invocations/accept_confirm",
      world.machine.token,
      command(exact),
    );
    assertEquals(direct.status, 400, JSON.stringify(direct.body));
    assertEquals(codeOf(direct), "invalid_input");
    assertEquals(
      (direct.body["error"] as { message: string }).message,
      "등록되지 않은 command다",
    );
    assertEquals(direct.body["proof"], undefined);
    assertEquals(count(harness, INVOCATIONS), 0);
    assertEquals(count(harness, ACCEPTED), 0);
    assertEquals(count(harness, USES), 0);

    // 직접 시도가 approval을 소모하지 않았으므로 apply는 200이고 사용은 정확히 한 번이다.
    const applied = await apply(world, world.machine, APR_ONE, action, "a-1");
    assertEquals(applied.status, 200, JSON.stringify(applied.body));
    assertEquals(applied.body["replayed"], false);
    assertEquals(count(harness, INVOCATIONS), 1);
    assertEquals(count(harness, ACCEPTED), 1);
    assertEquals(count(harness, USES), 1);

    // apply 뒤의 직접 호출도 같은 답이고 새 접수도 proof도 없다.
    const after = await call(
      harness,
      "invocations/accept_confirm",
      world.machine.token,
      command(exact),
    );
    assertEquals(after.status, 400, JSON.stringify(after.body));
    assertEquals(codeOf(after), "invalid_input");
    assertEquals(after.body["proof"], undefined);
    assertEquals(count(harness, INVOCATIONS), 1);
    assertEquals(count(harness, USES), 1);
  } finally {
    await harness.close();
  }
});

Deno.test("platform/approvals#R8 #R5 #R11: 허락 뒤 release·command·입력·호출 주체를 바꾸면 시작되지 않고 허락은 소비되지 않는다", async () => {
  const world = await open();
  const { harness } = world;
  try {
    const exact = await accept(world, APR_ONE);
    const action = confirmAction(world.caller.context.actor, exact);
    await granted(world, world.caller, APR_ONE, action);

    const changes: [string, InvocationAcceptConfirmInput][] = [
      ["다른 release", { ...exact, release: NEXT_RELEASE }],
      ["다른 command", { ...exact, command: "delete_invoice" }],
      [
        "다른 입력 지문",
        { ...exact, input_hash: await sha256Hex('{"amount":99,"to":"kim"}') },
      ],
      ["다른 process", { ...exact, process_nonce: "nonce-2" }],
      ["다른 key", { ...exact, key: "confirm-key-2" }],
      ["다른 caller", { ...exact, caller: { kind: "direct" } }],
      ["다른 앱", { ...exact, app: "app_01h455vb4pex5v6nkc6gd5fdw9" }],
    ];
    for (const [label, changed] of changes) {
      const other = confirmAction(world.caller.context.actor, changed);
      const refused = await apply(world, world.machine, APR_ONE, other, label);
      assertEquals(refused.status, 409, `${label}: ${JSON.stringify(refused)}`);
      assertEquals(codeOf(refused), "conflict", label);
    }
    // 어느 거절도 접수나 사용 기록을 남기지 않는다.
    assertEquals(count(harness, INVOCATIONS), 0);
    assertEquals(count(harness, ACCEPTED), 0);
    assertEquals(count(harness, USES), 0);

    // 정확한 action은 그대로 한 번 시작된다.
    const applied = await apply(world, world.machine, APR_ONE, action, "ok");
    assertEquals(applied.status, 200, JSON.stringify(applied.body));
    assertEquals(count(harness, INVOCATIONS), 1);
  } finally {
    await harness.close();
  }
});

Deno.test("platform/approvals#R8 #R7: agent의 사전 질문과 앱의 confirm이 같은 호출을 겹쳐 올려도 approval 하나가 한 번만 소비된다", async () => {
  const world = await open();
  const { harness } = world;
  try {
    const action = confirmAction(
      world.caller.context.actor,
      await accept(world, APR_ONE),
    );
    await granted(world, world.caller, APR_ONE, action);

    // 같은 호출을 다른 approval id로 다시 올리면 첫 approval을 가리키며 거절한다.
    const second = await request(
      world,
      world.caller,
      APR_TWO,
      confirmAction(
        world.caller.context.actor,
        await accept(world, APR_TWO),
      ),
    );
    assertEquals(second.status, 409, JSON.stringify(second.body));
    assertEquals(
      (second.body["error"] as { details?: unknown }).details,
      { approval: APR_ONE },
    );
    assertEquals(
      count(harness, "select count(*) as n from approval_requests"),
      1,
    );

    // 두 경로(agent 질문 쪽 machine과 앱 접수 쪽 machine)가 같은 approval을 동시에 써도 접수는 한 번이다.
    const other = await login(harness, "machine", "machine-2", [
      "apply_approved_action",
      "invocation.accept_confirm",
    ]);
    const [viaAsk, viaConfirm] = await Promise.all([
      apply(world, world.machine, APR_ONE, action, "ask-path"),
      apply(world, other, APR_ONE, action, "confirm-path"),
    ]);
    assertEquals(viaAsk.status, 200, JSON.stringify(viaAsk.body));
    assertEquals(viaConfirm.status, 200, JSON.stringify(viaConfirm.body));
    assertEquals(viaAsk.body["use"], viaConfirm.body["use"]);
    assertEquals(
      [viaAsk.body["replayed"], viaConfirm.body["replayed"]].sort(),
      [false, true],
    );
    // 접수가 끝난 뒤의 재호출은 접수 command를 다시 부르지 않고 같은 use를 돌려받는다.
    const late = await apply(world, world.caller, APR_ONE, action, "late");
    assertEquals(late.status, 200, JSON.stringify(late.body));
    assertEquals(late.body["replayed"], true);
    assertEquals(count(harness, INVOCATIONS), 1);
    assertEquals(count(harness, ACCEPTED), 1);
    assertEquals(count(harness, USES), 1);
  } finally {
    await harness.close();
  }
});

Deno.test("platform/approvals#R8: 사람이 직접 부른 confirm 호출도 정확한 입력에 묶이고 요청자는 user, 결정은 별도 허락이다", async () => {
  const world = await open();
  const { harness } = world;
  try {
    const direct = await accept(world, APR_ONE, { caller: { kind: "direct" } });
    // 다른 앱이 사람 직접 호출인 척 올리지 못한다.
    const impostor = await request(
      world,
      world.caller,
      APR_ONE,
      confirmAction(world.caller.context.actor, direct),
    );
    assertEquals(impostor.status, 400, JSON.stringify(impostor.body));
    assertEquals(codeOf(impostor), "invalid_input");
    assertEquals(
      count(harness, "select count(*) as n from approval_requests"),
      0,
    );

    const action = confirmAction("user", direct);
    const decided = await granted(world, world.user, APR_ONE, action);
    assertEquals(decided.requester, "user");
    // 접수 command는 machine만 부르므로 고정 호출자(user)가 직접 적용해도 접수되지 않는다.
    const byUser = await apply(world, world.user, APR_ONE, action, "by-user");
    assertEquals(byUser.status, 403, JSON.stringify(byUser.body));
    assertEquals(count(harness, INVOCATIONS), 0);
    assertEquals(count(harness, USES), 0);
    const applied = await apply(
      world,
      world.machine,
      APR_ONE,
      action,
      "direct",
    );
    assertEquals(applied.status, 200, JSON.stringify(applied.body));
    assertEquals(
      inspect(harness, "select actor from invocations").map((row) =>
        row["actor"]
      ),
      ["user"],
    );
    // 앱은 사람의 허락을 대신 적용하지 못한다: 없는 request와 같은 답이다.
    const refused = await apply(
      world,
      world.caller,
      APR_ONE,
      action,
      "intruder",
    );
    assertEquals(refused.status, 404, JSON.stringify(refused.body));
    assertEquals(count(harness, INVOCATIONS), 1);
  } finally {
    await harness.close();
  }
});

Deno.test("platform/approvals#R8 #R12: 기한이 지난 confirm request는 만료로 확정되고 접수로 이어지지 않는다", async () => {
  const world = await open();
  const { harness } = world;
  try {
    const action = confirmAction(
      world.caller.context.actor,
      await accept(world, APR_THREE),
    );
    const expiresAt = new Date(harness.clock.nowMs() + 60_000).toISOString();
    const created = await request(
      world,
      world.caller,
      APR_THREE,
      action,
      expiresAt,
    );
    assertEquals(created.status, 200, JSON.stringify(created.body));
    harness.clock.advance(60_000);
    await harness.sweepApprovalExpiry();
    const read = await call(harness, "approvals/get", world.user.token, {
      approval: APR_THREE,
    });
    assertEquals(
      (read.body["request"] as { status: string }).status,
      "expired",
    );
    const late = await apply(world, world.machine, APR_THREE, action, "late");
    assert(late.status >= 400, JSON.stringify(late.body));
    assertEquals(count(harness, INVOCATIONS), 0);
    assertEquals(count(harness, USES), 0);
  } finally {
    await harness.close();
  }
});
