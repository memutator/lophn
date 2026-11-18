import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { z } from "zod";
import {
  createIdSource,
  err,
  manualClock,
  ok,
  seededRandom,
} from "../../base/mod.ts";
import { type Route, routePath } from "../../protocol/base/mod.ts";
import { activationActivatePrevious } from "../../protocol/apps/activation/activation.ts";
import { appLogViewError } from "../../protocol/apps/app-log.ts";
import {
  appArchive,
  appCreate,
  appDelete,
  appEditFolders,
  appRename,
  appSetIcon,
  appUnarchive,
} from "../../protocol/apps/apps.ts";
import { appCallTool } from "../../protocol/apps/calls/call.ts";
import { appRewind } from "../../protocol/apps/calls/rewind.ts";
import { appGrantRevoke, appGrantsList } from "../../protocol/apps/grants.ts";
import {
  releaseActivate,
  releasePrepare,
} from "../../protocol/apps/releases.ts";
import { appsSecretValue } from "../../protocol/apps/secret-use.ts";
import { jobCreate, jobDelete } from "../../protocol/jobs/jobs.ts";
import {
  agentChange,
  agentCreate,
  agentDelete,
} from "../../protocol/lophn-agent/agent-definitions.ts";
import { tabsOpen } from "../../protocol/lophn-agent/host-queue.ts";
import {
  changeShownModels,
  modelDefaultChange,
  workspaceModelChange,
} from "../../protocol/lophn-agent/models.ts";
import {
  connectProvider,
  disconnectProvider,
  loginCancel,
  refreshProviderModels,
} from "../../protocol/lophn-agent/providers.ts";
import {
  changeSessionSkip,
  deleteSession,
} from "../../protocol/lophn-agent/sessions.ts";
import { projectApi } from "../../protocol/projects/project-api.ts";
import { ROUTES } from "../../protocol/registry.ts";
import {
  connectRemote,
  devicesClearPush,
  devicesConnected,
  devicesList,
  devicesPushTargets,
  devicesSetPrimary,
  generateKeyPair,
  type KeyPair,
  REMOTE_ALLOWED_ROUTES,
  type RemoteClientChannel,
  type RemoteClientFrame,
  type RemoteServerFrame,
  remoteKeyBytes,
  remoteKeyText,
  rosterForgetAll,
  machinesCall,
  rosterInvite,
  rosterList,
  rosterRemove,
  rosterRename,
  rosterSetTerminalInput,
  rosterStatements,
  rosterStore,
  type RosterEntryBody,
  type RosterInvitedStatement,
  rosterView,
  signRoster,
} from "../../protocol/remote/mod.ts";
import { REMOTE_PERSON_ROUTES } from "../../protocol/remote/allowlist.ts";
import { workflowEdit } from "../../protocol/workflows/routes.ts";
import { appViewHandlers, createAppViews } from "../apps/views/mod.ts";
import { devicesSetting } from "../config/shell-settings.ts";
import {
  projectFilesListRead,
  projectFilesReadRead,
} from "../projects/files/mod.ts";
import type { BusEvent, EventCondition } from "../../protocol/events/mod.ts";
import { createBus } from "../events/mod.ts";
import {
  CredentialRegistry,
  type OperationPolicy,
} from "../server/identity/mod.ts";
import {
  bytesFileStream,
  type FileStreamHandler,
  type MemoryHandler,
  type UploadHandler,
} from "../server/mod.ts";
import type { Tx } from "../../protocol/server/mod.ts";
import { createSql } from "../storage/ledger/sqlite.ts";
import { RouteRegistry } from "../server/mod.ts";
import { createAdmission } from "../supervision/responsiveness/mod.ts";
import { createDeviceCredentials, createRemoteCall } from "./call.ts";
import {
  DEVICES_COMMANDS,
  DEVICES_KIND_STEPS,
  DEVICES_SCHEMA_STEPS,
  devicesListRead,
  devicesPushTargetsRead,
  ROSTER_SCHEMA_STEPS,
  rosterStatementsRead,
  rosterStoreCommand,
  screensPaired,
  screensRenamed,
  screensRevoked,
} from "./devices.ts";
import {
  addSigningKey,
  loadRemoteKeys,
  stampHostKeyMachine,
} from "./host-key.ts";
import {
  createRemoteHost,
  JOIN_TRIES,
  REMOTE_JOIN_MS,
  REMOTE_UNATTACHED_MAX,
  type RemoteHost,
  type RemoteRoster,
  type RemoteSocket,
} from "./host.ts";
import { createLinks } from "./links.ts";
import { createMachineRoutes } from "./machine-routes.ts";
import { createRoster, type Roster, type RosterChange } from "./roster.ts";

