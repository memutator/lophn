import { assertEquals } from "@std/assert";
import { ok } from "../../../base/mod.ts";
import type { McpServer } from "../../../protocol/lophn-agent/mod.ts";
import { createMcpToolkit } from "./mcp-toolkit.ts";
import type { McpConnections } from "./mod.ts";

function stdioServer(name: string): McpServer {
  return {
    name,
    enabled: true,
    call_timeout_ms: 60_000,
    transport: "stdio",
    stdio: { executable: `/bin/${name}`, args: [], cwd: null, env: {} },
  };
}

// 연결 대상만 기록하는 가짜 연결 관리. 전역 설정은 서버 `shared` 하나다.
function toolkit(connected: string[]) {
  const connections = {
    acquire: (_assignment: string, server: { name: string }) => {
      connected.push(server.name);
      return Promise.resolve(ok({}));
    },
    toolList: () =>
      Promise.resolve(ok({ tools: [], hash: "h", protocol_version: "v" })),
  } as unknown as McpConnections;
  const settings = [{
    key: "lophn-agent.extensions.mcp_servers",
    type: {},
    chosen: [stdioServer("shared")],
  }];
  return createMcpToolkit({
    machine: () => Promise.resolve(ok({ settings })),
    operatorRef: (agent) => ({ role: "operator", agent }) as never,
    connections: {} as never,
    create: () => connections,
  }).toolkit("asg");
}

Deno.test("Operator 정의 층의 server는 그 Operator의 turn 준비에만 연결된다", async () => {
  const place = {
    kind: "project",
    id: "prj_01h455vb4pex5v6nkc6gd5fd01",
  } as const;
  const own = { servers: [stdioServer("mine")], off: ["shared"] };

  const withLayer: string[] = [];
  await toolkit(withLayer).source("a", { place, agent: own });
  const without: string[] = [];
  await toolkit(without).source("b", { place });

  // 정의 층이 있는 호출만 자기 server를 연결하고, 아래 층에서 끈 이름은 합친 목록에서 빠진다.
  assertEquals(withLayer, ["mine"]);
  assertEquals(without, ["shared"]);
});
