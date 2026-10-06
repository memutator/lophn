// grant command와 read를 실제 core(임시 LOPHN_HOME)의 HTTP route로 본다. grant는 정확한
// approval의 적용으로만 생기고(apps/permissions#R1), 회수는 confirmation window를 지난 사람의
// 결정이다. 현재 release 선언과 activation event는 releases 조립이 들어오기 전이라
// testing/mod.ts의 시험 team이 같은 port·event로 낸다. 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import {
  type Grant,
  type GrantPermissionScope,
  grantRevoke,
} from "../../contracts/apps/mod.ts";
import type {
  ApprovalAction,
  AuthenticatedContext,
} from "../../contracts/platform/mod.ts";
import {
  actionOf,
  call,
  codeOf,
  command,
  count,
  createInput,
  decide,
  inspect,
  type Reply,
} from "../../../apps/core/testing/approvals-fixture.ts";
import { confirmationFor } from "../../../apps/core/testing/confirmation-fixture.ts";
import {
  type CoreHarness,
  createCoreHarness,
} from "../../../apps/core/testing/core.ts";
import type { AppDeclarations } from "./declarations.ts";
import { effectiveScope } from "./effective.ts";

const HASH = "ab".repeat(32);
const NET = { host: "api.example.com", port: 443 };
const AT = "2026-10-06T00:00:00.000Z";

type Login = { token: string; context: AuthenticatedContext };
type World = {
  harness: CoreHarness;
  user: Login;
  machine: Login;
  next: number;
};

async function login(
  harness: CoreHarness,
  actor: "user" | "machine",
  operations: string[],
  targets: Record<string, string> = {},
): Promise<Login> {
  const issued = await harness.credential({
    actor,
    principal: `${actor}-${operations.length}-${Object.keys(targets).length}`,
    scope: { operations, targets },
    conditions: {},
  });
  assert(issued.ok, issued.ok ? "" : issued.error.message);
  return issued.value;
}

const USER_OPERATIONS = [
  "app.create",
  "app.connect_source",
  "grant.revoke",
  "grants.list",
  "grant_approval_request",
  "GetApproval",
];
const MACHINE_OPERATIONS = [
  "create_approval_request",
  "apply_approved_action",
  "grant.create",
  "grants.list",
  "app.record_started",
  "app.record_stopped",
  "permissions.tests.set_declarations",
  "permissions.tests.activation",
  "GetApproval",
];

async function open(withFixtures = true): Promise<World> {
  const documents = await import("../../../apps/core/documents.ts");
  const apps = await import("../../../apps/core/apps.ts");
  const fixtures = await import("./testing/mod.ts");
  // approval 설명 글은 blob으로 준비되므로 I/O worker가 필요하다(platform#305).
  const opened = await createCoreHarness({
    io: true,
    teams: [
      // 앱 등록의 place 이름 예약 표는 documents 등록의 몫이다.
      { createLedgerRegistration: documents.createLedgerRegistration },
      { createLedgerRegistration: apps.createLedgerRegistration },
      ...(withFixtures
        ? [{ createLedgerRegistration: fixtures.createLedgerRegistration }]
        : []),
    ],
    teamModules: [
      new URL("../../../apps/core/documents.ts", import.meta.url).href,
      new URL("../../../apps/core/apps.ts", import.meta.url).href,
      ...(withFixtures
        ? [new URL("./testing/mod.ts", import.meta.url).href]
        : []),
    ],
  });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  const harness = opened.value;
  return {
    harness,
    user: await login(harness, "user", USER_OPERATIONS),
    machine: await login(harness, "machine", MACHINE_OPERATIONS),
    next: 1,
  };
}

async function createApp(world: World, slug: string): Promise<string> {
  const created = await call(
    world.harness,
    "apps/create",
    world.user.token,
    command({ slug, name: slug, description: `${slug} app` }),
  );
  assertEquals(created.status, 200, JSON.stringify(created.body));
  return String(created.body["id"]);
}

function approvalId(world: World): string {
  const suffix = String(world.next++).padStart(2, "0");
  return `apr_01h455vb4pex5v6nkc6gd5fd${suffix}`;
}

