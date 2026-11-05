import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { ReleaseRecord } from "../../../protocol/apps/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import { appsSchemaSteps } from "../registration/schema.ts";
import { releasesSchemaSteps } from "../releases/schema.ts";
import { insertRelease } from "../releases/store.ts";
import type { UsagePorts } from "./ports.ts";
import { appToolUsers } from "./users.ts";

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
