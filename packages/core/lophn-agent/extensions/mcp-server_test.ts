import assert from "node:assert/strict";
import { test } from "node:test";
import type { McpServer } from "../../../protocol/lophn-agent/mod.ts";
import { mcpSecretDestinations, runtimeServerOfLayer } from "./mcp-server.ts";

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
  const servers = layers.map(([secret, url, place]) =>
    runtimeServerOfLayer(httpServer(secret, url), place)
  );
  for (const [secret, url] of layers) {
    const origins = mcpSecretDestinations(servers, secret).map((one) =>
      JSON.stringify(one)
    );
    assert.equal(origins.length, 1, secret);
    assert.ok(origins[0]!.includes(new URL(url).host), secret);
  }
});
