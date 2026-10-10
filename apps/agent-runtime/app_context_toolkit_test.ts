// apps/agent-context#R1, R2, R5, R6 / lophn-agent/harness/tools#R18: 제품 agent runtime의 앱 조립이 화면 context
// 조회(`app.screen_context`)와 주석 쓰기(`app.annotate`)를 tool 정의·판정 연결·실행 handler로 잇는다. 선언을
// 읽는 machine 통로와 앱 direct 통로는 대역이고, 허락·범위·판정 규칙은 harness 모듈 그대로다.
import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../packages/base/mod.ts";
import {
  appBlueprint,
  type AppBlueprintCommand,
  grantsList,
} from "../../packages/contracts/apps/mod.ts";
import { workspaceRead } from "../../packages/contracts/shell/mod.ts";
import { routePath } from "../../packages/contracts/platform/mod.ts";
import { computeAgentAppScope } from "../../packages/lophn-agent/harness/run-loop/mod.ts";
import {
  appAnnotateTool,
  appScreenContextTool,
} from "../../packages/lophn-agent/harness/tools/mod.ts";
import type { DirectRequest } from "../../packages/apps/runtime/client/mod.ts";
import { createAppToolkit } from "./app-toolkit.ts";
import type { CoreCall } from "./core-call.ts";

const APP = "app_01arz3ndektsv4rrffq69g5fav";
const RELEASE = "rel_01arz3ndektsv4rrffq69g5fav";
const GRANT = "grt_01arz3ndektsv4rrffq69g5fav";
const APPROVAL = "apr_01arz3ndektsv4rrffq69g5fav";
const ASSIGNMENT = "asg_01arz3ndektsv4rrffq69g5fav";
const RUN = "run_01arz3ndektsv4rrffq69g5fav";
const CALL = "tcl_01arz3ndektsv4rrffq69g5fav";
const VIEW = "view-session-1";
const REVISION = "rev-3";
const SESSION = "ses_01arz3ndektsv4rrffq69g5fav";
const OTHER_APP = "app_01arz3ndektsv4rrffq69g5faw";
const AT = "2026-10-10T00:00:00.000Z";

const READ_INPUT = {
  type: "object",
  properties: {
    screen: { type: "string" },
    view_session: { type: "string" },
    detail: { type: "boolean" },
  },
  required: ["screen", "view_session"],
  additionalProperties: false,
} as const;
const WRITE_INPUT = {
  type: "object",
  properties: {
    screen: { type: "string" },
    view_session: { type: "string" },
    expected_revision: { type: "string" },
    target: { type: "string" },
    text: { type: "string", minLength: 1 },
  },
  required: ["screen", "view_session", "expected_revision", "target", "text"],
  additionalProperties: false,
} as const;

const COMMANDS = [
  {
    key: "read_screen",
    label: "Read",
    description: "reads the screen",
    effect: "read",
    confirm: false,
    input: READ_INPUT,
    revert: { supported: false },
  },
  {
    key: "write_hint",
    label: "Hint",
    description: "writes a hint",
    effect: "write",
    confirm: false,
    input: WRITE_INPUT,
    revert: { supported: true, command: "undo_hint" },
  },
  {
    key: "undo_hint",
    label: "Undo",
    description: "reverts a hint",
    effect: "write",
    confirm: false,
    input: null,
    revert: { supported: false },
  },
] as unknown as AppBlueprintCommand[];