// 메모리 안에서 폰과 core를 잇는다. 실제 socket처럼 다음 microtask에 전한다.
function wire() {
  const handlers = {
    phone: { message: (_: Uint8Array) => {}, close: () => {} },
    core: { message: (_: Uint8Array) => {}, close: () => {} },
  };
  const closed = { phone: false, core: false };
  // 각 쪽에 닿은 message(Noise record) 수.
  const delivered = { phone: 0, core: 0 };
  const end = (self: "phone" | "core", other: "phone" | "core") => ({
    send(bytes: Uint8Array) {
      queueMicrotask(() => {
        if (closed[other]) return;
        delivered[other] += 1;
        handlers[other].message(bytes);
      });
    },
    close() {
      if (closed[self]) return;
      closed[self] = true;
      queueMicrotask(() => {
        if (closed[other]) return;
        closed[other] = true;
        handlers[other].close();
      });
    },
    onMessage(fn: (bytes: Uint8Array) => void) {
      handlers[self].message = fn;
    },
    onClose(fn: () => void) {
      handlers[self].close = fn;
    },
    bufferedAmount: () => 0,
  });
  return {
    phone: end("phone", "core"),
    core: end("core", "phone"),
    delivered,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
// 가짜 명단이 `join` 답에 싣는 이 core의 서명 key.
const FAKE_SIGNING_KEY = remoteKeyText(new Uint8Array(32).fill(7));
// setup의 host가 hello로 알리는 기계 id.
const HOST_MACHINE = `mch_0${"1".repeat(25)}` as const;
const deviceId = (n: number) => `dev_0${String(n).padStart(25, "0")}`;
const decideBody = {
  session: `ses_0${"1".repeat(25)}`,
  request: `apr_0${"1".repeat(25)}`,
  choice: { kind: "once" },
};

// project 하나에 폴더 하나(root)만 있는 가짜 snapshot. 폴더 밖에는 secret.txt가 있고 root 안의 link가 가리킨다.
const projectId = `prj_0${"1".repeat(25)}`;
const filesBase = mkdtempSync(join(tmpdir(), "lophn-remote-files-"));
mkdirSync(join(filesBase, "root"));
writeFileSync(join(filesBase, "root", "a.md"), "# a");
writeFileSync(join(filesBase, "secret.txt"), "secret");
symlinkSync(join(filesBase, "secret.txt"), join(filesBase, "root", "link.md"));
const projectFolder = {
  snapshot: <T>(read: (sql: never, seq: string) => T): T =>
    read(
      {
        get: () => ({
          id: projectId,
          name: "p",
          title: "p",
          purpose: "",
          revision: "1",
          status: "active",
          identity: null,
          former_identities: "[]",
          repo: null,
          remote_key: null,
          remote_url: null,
        }),
        all: () => [
          { position: 0, path: join(filesBase, "root"), description: "" },
        ],
      } as never,
      "1",
    ),
};

// 폰 화면을 연 앱 하나. release 하나가 화면 main(자리 phone), operation save, 구독 ops/limit을 선언했다.
const viewApp = `app_0${"1".repeat(25)}`;
const viewRelease = `rel_0${"1".repeat(25)}`;

// 명단(기본은 key → id 표), 앱 process·release 선언, 앱 호출 경로만 가짜다. 자격, scope, route dispatch, view 표, Gateway 구독은
// production code다. 진짜 명단을 쓰는 test는 `roster`와 그 host key를 넘긴다.
function setup(real?: { roster: RemoteRoster; hostKey: KeyPair }) {
  const random = seededRandom(11);
  const clock = manualClock(1_000_000);
  const coreKey = real?.hostKey ?? generateKeyPair(random);
  const table = new Map<string, string>();
  let next = 1;
  const reached: string[] = [];
  const allRoutes = new Map<string, Route>();
  // 목록 밖이어야 하는 route도 등록한다. 등록되지 않으면 forbidden이 아니라 not_found가 된다.
  const outside: Route[] = [
    deleteSession,
    changeSessionSkip,
    appsSecretValue,
    connectProvider,
    disconnectProvider,
    loginCancel,
    refreshProviderModels,
    devicesList,
    devicesSetPrimary,
    devicesConnected,
    devicesClearPush,
    devicesPushTargets,
    rosterList,
    rosterInvite,
    rosterRemove,
    rosterSetTerminalInput,
    rosterRename,
    rosterStatements,
    rosterStore,
    rosterForgetAll,
    machinesCall,
    agentCreate,
    agentChange,
    agentDelete,
    jobCreate,
    jobDelete,
    appCreate,
    appDelete,
    projectApi.register,
    projectApi.edit,
    workflowEdit,
    changeShownModels,
    modelDefaultChange,
    workspaceModelChange,
    tabsOpen,
    appCallTool,
    appGrantsList,
    appGrantRevoke,
    appArchive,
    appUnarchive,
    appRename,
    appEditFolders,
    appSetIcon,
    releasePrepare,
    releaseActivate,
    activationActivatePrevious,
    appRewind,
    appLogViewError,
  ];
  for (const route of [
    ...ROUTES,
    ...REMOTE_ALLOWED_ROUTES,
    ...REMOTE_PERSON_ROUTES,
    ...outside,
  ]) {
    allRoutes.set(routePath(route), route);
  }
  // 사람 token 상한과 같다(wiring/server.ts): user가 부를 수 있는 route 전부다.
  const operations: OperationPolicy[] = [...allRoutes.values()]
    .filter((route) => route.actors.includes("user"))
    .map((route) => ({
      name: route.name,
      actors: ["user"],
      kind: route.kind === "command" ? "command" : "read",
    }));
  const registry = new CredentialRegistry({
    epoch: "test",
    random,
    clock,
    operations,
  });
  // 기기가 올린 bytes와 input. image upload handler가 받은 그대로다.
  const uploaded: { input: unknown; bytes: number[] }[] = [];
  const upload: UploadHandler = async (_ctx, input, body) => {
    const bytes = new Uint8Array(await new Response(body.bytes).arrayBuffer());
    uploaded.push({ input, bytes: [...bytes] });
    return ok({ blob: "a".repeat(64) });
  };
  const image: FileStreamHandler = async () =>
    ok({
      contentType: "image/png",
      length: 4,
      body: new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47])).body!,
    });
  const reach =
    (name: string, value: unknown): MemoryHandler =>
    () => {
      reached.push(name);
      return ok(value);
    };
  const admission = createAdmission();
  const bus = createBus();
  const views = createAppViews({
    appStatus: () => ok("active"),
    deviceKind: (owner) => (owner.startsWith("device:") ? "phone" : null),
    log: () => {},
    live: async () => ok({ release: viewRelease, process_nonce: "live" }),
    preview: async () => ok(null),
    release: () =>
      ok({
        bundle_hash: "a".repeat(64),
        screens: [{ key: "main", places: ["phone"] }],
        subscriptions: [{ source: "ops", event: "limit" }],
      }),
    lookup: {
      find: (_app, release, _kind, name) =>
        ok(
          name === "save"
            ? { release: release as never, effect: "write", public: false }
            : null,
        ),
      findPreview: async () => ok(null),
    },
    path: {
      call: async () => {
        reached.push("app operation");
        return ok({
          invocation: null,
          outcome: { status: "succeeded" as const, result: { done: true } },
        });
      },
    },
    publish: (app, payload) =>
      bus.publish({
        type: "AppViewEvent",
        subject: app,
        at: clock.now(),
        payload,
      }),
  });
  const timers = new Map<number, { run: () => void; ms: number }>();
  let nextTimer = 0;
  // 명단을 찾은 뒤 답을 돌려주기 전에 부른다. 그 사이 기기를 빼는 test가 건다.
  const hooks: { afterFind?: (key: string) => void } = {};
  // 붙음에 넘긴 기기 이름(hello로 알린 것).
  const names: string[] = [];
  const fake: RemoteRoster = {
    find: (key) => {
      const id = table.get(key);
      hooks.afterFind?.(key);
      return id;
    },
    join: async (key) => {
      const id = table.get(key);
      return id === undefined
        ? err({
            code: "unauthorized",
            message: "roster invite refused: untrusted",
            details: { reason: "untrusted" },
          })
        : ok({
            device: id,
            computer: { id: deviceId(99), signing_key: FAKE_SIGNING_KEY },
            roster: { statements: [], reach: [] },
          });
    },
    receive: async () => ok({ statements: [], reach: [] }),
  };
  const host: RemoteHost = createRemoteHost({
    staticKey: coreKey,
    machine: () => ({
      id: HOST_MACHINE,
      name: "studio",
      addresses: ["192.168.0.2"],
    }),
    random,
    timers: {
      set(run, ms) {
        timers.set(nextTimer, { run, ms });
        return nextTimer++;
      },
      clear: (handle) => void timers.delete(handle as number),
    },
    bus,
    roster: real?.roster ?? fake,
    devices: {
      connected: (input) => void names.push(`connected ${input.name}`),
    },
    credentials: createDeviceCredentials({
      registry,
      record: async () => ok(undefined),
    }),
    call: createRemoteCall({
      registry,
      routes: new RouteRegistry([...allRoutes.values()]),
      clock,
      reads: new Map([
        [
          "project_files/list",
          projectFilesListRead(projectFolder).handle as never,
        ],
        [
          "project_files/read",
          projectFilesReadRead(projectFolder).handle as never,
        ],
        [
          "apps/phone_screens",
          () => {
            reached.push("apps/phone_screens");
            return ok({
              screens: [],
              previews: [],
              as_of_seq: "1",
              next_cursor: null,
            });
          },
        ],
        [
          "app_sync/pull",
          (() => {
            reached.push("app_sync/pull");
            return ok({
              changes: [],
              next: 0,
              more: false,
              snapshot_needed: false,
            });
          }) as never,
        ],
      ]),
      memory: new Map([
        [
          "turn_requests/decide",
          reach("turn_requests/decide", {
            outcome: { outcome: "allow", scope: "once" },
          }),
        ],
        [
          "settings/update",
          reach("settings/update", { changed: [], rejected: [] }),
        ],
        ["apps/call_tool", reach("apps/call_tool", {})],
        ["apps/rewind", reach("apps/rewind", {})],
        ["apps/log_view_error", reach("apps/log_view_error", {})],
        ...appViewHandlers(views),
      ]),
      fileStreams: new Map<string, FileStreamHandler>([
        ["message-images/read", image],
        [
          "apps/screen_file",
          async () => {
            reached.push("apps/screen_file");
            return ok(bytesFileStream(new Uint8Array([1]), "text/javascript"));
          },
        ],
        [
          "apps/phone_file",
          async () =>
            ok(bytesFileStream(new Uint8Array([1]), "text/javascript")),
        ],
        [
          "app_sync/snapshot_file",
          async () =>
            ok(
              bytesFileStream(new Uint8Array([2]), "application/octet-stream"),
            ),
        ],
      ]),
      uploads: new Map([["message-images/upload", upload]]),
      admission,
      // 이 file의 기기는 터미널 입력 허락이 없다. 허락받은 기기는 call_test.ts가 본다.
      granted: () => false,
      confirm: async () => err({ code: "internal", message: "not issued" }),
    }),
    admission,
    views,
    phoneLink: { attached() {}, received() {}, closed() {} },
  });

  function open(phoneKey: KeyPair) {
    const w = wire();
    void host.accept(w.core as RemoteSocket);
    return connectRemote({
      transport: w.phone,
      staticKey: phoneKey,
      remoteStatic: coreKey.publicKey,
      capabilities: [],
      name: "Pixel",
      random,
    }).then((opened) => ({ opened, delivered: w.delivered }));
  }

  async function connect(phoneKey: KeyPair) {
    const { opened, delivered } = await open(phoneKey);
    assert.ok(opened.ok);
    const phone: RemoteClientChannel = opened.value;
    const frames: RemoteServerFrame[] = [];
    let closed = false;
    phone.onFrame((frame) => frames.push(frame));
    phone.onClose(() => {
      closed = true;
    });
    return { phone, frames, closed: () => closed, delivered };
  }

  // 그 길이로 건 timer를 모두 끝낸다.
  function fire(ms: number) {
    for (const [handle, timer] of [...timers]) {
      if (timer.ms !== ms) continue;
      timers.delete(handle);
      timer.run();
    }
  }

  function register(phoneKey: KeyPair): string {
    const id = deviceId(next++);
    table.set(remoteKeyText(phoneKey.publicKey), id);
    return id;
  }

  return {
    host,
    coreKey,
    clock,
    bus,
    views,
    table,
    reached,
    uploaded,
    hooks,
    names,
    open,
    connect,
    register,
    fire,
    random,
  };
}

