// MCP protocol 테스트다(R1, R6, R7). initialize·tools/list는 core에 닿지 않고
// 답하는지, protocol 오류 분류와 실행 전 isError를 본다. stream을 끼우지 않고
// handler에 줄을 바로 넣는다.
import { assertEquals } from "@std/assert";
import { createHandler, STARTUP_BUDGET_MS } from "./server.ts";

const call = {
  summary: "3 documents",
  data: { documents: ["notes/plan"] },
  next: ["lophn document show notes/plan"],
};

type AgentResultView = { summary: string; data: unknown; next: unknown };

function resultOf(sent: { result?: unknown } | undefined) {
  return sent?.result as {
    structuredContent?: AgentResultView;
    isError?: boolean;
    tools?: { name: string }[];
    protocolVersion?: string;
    serverInfo?: { name: string; version: string };
    capabilities?: unknown;
  };
}

function deps(calls: { tool?: string; args?: unknown }[] = []) {
  let clientName: string | undefined;
  return {
    handler: createHandler({
      toolsets: ["core"],
      onClientInfo: (name) => {
        clientName = name;
      },
      callTool: async (toolName, args) => {
        calls.push({ tool: toolName, args });
        return call;
      },
    }),
    clientName: () => clientName,
    calls,
  };
}

Deno.test(
  "coding-agent/mcp-server#R1: initialize는 clientInfo.name을 붙잡고 protocol 버전을 그대로 돌려준다",
  async () => {
    const names: (string | undefined)[] = [];
    const handler = createHandler({
      toolsets: ["core"],
      onClientInfo: (name) => {
        names.push(name);
      },
      callTool: async () => call,
    });
    const sent = await handler(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          clientInfo: { name: "codex-mcp-client" },
        },
      }),
    );
    const result = resultOf(sent);
    assertEquals(result.protocolVersion, "2025-06-18");
    assertEquals(result.serverInfo, { name: "lophn-mcp", version: "0.1.0" });
    assertEquals(result.capabilities, { tools: { listChanged: false } });
    assertEquals(sent?.id, 1);
    // label 표시 순서의 마지막 항목이다(connection#R3).
    assertEquals(names, ["codex-mcp-client"]);
  },
);

Deno.test("coding-agent/mcp-server#R1: tools/list는 core에 닿지 않고 답한다", async () => {
  let coreTouches = 0;
  const handler = createHandler({
    toolsets: ["core"],
    callTool: async () => {
      coreTouches++;
      return call;
    },
  });
  const before = Date.now();
  const sent = await handler(
    JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
  );
  const elapsed = Date.now() - before;
  const tools = resultOf(sent).tools ?? [];
  assertEquals(tools.some((tool) => tool.name === "lophn_index"), true);
  assertEquals(tools.some((tool) => tool.name === "lophn_app"), false);
  assertEquals(coreTouches, 0);
  // 기동부터 tools/list 응답까지 2,000ms 안(R1).
  assertEquals(elapsed <= STARTUP_BUDGET_MS, true);
});

Deno.test("coding-agent/mcp-server#R1: notification(id 없는 요청)은 응답을 내지 않는다", async () => {
  const handler = createHandler({
    toolsets: ["core"],
    callTool: async () => call,
  });
  const sent = await handler(
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  );
  assertEquals(sent, undefined);
});

Deno.test("coding-agent/mcp-server#R7: protocol 오류는 parse·request·method·params를 구별한다", async () => {
  const handler = createHandler({
    toolsets: ["core"],
    callTool: async () => call,
  });
  const parse = await handler("{not json");
  assertEquals(parse?.error?.code, -32700);
  const invalid = await handler(JSON.stringify({ id: 3, method: "x" }));
  assertEquals(invalid?.error?.code, -32600);
  assertEquals(invalid?.id, 3);
  const method = await handler(
    JSON.stringify({ jsonrpc: "2.0", id: 4, method: "logging/setLevel" }),
  );
  assertEquals(method?.error?.code, -32601);
  const params = await handler(
    JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/call" }),
  );
  assertEquals(params?.error?.code, -32602);
});

Deno.test("coding-agent/mcp-server#R2: tools/call은 registry route로만 dispatch한다", async () => {
  const calls: { tool?: string; args?: unknown }[] = [];
  const { handler } = deps(calls);
  // lophn_read는 op 없는 단일 동작 tool이다.
  const sent = await handler(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "lophn_read",
        arguments: {
          reference: {
            document: "doc_01h455vb4pex5v6nkc6gd5fdw1",
            version: "ver_01h455vb4pex5v6nkc6gd5fdw1",
            section: null,
          },
        },
      },
    }),
  );
  assertEquals(calls.some((item) => item.tool === "lophn_read"), true);
  const result = resultOf(sent);
  assertEquals(result.isError, undefined);
  assertEquals(result.structuredContent, {
    ...call,
    next: ["lophn document show notes/plan"],
  });
});

Deno.test(
  "coding-agent/mcp-server#R6: 표에 없는 op는 실행 전 isError이고 이유와 tool을 남긴다",
  async () => {
    const calls: { tool?: string; args?: unknown }[] = [];
    const { handler } = deps(calls);
    // lophn_index에는 home op가 없다.
    const sent = await handler(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "lophn_index", arguments: { op: "home" } },
      }),
    );
    assertEquals(calls, []);
    const result = resultOf(sent);
    assertEquals(result.isError, true);
    assertEquals(result.structuredContent?.summary, "tool 표에 없는 op다");
    assertEquals(
      (
        result.structuredContent?.data as {
          details?: { tool?: string };
        }
      ).details?.tool,
      "lophn_index",
    );
  },
);

Deno.test(
  "coding-agent/mcp-server#R6: 필수 값이 빈 tool 입력은 실행 전 isError다",
  async () => {
    const calls: { tool?: string; args?: unknown }[] = [];
    const { handler } = deps(calls);
    const sent = await handler(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: { name: "lophn_save", arguments: {} },
      }),
    );
    assertEquals(calls, []);
    const result = resultOf(sent);
    assertEquals(result.isError, true);
  },
);
