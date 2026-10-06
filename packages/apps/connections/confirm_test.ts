// A→B confirm=true 호출(apps/connections#R3)을 실제 core의 approval route, 실제 core 서명 key,
// 실제 앱 자식 프로세스로 본다. 연결 허락은 사람 확인을 대신하지 않는다. 사람이 허락한 approval이
// 적용돼 접수가 확정된 뒤에만 proof가 서명돼 호출한 앱에 가고, B가 그 proof로 handler를 한 번 부른다.
// core는 temp 홈에서 뜨고 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { createLedgerRegistration } from "../../../apps/core/apps.ts";
import {
  type CoreHarness,
  createCoreHarness,
} from "../../../apps/core/testing/core.ts";
import {
  actionOf,
  call,
  command,
  createInput,
  decide,
} from "../../../apps/core/testing/approvals-fixture.ts";
import type {
  ApprovalRequest,
  AuthenticatedContext,
} from "../../contracts/platform/mod.ts";
import { canonicalInputHash, validateBlueprint } from "../blueprint/mod.ts";
import { coreAccess } from "../invocations/testing/mod.ts";
import {
  type ConfirmAcceptances,
  createConfirmProofIssuer,
} from "./confirm.ts";
import {
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
    teamModules: [new URL("../../../apps/core/apps.ts", import.meta.url).href],
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

// 적용된 접수만 다시 읽는다. 접수가 없으면 accept_confirm을 직접 부르지 않는다. 직접 부르면
// approval 사용 없이 접수가 만들어질 수 있기 때문이다.
function acceptances(core: Core): ConfirmAcceptances {
  return {
    async find(input) {
      const known = (await core.access.invocations()).some((row) =>
        row["approval"] === input.approval
      );
      if (!known) {
        return {
          ok: false,
          error: { code: "not_found", message: "confirm is not accepted" },
        };
      }
      const reply = await core.access.post("invocations/accept_confirm", input);
      if (reply.status !== 200) {
        return {
          ok: false,
          error: { code: "forbidden", message: "confirm is not accepted" },
        };
      }
      return { ok: true, value: reply.body as never };
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

Deno.test("apps/connections#R3: A→B confirm=true는 사람 approval 적용 뒤 서명된 proof가 있어야만 B의 handler를 한 번 부른다", async () => {
  const ctx = await openWorld();
  const { core, world, a, b } = ctx;
  try {
    const bridge = world.bridge(a);
    const prepared = await connectPair(bridge, b.app, ["usage.read", PURGE]);
    assert(prepared.ok);
    const issuer = createConfirmProofIssuer({
      process: world.preparerDeps.process,
      facts: world.preparerDeps.facts,
      signer: world.signer,
      paths: world.preparer.paths,
      accepted: acceptances(core),
    });
    const hash = await inputHash(AMOUNT);
    const input = acceptInput(a, b, hash);
    const source = world.child(a);

    // 연결 허락만으로는 proof 없이 실행되지 않는다.
    const bare = await invokePair(
      prepared.value,
      b.release,
      PURGE,
      AMOUNT,
      "run-0",
    );
    assertEquals(bare.status, 403);

    // 사람이 허락해도 적용되기 전에는 접수가 없어 proof를 서명하지 않는다.
    const apply = await approve(core, input);
    const early = await issuer.issue({ source, accept: input });
    assert(
      !early.ok,
      "proof must not be issued before the approval is applied",
    );
    assertEquals(
      (await core.access.invocations()).length,
      0,
      "the early lookup must not create an acceptance",
    );

    const applied = await apply();
    assertEquals(applied.status, 200, JSON.stringify(applied.body));
    const issued = await issuer.issue({ source, accept: input });
    assert(issued.ok, JSON.stringify(issued));
    assertEquals(issued.value.proof.payload.caller, input.caller);
    assertEquals(issued.value.proof.payload.process_nonce, b.nonce);

    // 호출한 앱은 같은 입력과 함께 B의 direct 호출에 붙인다.
    const run = await invokePair(
      prepared.value,
      b.release,
      PURGE,
      AMOUNT,
      "run-1",
      issued.value.proof,
    );
    assertEquals(run.status, 200, JSON.stringify(run.body));
    assertEquals(
      (run.body as { invocation?: string }).invocation,
      issued.value.invocation,
    );
    // 같은 proof를 다시 보내도 handler는 다시 실행되지 않는다.
    const replay = await invokePair(
      prepared.value,
      b.release,
      PURGE,
      AMOUNT,
      "run-2",
      issued.value.proof,
    );
    assert(replay.status === 200 || replay.status === 409);
    const ran = b.child!.output().split("ran usage.purge").length - 1;
    assertEquals(ran, 1);

    // 다른 입력에 옮긴 proof와 caller를 바꾼 proof는 거절된다.
    const moved = await invokePair(
      prepared.value,
      b.release,
      PURGE,
      { amount: 13 },
      "run-3",
      issued.value.proof,
    );
    assertEquals(moved.status, 409);
    const forged = {
      payload: {
        ...issued.value.proof.payload,
        caller: { ...input.caller, app: "app_01h455vb4pex5v6nkc6gd5fd77" },
      },
      signature: issued.value.proof.signature,
    };
    const stolen = await invokePair(
      prepared.value,
      b.release,
      PURGE,
      AMOUNT,
      "run-4",
      forged,
    );
    assertEquals(stolen.status, 401);
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