function grantsSeq(world: World, app: string): string {
  const rows = inspect(
    world.harness,
    `SELECT COALESCE(MAX(e.seq), 0) AS n FROM events e
     JOIN grants g ON g.id = e.subject
     WHERE g.app = ? AND e.type IN ('GrantCreated', 'GrantRevoked')`,
    [app],
  );
  return String(rows[0]["n"]);
}

async function declare(
  world: World,
  app: string,
  patch: Partial<AppDeclarations> | null,
): Promise<void> {
  const declarations = patch === null ? null : {
    release: "rel_01h455vb4pex5v6nkc6gd5fdw1",
    permissions: [],
    app_connections: [],
    commands: [],
    automations: [],
    ...patch,
  };
  const stored = await call(
    world.harness,
    "permissions_tests/set_declarations",
    world.machine.token,
    command({ app, declarations }),
  );
  assertEquals(stored.status, 200, JSON.stringify(stored.body));
}

type Approved = {
  approval: string;
  input: Record<string, unknown>;
  action: ApprovalAction;
  reply: Reply;
};

// 정확한 approval을 만들고 사람이 허락한 뒤 적용한다. grant.create의 유일한 정상 경로다.
async function grantViaApproval(
  world: World,
  app: string,
  scope: GrantPermissionScope,
  options: { seq?: string; decideGrant?: boolean } = {},
): Promise<Approved> {
  const approval = approvalId(world);
  const input = { app, kind: scope.kind, scope, approval };
  const comparison = { grants_seq: options.seq ?? grantsSeq(world, app) };
  const action = await actionOf({
    concern: "apps/permissions",
    command: "grant.create",
    caller: "machine",
    targets: [app],
    value: input as never,
    comparison,
  });
  const created = await call(
    world.harness,
    "approvals/create",
    world.machine.token,
    command(await createInput(approval, world.machine.context.actor, action)),
  );
  assertEquals(created.status, 200, JSON.stringify(created.body));
  if (options.decideGrant !== false) {
    const decided = await decide(
      world.harness,
      world.user.token,
      created.body["request"] as never,
      "grant",
    );
    assertEquals(decided.status, 200, JSON.stringify(decided.body));
  }
  const reply = await call(
    world.harness,
    "approvals/apply",
    world.machine.token,
    command({
      approval,
      action,
      idempotency_key: `apply-${approval}`,
    }),
  );
  return { approval, input, action, reply };
}

async function listGrants(
  world: World,
  input: Record<string, unknown> = {},
  login: Login = world.user,
): Promise<Grant[]> {
  const listed = await call(world.harness, "grants/list", login.token, input);
  assertEquals(listed.status, 200, JSON.stringify(listed.body));
  return listed.body["grants"] as Grant[];
}

function effective(
  app: string,
  declarations: AppDeclarations,
  grants: Grant[],
  targets: Record<string, string[]> = {},
) {
  return effectiveScope({
    app,
    declarations,
    grants,
    targetCommands: (target) => targets[target],
  });
}

function declared(patch: Partial<AppDeclarations>): AppDeclarations {
  return {
    release: "rel_01h455vb4pex5v6nkc6gd5fdw1",
    permissions: [],
    app_connections: [],
    commands: [],
    automations: [],
    ...patch,
  };
}

const grantEvents = (world: World, type: string) =>
  count(
    world.harness,
    "SELECT COUNT(*) AS n FROM events WHERE type = ?",
    [type],
  );

const REL = "rel_01h455vb4pex5v6nkc6gd5fdw1";

async function startProcess(world: World, app: string, nonce: string) {
  const started = await call(
    world.harness,
    "apps/record_started",
    world.machine.token,
    command({
      app,
      process_nonce: nonce,
      started_at: AT,
      attestation: {
        release: REL,
        bundle_hash: HASH,
        commands: ["usage.sync"],
        data_schema: 0,
        process_nonce: nonce,
        connection_ok: true,
      },
    }),
  );
  assertEquals(started.status, 200, JSON.stringify(started.body));
}

async function stopProcess(world: World, app: string, nonce: string) {
  const stopped = await call(
    world.harness,
    "apps/record_stopped",
    world.machine.token,
    command({
      app,
      release: REL,
      process_nonce: nonce,
      started_at: AT,
      termination_confirmed: true,
    }),
  );
  assertEquals(stopped.status, 200, JSON.stringify(stopped.body));
}

