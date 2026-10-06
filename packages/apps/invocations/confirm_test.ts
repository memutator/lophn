// confirm 접수와 실행(apps/invocations#R7, R8, R9, R17, R18, R19)을 실제 core의 approval route와
// 실제 앱 runtime entrypoint로 본다. 사람이 허락한 approval이 접수에 한 번 쓰이고, 접수가 준 proof를
// 앱 direct 호출에 붙여야만 handler가 불린다. 사람 데이터 root는 열지 않고 core는 temp 홈에서 뜬다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { createCoreHarness } from "../../../apps/core/testing/core.ts";
import {
  actionOf,
  call,
  command,
  count,
  createInput,
  decide,
  inspect,
} from "../../../apps/core/testing/approvals-fixture.ts";
import { createLedgerRegistration } from "../../../apps/core/apps.ts";
import type { CoreHarness } from "../../../apps/core/testing/core.ts";
import { canonicalInputHash } from "../blueprint/mod.ts";
import type {
  ApprovalRequest,
  AuthenticatedContext,
} from "../../contracts/platform/mod.ts";
import {
  type CoreAccess,
  coreAccess,
  fixtureBlueprint,
} from "./testing/mod.ts";
import {
  APP,
  connection,
  installHandlers,
  NONCE,
  openRuntimeWorld,
  REL,
  type RuntimeWorld,
} from "./world_test.ts";
import {
  callerMatchesRequester,
  CONFIRM_PROOF_LIFETIME_MS,
} from "./confirm.ts";
import { createConfirmMarkers } from "../runtime/testing/mod.ts";
import {
  type CoreSigner,
  createCoreSigner,
  startDirectServer,
} from "../runtime/mod.ts";
import { observeInvocations } from "./restart.ts";

const PURGE = "usage.purge";
const AMOUNT = { amount: 12 };
const OTHER_RELEASE = "rel_01h455vb4pex5v6nkc6gd5fdw2";
const APR = (n: number) => `apr_01h455vb4pex5v6nkc6gd5fdw${n}`;

const handler = {
  calls: 0,
  // 열기 전까지 handler가 끝나지 않는다.
  hold: undefined as Promise<void> | undefined,
};

installHandlers([{
  command: PURGE,
  handle: async () => {
    handler.calls += 1;
    if (handler.hold) await handler.hold;
    return { purged: true };
  },
}]);

type Login = { token: string; context: AuthenticatedContext };

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

type World = {
  harness: CoreHarness;
  access: CoreAccess;
  runtime: RuntimeWorld;
  // core가 접수한 proof를 서명하는 실제 Ed25519 key(apps Q5).
  signer: CoreSigner;
  user: Login;
  machine: Login;
  // 다른 앱: 이 앱이 대상 앱의 confirm 명령을 부르는 실제 요청자다.
  caller: Login;
};

async function open(directSocket?: string): Promise<World> {
  handler.calls = 0;
  handler.hold = undefined;
  const opened = await createCoreHarness({
    io: true,
    teams: [{ createLedgerRegistration }],
    teamModules: [new URL("../../../apps/core/apps.ts", import.meta.url).href],
    nowMs: Date.parse("2026-10-04T00:00:00.000Z"),
  });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  const harness = opened.value;
  const access = await coreAccess(harness);
  const signer = await createCoreSigner();
  const reads = ["GetApproval", "ListApprovals", "invocations.get"];
  const creating = ["create_approval_request", "cancel_approval_request"];
  return {
    harness,
    access,
    signer,
    runtime: openRuntimeWorld({
      clock: harness.clock,
      send: access.send,
      signer,
      ...(directSocket ? { directSocket } : {}),
    }),
    user: await login(harness, "user", "user-1", [
      ...creating,
      "grant_approval_request",
      "reject_approval_request",
      "apply_approved_action",
      ...reads,
    ]),
    machine: await login(harness, "machine", "machine-1", [
      "apply_approved_action",
      "invocation.accept_confirm",
      ...reads,
    ]),
    caller: await login(harness, "app", "app-1", [...creating, ...reads]),
  };
}

async function inputHash(value: unknown): Promise<string> {
  const declared = fixtureBlueprint().commands.find((item) =>
    item.key === PURGE
  );
  const hashed = await canonicalInputHash(declared?.input ?? null, value);
  assert(hashed.ok, hashed.ok ? "" : hashed.error.message);
  return hashed.value;
}

