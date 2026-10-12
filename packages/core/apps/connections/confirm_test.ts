// A→B confirm=true 호출(apps/connections#R3)을 실제 core의 approval route, 실제 core 서명 key,
// 실제 앱 자식 프로세스로 본다. 연결 허락은 사람 확인을 대신하지 않는다. 사람이 허락한 approval이
// 적용돼 접수가 확정된 뒤에만 proof가 서명돼 호출한 앱에 가고, B가 그 proof로 handler를 한 번 부른다.
// core는 temp 홈에서 뜨고 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import {
  createIdSource,
  cryptoRandom,
  err,
  ok,
  systemClock,
} from "../../../base/mod.ts";
import { createLedgerRegistration } from "../../../../apps/core/apps.ts";
import {
  type CoreHarness,
  createCoreHarness,
} from "../../../../apps/core/testing/core.ts";
import {
  actionOf,
  call,
  command,
  count,
  createInput,
  decide,
  inspect,
} from "../../../../apps/core/testing/approvals-fixture.ts";
import type {
  ApprovalRequest,
  AuthenticatedContext,
} from "../../../protocol/server/mod.ts";
import { canonicalInputHash, validateBlueprint } from "../blueprint/mod.ts";
import { coreAccess } from "../invocations/testing/mod.ts";
import {
  type ConfirmAcceptances,
  createConfirmProofIssuer,
} from "./confirm.ts";
import {
  type ConfirmApprovals,
  type ConfirmTargets,
  createPairConfirmer,
} from "./confirm-request.ts";
import {
  CONFIRM_POLL,
  CONFIRM_REQUEST,
  connectPair,
  invokePair,
  openPairWorld,
  type PairWorld,
  type Peer,
} from "./world_test.ts";

const PURGE = "usage.purge";
const AMOUNT = { amount: 12 };
const APPROVAL = "apr_01h455vb4pex5v6nkc6gd5fd51";

const PURGE_INPUT = {
  type: "object",
  properties: { amount: { type: "integer", minimum: 1 } },
  required: ["amount"],
  additionalProperties: false,
};

function targetBlueprint(): Record<string, unknown> {
  const declared = (key: string, effect: string, extra = {}) => ({
    key,
    label: key,
    description: `${key} purpose`,
    effect,
    confirm: false,
    input: null,
    revert: { supported: false },
    ...extra,
  });
  return {
    name: "Usage",
    description: "Reads usage",
    screens: [],
    commands: [
      declared("usage.read", "read"),
      declared(PURGE, "write", { confirm: true, input: PURGE_INPUT }),
    ],
    automatic_tasks: [],
    permissions: [],
    problem_codes: [],
    documents: [],
    agent_context: [],
    app_connections: [],
    sdk_dependencies: [],
  };
}

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

type Core = {
  harness: CoreHarness;
  user: Login;
  machine: Login;
  caller: Login;
  access: Awaited<ReturnType<typeof coreAccess>>;
};

async function open(): Promise<Core> {
  const opened = await createCoreHarness({
    io: true,
    teams: [{ createLedgerRegistration }],
    teamModules: [
      new URL("../../../../apps/core/apps.ts", import.meta.url).href,
    ],
    nowMs: Date.now(),
  });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  const harness = opened.value;
  const reads = ["GetApproval", "ListApprovals", "invocations.get"];
  const creating = ["create_approval_request", "cancel_approval_request"];
  const user = await login(harness, "user", "user-1", [
    ...creating,
    "grant_approval_request",
    "reject_approval_request",
    "apply_approved_action",
    ...reads,
  ]);
  const machine = await login(harness, "machine", "machine-1", [
    "apply_approved_action",
    "invocation.accept_confirm",
    ...reads,
  ]);
  const caller = await login(harness, "app", "app-1", [...creating, ...reads]);
  return { harness, user, machine, caller, access: await coreAccess(harness) };
}