async function activation(
  world: World,
  app: string,
  phase: "start" | "succeed" | "fail",
  startedSeq?: string,
): Promise<string> {
  const reply = await call(
    world.harness,
    "permissions_tests/activation",
    world.machine.token,
    command({
      app,
      phase,
      ...(startedSeq === undefined ? {} : { started_seq: startedSeq }),
    }),
  );
  assertEquals(reply.status, 200, JSON.stringify(reply.body));
  return String(reply.body["seq"]);
}

async function revoke(
  world: World,
  grant: Grant,
  evidence: { nonce?: string; confirmed?: true } = {},
  options: { handle?: boolean; seq?: string } = {},
): Promise<Reply> {
  const input = {
    grant: grant.id,
    process_nonce: evidence.nonce ?? null,
    termination_confirmed: evidence.confirmed ?? null,
  };
  const confirmation = options.handle === false
    ? undefined
    : await confirmationFor(world.harness, grantRevoke, input);
  return await call(
    world.harness,
    "grants/revoke",
    world.user.token,
    command(input, {
      compare: { grants_seq: options.seq ?? grantsSeq(world, grant.app) },
      ...(confirmation === undefined ? {} : { confirmation }),
    }),
  );
}

async function onlyGrant(world: World, app: string): Promise<Grant> {
  const grants = await listGrants(world, { app });
  assertEquals(grants.length, 1);
  return grants[0];
}

Deno.test("apps/permissions#R1: 선언만 있는 접근은 실행 범위가 0이고 같은 범위의 approval 적용 뒤에만 grant가 생긴다", async () => {
  const world = await open();
  try {
    const app = await createApp(world, "usage");
    const scope: GrantPermissionScope = { kind: "net.fetch", ...NET };
    const declarations = declared({
      permissions: [{ kind: "net.fetch", scope: NET, reason: "usage api" }],
    });
    await declare(world, app, declarations);
    // 선언만 있다: grant도 실행 범위도 없다.
    assertEquals(await listGrants(world, { app }), []);
    assertEquals(effective(app, declarations, []).access, []);

    // 허락 전 approval로는 만들 수 없다.
    const pending = await grantViaApproval(world, app, scope, {
      decideGrant: false,
    });
    assertEquals(codeOf(pending.reply), "conflict");
    assertEquals(await listGrants(world, { app }), []);
    // grant.create는 dispatch 전용이라 직접 부르면 허락 여부와 상관없이 없는 command와 같게 거절된다.
    const direct = await call(
      world.harness,
      "grants/create",
      world.machine.token,
      command(pending.input, { compare: { grants_seq: "0" } }),
    );
    assertEquals(codeOf(direct), "invalid_input");

    // 정확히 허락된 approval을 적용하면 grant 하나가 active로 생긴다.
    const applied = await grantViaApproval(world, app, scope);
    assertEquals(applied.reply.status, 200, JSON.stringify(applied.reply.body));
    const grant = await onlyGrant(world, app);
    assertEquals(grant.status, "active");
    assertEquals(grant.approval, applied.approval);
    assertEquals(grant.created_by, "user");
    assertEquals(grant.scope, scope);
    assertEquals(grantEvents(world, "GrantCreated"), 1);
    assertEquals(effective(app, declarations, [grant]).access, [
      { kind: "net.fetch", scope: NET },
    ]);

    // 같은 approval은 grant를 더 만들지 못한다(다시 적용·직접 호출).
    const replay = await call(
      world.harness,
      "approvals/apply",
      world.machine.token,
      command({
        approval: applied.approval,
        action: applied.action,
        idempotency_key: "replay",
      }),
    );
    assertEquals(replay.body["replayed"], true);
    const reused = await call(
      world.harness,
      "grants/create",
      world.machine.token,
      command(applied.input, {
        compare: { grants_seq: grantsSeq(world, app) },
      }),
    );
    assertEquals(codeOf(reused), "invalid_input");
    assertEquals((await listGrants(world, { app })).length, 1);

    // 허락된 approval의 입력과 다른 범위로는 만들지 못한다.
    const other: GrantPermissionScope = {
      kind: "net.fetch",
      host: "other.example.com",
      port: 443,
    };
    const second = await grantViaApproval(world, app, other, {
      decideGrant: false,
    });
    const swapped = await call(
      world.harness,
      "grants/create",
      world.machine.token,
      command({ ...second.input, scope: scope }, {
        compare: { grants_seq: grantsSeq(world, app) },
      }),
    );
    assertEquals(codeOf(swapped), "invalid_input");
    assertEquals((await listGrants(world, { app })).length, 1);
  } finally {
    await world.harness.close();
  }
});

