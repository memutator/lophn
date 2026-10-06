// lophn-agent/harness/tools#R8, R16, R17: 허락된 앱의 active release blueprint에서 command마다 tool 정의가
// 자동으로 생기고(별도 MCP 등록 없음), 역할·현재 허락·AgentAppScope의 교집합만 노출되며, 앱 쪽은
// fixture blueprint와 앱 통로 대역으로 본다. 실제 core·앱 자식 프로세스에서의 호출은
// apps/agent-runtime/app_toolkit_test.ts가 본다.
import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  AppBlueprintCommand,
  Invocation,
} from "../../../contracts/apps/mod.ts";
import type { AgentRole } from "../../../contracts/lophn-agent/mod.ts";
import { computeAgentAppScope } from "../run-loop/mod.ts";
import { createAppToolLookups } from "../waiting-and-recovery/mod.ts";
import {
  type AppBlueprintView,
  type AppCommandPorts,
  type AppGrant,
  type AppInvokeCall,
  type AppInvokeOutcome,
  type AppTool,
  buildAppTools,
  createAppReadToolHandlers,
  createAppToolHandlers,
  executeTool,
  listTools,
  PROBLEM_READ_TOOL_NAMES,
  revertCounterpart,
  type RunCredential,
} from "./mod.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const OTHER_APP = "app_01h455vb4pex5v6nkc6gd5fdw2";
const RELEASE = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const NEXT_RELEASE = "rel_01h455vb4pex5v6nkc6gd5fdw2";
const GRANT = "grt_01h455vb4pex5v6nkc6gd5fdw1";
const ASSIGNMENT = "asg_01h455vb4pex5v6nkc6gd5fdw1";
const RUN = "run_01h455vb4pex5v6nkc6gd5fdw1";
const CALL = "tcl_01h455vb4pex5v6nkc6gd5fdw1";
const INVOCATION = "inv_01h455vb4pex5v6nkc6gd5fdw1";

function command(
  key: string,
  effect: AppBlueprintCommand["effect"],
  over: Partial<AppBlueprintCommand> = {},
): AppBlueprintCommand {
  return {
    key,
    label: `${key} label`,
    description: `${key} does one thing`,
    effect,
    confirm: false,
    input: null,
    revert: { supported: false },
    ...over,
  };
}

const LIMIT_INPUT = {
  type: "object",
  description: "which items",
  properties: {
    limit: { type: "integer", minimum: 1, description: "how many" },
    title: { type: "string", description: "item title" },
  },
  required: ["limit"],
  additionalProperties: false,
} as const;

const COMMANDS: AppBlueprintCommand[] = [
  command("read_items", "read", { input: LIMIT_INPUT as never }),
  command("audit", "read", { confirm: true }),
  command("add_item", "write", {
    revert: { supported: true, command: "undo_add" },
    input: LIMIT_INPUT as never,
  }),
  command("undo_add", "write"),
  command("drop_item", "write"),
  // 선언은 되돌리기를 지원한다고 하지만 대응 command가 blueprint에 없다.
  command("ghost_revert", "write", {
    revert: { supported: true, command: "missing" },
  }),
  // 설명이 되돌릴 수 있다고 말해도 선언이 없으면 지원이 아니다.
  command("rename_item", "write", {
    description: "Renames an item. You can undo this any time.",
  }),
  command("sync_remote", "external"),
  command("purge", "write", { confirm: true }),
];

function view(
  over: Partial<AppBlueprintView> = {},
  commands = COMMANDS,
): AppBlueprintView {
  return {
    app: APP,
    name: "Usage",
    release: RELEASE,
    blueprint_hash: "a".repeat(64),
    commands,
    ...over,
  };
}

const ALL_KEYS = COMMANDS.map((entry) => entry.key);

function grants(commands: readonly string[] = ALL_KEYS) {
  const list: AppGrant[] = [{ grant: GRANT, commands }];
  return new Map<string, readonly AppGrant[]>([[APP, list]]);
}

// loader가 하는 일과 같다: 선언과 허락으로 offer를 만든다.
function offerOf(blueprint: AppBlueprintView, granted: readonly string[]) {
  return {
    app: blueprint.app,
    commands: blueprint.commands.map((entry) => ({
      key: entry.key,
      effect: entry.effect,
      confirm: entry.confirm,
      revert_supported: revertCounterpart(blueprint.commands, entry) !== null,
    })),
    granted,
  };
}