async function inputHash(value: unknown): Promise<string> {
  const hashed = await canonicalInputHash(PURGE_INPUT as never, value);
  assert(hashed.ok, hashed.ok ? "" : hashed.error.message);
  return hashed.value;
}

// proof 수명(invocations/confirm.ts의 CONFIRM_PROOF_LIFETIME_MS와 같은 120초). 다른 leaf라 mod.ts 밖
// 값은 import하지 못해 값만 맞춰 둔다.
const PROOF_LIFETIME_MS = 120_000;

// 적용된 접수만 다시 읽는다. 접수 command는 dispatch 전용이라 직접 HTTP로 부르지 않는다(직접 부르면
// approval 사용 없이 접수가 만들어질 수 있다). 운영 어댑터처럼 core가 가진 접수 사실에서 proof를
// 다시 만든다. 수명은 접수 시각 기준이다(R7).
function acceptances(core: Core): ConfirmAcceptances {
  return {
    find(input) {
      const [row] = inspect(
        core.harness,
        `select i.id as id, e.at as at from invocations i
           join events e on e.subject = i.id and e.type = 'InvocationAccepted'
          where i.approval = ?`,
        [input.approval],
      );
      if (row === undefined) {
        return Promise.resolve({
          ok: false,
          error: { code: "not_found", message: "confirm is not accepted" },
        });
      }
      return Promise.resolve({
        ok: true,
        value: {
          invocation: String(row["id"]),
          proof: {
            invocation: String(row["id"]),
            process_nonce: input.process_nonce,
            release: input.release,
            command: input.command,
            input_hash: input.input_hash,
            caller: input.caller,
            expires_at: new Date(
              Date.parse(String(row["at"])) + PROOF_LIFETIME_MS,
            ).toISOString(),
          },
        } as never,
      });
    },
  };
}

function acceptInput(a: Peer, b: Peer, hash: string) {
  return {
    app: b.app,
    release: b.release,
    command: PURGE,
    input_hash: hash,
    approval: APPROVAL,
    key: "confirm-key-1",
    process_nonce: b.nonce,
    caller: {
      kind: "app" as const,
      app: a.app,
      release: a.release,
      parent_invocation: null,
    },
  };
}

// 요청자는 호출한 앱(app credential)이고 허락은 사람이 한다. 적용은 machine이 한다.
async function approve(core: Core, input: Record<string, unknown>) {
  const action = await actionOf({
    concern: "apps/invocations",
    command: "invocation.accept_confirm",
    caller: core.caller.context.actor,
    targets: [String(input["app"]), String(input["release"])],
    value: input as never,
    comparison: { release: String(input["release"]) },
  });
  const created = await call(
    core.harness,
    "approvals/create",
    core.caller.token,
    command(
      await createInput(APPROVAL, core.caller.context.actor, action),
    ),
  );
  assertEquals(created.status, 200, JSON.stringify(created.body));
  const decided = await decide(
    core.harness,
    core.user.token,
    created.body["request"] as ApprovalRequest,
    "grant",
  );
  assertEquals(decided.status, 200, JSON.stringify(decided.body));
  const granted = decided.body["request"] as ApprovalRequest;
  return async () =>
    await call(
      core.harness,
      "approvals/apply",
      core.machine.token,
      command({
        approval: granted.id,
        action: granted.action,
        idempotency_key: `apply-${APPROVAL}`,
      }),
    );
}

async function openWorld(): Promise<{
  core: Core;
  world: PairWorld;
  a: Peer;
  b: Peer;
}> {
  const core = await open();
  const world = await openPairWorld();
  const parsed = validateBlueprint(targetBlueprint());
  assert(parsed.ok);
  // 호출 앱의 id는 approval 요청자(app credential)의 앱 id다.
  const a = await world.addPeer(1, {
    app: core.caller.context.actor.slice("app:".length),
  });
  const b = await world.addPeer(2, {
    child: true,
    blueprint: targetBlueprint(),
  });
  world.declare(a, b, ["usage.read", PURGE]);
  world.grant(a, b, ["usage.read", PURGE]);
  return { core, world, a, b };
}

