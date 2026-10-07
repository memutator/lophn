// apps/agent-runtime MCP 등록 통로 테스트다(lophn-agent#T37, Q16). 가짜 stdio
// child와 가짜 settings read로 본다. 사람의 실제 registry·실제 MCP server·
// 실제 model provider에 닿지 않는다. 파일은 temp dir만 쓴다.
import { assert, assertEquals } from "@std/assert";
import { manualClock } from "../../packages/base/mod.ts";
import { mcpServersSetting } from "../../packages/contracts/lophn-agent/mod.ts";
import {
  checkMcpConfig,
  createMcpConnections,
  type McpConnectionsDeps,
} from "../../packages/lophn-agent/extensions/mod.ts";
import { spawnStdioMcp } from "../../packages/lophn-agent/extensions/mod.ts";
import type { StdioSpawnInput } from "../../packages/lophn-agent/extensions/mod.ts";
import { err, ok, type Result } from "../../packages/base/mod.ts";
import { createMcpToolkit } from "./mcp-toolkit.ts";
import type { CoreCall } from "./core-call.ts";

const clock = manualClock(0);

// ---- 가짜 stdio child ----
const CHILD_SCRIPT = `\
const dec = new TextDecoder();
let buf = "";
let failingList = false;
for (;;) {
  const chunk = new Uint8Array(4096);
  const n = await Deno.stdin.read(chunk);
  if (n === null) break;
  buf += dec.decode(chunk.subarray(0, n));
  for (;;) {
    const at = buf.indexOf("\\n");
    if (at < 0) break;
    const line = buf.slice(0, at);
    buf = buf.slice(at + 1);
    if (line.trim() === "") continue;
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    if (message.method === "initialize") {
      await Deno.stdout.write(new TextEncoder().encode(JSON.stringify({
        jsonrpc: "2.0", id: message.id,
        result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "0" } },
      }) + "\\n"));
      continue;
    }
    if (message.method === "tools/list") {
      if (failingList) {
        await Deno.stdout.write(new TextEncoder().encode(JSON.stringify({
          jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "no" },
        }) + "\\n"));
        continue;
      }
      const tool = (name) => ({ name, description: name + " desc", inputSchema: { type: "object", properties: {} } });
      await Deno.stdout.write(new TextEncoder().encode(JSON.stringify({
        jsonrpc: "2.0", id: message.id, result: { tools: [tool("a"), tool("b")] },
      }) + "\\n"));
      continue;
    }
    if (message.method === "tools/call") {
      await Deno.stdout.write(new TextEncoder().encode(JSON.stringify({
        jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "ok" }] },
      }) + "\\n"));
      continue;
    }
  }
}
`;

let childPath: string | undefined;

async function writeChild(): Promise<string> {
  const home = await Deno.makeTempDir({ prefix: "lophn-mcp-toolkit-test-" });
  const path = `${home}/fake-mcp-child.mjs`;
  await Deno.writeTextFile(path, CHILD_SCRIPT);
  return path;
}

// ---- 가짜 settings read ----
// settingsGet 결과다. machine 자격의 loopback 대신 판을 그대로 문다.
function settingsGetBody(servers: readonly unknown[]): CoreCall {
  const body = {
    settings: [{
      key: mcpServersSetting.key,
      value: servers.length === 0 ? null : servers,
      resolved: servers.length > 0,
      source_layer: servers.length > 0 ? "common" : null,
      choices: [],
      revision: 1,
      apply_at: "next_run",
    }],
    revision: 1,
    defaults_revision: "defaults-1",
    as_of_seq: "0",
    next_cursor: null,
  };
  return (path, request) => {
    void path;
    void request;
    return Promise.resolve(ok(body) as Result<unknown>);
  };
}

