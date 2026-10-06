// lophn_app tool 테스트다(T21, mcp#R19–R21·R29·R32·R33). tool 입력 검사·route 해석·progress
// 알림을 server 경계에서 보고, 실행은 가짜 core client로 한다. 실제 test runner·앱 process·model
// provider에 닿지 않는다.
import { assert, assertEquals } from "@std/assert";
import { fail, scriptedFlow } from "../../connection/testing/mod.ts";
import {
  createHandler,
  type JsonRpcNotification,
  type JsonRpcResponse,
} from "../server.ts";
import { resolveRoute, STATIC_TOOLS, toolEntries } from "../registry.ts";
import { createAppTool } from "./app.ts";

const APP = "app_01arz3ndektsv4rrffq69g5fav";
const COMMIT = "c".repeat(40);
const HASH = "a".repeat(64);

function setup(handlers: Parameters<typeof scriptedFlow>[0]) {
  const flow = scriptedFlow(handlers);
  const notes: JsonRpcNotification[] = [];
  const tool = createAppTool({
    client: flow.client,
    idempotencyKey: () => "key-0123456789",
    wait: { budget_ms: 2_000, interval_ms: 1_000 },
    sleep: () => Promise.resolve(),
  });
  let reached = 0;
  const handler = createHandler({
    toolsets: ["core", "app"],
    notify: (message) => {
      notes.push(message);
    },
    callTool: (name, args, context) => {
      reached += 1;
      const route = resolveRoute(
        name,
        (args as { op?: string }).op,
      )!.route;
      return tool(name, route, args, context);
    },
  });
  async function call(
    args: Record<string, unknown>,
    meta?: Record<string, unknown>,
  ): Promise<JsonRpcResponse> {
    const response = await handler(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "lophn_app",
        arguments: args,
        ...(meta === undefined ? {} : { _meta: meta }),
      },
    }));
    assert(response !== undefined);
    return response;
  }
  return { flow, notes, call, reached: () => reached };
}

function resultOf(response: JsonRpcResponse) {
  return response.result as {
    isError?: boolean;
    structuredContent?: { summary: string; data: unknown; next: string[] };
  };
}

Deno.test("coding-agent/mcp-server#R19: discovery의 lophn_app은 app toolset에만 있고 op가 고정이다", () => {
  assert(!toolEntries(["core"]).some((entry) => entry.name === "lophn_app"));
  const entry = toolEntries(["core", "app"]).find((item) =>
    item.name === "lophn_app"
  );
  assert(entry);
  const ops = (entry.inputSchema as {
    properties: { op: { enum: string[] } };
  }).properties.op.enum;
  for (
    const op of [
      "list",
      "show",
      "register",
      "source",
      "validate",
      "test",
      "preview_start",
      "preview_stop",
      "release_prepare",
      "status",
      "blueprint",
      "invocations",
      "logs",
      "sync_tools",
      "command",
      "invocation",
    ]
  ) {
    assert(ops.includes(op), op);
  }
  // 운영 시작·중지·activation·automation 수행 op는 없다.
  for (const op of ["start", "stop", "activate", "automation_run", "grant"]) {
    assert(!ops.includes(op), op);
  }
  // 쓰기 op를 가진 tool이라 읽기 전용 주석이 없다.
  assertEquals(entry.readOnlyHint, undefined);
});

Deno.test("coding-agent/mcp-server#R19: 표의 모든 op는 소유 route로 해석되고 사람·machine route는 없다", () => {
  const tool = STATIC_TOOLS.find((item) => item.name === "lophn_app")!;
  for (const op of [...tool.ops, "preparation"]) {
    const resolved = resolveRoute("lophn_app", op);
    assert(resolved, op);
    assert(resolved.route.actors.includes("coding_agent"), op);
  }
  assertEquals(resolveRoute("lophn_app", "activate"), undefined);
  assertEquals(resolveRoute("lophn_app", "start"), undefined);
});

