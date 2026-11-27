import assert from "node:assert/strict";
import { test } from "node:test";
import { seededRandom } from "../base/mod.ts";
import {
  generateKeyPair,
  type KeyPair,
  remoteKeyText,
} from "../protocol/remote/noise.ts";
import {
  relayDataUrl,
  relayHostUrl,
  relayPhoneUrl,
  relayProof,
  relayToHostSchema,
} from "../protocol/remote/relay.ts";
import {
  createRelay,
  RELAY_BUFFER_MAX_BYTES,
  RELAY_BURST_BYTES,
  RELAY_BYTES_PER_SECOND,
  RELAY_HOSTS_PER_IP,
  RELAY_SOCKETS_PER_IP,
  type RelaySocket,
} from "./relay.ts";

// relay 쪽 socket 하나와 그 상대 끝. 상대가 보낸 것은 receive, relay가 보낸 것은 sent에 쌓인다.
function memorySocket() {
  const sent: (Uint8Array | string)[] = [];
  const handlers: {
    message?: (data: Uint8Array | string) => void;
    close: (() => void)[];
  } = { close: [] };
  const end = { sent, closed: false, buffered: 0, paused: false };
  const socket: RelaySocket = {
    send: (data) => void sent.push(data),
    ping: () => undefined,
    close() {
      if (end.closed) return;
      end.closed = true;
      for (const handler of handlers.close) handler();
    },
    onMessage: (handler) => void (handlers.message = handler),
    onPong: () => undefined,
    onClose: (handler) => void handlers.close.push(handler),
    bufferedAmount: () => end.buffered,
    pause: () => void (end.paused = true),
    resume: () => void (end.paused = false),
  };
  return {
    socket,
    end,
    receive: (data: Uint8Array | string) => handlers.message?.(data),
    control: () =>
      sent
        .filter((x) => typeof x === "string")
        .map((x) => relayToHostSchema.parse(JSON.parse(x))),
  };
}

const RELAY = "ws://relay";
const random = seededRandom(7);

const IP = "203.0.113.1";

function setup(clock = { ms: 0 }) {
  const relay = createRelay({
    random,
    timers: { set: () => undefined, clear: () => undefined },
    now: () => clock.ms,
  });
  return {
    accept: (url: string, socket: RelaySocket, ip = IP) =>
      relay.accept(url, socket, ip),
  };
}

// core가 control socket을 걸고 challenge에 proof를 답한다. secret이 core key의 것이 아니면 틀린 증명이다.
function connectHost(
  relay: ReturnType<typeof setup>,
  core: KeyPair,
  proofSecret: Uint8Array | undefined,
  ip = IP,
) {
  const host = memorySocket();
  const key = remoteKeyText(core.publicKey);
  relay.accept(path(relayHostUrl(RELAY, key)), host.socket, ip);
  const challenge = host.control()[0];
  assert.equal(challenge.type, "challenge");
  if (proofSecret && challenge.type === "challenge") {
    const mac = relayProof(proofSecret, challenge.relay_key, challenge.nonce);
    host.receive(JSON.stringify({ type: "proof", mac }));
  }
  return { host, key };
}

function path(url: string): string {
  const parsed = new URL(url);
  return parsed.pathname + parsed.search;
}

test("증명하지 못한 control socket에는 폰 연결이 이어지지 않는다", () => {
  const cases = [
    { name: "증명 없음", proof: () => undefined },
    { name: "다른 key의 증명", proof: () => generateKeyPair(random).secretKey },
  ];
  for (const c of cases) {
    const relay = setup();
    const core = generateKeyPair(random);
    const { host, key } = connectHost(relay, core, c.proof());
    const phone = memorySocket();
    relay.accept(path(relayPhoneUrl(RELAY, key)), phone.socket);
    assert.equal(phone.end.closed, true, c.name);
    assert.deepEqual(
      host.control().map((f) => f.type),
      ["challenge"],
      c.name,
    );
  }
  // 같은 준비에 맞는 증명이면 이어진다.
  const relay = setup();
  const core = generateKeyPair(random);
  const { host, key } = connectHost(relay, core, core.secretKey);
  const phone = memorySocket();
  relay.accept(path(relayPhoneUrl(RELAY, key)), phone.socket);
  assert.equal(phone.end.closed, false);
  assert.deepEqual(
    host.control().map((f) => f.type),
    ["challenge", "ready", "connected"],
  );
});

