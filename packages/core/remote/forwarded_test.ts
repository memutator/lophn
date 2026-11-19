import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createIdSource,
  err,
  manualClock,
  ok,
  seededRandom,
} from "../../base/mod.ts";
import type {
  AppInvocation,
  ProcessCallRequest,
} from "../../protocol/apps/calls/mod.ts";
import { appRemoteCall } from "../../protocol/apps/mod.ts";
import { appGet, appList } from "../../protocol/apps/apps.ts";
import { appTools } from "../../protocol/apps/declaration/read.ts";
import { carryWants } from "../../protocol/remote/carry.ts";
import {
  terminalsInput,
  terminalsName,
  terminalsOpen,
  terminalsRenameSaved,
} from "../../protocol/coding-agent/terminals.ts";
import {
  instructionsReadGlobal,
  instructionsWriteGlobal,
} from "../../protocol/lophn-agent/instructions.ts";
import {
  pageViewControl,
  pageViewInput,
  pageViewOpen,
} from "../../protocol/lophn-agent/page-view.ts";
import { workspaceSessionList } from "../../protocol/lophn-agent/agent-sessions.ts";
import { turnRequestDecide } from "../../protocol/approvals/turn-request.ts";
import type { Id } from "../../protocol/base/ids.ts";
import type { Route } from "../../protocol/base/mod.ts";
import { settingsUpdate } from "../../protocol/config/file.ts";
import { disconnectProvider } from "../../protocol/lophn-agent/providers.ts";
import type {
  MachineCandidate,
  Requester,
} from "../../protocol/machine/requester.ts";
import {
  REMOTE_ALLOWED_ROUTES,
  REMOTE_PERSON_ROUTES,
} from "../../protocol/remote/mod.ts";
import {
  machinesCall,
  rosterInvite,
  rosterRemove,
} from "../../protocol/remote/routes.ts";
import { createAppCalls, remoteCallHandler } from "../apps/calls/mod.ts";
import type { InvocationLedger } from "../apps/ports.ts";
import { CredentialRegistry } from "../server/identity/mod.ts";
import {
  type MemoryHandler,
  type ReadHandler,
  RouteRegistry,
} from "../server/mod.ts";
import { createAdmission } from "../supervision/responsiveness/mod.ts";
import {
  createDeviceCredentials,
  createRemoteCall,
  devicePrincipal,
  requesterOf,
} from "./call.ts";

const clock = manualClock(Date.parse("2026-11-01T00:00:00.000Z"));
const ids = createIdSource({ clock, random: seededRandom(11) });
const APP = ids.newId("app") as Id<"app">;
const OTHER_APP = ids.newId("app") as Id<"app">;
const REL = ids.newId("rel") as Id<"rel">;
const MACHINE = ids.newId("mch") as Id<"mch">;
const GRANTED = ids.newId("dev") as Id<"dev">;
const BARE = ids.newId("dev") as Id<"dev">;
const PHONE = ids.newId("dev") as Id<"dev">;
const SESSION = ids.newId("ses") as Id<"ses">;
const PROJECT = ids.newId("prj");
const PROVIDER = `pvd_0${"1".repeat(25)}`;

const requesters: Record<string, Requester> = {
  screen: { kind: "screen" },
  terminal: { kind: "terminal" },
  agent: { kind: "agent", agent: "lophn_home", session: SESSION, name: "Ada" },
  app: { kind: "app", app: OTHER_APP },
};

const fakeApp = (id: string) => ({
  id,
  slug: "notes",
  name: "Notes",
  description: "d",
  planning_version: null,
  source_path: null,
  folders: [],
  active_release: null,
  revision: "1",
  run_enabled: false,
  status: "active",
});
const fakeGet = () => ({
  app: fakeApp(APP),
  as_of_seq: "1",
  next_cursor: null,
});
const decideBody = {
  session: SESSION,
  request: `apr_0${"1".repeat(25)}`,
  choice: { kind: "once" },
};
const command = (input: unknown) => ({
  input,
  compare: { revision: 1 },
  idempotency_key: "key-1",
  prepared: [],
});

