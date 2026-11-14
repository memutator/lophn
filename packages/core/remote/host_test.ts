import assert from "node:assert/strict";
import { test } from "node:test";
import type { z } from "zod";
import { manualClock, ok, seededRandom } from "../../base/mod.ts";
import { type Route, routePath } from "../../protocol/base/mod.ts";
import { appsSecretValue } from "../../protocol/apps/secret-use.ts";
import {
  hostDone,
  hostReport,
  hostTake,
} from "../../protocol/lophn-agent/host-queue.ts";
import {
  connectProvider,
  disconnectProvider,
  loginBegin,
  loginCancel,
  loginComplete,
  refreshProviderModels,
} from "../../protocol/lophn-agent/providers.ts";
import { deleteSession } from "../../protocol/lophn-agent/sessions.ts";
import { ROUTES } from "../../protocol/registry.ts";
import {
  connectRemote,
  devicesConnected,
  devicesList,
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
import { devicesSetting } from "../config/shell-settings.ts";
import { createBus } from "../events/mod.ts";
import {
  CredentialRegistry,
  type OperationPolicy,
} from "../server/identity/mod.ts";
import type {
  FileStreamHandler,
  MemoryHandler,
  UploadHandler,
} from "../server/mod.ts";
import { RouteRegistry } from "../server/mod.ts";
import { createAdmission } from "../supervision/responsiveness/mod.ts";
import { createDeviceCredentials, createRemoteCall } from "./call.ts";
import { screensPaired, screensRenamed, screensRevoked } from "./devices.ts";
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
  name: "Pixel",
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

// 기기 표만 가짜다. 자격, scope, route dispatch, Gateway 구독은 production code다.
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
    pairingStart,
    hostTake,
    hostReport,
    hostDone,
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
  const codes = createPairingCodes({ clock, random });
  const timers = new Map<number, { run: () => void; ms: number }>();
  let nextTimer = 0;
  // 기기 표를 읽은 뒤 답을 돌려주기 전에 부른다. 그 사이 기기를 끊는 test가 건다.
  const hooks: { afterFind?: (key: string) => void } = {};
  const host: RemoteHost = createRemoteHost({
    staticKey: coreKey,
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
        return ok({ id });
      },
      connected: () => undefined,
    },
    credentials: createDeviceCredentials({
      registry,
      record: async () => ok(undefined),
    }),
    call: createRemoteCall({
      registry,
      routes: new RouteRegistry([...allRoutes.values()]),
      clock,
      reads: new Map(),
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
      ]),
      fileStreams: new Map([["message-images/read", image]]),
      uploads: new Map([["message-images/upload", upload]]),
      admission,
    }),
    admission,
  });

  function open(phoneKey: KeyPair) {
    const w = wire();
    void host.accept(w.core as RemoteSocket);
    return connectRemote({
      transport: w.phone,
      staticKey: phoneKey,
      remoteStatic: coreKey.publicKey,
      capabilities: [],
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
    table,
    reached,
    uploaded,
    hooks,
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
      assert.deepEqual(c.frames, []);
      assert.equal(c.closed(), true);
    });
  }
});

test("쓴 code, 300초 지난 code, 새 code가 대신한 code는 다시 통하지 않는다", () => {
  const s = setup();
  const used = s.codes.start().code;
  assert.equal(s.codes.take(used), true);
  assert.equal(s.codes.take(used), false);

  const old = s.codes.start().code;
  s.clock.advance(PAIRING_CODE_MS);
  assert.equal(s.codes.take(old), false);

  const replaced = s.codes.start().code;
  const current = s.codes.start().code;
  assert.equal(s.codes.take(replaced), false);
  assert.equal(s.codes.take(current), true);
});

test("틀린 pairing code는 연결마다 5번까지고, 맞는 code로 붙은 기기는 그 자리에서 route를 부른다", async () => {
  const s = setup();
  const guesser = await s.connect(generateKeyPair(s.random));
  const code = s.codes.start().code;
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

test("route 목록을 넓힌 뒤에도 sessions/delete, secret, provider·설정 쓰기, devices/*, pairing/*, host/*는 forbidden이다", async () => {
  const s = setup();
  const key = generateKeyPair(s.random);
  s.register(key);
  const c = await s.connect(key);
  const outside = [
    "sessions/delete",
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
    "pairing/start",
    "host/take",
    "host/report",
    "host/done",
  ];
  for (const path of outside) {
    const [resource, method] = path.split("/");
    c.phone.send({ type: "call", id: path, resource, method, body: {} });
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
  assert.deepEqual(results(again.frames), []);
  assert.deepEqual(s.reached, []);

  const repaired = await s.connect(key);
  repaired.phone.send({
    type: "pair",
    id: "p",
    code: s.codes.start().code,
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
  await settle();
  assert.deepEqual(
    c.frames.map((frame) =>
      frame.type === "event" ? frame.event.type : frame.type,
    ),
    ["ready", "NoticeClosed"],
  );
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
      ...iphone,
      device: a,
    }).success,
    false,
  );
});