async function toolsFor(
  role: AgentRole,
  options: {
    blueprint?: AppBlueprintView;
    granted?: readonly string[];
    work?: { kind: "all" | "project" | "app"; id: string | null };
    readCommands?: readonly string[];
  } = {},
): Promise<readonly AppTool[]> {
  const blueprint = options.blueprint ?? view();
  const granted = options.granted ?? ALL_KEYS;
  const scope = computeAgentAppScope({
    role,
    assignment: ASSIGNMENT,
    work: options.work ??
      (role === "app_engineer"
        ? { kind: "app", id: APP }
        : { kind: "all", id: null }),
    read_apps: role === "operator" ? [APP] : [],
    read_commands: (options.readCommands ?? []).map((key) => ({
      app: APP,
      command: key,
    })),
    offers: [offerOf(blueprint, granted)],
  });
  assert(scope.ok, scope.ok ? "" : scope.error.message);
  return await buildAppTools({
    scope: scope.value,
    views: [blueprint],
    grants: grants(granted),
  });
}

function keysOf(tools: readonly AppTool[]): string[] {
  return tools.map((tool) => tool.command).sort();
}

Deno.test("lophn-agent/harness/tools#R16: blueprint의 command마다 이름·설명·입력 JSON Schema·effect·confirm·되돌리기 지원을 담은 tool 정의가 별도 등록 없이 만들어진다", async () => {
  const tools = await toolsFor("lophn");
  assertEquals(keysOf(tools), ALL_KEYS.slice().sort());
  const byKey = new Map(tools.map((tool) => [tool.command, tool]));

  const read = byKey.get("read_items")!;
  assertEquals(read.definition.origin, "app");
  assertEquals(read.definition.effect, "read");
  assertEquals(read.definition.confirm, false);
  assertEquals(read.definition.inputSchema, LIMIT_INPUT);
  assert(read.definition.name.startsWith("app_"));
  assert(read.definition.name.length <= 64);
  assert(read.definition.description.includes("read_items label"));
  assert(read.definition.description.includes("read_items does one thing"));
  assert(read.definition.description.includes("Usage"));

  // 입력이 없는 command는 빈 object이고 confirm·되돌리기·external 선언이 정의에 그대로 있다.
  assertEquals(byKey.get("audit")!.definition.inputSchema, {
    type: "object",
    properties: {},
    additionalProperties: false,
  });
  assertEquals(byKey.get("audit")!.definition.confirm, true);
  assertEquals(byKey.get("add_item")!.reversible, true);
  assertEquals(byKey.get("add_item")!.definition.reversible, true);
  assertEquals(byKey.get("drop_item")!.reversible, false);
  assertEquals(byKey.get("sync_remote")!.definition.effect, "external");

  // 선언이 대응 command 없이 지원을 말하거나 설명만 되돌릴 수 있다고 하면 지원이 아니다.
  assertEquals(byKey.get("ghost_revert")!.reversible, false);
  assertEquals(byKey.get("rename_item")!.reversible, false);

  // 같은 release의 같은 blueprint는 같은 정의(이름·revision)를 만든다. 별도 MCP 이름·묶음이 없다.
  const again = await toolsFor("lophn");
  assertEquals(
    again.map((tool) => [tool.definition.name, tool.definition.revision]),
    tools.map((tool) => [tool.definition.name, tool.definition.revision]),
  );
  for (const tool of tools) {
    assertEquals(tool.definition.contract, "app.connect");
    assertEquals(tool.definition.name.startsWith("mcp"), false);
    assertEquals(tool.definition.name.startsWith("ext_"), false);
  }
  // 정의는 목록에 preset·역할 이름 목록 없이 앱 정의로 들어간다.
  const listed = listTools(
    {
      builtin: [],
      app: tools.map((tool) => tool.definition),
      external: [],
    },
    { presetTools: [], roleTools: [] },
  );
  assertEquals(listed.length, tools.length);
  assertEquals(
    listTools(
      { builtin: [], app: tools.map((tool) => tool.definition), external: [] },
      { presetTools: [], roleTools: null },
    ),
    [],
  );
});

