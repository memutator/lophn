// lophn-agent/extensions: runtime child의 `--allow-net` 중 MCP 몫이다(architecture §2.3). 사람이
// enabled로 등록한 HTTP server의 정확한 host:port만 나오고 stdio·꺼진 server·일반 net은 없다.
import { assert, assertEquals } from "@std/assert";
import { mcpServersSetting } from "../../contracts/lophn-agent/mod.ts";
import { allowNetList } from "./mod.ts";
import { httpEndpointReason } from "./mcp-config.ts";
import { endpointReason } from "./adapters/mcp-http.ts";

function server(
  name: string,
  url: string,
  enabled = true,
) {
  return {
    name,
    revision: 1,
    enabled,
    transport: "http",
    call_timeout_ms: 60_000,
    classifications: {},
    http: { url, headers: {}, auth: { kind: "none" } },
  };
}

Deno.test("lophn-agent/extensions#R13 lophn-agent/extensions#R15: allow-net은 enabled HTTP server의 정확한 host:port만이고 stdio·꺼진 server·같은 host의 다른 port는 없다", () => {
  const servers = mcpServersSetting.value_type.parse([
    server("local", "http://127.0.0.1:8123/rpc"),
    server("local-same", "http://127.0.0.1:8123/other"),
    server("remote", "https://mcp.example.test/rpc"),
    server("remote-port", "https://mcp2.example.test:8443/rpc"),
    server("off", "https://off.example.test/rpc", false),
    {
      name: "notes",
      revision: 1,
      enabled: true,
      transport: "stdio",
      call_timeout_ms: 60_000,
      classifications: {},
      stdio: { executable: "/bin/sh", args: [], cwd: null, env: {} },
    },
  ]);
  assertEquals(allowNetList(servers), [
    "127.0.0.1:8123",
    "mcp.example.test:443",
    "mcp2.example.test:8443",
  ]);
  assertEquals(allowNetList([]), []);
});

Deno.test("lophn-agent/extensions#R15: IPv6 loopback [::1]은 평문 http로 허락하고 다른 IPv6 주소는 거절이다", () => {
  for (const check of [httpEndpointReason, endpointReason]) {
    assertEquals(check("http://[::1]:8123/rpc"), null);
    assertEquals(check("http://[::1]/rpc"), null);
    assert(check("http://[::2]:8123/rpc") !== null);
    assert(check("http://[fe80::1]:8123/rpc") !== null);
    assert(check("http://[2001:db8::1]:8123/rpc") !== null);
  }
});

Deno.test("lophn-agent/extensions#R13: allow-net의 IPv6 loopback은 Deno가 받는 [::1]:port 모양이다", () => {
  const servers = mcpServersSetting.value_type.parse([
    server("v6", "http://[::1]:8123/rpc"),
    server("v6-default", "https://[2001:db8::1]/rpc"),
  ]);
  assertEquals(allowNetList(servers), [
    "[2001:db8::1]:443",
    "[::1]:8123",
  ]);
});

Deno.test("lophn-agent/extensions#R16 #R17 [agent-I52]: allow-net에는 켜진 OAuth server의 발급자 host:port도 있고 꺼진 server·다른 인증 방식의 것은 없다", () => {
  const oauth = (name: string, issuer: string, enabled = true) => ({
    ...server(name, "https://mcp.example.test/rpc", enabled),
    http: {
      url: "https://mcp.example.test/rpc",
      headers: {},
      auth: {
        kind: "oauth2",
        issuer,
        client_id: "lophn",
        client_secret_ref: null,
        scopes: [],
        token_ref: null,
      },
    },
  });
  const servers = mcpServersSetting.value_type.parse([
    oauth("one", "https://issuer.example.test"),
    oauth("two", "https://auth.example.test:8443"),
    oauth("off", "https://off-issuer.example.test", false),
    server("plain", "https://plain.example.test/rpc"),
  ]);
  assertEquals(allowNetList(servers), [
    "auth.example.test:8443",
    "issuer.example.test:443",
    "mcp.example.test:443",
    "plain.example.test:443",
  ]);
});