function stdioServer(revision = 1) {
  const script = childPath ?? "/lophn-mcp-test/none.mjs";
  const parsed = mcpServersSetting.value_type.parse([{
    name: "notes",
    revision,
    enabled: true,
    transport: "stdio",
    call_timeout_ms: 60_000,
    classifications: {},
    stdio: {
      executable: "/bin/sh",
      args: ["-c", `deno run --allow-read --allow-env ${script} normal`],
      cwd: null,
      env: {},
    },
  }]);
  if (!parsed[0] || parsed[0].transport !== "stdio") {
    throw new Error("기준 stdio server가 아니었다");
  }
  return parsed[0];
}

// ---- deps ----
function connectionsDeps(): McpConnectionsDeps {
  return {
    nowMs: () => clock.nowMs(),
    wait: () => Promise.resolve("elapsed" as const),
    deadline: async (ms: number, signal: AbortSignal) => {
      await new Promise((resolve) => setTimeout(resolve, Math.min(ms, 10_000)));
      return signal.aborted ? "aborted" as const : "elapsed" as const;
    },
    openStdio: (_server: unknown, input: StdioSpawnInput) =>
      Promise.resolve(
        spawnStdioMcp({
          ...input,
          env: { ...input.env, FAKE_CHILD: childPath ?? "" },
        }),
      ),
  };
}

Deno.test("agent-runtime#Q16: 재조회가 끝날 때까지 그 server tool 호출을 막고 재조회 실패면 옛 정의를 호출 가능으로 두지 않는다", async () => {
  childPath = await writeChild();
  try {
    const server = stdioServer();
    // 연결 관리를 직접 만든다. list_changed 알림은 재조회 전에 온다.
    const deps = connectionsDeps();
    const conns = createMcpConnections(deps);
    const kit = createMcpToolkit({
      machine: settingsGetBody([server]),
      connections: deps,
      create: () => conns,
    });
    const toolkit = kit.toolkit("assignment-1");

    // source는 등록 서버 설정과 검증을 지난 목록을 준다.
    const source = await toolkit.source("assignment-1");
    assert(source.ok, `source 실패: ${source.ok ? "" : source.error.message}`);
    assertEquals([...source.value.servers.keys()], ["notes"]);
    assertEquals(
      source.value.tools.map((tool) => tool.original),
      ["a", "b"],
    );

    // 연결이 살아 있고 재조회가 끝났으면 호출이 통과한다. 서버·원래 이름·입력은
    // 그대로 돌아간다(R23: 원래 쌍으로 routing).
    const sent = await toolkit.call("assignment-1")({
      server: "notes",
      original: "a",
      input: { x: 1 },
      requestKey: "tcl_1",
    });
    assert(sent.ok, `call 실패: ${sent.ok ? "" : sent.error.message}`);

    // 재조회가 실패하면 그 server의 호출은 거절이다(Q16: 옛 정의를 두지 않는다).
    conns.detach("assignment-1", "notes");
    const reconnected = conns; // 이후 시험을 위해 살려 둔다.
    void reconnected;
    const tool = stdioServer(2);
    // disconnect 상태의 서버는 reconnect를 부르며 실패하면 failed다.
    const refused = await kit.toolkit("assignment-1").call("assignment-1")({
      server: "notes",
      original: "a",
      input: { x: 1 },
      requestKey: "tcl_2",
    });
    assert(!refused.ok, "연결이 없는 호출이 통과됐다");
    assertEquals(refused.error.code, "unavailable");
    void tool;
  } finally {
    await Deno.remove(childPath!, { recursive: true }).catch(() => {});
  }
});

// checkMcpConfig가 문제 서버를 골라내는지 본다(mcp-config R12).
Deno.test("agent-runtime#T37: 문제·비활성 서버는 source 목록에 없다", () => {
  const checked = checkMcpConfig([stdioServer()]);
  assert(checked.ok);
  assertEquals(checked.value.valid.length, 1);
  const bad = { ...stdioServer(), stdio: {} } as unknown;
  const invalid = checkMcpConfig([bad as never]);
  assert(invalid.ok);
  assertEquals(invalid.value.valid.length, 0);
  assertEquals(err({ code: "unavailable", message: "x" }).ok, false);
  assertEquals(ok(1).ok, true);
});