Deno.test("apps/permissions#R2: grant는 남아도 새 release 선언에 없으면 실행 범위에서 빠진다", async () => {
  const world = await open();
  try {
    const app = await createApp(world, "usage");
    const first = declared({
      permissions: [{ kind: "net.fetch", scope: NET, reason: "usage api" }],
    });
    await declare(world, app, first);
    const applied = await grantViaApproval(world, app, {
      kind: "net.fetch",
      ...NET,
    });
    assertEquals(applied.reply.status, 200, JSON.stringify(applied.reply.body));
    const grants = await listGrants(world, { app, status: "active" });
    assertEquals(effective(app, first, grants).access.length, 1);

    // 새 release는 net.fetch를 더는 선언하지 않고 grant 없는 document.save를 선언한다.
    const next = declared({
      permissions: [
        { kind: "document.save", scope: { key: "report" }, reason: "save" },
      ],
    });
    await declare(world, app, next);
    const still = await listGrants(world, { app, status: "active" });
    assertEquals(still.length, 1);
    assertEquals(effective(app, next, still).access, []);
  } finally {
    await world.harness.close();
  }
});

Deno.test("apps/permissions#R3: 같은 host·port의 후속 release는 기존 grant를 쓰고 새 host·port는 새 approval 전까지 포함하지 않는다", async () => {
  const world = await open();
  try {
    const app = await createApp(world, "usage");
    const second = { host: "api.example.com", port: 8443 };
    const first = declared({
      permissions: [{ kind: "net.fetch", scope: NET, reason: "usage api" }],
    });
    await declare(world, app, first);
    assertEquals(
      (await grantViaApproval(world, app, { kind: "net.fetch", ...NET })).reply
        .status,
      200,
    );
    const next = declared({
      permissions: [
        { kind: "net.fetch", scope: NET, reason: "same as before" },
        { kind: "net.fetch", scope: second, reason: "new port" },
      ],
    });
    await declare(world, app, next);
    const grants = await listGrants(world, { app, status: "active" });
    assertEquals(effective(app, next, grants).access, [
      { kind: "net.fetch", scope: NET },
    ]);
    // 새 port는 새 사람 결정 뒤에만 들어온다.
    const added = await grantViaApproval(world, app, {
      kind: "net.fetch",
      ...second,
    });
    assertEquals(added.reply.status, 200, JSON.stringify(added.reply.body));
    const both = await listGrants(world, { app, status: "active" });
    assertEquals(effective(app, next, both).access.length, 2);
  } finally {
    await world.harness.close();
  }
});

Deno.test("apps/permissions#R24: fs.read와 net.fetch를 함께 선언해도 사람이 허락한 grant만 생기고 나머지는 자동 부여되지 않는다", async () => {
  const world = await open();
  try {
    const app = await createApp(world, "usage");
    const path = { path: "/srv/lophn-test/reports", recursive: true };
    const declarations = declared({
      permissions: [
        { kind: "fs.read", scope: path, reason: "read reports" },
        { kind: "net.fetch", scope: NET, reason: "upload" },
      ],
    });
    await declare(world, app, declarations);
    assertEquals(await listGrants(world, { app }), []);
    const applied = await grantViaApproval(world, app, {
      kind: "fs.read",
      ...path,
    });
    assertEquals(applied.reply.status, 200, JSON.stringify(applied.reply.body));
    const grants = await listGrants(world, { app });
    assertEquals(grants.map((g) => g.kind), ["fs.read"]);
    // 선언을 내는 reader port(releases 조립)가 있는 core의 grants.list는 현재 선언의 표시 자료를 준다.
    const listed = await call(world.harness, "grants/list", world.user.token, {
      app,
    });
    assert(listed.body["display"] !== null);
    assertEquals(effective(app, declarations, grants).access, [
      { kind: "fs.read", scope: path },
    ]);
  } finally {
    await world.harness.close();
  }
});