// 받는 기계: 진짜 createRemoteCall과 remoteCallHandler와 앱 호출 경로를 잇고, 그 아래(앱 process, ledger, 명단)만 가짜다.
function setup() {
  const registry = new CredentialRegistry({
    epoch: "test",
    random: seededRandom(5),
    clock,
    operations: [...REMOTE_ALLOWED_ROUTES, ...REMOTE_PERSON_ROUTES].map(
      (route) => ({
        name: route.name,
        actors: ["user"],
        kind: route.kind === "command" ? "command" : "read",
      }),
    ),
  });
  // handler와 writer에 닿은 route.
  const reached: string[] = [];
  const sent: ProcessCallRequest[] = [];
  const started: AppInvocation[] = [];
  const kinds = new Map<string, "phone" | "computer">([
    [devicePrincipal(GRANTED), "computer"],
    [devicePrincipal(BARE), "computer"],
    [devicePrincipal(PHONE), "phone"],
  ]);
  // 터미널 입력은 폰도 허락받았다. 앱 command 입구가 허락만 보지 않고 컴퓨터인지도 보는 것을 본다.
  const granted = (principal: string) => principal !== devicePrincipal(BARE);
  // 이 기계의 call 정책이 private으로 둔 앱.
  const privateApps = new Set<string>();
  // 앱 process가 호출을 받는 동안 하는 일(앱이 broker로 다른 호출을 한다).
  const during: { run?: (request: ProcessCallRequest) => Promise<void> } = {};
  const forwarded: unknown[] = [];
  const computers: MachineCandidate[] = [GRANTED, BARE].map((device) => ({
    machine: MACHINE,
    device,
    name: "studio",
    self: false,
  }));

  const ledger: Pick<InvocationLedger, "begin" | "finish" | "recordOnce"> = {
    begin(row) {
      const row2 = { ...row, status: "running" } as AppInvocation;
      started.push(row2);
      return ok(row2);
    },
    finish: (_id, result) =>
      Promise.resolve(ok({ ...started.at(-1), ...result } as AppInvocation)),
    recordOnce: (row) => {
      started.push(row);
      return Promise.resolve(ok(row));
    },
  };
  const calls = createAppCalls({
    callers: { agentToolCall: () => ok(null) },
    lookup: {
      find: (_app, _release, kind, name) =>
        ok({
          release: REL,
          effect: name.startsWith("w.") ? "write" : "read",
          public: kind === "command",
        }),
      findPreview: () => Promise.resolve(ok(null)),
    },
    apps: { activeRelease: () => ok(REL), archived: () => ok(false) },
    ledger: ledger as InvocationLedger,
    link: {
      call: async (_target: unknown, request: ProcessCallRequest) => {
        sent.push(request);
        await during.run?.(request);
        return {
          sent: true,
          response: { status: "ok", result: { done: true }, changeset: null },
        };
      },
    } as never,
    assignmentOf: () => err({ code: "internal", message: "unused" }),
    appGrantsOf: () => Promise.resolve(ok([])),
    isPrivate: (app) => privateApps.has(app),
    clock,
    ids,
    forward: (call) => {
      forwarded.push(call);
      return Promise.resolve(err({ code: "internal", message: "no" }));
    },
  });

  const reach =
    (path: string): MemoryHandler =>
    () => {
      reached.push(path);
      return ok({});
    };
  // 입구 route의 handler에 닿았는지도 센다(handler가 자기 판정으로 막기 전에 call이 막아야 하는 것을 본다).
  const entry =
    (deps: Parameters<typeof remoteCallHandler>[0]): MemoryHandler =>
    (ctx, input, credential) => {
      reached.push("apps/remote_call");
      return remoteCallHandler(deps)(ctx, input, credential);
    };
  const routes: Route[] = [
    settingsUpdate,
    disconnectProvider,
    appList,
    appGet,
    appTools,
    appRemoteCall,
    turnRequestDecide,
    carryWants,
    workspaceSessionList,
    terminalsInput,
    terminalsOpen,
    terminalsName,
    terminalsRenameSaved,
    instructionsReadGlobal,
    instructionsWriteGlobal,
    pageViewInput,
    pageViewControl,
    pageViewOpen,
    rosterInvite,
    rosterRemove,
    machinesCall,
  ];
  const call = createRemoteCall({
    registry,
    routes: new RouteRegistry(routes),
    clock,
    reads: new Map<string, ReadHandler>([
      [
        "apps/list",
        () => {
          reached.push("apps/list");
          return ok({
            apps: [APP, OTHER_APP].map((id) => fakeApp(id)),
            as_of_seq: "1",
            next_cursor: null,
          });
        },
      ],
      ["apps/get", () => (reached.push("apps/get"), ok(fakeGet()))],
      ["apps/tools", () => (reached.push("apps/tools"), ok({}))],
      ["carry/wants", () => (reached.push("carry/wants"), ok({ files: [] }))],
      [
        "sessions/list",
        () => {
          reached.push("sessions/list");
          return ok({ sessions: [], as_of_seq: "1", next_cursor: null });
        },
      ],
    ]),
    memory: new Map<string, MemoryHandler>([
      ["settings/update", reach("settings/update")],
      [
        "turn_requests/decide",
        () => {
          reached.push("turn_requests/decide");
          return ok({ outcome: { outcome: "allow", scope: "once" } });
        },
      ],
      ["terminals/input", reach("terminals/input")],
      ["terminals/open", reach("terminals/open")],
      ["terminals/name", reach("terminals/name")],
      [
        "terminals/rename_saved",
        () => {
          reached.push("terminals/rename_saved");
          return ok({ sessions: [] });
        },
      ],
      [
        "instructions/read_global",
        () => {
          reached.push("instructions/read_global");
          return ok({ text: "", hash: null });
        },
      ],
      [
        "instructions/write_global",
        () => {
          reached.push("instructions/write_global");
          return ok({ hash: "a".repeat(64) });
        },
      ],
      ["page_view/input", reach("page_view/input")],
      ["page_view/control", reach("page_view/control")],
      ["page_view/open", reach("page_view/open")],
      ["roster/invite", reach("roster/invite")],
      ["roster/remove", reach("roster/remove")],
      ["machines/call", reach("machines/call")],
      [
        "apps/remote_call",
        entry({
          path: calls.path,
          kind: (principal) => kinds.get(principal) ?? null,
          granted,
          resolve(device) {
            const found = computers.find((each) => each.device === device);
            return found
              ? ok(found)
              : err({ code: "not_found", message: "no computer" });
          },
          requesterOf,
        }),
      ],
    ]),
    writer: {
      async command(_ctx, envelope) {
        reached.push(`writer ${envelope.command}`);
        return ok({ result: { provider: PROVIDER } }) as never;
      },
      readResult: async () => ok(null),
      close: async () => {},
    },
    admission: createAdmission(),
    granted,
    kind: (principal) => kinds.get(principal) ?? null,
    privateApp: (app) => privateApps.has(app),
    confirm: async () => ok("h".repeat(43)),
  });
  const devices = createDeviceCredentials({
    registry,
    record: async () => ok(undefined),
  });
  async function as(device: Id<"dev">, resource: string, method: string) {
    const credential = await devices.get(device);
    assert.ok(credential.ok);
    return (body: unknown, by?: Requester) =>
      call(credential.value, { resource, method, body, ...(by ? { by } : {}) });
  }
  return { as, reached, sent, started, privateApps, during, forwarded, calls };
}