function machineOf(granted: string[]): CoreCall {
  return (path) => {
    if (path === routePath(appBlueprint)) {
      return Promise.resolve(ok(appBlueprint.output.parse({
        app: APP,
        release: RELEASE,
        blueprint_hash: "a".repeat(64),
        name: "Todo",
        description: "A todo app",
        commands: COMMANDS,
        screens: [{
          key: "todos",
          label: "Todos",
          path: "todos",
          sizes: ["full", "panel"],
        }],
        automations: [],
        agent_context: [{
          screen: "todos",
          read_command: "read_screen",
          sensitive_paths: [],
          annotation_targets: [
            { key: "hint", label: "Hint", write_command: "write_hint" },
          ],
        }],
        declarations: {
          permissions: [],
          app_connections: [],
          commands: COMMANDS.map((command) => command.key),
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
      })));
    }
    if (path === routePath(grantsList)) {
      return Promise.resolve(ok(grantsList.output.parse({
        grants: [{
          id: GRANT,
          app: APP,
          kind: "agent.commands",
          scope: { kind: "agent.commands", commands: granted },
          approval: APPROVAL,
          status: "active",
          created_by: "user",
          created_at: AT,
          revoked_by: null,
          revoked_at: null,
        }],
        grants_seq: "4",
        as_of_seq: "4",
        next_cursor: null,
      })));
    }
    return Promise.resolve(
      err({ code: "not_found", message: "route is not open" }),
    );
  };
}

// run의 agent 자격이다. 연결 요청은 서명된 connection 모양으로 답하고 앱 direct 요청은 `direct`가 받는다.
// 사람 창의 앱 패널 탭이다. 이 run의 workspace에 열려 있는 view_session만 agent가 가리킬 수 있다.
type PanelTab = { app: string; view_session?: string };
const PANELS: PanelTab[] = [{ app: APP, view_session: VIEW }];

function workspaceOf(tabs: PanelTab[], page: number) {
  return ok({
    availability: "current",
    observed_at: AT,
    generation: 1,
    summary: "project none",
    tab_page: page === 0
      ? tabs.map((tab, index) => ({
        kind: "app_panel",
        key: `tab-${index}`,
        selected: index === 0,
        surface: "todos",
        ...tab,
      }))
      : [],
  });
}

function agentOf(connected: string[], tabs = PANELS): CoreCall {
  return (path, body) => {
    if (path === routePath(workspaceRead)) {
      const asked = body as { session: string; page: number };
      return Promise.resolve(
        asked.session === SESSION
          ? workspaceOf(tabs, asked.page)
          : err({ code: "unavailable", message: "other session" }),
      );
    }
    if (path !== "apps/connect") {
      return Promise.resolve(
        err({ code: "not_found", message: "route is not open" }),
      );
    }
    const input = body as { commands: string[] };
    connected.push(...input.commands);
    return Promise.resolve(ok({
      endpoint: "unix:///fake.sock",
      signature: "s".repeat(86),
      connection: {
        app: APP,
        release: RELEASE,
        bundle_hash: "b".repeat(64),
        mode: "live",
        process_nonce: "nonce-1",
        actor: `agent:${ASSIGNMENT}`,
        credential_ref: "cred",
        screens: ["main"],
        screen_sizes: {},
        caller: { kind: "agent", run: RUN, tool_call: CALL },
        commands: input.commands,
        expires_at: null,
      },
    }));
  };
}

function scopeOf(
  granted: string[],
  toolkit: ReturnType<typeof createAppToolkit>,
) {
  return toolkit.load().then((loaded) => {
    assert(loaded.ok);
    const scope = computeAgentAppScope({
      role: "lophn",
      assignment: ASSIGNMENT,
      work: { kind: "all", id: null },
      read_apps: [],
      read_commands: [],
      offers: loaded.value.offers,
    });
    assert(scope.ok);
    return { scope: scope.value, loaded: loaded.value, granted };
  });
}

const READ_ARGS = { app: APP, screen: "todos", view_session: VIEW };
const WRITE_ARGS = {
  ...READ_ARGS,
  expected_revision: REVISION,
  target: "hint",
  text: "Start with the empty list.",
};

Deno.test("lophn-agent/harness/tools#R18 apps/agent-context#R1: 선언한 화면의 read command와 주석 자리 write command가 허락·범위 안에 있을 때만 run의 tool 정의가 된다", async () => {
  const open = createAppToolkit({
    machine: machineOf(["read_screen", "write_hint", "undo_hint"]),
  });
  const opened = await scopeOf([], open);
  assertEquals(
    open.defineContext(opened.scope, opened.loaded).map((tool) => tool.name),
    [appScreenContextTool.name, appAnnotateTool.name],
  );
  // 읽기만 허락했으면 조회만 있고, 허락이 없으면 하나도 없다.
  const readOnly = createAppToolkit({ machine: machineOf(["read_screen"]) });
  const read = await scopeOf([], readOnly);
  assertEquals(
    readOnly.defineContext(read.scope, read.loaded).map((tool) => tool.name),
    [appScreenContextTool.name],
  );
  const none = createAppToolkit({ machine: machineOf(["undo_hint"]) });
  const closed = await scopeOf([], none);
  assertEquals(none.defineContext(closed.scope, closed.loaded), []);
});

Deno.test("apps/agent-context#R5 apps/agent-context#R6 lophn-agent/harness/tool-judgment#R12: 조회는 판정 연결로 풀리고 주석은 지금 화면 revision이 조회한 값과 같을 때만 풀리며 앱에는 선언한 command 하나만 간다", async () => {
  const toolkit = createAppToolkit({
    machine: machineOf(["read_screen", "write_hint", "undo_hint"]),
    direct: (_endpoint, request: DirectRequest) => {
      const body = request.body as { command: string; request_key: string };
      sent.push(body.command);
      return Promise.resolve({
        status: 200,
        body: {
          mode: "live",
          result: {
            result: {
              app: APP,
              release: RELEASE,
              screen: "todos",
              view_session: VIEW,
              revision: current,
              summary: "Editing two items.",
              redacted: [],
            },
          },
        },
      });
    },
  });
  const sent: string[] = [];
  let current = REVISION;
  const connected: string[] = [];
  const agent = agentOf(connected);
  const { scope, loaded } = await scopeOf([], toolkit);
  const tools = toolkit.defineContext(scope, loaded);
  assertEquals(tools.length, 2);
  const [screen, annotate] = tools.map((tool) =>
    toolkit.contextBinding(tool, scope, agent, SESSION)
  );
  assert(screen !== undefined && annotate !== undefined);
  const call = { run: RUN, toolCall: CALL };

  const read = await screen.resolve(READ_ARGS, call);
  assert(read.ok, read.ok ? "" : read.error.message);
  assertEquals(read.value.comparison["command"], "read_screen");

  // 조회한 revision 그대로면 주석 근거가 풀리고, 이 확인으로 앱에는 선언한 read command만 갔다.
  const same = await annotate.resolve(WRITE_ARGS, call);
  assert(same.ok, same.ok ? "" : same.error.message);
  assertEquals(same.value.comparison["command"], "write_hint");
  assertEquals(same.value.comparison["revision"], REVISION);
  assertEquals(sent, ["read_screen"]);
  assertEquals(connected, ["read_screen"]);

  // 그사이 화면이 바뀌어 revision이 달라졌으면 옛 화면에 쓰지 않는다.
  current = "rev-4";
  const stale = await annotate.resolve(WRITE_ARGS, call);
  assert(!stale.ok);
  assertEquals(stale.error.code, "not_found");
});

Deno.test("apps/agent-context#R6: 실행 handler는 두 tool이 모두 있고 앱 연결을 열지 못하면 조회와 주석 모두 앱에 닿지 않은 오류다", async () => {
  const toolkit = createAppToolkit({
    machine: machineOf(["read_screen", "write_hint", "undo_hint"]),
  });
  const { scope } = await scopeOf([], toolkit);
  const open = agentOf([]);
  const handlers = toolkit.contextHandlers(
    scope,
    (path, body) =>
      path === "apps/connect"
        ? Promise.resolve(
          err({ code: "unavailable", message: "no connection" }),
        )
        : open(path, body),
    SESSION,
  );
  assertEquals([...handlers.keys()].sort(), [
    appAnnotateTool.name,
    appScreenContextTool.name,
  ]);
  const credential = {
    run: RUN,
    call: CALL,
    targets: new Set([APP]),
    operations: new Set<string>(),
  };
  const read = await handlers.get(appScreenContextTool.name)!(
    READ_ARGS,
    credential,
  );
  assert(!read.ok);
  assertEquals(read.error.code, "unavailable");
  const write = await handlers.get(appAnnotateTool.name)!(
    WRITE_ARGS,
    credential,
  );
  assert(!write.ok);
  assertEquals(write.error.code, "unavailable");
});

Deno.test("apps/agent-context#R2 lophn-agent/harness/tool-judgment#R12: agent가 준 view_session은 이 run의 사람 창에 열린 그 앱 패널 탭의 것일 때만 믿고 아니면 없는 대상과 같은 답으로 앱에 닿기 전에 거절한다", async () => {
  const toolkit = createAppToolkit({
    machine: machineOf(["read_screen", "write_hint", "undo_hint"]),
  });
  const { scope, loaded } = await scopeOf([], toolkit);
  const tools = toolkit.defineContext(scope, loaded);
  const credential = {
    run: RUN,
    call: CALL,
    targets: new Set([APP]),
    operations: new Set<string>(),
  };
  const call = { run: RUN, toolCall: CALL };
  const rejects = async (
    label: string,
    agent: CoreCall,
    session: string | null,
    args: { read: Record<string, unknown>; write: Record<string, unknown> },
  ) => {
    const connected: string[] = [];
    const watched: CoreCall = (path, body) => {
      if (path === "apps/connect") connected.push(path);
      return agent(path, body);
    };
    const handlers = toolkit.contextHandlers(scope, watched, session);
    const read = await handlers.get(appScreenContextTool.name)!(
      args.read,
      credential,
    );
    const write = await handlers.get(appAnnotateTool.name)!(
      args.write,
      credential,
    );
    assert(!read.ok && !write.ok, label);
    // 존재하지 않는 대상과 같은 답이고 앱 연결은 열리지 않았다.
    assertEquals(read.error, write.error, label);
    assertEquals(read.error.code, "not_found", label);
    for (const tool of tools) {
      const bound = toolkit.contextBinding(tool, scope, watched, session)!;
      const resolved = await bound.resolve(
        tool.name === appScreenContextTool.name ? args.read : args.write,
        call,
      );
      assert(!resolved.ok, label);
      assertEquals(resolved.error.code, "not_found", label);
    }
    assertEquals(connected, [], label);
  };
  const own = { read: READ_ARGS, write: WRITE_ARGS };
  // 이 창에 없는 view_session.
  await rejects(
    "forged",
    agentOf([]),
    SESSION,
    {
      read: { ...READ_ARGS, view_session: "view-forged" },
      write: { ...WRITE_ARGS, view_session: "view-forged" },
    },
  );
  // 다른 앱의 패널 탭의 view_session을 이 앱 이름으로 주장한다.
  await rejects(
    "other app's tab",
    agentOf([], [{ app: OTHER_APP, view_session: VIEW }]),
    SESSION,
    own,
  );
  // 탭에 session이 아직 없다(패널 view가 서지 않았다).
  await rejects("no session on tab", agentOf([], [{ app: APP }]), SESSION, own);
  // 이 run에 묶인 대화 session이 없거나 현재 보기를 읽지 못한다.
  await rejects("no run session", agentOf([]), null, own);
  await rejects(
    "workspace unreadable",
    () => Promise.resolve(err({ code: "unavailable", message: "x" })),
    SESSION,
    own,
  );
  // 열린 탭의 것이면 같은 입력이 통과한다(위 거절이 입력 모양 때문이 아니다).
  const pass = toolkit.contextBinding(tools[0]!, scope, agentOf([]), SESSION)!;
  assert((await pass.resolve(READ_ARGS, call)).ok);
});