Deno.test("coding-agent/mcp-server#R6, mcp-server#R32: 틀린 입력은 실행 전에 거절하고 core로 가지 않는다", async () => {
  const { call, reached, flow } = setup({});
  const cases: Record<string, unknown>[] = [
    { op: "activate", app: APP },
    // invocation 이력은 페이지당 최대 20개다.
    { op: "invocations", app: APP, limit: 21 },
    // log는 한 번에 최대 200줄이다.
    { op: "logs", app: APP, limit: 201 },
    // 환경은 preview|live뿐이다.
    { op: "command", app: APP, command: "x", environment: "production" },
    { op: "command", app: APP, command: "x", timeout_ms: 0 },
    { op: "release_prepare", app: APP, request_key: "r" },
  ];
  for (const args of cases) {
    const response = await call(args);
    assertEquals(resultOf(response).isError, true, JSON.stringify(args));
  }
  assertEquals(reached(), 0);
  assertEquals(flow.sent.length, 0);
});

Deno.test("coding-agent/mcp-server#R19: 오래 걸리는 일은 progressToken이 있을 때 progress를 알리고 응답은 접수와 다음 read다", async () => {
  let polls = 0;
  const { call, notes } = setup({
    "release.prepare_bundle": {
      request_key: "req-1",
      status: "preparing",
      bundle_hash: null,
      blueprint_hash: null,
      manifest: null,
    },
    "release.preparation": () => {
      polls += 1;
      return {
        app: APP,
        request_key: "req-1",
        status: "preparing",
        bundle_hash: null,
        blueprint_hash: null,
        manifest: null,
      };
    },
  });
  const args = {
    op: "validate",
    app: APP,
    commit: COMMIT,
    request_key: "req-1",
  };
  const response = await call(args, { progressToken: "tok-1" });
  const result = resultOf(response);
  assertEquals(result.isError, undefined);
  assertEquals(
    (result.structuredContent!.data as { accepted: boolean }).accepted,
    true,
  );
  assert(result.structuredContent!.next[0].includes("preparation"));
  assert(polls >= 1);
  assert(notes.length >= 1);
  for (const [index, note] of notes.entries()) {
    assertEquals(note.method, "notifications/progress");
    assertEquals(note.params.progressToken, "tok-1");
    assertEquals(note.params.progress, index + 1);
  }
  // progressToken이 없는 호출은 알림을 보내지 않는다.
  notes.length = 0;
  await call(args);
  assertEquals(notes.length, 0);
});

Deno.test("coding-agent/mcp-server#R30: 범위 밖 앱의 거절은 없는 앱과 같은 응답이다", async () => {
  const unreadable =
    "현재 연결로 읽을 수 없다. 없는 대상이거나 이 연결의 범위 밖이다";
  const { call } = setup({
    "app.get": fail("not_found", unreadable),
    "invocations.get": { invocation: null },
  });
  const show = resultOf(await call({ op: "show", app: APP }));
  assertEquals(show.isError, true);
  assertEquals(show.structuredContent!.summary, unreadable);
  const source = resultOf(
    await call({ op: "source", app: APP, source_path: "/w" }),
  );
  assertEquals(source.structuredContent!.summary, unreadable);
  const invocation = resultOf(
    await call({
      op: "invocation",
      invocation: "inv_01arz3ndektsv4rrffq69g5fav",
    }),
  );
  assertEquals(invocation.structuredContent!.summary, unreadable);
});

Deno.test("coding-agent/mcp-server#R33: test 요청은 같은 묶음 hash와 request_key로 보내고 timeout 기준을 응답에 낸다", async () => {
  const { call, flow } = setup({
    RequestTest: {
      request_key: "req-test-0123456789",
      accepted: true,
      result_ref: null,
    },
    GetTestRequest: {
      request: {
        request_key: "req-test-0123456789",
        accepted: true,
        preparation_failed: false,
        start_attempted_at: null,
        started_at: "2026-10-05T00:00:00.000Z",
        start_unknown: false,
        result_ref: null,
        reason: "started",
      },
    },
  });
  const response = resultOf(
    await call({
      op: "test",
      kind: "app_test",
      app: APP,
      target: { bundle_hash: HASH, release: null },
      problem: null,
      basis_seq: null,
      reports: [],
      before: null,
      after: null,
      ticket: null,
      test: "b".repeat(64),
      request_key: "req-test-0123456789",
    }),
  );
  assertEquals(response.isError, undefined);
  const data = response.structuredContent!.data as {
    state: string;
    runner_timeout_ms: number;
  };
  assertEquals(data.state, "running");
  assertEquals(data.runner_timeout_ms, 300_000);
  assertEquals(
    (flow.calls("RequestTest")[0].input as { target: { bundle_hash: string } })
      .target.bundle_hash,
    HASH,
  );
});
