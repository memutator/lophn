import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { ReleaseRecord } from "../../../protocol/apps/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import { callAllowed } from "../calls/gate.ts";
import { appsSchemaSteps } from "../registration/schema.ts";
import { releasesSchemaSteps } from "../releases/schema.ts";
import { insertRelease } from "../releases/store.ts";
import type { UsagePorts } from "./ports.ts";
import { agentAssignment, appToolUsers } from "./users.ts";

type UsageSession = NonNullable<ReturnType<UsagePorts["sessionWorkspace"]>>;

const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzza";
const tool = (name: string, isPublic = true) => ({
  name,
  description: name,
  inputSchema: null,
  effect: "read",
  public: isPublic,
});

test("사용 관계는 그 앱 자신의 workspace와 home의 사용을 세지 않고, 부른 session의 workspace를 쓰는 쪽으로 센다", () => {
  const db = new DatabaseSync(":memory:");
  for (const step of [...appsSchemaSteps, ...releasesSchemaSteps]) {
    db.exec(step.sql);
  }
  db.exec(
    `CREATE TABLE invocations (app TEXT, caller_kind TEXT, operation TEXT, session TEXT)`,
  );
  const call = db.prepare(
    `INSERT INTO invocations VALUES (?, 'agent', '{"kind":"command","name":"a"}', ?)`,
  );
  call.run(APP, "ses_project");
  call.run(APP, "ses_home");
  call.run(APP, "ses_self");
  db.prepare(
    `INSERT INTO apps VALUES (?, 'slug', 'n', 'd', NULL, NULL, NULL, 1, '1', 'active')`,
  ).run(APP);
  const sql = {
    run: (text: string, params: never[]) => db.prepare(text).run(...params),
    get: (text: string, params: never[]) =>
      db.prepare(text).get(...params) as Record<string, never> | undefined,
    all: (text: string, params: never[]) =>
      db.prepare(text).all(...params) as Record<string, never>[],
  };
  const tx = { sql } as unknown as Tx;
  const record = {
    id: "rel_01hzzzzzzzzzzzzzzzzzzzzzz1",
    app: APP,
    number: 1,
    code_commit: "0".repeat(40),
    bundle_hash: "0".repeat(64),
    declaration_hash: "0".repeat(64),
    data_schema: 1,
    data_changes: [],
    created_by: "agent:ses_01hzzzzzzzzzzzzzzzzzzzzzza",
    created_at: "2026-10-16T00:00:00.000Z",
    status: "prepared",
  } as unknown as ReleaseRecord;
  insertRelease(
    tx,
    record,
    JSON.stringify({ commands: [tool("a"), tool("b"), tool("c", false)] }),
    {} as never,
  );
  db.prepare(
    "UPDATE releases SET status = 'active', activated_at = ? WHERE id = ?",
  ).run(record.created_at, record.id);

  const PROJECT = { kind: "project", id: "prj_1" } as const;
  const workspaces: Record<string, UsageSession> = {
    ses_project: { workspace: PROJECT },
    ses_home: { workspace: null },
    ses_self: { workspace: { kind: "app", id: APP } },
  };
  const ports: UsagePorts = {
    sessionWorkspace: (session) => workspaces[session] ?? null,
  };

  const users = appToolUsers(sql, ports, APP);
  if (!users.ok) throw new Error(JSON.stringify(users.error));
  // project의 호출만 센다. home과 앱 자신의 workspace는 세지 않는다.
  assert.deepStrictEqual(
    users.value.map((u) => `${u.tool}:${u.workspace.kind}`),
    ["a:project"],
  );
});