Deno.test("apps/permissions#R26: app.call grant는 (caller, target, commands) 방향으로 기록되고 선언 밖 command·B→A·A→C는 포함하지 않는다", async () => {
  const world = await open();
  try {
    const a = await createApp(world, "caller");
    const b = await createApp(world, "target");
    const c = await createApp(world, "third");
    const scope: GrantPermissionScope = {
      kind: "app.call",
      app: b,
      commands: ["report.list", "report.read"],
    };
    // 현재 release가 없으면 만들지 않는다.
    const none = await grantViaApproval(world, a, scope);
    assertEquals(codeOf(none.reply), "conflict");

    const callerDeclared = declared({
      app_connections: [{ app: b, commands: ["report.list", "report.read"] }],
    });
    await declare(world, a, callerDeclared);
    // 선언 밖 command가 들어 있으면 거절한다.
    const wider = await grantViaApproval(world, a, {
      ...scope,
      commands: ["report.export", "report.list", "report.read"],
    });
    assertEquals(codeOf(wider.reply), "conflict");
    // 자기 자신을 부르는 grant와 정렬되지 않은 목록은 거절한다.
    assertEquals(
      codeOf((await grantViaApproval(world, a, { ...scope, app: a })).reply),
      "invalid_input",
    );
    assertEquals(
      codeOf(
        (await grantViaApproval(world, a, {
          ...scope,
          commands: ["report.read", "report.list"],
        })).reply,
      ),
      "invalid_input",
    );

    const applied = await grantViaApproval(world, a, scope);
    assertEquals(applied.reply.status, 200, JSON.stringify(applied.reply.body));
    const grants = await listGrants(world);
    assertEquals(grants.length, 1);
    assertEquals(grants[0].app, a);
    const targets = {
      [a]: ["x"],
      [b]: ["report.list", "report.read", "report.export"],
      [c]: ["report.read"],
    };
    assertEquals(effective(a, callerDeclared, grants, targets).app_calls, [
      { app: b, commands: ["report.list", "report.read"] },
    ]);
    // 반대 방향 B→A와 제3 앱 A→C는 grant가 없다.
    const reverse = declared({
      app_connections: [{ app: a, commands: ["x"] }],
    });
    assertEquals(effective(b, reverse, grants, targets).app_calls, []);
    const toC = declared({
      app_connections: [{ app: c, commands: ["report.read"] }],
    });
    assertEquals(effective(a, toC, grants, targets).app_calls, []);
  } finally {
    await world.harness.close();
  }
});

Deno.test("apps/permissions#R27: agent.commands grant는 기본 닫힘이고 app.call·fs grant와 별도 허락으로만 열린다", async () => {
  const world = await open();
  try {
    const a = await createApp(world, "tasks");
    const b = await createApp(world, "other");
    const declarations = declared({
      commands: ["task.add", "task.list"],
      app_connections: [{ app: b, commands: ["report.read"] }],
      permissions: [{ kind: "net.fetch", scope: NET, reason: "api" }],
    });
    await declare(world, a, declarations);
    for (
      const scope of [
        { kind: "app.call", app: b, commands: ["report.read"] },
        { kind: "net.fetch", ...NET },
      ] as GrantPermissionScope[]
    ) {
      const applied = await grantViaApproval(world, a, scope);
      assertEquals(
        applied.reply.status,
        200,
        JSON.stringify(applied.reply.body),
      );
    }
    const before = await listGrants(world, { app: a });
    assertEquals(
      effective(a, declarations, before, { [b]: ["report.read"] })
        .agent_commands,
      [],
    );
    // 현재 blueprint에 없는 command는 열 수 없다.
    const unknown = await grantViaApproval(world, a, {
      kind: "agent.commands",
      commands: ["task.delete"],
    });
    assertEquals(codeOf(unknown.reply), "conflict");
    const opened = await grantViaApproval(world, a, {
      kind: "agent.commands",
      commands: ["task.list"],
    });
    assertEquals(opened.reply.status, 200, JSON.stringify(opened.reply.body));
    const after = await listGrants(world, { app: a });
    assertEquals(after.length, 3);
    assertEquals(
      effective(a, declarations, after, { [b]: ["report.read"] })
        .agent_commands,
      ["task.list"],
    );
    // 사람이 연 agent 허락을 회수해도 app.call·net grant는 그대로다.
    const agentGrant = after.find((g) => g.kind === "agent.commands")!;
    const revoked = await revoke(world, agentGrant);
    assertEquals(revoked.status, 200, JSON.stringify(revoked.body));
    const rest = await listGrants(world, { app: a, status: "active" });
    assertEquals(rest.map((g) => g.kind).sort(), ["app.call", "net.fetch"]);
  } finally {
    await world.harness.close();
  }
});