const code = (done: { ok: boolean; error?: { code: string } }) =>
  done.ok ? "ok" : done.error?.code;

// 받는 기계는 부른 컴퓨터가 허락받았어도 요청한 쪽에 따라 다르게 대한다. agent나 앱이 시킨 call이 사람의 route와 자동 확인에 닿으면
// 그 컴퓨터의 agent가 이 컴퓨터의 secret과 설정을 쓴다.
test("agent·앱·터미널이 요청한 call은 허락받은 컴퓨터여도 사람의 route와 확인이 필요한 명령에 닿지 못하고, 폰이 실은 by와 by 없는 컴퓨터의 call은 dispatch까지 가지 않는다", async () => {
  const s = setup();
  const person: [string, string, unknown][] = [
    ["settings", "update", { changes: [] }],
    ["providers", "disconnect", command({ provider: PROVIDER })],
  ];
  const device: [string, string, unknown][] = [
    ["turn_requests", "decide", decideBody],
    ["apps", "list", {}],
  ];
  const rows: [string, [string, string, unknown][], string[]][] = [
    ["screen", person, ["ok", "ok"]],
    ["terminal", person, ["forbidden", "forbidden"]],
    ["agent", person, ["forbidden", "forbidden"]],
    ["app", person, ["forbidden", "forbidden"]],
    // 기기 route 가운데 agent와 앱이 닿는 것은 앱 목록뿐이다.
    ["screen", device, ["ok", "ok"]],
    ["terminal", device, ["forbidden", "ok"]],
    ["agent", device, ["forbidden", "ok"]],
    ["app", device, ["forbidden", "ok"]],
  ];
  for (const [who, list, expected] of rows) {
    for (const [i, [resource, method, body]] of list.entries()) {
      const done = await (await s.as(GRANTED, resource, method))(
        body,
        requesters[who],
      );
      assert.equal(code(done), expected[i], `${who} ${resource}/${method}`);
    }
  }
  assert.deepEqual(s.reached, [
    "settings/update",
    "writer DisconnectProvider",
    "turn_requests/decide",
    "apps/list",
    "apps/list",
    "apps/list",
    "apps/list",
  ]);

  // 컴퓨터가 by 없이 부르거나 폰이 by를 싣고 부르면 route에 닿지 않는다.
  s.reached.length = 0;
  for (const [resource, method, body] of [...person, ...device]) {
    const computerCall = await s.as(GRANTED, resource, method);
    assert.equal(code(await computerCall(body)), "invalid_input");
    const phoneCall = await s.as(PHONE, resource, method);
    for (const by of Object.values(requesters)) {
      assert.equal(code(await phoneCall(body, by)), "invalid_input");
    }
  }
  assert.deepEqual(s.reached, []);

  // 명단과 machines 쪽 route는 허락이 있어도 어느 요청한 쪽에게도 목록 밖이다.
  for (const by of Object.values(requesters)) {
    for (const [resource, method] of [
      ["roster", "invite"],
      ["roster", "remove"],
      ["machines", "call"],
    ]) {
      const done = await (await s.as(GRANTED, resource, method))({}, by);
      assert.equal(code(done), "forbidden", `${by.kind} ${resource}/${method}`);
    }
  }
  assert.deepEqual(s.reached, []);
});