function fixturePorts() {
  const invoked: AppInvokeCall[] = [];
  const asked: unknown[] = [];
  const reads: { contract: string; input: unknown }[] = [];
  const state: {
    outcome: Result<AppInvokeOutcome>;
    invocations: Invocation[];
    status: Awaited<ReturnType<AppCommandPorts["status"]>>;
  } = {
    outcome: ok({
      kind: "result",
      result: { items: [1, 2] },
      invocation: INVOCATION,
      revert: null,
      source: { coverage: "complete", freshness: "fresh", continuation: null },
    }),
    invocations: [],
    status: err({ code: "unavailable", message: "no status" }),
  };
  const ports: AppCommandPorts & {
    call(
      contract: string,
      input: unknown,
      run: string,
    ): Promise<Result<unknown>>;
  } = {
    invoke(call) {
      invoked.push(call);
      return Promise.resolve(state.outcome);
    },
    status(call) {
      asked.push(call);
      return Promise.resolve(state.status);
    },
    call(contract, input) {
      reads.push({ contract, input });
      return Promise.resolve(
        ok({ invocations: state.invocations, next_cursor: null }),
      );
    },
  };
  return { ports, invoked, asked, reads, state };
}

function credential(call: string | undefined = CALL): RunCredential {
  return {
    run: RUN,
    targets: new Set([APP]),
    operations: new Set(["app.connect"]),
    ...(call === undefined ? {} : { call }),
  };
}

function invocation(over: Partial<Invocation> = {}): Invocation {
  return {
    id: INVOCATION,
    app: APP,
    release: RELEASE,
    operation: { kind: "command", command: "add_item" },
    trigger: { kind: "direct" },
    mode: "live",
    actor: `agent:${ASSIGNMENT}` as never,
    caller: { kind: "agent", run: RUN, tool_call: CALL },
    approval: null,
    input_hash: "b".repeat(64),
    status: "succeeded",
    started_at: "2026-10-07T00:00:00.000Z",
    finished_at: "2026-10-07T00:00:01.000Z",
    summary: { ok: true },
    detail_hash: null,
    ...over,
  };
}

Deno.test("lophn-agent/harness/tools#R16: 정의의 입력 검사는 선언을 그대로 쓰고 틀린 입력은 앱을 부르기 전에 거절하며 값을 고치지 않는다", async () => {
  const tools = await toolsFor("lophn");
  const fixture = fixturePorts();
  const handlers = createAppToolHandlers(tools, fixture.ports);
  const listed = tools.map((tool) => tool.definition);
  const read = tools.find((tool) => tool.command === "read_items")!;
  const run = (input: unknown) =>
    executeTool(
      { listed, handlers, credential: credential() },
      read.definition.name,
      input,
    );

  // 필수 누락·숫자 문자열·선언 밖 입력·범위 밖 값은 진입 0개다.
  for (
    const bad of [
      {},
      { limit: "3" },
      { limit: 3, extra: true },
      { limit: 0 },
      { limit: 3, title: 4 },
      "limit",
    ]
  ) {
    const outcome = await run(bad);
    assertEquals(outcome.outcome.kind, "failure", JSON.stringify(bad));
    assertEquals(outcome.executed, false);
  }
  assertEquals(fixture.invoked.length, 0);

  // 입력이 없는 command는 빈 object만 받는다.
  const audit = tools.find((tool) => tool.command === "audit")!;
  const noInput = await executeTool(
    { listed, handlers, credential: credential() },
    audit.definition.name,
    { value: 1 },
  );
  assertEquals(noInput.outcome.kind, "failure");
  assertEquals(fixture.invoked.length, 0);

  // 맞는 입력은 앱 통로 하나만 부르고 그 입력과 최초 ToolCall ID(request_key)를 그대로 보낸다.
  const good = await run({ limit: 3, title: "t" });
  assertEquals(good.outcome.kind, "success");
  assertEquals(fixture.invoked.length, 1);
  assertEquals(fixture.invoked[0], {
    app: APP,
    release: RELEASE,
    command: "read_items",
    input: { limit: 3, title: "t" },
    requestKey: CALL,
    run: RUN,
    toolCall: CALL,
  });
  assertEquals(
    (good.result.content as { result: unknown }).result,
    { items: [1, 2] },
  );
});