Deno.test("apps/releases#R13: 앱에 activation이 진행 중이면 grant.create와 grant.revoke가 conflict다", async () => {
  const world = await open();
  try {
    const app = await createApp(world, "usage");
    const scope: GrantPermissionScope = { kind: "net.fetch", ...NET };
    assertEquals(
      (await grantViaApproval(world, app, scope)).reply.status,
      200,
    );
    const existing = await onlyGrant(world, app);

    const started = await activation(world, app, "start");
    const other: GrantPermissionScope = {
      kind: "net.fetch",
      host: "other.example.com",
      port: 443,
    };
    const blocked = await grantViaApproval(world, app, other);
    assertEquals(codeOf(blocked.reply), "conflict");
    assertEquals(codeOf(await revoke(world, existing)), "conflict");
    assertEquals((await listGrants(world, { app })).length, 1);
    assertEquals((await listGrants(world, { app }))[0].status, "active");

    // 다른 앱은 막지 않는다.
    const unrelated = await createApp(world, "unrelated");
    assertEquals(
      (await grantViaApproval(world, unrelated, scope)).reply.status,
      200,
    );

    // 실패로 끝나면 풀린다.
    await activation(world, app, "fail", started);
    const retried = await grantViaApproval(world, app, other);
    assertEquals(retried.reply.status, 200, JSON.stringify(retried.reply.body));
    // 성공으로 끝나도 풀린다.
    const second = await activation(world, app, "start");
    assertEquals(codeOf(await revoke(world, existing)), "conflict");
    await activation(world, app, "succeed", second);
    assertEquals((await revoke(world, existing)).status, 200);
  } finally {
    await world.harness.close();
  }
});

Deno.test("apps/permissions#R21: revoke는 종료 확인 근거가 있어야 revoked로 확정하고 확인 전에는 grant가 active다", async () => {
  const world = await open();
  try {
    const app = await createApp(world, "usage");
    assertEquals(
      (await grantViaApproval(world, app, { kind: "net.fetch", ...NET })).reply
        .status,
      200,
    );
    const grant = await onlyGrant(world, app);
    await startProcess(world, app, "nonce-1");

    // confirmation window를 지나지 않은 회수는 handler 전에 거절된다.
    const unconfirmed = await revoke(world, grant, {}, { handle: false });
    assert(unconfirmed.status >= 400);
    assertEquals((await onlyGrant(world, app)).status, "active");
    // 살아 있는 프로세스의 종료 확인이 없으면 회수 완료가 아니다.
    assertEquals(codeOf(await revoke(world, grant)), "unavailable");
    // 다른 nonce의 확인은 이 프로세스의 종료 근거가 아니다.
    assertEquals(
      codeOf(await revoke(world, grant, { nonce: "other", confirmed: true })),
      "unavailable",
    );
    assertEquals((await onlyGrant(world, app)).status, "active");
    assertEquals(grantEvents(world, "GrantRevoked"), 0);

    // 현재 프로세스의 종료 확인이 있으면 revoked로 확정한다.
    const done = await revoke(world, grant, {
      nonce: "nonce-1",
      confirmed: true,
    });
    assertEquals(done.status, 200, JSON.stringify(done.body));
    const revoked = await onlyGrant(world, app);
    assertEquals(revoked.status, "revoked");
    assertEquals(revoked.revoked_by, "user");
    assert(revoked.revoked_at !== null);
    assertEquals(grantEvents(world, "GrantRevoked"), 1);
    // revoked는 되살리지 않는다. 다시 회수도 거절한다.
    assertEquals(codeOf(await revoke(world, grant)), "conflict");
  } finally {
    await world.harness.close();
  }
});

