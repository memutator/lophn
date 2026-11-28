import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../../base/mod.ts";
import type { McpServer } from "../../../protocol/lophn-agent/mod.ts";
import type { StdioSpawn } from "./adapters/mcp-stdio.ts";
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

// 전역 설정은 서버 `shared` 하나다.
function machineOf(projectOff: string[]) {
  const settings = [
    {
      key: "lophn-agent.extensions.mcp_servers",
      description: "t",
      type: {},
      chosen: [stdioServer("shared")],
    },
  ];
  return (path: string) =>
    Promise.resolve(
      ok(
        path === "/workspace-extension-settings/read"
          ? {
              workspace: workspace.id,
              mcp_servers: [],
              skills_off: [],
              deployed_skills: [],
              mcp_off: projectOff,
              hash: null,
              as_of_seq: "0",
              next_cursor: null,
            }
          : { settings, folders: [] },
      ),
    ) as never;
}

// 연결 대상만 기록하는 가짜 연결 관리.
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
  return createMcpToolkit({
    machine: machineOf(projectOff),
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

// 줄 단위 JSON-RPC로 답하는 가짜 server process다. initialize·tools/list에는 답하고
// tools/call은 answerCall이 true일 때만 답한다. exit()가 process 종료다(stdout은 열려 있다: 손자가 쥔 pipe).
function fakeProcess(answerCall: boolean) {
  const out = new TransformStream<Uint8Array, Uint8Array>();
  const outWriter = out.writable.getWriter();
  const encoder = new TextEncoder();
  const reply = (id: unknown, result: unknown) =>
    outWriter.write(
      encoder.encode(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`),
    );
  let exit!: (value: { code: number | null; signal: string | null }) => void;
  const exited = new Promise<{ code: number | null; signal: string | null }>(
    (resolve) => {
      exit = resolve;
    },
  );
  let sawCall!: () => void;
  const called = new Promise<void>((resolve) => {
    sawCall = resolve;
  });
  let buffer = "";
  const spawn: StdioSpawn = {
    pid: 1,
    stdin: new WritableStream<Uint8Array>({
      async write(chunk) {
        buffer += new TextDecoder().decode(chunk);
        for (;;) {
          const at = buffer.indexOf("\n");
          if (at < 0) return;
          const message = JSON.parse(buffer.slice(0, at)) as {
            id?: number;
            method: string;
          };
          buffer = buffer.slice(at + 1);
          if (message.id === undefined) continue;
          if (message.method === "initialize") {
            await reply(message.id, { protocolVersion: "2025-06-18" });
          } else if (message.method === "tools/list") {
            await reply(message.id, {
              tools: [{ name: "t", inputSchema: { type: "object" } }],
            });
          } else if (message.method === "tools/call") {
            sawCall();
            if (answerCall) {
              await reply(message.id, {
                content: [{ type: "text", text: "hi" }],
              });
            }
          }
        }
      },
    }),
    stdout: out.readable,
    stderrText: () => "",
    exited,
    close: () => Promise.resolve(),
    kill: () => Promise.resolve(),
  };
  return { spawn, exit, called };
}

// 진짜 연결 관리에 가짜 process를 끼운다. 기다림은 없고, 호출 기한(60초)만 `fire`가 풀릴 때 끝난다.
function realToolkit(
  spawns: ReturnType<typeof fakeProcess>[],
  fire: Promise<void>,
) {
  let opened = 0;
  const kit = createMcpToolkit({
    machine: machineOf([]),
    connections: {
      nowMs: () => 0,
      wait: () => Promise.resolve("elapsed"),
      deadline: (ms, signal) =>
        ms === 60_000
          ? Promise.race([
              fire.then(() => "elapsed" as const),
              new Promise<"aborted">((resolve) =>
                signal.addEventListener("abort", () => resolve("aborted")),
              ),
            ])
          : new Promise<"aborted">((resolve) =>
              signal.addEventListener("abort", () => resolve("aborted")),
            ),
      openStdio: () => Promise.resolve(ok(spawns[opened++]!.spawn)),
    },
  }).toolkit("asg");
  return { kit, opened: () => opened };
}

const invokeShared = { server: "shared", original: "t", input: {} } as never;

test("stdio MCP server process가 끝나면 다음 호출은 다시 연결해 실행되고 결과 불명으로 끝나지 않는다", async () => {
  const first = fakeProcess(true);
  const second = fakeProcess(true);
  const { kit, opened } = realToolkit([first, second], new Promise(() => {}));
  await kit.source("asg", { workspace });

  first.exit({ code: 1, signal: null });
  await new Promise((resolve) => setImmediate(resolve));
  const called = await kit.call("asg")(invokeShared);

  assert.equal(opened(), 2);
  assert.deepEqual(called.ok && called.value.kind, "answered");
});

test("보낸 뒤 기한 안에 답이 없는 MCP 호출은 uncertain으로 끝난다", async () => {
  const silent = fakeProcess(false);
  let fire!: () => void;
  const { kit } = realToolkit(
    [silent],
    new Promise<void>((resolve) => {
      fire = resolve;
    }),
  );
  await kit.source("asg", { workspace });

  const pending = kit.call("asg")(invokeShared);
  await silent.called;
  fire();
  const called = await pending;

  assert.deepEqual(called.ok && called.value.kind, "uncertain");
});

test("MCP tools/call이 401(auth_failed)이면 details.missing에 sign_in 안내를 담아 돌려준다", async () => {
  const oauthServer: McpServer = {
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
  };
  const connections = {
    acquire: () => Promise.resolve(ok({})),
    toolList: () =>
      Promise.resolve(ok({ tools: [], hash: "h", protocol_version: "v" })),
    call: () =>
      Promise.resolve({
        kind: "auth_failed",
        message: "MCP server returned 401",
      }),
  } as unknown as McpConnections;
  const kit = createMcpToolkit({
    machine: (path: string) =>
      Promise.resolve(
        ok(
          path === "/workspace-extension-settings/read"
            ? {
                workspace: workspace.id,
                mcp_servers: [],
                skills_off: [],
                mcp_off: [],
                deployed_skills: [],
                hash: null,
                as_of_seq: "0",
                next_cursor: null,
              }
            : {
                settings: [
                  {
                    key: "lophn-agent.extensions.mcp_servers",
                    description: "t",
                    type: {},
                    chosen: [oauthServer],
                  },
                ],
                folders: [],
              },
        ),
      ) as never,
    connections: {} as never,
    create: () => connections,
  }).toolkit("asg");

  await kit.source("asg", { workspace });
  const called = await kit.call("asg")({
    server: "linear",
    original: "list_issues",
    input: {},
  } as never);
  assert.equal(called.ok, false);
  if (!called.ok) {
    assert.deepEqual(called.error.details, {
      missing: { mcp: "linear", part: "sign_in" },
    });
  }
});
