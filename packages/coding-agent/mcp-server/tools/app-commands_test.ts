// blueprint 유래 앱 read tool 테스트다(T23, mcp#R4·R34·R35). core 대신 route 이름별로 답을 정한
// 흐름 client와 가짜 blueprint source·앱 통로를 쓴다. 실제 앱 process·model provider에 닿지 않는다.
import { assert, assertEquals } from "@std/assert";
import { Tiktoken } from "js-tiktoken";
import cl100k_base from "js-tiktoken/ranks/cl100k_base";
import { err, ok, sha256Hex } from "../../../base/mod.ts";
import { appToolName } from "../../../protocol/coding-agent/mod.ts";
import {
  type AppDirect,
  type AppInvokeRequest,
  UNREADABLE_MESSAGE,
} from "../../connection/mod.ts";
import { scriptedFlow } from "../../connection/testing/mod.ts";
import {
  createHandler,
  type JsonRpcNotification,
  type JsonRpcResponse,
} from "../server.ts";
import { toolEntries } from "../registry.ts";
import {
  appBlueprintSourceOf,
  type AppBlueprintView,
  createAppCommandTools,
} from "./app-commands.ts";

const APP = "app_01arz3ndektsv4rrffq69g5fav";
const OUTSIDE = "app_01arz3ndektsv4rrffq69g5faw";
const REL = "rel_01arz3ndektsv4rrffq69g5fav";
const INV = "inv_01arz3ndektsv4rrffq69g5fav";

const READ_INPUT = {
  type: "object" as const,
  description: "월 사용량",
  properties: { month: { type: "integer" as const, minimum: 1, maximum: 12 } },
  required: ["month"],
  additionalProperties: false as const,
};

function command(
  key: string,
  over: Partial<AppBlueprintView["commands"][number]> = {},
): AppBlueprintView["commands"][number] {
  return {
    key,
    label: key,
    description: `${key} 설명`,
    effect: "read",
    confirm: false,
    input: null,
    ...over,
  };
}

function blueprint(
  commands: AppBlueprintView["commands"],
  release = REL,
): AppBlueprintView {
  return { release, blueprint_hash: "a".repeat(64), commands };
}

function appRecord(id: string, name: string) {
  return {
    id,
    slug: "usage",
    name,
    description: "사용량",
    planning_version: null,
    source_path: null,
    active_release: REL,
    revision: "1",
    run_enabled: true,
    status: "active",
  };
}

const READS = [
  command("usage.show", { input: READ_INPUT }),
  command("usage.list"),
];
const NOT_READS = [
  command("usage.save", { effect: "write" }),
  command("usage.sync", { effect: "external" }),
  command("usage.delete", { confirm: true }),
];

function setup(
  view: () => AppBlueprintView | null,
  apps = [appRecord(APP, "Usage")],
) {
  const flow = scriptedFlow({
    "app.list": () => ({ apps }),
    "previews.get": {
      observation: { ready: true, process_nonce: "n1", accepting: false },
    },
  });
  const seen: AppInvokeRequest[] = [];
  const direct: AppDirect = {
    invoke(request) {
      seen.push(request);
      return Promise.resolve(ok({
        kind: "result" as const,
        output: {
          result: { result: { total: 3 } },
          invocation: INV,
          mode: request.environment,
        },
      }));
    },
  };
  const sources: string[] = [];
  const notes: JsonRpcNotification[] = [];
  const tools = createAppCommandTools({
    client: flow.client,
    idempotencyKey: () => "key-0123456789",
    direct,
    requestKey: () => "rk-1",
    blueprint: (app) => {
      sources.push(app);
      return Promise.resolve(ok(app === APP ? view() : null));
    },
    listChanged: () => {
      notes.push({
        jsonrpc: "2.0",
        method: "notifications/tools/list_changed",
        params: {},
      });
    },
  });
  const handler = createHandler({
    toolsets: ["core", "app"],
    appCommands: tools,
    callTool: async (name, args, context) => {
      assert(tools.owns(name));
      return await tools.call(name, args, context);
    },
  });
  async function rpc(
    method: string,
    params?: unknown,
  ): Promise<JsonRpcResponse> {
    const response = await handler(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    );
    assert(response !== undefined);
    return response;
  }
  return { flow, seen, sources, notes, tools, handler, rpc };
}

type Entry = {
  name: string;
  description: string;
  readOnlyHint?: boolean;
  inputSchema: {
    properties: Record<string, unknown>;
    required?: string[];
  };
};

async function listed(rpc: ReturnType<typeof setup>["rpc"]) {
  const response = await rpc("tools/list");
  return (response.result as { tools: Entry[] }).tools.filter((tool) =>
    tool.name.startsWith("lophn_app_")
  );
}

function resultOf(response: JsonRpcResponse) {
  return response.result as {
    isError?: boolean;
    structuredContent?: { summary: string; data: unknown; next: string[] };
  };
}

