// lophn-agent/harness/tools#R8, R16, R17: 앱 command 자동 tool을 실제 core(임시 LOPHN_HOME의 grant와
// `apps/connect`)와 실제 앱 자식 프로세스(runtime entrypoint의 direct socket)로 본다. 선언을 읽는 통로만
// blueprint read 대역이다(releases 조립이 이 world에 없다). 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../packages/base/mod.ts";
import {
  appBlueprint,
  type AppBlueprintCommand,
  grantsList,
} from "../../packages/protocol/apps/mod.ts";
import type {
  AgentAppScope,
  AgentRole,
} from "../../packages/protocol/lophn-agent/mod.ts";
import {
  type AuthenticatedContext,
  routePath,
} from "../../packages/protocol/server/mod.ts";
import { computeAgentAppScope } from "../../packages/core/lophn-agent/run-loop/mod.ts";
import { executeTool } from "../../packages/core/lophn-agent/tools/mod.ts";
import { call as httpCall } from "../../packages/core/testing/approvals-fixture.ts";
import {
  declare,
  grant,
  openWorld,
  type World,
} from "../../packages/core/apps/runtime/world_test.ts";
import { fixtureBlueprint } from "../../packages/core/apps/runtime/testing/app-process.ts";
import { createAppToolkit } from "./app-toolkit.ts";
import type { CoreCall } from "./core-call.ts";

const ASSIGNMENT = "asg_01arz3ndektsv4rrffq69g5fav";
const RUN = "run_01arz3ndektsv4rrffq69g5fav";
const TOOL = "tcl_01arz3ndektsv4rrffq69g5fav";

const DECLARED = ["usage.undo", "usage.read", "usage.save", "usage.admin"];

async function withWorld(run: (world: World) => Promise<void>) {
  const world = await openWorld({ approvals: true });
  try {
    await world.allow();
    await declare(world, DECLARED);
    await run(world);
  } finally {
    await world.close();
  }
}

function commandsOf(): AppBlueprintCommand[] {
  return (fixtureBlueprint()["commands"] as AppBlueprintCommand[]).filter((
    entry,
  ) => DECLARED.includes(entry.key));
}

// 선언을 읽는 machine 통로. blueprint는 fixture 앱의 선언이고 허락(grants)은 실제 core다.
function machineOf(world: World, release: string): CoreCall {
  return async (path, body) => {
    if (path === routePath(appBlueprint)) {
      return ok(appBlueprint.output.parse({
        app: world.app,
        release,
        blueprint_hash: "a".repeat(64),
        name: "Usage",
        description: "Reads usage",
        commands: commandsOf(),
        screens: [],
        automations: [],
        declarations: {
          permissions: [],
          app_connections: [],
          commands: DECLARED,
          automations: [],
          problem_codes: [],
          documents: [],
        },
        evidence: {
          description: { complete: true, gaps: [] },
          structure: { validated: true },
          test: { passed: false, verifications: [] },
        },
        as_of_seq: "1",
        next_cursor: null,
      }));
    }
    if (path === routePath(grantsList)) {
      const reply = await httpCall(
        world.harness,
        "grants/list",
        world.machine.token,
        body,
      );
      return reply.status === 200
        ? ok(reply.body)
        : err({ code: "unavailable", message: "grants are not readable" });
    }
    return err({ code: "not_found", message: "route is not open" });
  };
}

// run의 agent 자격이다. AgentAppScope(scope.agent)는 platform registry가 인증한 context에만 실려서
// 같은 인증 context를 connector에 직접 넣는다(packages/apps/runtime/agent-connect_test.ts와 같다).
async function agentOf(
  world: World,
  role: AgentRole,
  scope: AgentAppScope,
): Promise<CoreCall> {
  const login = await world.login("agent", ["app.connect"], {
    targets: { assignment: ASSIGNMENT, run: RUN },
    conditions: { assignment: ASSIGNMENT, run: RUN },
  });
  const context = {
    ...login.context,
    scope: {
      ...login.context.scope,
      agent: { role, assignment: ASSIGNMENT, apps: scope.apps },
    },
  } as AuthenticatedContext;
  return async (path, body) => {
    if (path !== "apps/connect") {
      return err({ code: "not_found", message: "route is not open" });
    }
    return await world.harness.appsControl.connector.connect(
      context,
      body as never,
    );
  };
}

async function open(
  world: World,
  role: AgentRole,
  options: {
    release?: string;
    readCommands?: string[];
    child?: Awaited<ReturnType<World["start"]>>;
  } = {},
) {
  const child = options.child ?? await world.start();
  const toolkit = createAppToolkit({
    machine: machineOf(world, options.release ?? child.release!),
  });
  const loaded = await toolkit.load();
  assert(loaded.ok, loaded.ok ? "" : loaded.error.message);
  const scope = computeAgentAppScope({
    role,
    assignment: ASSIGNMENT,
    work: role === "app_engineer"
      ? { kind: "app", id: world.app }
      : { kind: "all", id: null },
    read_apps: role === "operator" ? [world.app] : [],
    read_commands: (options.readCommands ?? []).map((command) => ({
      app: world.app,
      command,
    })),
    offers: loaded.value.offers,
  });
  assert(scope.ok);
  const tools = await toolkit.define(scope.value, loaded.value);
  const agent = await agentOf(world, role, scope.value);
  const handlers = toolkit.handlers(tools, agent);
  const listed = tools.map((tool) => tool.definition);
  const run = (command: string, input: unknown = {}) => {
    const tool = tools.find((entry) => entry.command === command);
    return executeTool(
      {
        listed,
        handlers,
        credential: {
          run: RUN,
          call: TOOL,
          targets: new Set([world.app]),
          operations: new Set(["app.connect"]),
        },
      },
      tool?.definition.name ?? "app_00000000_missing_000000",
      input,
    );
  };
  return { child, tools, run, loaded: loaded.value };
}

