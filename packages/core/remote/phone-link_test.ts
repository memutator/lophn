import assert from "node:assert/strict";
import { test } from "node:test";
import { ok, seededRandom } from "../../base/mod.ts";
import {
  connectRemote,
  generateKeyPair,
  type KeyPair,
  type RemoteServerFrame,
  remoteKeyText,
} from "../../protocol/remote/mod.ts";
import { createBus } from "../events/mod.ts";
import { createAdmission } from "../supervision/responsiveness/mod.ts";
import { createRemoteHost, type RemoteSocket } from "./host.ts";
import { createPhoneLink } from "./phone-link.ts";

const DEADLINE_MS = 20_000;
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

// host_test.ts와 같은 메모리 전송. 다음 microtask에 전한다.
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

// 기기 표·자격·call은 가짜고 host와 link는 production code다.
function setup() {
  const random = seededRandom(7);
  const coreKey = generateKeyPair(random);
  const table = new Map<string, string>();
  const timers = new Map<number, { run: () => void; ms: number }>();
  let nextTimer = 0;
  const fakeTimers = {
    set(run: () => void, ms: number) {
      timers.set(nextTimer, { run, ms });
      return nextTimer++;
    },
    clear: (handle: unknown) => void timers.delete(handle as number),
  };
  const link = createPhoneLink({ timers: fakeTimers, random });
  const host = createRemoteHost({
    staticKey: coreKey,
    machine: () => ({
      id: `mch_0${"1".repeat(25)}`,
      name: "studio",
      addresses: [],
    }),
    random,
    timers: fakeTimers,
    bus: createBus(),
    roster: {
      find: (key) => table.get(key),
      join: async () => ok(null as never),
      receive: async () => ok({ statements: [], reach: [] }),
    },
    devices: { connected: () => undefined },
    credentials: { get: async () => ok({} as never), revoke: () => {} },
    call: async () => ok(null),
    admission: createAdmission(),
    views: { closeOwner: () => {} },
    phoneLink: link,
  });

  // 등록된 기기 하나로 붙는다. 첫 frame(`watch`)으로 기기 자격이 붙고 `ready`를 받는다.
  async function phone(device: string, capabilities: string[]) {
    const key: KeyPair = generateKeyPair(random);
    table.set(remoteKeyText(key.publicKey), device);
    const w = wire();
    void host.accept(w.core as RemoteSocket);
    const opened = await connectRemote({
      transport: w.phone,
      staticKey: key,
      remoteStatic: coreKey.publicKey,
      capabilities,
      name: "Pixel",
      random,
    });
    assert.ok(opened.ok);
    const channel = opened.value;
    const frames: RemoteServerFrame[] = [];
    let closed = false;
    channel.onFrame((frame) => frames.push(frame));
    channel.onClose(() => {
      closed = true;
    });
    channel.send({ type: "watch", conditions: [{}] });
    await settle();
    assert.ok(frames.some((frame) => frame.type === "ready"));
    const requests = () =>
      frames.flatMap((frame) => (frame.type === "request" ? [frame] : []));
    return { channel, requests, closed: () => closed };
  }

  function fire(ms: number) {
    for (const [handle, timer] of [...timers]) {
      if (timer.ms !== ms) continue;
      timers.delete(handle);
      timer.run();
    }
  }

  return { link, phone, fire };
}

const reason = (result: { ok: boolean; error?: { details?: unknown } }) =>
  result.ok ? "ok" : (result.error?.details as { reason?: string })?.reason;

test("요청은 지정한 기기의 연결로만 가고, 그 기기가 hello.capabilities에 적지 않은 kind는 보내지 않으며, 모르는 id·다른 기기·deadline 뒤의 response는 버리고, 기다리는 사이 연결이 닫히면 unavailable(phone_unreachable)로 끝난다", async () => {
  const s = setup();
  const a = await s.phone("dev_a", ["location.get"]);
  const b = await s.phone("dev_b", ["location.get"]);
  const ask = (device: string, kind = "location.get") =>
    s.link.call({ device, kind, input: {}, deadline_ms: DEADLINE_MS });

  // 붙은 연결이 없는 기기.
  assert.equal(reason(await ask("dev_none")), "phone_unreachable");

  // 적지 않은 kind는 보내지 않는다. 보냈다면 deadline이 끝내도록 timer를 돌린다.
  const unsupported = ask("dev_a", "drive.tap");
  await settle();
  s.fire(DEADLINE_MS);
  assert.equal(reason(await unsupported), "unsupported");
  assert.deepEqual(a.requests(), []);

  // 지정한 기기에만 간다. 다른 기기의 같은 id, 모르는 id는 버리고 연결을 닫지 않는다.
  let done: unknown;
  const first = ask("dev_a").then((result) => (done = result));
  await settle();
  assert.equal(a.requests().length, 1);
  assert.deepEqual(b.requests(), []);
  const id = a.requests()[0]!.id;
  b.channel.send({ type: "response", id, ok: true, value: "from b" });
  a.channel.send({ type: "response", id: "prq_unknown", ok: true, value: 1 });
  await settle();
  assert.equal(done, undefined);
  assert.equal(a.closed() || b.closed(), false);
  a.channel.send({ type: "response", id, ok: true, value: { lat: 1 } });
  assert.deepEqual(await first, { ok: true, value: { lat: 1 } });

  // 폰의 오류는 code와 details 그대로다.
  const refused = ask("dev_a");
  await settle();
  a.channel.send({
    type: "response",
    id: a.requests()[1]!.id,
    ok: false,
    error: {
      code: "forbidden",
      message: "denied",
      details: { reason: "os_permission_denied" },
    },
  });
  assert.deepEqual(await refused, {
    ok: false,
    error: {
      code: "forbidden",
      message: "denied",
      details: { reason: "os_permission_denied" },
    },
  });

  // deadline이 지나면 timeout이고, 뒤에 온 답은 버린다.
  const late = ask("dev_a");
  await settle();
  s.fire(DEADLINE_MS);
  assert.equal(reason(await late), "timeout");
  a.channel.send({
    type: "response",
    id: a.requests()[2]!.id,
    ok: true,
    value: "late",
  });
  await settle();
  assert.equal(a.closed(), false);

  // 기다리는 사이 연결이 닫힌다.
  const dropped = ask("dev_b");
  await settle();
  assert.equal(b.requests().length, 1);
  b.channel.close();
  assert.equal(reason(await dropped), "phone_unreachable");
  assert.equal(reason(await ask("dev_b")), "phone_unreachable");
});
