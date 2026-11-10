import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../base/mod.ts";
import { appCreate } from "../../protocol/apps/apps.ts";
import { jobCreate } from "../../protocol/jobs/mod.ts";
import { WORKSPACE_KINDS } from "../../protocol/lophn-agent/workspaces.ts";
import { runStart } from "../../protocol/runs/mod.ts";
import { workspaceToolNames } from "../../protocol/lophn-agent/tool-lists.ts";
import { appConnectSource } from "../../protocol/apps/apps.ts";
import { packagePublish } from "../../protocol/apps/package-routes.ts";
import { previewsStart } from "../../protocol/apps/previews.ts";
import {
  releaseActivate,
  releasePrepare,
} from "../../protocol/apps/releases.ts";
import {
  agentConditions,
  workspaceOperations,
} from "../agent-workspaces/credentials.ts";
import { FILE_HOOKS } from "../agent-workspaces/hooks.ts";
import { agentTools } from "./agent-tools.ts";
import { dispatchTarget } from "../lophn-agent/tools/dispatch.ts";
import { commandTools } from "../lophn-agent/tools/lophn/command-tool.ts";
import { resolveAgent } from "../lophn-agent/agents/resolve.ts";
import {
  runnableTools,
  visibleTools,
} from "../lophn-agent/run-loop/prepare.ts";
import { selectTools, type ToolContext } from "../lophn-agent/tools/mod.ts";
import { buildWireTable, inputJsonSchema } from "../lophn-agent/tools/wire.ts";
import { executeToolCall } from "../lophn-agent/tools/work.ts";

// agent credential 상한은 core가 대조하는 route 이름이어야 한다. tool 이름이면 command가 forbidden이다.
test("release·publish·preview·소스 연결 route는 app 종류의 credential 상한에만 있고, app workspace session의 credential은 그 앱 하나에 묶인다", () => {
  const definitions = agentTools({ file: FILE_HOOKS });
  const app = workspaceOperations("app", definitions);
  const project = workspaceOperations("project", definitions);
  const home = workspaceOperations("home", definitions);
  for (const route of [
    appConnectSource,
    packagePublish,
    releasePrepare,
    releaseActivate,
    previewsStart,
  ]) {
    assert.ok(app.includes(route.name), route.name);
    assert.ok(!project.includes(route.name), route.name);
    assert.ok(!home.includes(route.name), route.name);
  }
  assert.deepStrictEqual(appConnectSource.name, "app.connect_source");
  assert.ok(!app.includes("app.link_source"));
  const ids = { session: "s", turn: "t", process: "p" };
  const inApp = agentConditions({
    ...ids,
    workspace: { kind: "app", id: "app_1" },
  });
  assert.deepStrictEqual(inApp.app, "app_1");
  assert.ok(!("project" in inApp));
  const inProject = agentConditions({
    ...ids,
    workspace: { kind: "project", id: "prj_1" },
  });
  assert.deepStrictEqual(inProject.project, "prj_1");
  assert.ok(!("app" in inProject));
  const atHome = agentConditions({ ...ids, workspace: null });
  assert.ok(!("app" in atHome));
  assert.ok(!("project" in atHome));
});

// selectTools는 정의 없는 이름을 조용히 건너뛴다. 어긋나면 agent가 그 tool을 말없이 못 본다.
test("workspace 종류 목록의 모든 이름에 정의가 있고 모든 정의가 어느 목록에 있다", () => {
  const defined = new Set(
    agentTools({ file: FILE_HOOKS }).map((tool) => tool.name),
  );
  const listed = new Set(
    WORKSPACE_KINDS.flatMap((kind) => workspaceToolNames(kind)),
  );
  assert.deepStrictEqual(
    [...listed].filter((name) => !defined.has(name)),
    [],
  );
  assert.deepStrictEqual(
    [...defined].filter((name) => !listed.has(name)),
    [],
  );
});

