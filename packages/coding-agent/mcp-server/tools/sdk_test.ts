// lophn_sdk tool 테스트다(T22, mcp#R22·R23). discovery·입력 검사·route 해석을 server 경계에서
// 보고, 실행은 route별 답을 정한 흐름 client로 한다.
import { assert, assertEquals } from "@std/assert";
import { scriptedFlow } from "../../connection/testing/mod.ts";
import { createHandler, type JsonRpcResponse } from "../server.ts";
import { resolveRoute, toolEntries } from "../registry.ts";
import { createSdkTool } from "./sdk.ts";

const APP = "app_01arz3ndektsv4rrffq69g5fav";

const PACKAGE = {
  id: "pkg_01arz3ndektsv4rrffq69g5fav",
  name: "@lophn/ui-table",
  description: "정렬과 선택이 되는 표 component",
  kind: "component",
  versions: [
    {
      version: "1.2.0",
      bundle_hash: "a".repeat(64),
      guide_hash: "b".repeat(64),
    },
  ],
};

function setup() {
  const flow = scriptedFlow({
    "packages.list": { packages: [PACKAGE], as_of_seq: 1, next_cursor: null },
    "packages.versions": {
      name: PACKAGE.name,
      versions: PACKAGE.versions,
      as_of_seq: 1,
      next_cursor: null,
    },
    "packages.guide": {
      name: PACKAGE.name,
      version: "1.2.0",
      guide_hash: "b".repeat(64),
      as_of_seq: 1,
      next_cursor: null,
    },
  });
  const tool = createSdkTool({ client: flow.client });
  const handler = createHandler({
    toolsets: ["core", "app"],
    notify: () => {},
    callTool: (name, args) => {
      const route = resolveRoute(name, (args as { op?: string }).op)!.route;
      return tool(name, route, args);
    },
  });
  async function call(args: Record<string, unknown>): Promise<JsonRpcResponse> {
    const response = await handler(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "lophn_sdk", arguments: args },
    }));
    assert(response !== undefined);
    return response;
  }
  return { flow, call };
}

function resultOf(response: JsonRpcResponse) {
  return response.result as {
    isError?: boolean;
    structuredContent?: { summary: string; data: Record<string, unknown> };
  };
}

Deno.test("coding-agent/mcp-server#R22: lophn_sdk는 app toolset에만 있고 catalog·show·add와 검색어·apply 입력을 낸다", () => {
  assert(!toolEntries(["core"]).some((entry) => entry.name === "lophn_sdk"));
  const entry = toolEntries(["core", "app"]).find((item) =>
    item.name === "lophn_sdk"
  );
  assert(entry);
  const schema = entry.inputSchema as {
    properties: Record<string, { enum?: string[] }>;
  };
  assertEquals(schema.properties.op.enum, ["catalog", "show", "add"]);
  for (const field of ["name", "query", "version", "apply", "app"]) {
    assert(field in schema.properties, field);
  }
  assertEquals(
    resolveRoute("lophn_sdk", "catalog")?.route.name,
    "packages.list",
  );
  assertEquals(
    resolveRoute("lophn_sdk", "show")?.route.name,
    "packages.versions",
  );
  assertEquals(resolveRoute("lophn_sdk", "add")?.route.name, "packages.guide");
});

Deno.test("coding-agent/mcp-server#R22: catalog 검색 결과는 structuredContent에 이름·최신 version·종류·설명이다", async () => {
  const { call } = setup();
  const result = resultOf(await call({ op: "catalog", query: "표" }));
  assertEquals(result.isError, undefined);
  assertEquals(result.structuredContent?.data.packages, [{
    name: "@lophn/ui-table",
    latest_version: "1.2.0",
    kind: "component",
    description: "정렬과 선택이 되는 표 component",
    support: "supported",
  }]);
});

Deno.test("coding-agent/mcp-server#R23: 범위 version add는 core에 닿기 전에 isError다", async () => {
  const { flow, call } = setup();
  const response = await call({
    op: "add",
    name: "@lophn/ui-table",
    version: "^1.2.0",
  });
  assertEquals(resultOf(response).isError, true);
  assertEquals(flow.sent.length, 0);
});

Deno.test("coding-agent/mcp-server#R23: MCP add는 고정 import 안내를 내고 apply는 source 쓰기 통로 없이 거절한다", async () => {
  const { call } = setup();
  const guide = resultOf(
    await call({ op: "add", name: "@lophn/ui-table", version: "1.2.0" }),
  );
  assertEquals(guide.isError, undefined);
  assertEquals(
    guide.structuredContent?.data.import_key,
    "lophn-sdk:@lophn/ui-table@1.2.0",
  );
  const applied = resultOf(
    await call({
      op: "add",
      name: "@lophn/ui-table",
      version: "1.2.0",
      apply: true,
      app: APP,
    }),
  );
  assertEquals(applied.isError, true);
  assertEquals(applied.structuredContent?.data.code, "unavailable");
});
