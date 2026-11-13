import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { err, ok } from "../../../base/mod.ts";
import type { McpServer } from "../../../protocol/lophn-agent/mod.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import {
  SECRET_SEND_OP,
  type SecretSendOutput,
} from "../../../protocol/secrets/mod.ts";
import { createFileSecretAttach } from "../../secrets/mod.ts";
import { runtimeServerOfLayer } from "../extensions/mod.ts";
import { createSecretDestinations } from "../secret-destinations.ts";
import {
  providerReportedModelLimitsSchemaSteps,
  providerSchemaSteps,
} from "./schema.ts";
import { providerSecretDestinations } from "./secret-refs.ts";

const VALUE = "sk-live-MARKER-5c1e";

// 실제 provider 표에 credential 세 개를 둔다. 값은 가짜 file에만 있다.
function setup() {
  const db = new DatabaseSync(":memory:");
  for (const step of providerSchemaSteps) db.exec(step.sql);
  for (const step of providerReportedModelLimitsSchemaSteps) db.exec(step.sql);
  const provider = (id: string, endpoint: string) =>
    db
      .prepare(
        `insert into providers values (?, ?, 'x', '{}', ?, 'openai-chat-completions', 1)`,
      )
      .run(id, id, endpoint);
  const credential = (id: string, name: string, state: string) =>
    db
      .prepare(
        `insert into provider_credentials
         (provider, kind, secret_name, revision, state, unavailable_reason)
       values (?, 'api_key', ?, 1, ?, ?)`,
      )
      .run(id, name, state, state === "available" ? null : "authentication");
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

test("attach는 허락한 provider endpoint origin이 아닌 목적지에 값을 붙이지 않는다", async () => {
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
      operations: [SECRET_SEND_OP],
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
    const destination =
      label === "d"
        ? { kind: "loopback_http" as const, origin }
        : https(origin);
    const got = await run(name, destination as ReturnType<typeof https>);
    assert.deepStrictEqual(
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
  assert.deepStrictEqual([good.result.ok, good.sent], [true, [VALUE]]);
});

test("secret 값은 자기 이름 공간의 목적지로만 간다", async () => {
  const sql = setup();
  const http = (
    name: string,
    url: string,
    secret: string,
    enabled = true,
  ): McpServer => ({
    name,
    enabled,
    call_timeout_ms: 60_000,
    transport: "http",
    http: {
      url,
      headers: {},
      auth: { kind: "bearer", credential: { secret } },
    },
  });
  const servers = [
    http("srv", "https://mcp.example.com/mcp", "mcp.global.srv"),
    http("off", "https://off.example.com", "mcp.global.off", false),
  ].map((server) => runtimeServerOfLayer(server, null));
  const values = new Map([
    ["provider.p1", "VALUE-provider"],
    ["provider.p1.refresh", "VALUE-refresh"],
    ["provider.p1.meta", "VALUE-meta"],
    ["mcp.global.srv", "VALUE-mcp"],
    ["mcp.global.off", "VALUE-off"],
    ["other.srv", "VALUE-other"],
  ]);
  const file = {
    get: (name: string) => {
      const value = values.get(name);
      return value === undefined
        ? err({ code: "not_found" as const, message: "없다" })
        : ok(value);
    },
  };
  const attach = createFileSecretAttach({
    file,
    allowance: () => ok(undefined),
    processes: () => true,
    destinations: createSecretDestinations({
      providers: (name) => providerSecretDestinations(sql, name),
      mcpServers: () => Promise.resolve(ok(servers)),
      secrets: file,
    }),
  });
  const context = {
    principal: "machine:agent-runtime-secret",
    actor: "machine" as const,
    scope: {
      operations: [SECRET_SEND_OP],
      targets: { process: "agent-runtime", task: "agent-runtime" },
    },
    conditions: { process: "agent-runtime", task: "agent-runtime" },
    credential_ref: "machine:agent-runtime-secret",
  };
  const cases = [
    ["mcp.global.srv", "https://mcp.example.com", "VALUE-mcp"],
    // MCP 값은 provider endpoint로, provider 값은 MCP URL로 가지 않는다.
    ["mcp.global.srv", "https://api.example.com", "forbidden"],
    ["provider.p1", "https://mcp.example.com", "forbidden"],
    ["provider.p1", "https://api.example.com", "VALUE-provider"],
    // 구독 로그인의 refresh token과 meta는 provider endpoint로도 나가지 않는다.
    ["provider.p1.refresh", "https://api.example.com", "forbidden"],
    ["provider.p1.meta", "https://api.example.com", "forbidden"],
    // 끈 서버와 이름 공간 밖 이름은 목적지가 없다.
    ["mcp.global.off", "https://off.example.com", "forbidden"],
    ["other.srv", "https://mcp.example.com", "forbidden"],
  ] as const;
  for (const [name, origin, expected] of cases) {
    const sent: unknown[] = [];
    const result = await attach.send(
      {
        context,
        use: { name, destination: { kind: "https", origin } },
        operation: "mcp.request",
        body: {},
      },
      (value) => {
        sent.push(value);
        return Promise.resolve(ok<SecretSendOutput>({ sent: true }));
      },
    );
    assert.deepStrictEqual(
      [name, origin, result.ok ? sent[0] : result.error.code],
      [name, origin, expected],
    );
  }
});