Deno.test("coding-agent/mcp-server#R34: scope 안 앱의 read·비confirm command마다 tool 하나이고 이름·설명·input schema는 원본 그대로다", async () => {
  const { rpc } = setup(() => blueprint([...READS, ...NOT_READS]));
  const tools = await listed(rpc);
  assertEquals(tools.length, 2);
  const appHash = await sha256Hex(APP);
  const showName = appToolName(appHash, await sha256Hex("usage.show"));
  const listName = appToolName(appHash, await sha256Hex("usage.list"));
  assertEquals(tools.map((tool) => tool.name).sort(), [listName, showName]);
  const entry = tools.find((tool) => tool.name === showName)!;
  assertEquals(entry.name.length, 39);
  assert(entry.description.includes("Usage"));
  assert(entry.description.includes("usage.show"));
  assert(entry.description.includes("usage.show 설명"));
  assertEquals(entry.readOnlyHint, true);
  assertEquals(entry.inputSchema.properties.input, READ_INPUT);
  assertEquals(entry.inputSchema.required, ["input"]);
  assertEquals(
    Object.keys(entry.inputSchema.properties).sort(),
    ["environment", "input", "timeout_ms"],
  );
  // 입력이 없는 command는 input 자리가 없다.
  const noInput = tools.find((tool) => tool.name === listName)!;
  assertEquals(noInput.inputSchema.properties.input, undefined);
});

Deno.test("coding-agent/mcp-server#R34: write·external·confirm command와 범위 밖 앱은 discovery에 없고 직접 요청도 없는 이름과 같은 거절이다", async () => {
  const { rpc, sources } = setup(
    () => blueprint([...READS, ...NOT_READS]),
    [appRecord(APP, "Usage")],
  );
  assertEquals((await listed(rpc)).length, 2);
  // 범위 밖 앱은 앱 목록에 없어 blueprint도 읽지 않는다.
  assertEquals(sources, [APP]);
  const missing = resultOf(
    await rpc("tools/call", {
      name: "lophn_app_000000000000_0000000000000000",
      arguments: {},
    }),
  );
  for (const key of ["usage.save", "usage.sync", "usage.delete"]) {
    const name = appToolName(
      await sha256Hex(APP),
      await sha256Hex(key),
    );
    const refused = resultOf(
      await rpc("tools/call", { name, arguments: {} }),
    );
    assertEquals(refused.isError, true);
    assertEquals(refused.structuredContent, missing.structuredContent);
  }
  const outside = appToolName(
    await sha256Hex(OUTSIDE),
    await sha256Hex("usage.list"),
  );
  const refused = resultOf(
    await rpc("tools/call", { name: outside, arguments: {} }),
  );
  assertEquals(refused.isError, true);
  assertEquals(refused.structuredContent?.summary, UNREADABLE_MESSAGE);
  assertEquals(refused.structuredContent, missing.structuredContent);
});

Deno.test("coding-agent/mcp-server#R34: app toolset이 꺼져 있으면 동적 tool은 목록에도 호출에도 없다", async () => {
  const flow = scriptedFlow({});
  const tools = createAppCommandTools({
    client: flow.client,
    idempotencyKey: () => "key-0123456789",
    blueprint: () => Promise.reject(new Error("부르면 안 된다")),
  });
  const handler = createHandler({
    toolsets: ["core"],
    appCommands: tools,
    callTool: () => Promise.reject(new Error("부르면 안 된다")),
  });
  const list = await handler(
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  );
  const names = (list!.result as { tools: { name: string }[] }).tools.map((
    tool,
  ) => tool.name);
  assert(
    !names.some((name) =>
      name === "lophn_app" || name.startsWith("lophn_app_")
    ),
  );
  const call = await handler(JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "lophn_app_000000000000_0000000000000000", arguments: {} },
  }));
  assertEquals(call!.error?.code, -32602);
  assertEquals(flow.sent.length, 0);
});

Deno.test("coding-agent/mcp-server#R34: 이름이 다른 command와 겹치면 조용히 덮지 않고 discovery 실패다", async () => {
  const { rpc } = setup(() =>
    blueprint([command("usage.list"), command("usage.list", { label: "x" })])
  );
  const response = await rpc("tools/list");
  assertEquals(response.result, undefined);
  assert(response.error?.message.includes("discovery 실패"));
});

Deno.test("coding-agent/mcp-server#R35: 호출은 기본 preview로 앱 통로를 부르고 core command를 보내지 않는다", async () => {
  const { rpc, seen, flow } = setup(() => blueprint(READS));
  const [first] = (await listed(rpc)).filter((tool) =>
    tool.inputSchema.required?.includes("input")
  );
  const response = await rpc("tools/call", {
    name: first.name,
    arguments: { input: { month: 10 } },
  });
  assertEquals(resultOf(response).isError, undefined);
  assertEquals(seen, [{
    app: APP,
    environment: "preview",
    command: "usage.show",
    input: { month: 10 },
    request_key: "rk-1",
    preview_nonce: "n1",
  }]);
  // 앱 통로를 열 때와 preview 확인의 read뿐이고 ledger 쓰기(command)는 없다.
  assertEquals(flow.sent.filter((call) => call.kind === "command"), []);
  const live = await rpc("tools/call", {
    name: first.name,
    arguments: { input: { month: 10 }, environment: "live", timeout_ms: 500 },
  });
  assertEquals(resultOf(live).isError, undefined);
  assertEquals(seen[1].environment, "live");
  assertEquals(seen[1].preview_nonce, undefined);
  const bad = await rpc("tools/call", {
    name: first.name,
    arguments: { environment: "prod" },
  });
  assertEquals(resultOf(bad).isError, true);
  assertEquals(seen.length, 2);
});

