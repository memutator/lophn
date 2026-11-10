import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../../base/mod.ts";
import type { McpServer } from "../../../protocol/lophn-agent/mod.ts";
import { createMcpToolkit } from "./mcp-toolkit.ts";
import type { McpConnections } from "./mod.ts";

const workspace = {
  kind: "project",
  id: "prj_01h455vb4pex5v6nkc6gd5fd01",
} as const;

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
// projectOff는 project 층의 mcp_off다. 테스트가 session 도중 바꾼다.
function toolkit(connected: string[], projectOff: string[] = []) {
  const connections = {
    acquire: (_assignment: string, server: { name: string }) => {
      connected.push(server.name);
      return Promise.resolve(ok({}));
    },
    toolList: () =>
      Promise.resolve(ok({ tools: [], hash: "h", protocol_version: "v" })),
    call: () => Promise.resolve({ kind: "success", result: "done" }),
  } as unknown as McpConnections;
  const settings = [
    {
      key: "lophn-agent.extensions.mcp_servers",
      description: "t",
      type: {},
      chosen: [stdioServer("shared")],
    },
  ];
  return createMcpToolkit({
    machine: (path) =>
      Promise.resolve(
        ok(
          path === "/workspace-extension-settings/read"
            ? {
                workspace: workspace.id,
                mcp_servers: [],
                skills_off: [],
                mcp_off: projectOff,
                hash: null,
                as_of_seq: "0",
                next_cursor: null,
              }
            : { settings, folders: [] },
        ),
      ),
    connections: {} as never,
    create: () => connections,
  }).toolkit("asg");
}

test("agent 정의 층의 server는 그 agent의 turn 준비에만 연결된다", async () => {
  const own = {
    id: "agt_00000000000000000000000001" as const,
    servers: [stdioServer("mine")],
    off: ["shared"],
  };

  const withLayer: string[] = [];
  await toolkit(withLayer).source("a", { workspace, agent: own });
  const without: string[] = [];
  await toolkit(without).source("b", { workspace });

  // 정의 층이 있는 호출만 자기 server를 연결하고, 아래 층에서 끈 이름은 합친 목록에서 빠진다.
  assert.deepEqual(withLayer, ["mine"]);
  assert.deepEqual(without, ["shared"]);
});

test("session 도중 끈 MCP server의 tool은 그 session에서 부르면 거절된다", async () => {
  const projectOff: string[] = [];
  const kit = toolkit([], projectOff);
  await kit.source("asg", { workspace });
  const call = kit.call("asg");
  const invoke = { server: "shared", original: "t", input: {} } as never;

  assert.equal((await call(invoke)).ok, true);
  projectOff.push("shared");
  assert.equal((await call(invoke)).ok, false);
});