test("터미널 입력 허락이 없는 컴퓨터와 폰의 요청은 받는 기계가 앱 command를 돌리지 않는다", async () => {
  const s = setup();
  const body = { app: APP, command: "r.get", input: { n: 1 } };
  for (const by of Object.values(requesters)) {
    const bare = await (await s.as(BARE, "apps", "remote_call"))(body, by);
    assert.equal(code(bare), "forbidden", `no grant, ${by.kind}`);
    // 폰은 by가 없다. 허락을 받았어도 컴퓨터가 아니라 이 입구는 forbidden이다.
    const phone = await (await s.as(PHONE, "apps", "remote_call"))(body);
    assert.equal(code(phone), "forbidden", "phone");
  }
  assert.deepEqual(s.reached, []);
  assert.deepEqual(s.sent, []);
  assert.deepEqual(s.started, []);

  // 입력의 칸으로 요청한 쪽을 바꾸지 못한다(body의 `by`는 schema 밖이다).
  const granted = await s.as(GRANTED, "apps", "remote_call");
  const forged = await granted(
    { ...body, by: requesters.screen },
    requesters.agent,
  );
  assert.equal(code(forged), "invalid_input");
  assert.deepEqual(s.reached, []);
  assert.deepEqual(s.sent, []);

  // 허락받은 컴퓨터는 네 요청한 쪽 모두 돌린다.
  for (const by of Object.values(requesters)) {
    assert.equal(code(await granted(body, by)), "ok", by.kind);
  }
  assert.equal(s.sent.length, 4);
});