Deno.test("apps/permissions#R21: 이미 멈춘 앱은 별도 종료 확인 없이 회수되고 새로 시작한 프로세스는 다시 확인이 필요하다", async () => {
  const world = await open();
  try {
    const app = await createApp(world, "usage");
    for (const host of ["a.example.com", "b.example.com"]) {
      const applied = await grantViaApproval(world, app, {
        kind: "net.fetch",
        host,
        port: 443,
      });
      assertEquals(
        applied.reply.status,
        200,
        JSON.stringify(applied.reply.body),
      );
    }
    const [first, second] = await listGrants(world, { app });
    // 프로세스를 한 번도 시작하지 않았으면 이미 멈춘 것이다.
    assertEquals((await revoke(world, first)).status, 200);

    await startProcess(world, app, "n1");
    await stopProcess(world, app, "n1");
    await startProcess(world, app, "n2");
    // n1의 종료 확인은 지금 프로세스(n2)에 대한 근거가 아니다.
    assertEquals(
      codeOf(await revoke(world, second, { nonce: "n1", confirmed: true })),
      "unavailable",
    );
    await stopProcess(world, app, "n2");
    assertEquals((await revoke(world, second)).status, 200);
  } finally {
    await world.harness.close();
  }
});

Deno.test("apps/automations#R13: automation.run grant는 현재 external automation 선언과 정확히 같을 때만 만들고 끄는 데 프로세스 종료가 필요 없다", async () => {
  const world = await open();
  try {
    const app = await createApp(world, "usage");
    const when = { kind: "interval", interval_ms: 3_600_000 } as const;
    const scope: GrantPermissionScope = {
      kind: "automation.run",
      automation: "sync",
      command: "usage.sync",
      input_hash: HASH,
      when,
    };
    const declarations = declared({
      automations: [
        {
          key: "sync",
          command: "usage.sync",
          external: true,
          input_hash: HASH,
          when,
        },
        {
          key: "local",
          command: "usage.tidy",
          external: false,
          input_hash: HASH,
          when,
        },
      ],
    });
    await declare(world, app, declarations);
    // 입력 지문·주기·내부 automation이 다르면 거절한다.
    for (
      const wrong of [
        { ...scope, input_hash: "cd".repeat(32) },
        { ...scope, when: { kind: "interval", interval_ms: 60_000 } },
        { ...scope, automation: "local", command: "usage.tidy" },
      ] as GrantPermissionScope[]
    ) {
      assertEquals(
        codeOf((await grantViaApproval(world, app, wrong)).reply),
        "conflict",
      );
    }
    assertEquals(await listGrants(world, { app }), []);
    const applied = await grantViaApproval(world, app, scope);
    assertEquals(applied.reply.status, 200, JSON.stringify(applied.reply.body));
    const grants = await listGrants(world, { app, status: "active" });
    assertEquals(effective(app, declarations, grants).automations.length, 1);

    // 프로세스가 살아 있어도 끄기는 종료 확인 없이 된다(다음 회차부터 막힘).
    await startProcess(world, app, "n1");
    const off = await revoke(world, grants[0]);
    assertEquals(off.status, 200, JSON.stringify(off.body));
    const after = await listGrants(world, { app, status: "active" });
    assertEquals(effective(app, declarations, after).automations, []);
  } finally {
    await world.harness.close();
  }
});

