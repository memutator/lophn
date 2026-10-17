import { assertEquals } from "@std/assert";
import { mcpServerSchema } from "./mcp-settings.ts";

Deno.test("MCP 설정은 mcp. 밖의 secret 이름과 stdio env의 secret을 받지 않는다", () => {
  const http = (auth: unknown, headers: unknown = {}) => ({
    name: "srv",
    enabled: true,
    call_timeout_ms: 60_000,
    transport: "http",
    http: { url: "https://mcp.example.com", headers, auth },
  });
  const stdio = (env: unknown) => ({
    name: "srv",
    enabled: true,
    call_timeout_ms: 60_000,
    transport: "stdio",
    stdio: { executable: "/usr/bin/srv", args: [], cwd: null, env },
  });
  const secret = (name: string) => ({ secret: name });
  const cases = [
    [
      "bearer mcp.",
      http({ kind: "bearer", credential: secret("mcp.global.srv") }),
      true,
    ],
    [
      "bearer provider.",
      http({ kind: "bearer", credential: secret("provider.p1") }),
      false,
    ],
    [
      "api_key 앞머리 없음",
      http({
        kind: "api_key",
        credential: secret("srv-key"),
        header_name: "x-key",
      }),
      false,
    ],
    [
      "header mcp-oauth.",
      http({ kind: "none" }, {
        "x-token": secret("mcp-oauth.global.srv.access"),
      }),
      false,
    ],
    [
      "oauth2 client provider.",
      http({
        kind: "oauth2",
        issuer: "https://id.example.com",
        client_id: "c",
        client_credential: secret("provider.p1"),
        scopes: [],
      }),
      false,
    ],
    ["stdio env 값", stdio({ TOKEN: { value: "plain" } }), true],
    ["stdio env secret", stdio({ TOKEN: secret("mcp.global.srv") }), false],
  ] as const;
  for (const [label, server, accepted] of cases) {
    assertEquals(
      [label, mcpServerSchema.safeParse(server).success],
      [label, accepted],
    );
  }
});