test("폰 연결 둘의 message가 서로의 data socket으로 가지 않는다", () => {
  const relay = setup();
  const core = generateKeyPair(random);
  const { host, key } = connectHost(relay, core, core.secretKey);
  const phoneA = memorySocket();
  const phoneB = memorySocket();
  relay.accept(path(relayPhoneUrl(RELAY, key)), phoneA.socket);
  relay.accept(path(relayPhoneUrl(RELAY, key)), phoneB.socket);
  const [connA, connB] = host
    .control()
    .flatMap((f) => (f.type === "connected" ? [f.conn] : []));
  // data socket이 붙기 전에 보낸 것은 들고 있다가 넘긴다.
  phoneA.receive(Uint8Array.of(0xa1));
  phoneB.receive(Uint8Array.of(0xb1));
  const dataB = memorySocket();
  const dataA = memorySocket();
  relay.accept(path(relayDataUrl(RELAY, connB)), dataB.socket);
  relay.accept(path(relayDataUrl(RELAY, connA)), dataA.socket);
  phoneA.receive(Uint8Array.of(0xa2));
  phoneB.receive(Uint8Array.of(0xb2));
  dataA.receive(Uint8Array.of(0xa3));
  dataB.receive(Uint8Array.of(0xb3));

  assert.deepEqual(dataA.end.sent, [Uint8Array.of(0xa1), Uint8Array.of(0xa2)]);
  assert.deepEqual(dataB.end.sent, [Uint8Array.of(0xb1), Uint8Array.of(0xb2)]);
  assert.deepEqual(phoneA.end.sent, [Uint8Array.of(0xa3)]);
  assert.deepEqual(phoneB.end.sent, [Uint8Array.of(0xb3)]);

  // 밀린 data socket에는 더 쌓지 않고 그 짝만 닫는다.
  dataA.end.buffered = RELAY_BUFFER_MAX_BYTES + 1;
  phoneA.receive(Uint8Array.of(0xa4));
  assert.equal(dataA.end.sent.length, 2);
  assert.equal(phoneA.end.closed, true);
  assert.equal(phoneB.end.closed, false);
});

test("한 IP는 host 자리와 socket을 한도까지만 열고, 한도를 넘게 넘기는 폰 연결은 닫힌다", () => {
  const clock = { ms: 0 };
  const relay = setup(clock);
  const openHost = () => {
    const host = memorySocket();
    const key = remoteKeyText(generateKeyPair(random).publicKey);
    relay.accept(path(relayHostUrl(RELAY, key)), host.socket);
    return host;
  };
  const hosts = Array.from({ length: RELAY_HOSTS_PER_IP + 1 }, openHost);
  assert.deepEqual(
    hosts.map((host) => host.end.closed),
    [...Array<boolean>(RELAY_HOSTS_PER_IP).fill(false), true],
  );
  // host 하나가 닫히면 그 자리가 난다.
  hosts[0]?.socket.close();
  assert.equal(openHost().end.closed, false);

  // 다른 IP의 core 둘에 이 IP의 폰을 붙인다. control 4개와 합해 RELAY_SOCKETS_PER_IP를 넘는 socket은 닫힌다.
  const coreIp = "198.51.100.2";
  const cores = [generateKeyPair(random), generateKeyPair(random)].map((core) =>
    connectHost(relay, core, core.secretKey, coreIp),
  );
  const room = RELAY_SOCKETS_PER_IP - RELAY_HOSTS_PER_IP;
  const phones = Array.from({ length: room + 1 }, (_, i) => {
    const phone = memorySocket();
    const { key } = cores[i % 2]!;
    relay.accept(path(relayPhoneUrl(RELAY, key)), phone.socket);
    return phone;
  });
  assert.deepEqual(
    phones.map((phone) => phone.end.closed),
    [...Array<boolean>(room).fill(false), true],
  );
  // 다른 IP는 따로 센다.
  const other = memorySocket();
  relay.accept(
    path(relayPhoneUrl(RELAY, cores[0]!.key)),
    other.socket,
    "198.51.100.3",
  );
  assert.equal(other.end.closed, false);

  // 한꺼번의 한도까지는 넘기고, 그 뒤는 초당 한도만큼만 넘긴다. 넘으면 그 짝을 닫는다.
  const conns = cores[0]!.host
    .control()
    .flatMap((f) => (f.type === "connected" ? [f.conn] : []));
  const data = memorySocket();
  relay.accept(path(relayDataUrl(RELAY, conns.at(-1)!)), data.socket, coreIp);
  other.receive(new Uint8Array(RELAY_BURST_BYTES));
  clock.ms += 1000;
  other.receive(new Uint8Array(RELAY_BYTES_PER_SECOND));
  assert.equal(data.end.sent.length, 2);
  assert.equal(other.end.closed, false);
  other.receive(Uint8Array.of(1));
  assert.equal(data.end.sent.length, 2);
  assert.equal(other.end.closed, true);
});