// 입구 handler는 route 밖의 길(HTTP API의 사람 token, 폰, 요청한 쪽 없음)로 불려도 자기 판정을 한다.
test("apps/remote_call handler는 요청한 쪽이 없거나 명단의 컴퓨터가 아니거나 허락이 없으면 앱 호출 경로에 닿지 않는다", async () => {
  const s = setup();
  const reachedPath: unknown[] = [];
  const handler = (kind: "phone" | "computer" | null, granted: boolean) =>
    remoteCallHandler({
      path: {
        call: async (input) => {
          reachedPath.push(input);
          return err({ code: "internal", message: "reached" });
        },
      },
      kind: () => kind,
      granted: () => granted,
      resolve: () =>
        ok({ machine: MACHINE, device: GRANTED, name: "studio", self: false }),
      requesterOf: (ctx) => (ctx as { by?: Requester }).by,
    });
  const input = { app: APP, command: "r.get" };
  const ctx = (principal: string, by?: Requester) =>
    ({ actor: "user", principal, by }) as never;
  const cases: [string, MemoryHandler, unknown][] = [
    ["local token", handler("computer", true), ctx("user", requesters.screen)],
    [
      "phone",
      handler("phone", true),
      ctx(devicePrincipal(PHONE), requesters.screen),
    ],
    [
      "not in the roster",
      handler(null, true),
      ctx(devicePrincipal(GRANTED), requesters.screen),
    ],
    ["no requester", handler("computer", true), ctx(devicePrincipal(GRANTED))],
    [
      "no grant",
      handler("computer", false),
      ctx(devicePrincipal(GRANTED), requesters.screen),
    ],
  ];
  for (const [label, run, context] of cases) {
    const done = await run(context as never, input);
    assert.equal(code(done), "forbidden", label);
  }
  assert.deepEqual(reachedPath, []);
  assert.deepEqual(s.sent, []);
});

// 입구에서 실행기까지: 요청한 쪽은 frame의 by에서만 오고, 부른 컴퓨터는 이 기계의 명단에서 찾으며, 기록에 remote caller로 남는다.
test("허락받은 컴퓨터의 call은 앱 호출 경로를 지나 요청한 쪽과 부른 컴퓨터를 remote caller로 앱과 기록에 남긴다", async () => {
  const s = setup();
  const by = requesters.agent;
  const done = await (await s.as(GRANTED, "apps", "remote_call"))(
    { app: APP, command: "w.save", input: { text: "hi" } },
    by,
  );
  assert.ok(done.ok);
  assert.deepEqual((done as { value: { outcome: unknown } }).value.outcome, {
    status: "succeeded",
    result: { done: true },
  });
  const caller = {
    kind: "remote",
    machine: MACHINE,
    device: GRANTED,
    requester: by,
  };
  assert.deepEqual(
    s.sent.map((request) => request.context.caller),
    [caller],
  );
  assert.deepEqual(
    s.started.map((row) => [row.operation, row.caller]),
    [[{ kind: "command", name: "w.save" }, caller]],
  );
});

// 컴퓨터가 `by` 없이 보내는 frame은 그 컴퓨터의 core가 스스로 하는 일이다. 폴더로 나르는 file(carry)만 열고 그 밖은 요청한 쪽이 있어야 한다.
test("by 없는 컴퓨터의 frame은 carry route만 받고 그 밖은 invalid_input이며, by가 있어도 carry 때문에 더 받는 것은 없고, 폰은 그대로다", async () => {
  const s = setup();
  for (const device of [GRANTED, BARE]) {
    const wants = await s.as(device, "carry", "wants");
    assert.equal(code(await wants({})), "ok", "carry without by");
    const list = await s.as(device, "apps", "list");
    assert.equal(code(await list({})), "invalid_input", "apps/list without by");
  }
  assert.deepEqual(s.reached, ["carry/wants", "carry/wants"]);
  // 폰은 by 없이 base 목록을 그대로 받고 by를 실으면 invalid_input이다.
  s.reached.length = 0;
  const phone = await s.as(PHONE, "apps", "list");
  assert.equal(code(await phone({})), "ok");
  assert.equal(code(await phone({}, requesters.screen)), "invalid_input");
  // agent의 요청은 carry에 닿지 못한다(by가 있으면 core 일이 아니다).
  const agentWants = await s.as(GRANTED, "carry", "wants");
  assert.equal(code(await agentWants({}, requesters.agent)), "forbidden");
  assert.deepEqual(s.reached, ["apps/list"]);
});