Deno.test("lophn-agent/harness/tools#R16: 같은 request_key의 재전송은 같은 ToolCall ID를 쓰고 되돌리기 receipt를 결과에 보존한다", async () => {
  const tools = await toolsFor("lophn");
  const fixture = fixturePorts();
  const receipt = {
    invocation: INVOCATION,
    receipt: "receipt-1",
    expected_revision: "3",
  };
  fixture.state.outcome = ok({
    kind: "result",
    result: { added: 1 },
    invocation: INVOCATION,
    revert: receipt,
    source: null,
  });
  const handlers = createAppToolHandlers(tools, fixture.ports);
  const add = tools.find((tool) => tool.command === "add_item")!;
  const listed = tools.map((tool) => tool.definition);
  const first = await executeTool(
    { listed, handlers, credential: credential() },
    add.definition.name,
    { limit: 1 },
  );
  // 재시작·복구가 같은 call을 다시 보내면 같은 ToolCall ID가 request_key다.
  await executeTool(
    { listed, handlers, credential: credential() },
    add.definition.name,
    { limit: 1 },
  );
  assertEquals(fixture.invoked.map((call) => call.requestKey), [CALL, CALL]);
  assertEquals(
    (first.result.content as { revert: unknown }).revert,
    receipt,
  );
  // 큰 결과가 상한에 걸려도 receipt는 잃지 않는다.
  fixture.state.outcome = ok({
    kind: "result",
    result: { blob: "x".repeat(40_000) },
    invocation: INVOCATION,
    revert: receipt,
    source: null,
  });
  const big = await executeTool(
    { listed, handlers, credential: credential() },
    add.definition.name,
    { limit: 1 },
  );
  assertEquals(big.result.complete, false);
  assertEquals((big.result.content as { revert: unknown }).revert, receipt);
});

Deno.test("lophn-agent/harness/tools#R17: 노출은 역할·현재 앱 허락·AgentAppScope의 교집합이다", async () => {
  // lophn: 허락한 command 전부. effect 판정(ask·allow)은 tool-judgment가 한다.
  assertEquals(keysOf(await toolsFor("lophn")), ALL_KEYS.slice().sort());

  // 허락에 없는 command는 선언에 있어도 없다. 허락이 없는 앱은 앱 자체가 없다.
  assertEquals(
    keysOf(await toolsFor("lophn", { granted: ["read_items", "add_item"] })),
    ["add_item", "read_items"],
  );
  assertEquals(keysOf(await toolsFor("lophn", { granted: [] })), []);

  // App Engineer: 담당 앱의 read와 되돌리기가 검증된 write만이다. external·미지원 write·선언만 지원인
  // write는 없고 confirm 선언은 approval을 거치므로 남는다.
  assertEquals(keysOf(await toolsFor("app_engineer")), [
    "add_item",
    "audit",
    "read_items",
  ]);
  // 담당 앱이 다르면 아무것도 없다.
  assertEquals(
    keysOf(
      await toolsFor("app_engineer", { work: { kind: "app", id: OTHER_APP } }),
    ),
    [],
  );

  // Operator: assignment가 승인한 read만이고 confirm 선언 command는 승인돼도 없다.
  assertEquals(
    keysOf(
      await toolsFor("operator", {
        readCommands: ["read_items", "audit", "add_item"],
      }),
    ),
    ["read_items"],
  );
  assertEquals(keysOf(await toolsFor("operator")), []);

  // Context Engineer: 앱 command 실행이 없다.
  assertEquals(keysOf(await toolsFor("context_engineer")), []);
});

Deno.test("lophn-agent/harness/tools#R17: release나 command 계약이 바뀌면 옛 정의와 다른 정의가 나오고 범위 밖 이름은 없는 이름과 같은 답이다", async () => {
  const before = await toolsFor("lophn");
  const readBefore = before.find((tool) => tool.command === "read_items")!;
  // release 교체: 같은 command여도 정의의 revision이 달라 옛 정의와 섞이지 않는다.
  const replaced = await toolsFor("lophn", {
    blueprint: view({ release: NEXT_RELEASE }),
  });
  const readAfter = replaced.find((tool) => tool.command === "read_items")!;
  assert(readAfter.definition.revision !== readBefore.definition.revision);
  assert(readAfter.definitionHash !== readBefore.definitionHash);
  // 입력·effect·confirm·되돌리기 중 하나만 바뀌어도 지문이 달라진다.
  const changed = (over: Partial<AppBlueprintCommand>) =>
    toolsFor("lophn", {
      blueprint: view(
        {},
        COMMANDS.map((entry) =>
          entry.key === "read_items" ? { ...entry, ...over } : entry
        ),
      ),
    }).then((tools) =>
      tools.find((tool) => tool.command === "read_items")!.definitionHash
    );
  for (
    const over of [
      { input: { ...LIMIT_INPUT, required: [] } as never },
      { effect: "write" as const },
      { confirm: true },
      { description: "different" },
    ]
  ) {
    assert((await changed(over)) !== readBefore.definitionHash);
  }

  // 목록에 없는 앱·command의 호출은 없는 이름과 똑같은 답이다.
  const fixture = fixturePorts();
  const tools = await toolsFor("app_engineer");
  const handlers = createAppToolHandlers(tools, fixture.ports);
  const listed = tools.map((tool) => tool.definition);
  const dropped = before.find((tool) => tool.command === "drop_item")!;
  const absent = await executeTool(
    { listed, handlers, credential: credential() },
    "app_00000000_nothing_000000",
    {},
  );
  const outOfScope = await executeTool(
    { listed, handlers, credential: credential() },
    dropped.definition.name,
    {},
  );
  assertEquals(outOfScope.outcome, absent.outcome);
  assertEquals(outOfScope.result.summary, absent.result.summary);
  assertEquals(outOfScope.executed, false);
  assertEquals(fixture.invoked.length, 0);
});

