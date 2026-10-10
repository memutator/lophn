// lophn-agent/extensions: runtime child의 `--allow-net` 중 MCP 몫이다(architecture §2.3). 사람이
// enabled로 등록한 HTTP server의 정확한 host:port만 나오고 stdio·꺼진 server·일반 net은 없다.
import { assertEquals } from "@std/assert";
import { mcpServersSetting } from "../../contracts/lophn-agent/mod.ts";
import { allowNetList } from "./mod.ts";

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
