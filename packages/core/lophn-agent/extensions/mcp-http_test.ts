// lophn-agent/extensions#R13 #R15: 제품 runtime의 MCP 연결 눈(`mcpConnectionsDeps`)이 HTTP server에
// 닿는다. 실제 외부 service 없이 이 시험이 연 localhost fake Streamable HTTP MCP server만 쓴다.
import { assert, assertEquals } from "@std/assert";
import { mcpServersSetting } from "../../../protocol/lophn-agent/mod.ts";
import { createMcpConnections } from "./mod.ts";
import { mcpConnectionsDeps } from "../../main/agent-runtime/product-driver.ts";

Deno.test("lophn-agent/extensions#R13 lophn-agent/extensions#R15: 제품 runtime의 MCP 연결 눈은 등록한 localhost HTTP server에 연결해 도구 목록을 읽는다", async () => {
  const seen: string[] = [];
  const fake = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    async (request) => {
      const body = JSON.parse(await request.text()) as {
        id?: number;
        method: string;
      };
      seen.push(body.method);
      if (body.id === undefined) return new Response(null, { status: 202 });
      const result = body.method === "initialize"
        ? {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "fake-http", version: "0" },
        }
        : {
          tools: [{
            name: "read_note",
            description: "read a note",
            inputSchema: { type: "object", properties: {} },
          }],
        };
      return Response.json({ jsonrpc: "2.0", id: body.id, result });
    },
  );
  const connections = createMcpConnections(mcpConnectionsDeps());
  try {
    const [config] = mcpServersSetting.value_type.parse([{
      name: "notes",
      revision: 1,
      enabled: true,
      transport: "http",
      call_timeout_ms: 60_000,
      classifications: {},
      http: {
        url: `http://127.0.0.1:${fake.addr.port}/rpc`,
        headers: {},
        auth: { kind: "none" },
      },
    }]);
    const acquired = await connections.acquire(
      "asg-1",
      config!,
      new AbortController().signal,
    );
    assert(
      acquired.ok,
      acquired.ok ? "" : `연결하지 못했다: ${acquired.error.message}`,
    );
    const listed = await connections.toolList("asg-1", "notes");
    assert(listed.ok, listed.ok ? "" : listed.error.message);
    assertEquals(listed.value.tools.map((tool) => tool.original), [
      "read_note",
    ]);
    assert(seen.includes("initialize") && seen.includes("tools/list"));
  } finally {
    await connections.endAssignment("asg-1");
    await fake.shutdown();
  }
});