Deno.test("lophn-agent/harness/tools#R8: 앱 command tool은 앱 통로 하나만 쓰고 앱 소스·원본 파일·secret 값에 닿는 정의가 없다", async () => {
  const tools = await toolsFor("lophn");
  for (const tool of tools) {
    // 소유 contract는 앱 통로(app.connect) 하나다. 파일·소스·secret을 읽는 contract가 아니다.
    assertEquals(tool.definition.contract, "app.connect");
    const schema = JSON.stringify(tool.definition.inputSchema);
    for (const word of ["source_path", "secret", "file", "token"]) {
      assertEquals(schema.includes(word), false, word);
    }
  }
  // 앱 읽기 묶음은 소스 경로와 연결 정보를 결과에 싣지 않는다.
  const calls: string[] = [];
  const handlers = createAppReadToolHandlers({
    call(contract, _input) {
      calls.push(contract);
      if (contract === "app.get") {
        return Promise.resolve(ok({
          app: {
            id: APP,
            slug: "usage",
            name: "Usage",
            description: "usage app",
            planning_version: null,
            source_path: "/home/someone/usage",
            active_release: RELEASE,
            revision: "1",
            run_enabled: true,
            status: "active",
          },
          as_of_seq: "5",
          next_cursor: null,
        }));
      }
      return Promise.resolve(ok({
        app: APP,
        state: "running",
        observation: {
          app: APP,
          release: RELEASE,
          mode: "live",
          process_nonce: "nonce-secret",
          endpoint: "/tmp/run/app.sock",
          ready: true,
          accepting: true,
        },
        observed_at: "2026-10-07T00:00:00.000Z",
        as_of_seq: "5",
        next_cursor: null,
      }));
    },
  });
  const cred = credential();
  const read = await handlers.get("app.read")!({ app: APP }, cred);
  const health = await handlers.get("app.health")!({ app: APP }, cred);
  assert(read.ok && health.ok);
  const text = JSON.stringify([read.value, health.value]);
  for (
    const leaked of ["/home/someone", "source_path", "nonce-secret", "app.sock"]
  ) {
    assertEquals(text.includes(leaked), false, leaked);
  }
  assertEquals(
    (read.value.content as { app: { active_release: string } }).app
      .active_release,
    RELEASE,
  );
  assertEquals(
    (health.value.content as { observation: { ready: boolean } }).observation
      .ready,
    true,
  );
  // 앱 읽기·problem 읽기는 모두 읽기이고 소유 contract 읽기 하나씩이다.
  assertEquals(calls, ["app.get", "app.runtime"]);
  assert(PROBLEM_READ_TOOL_NAMES.includes("repair.read"));
});