Deno.test("apps/permissions#R5: 정규화되지 않은 scope와 source를 감싸는 경로는 grant로 만들지 않는다", async () => {
  const world = await open();
  try {
    const app = await createApp(world, "usage");
    const source = "/srv/lophn-test/source/usage";
    const revision = inspect(
      world.harness,
      "SELECT revision FROM apps WHERE id = ?",
      [app],
    )[0]["revision"];
    const connected = await call(
      world.harness,
      "apps/connect_source",
      world.user.token,
      command({ app, source_path: source }, {
        compare: { base_revision: String(revision) },
      }),
    );
    assertEquals(connected.status, 200, JSON.stringify(connected.body));
    const cases: [GrantPermissionScope, string][] = [
      [
        { kind: "net.fetch", host: "API.Example.com", port: 443 },
        "invalid_input",
      ],
      [
        { kind: "fs.read", path: "/srv/data/", recursive: true },
        "invalid_input",
      ],
      [
        { kind: "fs.read", path: "/srv//data", recursive: true },
        "invalid_input",
      ],
      // source 안 경로와 source를 감싸는 부모 경로.
      [
        { kind: "fs.read", path: `${source}/src`, recursive: true },
        "forbidden",
      ],
      [
        { kind: "fs.write", path: "/srv/lophn-test", recursive: true },
        "forbidden",
      ],
    ];
    for (const [scope, code] of cases) {
      assertEquals(
        codeOf((await grantViaApproval(world, app, scope)).reply),
        code,
        JSON.stringify(scope),
      );
    }
    assertEquals(await listGrants(world, { app }), []);
    // source와 무관한 경로는 허락할 수 있다.
    const fine = await grantViaApproval(world, app, {
      kind: "fs.write",
      path: "/srv/lophn-test/exports",
      recursive: true,
    });
    assertEquals(fine.reply.status, 200, JSON.stringify(fine.reply.body));
  } finally {
    await world.harness.close();
  }
});

Deno.test("apps/permissions#R26: 현재 release 선언이 없으면 선언 비교가 필요한 grant를 만들지 않는다", async () => {
  const world = await open(false);
  try {
    const a = await createApp(world, "caller");
    const b = await createApp(world, "target");
    const applied = await grantViaApproval(world, a, {
      kind: "app.call",
      app: b,
      commands: ["report.read"],
    });
    assertEquals(codeOf(applied.reply), "conflict");
    assertEquals(await listGrants(world), []);
    // 선언을 비교하지 않는 net.fetch는 approval만으로 만들어진다(R1).
    const net = await grantViaApproval(world, a, { kind: "net.fetch", ...NET });
    assertEquals(net.reply.status, 200, JSON.stringify(net.reply.body));
  } finally {
    await world.harness.close();
  }
});

Deno.test("apps/permissions#R1: 범위 밖 앱의 grant는 없는 앱과 같은 답이고 목록에 나오지 않는다", async () => {
  const world = await open();
  try {
    const mine = await createApp(world, "mine");
    const theirs = await createApp(world, "theirs");
    for (const app of [mine, theirs]) {
      assertEquals(
        (await grantViaApproval(world, app, { kind: "net.fetch", ...NET }))
          .reply.status,
        200,
      );
    }
    const scoped = await login(world.harness, "user", ["grants.list"], {
      app: mine,
    });
    assertEquals((await listGrants(world, {}, scoped)).map((g) => g.app), [
      mine,
    ]);
    const hidden = await call(world.harness, "grants/list", scoped.token, {
      app: theirs,
    });
    const absent = await call(world.harness, "grants/list", scoped.token, {
      app: "app_01h455vb4pex5v6nkc6gd5fdz9",
    });
    assertEquals(codeOf(hidden), codeOf(absent));
    assertEquals(hidden.status, absent.status);
    assertEquals(hidden.body, absent.body);
  } finally {
    await world.harness.close();
  }
});

Deno.test("apps/permissions#R1: grants.list는 상태 조건이 다른 cursor를 거절하고 같은 조건이면 이어 읽는다", async () => {
  const world = await open();
  try {
    const app = await createApp(world, "usage");
    for (const port of [443, 8443, 9443]) {
      const applied = await grantViaApproval(world, app, {
        kind: "net.fetch",
        host: "api.example.com",
        port,
      });
      assertEquals(
        applied.reply.status,
        200,
        JSON.stringify(applied.reply.body),
      );
    }
    const first = await call(world.harness, "grants/list", world.user.token, {
      app,
      limit: 2,
    });
    assertEquals(first.status, 200, JSON.stringify(first.body));
    assertEquals((first.body["grants"] as unknown[]).length, 2);
    const cursor = first.body["next_cursor"] as string;
    assert(cursor !== null);
    const rest = await call(world.harness, "grants/list", world.user.token, {
      app,
      limit: 2,
      cursor,
    });
    assertEquals((rest.body["grants"] as unknown[]).length, 1);
    const wrong = await call(world.harness, "grants/list", world.user.token, {
      app,
      limit: 2,
      cursor,
      status: "revoked",
    });
    assertEquals(codeOf(wrong), "invalid_input");
  } finally {
    await world.harness.close();
  }
});