const results = (frames: RemoteServerFrame[]) =>
  frames.filter((frame) => frame.type === "result");

test("명단에 없는 key의 연결은 join 말고 아무 frame도 통하지 않는다", async (t) => {
  const s = setup();
  const cases: { name: string; frame: RemoteClientFrame }[] = [
    {
      name: "call",
      frame: {
        type: "call",
        id: "c1",
        resource: "turn_requests",
        method: "decide",
        body: decideBody,
      },
    },
    { name: "watch", frame: { type: "watch", conditions: [{}] } },
  ];
  for (const { name, frame } of cases) {
    await t.test(name, async () => {
      const c = await s.connect(generateKeyPair(s.random));
      c.phone.send(frame);
      await settle();
      s.bus.publish({
        type: "StateChanged",
        subject: null,
        at: s.clock.now(),
        payload: { changes: [{ name: "settings", id: null }] },
      });
      await settle();
      assert.deepEqual(s.reached, []);
      // 명단에 없는 key는 자격이 거둬졌다는 이유를 받는다(꺼져 있는 동안 빠진 폰).
      assert.deepEqual(c.frames, [
        { type: "closed", reason: "credential_revoked" },
      ]);
      assert.equal(c.closed(), true);
    });
  }
});

test("명단에 들지 못한 join은 연결마다 5번까지고, 명단의 key는 join으로 붙어 그 자리에서 route를 부른다", async () => {
  const s = setup();
  const guesser = await s.connect(generateKeyPair(s.random));
  for (let i = 0; i < JOIN_TRIES; i++) {
    guesser.phone.send({ type: "join", id: `j${i}`, statements: [] });
    await settle();
  }
  assert.equal(guesser.closed(), true);
  assert.equal(results(guesser.frames).length, JOIN_TRIES);
  assert.ok(results(guesser.frames).every((frame) => !frame.ok));

  const key = generateKeyPair(s.random);
  const id = s.register(key);
  const phone = await s.connect(key);
  phone.phone.send({ type: "join", id: "j", statements: [] });
  phone.phone.send({
    type: "call",
    id: "c",
    resource: "turn_requests",
    method: "decide",
    body: decideBody,
  });
  await settle();
  assert.equal(phone.closed(), false);
  assert.deepEqual(
    results(phone.frames).map((frame) => [
      frame.id,
      frame.ok && (frame.value as { device?: string }).device,
    ]),
    [
      ["j", id],
      ["c", undefined],
    ],
  );
  assert.deepEqual(s.reached, ["turn_requests/decide"]);
  assert.deepEqual(s.names, ["connected Pixel"]);
});

test("기기는 route 목록 밖의 route를 forbidden으로 받고 handler에 닿지 않는다", async () => {
  const s = setup();
  const key = generateKeyPair(s.random);
  s.register(key);
  const c = await s.connect(key);
  // 사람 token은 부를 수 있지만 목록에 없는 route(설정 쓰기)와 목록 안의 route.
  c.phone.send({
    type: "call",
    id: "outside",
    resource: "settings",
    method: "update",
    body: { changes: [] },
  });
  c.phone.send({
    type: "call",
    id: "inside",
    resource: "turn_requests",
    method: "decide",
    body: decideBody,
  });
  await settle();
  const byId = Object.fromEntries(
    results(c.frames).map((frame) => [frame.id, frame]),
  );
  assert.equal(byId.outside?.ok, false);
  assert.equal(
    byId.outside?.ok === false && byId.outside.error.code,
    "forbidden",
  );
  assert.equal(byId.inside?.ok, true);
  assert.deepEqual(s.reached, ["turn_requests/decide"]);
});