Deno.test("coding-agent/mcp-server#R35: release가 바뀌면 옛 정의 호출은 conflict이고 list_changed와 고정 op 안내를 낸다", async () => {
  let release = REL;
  let commands = READS;
  const { rpc, seen, notes } = setup(() => blueprint(commands, release));
  const [first] = await listed(rpc);
  release = "rel_01arz3ndektsv4rrffq69g5faw";
  const stale = resultOf(
    await rpc("tools/call", { name: first.name, arguments: {} }),
  );
  assertEquals(stale.isError, true);
  assertEquals(
    (stale.structuredContent?.data as { code: string }).code,
    "conflict",
  );
  assertEquals(seen.length, 0);
  assertEquals(notes.length, 1);
  assertEquals(notes[0].method, "notifications/tools/list_changed");
  // list_changed를 받지 않는 client를 위한 고정 op 안내다.
  assert(
    stale.structuredContent!.next.some((line) =>
      line.includes("lophn_app command")
    ),
  );
  // 다시 읽으면 새 정의로 부를 수 있다.
  await listed(rpc);
  const again = resultOf(
    await rpc("tools/call", { name: first.name, arguments: {} }),
  );
  assertEquals(again.isError, undefined);
  assertEquals(seen.length, 1);
  // 정의가 사라진 이름도 목록에 냈던 것이면 conflict다.
  const [shown] = await listed(rpc);
  commands = [];
  const gone = resultOf(
    await rpc("tools/call", { name: shown.name, arguments: {} }),
  );
  assertEquals(
    (gone.structuredContent?.data as { code: string }).code,
    "conflict",
  );
});

Deno.test("coding-agent/mcp-server#R35: 앱 목록을 못 읽어도 고정 tool 목록은 그대로 나간다", async () => {
  const flow = scriptedFlow({
    "app.list": err({ code: "unavailable", message: "core 없음" }),
  });
  const tools = createAppCommandTools({
    client: flow.client,
    idempotencyKey: () => "key-0123456789",
    blueprint: () => Promise.resolve(ok(null)),
  });
  const handler = createHandler({
    toolsets: ["core", "app"],
    appCommands: tools,
    callTool: () => Promise.reject(new Error("부르면 안 된다")),
  });
  const list = await handler(
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  );
  const names = (list!.result as { tools: { name: string }[] }).tools.map((
    tool,
  ) => tool.name);
  assertEquals(names.length, toolEntries(["core", "app"]).length);
  const init = await handler(
    JSON.stringify({ jsonrpc: "2.0", id: 2, method: "initialize", params: {} }),
  );
  assertEquals(
    (init!.result as { capabilities: unknown }).capabilities,
    { tools: { listChanged: true } },
  );
});

Deno.test("coding-agent/mcp-server#R4: 동적 목록을 포함한 discovery schema token을 다시 잰다", async () => {
  const many = Array.from(
    { length: 6 },
    (_, index) => command(`usage.read_${index}`, { input: READ_INPUT }),
  );
  const { rpc } = setup(() => blueprint(many));
  const dynamic = await listed(rpc);
  assertEquals(dynamic.length, 6);
  const tokenizer = new Tiktoken(cl100k_base);
  const fixed = tokenizer.encode(JSON.stringify(toolEntries(["core", "app"])))
    .length;
  const added = tokenizer.encode(JSON.stringify(dynamic)).length;
  console.log(
    `MCP discovery token: 고정 ${fixed}, 동적 ${dynamic.length}개 +${added}`,
  );
  assert(added > 0);
});

Deno.test("coding-agent/mcp-server#R34: blueprint source는 소유 read의 command 정의만 옮기고 범위 밖·active release 없는 앱은 같은 null이다", async () => {
  const hash = await sha256Hex("blueprint");
  const flow = scriptedFlow({
    "app.blueprint": (input) =>
      (input as { app: string }).app === APP
        ? ok({
          app: APP,
          release: REL,
          blueprint_hash: hash,
          name: "x",
          commands: [command("usage")],
          screens: [],
          automations: [],
        })
        : err({ code: "not_found", message: "다른 사유" }),
  });
  const source = appBlueprintSourceOf(flow.client);
  const found = await source(APP);
  assert(found.ok && found.value !== null);
  assertEquals(found.value.release, REL);
  assertEquals(found.value.blueprint_hash, hash);
  assertEquals(found.value.commands.map((item) => item.key), ["usage"]);
  const outside = await source(OUTSIDE);
  assert(outside.ok);
  assertEquals(outside.value, null);
});
