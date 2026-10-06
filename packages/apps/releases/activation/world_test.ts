// activation 시험이 같이 쓰는 준비다(`activation_test.ts`, `recovery_test.ts`). 실제 core(임시 LOPHN_HOME)의
// HTTP route만 쓰고 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import {
  actionOf,
  call,
  command,
  createInput,
  decide,
  inspect,
  type Reply,
} from "../../../../apps/core/testing/approvals-fixture.ts";
import {
  type CoreHarness,
  createCoreHarness,
} from "../../../../apps/core/testing/core.ts";
import type { AuthenticatedContext } from "../../../contracts/platform/mod.ts";
import {
  blueprint,
  command as declared,
  prepareInput,
} from "../testing/mod.ts";

const MACHINE = [
  "create_approval_request",
  "apply_approved_action",
  "release.prepare",
  "release.start_activation",
  "releases.tests.add_verification",
  "releases.tests.adopt",
  "release.record_backup",
  "release.record_data_change",
  "release.record_data_restore",
  "release.complete_activation",
  "release.fail_activation",
  "grant.create",
  "grants.list",
  "releases.get",
  "GetApproval",
];
const USER = [
  "app.create",
  "app.get",
  "releases.get",
  "grant_approval_request",
  "GetApproval",
];

export type Login = { token: string; context: AuthenticatedContext };
export type World = {
  harness: CoreHarness;
  user: Login;
  machine: Login;
  app: string;
  next: number;
};

async function login(
  harness: CoreHarness,
  actor: "user" | "machine",
  operations: string[],
): Promise<Login> {
  const issued = await harness.credential({
    actor,
    principal: `${actor}-${operations.length}`,
    scope: { operations, targets: {} },
    conditions: {},
  });
  assert(issued.ok, issued.ok ? "" : issued.error.message);
  return issued.value;
}

export async function open(): Promise<World> {
  const documents = await import("../../../../apps/core/documents.ts");
  const apps = await import("../../../../apps/core/apps.ts");
  const fixtures = await import("../testing/mod.ts");
  const opened = await createCoreHarness({
    io: true,
    teams: [
      { createLedgerRegistration: documents.createLedgerRegistration },
      { createLedgerRegistration: apps.createLedgerRegistration },
      { createLedgerRegistration: fixtures.createLedgerRegistration },
    ],
    teamModules: [
      new URL("../../../../apps/core/documents.ts", import.meta.url).href,
      new URL("../../../../apps/core/apps.ts", import.meta.url).href,
      new URL("../testing/mod.ts", import.meta.url).href,
    ],
  });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  const harness = opened.value;
  const user = await login(harness, "user", USER);
  const machine = await login(harness, "machine", MACHINE);
  const created = await call(
    harness,
    "apps/create",
    user.token,
    command({ slug: "calendar", name: "Old name", description: "old words" }),
  );
  assertEquals(created.status, 200, JSON.stringify(created.body));
  return { harness, user, machine, app: String(created.body["id"]), next: 1 };
}

let counter = 0;

export function approvalId(world: World): string {
  const suffix = String(world.next++).padStart(2, "0");
  return `apr_01h455vb4pex5v6nkc6gd5fd${suffix}`;
}

// 같은 bundle hash의 통과한 test와 함께 준비한 release다. blueprint 설명이 다르면 hash도 다르다.
export async function prepare(
  world: World,
  over: Record<string, unknown> = {},
  changes: Record<string, unknown> = {},
): Promise<string> {
  counter += 1;
  const verification = `vrf_01h455vb4pex5v6nkc6gd5f${
    String(counter).padStart(3, "0")
  }`;
  const input = {
    ...prepareInput(
      blueprint({
        name: "Calendar app",
        description: `Keeps one calendar ${counter}`,
        commands: [declared("list")],
        ...changes,
      }),
      over,
    ),
    app: world.app,
    tests: [verification],
    key: `prepare-key-${String(counter).padStart(4, "0")}`,
  };
  const stored = await call(
    world.harness,
    "releases_tests/add_verification",
    world.machine.token,
    command({
      id: verification,
      app: world.app,
      kind: "app_test",
      result: "pass",
      bundle_hash: String(input.bundle_hash),
    }),
  );
  assertEquals(stored.status, 200, JSON.stringify(stored.body));
  const prepared = await call(
    world.harness,
    "releases/prepare",
    world.machine.token,
    command(input),
  );
  assertEquals(prepared.status, 200, JSON.stringify(prepared.body));
  return String((prepared.body["release"] as { id: string }).id);
}

export function grantsSeq(world: World): number {
  const rows = inspect(
    world.harness,
    `SELECT COALESCE(MAX(e.seq), 0) AS n FROM events e
     JOIN grants g ON g.id = e.subject
     WHERE g.app = ? AND e.type IN ('GrantCreated', 'GrantRevoked')`,
    [world.app],
  );
  return Number(rows[0]["n"]);
}

export function activeOf(world: World): string | null {
  const rows = inspect(
    world.harness,
    "SELECT active_release FROM apps WHERE id = ?",
    [world.app],
  );
  return rows[0]["active_release"] as string | null;
}

export type StartOptions = {
  previous?: string | null;
  seq?: number;
  schema?: number;
  // 사람이 허락하지 않는다.
  undecided?: boolean;
  // approval이 가리키는 대상 release를 바꾼다.
  target?: string;
  // 허락·적용 사이에 하는 일.
  between?: () => Promise<void>;
  approval?: string;
};

export type Started = { approval: string; reply: Reply; action: unknown };

