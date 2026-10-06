// lophn_app과 CLI `app …`의 parity 테스트다(T21, cli#R1, connection#R6). 같은 credential·입력을
// 두 통로에 보내 core 요청과 결과·거절이 같은지 본다. core 대신 route별 답을 정한 흐름 client를
// 쓰고 실제 runner·앱 process·model provider에 닿지 않는다.
import { assert, assertEquals } from "@std/assert";
import { CLI_APP_OPS, COMMANDS, findCommand, runApp } from "../../cli/mod.ts";
import { fail, scriptedFlow } from "../../connection/testing/mod.ts";
import { resolveRoute } from "../registry.ts";
import { createAppTool } from "./app.ts";

const APP = "app_01arz3ndektsv4rrffq69g5fav";
const HASH = "a".repeat(64);
const COMMIT = "c".repeat(40);
const deps = { idempotencyKey: () => "key-0123456789" };

function entry(name: string) {
  const found = findCommand(name);
  if (!found) throw new Error(name);
  return found;
}

Deno.test("coding-agent/cli#R1: CLI 표의 route는 MCP registry가 같은 op에서 푸는 route와 같다", () => {
  for (const [name, op] of Object.entries(CLI_APP_OPS)) {
    const mcp = resolveRoute("lophn_app", op);
    assert(mcp, op);
    assertEquals(entry(name).monoRoute, mcp.route, name);
  }
  assert(COMMANDS.some((command) => command.name === "app test"));
});

Deno.test("coding-agent/cli#R25, coding-agent/connection#R4: register는 전체 범위만 허용하는 core 판정을 MCP와 같게 전한다", async () => {
  const refused = fail(
    "forbidden",
    "app registration is a whole-scope request only",
  );
  const mcp = scriptedFlow({ "app.create": refused });
  const cli = scriptedFlow({ "app.create": refused });
  const input = { slug: "notes", name: "Notes", description: "메모" };
  const viaMcp = await createAppTool({ client: mcp.client, ...deps })(
    "lophn_app",
    resolveRoute("lophn_app", "register")!.route,
    { op: "register", ...input },
  );
  const viaCli = await runApp("app register", {
    command: "app register",
    ...input,
  }, { client: cli.client, ...deps });
  assert(viaCli.ok);
  assertEquals(viaCli.value.data, viaMcp.data);
  assertEquals(viaCli.value.isError, viaMcp.isError);
  assertEquals(cli.sent, mcp.sent);
});

type Case = {
  name: string;
  cli: Record<string, unknown>;
  mcp: Record<string, unknown>;
  handlers: Parameters<typeof scriptedFlow>[0];
};

const TEST_FIELDS = {
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
};

const PARITY: Case[] = [
  {
    name: "app list",
    cli: { command: "app list", status: "active" },
    mcp: { op: "list", status: "active" },
    handlers: { "app.list": { apps: [], as_of_seq: "1", next_cursor: null } },
  },
  {
    name: "app show",
    cli: { command: "app show", app: APP },
    mcp: { op: "show", app: APP },
    handlers: {
      "app.get": { app: { id: APP, slug: "n", source_path: null } },
    },
  },
  {
    name: "app logs",
    cli: { command: "app logs", app: APP, limit: 10 },
    mcp: { op: "logs", app: APP, limit: 10 },
    handlers: {
      "app.logs": { state: "ok", lines: ["a"], truncated: false },
    },
  },
  {
    name: "app invocations",
    cli: { command: "app invocations", app: APP },
    mcp: { op: "invocations", app: APP },
    handlers: {
      "invocations.list": { invocations: [], next_cursor: null },
    },
  },
  {
    name: "app validate",
    cli: {
      command: "app validate",
      app: APP,
      commit: COMMIT,
      request_key: "req-1",
    },
    mcp: { op: "validate", app: APP, commit: COMMIT, request_key: "req-1" },
    handlers: {
      "release.prepare_bundle": {
        request_key: "req-1",
        status: "completed",
        bundle_hash: HASH,
        blueprint_hash: HASH,
        manifest: { entrypoint: "main.ts", files: [], sdk_dependencies: [] },
      },
    },
  },
  {
    name: "app test",
    cli: { command: "app test", ...TEST_FIELDS },
    mcp: { op: "test", ...TEST_FIELDS },
    handlers: {
      RequestTest: { request_key: "r", accepted: false, result_ref: null },
    },
  },
  {
    name: "app preview stop",
    cli: { command: "app preview stop", app: APP, process_nonce: "n1" },
    mcp: { op: "preview_stop", app: APP, process_nonce: "n1" },
    handlers: {
      "previews.stop": { stopped: true },
      "previews.get": { observation: null },
    },
  },
];

Deno.test("coding-agent/cli#R1, coding-agent/connection#R6: 같은 credential·입력의 CLI와 MCP는 같은 요청과 같은 결과를 낸다", async () => {
  for (const item of PARITY) {
    const parsed = entry(item.name).input.safeParse(item.cli);
    assert(parsed.success, `${item.name}: ${JSON.stringify(parsed)}`);
    const cli = scriptedFlow(item.handlers);
    const mcp = scriptedFlow(item.handlers);
    const wait = { budget_ms: 0, interval_ms: 1 };
    const viaCli = await runApp(
      item.name as Parameters<typeof runApp>[0],
      parsed.data as Record<string, unknown>,
      { client: cli.client, ...deps, wait },
    );
    const viaMcp = await createAppTool({ client: mcp.client, ...deps, wait })(
      "lophn_app",
      resolveRoute("lophn_app", item.mcp.op as string)!.route,
      item.mcp,
    );
    assert(viaCli.ok, item.name);
    assertEquals(cli.sent, mcp.sent, item.name);
    assertEquals(viaCli.value.data, viaMcp.data, item.name);
    assertEquals(viaCli.value.summary, viaMcp.summary, item.name);
    assertEquals(viaCli.value.isError, viaMcp.isError, item.name);
  }
});