type AcceptInput = {
  app: string;
  release: string;
  command: string;
  input_hash: string;
  approval: string;
  key: string;
  process_nonce: string;
  caller: Record<string, unknown>;
};

async function acceptInput(
  approval: string,
  caller: Record<string, unknown> = { kind: "direct" },
  over: Partial<AcceptInput> = {},
): Promise<AcceptInput> {
  return {
    app: APP,
    release: REL,
    command: PURGE,
    input_hash: await inputHash(AMOUNT),
    approval,
    key: `confirm-key-${approval}`,
    process_nonce: NONCE,
    caller,
    ...over,
  };
}

async function request(
  world: World,
  requester: Login,
  input: AcceptInput,
  approver: Login = world.user,
): Promise<ApprovalRequest> {
  const action = await actionOf({
    concern: "apps/invocations",
    command: "invocation.accept_confirm",
    caller: requester.context.actor,
    targets: [input.app, input.release],
    value: input as never,
    comparison: { release: input.release },
  });
  const created = await call(
    world.harness,
    "approvals/create",
    requester.token,
    command(createInput(input.approval, requester.context.actor, action)),
  );
  assertEquals(created.status, 200, JSON.stringify(created.body));
  const decided = await decide(
    world.harness,
    approver.token,
    created.body["request"] as ApprovalRequest,
    "grant",
  );
  assertEquals(decided.status, 200, JSON.stringify(decided.body));
  return decided.body["request"] as ApprovalRequest;
}

async function apply(world: World, granted: ApprovalRequest, key: string) {
  return await call(
    world.harness,
    "approvals/apply",
    world.machine.token,
    command({
      approval: granted.id,
      action: granted.action,
      idempotency_key: key,
    }),
  );
}

type Proof = {
  invocation: string;
  process_nonce: string;
  release: string;
  command: string;
  input_hash: string;
  caller: Record<string, unknown>;
  expires_at: string;
};

// 접수가 확정된 뒤 core가 가진 접수 사실로 proof payload를 다시 만든다. 직접 HTTP로 접수 command를
// 다시 보내는 경로는 없다(dispatch 전용). 수명은 접수 시각 기준이라 늘어나지 않는다(R7).
function proofOf(world: World, input: AcceptInput): Proof {
  const [row] = inspect(
    world.harness,
    `select i.id as id, e.at as at from invocations i
       join events e on e.subject = i.id and e.type = 'InvocationAccepted'
      where i.approval = ?`,
    [input.approval],
  );
  assert(row !== undefined, "접수가 없다");
  return {
    invocation: String(row["id"]),
    process_nonce: input.process_nonce,
    release: input.release,
    command: input.command,
    input_hash: input.input_hash,
    caller: input.caller,
    expires_at: new Date(
      Date.parse(String(row["at"])) + CONFIRM_PROOF_LIFETIME_MS,
    )
      .toISOString(),
  };
}

// proof는 core가 서명한 envelope로 앱에 간다. 바꾼 payload도 실제 key로 서명해 서명이 아니라
// 대상·입력·호출자 검사에서 거절되는지 따로 본다.
function signed(world: World, proof: Proof) {
  return world.signer.signConfirmProof(proof as never);
}

async function invoke(
  world: World,
  proof: Proof | undefined,
  key: string,
  over = {},
) {
  return await world.runtime.invoke({
    request_key: key,
    release: REL,
    command: PURGE,
    input: AMOUNT,
    ...(proof ? { proof: await signed(world, proof) } : {}),
  }, over);
}

const INVOCATIONS = "select count(*) as n from invocations";

