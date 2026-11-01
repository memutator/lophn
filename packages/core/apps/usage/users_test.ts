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
import { appToolUsers } from "./users.ts";

const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzza";
const DOMAINS: Record<string, string> = {
  alpha: "dom_alpha",
  beta: "dom_beta",
};

const tool = (name: string, domain: string) => ({
  name,
  description: name,
  inputSchema: null,
  effect: "read",
  public: true,
  domain,
});

test("사용 관계는 자기 domain의 사용을 세지 않고, 고른 domain이 하나인 agent는 그 domain만 쓰는 쪽으로 센다", () => {
  const db = new DatabaseSync(":memory:");
  for (const step of [...appsSchemaSteps, ...releasesSchemaSteps]) {
    db.exec(step.sql);
  }
  db.exec(
    `CREATE TABLE invocations (app TEXT, caller_kind TEXT, operation TEXT, session TEXT)`,
  );
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
    JSON.stringify({ commands: [tool("a", "alpha"), tool("b", "beta")] }),
    {} as never,
  );
  db.prepare(
    "UPDATE releases SET status = 'active', activated_at = ? WHERE id = ?",
  ).run(record.created_at, record.id);

  // 사람이 만든 agent는 alpha만 골랐고(그 port 규칙은 wiring이 갖는다), lophn은 beta를 맡는다.
  const reviewer = "agt_01hzzzzzzzzzzzzzzzzzzzzzza";
  const manager = "lophn";
  const assigned = (id: string) => ({
    id,
    name: id,
    domains: [],
    skip: false,
    apps: ["slug"],
    deny: [],
  });
  installPlaceEnvironment({
    deps: () =>
      ({
        agents: {
          agent: () => null,
          agents: () => [assigned(reviewer), assigned(manager)],
        },
      }) as never,
  });
  const ports: UsagePorts = {
    sessionDomains: () => null,
    agentDomains: () => [],
    chosenDomains: (agent) =>
      agent === reviewer ? ["dom_alpha"] : ["dom_beta"],
    domainOf: (_app, name) => DOMAINS[name] ?? null,
  };

  const users = appToolUsers(sql, ports, APP);
  if (!users.ok) throw new Error(JSON.stringify(users.error));
  // a(alpha)는 beta를 맡은 lophn이, b(beta)는 alpha를 고른 agent가 쓴다. 자기 domain의 사용은 없다.
  assert.deepStrictEqual(
    users.ok && users.value.map((u) => `${u.tool}:${u.domain}`),
    ["a:dom_beta", "b:dom_alpha"],
  );
});