test("터미널 입력 허락이 없는 기기는 route 목록을 넓힌 뒤에도 sessions/delete, secret, provider·model·설정 쓰기, devices/*(set_push 말고), roster/*(leave 말고), agent·job·앱·project·workflow 만들기·고치기·지우기, 앱 직접 호출·grant·release·rewind·log 쓰기는 forbidden이고, 폰 화면 route는 통과한다", async () => {
  const s = setup();
  const key = generateKeyPair(s.random);
  s.register(key);
  const c = await s.connect(key);
  const outside = [
    "sessions/delete",
    "sessions/change-skip",
    "secrets/status",
    "secrets/put",
    "secrets/delete",
    "logins/list",
    "logins/save",
    "logins/delete",
    "logins/release",
    "apps/secret_value",
    "providers/connect",
    "providers/disconnect",
    "providers/login-cancel",
    "providers/refresh-models",
    "settings/update",
    "devices/list",
    "devices/set_primary",
    "devices/connected",
    "devices/clear_push",
    "devices/push_targets",
    "roster/list",
    "roster/invite",
    "roster/remove",
    "roster/set_terminal_input",
    "roster/rename",
    "roster/statements",
    "roster/store",
    "roster/forget_all",
    "agents/create",
    "agents/change",
    "agents/delete",
    "jobs/create",
    "jobs/delete",
    "apps/create",
    "apps/delete",
    "projects/create",
    "projects/update",
    "workflows/edit",
    "shown-models/change",
    "model-default/change",
    "workspace-model/change",
    "tabs/open",
    // 폰 화면은 view로만 앱을 부른다. 앱을 직접 부르거나 허락·판·되돌리기를 바꾸거나 남의 앱 log에 쓰지 못한다.
    "apps/call_tool",
    "app_grants/list",
    "app_grants/revoke",
    "apps/archive",
    "apps/unarchive",
    "apps/rename",
    "apps/edit_folders",
    "apps/set_icon",
    "releases/prepare",
    "releases/activate",
    "activations/activate_previous",
    "apps/rewind",
    "apps/log_view_error",
    // 목록에 있지만 켜고 끄기만 받는다. 이름을 바꾸면 job 고치기다.
    "jobs/update",
  ];
  for (const path of outside) {
    const [resource, method] = path.split("/");
    const body =
      path === "jobs/update"
        ? { input: { job: "job_x", title: "renamed" }, compare: {}, key: "k" }
        : {};
    c.phone.send({ type: "call", id: path, resource, method, body });
  }
  await settle();
  assert.deepEqual(
    results(c.frames).map((frame) => [
      frame.id,
      frame.ok ? "ok" : frame.error.code,
    ]),
    outside.map((path) => [path, "forbidden"]),
  );
  assert.deepEqual(s.reached, []);

  const view = "phone-view-1";
  const inside = [
    ["apps/phone_screens", {}],
    [
      "apps/screen_file",
      {
        target: { mode: "live", app: viewApp, release: viewRelease },
        screen: "main",
        path: "phone.js",
      },
    ],
    [
      "app_views/open",
      {
        view,
        mode: "live",
        app: viewApp,
        release: null,
        screen: "main",
        place: "phone",
      },
    ],
    ["app_views/call", { view, operation: "save", input: null }],
    ["app_views/close", { view }],
    // 폰에서 도는 앱: 맞추기 route는 통과한다.
    ["app_sync/pull", { app: viewApp, release: viewRelease, after: 0 }],
  ] as const;
  // 차례로 보낸다. open이 끝나기 전에 call이 닿지 않게.
  for (const [path, body] of inside) {
    const [resource, method] = path.split("/");
    c.phone.send({ type: "call", id: path, resource, method, body });
    while (!results(c.frames).some((frame) => frame.id === path)) {
      await settle();
    }
  }
  assert.deepEqual(
    results(c.frames)
      .slice(outside.length)
      .map((frame) => [frame.id, frame.ok]),
    inside.map(([path]) => [path, true]),
  );
  assert.deepEqual(s.reached, [
    "apps/phone_screens",
    "apps/screen_file",
    "app operation",
    "app_sync/pull",
  ]);
});

test("기기가 project file route를 불러도 등록 폴더 밖 path(.., 밖을 가리키는 symlink)는 invalid_input이다", async () => {
  const s = setup();
  const key = generateKeyPair(s.random);
  s.register(key);
  const c = await s.connect(key);
  const calls = [
    ["project_files/read", { path: "a.md" }],
    ["project_files/read", { path: "../secret.txt" }],
    ["project_files/read", { path: "link.md" }],
    ["project_files/list", { path: "/" }],
  ] as const;
  for (const [path, input] of calls) {
    const [resource, method] = path.split("/");
    c.phone.send({
      type: "call",
      id: `${path}:${input.path}`,
      resource,
      method,
      body: { project: projectId, ...input },
    });
  }
  // 실제 file을 읽으므로 고정 대기 대신 4개가 올 때까지 기다린다.
  while (results(c.frames).length < calls.length) await settle();
  assert.deepEqual(
    Object.fromEntries(
      results(c.frames).map((frame) => [
        frame.id,
        frame.ok ? "ok" : frame.error.code,
      ]),
    ),
    {
      "project_files/read:a.md": "ok",
      "project_files/read:../secret.txt": "invalid_input",
      "project_files/read:link.md": "invalid_input",
      "project_files/list:/": "invalid_input",
    },
  );
});

test("기기의 upload는 base64를 같은 bytes로 넘기고, file route는 {content_type, base64}로 답한다", async () => {
  const s = setup();
  const key = generateKeyPair(s.random);
  s.register(key);
  const c = await s.connect(key);
  const input = { content_type: "image/png", bytes: 3 };
  c.phone.send({
    type: "call",
    id: "up",
    resource: "message-images",
    method: "upload",
    body: { input, base64: Buffer.from([0, 255, 7]).toString("base64") },
  });
  c.phone.send({
    type: "call",
    id: "read",
    resource: "message-images",
    method: "read",
    body: { session: decideBody.session, image: "a".repeat(64) },
  });
  c.phone.send({
    type: "call",
    id: "phone_file",
    resource: "apps",
    method: "phone_file",
    body: { app: viewApp, release: viewRelease, path: "phone/backend.js" },
  });
  c.phone.send({
    type: "call",
    id: "snapshot_file",
    resource: "app_sync",
    method: "snapshot_file",
    body: { snapshot: "snap", offset: 0, length: 1 },
  });
  await settle();
  assert.deepEqual(s.uploaded, [{ input, bytes: [0, 255, 7] }]);
  const byId = Object.fromEntries(
    results(c.frames).map((frame) => [frame.id, frame]),
  );
  assert.deepEqual(byId.up, {
    type: "result",
    id: "up",
    ok: true,
    value: { blob: "a".repeat(64) },
  });
  assert.deepEqual(byId.read, {
    type: "result",
    id: "read",
    ok: true,
    value: { content_type: "image/png", base64: "iVBORw==" },
  });
  assert.deepEqual(byId.phone_file, {
    type: "result",
    id: "phone_file",
    ok: true,
    value: { content_type: "text/javascript", base64: "AQ==" },
  });
  assert.deepEqual(byId.snapshot_file, {
    type: "result",
    id: "snapshot_file",
    ok: true,
    value: { content_type: "application/octet-stream", base64: "Ag==" },
  });
});