async function close(
  { core, world }: { core: Core; world: PairWorld },
) {
  await world.close();
  await core.harness.close();
}

// core의 approval 쪽 어댑터다. 요청자는 호출한 앱(app credential)이고 허락은 사람이 하며 적용은
// machine이 한다. 서비스가 poll에서 허락을 보면 적용하고 접수된 proof를 서명한다.
function approvalsOf(core: Core): ConfirmApprovals {
  const read = async (approval: string) => {
    const reply = await call(
      core.harness,
      "approvals/get",
      core.machine.token,
      { approval },
    );
    return reply.status === 200
      ? reply.body["request"] as ApprovalRequest
      : undefined;
  };
  return {
    async create({ approval, accept }) {
      const action = await actionOf({
        concern: "apps/invocations",
        command: "invocation.accept_confirm",
        caller: core.caller.context.actor,
        targets: [accept.app, accept.release],
        value: accept as never,
        comparison: { release: accept.release },
      });
      const created = await call(
        core.harness,
        "approvals/create",
        core.caller.token,
        command(await createInput(approval, core.caller.context.actor, action)),
      );
      return created.status === 200 ? ok(undefined) : err({
        code: "unavailable",
        message: "approval could not be requested",
      });
    },
    async state(approval) {
      const found = await read(approval);
      if (found === undefined) {
        return err({ code: "not_found", message: "approval not found" });
      }
      const status = found.status as string;
      return ok(
        status === "pending" || status === "granted" || status === "expired"
          ? status
          : "rejected",
      );
    },
    async apply(approval) {
      const found = await read(approval);
      if (found === undefined) {
        return err({ code: "not_found", message: "approval not found" });
      }
      const applied = await call(
        core.harness,
        "approvals/apply",
        core.machine.token,
        command({
          approval,
          action: found.action,
          idempotency_key: `apply-${approval}`,
        }),
      );
      return applied.status === 200 ? ok(undefined) : err({
        code: "conflict",
        message: "approval could not be applied",
      });
    },
  };
}

const targets: ConfirmTargets = {
  async prepare(input) {
    if (input.command !== PURGE) {
      return err({
        code: "invalid_input",
        message: "command needs no confirm",
      });
    }
    const hashed = await canonicalInputHash(PURGE_INPUT as never, input.input);
    return hashed.ok ? ok({ input_hash: hashed.value }) : err({
      code: "invalid_input",
      message: hashed.error.message,
    });
  },
};

function confirmerOf(core: Core, world: PairWorld) {
  return createPairConfirmer({
    process: world.preparerDeps.process,
    facts: world.preparerDeps.facts,
    signer: world.signer,
    paths: world.preparer.paths,
    ids: createIdSource({ clock: systemClock, random: cryptoRandom }),
    targets,
    approvals: approvalsOf(core),
    accepted: acceptances(core),
    sleep: () => Promise.resolve(),
  });
}

async function decideApproval(
  core: Core,
  approval: string,
  decision: "grant" | "reject",
) {
  const reply = await call(core.harness, "approvals/get", core.machine.token, {
    approval,
  });
  assertEquals(reply.status, 200, JSON.stringify(reply.body));
  const decided = await decide(
    core.harness,
    core.user.token,
    reply.body["request"] as ApprovalRequest,
    decision,
  );
  assertEquals(decided.status, 200, JSON.stringify(decided.body));
}

