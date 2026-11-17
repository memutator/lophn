import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { z } from "zod";
import { manualClock, ok, seededRandom } from "../../base/mod.ts";
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
  loginBegin,
  loginCancel,
  loginComplete,
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
  devicesForgetAll,
  devicesList,
  devicesPushTargets,
  devicesRegister,
  devicesRename,
  devicesRevoke,
  devicesSetPrimary,
  generateKeyPair,
  type KeyPair,
  REMOTE_ALLOWED_ROUTES,
  remoteClientFrameSchema,
  type RemoteClientChannel,
  type RemoteClientFrame,
  type RemoteServerFrame,
  pairingStart,
  remoteKeyText,
} from "../../protocol/remote/mod.ts";
import { workflowEdit } from "../../protocol/workflows/routes.ts";
import { appViewHandlers, createAppViews } from "../apps/views/mod.ts";
import { devicesSetting } from "../config/shell-settings.ts";
import {
  projectFilesListRead,
  projectFilesReadRead,
} from "../projects/files/mod.ts";
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
  type DevicesChange,
  devicesListRead,
  devicesPushTargetsRead,
  screensPaired,
  screensRenamed,
  screensRevoked,
} from "./devices.ts";
import {
  createRemoteHost,
  PAIRING_TRIES,
  REMOTE_PAIRING_MS,
  REMOTE_UNATTACHED_MAX,
  type RemoteHost,
  type RemoteSocket,
} from "./host.ts";
import { createPairingCodes, PAIRING_CODE_MS } from "./pairing.ts";

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
const deviceId = (n: number) => `dev_0${String(n).padStart(25, "0")}`;
const screen = {
  kind: "phone",
  os: "android",
  width: 412,
  height: 915,
  dpr: 2.625,
} as const;
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