test("기기의 watch는 types 없이 걸어도 REMOTE_ALLOWED_EVENTS 밖의 event(앱 event)를 받지 않는다", async () => {
  const s = setup();
  const key = generateKeyPair(s.random);
  s.register(key);
  const c = await s.connect(key);
  c.phone.send({ type: "watch", conditions: [{}] });
  await settle();
  s.bus.publish({
    type: "AppEventPublished",
    subject: null,
    at: s.clock.now(),
    payload: { source: "lophn", event: "x", payload: {}, audience: null },
  });
  s.bus.publish({
    type: "NoticeClosed",
    subject: null,
    at: s.clock.now(),
    payload: { id: `ntc_0${"1".repeat(25)}` },
  });
  s.bus.publish({
    type: "AppSyncChanged",
    subject: viewApp,
    at: s.clock.now(),
    payload: { release: viewRelease, seq: 3 },
  });
  await settle();
  assert.deepEqual(
    c.frames.map((frame) =>
      frame.type === "event" ? frame.event.type : frame.type,
    ),
    ["ready", "NoticeClosed", "AppSyncChanged"],
  );
});

test("기기 A는 기기 B가 연 view를 부르거나 닫지 못하고, AppViewEvent는 owner인 기기에만 가며, 연결이 닫히면 그 기기의 view가 지워진다", async () => {
  const s = setup();
  const keyA = generateKeyPair(s.random);
  const keyB = generateKeyPair(s.random);
  s.register(keyA);
  s.register(keyB);
  const a = await s.connect(keyA);
  const b = await s.connect(keyB);
  let n = 0;
  // call 하나를 보내고 답을 기다려 [ok, value 또는 error code]로 준다.
  async function call(
    c: Awaited<ReturnType<typeof s.connect>>,
    method: "open" | "call" | "close",
    body: unknown,
  ) {
    const id = `c${n++}`;
    c.phone.send({ type: "call", id, resource: "app_views", method, body });
    for (;;) {
      const found = results(c.frames).find((frame) => frame.id === id);
      if (found) return found.ok ? found.value : found.error.code;
      await settle();
    }
  }
  const openBody = (view: string) => ({
    view,
    mode: "live",
    app: viewApp,
    release: null,
    screen: "main",
    place: "phone",
  });
  const save = (view: string) => ({ view, operation: "save", input: null });
  const done = { outcome: { ok: true, value: { done: true } } };

  // 열기는 binding({view, release, ...})을, 실패는 오류 code(문자열)를 준다.
  assert.equal(typeof (await call(b, "open", openBody("view-of-b"))), "object");
  assert.equal(typeof (await call(a, "open", openBody("view-of-a"))), "object");
  // A가 B의 view id를 알아도 없는 view와 같다.
  assert.equal(await call(a, "call", save("view-of-b")), "not_found");
  assert.deepEqual(await call(a, "close", { view: "view-of-b" }), {
    closed: false,
  });
  assert.deepEqual(await call(b, "call", save("view-of-b")), done);

  a.phone.send({ type: "watch", conditions: [{}] });
  b.phone.send({ type: "watch", conditions: [{}] });
  await settle();
  s.views.published({
    source: "ops",
    event: "limit",
    payload: { left: 1 },
    audience: null,
  });
  await settle();
  const appEvents = (c: Awaited<ReturnType<typeof s.connect>>) =>
    c.frames.flatMap((frame) =>
      frame.type === "event" && frame.event.type === "AppViewEvent"
        ? [(frame.event.payload as { view: string }).view]
        : [],
    );
  assert.deepEqual(appEvents(a), ["view-of-a"]);
  assert.deepEqual(appEvents(b), ["view-of-b"]);

  // B가 끊겼다 다시 붙으면 B의 view는 없고 A의 view는 그대로다.
  b.phone.close();
  await settle();
  const again = await s.connect(keyB);
  assert.equal(await call(again, "call", save("view-of-b")), "not_found");
  assert.deepEqual(await call(a, "call", save("view-of-a")), done);
});

test("붙지 않은 연결은 한도를 넘으면 바로 닫히고, join 시간이 지나면 닫혀 자리를 내준다", async () => {
  const s = setup();
  const idle = [];
  for (let i = 0; i < REMOTE_UNATTACHED_MAX; i++) {
    idle.push(await s.connect(generateKeyPair(s.random)));
  }
  const refused = await s.open(generateKeyPair(s.random));
  assert.equal(refused.opened.ok, false);

  s.fire(REMOTE_JOIN_MS);
  await settle();
  assert.ok(idle.every((c) => c.closed()));
  const next = await s.connect(generateKeyPair(s.random));
  assert.equal(next.closed(), false);
});

test("붙기 전의 큰 frame은 다 받기 전에 연결을 닫고, 붙은 기기의 큰 frame은 받는다", async () => {
  const s = setup();
  const big = (id: string): RemoteClientFrame => ({
    type: "call",
    id,
    resource: "turn_requests",
    method: "decide",
    body: { ...decideBody, pad: "x".repeat(100 * 1024) },
  });
  const stranger = await s.connect(generateKeyPair(s.random));
  const before = stranger.delivered.core;
  stranger.phone.send(big("s"));
  await settle();
  assert.equal(stranger.closed(), true);
  // 64 KiB record 둘로 가는 frame이다. 첫 record에서 끊는다.
  assert.equal(stranger.delivered.core - before, 1);

  const key = generateKeyPair(s.random);
  s.register(key);
  const device = await s.connect(key);
  device.phone.send(big("d"));
  await settle();
  assert.equal(device.closed(), false);
  assert.deepEqual(
    results(device.frames).map((frame) => frame.id),
    ["d"],
  );
});

test("기기를 찾은 뒤 자격을 받기 전에 빼면 연결이 닫히고 frame이 dispatch되지 않는다", async () => {
  const s = setup();
  const key = generateKeyPair(s.random);
  const id = s.register(key);
  // 첫 frame에서 명단을 찾은 뒤 붙기 전에 빼기가 저장되고 wiring이 host.revoked를 부른다. 연결이 열릴 때 frame 상한을 정하려
  // 찾는 것(첫 번째)은 지나간다.
  let finds = 0;
  s.hooks.afterFind = (found) => {
    if (++finds < 2) return;
    s.hooks.afterFind = undefined;
    s.table.delete(found);
    s.host.revoked([id]);
  };
  const { opened } = await s.open(key);
  assert.ok(opened.ok);
  const frames: RemoteServerFrame[] = [];
  let closed = false;
  opened.value.onFrame((frame) => frames.push(frame));
  opened.value.onClose(() => {
    closed = true;
  });
  opened.value.send({
    type: "call",
    id: "c",
    resource: "turn_requests",
    method: "decide",
    body: decideBody,
  });
  await settle();
  assert.equal(closed, true);
  assert.deepEqual(results(frames), []);
  assert.deepEqual(s.reached, []);
});