test("appToolUsers는 정적 선언(활성 앱 app_connections, job tool_run)과 과거 호출을 중복 없이 합치고 보관 앱은 뺀다", () => {
  const db = new DatabaseSync(":memory:");
  for (const step of [...appsSchemaSteps, ...releasesSchemaSteps]) {
    db.exec(step.sql);
  }
  db.exec(
    `CREATE TABLE invocations (app TEXT, caller_kind TEXT, operation TEXT, session TEXT)`,
  );
  const CONSUMER = "app_01hzzzzzzzzzzzzzzzzzzzzzzb";
  const ARCHIVED = "app_01hzzzzzzzzzzzzzzzzzzzzzzc";
  const PROJECT_A = {
    kind: "project",
    id: "prj_01hzzzzzzzzzzzzzzzzzzzzzza",
  } as const;
  const PROJECT_B = {
    kind: "project",
    id: "prj_01hzzzzzzzzzzzzzzzzzzzzzzb",
  } as const;

  for (const [id, slug, status] of [
    [APP, "target", "active"],
    [CONSUMER, "consumer", "active"],
    [ARCHIVED, "oldapp", "archived"],
  ]) {
    db.prepare(
      `INSERT INTO apps VALUES (?, ?, ?, 'd', NULL, NULL, NULL, ?, '1', ?)`,
    ).run(id, slug, slug, status === "archived" ? 0 : 1, status);
  }
  const sql = {
    run: (text: string, params: never[]) => db.prepare(text).run(...params),
    get: (text: string, params: never[]) =>
      db.prepare(text).get(...params) as Record<string, never> | undefined,
    all: (text: string, params: never[]) =>
      db.prepare(text).all(...params) as Record<string, never>[],
  };
  const tx = { sql } as unknown as Tx;
  const putActive = (appId: string, relId: string, declaration: unknown) => {
    const rec = {
      id: relId,
      app: appId,
      number: 1,
      code_commit: "0".repeat(40),
      bundle_hash: "0".repeat(64),
      declaration_hash: "0".repeat(64),
      data_schema: 1,
      data_changes: [],
      created_by: "agent:ses_01hzzzzzzzzzzzzzzzzzzzzzza",
      created_at: "2026-10-16T00:00:00.000Z",
      status: "prepared",
    } as unknown as ReleaseRecord;
    insertRelease(tx, rec, JSON.stringify(declaration), {} as never);
    db.prepare(
      "UPDATE releases SET status = 'active', activated_at = ? WHERE id = ?",
    ).run(rec.created_at, rec.id);
  };

  putActive(APP, "rel_01hzzzzzzzzzzzzzzzzzzzzzz1", {
    commands: [tool("a"), tool("b")],
    app_connections: [],
  });
  putActive(CONSUMER, "rel_01hzzzzzzzzzzzzzzzzzzzzzz2", {
    commands: [],
    app_connections: [
      { app: APP, commands: ["b", "a"], reason: "uses target" },
    ],
  });
  putActive(ARCHIVED, "rel_01hzzzzzzzzzzzzzzzzzzzzzz3", {
    commands: [],
    app_connections: [{ app: APP, commands: ["b"], reason: "archived" }],
  });

  db.prepare(
    `INSERT INTO invocations VALUES (?, 'agent', '{"kind":"command","name":"a"}', 'ses_prj_a')`,
  ).run(APP);

  const ports: UsagePorts = {
    sessionWorkspace: (session) =>
      session === "ses_prj_a" ? { workspace: PROJECT_A as never } : null,
    declaredToolUsers: () => [
      // duplicate with invocation
      { tool: "a", workspace: PROJECT_A as never },
      // new static job in project B
      { tool: "b", workspace: PROJECT_B as never },
      // home and self must be excluded from appToolUsers
      { tool: "a", workspace: null },
      { tool: "a", workspace: { kind: "app", id: APP as never } },
    ],
  };

  const users = appToolUsers(sql, ports, APP);
  if (!users.ok) throw new Error(JSON.stringify(users.error));
  assert.deepStrictEqual(
    users.value.map((u) => `${u.tool}:${u.workspace.kind}:${u.workspace.id}`),
    [
      `a:app:${CONSUMER}`,
      `a:project:${PROJECT_A.id}`,
      `b:app:${CONSUMER}`,
      `b:project:${PROJECT_B.id}`,
    ],
  );
});

// 앱 범위 agent는 자기 앱의 command를 할당 없이 부르고, 할당받지 않은 다른 앱의 command는 여전히 부를 수 없다.
test("앱 범위 agent는 자기 앱 command를 할당 없이 부르고 다른 앱 command는 할당이 있어야 부른다", async () => {
  const db = new DatabaseSync(":memory:");
  for (const step of [...appsSchemaSteps, ...releasesSchemaSteps]) {
    db.exec(step.sql);
  }
  const MINE = "app_01hzzzzzzzzzzzzzzzzzzzzzz1";
  const THEIRS = "app_01hzzzzzzzzzzzzzzzzzzzzzz2";
  for (const [id, slug] of [
    [MINE, "mine"],
    [THEIRS, "theirs"],
  ]) {
    db.prepare(
      `INSERT INTO apps VALUES (?, ?, 'n', 'd', NULL, NULL, NULL, 1, '1', 'active')`,
    ).run(id, slug);
  }
  const sql = {
    run: (text: string, params: never[]) => db.prepare(text).run(...params),
    get: (text: string, params: never[]) =>
      db.prepare(text).get(...params) as Record<string, never> | undefined,
    all: (text: string, params: never[]) =>
      db.prepare(text).all(...params) as Record<string, never>[],
  };
  const SCOPED = "agt_01hzzzzzzzzzzzzzzzzzzzzzz1" as never;
  let apps: string[] = [];
  const directory = {
    agent: () => ({
      id: SCOPED,
      handle: "helper",
      name: "helper",
      workspace: { kind: "app", id: MINE },
      skip: false,
      runtime: "lophn",
      apps,
      deny: [],
      remoteApps: [],
    }),
    agents: () => [],
    cardOf: () => null,
  } as never;
  const gate = {
    assignmentOf: (agent: never) => agentAssignment(sql, agent, directory),
    appGrantsOf: async () => ({ ok: true as const, value: [] }),
    isPrivate: () => false,
  };
  const call = (app: string) =>
    callAllowed(
      {
        kind: "agent",
        agent: SCOPED,
        workspace: { kind: "app", id: MINE },
        session: "ses_x" as never,
        remote: false,
        turn: "trn_x" as never,
        toolCall: "tcl_x" as never,
      },
      { app: app as never, tool: "add", effect: "write", public: false },
      gate,
    );
  assert.deepStrictEqual(await call(MINE), { ok: true, value: true });
  assert.deepStrictEqual(await call(THEIRS), { ok: true, value: false });
  apps = ["theirs"];
  assert.deepStrictEqual(await call(THEIRS), { ok: true, value: true });
});
