import assert from "node:assert/strict";
import { test } from "node:test";
import { manualClock, ok, seededRandom } from "../../base/mod.ts";
import { type Route, routePath } from "../../protocol/base/mod.ts";
import { ROUTES } from "../../protocol/registry.ts";
import {
  connectRemote,
  generateKeyPair,
  type KeyPair,
  REMOTE_ALLOWED_ROUTES,
  type RemoteClientChannel,
  type RemoteClientFrame,
  type RemoteServerFrame,
  remoteKeyText,
} from "../../protocol/remote/mod.ts";
import { createBus } from "../events/mod.ts";
import {
  CredentialRegistry,
  type OperationPolicy,
} from "../server/identity/mod.ts";
import type { MemoryHandler } from "../server/mod.ts";
import { RouteRegistry } from "../server/mod.ts";
import { createAdmission } from "../supervision/responsiveness/mod.ts";
import { createDeviceCredentials, createRemoteCall } from "./call.ts";
import { createRemoteHost, PAIRING_TRIES, type RemoteSocket } from "./host.ts";
import { createPairingCodes, PAIRING_CODE_MS } from "./pairing.ts";

// 메모리 안에서 폰과 core를 잇는다. 실제 socket처럼 다음 microtask에 전한다.
function wire() {
  const handlers = {
    phone: { message: (_: Uint8Array) => {}, close: () => {} },
    core: { message: (_: Uint8Array) => {}, close: () => {} },
  };
  const closed = { phone: false, core: false };
  const end = (self: "phone" | "core", other: "phone" | "core") => ({
    send(bytes: Uint8Array) {
      queueMicrotask(() => {
        if (!closed[other]) handlers[other].message(bytes);
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
  return { phone: end("phone", "core"), core: end("core", "phone") };
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
  for (const route of [...ROUTES, ...REMOTE_ALLOWED_ROUTES]) {
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
  const reach =
    (name: string, value: unknown): MemoryHandler =>
    () => {
      reached.push(name);
      return ok(value);
    };
  const admission = createAdmission();
  const bus = createBus();
  const codes = createPairingCodes({ clock, random });
  const host = createRemoteHost({
    staticKey: coreKey,
    random,
    timers: { set: () => undefined, clear: () => undefined },
    bus,
    pairing: codes,
    devices: {
      find: async (key) => {
        const id = table.get(key);
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
      admission,
    }),
    admission,
  });

  async function connect(phoneKey: KeyPair) {
    const w = wire();
    void host.accept(w.core as RemoteSocket);
    const opened = await connectRemote({
      transport: w.phone,
      staticKey: phoneKey,
      remoteStatic: coreKey.publicKey,
      capabilities: [],
      random,
    });
    assert.ok(opened.ok);
    const phone: RemoteClientChannel = opened.value;
    const frames: RemoteServerFrame[] = [];
    let closed = false;
    phone.onFrame((frame) => frames.push(frame));
    phone.onClose(() => {
      closed = true;
    });
    return { phone, frames, closed: () => closed };
  }

  function register(phoneKey: KeyPair): string {
    const id = deviceId(next++);
    table.set(remoteKeyText(phoneKey.publicKey), id);
    return id;
  }

  return { host, codes, clock, bus, table, reached, connect, register, random };
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