test("같은 이름의 기기는 shell.devices 항목을 따로 갖고, 끊거나 이름을 바꾸면 그 기기의 항목만 바뀐다", () => {
  const iphone = {
    name: "iPhone",
    os: "ios",
    width: 390,
    height: 844,
    dpr: 3,
  } as const;
  const [a, b] = [deviceId(1), deviceId(2)];
  // 사람이 넣은 항목은 device가 없다.
  let list: z.infer<typeof devicesSetting.type> = [iphone];
  list = screensPaired(list, a, iphone);
  list = screensPaired(list, b, iphone);
  assert.deepEqual(
    list.map((each) => [each.name, each.device]),
    [
      ["iPhone", undefined],
      ["iPhone 2", a],
      ["iPhone 3", b],
    ],
  );
  list = screensRevoked(list, a);
  list = screensRenamed(list, b, "iPhone");
  assert.deepEqual(list, [iphone, { ...iphone, name: "iPhone 2", device: b }]);
  assert.ok(devicesSetting.type.safeParse(list).success);
});

test("devices/set_push는 부른 기기 자기 행만 고치고, clear_push는 token이 그대로일 때만 지우고, 폰은 token을 읽지 못한다", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const step of [
      ...DEVICES_SCHEMA_STEPS,
      ...DEVICES_KIND_STEPS,
      ...ROSTER_SCHEMA_STEPS,
    ])
      db.exec(step.sql);
    const sql = createSql(db, () => true);
    const tx = {
      sql,
      now: () => "2026-11-15T00:00:00.000Z",
      port: () => ({ push: () => undefined }),
    } as unknown as Tx;
    const command = (method: string) =>
      DEVICES_COMMANDS.find((each) => each.route.method === method)!;
    const code = (result: { ok: boolean; error?: { code: string } }) =>
      result.ok ? "ok" : result.error!.code;
    const random = seededRandom(5);
    const [a, b] = [deviceId(1), deviceId(2)];
    for (const id of [a, b]) {
      db.prepare(
        `insert into devices (id, kind, name, os, width, height, dpr, public_key, created_at, is_primary)
           values (?, 'phone', 'Pixel', 'android', 412, 915, 2.625, ?, 'at', 0)`,
      ).run(id, remoteKeyText(generateKeyPair(random).publicKey));
    }
    const prefs = {
      needs_you: true,
      long_finish: true,
      app_update: true,
      job_missed: true,
      app_notify: true,
      quiet_when_present: true,
      show_names: true,
    };
    const tokenA = "ExponentPushToken[a]";
    const setPush = (principal: string, token: string | null) =>
      command("set_push").handle(
        tx,
        { principal, actor: "user" } as never,
        { token, prefs } as never,
        {} as never,
      );
    const clearPush = (id: string, token: string) =>
      command("clear_push").handle(
        tx,
        { principal: "machine:remote", actor: "machine" } as never,
        { id, token } as never,
        {} as never,
      );
    const tokens = () =>
      sql
        .all("select id, push_token from devices order by id", [])
        .map((row) => [row.id, row.push_token]);
    const targets = () =>
      devicesPushTargetsRead.handle(
        { sql, as_of_seq: "1" } as never,
        {} as never,
        {} as never,
      );

    // 기기가 아닌 자격은 forbidden이고, 끊긴 기기는 not_found다. 어느 쪽도 다른 행을 건드리지 않는다.
    assert.equal(code(setPush("user:local", tokenA)), "forbidden");
    assert.equal(code(setPush("machine:remote", tokenA)), "forbidden");
    assert.equal(code(setPush(`device:${deviceId(9)}`, tokenA)), "not_found");
    assert.deepEqual(tokens(), [
      [a, null],
      [b, null],
    ]);

    // 입력에 id가 없다. 부른 기기의 행만 바뀐다.
    assert.equal(code(setPush(`device:${a}`, tokenA)), "ok");
    assert.deepEqual(tokens(), [
      [a, tokenA],
      [b, null],
    ]);
    const listed = devicesListRead.handle(
      { sql, as_of_seq: "1" } as never,
      {} as never,
      {} as never,
    );
    assert.ok(listed.ok);
    assert.doesNotMatch(JSON.stringify(listed.value), /PushToken|prefs/);
    const read = targets();
    assert.ok(read.ok);
    assert.deepEqual(read.value.devices, [{ id: a, token: tokenA, prefs }]);

    // token이 그 사이 바뀌었으면 죽은 옛 token을 거두는 요청은 새 token을 지우지 않는다.
    assert.equal(code(setPush(`device:${a}`, "ExponentPushToken[new]")), "ok");
    assert.equal(code(clearPush(a, tokenA)), "ok");
    assert.deepEqual(tokens()[0], [a, "ExponentPushToken[new]"]);
    assert.equal(code(clearPush(a, "ExponentPushToken[new]")), "ok");
    assert.deepEqual(tokens()[0], [a, null]);

    // token: null은 push 끄기다. prefs는 남는다.
    assert.equal(code(setPush(`device:${b}`, null)), "ok");
    const off = targets();
    assert.ok(off.ok);
    assert.deepEqual(off.value.devices, []);
  } finally {
    db.close();
  }
});