Deno.test("apps/connections#R3: 호출한 앱이 broker로 approval을 요청해 사람의 결정을 poll로 기다리고 적용 뒤 서명된 proof로 B의 handler를 한 번 부른다", async () => {
  const ctx = await openWorld();
  const { core, world, a, b } = ctx;
  try {
    const bridge = world.bridge(a, { confirmer: confirmerOf(core, world) });
    const prepared = await connectPair(bridge, b.app, ["usage.read", PURGE]);
    assert(prepared.ok);
    const hash = await inputHash(AMOUNT);

    // 연결 허락만으로는 proof 없이 실행되지 않고, 거절은 확인이 필요하다는 사실을 알린다.
    const bare = await invokePair(
      prepared.value,
      b.release,
      PURGE,
      AMOUNT,
      "r0",
    );
    assertEquals(bare.status, 403);
    assertEquals(
      (bare.body as { error: { details: unknown } }).error.details,
      { confirm_required: true },
    );

    const request = {
      app: b.app,
      command: PURGE,
      input: AMOUNT,
      target_release: b.release,
      target_process_nonce: b.nonce,
      parent_invocation: null,
    };
    // 신원은 자식 연결이 정한다. 다른 프로세스를 가리키거나 확인이 필요 없는 command는 거절된다.
    const stale = await bridge.post(CONFIRM_REQUEST, {
      ...request,
      target_process_nonce: "old-nonce",
    });
    assertEquals(stale.status, 409);
    const plain = await bridge.post(CONFIRM_REQUEST, {
      ...request,
      command: "usage.read",
      input: undefined,
    });
    assertEquals(plain.status, 400);
    assertEquals(
      (await bridge.post(CONFIRM_REQUEST, { ...request, caller: {} })).status,
      400,
    );

    const requested = await bridge.post(CONFIRM_REQUEST, request);
    assertEquals(requested.status, 200, JSON.stringify(requested.body));
    const { approval, input_hash } = requested.body as {
      approval: string;
      input_hash: string;
    };
    assertEquals(input_hash, hash);

    // 사람이 결정하기 전에는 pending이고 접수도 proof도 없다.
    const waiting = await bridge.post(CONFIRM_POLL, { approval, wait_ms: 0 });
    assertEquals(waiting.body, { state: "pending" });
    assertEquals((await core.access.invocations()).length, 0);
    // 다른 자식의 approval 조회는 없는 것과 같다.
    const other = await world.addPeer(5);
    const stranger = await world.bridge(other).post(CONFIRM_POLL, { approval });
    assertEquals(stranger.status, 404);

    await decideApproval(core, approval, "grant");
    const granted = await bridge.post(CONFIRM_POLL, { approval, wait_ms: 0 });
    assertEquals(granted.status, 200, JSON.stringify(granted.body));
    const result = granted.body as {
      state: string;
      invocation: string;
      proof: { payload: Record<string, unknown>; signature: string };
    };
    assertEquals(result.state, "granted");
    // approval은 이 적용에서 한 번 쓰였다.
    assertEquals(
      count(core.harness, "select count(*) as n from approval_uses"),
      1,
    );
    assertEquals(result.proof.payload["process_nonce"], b.nonce);

    const run = await invokePair(
      prepared.value,
      b.release,
      PURGE,
      AMOUNT,
      "r1",
      result.proof,
    );
    assertEquals(run.status, 200, JSON.stringify(run.body));
    assertEquals(
      (run.body as { invocation?: string }).invocation,
      result.invocation,
    );
    // 같은 proof를 다시 보내도 handler는 다시 실행되지 않는다.
    const replay = await invokePair(
      prepared.value,
      b.release,
      PURGE,
      AMOUNT,
      "r2",
      result.proof,
    );
    assert(replay.status === 200 || replay.status === 409);
    assertEquals(b.child!.output().split("ran usage.purge").length - 1, 1);
    // 끝난 approval은 다시 조회되지 않고 approval 사용도 늘지 않는다.
    assertEquals(
      (await bridge.post(CONFIRM_POLL, { approval, wait_ms: 0 })).status,
      404,
    );
    assertEquals(
      count(core.harness, "select count(*) as n from approval_uses"),
      1,
    );

    // 다른 입력에 옮긴 proof와 caller를 바꾼 proof는 거절된다.
    const moved = await invokePair(
      prepared.value,
      b.release,
      PURGE,
      { amount: 13 },
      "r3",
      result.proof,
    );
    assertEquals(moved.status, 409);
    const forged = {
      payload: {
        ...result.proof.payload,
        caller: {
          ...(result.proof.payload["caller"] as object),
          app: "app_01h455vb4pex5v6nkc6gd5fd77",
        },
      },
      signature: result.proof.signature,
    };
    const stolen = await invokePair(
      prepared.value,
      b.release,
      PURGE,
      AMOUNT,
      "r4",
      forged,
    );
    assertEquals(stolen.status, 401);
  } finally {
    await close(ctx);
  }
});

