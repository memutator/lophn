import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { ReleaseRecord } from "../../../protocol/apps/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import { installPlaceEnvironment } from "../../lophn-agent/places/mod.ts";
import { appsSchemaSteps } from "../registration/schema.ts";
import { releasesSchemaSteps } from "../releases/schema.ts";
import { insertRelease } from "../releases/store.ts";
import type { UsagePorts } from "./ports.ts";

type UsageSession = NonNullable<ReturnType<UsagePorts["sessionPlace"]>>;
import { appToolUsers } from "./users.ts";

const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzza";
const tool = (name: string, isPublic = true) => ({
  name,
  description: name,
  inputSchema: null,
  effect: "read",
  public: isPublic,
});

test("사용 관계는 그 앱 자신의 place와 home의 사용을 세지 않고, 할당받은 agent의 place와 부른 session의 place를 쓰는 쪽으로 센다", () => {
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

  const reviewer = "agt_01hzzzzzzzzzzzzzzzzzzzzzza";
  const assigned = (id: string, deny: string[] = []) => ({
    id,
    name: id,
    domains: [],
    skip: false,
    apps: ["slug"],
    deny,
  });
  installPlaceEnvironment({
    deps: () =>
      ({
        agents: {
          agent: () => null,
          // reviewer는 b를 뺐다.
          agents: () => [assigned(reviewer, ["lophn(slug b)"])],
        },
      }) as never,
  });
  const PROJECT = { kind: "project", id: "prj_1" } as const;
  const places: Record<string, UsageSession> = {
    ses_project: { place: PROJECT },
    ses_home: { place: null },
    ses_self: { place: { kind: "app", id: APP } },
  };
  const ports: UsagePorts = {
    sessionPlace: (session) => places[session] ?? null,
    agentPlaces: () => [PROJECT, { kind: "app", id: APP }],
  };

  const users = appToolUsers(sql, ports, APP);
  if (!users.ok) throw new Error(JSON.stringify(users.error));
  // 공개 tool a는 project의 호출과 reviewer의 할당으로, b는 뺐으니 할당으로 세지 않는다. 비공개 c, home, 앱 자신은 세지 않는다.
  assert.deepStrictEqual(
    users.value.map((u) => `${u.tool}:${u.place.kind}:${u.source}`),
    ["a:project:grant", "a:project:invocation"],
  );
});
