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
        ok([{ place: null, server: runtimeServerOfLayer(server, null) }]),
      ),
    vault: createMcpOAuthVault({ secrets }),
    secrets,
    nowMs: () => 1_000,
  });

  const begin = control.handlers.get("agent-mcp-auth/begin")!;
  const begun = (await begin(undefined, {
    name: "notion",
    place: null,
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
    place: null,
    callback_port: 4321,
  });

  const exchange = issuer.journal().filter((entry) => entry.method === "POST");
  assert.equal(exchange.length, 1);
  assert.equal(exchange[0]!.path, "/token");
  assert.equal(exchange[0]!.form["client_id"], "client-1");
  assert.equal(exchange[0]!.form["client_secret"], CLIENT_SECRET);
});
