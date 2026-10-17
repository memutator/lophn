import { assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { ok } from "../../../base/mod.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import type { SecretSendOutput } from "../../../protocol/secrets/mod.ts";
import { createFileSecretAttach, SECRET_SEND } from "../../secrets/mod.ts";
import { providerSchemaSteps } from "./schema.ts";
import { providerSecretDestinations } from "./secret-refs.ts";

const VALUE = "sk-live-MARKER-5c1e";

// 실제 provider 표에 credential 세 개를 둔다. 값은 가짜 file에만 있다.
function setup() {
  const db = new DatabaseSync(":memory:");
  for (const step of providerSchemaSteps) db.exec(step.sql);
  const provider = (id: string, endpoint: string) =>
    db.prepare(
      `insert into providers values (?, ?, 'x', '{}', ?, 'openai-chat-completions', 1)`,
    ).run(id, id, endpoint);
  const credential = (id: string, name: string, state: string) =>
    db.prepare(
      `insert into provider_credentials
         (provider, kind, secret_name, revision, state, unavailable_reason)
       values (?, 'api_key', ?, 1, ?, ?)`,
    ).run(id, name, state, state === "available" ? null : "authentication");
  provider("p1", "https://api.example.com/v1");
  credential("p1", "provider.p1", "available");
  provider("p2", "https://revoked.example.com");
  credential("p2", "provider.p2", "revoked");
  provider("p3", "http://api.lan.example.com");
  credential("p3", "provider.p3", "available");
  const sql: Sql = {
    run: (query, params) => db.prepare(query).run(...params),
    get: (query, params) => db.prepare(query).get(...params) as never,
    all: (query, params) => db.prepare(query).all(...params) as never,
  };
  return sql;
}

Deno.test("attach는 허락한 provider endpoint origin이 아닌 목적지에 값을 붙이지 않는다", async () => {
  const sql = setup();
  let reads = 0;
  let sent: unknown[] = [];
  const attach = createFileSecretAttach({
    file: {
      get: () => {
        reads += 1;
        return ok(VALUE);
      },
    },
    allowance: () => ok(undefined),
    processes: () => true,
    destinations: {
      allowed: (name) => providerSecretDestinations(sql, name),
    },
  });
  const context = {
    principal: "machine:agent-runtime-secret",
    actor: "machine" as const,
    scope: {
      operations: [SECRET_SEND],
      targets: { process: "agent-runtime", task: "agent-runtime" },
    },
    conditions: { process: "agent-runtime", task: "agent-runtime" },
    credential_ref: "machine:agent-runtime-secret",
  };
  const https = (origin: string) => ({ kind: "https" as const, origin });
  const run = async (name: string, destination: ReturnType<typeof https>) => {
    reads = 0;
    sent = [];
    const result = await attach.send(
      {
        context,
        use: { name, destination },
        operation: "model.call",
        body: {},
      },
      (value) => {
        sent.push(value);
        return Promise.resolve(ok<SecretSendOutput>({ sent: true }));
      },
    );
    return { result, reads, sent };
  };

  // (a) endpoint와 다른 origin, (b) 모르는 이름, (c) revoked, (d) loopback이 아닌 http
  const denied = [
    ["a", "provider.p1", "https://evil.example.com"],
    ["b", "provider.nope", "https://api.example.com"],
    ["c", "provider.p2", "https://revoked.example.com"],
    ["d", "provider.p3", "http://api.lan.example.com"],
  ] as const;
  for (const [label, name, origin] of denied) {
    const destination = label === "d"
      ? { kind: "loopback_http" as const, origin }
      : https(origin);
    const got = await run(name, destination as ReturnType<typeof https>);
    assertEquals(
      [
        label,
        got.result.ok ? "ok" : got.result.error.code,
        got.reads,
        got.sent,
      ],
      [label, "forbidden", 0, []],
    );
  }

  // (e) endpoint origin과 같은 목적지만 값이 간다.
  const good = await run("provider.p1", https("https://api.example.com"));
  assertEquals([good.result.ok, good.sent], [true, [VALUE]]);
});