Deno.test("apps/invocations#R7 #R9: 접수와 approval 사용이 함께 확정되기 전 handler는 불리지 않고 접수는 started_at 없이 접수됨으로만 보인다", async () => {
  const world = await open();
  try {
    const input = await acceptInput(APR(1));
    const granted = await request(world, world.user, input);
    // 허락만으로는 접수도 사용도 없고 proof도 없으니 handler를 부를 수 없다.
    assertEquals(count(world.harness, INVOCATIONS), 0);
    const bare = await invoke(world, undefined, "no-proof");
    assertEquals(bare.status, 403);
    assertEquals(handler.calls, 0);

    const applied = await apply(world, granted, "apply-1");
    assertEquals(applied.status, 200, JSON.stringify(applied.body));
    assertEquals(
      count(world.harness, "select count(*) as n from approval_uses"),
      1,
    );
    const [row] = inspect(
      world.harness,
      "select id, status, started_at, approval, actor from invocations where approval is not null",
    );
    assertEquals(row["status"], "accepted");
    assertEquals(row["started_at"], null);
    assertEquals(row["approval"], APR(1));
    assertEquals(row["actor"], "user");
    // handler 시작을 미룬 동안은 접수됨만 보인다. 시작 시각은 접수 시각으로 채워지지 않는다.
    assertEquals(handler.calls, 0);
    const seen = await world.access.invocation(String(row["id"]));
    assertEquals(seen?.["status"], "accepted");
    assertEquals(seen?.["started_at"], null);

    // 실제로 시작한 뒤에만 시작과 결과가 후행 기록으로 붙는다.
    const proof = proofOf(world, input);
    assertEquals(proof.invocation, row["id"]);
    const acceptedAt = world.harness.clock.now();
    world.harness.clock.advance(5000);
    const reply = await invoke(world, proof, "run-1");
    assertEquals(reply.status, 200, JSON.stringify(reply));
    assertEquals(handler.calls, 1);
    assertEquals(
      (reply.body as { invocation?: string }).invocation,
      proof.invocation,
    );
    await world.runtime.delivery.queue.pump();
    const done = await world.access.invocation(proof.invocation);
    assertEquals(done?.["status"], "succeeded");
    assertEquals(done?.["approval"], APR(1));
    assertEquals(done?.["actor"], "user");
    // 시작 시각은 실제로 시작을 관측한 때이고 접수 시각이 아니다.
    assertEquals(
      done?.["started_at"],
      new Date(Date.parse(acceptedAt) + 5000).toISOString(),
    );
    const events = inspect(
      world.harness,
      "select type from events where subject = ? order by seq",
      [proof.invocation],
    ).map((event) => event["type"]);
    assertEquals(events, [
      "InvocationAccepted",
      "InvocationStarted",
      "InvocationFinished",
    ]);
  } finally {
    await world.harness.close();
  }
});

Deno.test("apps/invocations#R7: 허락되지 않았거나 저장하지 못한 접수에서는 proof가 없고 handler가 실행되지 않는다", async () => {
  const world = await open();
  try {
    const input = await acceptInput(APR(2));
    // approval request가 없으면 적용은 접수 없이 거절된다.
    const missingApply = await call(
      world.harness,
      "approvals/apply",
      world.machine.token,
      command({
        approval: APR(2),
        action: await actionOf({
          concern: "apps/invocations",
          command: "invocation.accept_confirm",
          caller: "user",
          targets: [input.app, input.release],
          value: input as never,
          comparison: { release: input.release },
        }),
        idempotency_key: "missing",
      }),
    );
    assertEquals(missingApply.status, 404, JSON.stringify(missingApply.body));
    assertEquals(count(world.harness, INVOCATIONS), 0);
    // 만든 request가 허락 전(대기)이면 접수하지 않는다.
    const action = await actionOf({
      concern: "apps/invocations",
      command: "invocation.accept_confirm",
      caller: "user",
      targets: [input.app, input.release],
      value: input as never,
      comparison: { release: input.release },
    });
    const created = await call(
      world.harness,
      "approvals/create",
      world.user.token,
      command(createInput(APR(2), "user", action)),
    );
    assertEquals(created.status, 200, JSON.stringify(created.body));
    const pending = await call(
      world.harness,
      "approvals/apply",
      world.machine.token,
      command({
        approval: APR(2),
        action,
        idempotency_key: "pending",
      }),
    );
    assertEquals(pending.status >= 400, true, JSON.stringify(pending.body));
    assertEquals(count(world.harness, INVOCATIONS), 0);
    assertEquals(
      count(
        world.harness,
        "select count(*) as n from events where type = 'InvocationAccepted'",
      ),
      0,
    );
    // proof가 없으니 앱도 handler를 부르지 않는다.
    const reply = await invoke(world, undefined, "none");
    assertEquals(reply.status, 403);
    assertEquals(handler.calls, 0);
  } finally {
    await world.harness.close();
  }
});

