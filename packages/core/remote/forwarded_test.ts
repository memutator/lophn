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
import { appList } from "../../protocol/apps/apps.ts";
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
import { type MemoryHandler, RouteRegistry } from "../server/mod.ts";
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
const PROVIDER = `pvd_0${"1".repeat(25)}`;

const requesters: Record<string, Requester> = {
  screen: { kind: "screen" },
  terminal: { kind: "terminal" },
  agent: { kind: "agent", agent: "lophn_home", session: SESSION, name: "Ada" },
  app: { kind: "app", app: OTHER_APP },
};

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
        return {
          sent: true,
          response: { status: "ok", result: { done: true }, changeset: null },
        };
      },
    } as never,
    assignmentOf: () => err({ code: "internal", message: "unused" }),
    appGrantsOf: () => Promise.resolve(ok([])),
    isPrivate: () => false,
    clock,
    ids,
    forward: () => Promise.resolve(err({ code: "internal", message: "no" })),
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
    appRemoteCall,
    turnRequestDecide,
    rosterInvite,
    rosterRemove,
    machinesCall,
  ];
  const call = createRemoteCall({
    registry,
    routes: new RouteRegistry(routes),
    clock,
    reads: new Map([
      [
        "apps/list",
        (() => {
          reached.push("apps/list");
          return ok({ apps: [], as_of_seq: "1", next_cursor: null });
        }) as never,
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
  return { as, reached, sent, started };
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
    ["terminal", device, ["ok", "ok"]],
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
    "turn_requests/decide",
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
