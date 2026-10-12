// coding-agent#T15: 금지 동작이 MCP discovery에 없고 직접 요청도 실행 전에 거절된다
// (mcp-server#R30, R31). core에 닿지 않는다. daemon 쪽 거절은
// packages/core/apps/connections/scope_test.ts가 실제 core로 본다.
import { assert, assertEquals } from "@std/assert";
import { contractRoutesByName } from "../connection/testing/mod.ts";
import { forbiddenRouteNames } from "../connection/mod.ts";
import { createHandler } from "./server.ts";
import { resolveRoute, STATIC_TOOLS, toolEntries } from "./registry.ts";

const ALL_TOOLSETS = ["core", "app"] as const;

// 이 동작들은 사람·machine 전용이라 어느 tool의 op로도 없다. 새 op를 더할 때 이 목록이
// 걸러 준다.
const FORBIDDEN_OPS = [
  "grant",
  "reject",
  "decide",
  "approve",
  "confirm",
  "ignore",
  "close",
  "cancel",
  "create",
  "update",
  "delete",
  "remove",
  "restore",
  "archive",
  "unarchive",
  "assign",
  "define",
  "track",
  "set_tracking",
  "make_ready",
  "ready",
  "goal",
  "record_result",
  "lock",
  "unlock",
  "reveal",
];

const FORBIDDEN_TOOLS = [
  "lophn_secret",
  "lophn_secrets",
  "lophn_grant",
  "lophn_backup",
  "lophn_connection",
  "lophn_assignment",
  "lophn_file",
  "lophn_files",
  "lophn_folder",
  "lophn_db",
  "lophn_sql",
  "lophn_raw",
  "lophn_exec",
];

const FORBIDDEN_INPUT_KEYS = [
  "token",
  "secret",
  "password",
  "credential",
  "sql",
  "db_path",
];

function opsOf(tool: (typeof STATIC_TOOLS)[number]): string[] {
  return tool.ops.length === 0 ? [] : [...tool.ops];
}

function keysOf(node: unknown, found: Set<string> = new Set()): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) keysOf(item, found);
  } else if (typeof node === "object" && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      if (key === "properties" && typeof value === "object" && value !== null) {
        for (const name of Object.keys(value)) found.add(name);
      }
      keysOf(value, found);
    }
  }
  return found;
}

Deno.test("coding-agent/mcp-server#R30 #R31: discovery에 금지 tool·op·입력 이름이 없다", () => {
  const entries = toolEntries(ALL_TOOLSETS);
  assert(entries.length > 0);
  for (const entry of entries) {
    assert(
      !FORBIDDEN_TOOLS.includes(entry.name),
      `금지 tool이 discovery에 있다: ${entry.name}`,
    );
    for (const key of keysOf(entry.inputSchema)) {
      assert(
        !FORBIDDEN_INPUT_KEYS.includes(key),
        `${entry.name}의 입력에 ${key}가 있다`,
      );
    }
  }
  for (const tool of STATIC_TOOLS) {
    for (const op of opsOf(tool)) {
      assert(
        !FORBIDDEN_OPS.includes(op),
        `${tool.name}에 금지 op가 있다: ${op}`,
      );
    }
  }
  // 승인은 읽기만 한다. 결정·grant·사용 op가 없다.
  const approval = STATIC_TOOLS.find((tool) => tool.name === "lophn_approval");
  assert(approval);
  assertEquals([...approval.ops].sort(), ["list", "show"]);
});

Deno.test("coding-agent/mcp-server#R30 #R31: tool op가 부르는 소유 route는 금지 route가 아니고 모두 coding_agent actor를 받는다", () => {
  const forbidden = new Set(forbiddenRouteNames());
  const byName = contractRoutesByName();
  let checked = 0;
  for (const tool of STATIC_TOOLS) {
    for (const op of tool.ops.length === 0 ? [undefined] : tool.ops) {
      const resolved = resolveRoute(tool.name, op);
      const name = (resolved?.route as { name?: string } | undefined)?.name;
      if (name === undefined) continue;
      checked += 1;
      assert(
        !forbidden.has(name),
        `${tool.name} ${op}가 금지 route ${name}을 부른다`,
      );
      const route = byName.get(name);
      assert(route, `${name}은 계약 route 표에 있다`);
      assert(
        route.actors.includes("coding_agent"),
        `${tool.name} ${op}의 route ${name}이 coding_agent actor를 받지 않는다`,
      );
    }
  }
  assert(checked >= 30, `검사한 route가 너무 적다: ${checked}`);
});

Deno.test("coding-agent/mcp-server#R30 #R31: 금지 tool·op를 직접 요청해도 실행 전에 거절하고 core로 가지 않는다", async () => {
  let reached = 0;
  const handler = createHandler({
    toolsets: ALL_TOOLSETS,
    callTool: () => {
      reached += 1;
      return Promise.resolve({ summary: "reached", data: {}, next: [] });
    },
  });
  async function call(name: string, args: Record<string, unknown>) {
    const response = await handler(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }));
    assert(response !== undefined);
    return response;
  }
  for (const name of FORBIDDEN_TOOLS) {
    const response = await call(name, { op: "list" });
    assertEquals(response.error?.code, -32602, name);
  }
  // 있는 tool의 없는 op는 isError이고 다른 동작으로 추측해 실행하지 않는다.
  const attempts: [string, string][] = [
    ["lophn_approval", "grant"],
    ["lophn_approval", "reject"],
    ["lophn_approval", "decide"],
    ["lophn_question", "answer"],
    ["lophn_project", "create"],
    ["lophn_project", "set_tracking"],
    ["lophn_ticket", "cancel"],
    ["lophn_ticket", "make_ready"],
    ["lophn_ticket", "confirm"],
    ["lophn_problem", "close"],
    ["lophn_problem", "ignore"],
    ["lophn_problem", "confirm"],
    ["lophn_document", "restore"],
    ["lophn_document", "archive"],
    ["lophn_document", "move"],
  ];
  for (const [name, op] of attempts) {
    const response = await call(name, { op });
    const result = response.result as { isError?: boolean } | undefined;
    assertEquals(result?.isError, true, `${name} ${op}`);
    assertEquals(response.error, undefined, `${name} ${op}`);
  }
  assertEquals(reached, 0);
});
