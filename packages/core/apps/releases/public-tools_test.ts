import { assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { ok } from "../../../base/mod.ts";
import {
  type RequestContext,
  TargetAuthorization,
  type Tx,
} from "../../../protocol/server/mod.ts";
import type { ReleaseRecord } from "../../../protocol/apps/mod.ts";
import type { Blueprint } from "../blueprint/mod.ts";
import { appsSchemaSteps } from "../registration/schema.ts";
import { domainLookupPort } from "../../../protocol/domains/mod.ts";
import { usagePorts } from "../usage/mod.ts";
import { createReleaseCommands } from "./commands.ts";
import { diffTools, removedPublicOf } from "./public-tools.ts";
import { releasesSchemaSteps } from "./schema.ts";
import { insertRelease } from "./store.ts";

type Tool = Blueprint["tools"][number];

const tool = (
  name: string,
  pub: boolean,
  effect = "read",
  domain = "alpha",
): Tool => ({
  name,
  title: name,
  description: name,
  inputSchema: null,
  effect,
  public: pub,
  domain,
} as Tool);

Deno.test("공개였다가 비공개가 된 tool도 지운 것이고, 바뀐 것은 이름별로 나온다", () => {
  const before = [tool("a", true), tool("b", true), tool("c", false)];
  const after = [tool("a", false), tool("b", true, "write"), tool("d", true)];
  assertEquals(diffTools(before, after), {
    added: ["d"],
    removed: ["c"],
    changed: ["a", "b"],
  });
  assertEquals(removedPublicOf(before, after), ["a"]);
  // domain만 달라져도 바뀐 tool이다.
  assertEquals(
    diffTools([tool("a", true)], [tool("a", true, "read", "beta")]).changed,
    ["a"],
  );
});

const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzza";
const OWN = "dom_01hzzzzzzzzzzzzzzzzzzzzzza";
const OTHER = "dom_01hzzzzzzzzzzzzzzzzzzzzzzb";
const MACHINE: RequestContext = {
  principal: "machine:test",
  actor: "machine",
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: "machine:test",
};

function release(n: number, tools: Tool[], status = "prepared") {
  return {
    record: {
      id: `rel_01hzzzzzzzzzzzzzzzzzzzzz${String(n).padStart(2, "0")}`,
      app: APP,
      number: n,
      code_commit: "0".repeat(40),
      bundle_hash: "0".repeat(64),
      blueprint_hash: "0".repeat(64),
      data_schema: 1,
      data_changes: [],
      tests: ["vrf_01hzzzzzzzzzzzzzzzzzzzzzza"],
      ticket_source: {
        ticket: "tkt_01hzzzzzzzzzzzzzzzzzzzzzza",
        claim_seq: "1",
      },
      created_by: "coding_agent:ses_01hzzzzzzzzzzzzzzzzzzzzzza",
      created_at: "2026-10-16T00:00:00.000Z",
      status,
    } as unknown as ReleaseRecord,
    blueprint: JSON.stringify({ tools }),
  };
}

Deno.test("다른 domain이 쓰는 공개 tool을 지운 release는 시작하지 않고 prepared로 남는다", () => {
  const db = new DatabaseSync(":memory:");
  for (const step of [...appsSchemaSteps, ...releasesSchemaSteps]) {
    db.exec(step.sql);
  }
  db.exec(`CREATE TABLE agent_grants (agent TEXT, entries TEXT);
    CREATE TABLE invocations (app TEXT, caller_kind TEXT, operation TEXT, session TEXT)`);
  db.prepare(
    `INSERT INTO apps VALUES (?, 'slug', ?, 'n', 'd', NULL, NULL, NULL, 1, '1', 'active')`,
  ).run(APP, "prj_01hzzzzzzzzzzzzzzzzzzzzzza");
  let count = 0;
  const sessions: Record<string, string> = { ses_own: OWN, ses_other: OTHER };
  const ports = new Map<unknown, unknown>([
    [TargetAuthorization, () => ok(undefined)],
    [usagePorts, {
      sessionDomains: (id: string) => ({
        role: "project_manager",
        domains: [sessions[id]],
      }),
      agentDomains: () => [],
      domainOf: (_app: string, name: string) => name === "alpha" ? OWN : null,
    }],
    [domainLookupPort, {
      ofOwner: () => [{ id: OWN, name: "alpha" }],
    }],
  ]);
  const tx = {
    sql: {
      run: (text: string, params: never[]) => db.prepare(text).run(...params),
      get: (text: string, params: never[]) =>
        db.prepare(text).get(...params) as Record<string, never> | undefined,
      all: (text: string, params: never[]) =>
        db.prepare(text).all(...params) as Record<string, never>[],
    },
    newId: (prefix: string) =>
      `${prefix}_01h${String(++count).padStart(23, "z")}`,
    now: () => "2026-10-16T00:00:00.000Z",
    emit: () => String(++count),
    port: (key: unknown) => ports.get(key),
  } as unknown as Tx;
  const called = (session: string, name: string) =>
    db.prepare(
      `INSERT INTO invocations VALUES (?, 'agent', ?, ?)`,
    ).run(APP, JSON.stringify({ kind: "tool", tool: name }), session);
  // 다른 domain은 a를, 자기 domain은 d를 불렀다. b와 c는 아무도 부르지 않았다.
  called("ses_other", "a");
  called("ses_own", "d");

  const put = (r: ReturnType<typeof release>, active = false) => {
    insertRelease(tx, r.record, r.blueprint, {} as never);
    if (active) {
      db.prepare(
        "UPDATE releases SET status = 'active', activated_at = '2026-10-16T00:00:00.000Z' WHERE id = ?",
      ).run(r.record.id);
    }
    return r.record.id;
  };
  put(
    release(1, [
      tool("a", true),
      tool("b", true),
      tool("c", false),
      tool("d", true),
    ]),
    true,
  );
  const blocked = put(release(2, [tool("b", true), tool("c", false)]));
  const free = put(release(3, [tool("a", true)]));

  const start = createReleaseCommands().startActivation;
  const run = (id: string) =>
    (start.handle as (...a: unknown[]) => { ok: boolean; error?: never })(
      tx,
      MACHINE,
      { release: id, key: "k" },
      {},
    ) as { ok: boolean; error?: { code: string } };

  assertEquals(run(blocked).error?.code, "conflict");
  assertEquals(
    db.prepare("SELECT status FROM releases WHERE id = ?").get(blocked)
      ?.status,
    "prepared",
  );
  // b(아무도 안 씀), c(비공개), d(자기 domain만 씀)를 지운 release는 막히지 않는다.
  assertEquals(run(free).ok, true);
});