// 정확한 approval을 만들고 사람이 허락한 뒤 적용한다. release.start_activation의 유일한 정상 경로다.
export async function start(
  world: World,
  release: string,
  options: StartOptions = {},
): Promise<Started> {
  const approval = options.approval ?? approvalId(world);
  const input = {
    release,
    approval,
    previous_release: options.previous === undefined
      ? activeOf(world)
      : options.previous,
    expected_grants_seq: options.seq ?? grantsSeq(world),
    expected_schema: options.schema ?? 0,
    key: `start-${approval}`,
  };
  const action = await actionOf({
    concern: "apps/releases",
    command: "release.start_activation",
    caller: "machine",
    targets: [options.target ?? release],
    value: input as never,
    comparison: {},
  });
  if (options.approval === undefined) {
    const created = await call(
      world.harness,
      "approvals/create",
      world.machine.token,
      command(
        await createInput(approval, world.machine.context.actor, action),
      ),
    );
    assertEquals(created.status, 200, JSON.stringify(created.body));
    if (options.undecided !== true) {
      const decided = await decide(
        world.harness,
        world.user.token,
        created.body["request"] as never,
        "grant",
      );
      assertEquals(decided.status, 200, JSON.stringify(decided.body));
    }
  }
  await options.between?.();
  const reply = await call(
    world.harness,
    "approvals/apply",
    world.machine.token,
    command({ approval, action, idempotency_key: `apply-${approval}` }),
  );
  return { approval, reply, action };
}

export function startedSeq(reply: Reply): string {
  const use = reply.body["use"] as { accepted_seq: string };
  return use.accepted_seq;
}

export function releaseRow(
  world: World,
  release: string,
): Record<string, unknown> {
  return inspect(
    world.harness,
    "SELECT status, activation, failure FROM releases WHERE id = ?",
    [release],
  )[0];
}

export function statusOf(world: World, release: string): string {
  return String(releaseRow(world, release)["status"]);
}

export function events(world: World, type: string): Record<string, unknown>[] {
  return inspect(
    world.harness,
    "SELECT seq, subject, payload FROM events WHERE type = ? ORDER BY seq",
    [type],
  );
}

// 새 업무 통로를 열 수 있는 준비 확인이다.
export function ready(
  release: string,
  bundleHash: string,
  over: Record<string, unknown> = {},
) {
  return {
    release,
    bundle_hash: bundleHash,
    commands: ["list"],
    data_schema: 0,
    process_nonce: "nonce-1",
    connection_ok: true,
    ...over,
  };
}

export function bundleOf(world: World, release: string): string {
  return String(
    inspect(world.harness, "SELECT bundle_hash FROM releases WHERE id = ?", [
      release,
    ])[0]["bundle_hash"],
  );
}

export async function complete(
  world: World,
  release: string,
  seq: string,
  options: {
    schema?: number;
    invocation?: string | null;
    attestation?: Record<string, unknown>;
  } = {},
): Promise<Reply> {
  const schema = options.schema ?? 0;
  return await call(
    world.harness,
    "releases/complete_activation",
    world.machine.token,
    command({
      release,
      started_seq: seq,
      result: {
        release,
        activation_seq: seq,
        invocation: options.invocation ?? null,
        data_schema: schema,
        integrity_ok: true,
      },
      attestation: ready(release, bundleOf(world, release), {
        data_schema: schema,
        ...options.attestation,
      }),
    }),
  );
}

export async function grantNetwork(world: World): Promise<Reply> {
  const approval = approvalId(world);
  const scope = { kind: "net.fetch", host: "api.example.com", port: 443 };
  const input = { app: world.app, kind: scope.kind, scope, approval };
  const action = await actionOf({
    concern: "apps/permissions",
    command: "grant.create",
    caller: "machine",
    targets: [world.app],
    value: input as never,
    comparison: { grants_seq: String(grantsSeq(world)) },
  });
  const created = await call(
    world.harness,
    "approvals/create",
    world.machine.token,
    command(await createInput(approval, world.machine.context.actor, action)),
  );
  assertEquals(created.status, 200, JSON.stringify(created.body));
  const decided = await decide(
    world.harness,
    world.user.token,
    created.body["request"] as never,
    "grant",
  );
  assertEquals(decided.status, 200, JSON.stringify(decided.body));
  return await call(
    world.harness,
    "approvals/apply",
    world.machine.token,
    command({ approval, action, idempotency_key: `apply-${approval}` }),
  );
}

export async function withWorld(
  run: (world: World) => Promise<void>,
): Promise<void> {
  const world = await open();
  try {
    await run(world);
  } finally {
    await world.harness.close();
  }
}

// backup byte를 보호 blob으로 준비하고(실제 I/O worker가 저장한다) `release.record_backup`으로 확정한다.
// 준비 주체는 이 machine 자격과 같아야 등록된다.
export async function recordBackup(
  world: World,
  release: string,
  seq: string,
  schema: number,
  content: string,
): Promise<{ reply: Reply; hash: string; size: number }> {
  const bytes = new TextEncoder().encode(content);
  const prepared = await world.harness.prepareBlob({
    principal: world.machine.context.principal,
    purpose: "app_backup",
    bytes: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  });
  assert(prepared.ok, prepared.ok ? "" : prepared.error.message);
  const reply = await call(
    world.harness,
    "releases/record_backup",
    world.machine.token,
    command({
      release,
      activation_seq: seq,
      backup_hash: prepared.value.hash,
      blob: prepared.value,
      data_schema: schema,
    }),
  );
  return { reply, hash: prepared.value.hash, size: bytes.length };
}