Deno.test("apps/invocations#R7: 같은 approval을 다시 적용하면 처음 접수의 receipt만 돌려주고 proof 수명은 접수 시각 기준이라 늘어나지 않는다", async () => {
  const world = await open();
  try {
    const input = await acceptInput(APR(3));
    const granted = await request(world, world.user, input);
    assertEquals((await apply(world, granted, "a")).status, 200);
    const first = proofOf(world, input);
    world.harness.clock.advance(30_000);
    const second = proofOf(world, input);
    assertEquals(second, first);
    assertEquals(
      Date.parse(first.expires_at) - Date.parse(world.harness.clock.now()),
      CONFIRM_PROOF_LIFETIME_MS - 30_000,
    );
    assertEquals(count(world.harness, INVOCATIONS), 1);
    assertEquals(
      count(
        world.harness,
        "select count(*) as n from events where type = 'InvocationAccepted'",
      ),
      1,
    );
    // 같은 approval의 재적용은 처음 접수의 receipt만 돌려주고 새 접수를 만들지 않는다.
    const again = await apply(world, granted, "b");
    assertEquals(again.status, 200, JSON.stringify(again.body));
    assertEquals(
      (again.body as { replayed?: boolean }).replayed,
      true,
      JSON.stringify(again.body),
    );
    assertEquals(count(world.harness, INVOCATIONS), 1);
  } finally {
    await world.harness.close();
  }
});