// `terminal`은 사람이 친 것인지 그 사람의 CLI token을 쥔 coding agent가 친 것인지 가를 수 없다. 터미널 입력 허락은 그 컴퓨터의 화면에게 준 것이다.
test("허락받은 컴퓨터의 terminal 요청은 터미널에 치거나 열거나 browser page를 다루거나 agent가 물은 것에 결정을 남기지 못하고, 목록과 앱 command는 부르며, 같은 컴퓨터의 screen 요청은 칠 수 있다", async () => {
  const s = setup();
  const denied: [string, string, unknown][] = [
    ["terminals", "input", { terminal: "trm_1", text: "ls" }],
    ["terminals", "open", { project: PROJECT, command: "ls" }],
    ["terminals", "open", { project: PROJECT }],
    ["page_view", "input", {}],
    ["page_view", "control", {}],
    ["page_view", "open", {}],
    ["turn_requests", "decide", decideBody],
  ];
  for (const [resource, method, body] of denied) {
    const done = await (await s.as(GRANTED, resource, method))(
      body,
      requesters.terminal,
    );
    assert.equal(code(done), "forbidden", `terminal ${resource}/${method}`);
  }
  assert.deepEqual(s.reached, []);

  const sessions = await s.as(GRANTED, "sessions", "list");
  assert.equal(
    code(
      await sessions(
        { agent: "lophn_home", workspace: null },
        requesters.terminal,
      ),
    ),
    "ok",
  );
  const remote = await s.as(GRANTED, "apps", "remote_call");
  assert.equal(
    code(await remote({ app: APP, command: "r.get" }, requesters.terminal)),
    "ok",
  );
  // 같은 컴퓨터의 화면은 칠 수 있다.
  const typing = await s.as(GRANTED, "terminals", "input");
  assert.equal(
    code(await typing({ terminal: "trm_1", text: "ls" }, requesters.screen)),
    "ok",
  );
  assert.deepEqual(s.reached, [
    "sessions/list",
    "apps/remote_call",
    "terminals/input",
  ]);
});

// agent와 앱이 private인 workspace의 앱이 있는지도 알면 안 된다. 사람의 화면과 터미널은 본다.
test("agent와 앱의 요청에는 private인 앱이 목록에서 빠지고 읽기와 command 목록은 not_found이며, screen과 terminal은 본다", async () => {
  const s = setup();
  s.privateApps.add(OTHER_APP);
  const listed = async (by: Requester) => {
    const done = await (await s.as(GRANTED, "apps", "list"))({}, by);
    assert.ok(done.ok);
    return (done.value as { apps: { id: string }[] }).apps.map((a) => a.id);
  };
  for (const who of ["agent", "app"]) {
    assert.deepEqual(await listed(requesters[who]), [APP], who);
    for (const method of ["get", "tools"]) {
      const done = await (await s.as(GRANTED, "apps", method))(
        { app: OTHER_APP },
        requesters[who],
      );
      assert.equal(code(done), "not_found", `${who} apps/${method}`);
    }
  }
  assert.equal(s.reached.includes("apps/get"), false);
  assert.equal(s.reached.includes("apps/tools"), false);
  for (const who of ["screen", "terminal"]) {
    assert.deepEqual(await listed(requesters[who]), [APP, OTHER_APP], who);
  }
  const open = await (await s.as(GRANTED, "apps", "get"))(
    { app: APP },
    requesters.agent,
  );
  assert.equal(code(open), "ok");
});

// 받은 call을 돌리는 앱이 다른 컴퓨터를 부르는 길은 막혀 있다. 입구에서 도는 호출이 remote로 표시되어야 broker가 막는다.
test("받은 call을 돌리는 앱 process가 broker로 다른 컴퓨터의 앱을 부르면 forbidden이고 넘겨지지 않는다", async () => {
  const s = setup();
  const second: unknown[] = [];
  s.during.run = async (request) => {
    const done = await s.calls.path.call(
      {
        target: { mode: "remote", machine: "other", app: OTHER_APP },
        kind: "command",
        name: "r.get",
        caller: {
          kind: "app",
          app: APP,
          release: REL,
          parent_invocation: request.invocation,
        },
      },
      { actor: "app", app: APP },
    );
    second.push(done.ok ? "ok" : done.error.code);
  };
  const done = await (await s.as(GRANTED, "apps", "remote_call"))(
    { app: APP, command: "r.get" },
    requesters.agent,
  );
  assert.equal(code(done), "ok");
  assert.deepEqual(second, ["forbidden"]);
  assert.deepEqual(s.forwarded, []);
});