// tool 입력 하나라도 JSON Schema로 바뀌지 않으면 그 workspace 종류의 turn이 준비 단계에서 조용히 멈춘다.
test("모든 내장 tool의 입력이 model에 보낼 JSON Schema로 바뀐다", () => {
  const failed: string[] = [];
  for (const tool of agentTools({ file: FILE_HOOKS })) {
    try {
      inputJsonSchema(tool);
    } catch {
      failed.push(tool.name);
    }
  }
  assert.deepStrictEqual(failed, []);
});

// `lophn` tool은 그 session의 workspace 종류가 부를 수 없는 명령을 실행하지 않고, agent credential 상한에도 그 route가 없어야 한다.
// 명령 표의 workspace 종류 칸 하나가 두 곳(실행 목록, credential 상한)을 정한다.
test("lophn tool은 workspace 종류에 허락되지 않은 명령을 실행하지 않고 credential 상한에도 그 route가 없다", async () => {
  const definitions = agentTools({ file: FILE_HOOKS });
  for (const kind of WORKSPACE_KINDS) {
    const calls: unknown[] = [];
    const ctx = {
      kind,
      tool_call: "tcl_1",
      listed: commandTools(kind),
      core: (path: string, body: unknown) => {
        calls.push({ path, body });
        return Promise.resolve(ok({}));
      },
    } as unknown as ToolContext;
    // agent.run은 binary 전용(workspace 종류가 비어 있다)이다.
    const target = dispatchTarget("lophn", {
      args: ["agent", "run", "hello"],
    });
    assert.deepStrictEqual(target.name, "agent_run");
    const denied = await executeToolCall(ctx, target.name, target.input);
    assert.deepStrictEqual(
      [denied.executed, denied.outcome.code],
      [false, "not_found"],
    );
    assert.deepStrictEqual(calls, []);
    const operations = workspaceOperations(kind, definitions);
    assert.ok(!operations.includes(runStart.name), kind);
    assert.ok(operations.includes(jobCreate.name), kind);
  }
});

// 같은 tool call을 다시 보내면 같은 idempotency key로 가야 job이 두 번 생기지 않는다.
test("lophn tool의 write 명령은 tool call id를 idempotency key로 보낸다", async () => {
  const keys: unknown[] = [];
  const ctx = {
    kind: "home",
    tool_call: "tcl_same",
    scope: { read: [] },
    listed: commandTools("home"),
    core: (_path: string, body: { idempotency_key?: unknown }) => {
      keys.push(body.idempotency_key);
      return Promise.resolve(ok({}));
    },
  } as unknown as ToolContext;
  const target = dispatchTarget("lophn", {
    args: [
      "job",
      "create",
      "daily",
      "--every",
      "1d",
      "--missed-policy",
      "run",
      "--action",
      '{"kind":"workflow_start","workflow":"p/w","text":"go"}',
    ],
  });
  assert.deepStrictEqual(target.name, "job_create");
  await executeToolCall(ctx, target.name, target.input);
  await executeToolCall(ctx, target.name, target.input);
  assert.deepStrictEqual(keys, ["tcl_same", "tcl_same"]);
});

// wire 이름이 하나라도 겹치면 그 session의 tool 표 전체가 만들어지지 않아 모든 tool이 "not available"이 된다.
// 내장 tool을 명령으로 옮기고 옛 tool 정의를 지우지 않으면 이렇게 된다.
test("workspace 종류의 tool 목록과 명령 정의의 wire 이름이 겹치지 않는다", () => {
  for (const kind of WORKSPACE_KINDS) {
    const table = buildWireTable([
      ...selectTools(
        workspaceToolNames(kind),
        { input_media: ["image"] },
        agentTools({ file: FILE_HOOKS }),
      ),
      ...commandTools(kind),
    ]);
    assert.ok(table.ok, kind);
  }
});