Deno.test("apps/invocations#R8: 같은 proof를 동시에 보내도 handler는 한 번만 돌고 끝난 뒤 재전송은 같은 결과만 돌려준다", async () => {
  const world = await open();
  try {
    const input = await acceptInput(APR(4));
    const granted = await request(world, world.user, input);
    assertEquals((await apply(world, granted, "a")).status, 200);
    const proof = proofOf(world, input);
    let release: () => void = () => {};
    handler.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sends = [
      invoke(world, proof, "same"),
      invoke(world, proof, "same"),
      invoke(world, proof, "other-key"),
      invoke(world, proof, "other-key-2"),
    ];
    // 모두 handler 앞에서 marker를 보고 결정한다. 진행 중에는 성공으로 답하지 않는다.
    // 첫 호출이 handler에서 멈춰 있는 동안 나머지가 모두 marker를 본다.
    for (let attempt = 0; attempt < 200 && handler.calls === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    const replies = await Promise.all(sends);
    assertEquals(handler.calls, 1);
    assertEquals(replies.filter((reply) => reply.status === 200).length, 1);
    for (const reply of replies.filter((item) => item.status !== 200)) {
      assertEquals(reply.status, 409);
    }
    const again = await invoke(world, proof, "later");
    assertEquals(again.status, 200);
    assertEquals(handler.calls, 1);
    assertEquals(
      (again.body as { invocation?: string }).invocation,
      proof.invocation,
    );
  } finally {
    await world.harness.close();
  }
});

Deno.test("apps/invocations#R8: 옛 프로세스의 proof와 release·command·입력·호출자가 다른 proof는 거절되고 원래 proof는 그대로 한 번 쓸 수 있다", async () => {
  const world = await open();
  try {
    const input = await acceptInput(APR(5));
    const granted = await request(world, world.user, input);
    assertEquals((await apply(world, granted, "a")).status, 200);
    const proof = proofOf(world, input);
    const cases: [string, Proof, number][] = [
      ["옛 프로세스", { ...proof, process_nonce: "old-process" }, 409],
      ["다른 release", { ...proof, release: OTHER_RELEASE }, 409],
      ["다른 command", { ...proof, command: "usage.save" }, 409],
      [
        "다른 입력 지문",
        { ...proof, input_hash: await inputHash({ amount: 13 }) },
        409,
      ],
      ["다른 호출자", { ...proof, caller: { kind: "system" } }, 403],
    ];
    for (const [label, changed, status] of cases) {
      const reply = await invoke(world, changed, `bad-${label}`);
      assertEquals(reply.status, status, `${label}: ${JSON.stringify(reply)}`);
    }
    // 접수한 입력과 다른 입력을 같은 proof로 보내도 거절된다.
    const swapped = await world.runtime.invoke({
      request_key: "swap",
      release: REL,
      command: PURGE,
      input: { amount: 13 },
      proof: await signed(world, proof),
    });
    assertEquals(swapped.status, 409);
    assertEquals(handler.calls, 0);
    // 만료된 proof는 쓸 수 없다.
    world.harness.clock.advance(CONFIRM_PROOF_LIFETIME_MS + 1);
    const late = await invoke(world, proof, "late");
    assertEquals(late.status, 401);
    assertEquals(handler.calls, 0);
  } finally {
    await world.harness.close();
  }
});

Deno.test("apps/invocations#R8: 접수 뒤 같은 proof를 새 프로세스에 보내도 거절된다", async () => {
  const world = await open();
  try {
    const input = await acceptInput(APR(6));
    const granted = await request(world, world.user, input);
    assertEquals((await apply(world, granted, "a")).status, 200);
    const proof = proofOf(world, input);
    // 새 프로세스는 새 nonce를 쓴다. 옛 nonce에 묶인 proof는 실행하지 않는다.
    world.runtime.state.identity.processNonce = "nonce-after-restart";
    const reply = await invoke(world, proof, "after-restart");
    assertEquals(reply.status, 409);
    assertEquals(handler.calls, 0);
  } finally {
    await world.harness.close();
  }
});

Deno.test("apps/invocations#R19: marker가 가득 차면 유효한 기존 marker를 버리지 않고 새 접수를 거절하며 만료된 marker만 자리를 내준다", () => {
  const markers = createConfirmMarkers();
  const now = "2026-10-04T00:00:00.000Z";
  const later = "2026-10-04T00:02:00.000Z";
  for (let index = 0; index < 4096; index += 1) {
    assertEquals(markers.admit(`inv_${index}`, later, now), "new");
  }
  assertEquals(markers.size(), 4096);
  assertEquals(markers.admit("inv_new", later, now), "full");
  // 기존 marker는 그대로 알려진 접수다.
  assertEquals(markers.admit("inv_0", later, now), "known");
  assertEquals(markers.size(), 4096);
  // proof가 만료된 뒤에야 자리가 난다.
  assertEquals(
    markers.admit("inv_new", "2026-10-04T00:04:00.000Z", later),
    "new",
  );
  assertEquals(markers.size(), 1);
});

Deno.test("apps/invocations#R19 #R8: 앱 runtime은 marker가 가득 차면 새 confirm 접수를 거절하고 이미 접수한 proof는 그대로 알려진 접수다", async () => {
  const world = await open();
  try {
    world.runtime.state.markers = createConfirmMarkers(1);
    const first = await acceptInput(APR(7));
    const second = await acceptInput(APR(8), { kind: "direct" }, {
      key: "second",
    });
    const proofs: Proof[] = [];
    for (const [index, input] of [first, second].entries()) {
      const granted = await request(world, world.user, input);
      assertEquals((await apply(world, granted, `a${index}`)).status, 200);
      proofs.push(proofOf(world, input));
    }
    assertEquals((await invoke(world, proofs[0], "one")).status, 200);
    const full = await invoke(world, proofs[1], "two");
    assertEquals(full.status, 409);
    assertEquals(handler.calls, 1);
    // 가득 차 새 접수를 거절해도 앞의 proof는 버리지 않아 다시 실행되지 않는다.
    assertEquals((await invoke(world, proofs[0], "one-again")).status, 200);
    assertEquals(handler.calls, 1);
  } finally {
    await world.harness.close();
  }
});

Deno.test("apps/invocations#R17 #R18: 다른 앱이 요청한 confirm은 사람이 허락해도 actor·caller는 요청자고 approval은 별도 참조이며 같은 proof는 그 호출자로만 실행된다", async () => {
  const world = await open();
  try {
    const requester = world.caller.context.actor;
    const callerApp = requester.slice("app:".length);
    const appCaller = {
      kind: "app",
      app: callerApp,
      release: "rel_01h455vb4pex5v6nkc6gd5fdw8",
      parent_invocation: null,
    };
    const input = await acceptInput(APR(9), appCaller);
    const granted = await request(world, world.caller, input);
    assertEquals(granted.requester, requester);
    // 접수 전에는 접수도 handler도 없다(R18: 접수 저장이 없으면 실행하지 않는다).
    assertEquals(count(world.harness, INVOCATIONS), 0);
    assertEquals(handler.calls, 0);
    assertEquals((await apply(world, granted, "a")).status, 200);
    const proof = proofOf(world, input);
    const row = await world.access.invocation(proof.invocation);
    assertEquals(row?.["actor"], requester);
    assertEquals(row?.["caller"], appCaller);
    assertEquals(row?.["approval"], APR(9));
    assertEquals(
      inspect(
        world.harness,
        "select actor from events where subject = ? and type = 'ApprovalRequestGranted'",
        [APR(9)],
      ).map((event) => event["actor"]),
      ["user"],
    );
    const origin = {
      ...appCaller,
      process_nonce: "caller-nonce",
      grant: "grt_01h455vb4pex5v6nkc6gd5fdw8",
      path: [callerApp],
    };
    // 사람이 직접 부른 호출자로 같은 proof를 쓰려 해도 caller가 달라 거절된다.
    const direct = await invoke(world, proof, "as-user");
    assertEquals(direct.status, 403);
    assertEquals(handler.calls, 0);
    // 요청한 앱의 연결로만 한 번 실행되고 기록의 actor는 사람이 아니라 요청자다.
    const reply = await invoke(world, proof, "by-app", {
      actor: requester,
      caller: origin,
    });
    assertEquals(reply.status, 200, JSON.stringify(reply));
    assertEquals(handler.calls, 1);
    await world.runtime.delivery.queue.pump();
    const done = await world.access.invocation(proof.invocation);
    assertEquals(done?.["status"], "succeeded");
    assertEquals(done?.["actor"], requester);
    assertEquals(done?.["caller"], appCaller);
  } finally {
    await world.harness.close();
  }
});

Deno.test("apps/invocations#R17: agent 요청자는 접수 입력의 caller(run·tool_call)가 아니라 approval의 requester가 actor가 되고 요청자와 다른 종류의 caller는 거절한다", () => {
  const agent = "agent:asg_01h455vb4pex5v6nkc6gd5fdw8";
  const caller = {
    kind: "agent" as const,
    run: "run_01h455vb4pex5v6nkc6gd5fdw8",
    tool_call: "tcl_01h455vb4pex5v6nkc6gd5fdw8",
  };
  assert(callerMatchesRequester(caller, agent));
  assert(!callerMatchesRequester(caller, "user"));
  assert(!callerMatchesRequester({ kind: "direct" }, agent));
  assert(
    !callerMatchesRequester(
      {
        kind: "app",
        app: "app_01h455vb4pex5v6nkc6gd5fdw1",
        release: REL,
        parent_invocation: null,
      },
      agent,
    ),
  );
  assert(!callerMatchesRequester({ kind: "system" }, "machine"));
});

Deno.test("apps/invocations#R9 #R10: 재시작 점검은 접수만 있거나 결과를 못 본 호출을 시작·종료했다고 추정하지 않고 unknown과 근거로 남긴다", async () => {
  const world = await open();
  try {
    // 접수만 확정되고 handler는 시작하지 않은 호출.
    const input = await acceptInput(APR(1));
    const granted = await request(world, world.user, input);
    assertEquals((await apply(world, granted, "a")).status, 200);
    const proof = proofOf(world, input);
    // 시작은 core에 닿았지만 끝나지 않은 confirm 호출.
    handler.hold = new Promise(() => {});
    const next = await acceptInput(APR(2), { kind: "direct" }, { key: "k2" });
    const second = await request(world, world.user, next);
    assertEquals((await apply(world, second, "b")).status, 200);
    const nextProof = proofOf(world, next);
    void world.runtime.invoke({
      request_key: "running",
      release: REL,
      command: PURGE,
      input: AMOUNT,
      proof: await signed(world, nextProof),
    });
    for (let attempt = 0; attempt < 200; attempt += 1) {
      await world.runtime.delivery.queue.pump();
      const rows = await world.access.invocations();
      if (rows.some((row) => row["status"] === "running")) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const ledger = new DatabaseSync(`${world.harness.dataRoot}/lophn.db`, {
      readOnly: true,
    });
    try {
      const observed = observeInvocations(
        {
          all: (query, params) =>
            ledger.prepare(query).all(...(params as never[])) as Record<
              string,
              unknown
            >[],
        },
        world.harness.clock.now(),
      );
      const byId = new Map(observed.map((item) => [item.target, item]));
      const accepted = byId.get(proof.invocation);
      assertEquals(accepted?.outcome, "unknown");
      assertEquals(accepted?.reason, "start_not_observed");
      assertEquals(
        accepted?.evidence[0],
        `invocations:${proof.invocation}:accepted`,
      );
      const running = observed.filter((item) =>
        item.reason === "result_not_observed"
      );
      assertEquals(running.length, 1);
      assertEquals(running[0].outcome, "unknown");
      // 끝난 호출은 점검 대상이 아니다.
      assert(observed.every((item) => item.outcome === "unknown"));
    } finally {
      ledger.close();
    }
    // 점검은 읽기만 한다. 같은 접수로 handler를 다시 부르지 않는다.
    assertEquals(handler.calls, 1);
  } finally {
    await world.harness.close();
  }
});

// 앱의 direct socket을 실제로 열고 core가 서명한 연결과 proof로 부른다.
async function socketPost(
  socket: string,
  authorization: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const client = Deno.createHttpClient({
    proxy: { transport: "unix", path: socket },
  });
  try {
    const response = await fetch(
      "http://lophn.invalid/_lophn/commands/invoke",
      {
        method: "POST",
        headers: { authorization, "content-type": "application/json" },
        body: JSON.stringify(body),
        client,
      },
    );
    return {
      status: response.status,
      body: await response.json() as Record<string, unknown>,
    };
  } finally {
    client.close();
  }
}

Deno.test("apps/invocations#R8 #R7: direct socket에서 위조·변조·다른 호출에 쓴·만료된 proof는 거절되고 core가 서명한 proof만 한 번 실행된다", async () => {
  const dir = await Deno.makeTempDir();
  const socket = `${dir}/a.sock`;
  const world = await open(socket);
  const server = startDirectServer(world.runtime.state);
  try {
    const input = await acceptInput(APR(1));
    const granted = await request(world, world.user, input);
    assertEquals((await apply(world, granted, "a")).status, 200);
    const proof = proofOf(world, input);
    const authorization = JSON.stringify(
      await world.signer.signConnection(
        connection({
          commands: ["usage.purge"],
          // 연결은 proof보다 오래 살아 있어, 거절 이유가 proof 만료임을 본다.
          expires_at: "2026-10-04T01:00:00.000Z",
        }) as never,
      ),
    );
    const call = (
      confirm: unknown,
      key: string,
      over: Record<string, unknown> = {},
    ) =>
      socketPost(socket, authorization, {
        request_key: key,
        release: REL,
        command: PURGE,
        input: AMOUNT,
        proof: confirm,
        ...over,
      });
    const attacker = await createCoreSigner();
    const genuine = await world.signer.signConfirmProof(proof as never);

    // 서명 없는 payload, 다른 key의 서명, 서명한 뒤 바꾼 payload는 handler 전에 거절된다.
    assertEquals((await call(proof, "unsigned")).status, 400);
    const forged = await attacker.signConfirmProof(proof as never);
    assertEquals((await call(forged, "forged")).status, 401);
    const tampered = {
      payload: { ...genuine.payload, expires_at: "2099-01-01T00:00:00.000Z" },
      signature: genuine.signature,
    };
    assertEquals((await call(tampered, "tampered")).status, 401);
    const notMine = { ...genuine, signature: "A".repeat(86) };
    assertEquals((await call(notMine, "garbage")).status, 401);
    // 접수한 입력과 다른 호출에 같은 서명 proof를 옮겨 쓰면 거절된다.
    const moved = await call(genuine, "moved", { input: { amount: 13 } });
    assertEquals(moved.status, 409);
    assertEquals(handler.calls, 0);

    // core가 서명한 proof는 한 번만 실행되고 다시 보내도 같은 결과일 뿐이다.
    const accepted = await call(genuine, "genuine");
    assertEquals(accepted.status, 200, JSON.stringify(accepted.body));
    assertEquals(handler.calls, 1);
    assertEquals((await call(genuine, "genuine-again")).status, 200);
    assertEquals(handler.calls, 1);

    // 만료된 proof는 서명이 맞아도 거절된다.
    world.harness.clock.advance(CONFIRM_PROOF_LIFETIME_MS + 1);
    const late = await call(genuine, "late");
    assertEquals(late.status, 401);
    assertEquals(handler.calls, 1);
  } finally {
    await server.shutdown();
    await world.harness.close();
    await Deno.remove(dir, { recursive: true });
  }
});
