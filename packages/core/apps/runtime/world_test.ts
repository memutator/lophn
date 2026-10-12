// 시험 전용: 실제 core(임시 LOPHN_HOME)와 실제 앱 자식 프로세스로 connect·client를 보는
// 준비. mod.ts에서 내보내지 않는다. core의 supervisor 관측만 시험 출처로 바꿔 끼우고(자식이
// 이 폴더의 실제 앱 프로세스다), 그 밖은 제품 조립 그대로다. 사람 데이터 root는 열지 않는다.
import { DatabaseSync } from "node:sqlite";
import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../../base/mod.ts";
import type {
  AuthenticatedContext,
  CredentialConditions,
} from "../../../protocol/platform/mod.ts";
import {
  actionOf,
  call,
  command,
  createInput,
  decide,
  inspect,
  type Reply,
} from "../../../../apps/core/testing/approvals-fixture.ts";
import type { ApprovalRequest } from "../../../protocol/platform/mod.ts";
import type { GrantPermissionScope } from "../../../protocol/apps/mod.ts";
import {
  type CoreHarness,
  type CoreHarnessOptions,
  createCoreHarness,
} from "../../../../apps/core/testing/core.ts";
import type {
  ProcessObservation,
  ProcessQuery,
  ProcessSource,
} from "./connect.ts";
import {
  COMMANDS,
  FIXTURE_RELEASE,
  type FixtureApp,
  fixtureBlueprint,
  SCREENS,
  startFixtureApp,
} from "./testing/app-process.ts";

export { COMMANDS, SCREENS };

export type Login = { token: string; context: AuthenticatedContext };

// supervisor 관측의 시험 출처. 값은 실제 자식에서 만든 것이고 시험이 바꾼다.
export type SourceState = {
  live: ProcessObservation | undefined;
  preview: ProcessObservation | undefined;
  restarts: { app: string; nonce: string }[];
  // true면 supervisor에 닿지 못한 것처럼 답한다.
  down: boolean;
  // true면 재시작 요청이 supervisor에 닿지 못한다.
  failRestart: boolean;
};

function processSource(state: SourceState): ProcessSource {
  return {
    current(query: ProcessQuery) {
      if (state.down) {
        return Promise.resolve(
          err({ code: "unavailable", message: "supervisor is down" }),
        );
      }
      const found = query.mode === "live"
        ? state.live
        : state.preview?.processNonce === query.nonce
        ? state.preview
        : undefined;
      return Promise.resolve(
        ok(found !== undefined && found.app === query.app ? found : undefined),
      );
    },
    restart(app, nonce) {
      if (state.failRestart) {
        return Promise.resolve(
          err({ code: "unavailable", message: "supervisor is down" }),
        );
      }
      state.restarts.push({ app, nonce });
      return Promise.resolve(ok(undefined));
    },
  };
}

export type World = {
  harness: CoreHarness;
  user: Login;
  machine: Login;
  app: string;
  state: SourceState;
  children: FixtureApp[];
  // supervisor를 띄운 world의 앱 socket 폴더 자리.
  runtimeDir: string | undefined;
  login(
    actor: "user" | "machine" | "coding_agent" | "agent",
    operations: string[],
    options?: {
      targets?: Record<string, string>;
      conditions?: CredentialConditions;
    },
  ): Promise<Login>;
  // 실제 자식을 띄워 observation에 올린다. mode가 live면 probe·open까지 제어 경로로 마친다.
  start(options?: {
    mode?: "live" | "preview";
    ready?: boolean;
    // 다른 앱 자식 entry와 그 blueprint·command·화면으로 띄운다(기본은 이 폴더의 fixture app).
    fixture?: {
      blueprint: Record<string, unknown>;
      child: string;
      commands: string[];
      screens: ProcessObservation["screens"];
    };
  }): Promise<FixtureApp>;
  // 사람의 실행 허락과 release 채택을 ledger에 남긴다.
  allow(): Promise<void>;
  close(): Promise<void>;
};

export function observationOf(
  child: FixtureApp,
  overrides: Partial<ProcessObservation> = {},
): ProcessObservation {
  return {
    app: child.app,
    mode: child.mode,
    release: child.release,
    bundleHash: child.bundleHash,
    processNonce: child.nonce,
    endpoint: child.endpoint,
    ready: true,
    accepting: true,
    commands: COMMANDS,
    screens: SCREENS,
    ...overrides,
  };
}