// 다른 컴퓨터에서 온 event가 부른 handler도 받은 call과 같이 다른 컴퓨터를 다시 부르지 못한다. 안 막으면 두 컴퓨터의 앱이 서로의 event와 call로
// 끝없이 부른다(X가 M의 event를 구독하고 handler가 M의 앱을 부르고 그 앱이 같은 event를 다시 낸다).
test("다른 컴퓨터에서 온 event가 부른 앱 handler가 broker로 다른 컴퓨터의 앱을 부르면 forbidden이고, 이 컴퓨터의 event가 부른 handler는 넘길 수 있다", async () => {
  const s = setup();
  const second: unknown[] = [];
  s.during.run = async (request) => {
    const done = await s.calls.path.call(
      {
        target: { mode: "remote", machine: "other", app: OTHER_APP },
        kind: "command",
        name: "r.get",
        caller: {
          kind: "app",
          app: APP,
          release: REL,
          parent_invocation: request.invocation,
        },
      },
      { actor: "app", app: APP },
    );
    second.push(done.ok ? "ok" : done.error.code);
  };
  const event = (machine?: Id<"mch">) => {
    const common = {
      publisher: OTHER_APP,
      event: "e",
      publication: `pub_0${"1".repeat(25)}` as Id<"pub">,
      trace_id: "a".repeat(32),
      chain: [OTHER_APP],
    };
    return s.calls.path.call(
      {
        target: { mode: "live", app: APP, release: null },
        kind: "operation",
        name: "on.other.e",
        caller: {
          kind: "event",
          ...common,
          parent_invocation: null,
          ...(machine === undefined ? {} : { machine }),
        },
      },
      { actor: "event", event: { ...common, parent: null } },
    );
  };
  assert.ok((await event(MACHINE)).ok);
  assert.deepEqual(second, ["forbidden"]);
  assert.deepEqual(s.forwarded, []);
  assert.ok((await event()).ok);
  // 이 기계의 event(기계를 적지 않았다)가 부른 handler의 call은 forward까지 간다.
  assert.equal(s.forwarded.length, 1);
  assert.deepEqual(second, ["forbidden", "internal"]);
});

test("terminals/name·rename_saved와 instructions/read_global·write_global은 허락받은 컴퓨터의 screen 요청만 받는다", async () => {
  const s = setup();
  const cases: [string, string, unknown][] = [
    ["terminals", "name", { terminal: "trm_1", name: "API server" }],
    [
      "terminals",
      "rename_saved",
      {
        project: PROJECT,
        harness: "claude",
        external_session: "ext-1",
        name: "API server",
      },
    ],
    ["instructions", "read_global", {}],
    ["instructions", "write_global", { text: "rules", base_hash: null }],
  ];
  for (const [resource, method, body] of cases) {
    // 허락 없는 컴퓨터는 screen이어도 거절한다.
    assert.equal(
      code(await (await s.as(BARE, resource, method))(body, requesters.screen)),
      "forbidden",
      `bare screen ${resource}/${method}`,
    );
    // 허락받은 컴퓨터라도 terminal·agent 요청은 거절한다.
    assert.equal(
      code(
        await (await s.as(GRANTED, resource, method))(
          body,
          requesters.terminal,
        ),
      ),
      "forbidden",
      `granted terminal ${resource}/${method}`,
    );
    assert.equal(
      code(
        await (await s.as(GRANTED, resource, method))(body, requesters.agent),
      ),
      "forbidden",
      `granted agent ${resource}/${method}`,
    );
  }
  assert.deepEqual(s.reached, []);

  for (const [resource, method, body] of cases) {
    assert.equal(
      code(
        await (await s.as(GRANTED, resource, method))(body, requesters.screen),
      ),
      "ok",
      `granted screen ${resource}/${method}`,
    );
  }
  assert.deepEqual(s.reached, [
    "terminals/name",
    "terminals/rename_saved",
    "instructions/read_global",
    "instructions/write_global",
  ]);
});
