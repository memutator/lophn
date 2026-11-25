import assert from "node:assert/strict";
import { test } from "node:test";
import { secretSlotFlags } from "../../../protocol/lophn-agent/input-request.ts";
import type { McpServer } from "../../../protocol/lophn-agent/mod.ts";
import {
  mcpMissingSlot,
  mcpSecretDestinations,
  runtimeServerOfLayer,
} from "./mcp-server.ts";

const PROJECT = {
  kind: "project",
  id: "prj_01h455vb4pex5v6nkc6gd5fd01",
} as const;

function httpServer(secret: string, url: string): McpServer {
  return {
    name: "docs",
    enabled: true,
    call_timeout_ms: 60_000,
    transport: "http",
    http: {
      url,
      headers: {},
      auth: { kind: "bearer", credential: { secret } },
    },
  };
}

// 켜진 모든 http server가 같은 목록에 든다. 같은 server 이름 `docs`를 층마다 따로 두어도 secret 이름이 다르면
// 이름마다 자기 origin으로만 가야 한다. 이름이 겹치면 한 server의 값이 다른 server의 origin으로 갈 수 있다.
test("mcp secret 이름은 그 이름을 쓰는 server의 origin으로만 간다", () => {
  const layers = [
    ["mcp.global.docs", "https://global.example.com/mcp", null],
    [`mcp.${PROJECT.id}.docs`, "https://project.example.com/mcp", PROJECT],
    [
      "mcp.agt_aaaaaaaaaaaaaaaaaaaaaaaaaa.docs",
      "https://a.example.com/mcp",
      PROJECT,
    ],
    [
      "mcp.agt_bbbbbbbbbbbbbbbbbbbbbbbbbb.docs",
      "https://b.example.com/mcp",
      PROJECT,
    ],
  ] as const;
  const servers = layers.map(([secret, url, workspace]) =>
    runtimeServerOfLayer(httpServer(secret, url), workspace),
  );
  for (const [secret, url] of layers) {
    const origins = mcpSecretDestinations(servers, secret).map((one) =>
      JSON.stringify(one),
    );
    assert.equal(origins.length, 1, secret);
    assert.ok(origins[0]!.includes(new URL(url).host), secret);
  }
});

// 값이 없거나 인증이 거절된 MCP 호출은 agent에게 빈 자리를 알린다. 이름은 설정에서 역산한 역할이라 agent가 정하지 못하고,
// 그 자리를 `lophn ask secret`의 flag로 그대로 찍어 준다.
test("MCP 연결 실패는 설정에서 역산한 빈 자리를 알리고 flag로 찍힌다", () => {
  const server = runtimeServerOfLayer(
    {
      name: "docs",
      enabled: true,
      call_timeout_ms: 60_000,
      transport: "http",
      http: {
        url: "https://mcp.example.com/x",
        headers: { "X-Team": { secret: "mcp.global.docs.team" } },
        auth: { kind: "bearer", credential: { secret: "mcp.global.docs" } },
      },
    },
    null,
  );
  const part = (missing_secret: string | null, state = "failed_temporary") =>
    mcpMissingSlot(server, { state, missing_secret });
  assert.deepEqual(part("mcp.global.docs"), {
    mcp: "docs",
    part: "credential",
  });
  assert.deepEqual(part("mcp.global.docs.team"), {
    mcp: "docs",
    part: "header:X-Team",
  });
  // 인증 거절은 값이 있는데 틀린 것이라 credential을 다시 청한다. 아무 이유도 모르면 자리가 없다.
  assert.deepEqual(part(null, "failed_auth"), {
    mcp: "docs",
    part: "credential",
  });
  assert.equal(part(null), undefined);
  assert.equal(part("mcp.global.other"), undefined);

  assert.equal(
    secretSlotFlags({ mcp: "docs", part: "header:X-Team" }),
    "--mcp docs --part header:X-Team",
  );
  assert.equal(
    secretSlotFlags({ provider: "anthropic", sign_in: true }),
    "--provider anthropic --sign-in",
  );
  assert.equal(
    secretSlotFlags({
      display_name: "River AI",
      base_url: "https://api.river.ai/v1",
      protocol: "openai-chat-completions",
    }),
    '--display-name "River AI" --base-url https://api.river.ai/v1 --protocol openai-chat-completions',
  );

  // oauth2 또는 none HTTP server가 401(failed_auth)을 받으면 sign_in 안내 자리를 돌려준다.
  const oauthServer = runtimeServerOfLayer(
    {
      name: "linear",
      enabled: true,
      call_timeout_ms: 60_000,
      transport: "http",
      http: {
        url: "https://mcp.linear.app/mcp",
        headers: {},
        auth: {
          kind: "oauth2",
          issuer: "https://linear.app",
          client_id: "cid",
          client_credential: null,
          scopes: [],
        },
      },
    },
    null,
  );
  assert.deepEqual(
    mcpMissingSlot(oauthServer, {
      state: "failed_auth",
      missing_secret: null,
    }),
    { mcp: "linear", part: "sign_in" },
  );
});