test("Hub relay는 명단의 컴퓨터만 host로 받고, 대역을 넘겨도 닫지 않으며 받는 쪽이 밀리면 보내는 쪽을 기다리게 한다", () => {
  // 다시 볼 timer만 돌린다(열기·ping timer는 이 test가 보지 않는다).
  const timers = new Map<number, { run: () => void; ms: number }>();
  let next = 0;
  const drain = () => {
    for (const [id, t] of [...timers]) {
      if (t.ms > 100) continue;
      timers.delete(id);
      t.run();
    }
  };
  const ended: string[] = [];
  const mine = generateKeyPair(random);
  const relay = createRelay({
    random,
    timers: {
      set: (run, ms) => {
        timers.set(++next, { run, ms });
        return next;
      },
      clear: (id) => void timers.delete(id as number),
    },
    now: () => 0,
    owner: { allowsHost: (key) => key === remoteKeyText(mine.publicKey) },
    ended: (reason) => void ended.push(reason),
  });
  const hub = {
    accept: (url: string, socket: RelaySocket, ip = IP) =>
      relay.accept(url, socket, ip),
  };

  const stranger = memorySocket();
  hub.accept(
    path(relayHostUrl(RELAY, remoteKeyText(generateKeyPair(random).publicKey))),
    stranger.socket,
  );
  assert.equal(stranger.end.closed, true);
  assert.deepEqual(ended, ["host_not_allowed"]);

  const { host, key } = connectHost(hub, mine, mine.secretKey);
  const phone = memorySocket();
  hub.accept(path(relayPhoneUrl(RELAY, key)), phone.socket);
  const conn = host
    .control()
    .flatMap((f) => (f.type === "connected" ? [f.conn] : []))[0]!;
  const data = memorySocket();
  hub.accept(path(relayDataUrl(RELAY, conn)), data.socket);

  // 공개 relay라면 닫힐 양(한꺼번의 한도 두 번)을 넘겨도 짝은 그대로다.
  phone.receive(new Uint8Array(RELAY_BURST_BYTES));
  phone.receive(new Uint8Array(RELAY_BURST_BYTES));
  assert.equal(data.end.sent.length, 2);
  assert.equal(phone.end.closed, false);

  // 받는 쪽이 밀리면 넘긴 뒤 보내는 쪽을 멈추고, 비우면 다시 연다.
  data.end.buffered = RELAY_BUFFER_MAX_BYTES + 1;
  phone.receive(Uint8Array.of(1));
  assert.equal(data.end.sent.length, 3);
  assert.equal(phone.end.paused, true);
  drain();
  assert.equal(phone.end.paused, true);
  data.end.buffered = 0;
  drain();
  assert.equal(phone.end.paused, false);
  assert.equal(phone.end.closed, false);
  assert.deepEqual(ended, ["host_not_allowed"]);
});