Deno.test("lophn-agent/harness/tools#R16: 결과를 잃은 호출은 ToolCall ID request_key로 앱 status와 invocation 기록을 조회해 확정하고 모르면 불명확이다", async () => {
  const tools = await toolsFor("lophn");
  const add = tools.find((tool) => tool.command === "add_item")!;
  const listed = tools.map((tool) => tool.definition);

  // 응답을 잃었고 앱 ledger에 종료 기록이 있다: 그 결과로 닫는다.
  let fixture = fixturePorts();
  fixture.state.outcome = ok({ kind: "unknown" });
  fixture.state.invocations = [
    invocation({
      id: "inv_01h455vb4pex5v6nkc6gd5fdw9",
      caller: {
        kind: "agent",
        run: RUN,
        tool_call: "tcl_01h455vb4pex5v6nkc6gd5fdw9",
      },
    }),
    invocation(),
  ];
  let handlers = createAppToolHandlers(tools, fixture.ports);
  let outcome = await executeTool(
    { listed, handlers, credential: credential() },
    add.definition.name,
    { limit: 1 },
  );
  assertEquals(outcome.outcome.kind, "success");
  assertEquals(
    (outcome.result.content as { invocation: string }).invocation,
    INVOCATION,
  );
  assertEquals(fixture.reads[0].contract, "invocations.list");
  assertEquals((fixture.reads[0].input as { app: string }).app, APP);

  // 아직 끝나지 않은 기록은 같은 request_key로 앱에 status를 묻는다.
  fixture = fixturePorts();
  fixture.state.outcome = ok({ kind: "unknown" });
  fixture.state.invocations = [
    invocation({ status: "running", finished_at: null }),
  ];
  fixture.state.status = ok({
    progress: "succeeded",
    result: { result: { added: 1 } },
  });
  handlers = createAppToolHandlers(tools, fixture.ports);
  outcome = await executeTool(
    { listed, handlers, credential: credential() },
    add.definition.name,
    { limit: 1 },
  );
  assertEquals(outcome.outcome.kind, "success");
  assertEquals(fixture.asked.length, 1);
  assertEquals(
    fixture.asked[0] as { requestKey: string; invocation: string },
    {
      ...(fixture.asked[0] as object),
      requestKey: CALL,
      invocation: INVOCATION,
    },
  );

  // 기록도 status도 확정하지 못하면 성공이나 실패로 추측하지 않는다.
  fixture = fixturePorts();
  fixture.state.outcome = ok({ kind: "unknown" });
  handlers = createAppToolHandlers(tools, fixture.ports);
  outcome = await executeTool(
    { listed, handlers, credential: credential() },
    add.definition.name,
    { limit: 1 },
  );
  assertEquals(outcome.outcome.kind, "uncertain");
  assertEquals(fixture.invoked.length, 1);

  // 연결을 열지 못해 요청이 나가지 않은 것은 실패이고 조회하지 않는다.
  fixture = fixturePorts();
  fixture.state.outcome = err({
    code: "unavailable",
    message: "not reachable",
  });
  handlers = createAppToolHandlers(tools, fixture.ports);
  outcome = await executeTool(
    { listed, handlers, credential: credential() },
    add.definition.name,
    { limit: 1 },
  );
  assertEquals(outcome.outcome.kind, "failure");
  assertEquals(fixture.reads.length, 0);
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R8: 재시작 뒤 결과를 모르는 앱 write는 앱 invocation 기록으로 확정하고 기록이 없으면 불명확으로 남는다", async () => {
  const tools = await toolsFor("lophn");
  const add = tools.find((tool) => tool.command === "add_item")!;
  const readTool = tools.find((tool) => tool.command === "read_items")!;
  const stored: Invocation[] = [];
  const reads: string[] = [];
  const lookups = createAppToolLookups(tools, (contract, _input) => {
    reads.push(contract);
    return Promise.resolve(ok({ invocations: stored, next_cursor: null }));
  });
  // 읽기는 결과 조회가 없다(다시 부르면 된다).
  assertEquals(lookups.has(readTool.definition.name), false);
  const lookup = lookups.get(add.definition.name)!;
  const target = { tool_call: CALL, tool: add.definition.name, input: {} };

  assertEquals(await lookup(target), null);
  stored.push(invocation({ status: "running", finished_at: null }));
  assertEquals(await lookup(target), null);
  stored.length = 0;
  stored.push(invocation({ status: "unknown" }));
  assertEquals(await lookup(target), null);
  stored.length = 0;
  stored.push(invocation());
  const found = await lookup(target);
  assertEquals(found?.outcome, { kind: "success", code: "ok" });
  assertEquals(found?.result.status, "success");
  stored.length = 0;
  stored.push(invocation({ status: "failed" }));
  assertEquals((await lookup(target))?.outcome.kind, "failure");
  // 다른 ToolCall의 기록은 이 call의 결과가 아니다.
  assertEquals(
    await lookup({ ...target, tool_call: "tcl_01h455vb4pex5v6nkc6gd5fdw8" }),
    null,
  );
  assert(reads.every((contract) => contract === "invocations.list"));
});
