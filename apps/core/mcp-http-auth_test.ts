// lophn-agent/extensions#R16 #R17, platform/secrets#R5: HTTP MCP server의 bearer·api_key·secret_ref
// 헤더는 runtime의 연결 눈이 요청마다 core의 secret 전송 부착(감독 pipe)으로 값을 받아 붙인다.
// core는 설정의 정확한 server URL origin과 현재 참조·판을 대조하고, 값은 통과했을 때만 건넨다.
// ledger는 temp dir이고 keychain은 fake다(사람의 실제 keychain에 닿지 않는다). MCP server는 이
// 시험이 연 localhost fake server다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { mcpServersSetting } from "../../packages/protocol/lophn-agent/mod.ts";
import type { ParentMessage } from "../../packages/protocol/server/mod.ts";
import {
  createMcpConnections,
  createMcpSecretRefSource,
} from "../../packages/core/lophn-agent/extensions/mod.ts";
import { SETTINGS_SCHEMA_STEPS } from "../../packages/core/config/mod.ts";
import {
  createFakeKeychain,
  type FakeKeychain,
  SECRET_SCHEMA_STEPS,
} from "../../packages/core/secrets/mod.ts";
import { ok } from "../../packages/base/mod.ts";
import { createSecretLink } from "../agent-runtime/secret-link.ts";
import { mcpConnectionsDeps } from "../agent-runtime/product-driver.ts";
import { answerRedactRequest } from "./agent-runtime-redaction.ts";
import { createAgentRuntimeSecrets } from "./agent-runtime-secret.ts";
import { openSecretStore } from "./secret-store.ts";

const TOKEN = "teal-orchard-bearer-7c1e5a90-saffron";
const KEY = "amber-meadow-apikey-3b8d2f64-juniper";
const NOTE = "plum-canyon-header-91ae6c07-willow";

type Seen = {
  authorization: string | null;
  key: string | null;
  note: string | null;
};

type World = {
  home: string;
  db: DatabaseSync;
  keychain: FakeKeychain;
  server: Deno.HttpServer;
  port: number;
  seen: Seen[];
  // 값이 맞지 않으면 401로 답하게 하는 기대 값이다.
  expect: { authorization?: string; key?: string };
  store: ReturnType<typeof openSecretStore>;
  connections: ReturnType<typeof createMcpConnections>;
};

async function open(): Promise<World> {
  const home = await Deno.makeTempDir({ prefix: "lophn-mcp-http-auth-" });
  const db = new DatabaseSync(`${home}/lophn.db`);
  for (const step of SECRET_SCHEMA_STEPS) db.exec(step.sql);
  for (const step of SETTINGS_SCHEMA_STEPS) db.exec(step.sql);
  const keychain = createFakeKeychain();
  for (
    const [name, value] of [["mcp-notes", TOKEN], ["mcp-keyed", KEY], [
      "mcp-extra",
      NOTE,
    ]]
  ) {
    const stored = await keychain.store({
      name,
      purpose: "external_mcp_credential",
      owner: "lophn-agent/extensions",
      value: new TextEncoder().encode(value),
    });
    assert(stored.ok);
    db.prepare(
      "insert into secrets (name, sealed_ref, revision) values (?, ?, 1)",
    ).run(name, stored.value);
  }
  const seen: Seen[] = [];
  const expect: World["expect"] = {};
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    async (request) => {
      const entry: Seen = {
        authorization: request.headers.get("authorization"),
        key: request.headers.get("x-api-key"),
        note: request.headers.get("x-note"),
      };
      seen.push(entry);
      if (
        (expect.authorization !== undefined &&
          entry.authorization !== expect.authorization) ||
        (expect.key !== undefined && entry.key !== expect.key)
      ) {
        return new Response("no", { status: 401 });
      }
      const body = JSON.parse(await request.text()) as {
        id?: number;
        method: string;
      };
      if (body.id === undefined) return new Response(null, { status: 202 });
      const result = body.method === "initialize"
        ? {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "fake-http", version: "0" },
        }
        : body.method === "tools/list"
        ? {
          tools: [{
            name: "whoami",
            description: "echo the credentials the server saw",
            inputSchema: { type: "object", properties: {} },
          }],
        }
        // 서버가 받은 인증 헤더를 결과 글로 되돌린다. model로 가는 글에 값이 섞이는 경우다.
        : {
          content: [{
            type: "text",
            text: `saw ${entry.authorization ?? ""} ${entry.key ?? ""} ${
              entry.note ?? ""
            }`,
          }],
        };
      return Response.json({ jsonrpc: "2.0", id: body.id, result });
    },
  );
  const store = openSecretStore({
    ledgerPath: `${home}/lophn.db`,
    channel: {
      register: () => Promise.resolve(ok(undefined)),
      revoke: () => Promise.resolve(ok(undefined)),
      setReady: () => Promise.resolve(ok(undefined)),
    },
    keychain: () => keychain,
    sources: [createMcpSecretRefSource()],
  });
  const secrets = createAgentRuntimeSecrets({
    ledgerPath: `${home}/lophn.db`,
    keychain: () => keychain,
    known: () => store.known,
    process: "lophn-agent/runtime",
    task: "lophn-agent",
  });
  // 감독 pipe의 짝이다: child의 요청을 core가 답하고 그 응답이 child의 link로 돌아간다.
  const link = createSecretLink({
    async send(message) {
      const answer = await secrets.answer(message, () => true);
      if (answer !== undefined) link.onParent(answer as ParentMessage);
    },
    timeoutMs: 2000,
  });
  const connections = createMcpConnections(mcpConnectionsDeps(link.attach));
  return {
    home,
    db,
    keychain,
    server,
    port: server.addr.port,
    seen,
    expect,
    store,
    connections,
  };
}