export async function openWorld(
  options: {
    sweepMs?: number;
    // grant를 approval 적용으로 만들 때 켠다. approval 설명 글은 I/O worker가 준비한다.
    approvals?: boolean;
    // 실제 apps supervisor를 감독 pipe로 띄운다. 켜면 프로세스 관측 시험 출처를 쓰지 않는다.
    supervisor?: boolean;
    // preview가 bundle·release를 여는 자리(apps/preview 시험).
    previews?: NonNullable<CoreHarnessOptions["apps"]>["previews"];
    // 다른 concern의 통합 시험이 같은 world에 팀과 실제 coding credential을 더한다.
    extend?: {
      teams: NonNullable<CoreHarnessOptions["teams"]>;
      teamModules: readonly string[];
      coding?: CoreHarnessOptions["coding"];
    };
  } = {},
): Promise<World> {
  const documents = await import("../../../../apps/core/documents.ts");
  const apps = await import("../../../../apps/core/apps.ts");
  const fixtures = await import("./testing/mod.ts");
  const permissions = await import("../permissions/testing/mod.ts");
  const state: SourceState = {
    live: undefined,
    preview: undefined,
    restarts: [],
    down: false,
    failRestart: false,
  };
  const runtimeDir = options.supervisor
    ? await Deno.makeTempDir({ prefix: "lop-run-" })
    : undefined;
  const opened = await createCoreHarness({
    // 앱 자식은 실제 시각으로 연결 기한을 비교한다. core 시계도 지금에서 시작한다.
    nowMs: Date.now(),
    io: options.approvals === true,
    teams: [
      { createLedgerRegistration: documents.createLedgerRegistration },
      { createLedgerRegistration: apps.createLedgerRegistration },
      { createLedgerRegistration: fixtures.createLedgerRegistration },
      { createLedgerRegistration: permissions.createLedgerRegistration },
      ...(options.extend?.teams ?? []),
    ],
    ...(options.extend?.coding ? { coding: options.extend.coding } : {}),
    teamModules: [
      new URL("../../../../apps/core/documents.ts", import.meta.url).href,
      new URL("../../../../apps/core/apps.ts", import.meta.url).href,
      new URL("./testing/mod.ts", import.meta.url).href,
      new URL("../permissions/testing/mod.ts", import.meta.url).href,
      ...(options.extend?.teamModules ?? []),
    ],
    apps: options.supervisor
      ? {
        supervisor: { runtimeDir },
        sweepMs: options.sweepMs,
        previews: options.previews,
      }
      : {
        process: processSource(state),
        sweepMs: options.sweepMs,
        previews: options.previews,
      },
  });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  const harness = opened.value;
  try {
    return await buildWorld(harness, state, runtimeDir);
  } catch (thrown) {
    // 준비가 실패해도 띄운 core(와 앱 supervisor)를 남기지 않는다.
    await harness.close().catch(() => undefined);
    if (runtimeDir) {
      await Deno.remove(runtimeDir, { recursive: true }).catch(() => undefined);
    }
    throw thrown;
  }
}

async function buildWorld(
  harness: CoreHarness,
  state: SourceState,
  runtimeDir: string | undefined,
): Promise<World> {
  let sequence = 0;
  const login: World["login"] = async (actor, operations, extra = {}) => {
    sequence += 1;
    const issued = await harness.credential({
      actor,
      principal: `${actor}-${sequence}`,
      scope: { operations, targets: extra.targets ?? {} },
      conditions: extra.conditions ?? {},
    });
    assert(issued.ok, issued.ok ? "" : issued.error.message);
    return issued.value;
  };
  const user = await login("user", [
    "app.create",
    "app.enable_execution",
    "app.connect",
    "grants.list",
    "grant_approval_request",
    "GetApproval",
  ]);
  const machine = await login("machine", [
    "app.connect",
    "runtime.tests.adopt_release",
    "create_approval_request",
    "apply_approved_action",
    "grant.create",
    "grants.list",
    "GetApproval",
    "permissions.tests.set_declarations",
  ]);
  const created = await call(
    harness,
    "apps/create",
    user.token,
    command({ slug: "usage", name: "Usage", description: "usage app" }),
  );
  assertEquals(created.status, 200, JSON.stringify(created.body));
  const app = String(created.body["id"]);
  const revision = String(created.body["revision"]);
  const children: FixtureApp[] = [];
  const world: World = {
    harness,
    user,
    machine,
    app,
    state,
    children,
    runtimeDir,
    login,
    async allow() {
      const adopted = await call(
        harness,
        "runtime/adopt-release",
        machine.token,
        command({ app, release: FIXTURE_RELEASE }),
      );
      assertEquals(adopted.status, 200, JSON.stringify(adopted.body));
      const enabled: Reply = await call(
        harness,
        "apps/enable_execution",
        user.token,
        command({ app }, { compare: { base_revision: revision } }),
      );
      assertEquals(enabled.status, 200, JSON.stringify(enabled.body));
    },
    async start(startOptions = {}) {
      const mode = startOptions.mode ?? "live";
      const child = await startFixtureApp({
        verifyKey: harness.appsControl.verifyKey,
        app,
        mode,
        blueprint: startOptions.fixture?.blueprint ?? fixtureBlueprint(),
        child: startOptions.fixture?.child,
      });
      children.push(child);
      const observation = observationOf(child, {
        ready: startOptions.ready ?? true,
        accepting: startOptions.ready ?? true,
        ...(startOptions.fixture
          ? {
            commands: startOptions.fixture.commands,
            screens: startOptions.fixture.screens,
          }
          : {}),
      });
      if (mode === "live") state.live = observation;
      else state.preview = observation;
      if (startOptions.ready !== false) {
        // 제어 경로 그대로 probe와 open을 마친다(machine connection).
        await control(world, child, "/_lophn/control/probe", {
          process_nonce: child.nonce,
        });
        if (mode === "live") {
          await control(world, child, "/_lophn/control/open", {
            process_nonce: child.nonce,
            release: child.release,
          });
        }
      }
      return child;
    },
    async close() {
      for (const child of children) await child.stop();
      await harness.close();
      if (runtimeDir) {
        await Deno.remove(runtimeDir, { recursive: true }).catch(() =>
          undefined
        );
      }
    },
  };
  return world;
}