// 이 계획 전의 data root: 옛 기기 표(kind step까지)에 사람이 별명을 붙인 폰 행과 다른 기계 desktop 행, machine 칸 없는 옛 host
// key. 명단 step, data step(찍기, 서명 key 더하기), 기동의 서명(wiring의 identify와 같은 순서)을 production code로 돌린다.
async function migrated() {
  const random = seededRandom(21);
  const clock = manualClock(1_000_000);
  const machine = `mch_0${"1".repeat(25)}` as const;
  const dir = mkdtempSync(join(tmpdir(), "lophn-roster-"));
  const oldHost = generateKeyPair(random);
  writeFileSync(
    join(dir, "host-key.json"),
    `${JSON.stringify({
      public_key: remoteKeyText(oldHost.publicKey),
      secret_key: remoteKeyText(oldHost.secretKey),
    })}\n`,
    { mode: 0o600 },
  );
  await stampHostKeyMachine(dir, machine);
  await addSigningKey(dir, random);
  const keys = await loadRemoteKeys(dir, random, machine);

  const db = new DatabaseSync(":memory:");
  for (const step of DEVICES_SCHEMA_STEPS) db.exec(step.sql);
  const phoneKey = generateKeyPair(random);
  const phoneId = deviceId(1);
  db.prepare(
    `insert into devices (id, name, os, width, height, dpr, public_key, created_at, is_primary, terminal_input)
       values (?, 'Pixel', 'android', 412, 915, 2.625, ?, 'at', 1, 1)`,
  ).run(phoneId, remoteKeyText(phoneKey.publicKey));
  for (const step of DEVICES_KIND_STEPS) db.exec(step.sql);
  db.prepare("update devices set alias = 'Work phone' where id = ?").run(
    phoneId,
  );
  db.prepare(
    `insert into devices (id, kind, name, os, public_key, created_at, is_primary)
       values (?, 'desktop', 'laptop', 'linux', ?, 'at', 0)`,
  ).run(deviceId(2), remoteKeyText(generateKeyPair(random).publicKey));
  for (const step of ROSTER_SCHEMA_STEPS) db.exec(step.sql);

  const sql = createSql(db, () => true);
  const tx = {
    sql,
    now: () => clock.now(),
    port: () => ({ push: () => undefined }),
  } as unknown as Tx;
  const machineCtx = { principal: "machine:remote", actor: "machine" } as never;
  const snapshot = { sql, as_of_seq: "1" } as never;
  let changed: (change: RosterChange) => void = () => undefined;
  const roster = createRoster({
    clock,
    random,
    ids: createIdSource({ clock, random }),
    load: async () => {
      const read = rosterStatementsRead.handle(
        snapshot,
        {} as never,
        machineCtx,
      );
      return read.ok ? ok(read.value) : read;
    },
    store: async (input) => {
      // 앱 sync log는 이 test에 없다. 접기는 wiring이 넘기는 함수다.
      const done = rosterStoreCommand(() => undefined).handle(
        tx,
        machineCtx,
        input as never,
        {} as never,
      );
      return done.ok ? ok(undefined) : done;
    },
    changed: (change) => changed(change),
  });
  assert.ok((await roster.load()).ok);
  await roster.useKeys(keys);
  const stored = rosterStatementsRead.handle(snapshot, {} as never, machineCtx);
  assert.ok(stored.ok);
  const identified = await roster.ensureSelf({
    machine,
    name: () => "studio",
    os: "linux",
    adopt: stored.value.adopt,
  });
  assert.ok(identified.ok);
  const s = setup({ roster, hostKey: keys.host });
  // wiring의 applyChange와 같다: 명단을 먼저 밀고, 빠진 id의 자격과 명단에 맞지 않는 연결을 거둔다.
  changed = ({ before, after, snapshot: pushed }) => {
    s.host.pushRoster(pushed);
    const kept = new Set(after.devices.map((each) => each.body.id));
    s.host.revoked(
      before.devices.map((each) => each.body.id).filter((id) => !kept.has(id)),
    );
  };
  return {
    s,
    roster,
    keys,
    oldHost,
    phoneKey,
    phoneText: remoteKeyText(phoneKey.publicKey),
    phoneId,
    sql,
  };
}

test("옛 기기 표에서 옮긴 뒤 이미 pairing한 폰은 다시 pairing하지 않고 같은 id로 붙고, 답의 서명 key로 명단을 믿는다", async () => {
  const m = await migrated();
  // 폰이 저장한 host key 그대로다.
  assert.deepEqual(m.keys.host.publicKey, m.oldHost.publicKey);
  // desktop 행은 지워지고 폰 행은 이 컴퓨터가 서명한 항목이 됐다(id, 별명이던 이름, 허락 그대로).
  assert.deepEqual(
    m.sql.all("select id from devices", []).map((row) => row.id),
    [m.phoneId],
  );
  const entry = m.roster
    .view()
    .devices.find((each) => each.body.key === m.phoneText)?.body;
  assert.deepEqual(
    [entry?.id, entry?.name, entry?.terminal_input],
    [m.phoneId, "Work phone", true],
  );

  const c = await m.s.connect(m.phoneKey);
  c.phone.send({ type: "join", id: "j", statements: [] });
  c.phone.send({
    type: "call",
    id: "c",
    resource: "turn_requests",
    method: "decide",
    body: decideBody,
  });
  await settle();
  assert.equal(c.closed(), false);
  const [joined, called] = results(c.frames);
  assert.ok(joined?.ok && called?.ok);
  const value = joined.value as {
    device: string;
    computer: { signing_key: string };
    roster: { statements: never[] };
  };
  assert.equal(value.device, m.phoneId);
  assert.equal(
    value.computer.signing_key,
    remoteKeyText(m.keys.signing.publicKey),
  );
  // 폰은 이 서명 key를 root로 받은 명단에서 자기를 찾는다.
  assert.ok(
    rosterView(
      value.roster.statements,
      [value.computer.signing_key],
      null,
    ).devices.some(
      (each) => each.body.id === m.phoneId && each.body.key === m.phoneText,
    ),
  );
  assert.deepEqual(m.s.reached, ["turn_requests/decide"]);
});

test("뺀 기기는 붙어 있던 연결이 빼기가 든 명단을 받은 뒤 닫히고, 그 key로는 call로도 join으로도 수명이 남은 초대장으로도 붙지 못한다", async () => {
  const m = await migrated();
  const c = await m.s.connect(m.phoneKey);
  c.phone.send({ type: "join", id: "j", statements: [] });
  c.phone.send({ type: "watch", conditions: [{}] });
  await settle();
  assert.equal(c.closed(), false);
  // 빼기 전에 받아 둔 초대장.
  const invite = m.roster.invite({
    kind: "phone",
    terminal_input: true,
    lifetime: "long",
    reach: { addresses: [], port: 7432, relay: null },
  });
  assert.ok(invite.ok);

  assert.ok((await m.roster.remove({ id: m.phoneId })).ok);
  await settle();
  assert.equal(c.closed(), true);
  const tail = c.frames.slice(-2);
  assert.equal(tail[0]?.type, "roster");
  assert.ok(
    tail[0]?.type === "roster" &&
      tail[0].roster.statements.some(
        (each) => each.body.type === "removal" && each.body.key === m.phoneText,
      ),
  );
  assert.deepEqual(tail[1], { type: "closed", reason: "credential_revoked" });
  // 이 컴퓨터의 기기 행도 지워졌다(push token이 같이 간다).
  assert.deepEqual(m.sql.all("select id from devices", []), []);

  const byCall = await m.s.connect(m.phoneKey);
  byCall.phone.send({
    type: "call",
    id: "c",
    resource: "turn_requests",
    method: "decide",
    body: decideBody,
  });
  await settle();
  assert.deepEqual(byCall.frames, [
    { type: "closed", reason: "credential_revoked" },
  ]);

  const { invite: signedInvite, secret } = invite.value.invite;
  for (const id of [m.phoneId, deviceId(7)]) {
    const body: RosterEntryBody = {
      type: "entry",
      id: id as RosterEntryBody["id"],
      kind: "phone",
      key: m.phoneText,
      signing_key: null,
      machine: null,
      name: "Pixel",
      os: "android",
      terminal_input: true,
      rev: 1,
      invite: signedInvite.body.key,
    };
    const invited: RosterInvitedStatement = {
      body,
      invite: signedInvite,
      signature: signRoster(body, remoteKeyBytes(secret)!),
    };
    for (const statements of [[], [invited]]) {
      const again = await m.s.connect(m.phoneKey);
      again.phone.send({ type: "join", id: "j", statements });
      await settle();
      const [refused] = results(again.frames);
      assert.ok(refused !== undefined && !refused.ok);
      assert.equal(refused.error.code, "unauthorized");
      assert.equal(refused.error.details?.reason, "removed");
      assert.equal(
        (refused.error.details?.removal as { body: { key: string } }).body.key,
        m.phoneText,
      );
    }
  }
  assert.ok(m.roster.find(m.phoneText) === undefined);
  assert.deepEqual(m.s.reached, []);
});