async function close(world: World) {
  await world.connections.endAll();
  await world.server.shutdown();
  world.store.stop();
  world.db.close();
  await Deno.remove(world.home, { recursive: true });
}

function register(world: World, servers: unknown[]) {
  world.db.prepare("delete from setting_choices").run();
  world.db.prepare(
    "insert into setting_choices (layer, key, value) values ('common', ?, ?)",
  ).run(mcpServersSetting.key, JSON.stringify(servers));
}

function config(world: World, name: string, http: Record<string, unknown>) {
  return mcpServersSetting.value_type.parse([{
    name,
    revision: 1,
    enabled: true,
    transport: "http",
    call_timeout_ms: 60_000,
    classifications: {},
    http: { url: `http://127.0.0.1:${world.port}/rpc`, headers: {}, ...http },
  }])[0]!;
}

async function connect(world: World, server: ReturnType<typeof config>) {
  register(world, [server]);
  assert((await world.store.sync()).ok);
  return await world.connections.acquire(
    "asg-1",
    server,
    new AbortController().signal,
  );
}

Deno.test("lophn-agent/extensions#R16 #R17: bearer는 Authorization으로, api_key는 정한 헤더로, secret_ref 헤더는 그 이름으로 요청마다 붙고 값은 연결 상태·도구 목록 어디에도 없다", async () => {
  const world = await open();
  try {
    const bearer = config(world, "notes", {
      auth: { kind: "bearer", secret_ref: "sec:mcp-notes" },
    });
    world.expect.authorization = `Bearer ${TOKEN}`;
    const view = await connect(world, bearer);
    assert(view.ok, view.ok ? "" : JSON.stringify(view.error));
    const listed = await world.connections.toolList("asg-1", "notes");
    assert(listed.ok);
    const called = await world.connections.call(
      "asg-1",
      "notes",
      "whoami",
      {},
      new AbortController().signal,
      5000,
    );
    assertEquals(called.kind, "success");
    // initialize, initialized 알림, tools/list, tools/call 모두 같은 헤더를 가졌다.
    assert(world.seen.length >= 3);
    for (const entry of world.seen) {
      assertEquals(entry.authorization, `Bearer ${TOKEN}`);
    }
    // 연결 상태·도구 목록·호출 결과의 설정 쪽 표현에는 값이 없다.
    assert(!JSON.stringify(view.value).includes(TOKEN));
    assert(!JSON.stringify(world.connections.views()).includes(TOKEN));
    assert(!JSON.stringify(listed.value).includes(TOKEN));
    await world.connections.endAssignment("asg-1");

    world.seen.length = 0;
    world.expect.authorization = undefined;
    world.expect.key = KEY;
    const keyed = config(world, "keyed", {
      headers: {
        "x-note": { kind: "secret_ref", secret_ref: "sec:mcp-extra" },
      },
      auth: {
        kind: "api_key",
        secret_ref: "sec:mcp-keyed",
        header_name: "x-api-key",
      },
    });
    const keyedView = await connect(world, keyed);
    assert(keyedView.ok, keyedView.ok ? "" : keyedView.error.message);
    assert(world.seen.length >= 1);
    for (const entry of world.seen) {
      assertEquals(entry.key, KEY);
      assertEquals(entry.note, NOTE);
      assertEquals(entry.authorization, null);
    }
  } finally {
    await close(world);
  }
});