// 고른 이름은 상한 안에서만 보이고 돈다. 목록 밖(home의 shell.run, project의 app.create), 고르지 않은 명령, 고르지 않은 MCP, 할당 밖 앱 command는
// tools[]에도 실행 목록에도 없고, credential 상한은 고른 것과 상관없이 workspace 종류 그대로다.
test("workspace 종류 목록 밖을 고른 custom은 그 tool을 보지도 부르지도 못하고 credential 작업은 workspace 종류 그대로다", async () => {
  const definitions = agentTools({ file: FILE_HOOKS });
  const picks = [
    "file.read",
    "shell.run",
    "app.create",
    "call.reply",
    "notes.add",
  ];
  const calls: unknown[] = [];
  for (const kind of ["home", "project"] as const) {
    const visible = visibleTools({
      kind,
      agent: { runtime: "custom", picks },
      names: workspaceToolNames(kind),
      definitions,
      inputMedia: ["image"],
      external: [],
      appDocs: [],
    });
    const names = visible.map((tool) => tool.name);
    // project는 shell.run이 목록 안이라 보인다. home은 밖이라 안 보인다.
    assert.deepStrictEqual(
      names,
      kind === "home"
        ? ["file.read", "lophn"]
        : ["file.read", "shell.run", "lophn"],
      kind,
    );
    const lophn = visible.find((tool) => tool.name === "lophn")!;
    assert.ok(lophn.description.includes("call reply"), kind);
    // app.create는 home의 명령이라 home에서는 고른 대로 보이고, project에서는 밖이다.
    assert.deepStrictEqual(
      lophn.description.includes("app create - "),
      kind === "home",
      kind,
    );
    assert.ok(!lophn.description.includes("job create - "), kind);
    assert.ok(!lophn.description.includes("notes"), kind);

    const listed = runnableTools({
      fixed: visible,
      kind,
      custom: { current: new Set(names), usable: new Set(picks) },
    });
    const ctx = {
      kind,
      tool_call: "tcl_1",
      listed,
      core: (path: string, body: unknown) => {
        calls.push({ path, body });
        return Promise.resolve(ok({}));
      },
    } as unknown as ToolContext;
    const tries: [string, unknown][] = [["lophn", { args: ["job", "list"] }]];
    if (kind === "project") {
      tries.push(["lophn", { args: ["app", "create", "x", "y"] }]);
    } else {
      tries.push(["shell_run", { command: "true" }]);
    }
    for (const [name, input] of tries) {
      const target = dispatchTarget(name, input);
      const denied = await executeToolCall(ctx, target.name, target.input);
      assert.deepStrictEqual(denied.executed, false, `${kind} ${name}`);
    }
    assert.deepStrictEqual(calls, []);
    // 고른 명령은 돈다.
    const reply = dispatchTarget("lophn", { args: ["call", "reply"] });
    assert.ok(
      listed.some((tool) => tool.name === reply.name),
      kind,
    );

    // credential 상한은 workspace 종류의 것이다: 고르지 않은 명령의 route도 있고 목록 밖 명령의 route는 없다.
    const operations = workspaceOperations(kind, definitions);
    assert.ok(operations.includes(jobCreate.name), kind);
    assert.deepStrictEqual(
      operations.includes(appCreate.name),
      kind === "home",
    );
  }

  // 고르지 않은 MCP tool은 resolved agent에 닿지 않는다.
  const resolved = await resolveAgent({
    agent: "agt_00000000000000000000000001",
    workspace: null,
    called_from: null,
    definition: {
      handle: "reviewer",
      name: "reviewer",
      body: "review",
      runtime: "custom",
      tools: ["mcp__s__a"],
    },
    global_model: {
      provider: "pvd_00000000000000000000000001",
      model_name: "m",
      option_values: {},
    },
    session_model: null,
    environment: {
      skills: [],
      mcp: [
        { server_name: "s", original_tool: "a" },
        { server_name: "s", original_tool: "b" },
        { server_name: "t", original_tool: "a" },
      ],
    },
    tools: [],
  });
  assert.ok(resolved.ok);
  assert.deepStrictEqual(resolved.value.mcp, [
    { server_name: "s", original_tool: "a" },
  ]);
});