Deno.test("apps/connections#R3: 사람이 거절한 approval은 접수도 proof도 없이 rejected로 끝난다", async () => {
  const ctx = await openWorld();
  const { core, world, a, b } = ctx;
  try {
    const bridge = world.bridge(a, { confirmer: confirmerOf(core, world) });
    const requested = await bridge.post(CONFIRM_REQUEST, {
      app: b.app,
      command: PURGE,
      input: AMOUNT,
      target_release: b.release,
      target_process_nonce: b.nonce,
      parent_invocation: null,
    });
    assertEquals(requested.status, 200, JSON.stringify(requested.body));
    const approval = (requested.body as { approval: string }).approval;
    await decideApproval(core, approval, "reject");
    const polled = await bridge.post(CONFIRM_POLL, { approval, wait_ms: 0 });
    assertEquals(polled.body, { state: "rejected" });
    assertEquals((await core.access.invocations()).length, 0);
    assertEquals(
      count(core.harness, "select count(*) as n from approval_uses"),
      0,
    );
  } finally {
    await close(ctx);
  }
});

Deno.test("apps/connections#R3: proof 발급은 호출한 앱·현재 허락·현재 프로세스에만 묶인다", async () => {
  const ctx = await openWorld();
  const { core, world, a, b } = ctx;
  try {
    const hash = await inputHash(AMOUNT);
    const input = acceptInput(a, b, hash);
    const applied = await (await approve(core, input))();
    assertEquals(applied.status, 200, JSON.stringify(applied.body));
    const issuer = createConfirmProofIssuer({
      process: world.preparerDeps.process,
      facts: world.preparerDeps.facts,
      signer: world.signer,
      paths: world.preparer.paths,
      accepted: acceptances(core),
    });
    const source = world.child(a);
    // 다른 앱이 이 접수로 proof를 받으려 해도 caller가 다르다.
    const other = await world.addPeer(5);
    const impostor = await issuer.issue({
      source: world.child(other),
      accept: input,
    });
    assert(!impostor.ok);
    assertEquals(impostor.error.code, "forbidden");
    // 접수 입력이 부른 앱의 부모·release를 바꿔 주장하면 거절된다.
    const wrongRelease = await issuer.issue({
      source,
      accept: {
        ...input,
        caller: { ...input.caller, release: "rel_01h455vb4pex5v6nkc6gd5fd77" },
      },
    });
    assert(!wrongRelease.ok);
    // 앱 쌍 허락을 거두면 접수가 남아 있어도 proof를 서명하지 않는다.
    const grant = world.grants[0];
    world.revoke(grant);
    const revoked = await issuer.issue({ source, accept: input });
    assert(!revoked.ok);
    assertEquals(revoked.error.code, "not_found");
    world.grants[0] = grant;
    // B가 새 프로세스로 바뀌면 옛 nonce의 접수는 쓰지 못한다.
    world.observations.set(b.app, {
      ...world.observations.get(b.app)!,
      processNonce: "nonce-new",
    });
    const stale = await issuer.issue({ source, accept: input });
    assert(!stale.ok);
    assertEquals(stale.error.code, "conflict");
  } finally {
    await close(ctx);
  }
});