Deno.test("platform/redaction#R1 lophn-agent/extensions#R17: 서버가 인증 헤더를 결과 글에 되돌려도 알려진 값 안전화가 model로 가기 전에 지운다", async () => {
  const world = await open();
  try {
    world.expect.authorization = `Bearer ${TOKEN}`;
    const view = await connect(
      world,
      config(world, "notes", {
        auth: { kind: "bearer", secret_ref: "sec:mcp-notes" },
      }),
    );
    assert(view.ok);
    const called = await world.connections.call(
      "asg-1",
      "notes",
      "whoami",
      {},
      new AbortController().signal,
      5000,
    );
    assert(called.kind === "success");
    const echoed = JSON.stringify(called.result);
    assert(echoed.includes(TOKEN), "시험 전제: 서버가 값을 되돌렸다");
    const redacted = answerRedactRequest(
      { type: "redact_request", request_id: "r1", windows: [echoed] },
      world.store.known,
    );
    assert(redacted !== undefined && redacted.ok);
    // 지울 자리가 값 전체를 덮고, 응답에는 값이 없다.
    const [span] = redacted.spans[0]!;
    assert(span !== undefined);
    assertEquals(echoed.slice(span.index, span.index + span.length), TOKEN);
    assert(!JSON.stringify(redacted).includes(TOKEN));
  } finally {
    await close(world);
  }
});

Deno.test("lophn-agent/extensions#R17 platform/secrets#R5: 설정이 가리키지 않는 참조나 꺼진 server와 다른 목적지로는 값을 건네지 않고 요청도 나가지 않는다", async () => {
  const world = await open();
  try {
    // 설정은 notes만 가리키는데 다른 이름을 청하는 경우는 연결 눈이 만들 수 없으므로 core 쪽에서 직접 본다.
    const server = config(world, "notes", {
      auth: { kind: "bearer", secret_ref: "sec:mcp-notes" },
    });
    register(world, [{ ...server, enabled: false }]);
    assert((await world.store.sync()).ok);
    // 꺼진 server의 참조: 값이 건너지 않아 요청이 나가지 않고 auth 실패로 본다.
    const off = await world.connections.acquire(
      "asg-off",
      { ...server, enabled: true },
      new AbortController().signal,
    );
    assert(!off.ok);
    assertEquals(world.seen.length, 0);
    assertEquals(world.connections.views().at(-1)?.state, "failed_auth");

    // 설정의 URL과 다른 목적지로 같은 참조를 청하면 forbidden이다.
    register(world, [server]);
    const elsewhere = config(world, "notes", {
      url: "http://127.0.0.1:1/rpc",
      auth: { kind: "bearer", secret_ref: "sec:mcp-notes" },
    });
    const moved = await world.connections.acquire(
      "asg-moved",
      elsewhere,
      new AbortController().signal,
    );
    assert(!moved.ok);
    assertEquals(world.seen.length, 0);
  } finally {
    await close(world);
  }
});

Deno.test("lophn-agent/extensions#R20: 서버가 값을 거절하면 failed_auth이고 값이 없는 keychain은 요청을 보내지 않는다", async () => {
  const world = await open();
  try {
    world.expect.authorization = "Bearer something-else";
    const server = config(world, "notes", {
      auth: { kind: "bearer", secret_ref: "sec:mcp-notes" },
    });
    const rejected = await connect(world, server);
    assert(!rejected.ok);
    assertEquals(world.connections.views().at(-1)?.state, "failed_auth");
    assertEquals(world.seen.length, 1);

    // keychain을 읽을 수 없으면 값이 없고 요청은 나가지 않는다(fail closed).
    world.seen.length = 0;
    world.keychain.setStatus("unavailable");
    const locked = await world.connections.acquire(
      "asg-locked",
      server,
      new AbortController().signal,
    );
    assert(!locked.ok);
    assertEquals(world.seen.length, 0);
    world.keychain.setStatus("available");
  } finally {
    await close(world);
  }
});
