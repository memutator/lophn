import assert from "node:assert/strict";
import { test } from "node:test";
import { err, ok } from "../../../base/mod.ts";
import type { McpServer } from "../../../protocol/lophn-agent/mcp-settings.ts";
import type { SecretStorePort } from "../../../protocol/secrets/mod.ts";
import { createFakeIssuerHandler } from "../../../../tests/support/fake-oauth/mod.ts";
import { createMcpAuthControl } from "./mcp-auth-control.ts";
import { createMcpOAuthVault } from "./mcp-oauth-vault.ts";
import { runtimeServerOfLayer } from "./mcp-server.ts";

const ISSUER = "https://issuer.example/mcp";
const AUTHORIZE = "https://issuer.example/authorize";
const TOKEN = "https://issuer.example/token";
const CLIENT_SECRET = "client-secret-MARK-4f2a";
const CLIENT_SECRET_NAME = "mcp.global.notion.client";

// client secret은 사람이 넣은 값을 이름으로 읽어 token 교환 본문에만 싣는다. 끝점은 발급자 metadata에서 찾고,
// 없을 때만 `${issuer}/authorize|token`을 쓴다. 이 둘이 틀리면 OAuth MCP server는 로그인할 수 없다.
test("MCP 로그인이 발급자 metadata의 끝점으로 client secret과 함께 token을 청한다", async () => {
  const stored = new Map<string, string>([[CLIENT_SECRET_NAME, CLIENT_SECRET]]);
  const secrets: Pick<SecretStorePort, "get" | "put" | "delete"> = {
    get: (name) =>
      stored.has(name)
        ? ok(stored.get(name)!)
        : err({ code: "not_found", message: "none" }),
    put: (name, value) => {
      stored.set(name, String(value));
      return Promise.resolve(ok({ name, configured: true }));
    },
    delete: (name) => {
      stored.delete(name);
      return Promise.resolve(ok({ name, configured: false }));
    },
  };

  const issuer = createFakeIssuerHandler();
  issuer.script({
    authorization_code: [{ kind: "tokens", access: "a", refresh: "r" }],
  });

  // metadata 요청만 가로채고 나머지는 fake 발급자가 받는다. 그 끝점의 host는 실제로 닿지 않는다.
  const fetch = (url: string, init: RequestInit): Promise<Response> => {
    const parsed = new URL(url);
    if (parsed.pathname === "/mcp/.well-known/oauth-authorization-server") {
      return Promise.resolve(
        Response.json({
          authorization_endpoint: AUTHORIZE,
          token_endpoint: TOKEN,
        }),
      );
    }
    return issuer.handle(new Request(url, init));
  };

  const server: McpServer = {
    name: "notion",
    enabled: true,
    call_timeout_ms: 30_000,
    transport: "http",
    http: {
      url: "https://mcp.example/mcp",
      headers: {},
      auth: {
        kind: "oauth2",
        issuer: ISSUER,
        client_id: "client-1",
        client_credential: { secret: CLIENT_SECRET_NAME },
        scopes: ["read"],
      },
    },
  };

  let callbackState = "";
  const control = createMcpAuthControl({
    fetch,
    openListener: () =>
      Promise.resolve(
        ok({
          port: () => 4321,
          receive: () =>
            Promise.resolve(
              ok({
                code: "code-1",
                state: callbackState,
                iss: null,
                client_id: null,
              }),
            ),
          close: () => Promise.resolve(),
        }),
      ),
    registered: () =>
      Promise.resolve(
        ok([
          {
            workspace: null,
            agent: null,
            server: runtimeServerOfLayer(server, null),
          },
        ]),
      ),
    vault: createMcpOAuthVault({ secrets }),
    secrets,
    nowMs: () => 1_000,
  });

  const begin = control.handlers.get("agent-mcp-auth/begin")!;
  const begun = (await begin(undefined, {
    name: "notion",
    workspace: null,
    agent: null,
    client_id: "client-1",
    scopes: ["read"],
  })) as { ok: boolean; value?: { url: string } };
  assert.ok(begun.ok);
  const url = new URL(begun.value!.url);
  assert.equal(`${url.origin}${url.pathname}`, AUTHORIZE);
  callbackState = url.searchParams.get("state")!;

  const complete = control.handlers.get("agent-mcp-auth/complete")!;
  await complete(undefined, {
    name: "notion",
    workspace: null,
    agent: null,
    callback_port: 4321,
  });

  const exchange = issuer.journal().filter((entry) => entry.method === "POST");
  assert.equal(exchange.length, 1);
  assert.equal(exchange[0]!.path, "/token");
  assert.equal(exchange[0]!.form["client_id"], "client-1");
  assert.equal(exchange[0]!.form["client_secret"], CLIENT_SECRET);
});

const AGENT = "agt_00000000000000000000000001";

