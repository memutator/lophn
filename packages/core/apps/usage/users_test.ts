import { assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import type { ReleaseRecord } from "../../../protocol/apps/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
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
  title: name,
  description: name,
  inputSchema: null,
  effect: "read",
  public: true,
  domain,
});

Deno.test("사용 관계는 자기 domain의 사용을 세지 않고, 고른 domain이 하나인 Operator는 그 domain만 쓰는 쪽으로 센다", () => {
  const db = new DatabaseSync(":memory:");
  for (const step of [...appsSchemaSteps, ...releasesSchemaSteps]) {
    db.exec(step.sql);
  }
  const grant = (agent: unknown) =>
    db.prepare("INSERT INTO agent_grants VALUES (?, ?)").run(
      JSON.stringify(agent),
      JSON.stringify([{ kind: "app", app: APP, apis: [] }]),
    );
  db.exec(`CREATE TABLE agent_grants (agent TEXT, entries TEXT);
    CREATE TABLE invocations (app TEXT, caller_kind TEXT, operation TEXT, session TEXT)`);
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
    blueprint_hash: "0".repeat(64),
    data_schema: 1,
    data_changes: [],
    tests: ["vrf_01hzzzzzzzzzzzzzzzzzzzzzza"],
    ticket_source: { ticket: "tkt_01hzzzzzzzzzzzzzzzzzzzzzza", claim_seq: "1" },
    created_by: "coding_agent:ses_01hzzzzzzzzzzzzzzzzzzzzzza",
    created_at: "2026-10-16T00:00:00.000Z",
    status: "prepared",
  } as unknown as ReleaseRecord;
  insertRelease(
    tx,
    record,
    JSON.stringify({ tools: [tool("a", "alpha"), tool("b", "beta")] }),
    {} as never,
  );
  db.prepare(
    "UPDATE releases SET status = 'active', activated_at = ? WHERE id = ?",
  ).run(record.created_at, record.id);

  // Operator는 정의에서 alpha만 골랐다(그 port 규칙은 wiring이 갖는다). PM은 beta를 맡는다.
  const operator = {
    role: "operator",
    agent: "agt_01hzzzzzzzzzzzzzzzzzzzzzza",
  };
  const manager = {
    role: "project_manager",
    project: "prj_01hzzzzzzzzzzzzzzzzzzzzzzb",
  };
  grant(operator);
  grant(manager);
  const ports: UsagePorts = {
    sessionDomains: () => null,
    agentDomains: (agent) =>
      agent.role === "operator" ? ["dom_alpha"] : ["dom_beta"],
    domainOf: (_app, name) => DOMAINS[name] ?? null,
  };

  const users = appToolUsers(sql, ports, APP);
  if (!users.ok) throw new Error(JSON.stringify(users.error));
  // a(alpha)는 beta를 맡은 PM이, b(beta)는 alpha를 고른 Operator가 쓴다. 자기 domain의 사용은 없다.
  assertEquals(
    users.ok && users.value.map((u) => `${u.tool}:${u.domain}`),
    ["a:dom_beta", "b:dom_alpha"],
  );
});