// setup의 core(B)에 다른 컴퓨터(A)의 link로 붙는다. A의 host key를 B의 명단에 둔다(가짜 명단). A 쪽은 B 하나가 든 명단이다.
// A의 bus에 낸 event는 `published`에 쌓인다.
async function linkedComputer(
  s: ReturnType<typeof setup>,
  t: { after(fn: () => void): void },
) {
  const aKey = generateKeyPair(s.random);
  s.register(aKey);
  const b: RosterEntryBody = {
    type: "entry",
    id: deviceId(50) as RosterEntryBody["id"],
    kind: "computer",
    key: remoteKeyText(s.coreKey.publicKey),
    signing_key: FAKE_SIGNING_KEY,
    machine: HOST_MACHINE,
    name: "studio",
    os: "linux",
    terminal_input: true,
    rev: 1,
    invite: null,
  };
  const snapshot = {
    statements: [],
    reach: [{ device: b.id, addresses: ["10.0.0.2"], port: 7432, relay: null }],
  };
  const roster = {
    view: () => ({
      devices: [{ body: b, signed_by: [], pending: false }],
      removed: [],
      folded: [],
      conflicts: [],
      invites: [],
      keep: [],
    }),
    self: () => ({
      id: deviceId(60),
      hostKey: remoteKeyText(aKey.publicKey),
      signingKey: "a-signing-key",
    }),
    snapshot: () => snapshot,
    receive: async () => ok(snapshot),
  } as unknown as Roster;
  const published: BusEvent[] = [];
  const links = createLinks({
    roster,
    name: () => "laptop",
    // 주소마다 메모리 전송 하나로 B의 host에 닿는다.
    dial: (_url) => {
      const w = wire();
      void s.host.accept(w.core as RemoteSocket);
      return Promise.resolve(w.phone);
    },
    random: s.random,
    clock: s.clock,
    wait(ms, fn) {
      const timer = setTimeout(fn, ms);
      return () => clearTimeout(timer);
    },
    publish: (event) => void published.push(event),
    logger: { error() {}, warn() {} } as never,
    onPeerReady: () => undefined,
    onPeerCarry: () => undefined,
  });
  links.sync(aKey);
  t.after(() => links.sync(undefined));
  for (let i = 0; i < 50 && links.list()[0]?.status !== "connected"; i++) {
    await settle();
  }
  assert.equal(links.list()[0]?.status, "connected");
  return { links, published };
}

// 다른 컴퓨터(A)가 link로 넘긴 call은 이 core(B)에서 A의 기기 자격(지금의 기기 route 목록)으로 걸러진다. 넘기는 쪽이 범위를
// 넓히거나, 넘긴 call을 다시 넘기는(machines/call) 길이 생기면 한 컴퓨터를 든 사람이 다른 컴퓨터의 설정·secret·명단을 고친다.
test("다른 기계로 넘긴 call은 그 기계에서 기기 route 목록과 허락으로 걸러져 허락 없는 설정 쓰기와 목록 밖 route(roster/*, machines/call)는 forbidden이다", async (t) => {
  const s = setup();
  const { links } = await linkedComputer(s, t);

  const call = (resource: string, method: string, body: unknown) =>
    links.call({ machine: HOST_MACHINE, resource, method, body });
  for (const [resource, method, body] of [
    ["settings", "update", { changes: [] }],
    [
      "roster",
      "invite",
      { kind: "phone", terminal_input: true, lifetime: "short" },
    ],
    ["roster", "remove", { id: deviceId(1) }],
    [
      "machines",
      "call",
      {
        machine: HOST_MACHINE,
        resource: "settings",
        method: "update",
        body: {},
      },
    ],
  ] as const) {
    const refused = await call(resource, method, body);
    assert.equal(
      !refused.ok && refused.error.code,
      "forbidden",
      `${resource}/${method}`,
    );
  }
  const inside = await call("turn_requests", "decide", decideBody);
  assert.ok(inside.ok);
  assert.deepEqual(s.reached, ["turn_requests/decide"]);
});

// 한 기계를 여러 구독자(창, shell main 안의 것)가 본다. 한쪽이 그만보거나 그 shell이 끝나 빠질 때 다른 구독자의 조건까지 덮으면
// 그쪽 화면이 말없이 멈춘다.
test("두 구독자가 같은 기계를 볼 때 한쪽이 빈 조건으로 그만봐도 다른 쪽의 event가 계속 오고, 한 capability가 끝나면 그 capability의 구독만 빠진다", async (t) => {
  const s = setup();
  const { links, published } = await linkedComputer(s, t);
  const ended: ((capability: string) => void)[] = [];
  const machines = createMachineRoutes({
    links,
    capability: () => true,
    onEnd: (listener) => void ended.push(listener),
  });
  const shell = { actor: "user", principal: "user" };
  const watch = (
    capability: string,
    watcher: string,
    conditions: EventCondition[],
  ) =>
    assert.ok(
      machines.watch(shell, {
        machine: HOST_MACHINE,
        watcher,
        conditions,
        shell_capability: capability,
      }).ok,
    );
  // 그 기계의 bus에 둘을 내고 이 컴퓨터에 MachineFrameReceived로 온 event의 type을 읽는다.
  const received = async () => {
    await settle();
    published.length = 0;
    s.bus.publish({
      type: "NoticeClosed",
      subject: null,
      at: s.clock.now(),
      payload: { id: `ntc_0${"1".repeat(25)}` },
    });
    s.bus.publish({
      type: "AppSyncChanged",
      subject: viewApp,
      at: s.clock.now(),
      payload: { release: viewRelease, seq: 3 },
    });
    await settle();
    return published.flatMap((event) => {
      const frame = (
        event.payload as { frame: { type: string; event?: BusEvent } }
      ).frame;
      return frame.type === "event" ? [frame.event!.type] : [];
    });
  };

  watch("a", "w1", [{ types: ["NoticeClosed"] }]);
  watch("b", "w1", [{ types: ["AppSyncChanged"] }]);
  assert.deepEqual(await received(), ["NoticeClosed", "AppSyncChanged"]);

  watch("b", "w1", []);
  assert.deepEqual(await received(), ["NoticeClosed"]);

  watch("b", "w1", [{ types: ["AppSyncChanged"] }]);
  for (const listener of ended) listener("a");
  assert.deepEqual(await received(), ["AppSyncChanged"]);
});