// machine credential로 core가 서명한 제어 connection을 받아 앱 control 경로를 부른다.
export async function control(
  world: World,
  child: FixtureApp,
  path: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const connected = await call(
    world.harness,
    "apps/connect",
    world.machine.token,
    {
      app: child.app,
      mode: child.mode,
      screens: ["control"],
      screen_sizes: {},
      commands: [],
      ...(child.mode === "preview" ? { preview_nonce: child.nonce } : {}),
    },
  );
  assertEquals(connected.status, 200, JSON.stringify(connected.body));
  return await direct(
    child.endpoint,
    "POST",
    path,
    authorizationOf(connected),
    body,
  );
}

export function authorizationOf(connected: Reply): string {
  return JSON.stringify({
    payload: connected.body["connection"],
    signature: connected.body["signature"],
  });
}

export async function direct(
  endpoint: string,
  method: "GET" | "POST",
  path: string,
  authorization: string | null,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const client = Deno.createHttpClient({
    proxy: { transport: "unix", path: endpoint },
  });
  try {
    const response = await fetch(`http://lophn.invalid${path}`, {
      client,
      method,
      headers: {
        ...(authorization === null ? {} : { authorization }),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    const json = response.headers.get("content-type")?.includes("json");
    return {
      status: response.status,
      body: text.length === 0 ? null : json ? JSON.parse(text) : text,
    };
  } finally {
    client.close();
  }
}

let approvals = 0;

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

// 현재 release의 선언을 시험 team이 낸다(releases 조립 전의 대역).
export async function declare(
  world: World,
  commands: readonly string[],
): Promise<void> {
  const stored = await call(
    world.harness,
    "permissions_tests/set_declarations",
    world.machine.token,
    command({
      app: world.app,
      declarations: {
        release: FIXTURE_RELEASE,
        permissions: [],
        app_connections: [],
        commands,
        automations: [],
      },
    }),
  );
  assertEquals(stored.status, 200, JSON.stringify(stored.body));
}

// 정확한 approval을 만들고 사람이 허락한 뒤 적용한다. grant.create의 유일한 정상 경로다.
export async function grant(
  world: World,
  scope: GrantPermissionScope,
): Promise<Reply> {
  approvals += 1;
  const approval = `apr_01h455vb4pex5v6nkc6gd5f${
    String(approvals).padStart(3, "0")
  }`.slice(0, 30);
  const input = { app: world.app, kind: scope.kind, scope, approval };
  const action = await actionOf({
    concern: "apps/permissions",
    command: "grant.create",
    caller: "machine",
    targets: [world.app],
    value: input as never,
    comparison: { grants_seq: grantsSeq(world, world.app) },
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
    created.body["request"] as ApprovalRequest,
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

// 시험 credential을 회수한다(ledger credential 기록의 상태). 이후 그 credential은 현재 자격이 아니다.
export function revokeCredential(world: World, login: Login): void {
  const db = new DatabaseSync(`${world.harness.dataRoot}/lophn.db`);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    db.prepare(
      "UPDATE credentials SET state = 'revoked' WHERE credential_ref = ?",
    ).run(login.context.credential_ref);
  } finally {
    db.close();
  }
}