Deno.test("lophn-agent/harness/tools#R16: 허락된 앱의 blueprint command가 MCP 서버 없이 tool이 되고 실제 앱 자식 프로세스의 direct 호출로 실행된다", async () => {
  await withWorld(async (world) => {
    // 허락 전에는 앱 command tool이 하나도 없다. 앱이 열려 있다는 사실이 agent 허락은 아니다.
    const child = await world.start();
    const closed = await open(world, "lophn", { child });
    assertEquals(closed.tools.length, 0);

    const opened = await grant(world, {
      kind: "agent.commands",
      commands: ["usage.read", "usage.save", "usage.undo"],
    });
    assertEquals(opened.status, 200, JSON.stringify(opened.body));
    const { tools, run, loaded } = await open(world, "lophn", { child });
    // 허락(read·save·undo) ∩ 선언. 허락에 없는 usage.admin은 선언에 있어도 tool이 없다.
    assertEquals(tools.map((tool) => tool.command).sort(), [
      "usage.read",
      "usage.save",
      "usage.undo",
    ]);
    assertEquals(loaded.offers[0].granted.slice().sort(), [
      "usage.read",
      "usage.save",
      "usage.undo",
    ]);
    const read = await run("usage.read", {});
    assertEquals(read.outcome.kind, "success", JSON.stringify(read.result));
    assertEquals(
      (read.result.content as { result: unknown }).result,
      { command: "usage.read", input: null },
    );
    const save = await run("usage.save", {});
    assertEquals(save.outcome.kind, "success", JSON.stringify(save.result));
    // 허락에 없는 command는 없는 이름과 같은 답이다.
    const admin = await run("usage.admin", {});
    const absent = await run("nothing", {});
    assertEquals(admin.outcome, absent.outcome);
    assertEquals(admin.result.summary, absent.result.summary);
  });
});

Deno.test("lophn-agent/harness/tools#R17: 역할마다 같은 허락에서 자기 범위의 command만 tool이 되고 Operator는 승인한 read만이다", async () => {
  await withWorld(async (world) => {
    const opened = await grant(world, {
      kind: "agent.commands",
      commands: ["usage.admin", "usage.read", "usage.save", "usage.undo"],
    });
    assertEquals(opened.status, 200, JSON.stringify(opened.body));
    const child = await world.start();
    const names = async (
      role: AgentRole,
      options?: { readCommands?: string[] },
    ) => {
      const { tools } = await open(world, role, { ...options, child });
      return tools.map((tool) => tool.command).sort();
    };
    assertEquals(await names("lophn"), [
      "usage.admin",
      "usage.read",
      "usage.save",
      "usage.undo",
    ]);
    // 담당 앱의 read와 되돌리기가 검증된 write(대응 command usage.undo가 있는 save·admin)만이다.
    // usage.undo 자체는 지원 선언이 없어 없다.
    assertEquals(await names("app_engineer"), [
      "usage.admin",
      "usage.read",
      "usage.save",
    ]);
    assertEquals(
      await names("operator", { readCommands: ["usage.read", "usage.save"] }),
      ["usage.read"],
    );
    assertEquals(await names("operator"), []);
    assertEquals(await names("context_engineer"), []);
  });
});

Deno.test("lophn-agent/harness/tools#R17: 정의가 만들어진 release와 지금 앱의 release가 다르면 앱에 보내지 않고 앱에 닿지 못하면 불명확이 아니라 실패다", async () => {
  await withWorld(async (world) => {
    const opened = await grant(world, {
      kind: "agent.commands",
      commands: ["usage.read"],
    });
    assertEquals(opened.status, 200, JSON.stringify(opened.body));
    // 정의는 다른 release의 blueprint에서 만들어졌다(release 교체 직후의 옛 정의).
    const child = await world.start();
    const stale = await open(world, "lophn", {
      release: "rel_01arz3ndektsv4rrffq69g5faw",
      child,
    });
    const before = stale.child.output();
    const refused = await stale.run("usage.read", {});
    assertEquals(refused.outcome, { kind: "failure", code: "conflict" });
    // 앱은 호출을 받지 않았다.
    assertEquals(stale.child.output(), before);

    // 앱 프로세스가 사라졌다: 요청이 나가지 않았으므로 결과 불명이 아니다.
    const live = await open(world, "lophn", { child });
    await child.stop();
    const down = await live.run("usage.read", {});
    assertEquals(down.outcome, { kind: "failure", code: "unavailable" });
  });
});
