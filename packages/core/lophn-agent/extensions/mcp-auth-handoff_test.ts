import assert from "node:assert/strict";
import { test } from "node:test";
import { err, ok } from "../../../base/mod.ts";
import type { McpServer } from "../../../protocol/lophn-agent/mcp-settings.ts";
import type { SecretStorePort } from "../../../protocol/secrets/mod.ts";
import { createMcpAuthControl } from "./mcp-auth-control.ts";
import { createMcpOAuthVault } from "./mcp-oauth-vault.ts";
import { runtimeServerOfLayer } from "./mcp-server.ts";

const person = (principal: string) => ({
  principal,
  actor: "user" as const,
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: principal,
});
const DEVICE = person("device:dev_01h455vb4pex5v6nkc6gd5fd12");
const LOCAL = person("user:local");

// 다른 기기가 시작한 MCP 로그인은 이 기계가 port를 쥐지 않고, 기기가 건넨 callback으로 이 기계에서 교환·저장한다.
test("기기가 시작한 MCP 로그인은 callback을 state로 대조해 이 기계의 vault에 token을 저장하고, 그 밖의 로그인에는 건넬 수 없다", async () => {
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
  const exchanged: URLSearchParams[] = [];
  const fetch = (url: string, init: RequestInit): Promise<Response> => {
    if (
      new URL(url).pathname.endsWith("/.well-known/oauth-authorization-server")
    ) {
      return Promise.resolve(
        Response.json({
          authorization_endpoint: "https://issuer.example/authorize",
          token_endpoint: "https://issuer.example/token",
        }),
      );
    }
    exchanged.push(new URLSearchParams(String(init.body)));
    return Promise.resolve(
      Response.json({
        access_token: "access-1",
        refresh_token: "refresh-1",
        token_type: "Bearer",
        expires_in: 3600,
      }),
    );
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
        issuer: "https://issuer.example/mcp",
        client_id: "client-1",
        client_credential: null,
        scopes: ["read"],
      },
    },
  };
  let listened = 0;
  const control = createMcpAuthControl({
    fetch,
    openListener: () => {
      listened++;
      return Promise.resolve(err({ code: "unavailable", message: "no" }));
    },
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
  const route = (name: string) =>
    control.handlers.get(`agent-mcp-auth/${name}`)!;
  const target = { name: "notion", workspace: null, agent: null };
  type Begun = {
    ok: boolean;
    value: { url: string; callback_mode: string; redirect_uri: string };
  };
  const begun = (await route("begin")(DEVICE, {
    ...target,
    client_id: "client-1",
    scopes: ["read"],
  })) as Begun;
  assert.ok(begun.ok, JSON.stringify(begun));
  assert.equal(begun.value.callback_mode, "remote_handoff");
  assert.equal(listened, 0);
  const authorize = new URL(begun.value.url);
  assert.equal(
    authorize.searchParams.get("redirect_uri"),
    begun.value.redirect_uri,
  );
  const state = authorize.searchParams.get("state")!;

  const wrong = await route("callback")(DEVICE, {
    ...target,
    callback_url: `${begun.value.redirect_uri}?code=c&state=OTHER`,
  });
  assert.equal(!wrong.ok && wrong.error.code, "invalid_input");
  assert.equal(exchanged.length, 0);

  // 맞는 state로 건네면 대상 core에서 직접 token을 교환해 이 기계의 vault에 저장한다.
  const right = await route("callback")(DEVICE, {
    ...target,
    callback_url: `${begun.value.redirect_uri}?code=CODE-1&state=${state}`,
  });
  assert.ok(right.ok, JSON.stringify(right));
  assert.equal(exchanged.length, 1);
  assert.equal(exchanged[0]!.get("code"), "CODE-1");
  assert.equal(exchanged[0]!.get("redirect_uri"), begun.value.redirect_uri);
  assert.equal(stored.get("mcp-oauth.global.notion.access"), "access-1");
  assert.equal(stored.get("mcp-oauth.global.notion.refresh"), "refresh-1");

  // 끝난 로그인에는 다시 건네지 못한다.
  const again = await route("callback")(DEVICE, {
    ...target,
    callback_url: `${begun.value.redirect_uri}?code=CODE-2&state=${state}`,
  });
  assert.equal(!again.ok && again.error.code, "conflict");

  // 이 기계의 사람이 시작하면 그대로 listener를 연다.
  const local = await route("begin")(LOCAL, {
    ...target,
    client_id: "client-1",
    scopes: ["read"],
  });
  assert.equal(!local.ok && local.error.code, "unavailable");
  assert.equal(listened, 1);
});