// 기기 표, 앱 process·release 선언, 앱 호출 경로만 가짜다. 자격, scope, route dispatch, view 표, Gateway 구독은 production code다.
function setup() {
  const random = seededRandom(11);
  const clock = manualClock(1_000_000);
  const coreKey = generateKeyPair(random);
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
    loginBegin,
    loginCancel,
    loginComplete,
    refreshProviderModels,
    devicesList,
    devicesRename,
    devicesRevoke,
    devicesSetPrimary,
    devicesRegister,
    devicesConnected,
    devicesForgetAll,
    devicesClearPush,
    devicesPushTargets,
    pairingStart,
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
  for (const route of [...ROUTES, ...REMOTE_ALLOWED_ROUTES, ...outside]) {
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
  const codes = createPairingCodes({ clock, random });
  const timers = new Map<number, { run: () => void; ms: number }>();
  let nextTimer = 0;
  // 기기 표를 읽은 뒤 답을 돌려주기 전에 부른다. 그 사이 기기를 끊는 test가 건다.
  const hooks: { afterFind?: (key: string) => void } = {};
  // 등록과 붙음에 넘긴 기기 이름(hello로 알린 것).
  const names: string[] = [];
  const host: RemoteHost = createRemoteHost({
    staticKey: coreKey,
    machine: () => ({
      id: `mch_0${"1".repeat(25)}`,
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
    pairing: codes,
    devices: {
      find: async (key) => {
        const id = table.get(key);
        hooks.afterFind?.(key);
        return ok(id === undefined ? undefined : { id });
      },
      register: async (input) => {
        const id = deviceId(next++);
        table.set(input.public_key, id);
        names.push(`register ${input.name}`);
        return ok({ id });
      },
      connected: (_id, name) => void names.push(`connected ${name}`),
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
    codes,
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

test("등록되지 않은 key의 연결은 pair 말고 아무 frame도 통하지 않는다", async (t) => {
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
      // 등록되지 않은 key는 다시 pairing하라는 이유를 받는다(꺼져 있는 동안 끊긴 폰).
      assert.deepEqual(c.frames, [
        { type: "closed", reason: "credential_revoked" },
      ]);
      assert.equal(c.closed(), true);
    });
  }
});

test("쓴 code, 300초 지난 code, 새 code가 대신한 code는 다시 통하지 않는다", () => {
  const s = setup();
  const used = s.codes.start({ terminal_input: true }).code;
  assert.deepEqual(s.codes.take(used), { terminal_input: true });
  assert.equal(s.codes.take(used), undefined);

  const old = s.codes.start({ terminal_input: true }).code;
  s.clock.advance(PAIRING_CODE_MS);
  assert.equal(s.codes.take(old), undefined);

  const replaced = s.codes.start({ terminal_input: true }).code;
  const current = s.codes.start({ terminal_input: true }).code;
  assert.equal(s.codes.take(replaced), undefined);
  assert.deepEqual(s.codes.take(current), { terminal_input: true });
});

test("틀린 pairing code는 연결마다 5번까지고, 맞는 code로 붙은 기기는 그 자리에서 route를 부른다", async () => {
  const s = setup();
  const guesser = await s.connect(generateKeyPair(s.random));
  const code = s.codes.start({ terminal_input: true }).code;
  for (let i = 0; i < PAIRING_TRIES; i++) {
    guesser.phone.send({ type: "pair", id: `p${i}`, code: "wrong", ...screen });
    await settle();
  }
  assert.equal(guesser.closed(), true);
  assert.equal(results(guesser.frames).length, PAIRING_TRIES);
  assert.ok(results(guesser.frames).every((frame) => !frame.ok));
  assert.equal(s.table.size, 0);

  const phone = await s.connect(generateKeyPair(s.random));
  phone.phone.send({ type: "pair", id: "p", code, ...screen });
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
    results(phone.frames).map((frame) => [frame.id, frame.ok]),
    [
      ["p", true],
      ["c", true],
    ],
  );
  assert.equal(s.table.size, 1);
  assert.deepEqual(s.reached, ["turn_requests/decide"]);
  // pair frame에는 이름이 없다. 등록 이름은 그 연결의 hello로 알린 이름이다.
  assert.deepEqual(s.names, ["register Pixel", "connected Pixel"]);
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

test("route 목록을 넓힌 뒤에도 sessions/delete, secret, provider·model·설정 쓰기, devices/*, pairing/*, agent·job·앱·project·workflow 만들기·고치기·지우기, 앱 직접 호출·grant·release·rewind·log 쓰기는 forbidden이고, 폰 화면 route는 통과한다", async () => {
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
    "providers/login-begin",
    "providers/login-cancel",
    "providers/login-complete",
    "providers/refresh-models",
    "settings/update",
    "devices/list",
    "devices/rename",
    "devices/revoke",
    "devices/set_primary",
    "devices/register",
    "devices/connected",
    "devices/forget_all",
    "devices/clear_push",
    "devices/push_targets",
    "pairing/start",
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

test("끊은 기기는 연결이 닫히고 같은 key로는 pair만 받는다", async () => {
  const s = setup();
  const key = generateKeyPair(s.random);
  const id = s.register(key);
  const c = await s.connect(key);
  c.phone.send({ type: "watch", conditions: [{}] });
  await settle();
  // devices.revoke가 표에서 지우고 commit 뒤 wiring이 host.revoked를 부른다.
  s.table.delete(remoteKeyText(key.publicKey));
  s.host.revoked(id);
  await settle();
  assert.equal(c.closed(), true);
  assert.deepEqual(c.frames.at(-1), {
    type: "closed",
    reason: "credential_revoked",
  });

  const again = await s.connect(key);
  again.phone.send({
    type: "call",
    id: "c",
    resource: "turn_requests",
    method: "decide",
    body: decideBody,
  });
  await settle();
  assert.equal(again.closed(), true);
  assert.deepEqual(again.frames, [
    { type: "closed", reason: "credential_revoked" },
  ]);
  assert.deepEqual(s.reached, []);

  const repaired = await s.connect(key);
  repaired.phone.send({
    type: "pair",
    id: "p",
    code: s.codes.start({ terminal_input: true }).code,
    ...screen,
  });
  await settle();
  assert.deepEqual(
    results(repaired.frames).map((frame) => [frame.id, frame.ok]),
    [["p", true]],
  );
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

test("붙지 않은 연결은 한도를 넘으면 바로 닫히고, pairing 시간이 지나면 닫혀 자리를 내준다", async () => {
  const s = setup();
  const idle = [];
  for (let i = 0; i < REMOTE_UNATTACHED_MAX; i++) {
    idle.push(await s.connect(generateKeyPair(s.random)));
  }
  const refused = await s.open(generateKeyPair(s.random));
  assert.equal(refused.opened.ok, false);

  s.fire(REMOTE_PAIRING_MS);
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

test("기기를 찾은 뒤 자격을 받기 전에 끊으면 연결이 닫히고 frame이 dispatch되지 않는다", async () => {
  const s = setup();
  const key = generateKeyPair(s.random);
  const id = s.register(key);
  // 표를 읽은 뒤 답이 오기 전에 devices.revoke가 commit되고 wiring이 host.revoked를 부른다.
  s.hooks.afterFind = (found) => {
    s.hooks.afterFind = undefined;
    s.table.delete(found);
    s.host.revoked(id);
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
  // 항목의 device는 core만 단다. 폰의 pair frame은 그 칸을 받지 않는다.
  assert.equal(
    remoteClientFrameSchema.safeParse({
      type: "pair",
      id: "p",
      code: "c",
      kind: "phone",
      os: iphone.os,
      width: iphone.width,
      height: iphone.height,
      dpr: iphone.dpr,
      device: a,
    }).success,
    false,
  );
});

test("등록된 key의 pair는 맞는 code일 때만 새 등록으로 붙고, 틀린 code는 옛 등록을 그대로 둔다", async () => {
  const s = setup();
  const key = generateKeyPair(s.random);
  const old = s.register(key);
  const code = s.codes.start({ terminal_input: true }).code;
  const c = await s.connect(key);
  c.phone.send({ type: "pair", id: "wrong", code: "wrong", ...screen });
  await settle();
  assert.equal(s.table.get(remoteKeyText(key.publicKey)), old);

  c.phone.send({ type: "pair", id: "right", code, ...screen });
  c.phone.send({
    type: "call",
    id: "c",
    resource: "turn_requests",
    method: "decide",
    body: decideBody,
  });
  await settle();
  const fresh = s.table.get(remoteKeyText(key.publicKey));
  assert.notEqual(fresh, old);
  assert.deepEqual(
    results(c.frames).map((frame) =>
      frame.ok ? [frame.id, frame.value] : [frame.id, frame.error.code],
    ),
    [
      ["wrong", "unauthorized"],
      ["right", { device: fresh }],
      ["c", { outcome: { outcome: "allow", scope: "once" } }],
    ],
  );
});

test("devices/unpair는 부른 기기 자기 등록만 지우고, devices/register는 같은 key의 옛 등록을 새 등록으로 바꾼다", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const step of [...DEVICES_SCHEMA_STEPS, ...DEVICES_KIND_STEPS])
      db.exec(step.sql);
    const sql = createSql(db, () => true);
    const changes: DevicesChange[] = [];
    let n = 0;
    const tx = {
      sql,
      now: () => "2026-11-15T00:00:00.000Z",
      newId: () => deviceId(++n),
      port: () => ({
        push: (_topic: string, change: DevicesChange) => changes.push(change),
      }),
    } as unknown as Tx;
    const command = (method: string) =>
      DEVICES_COMMANDS.find((each) => each.route.method === method)!;
    const as = (principal: string) => ({ principal, actor: "user" }) as never;
    const register = (publicKey: KeyPair) =>
      command("register").handle(
        tx,
        { principal: "machine:remote", actor: "machine" } as never,
        {
          ...screen,
          name: "Pixel",
          public_key: remoteKeyText(publicKey.publicKey),
        } as never,
        {} as never,
      );
    const unpair = (principal: string) =>
      command("unpair").handle(tx, as(principal), {} as never, {} as never);
    const ids = () =>
      sql.all("select id from devices order by id", []).map((row) => row.id);
    const code = (result: { ok: boolean; error?: { code: string } }) =>
      result.ok ? "ok" : result.error!.code;

    const random = seededRandom(3);
    const [phoneA, phoneB] = [generateKeyPair(random), generateKeyPair(random)];
    const [a, b] = [deviceId(1), deviceId(2)];
    assert.equal(code(register(phoneA)), "ok");
    assert.equal(code(register(phoneB)), "ok");
    changes.length = 0;

    // 사람(desktop)과 machine 자격은 기기가 아니다. 지울 등록이 없다.
    assert.equal(code(unpair("user:local")), "forbidden");
    assert.equal(code(unpair("machine:remote")), "forbidden");
    assert.deepEqual(ids(), [a, b]);

    assert.deepEqual(unpair(`device:${a}`), { ok: true, value: { id: a } });
    assert.deepEqual(ids(), [b]);
    assert.deepEqual(changes, [{ type: "revoked", id: a }]);
    assert.equal(code(unpair(`device:${a}`)), "not_found");
    assert.deepEqual(ids(), [b]);

    changes.length = 0;
    const again = register(phoneB);
    assert.ok(again.ok);
    const { id: fresh } = again.value as { id: string };
    assert.notEqual(fresh, b);
    assert.deepEqual(ids(), [fresh]);
    assert.deepEqual(changes, [
      { type: "revoked", id: b },
      { type: "registered", id: fresh, kind: "phone" },
    ]);
  } finally {
    db.close();
  }
});

test("devices/set_push는 부른 기기 자기 행만 고치고, clear_push는 token이 그대로일 때만 지우고, 폰은 token을 읽지 못한다", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const step of [...DEVICES_SCHEMA_STEPS, ...DEVICES_KIND_STEPS])
      db.exec(step.sql);
    const sql = createSql(db, () => true);
    let n = 0;
    const tx = {
      sql,
      now: () => "2026-11-15T00:00:00.000Z",
      newId: () => deviceId(++n),
      port: () => ({ push: () => undefined }),
    } as unknown as Tx;
    const command = (method: string) =>
      DEVICES_COMMANDS.find((each) => each.route.method === method)!;
    const code = (result: { ok: boolean; error?: { code: string } }) =>
      result.ok ? "ok" : result.error!.code;
    const random = seededRandom(5);
    for (const _ of [1, 2]) {
      command("register").handle(
        tx,
        { principal: "machine:remote", actor: "machine" } as never,
        {
          ...screen,
          name: "Pixel",
          public_key: remoteKeyText(generateKeyPair(random).publicKey),
        } as never,
        {} as never,
      );
    }
    const [a, b] = [deviceId(1), deviceId(2)];
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