// agent 정의 층 서버는 같은 이름의 전역 서버와 따로다. token 이름이 agent id로 갈리고, 연결이 붙이려는 이름도
// 그 서버의 것이어야 한다: 전역 서버 자리에서는 agent token을 쓰지 않는다.
test("agent 정의 층 서버의 로그인은 agent id 이름에 보관하고 그 서버에만 붙인다", async () => {
  const stored = new Map<string, string>();
  const secrets: Pick<SecretStorePort, "get" | "put" | "delete"> = {
    get: (name) =>
      stored.has(name)
        ? ok(stored.get(name)!)
        : err({ code: "not_found", message: "none" }),
    put: (name, value) => {
      stored.set(name, String(value));
      return Promise.resolve(ok({ name, configured: true }));
    },
    delete: (name) => {
      stored.delete(name);
      return Promise.resolve(ok({ name, configured: false }));
    },
  };

  // metadata와 token 교환을 직접 답한다. fake 발급자는 ChatGPT 교환 칸(`resource`)을 요구해 MCP 교환을 받지 않는다.
  const exchanges: string[] = [];
  const fetch = (url: string, init: RequestInit): Promise<Response> => {
    const parsed = new URL(url);
    if (parsed.pathname === "/mcp/.well-known/oauth-authorization-server") {
      return Promise.resolve(
        Response.json({
          authorization_endpoint: AUTHORIZE,
          token_endpoint: TOKEN,
        }),
      );
    }
    exchanges.push(`${init.method} ${parsed.pathname}`);
    return Promise.resolve(
      Response.json({
        access_token: "agent-access",
        refresh_token: "r",
        token_type: "Bearer",
        expires_in: 3600,
      }),
    );
  };

  const serverOf = (url: string): McpServer => ({
    name: "notion",
    enabled: true,
    call_timeout_ms: 30_000,
    transport: "http",
    http: {
      url,
      headers: {},
      auth: {
        kind: "oauth2",
        issuer: ISSUER,
        client_id: "client-1",
        client_credential: null,
        scopes: ["read"],
      },
    },
  });
  const agentServer = runtimeServerOfLayer(
    serverOf("https://agent.example/mcp"),
    null,
    AGENT,
  );
  const globalServer = runtimeServerOfLayer(
    serverOf("https://global.example/mcp"),
    null,
  );

  let callbackState = "";
  const control = createMcpAuthControl({
    fetch,
    openListener: () =>
      Promise.resolve(
        ok({
          port: () => 4321,
          receive: () =>
            Promise.resolve(
              ok({
                code: "code-1",
                state: callbackState,
                iss: null,
                client_id: null,
              }),
            ),
          close: () => Promise.resolve(),
        }),
      ),
    registered: () =>
      Promise.resolve(
        ok([
          { workspace: null, agent: AGENT, server: agentServer },
          { workspace: null, agent: null, server: globalServer },
        ]),
      ),
    vault: createMcpOAuthVault({ secrets }),
    secrets,
    nowMs: () => 1_000,
  });

  const begin = control.handlers.get("agent-mcp-auth/begin")!;
  const begun = (await begin(undefined, {
    name: "notion",
    workspace: null,
    agent: AGENT,
    client_id: "client-1",
    scopes: ["read"],
  })) as { ok: boolean; value?: { url: string } };
  assert.ok(begun.ok);
  callbackState = new URL(begun.value!.url).searchParams.get("state")!;

  const complete = control.handlers.get("agent-mcp-auth/complete")!;
  const completed = await complete(undefined, {
    name: "notion",
    workspace: null,
    agent: AGENT,
    callback_port: 4321,
  });
  assert.ok(completed.ok, JSON.stringify(completed));
  assert.deepEqual(exchanges, ["POST /token"]);

  assert.ok(stored.has(`mcp-oauth.${AGENT}.notion.access`));
  assert.ok(stored.has(`mcp-oauth.${AGENT}.notion.refresh`));
  assert.ok(!stored.has("mcp-oauth.global.notion.access"));

  const state = control.handlers.get("agent-mcp-auth/state")!;
  const read = (await state(undefined, {
    servers: [
      { name: "notion", workspace: null, agent: AGENT },
      { name: "notion", workspace: null, agent: null },
    ],
  })) as {
    ok: boolean;
    value?: {
      servers: { agent: string | null; state: string }[];
    };
  };
  assert.ok(read.ok);
  assert.deepEqual(
    read.value!.servers.map((entry) => [entry.agent, entry.state]),
    [
      [AGENT, "signed_in"],
      [null, "none"],
    ],
  );

  const agentUse = {
    name: `mcp-oauth.${AGENT}.notion.access`,
    destination: { kind: "https" as const, origin: "https://agent.example" },
  };
  const globalUse = {
    name: "mcp-oauth.global.notion.access",
    destination: { kind: "https" as const, origin: "https://global.example" },
  };
  assert.ok((await control.prepareToken(agentUse))?.ok);
  assert.equal(
    (
      await control.prepareToken({
        ...agentUse,
        destination: { kind: "https", origin: "https://global.example" },
      })
    )?.ok,
    false,
  );
  assert.equal((await control.prepareToken(globalUse))?.ok, false);
});
