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
import { createRelay, type RelaySocket } from "./relay.ts";

// relay 쪽 socket 하나와 그 상대 끝. 상대가 보낸 것은 receive, relay가 보낸 것은 sent에 쌓인다.
function memorySocket() {
  const sent: (Uint8Array | string)[] = [];
  const handlers: {
    message?: (data: Uint8Array | string) => void;
    close?: () => void;
  } = {};
  const end = { sent, closed: false };
  const socket: RelaySocket = {
    send: (data) => void sent.push(data),
    ping: () => undefined,
    close() {
      if (end.closed) return;
      end.closed = true;
      handlers.close?.();
    },
    onMessage: (handler) => void (handlers.message = handler),
    onPong: () => undefined,
    onClose: (handler) => void (handlers.close = handler),
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

function setup() {
  return createRelay({
    random,
    timers: { set: () => undefined, clear: () => undefined },
  });
}

// core가 control socket을 걸고 challenge에 proof를 답한다. secret이 core key의 것이 아니면 틀린 증명이다.
function connectHost(
  relay: ReturnType<typeof setup>,
  core: KeyPair,
  proofSecret: Uint8Array | undefined,
) {
  const host = memorySocket();
  const key = remoteKeyText(core.publicKey);
  relay.accept(path(relayHostUrl(RELAY, key)), host.socket);
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
});
