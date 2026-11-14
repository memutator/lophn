import assert from "node:assert/strict";
import { test } from "node:test";
import { type RandomSource, seededRandom } from "../../base/mod.ts";
import {
  acceptRemote,
  connectRemote,
  type RemoteServerChannel,
  type RemoteTransport,
} from "./channel.ts";
import type { RemoteClientFrame } from "./frames.ts";
import {
  generateKeyPair,
  initiatorHandshake,
  type KeyPair,
  responderHandshake,
} from "./noise.ts";

const hex = (text: string) =>
  Uint8Array.from(text.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const fixed = (bytes: Uint8Array): RandomSource => ({
  fill: (out) => out.set(bytes),
});
const keyOf = (secret: string): KeyPair => generateKeyPair(fixed(hex(secret)));

// cacophony vectors(haskell-cryptography/cacophony, vectors/cacophony.txt)의 Noise_IK_25519_ChaChaPoly_SHA256.
const VECTOR = {
  prologue: "4a6f686e2047616c74",
  initStatic:
    "e61ef9919cde45dd5f82166404bd08e38bceb5dfdfded0a34c8df7ed542214d1",
  initEphemeral:
    "893e28b9dc6ca8d611ab664754b8ceb7bac5117349a4439a6b0569da977c464a",
  respStatic:
    "4a3acbfdb163dec651dfa3194dece676d437029c62a408b4c5ea9114246e4893",
  respEphemeral:
    "bbdb4cdbd309f1a1f2e1456967fe288cadd6f712d65dc7b7793d5e63da6b375b",
  handshakeHash:
    "0b0f68fb0c27e03ce9b97565995ed4838cc0581b762ef72b062f6a546419fad7",
  messages: [
    [
      "4c756477696720766f6e204d69736573",
      "ca35def5ae56cec33dc2036731ab14896bc4c75dbb07a61f879f8e3afa4c7944718da798efbcd91528520204f904b9bd6c7413dccdc214d951e15253e39987f18146e8cd0873654207148333479d4d16c289f0294b29960a72f48e0b7bba2e89083169825e59642148d492020664ccf7",
    ],
    [
      "4d757272617920526f746862617264",
      "95ebc60d2b1fa672c1f46a8aa265ef51bfe38e7ccb39ec5be34069f1448088435361e70b2ed446e6c9ec387d1d6b3b840f194e373979d241b203c4acafccf5",
    ],
    [
      "462e20412e20486179656b",
      "050e9f3c8fac16b68dbce8f8c4bfbf6617c897f9ada4aa29aa19c8",
    ],
    [
      "4361726c204d656e676572",
      "344233a6cabb7141d80f3da2fedc311d9646bbb0f505afe403a667",
    ],
    [
      "4a65616e2d426170746973746520536179",
      "62cdeeb172ad7ade7aa7d9e069da5790f12331bfa00177787a1d0810c67dc3b2b4",
    ],
    [
      "457567656e2042f6686d20766f6e2042617765726b",
      "029bead1b40992327044d409d9a1f3ad8f36c3c452775d557e18bbeb2e8dfcead32d514024",
    ],
  ],
};

test("Noise IK가 공개된 test vector와 byte까지 같다", () => {
  const responderStatic = keyOf(VECTOR.respStatic);
  const initiator = initiatorHandshake({
    prologue: hex(VECTOR.prologue),
    staticKey: keyOf(VECTOR.initStatic),
    remoteStatic: responderStatic.publicKey,
    random: fixed(hex(VECTOR.initEphemeral)),
  });
  const responder = responderHandshake({
    prologue: hex(VECTOR.prologue),
    staticKey: responderStatic,
    random: fixed(hex(VECTOR.respEphemeral)),
  });
  const [m1, m2, ...rest] = VECTOR.messages;
  const message1 = initiator.writeMessage(hex(m1[0]));
  assert.equal(toHex(message1), m1[1]);
  assert.equal(toHex(responder.readMessage(message1).payload), m1[0]);
  const written = responder.writeMessage(hex(m2[0]));
  assert.equal(toHex(written.message), m2[1]);
  const read = initiator.readMessage(written.message);
  assert.equal(toHex(read.payload), m2[0]);
  assert.equal(toHex(read.transport.handshakeHash), VECTOR.handshakeHash);
  assert.deepEqual(
    written.transport.remoteStatic,
    keyOf(VECTOR.initStatic).publicKey,
  );
  // handshake 뒤에는 initiator와 responder가 번갈아 보낸다.
  rest.forEach(([payload, ciphertext], i) => {
    const [from, to] =
      i % 2 === 0
        ? [read.transport, written.transport]
        : [written.transport, read.transport];
    const sealed = from.send.encrypt(new Uint8Array(), hex(payload));
    assert.equal(toHex(sealed), ciphertext);
    assert.equal(toHex(to.receive.decrypt(new Uint8Array(), sealed)), payload);
  });
});

type Wire = {
  phone: RemoteTransport;
  core: RemoteTransport;
  // phone → core로 가는 bytes를 보내기 전에 바꾼다. 빈 배열은 버린다.
  tap: (fn: (bytes: Uint8Array) => Uint8Array[]) => void;
  closed: { phone: boolean; core: boolean };
};

// 메모리 안에서 양쪽을 잇는다. 실제 socket처럼 다음 microtask에 전한다.
function wire(): Wire {
  const handlers = {
    phone: { message: (_: Uint8Array) => {}, close: () => {} },
    core: { message: (_: Uint8Array) => {}, close: () => {} },
  };
  const closed = { phone: false, core: false };
  let tapFn = (bytes: Uint8Array) => [bytes];
  const end = (self: "phone" | "core", other: "phone" | "core") => ({
    send(bytes: Uint8Array) {
      const out = self === "phone" ? tapFn(bytes) : [bytes];
      for (const b of out) {
        queueMicrotask(() => {
          if (!closed[other]) handlers[other].message(b);
        });
      }
    },
    close() {
      if (closed[self]) return;
      closed[self] = true;
      queueMicrotask(() => {
        if (!closed[other]) {
          closed[other] = true;
          handlers[other].close();
        }
      });
    },
    onMessage(fn: (bytes: Uint8Array) => void) {
      handlers[self].message = fn;
    },
    onClose(fn: () => void) {
      handlers[self].close = fn;
    },
  });
  return {
    phone: end("phone", "core"),
    core: end("core", "phone"),
    tap: (fn) => {
      tapFn = fn;
    },
    closed,
  };
}

const random = seededRandom(7);
const coreKey = generateKeyPair(random);
const phoneKey = generateKeyPair(random);

async function pair(w: Wire, expectedCore = coreKey.publicKey) {
  const [phone, core] = await Promise.all([
    connectRemote({
      transport: w.phone,
      staticKey: phoneKey,
      remoteStatic: expectedCore,
      capabilities: [],
      random,
    }),
    acceptRemote({
      transport: w.core,
      staticKey: coreKey,
      capabilities: [],
      random,
    }),
  ]);
  return { phone, core };
}

function collect(channel: RemoteServerChannel) {
  const frames: RemoteClientFrame[] = [];
  let closed = false;
  channel.onFrame((frame) => frames.push(frame));
  channel.onClose(() => {
    closed = true;
  });
  return { frames, closed: () => closed };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const call = (id: string, body: unknown): RemoteClientFrame => ({
  type: "call",
  id,
  resource: "sessions",
  method: "list",
  body,
});

test("responder가 handshake에서 상대 공개 key를 받고, 큰 frame도 나눠 그대로 전한다", async () => {
  const w = wire();
  const { phone, core } = await pair(w);
  assert.ok(phone.ok && core.ok);
  assert.deepEqual(core.value.peer.publicKey, phoneKey.publicKey);
  assert.deepEqual(phone.value.peer.publicKey, coreKey.publicKey);
  const got = collect(core.value);
  const big = call("1", { text: "가".repeat(100_000) });
  assert.ok(phone.value.send(big).ok);
  assert.ok(phone.value.send(call("2", null)).ok);
  await settle();
  assert.deepEqual(got.frames, [big, call("2", null)]);
  assert.equal(got.closed(), false);
});

test("다른 key의 responder와는 handshake가 서지 않는다", async () => {
  const w = wire();
  const other = generateKeyPair(random);
  const { phone, core } = await pair(w, other.publicKey);
  assert.equal(phone.ok, false);
  assert.equal(core.ok, false);
  assert.deepEqual(w.closed, { phone: true, core: true });
});

test("record를 바꾸거나 빠뜨리거나 순서를 바꾸면 받는 쪽이 끊는다", async () => {
  const cases: Record<string, () => (bytes: Uint8Array) => Uint8Array[]> = {
    tampered: () => (bytes) => {
      const copy = bytes.slice();
      copy[copy.length - 20] ^= 1;
      return [copy];
    },
    dropped: () => {
      let n = 0;
      return (bytes) => (n++ === 0 ? [] : [bytes]);
    },
    reordered: () => {
      let held: Uint8Array | undefined;
      return (bytes) => {
        if (!held) {
          held = bytes;
          return [];
        }
        return [bytes, held];
      };
    },
  };
  for (const [name, make] of Object.entries(cases)) {
    const w = wire();
    const { phone, core } = await pair(w);
    assert.ok(phone.ok && core.ok, name);
    const got = collect(core.value);
    w.tap(make());
    phone.value.send(call("1", "a"));
    phone.value.send(call("2", "b"));
    await settle();
    assert.equal(got.closed(), true, name);
    assert.deepEqual(got.frames, [], name);
    assert.equal(w.closed.core, true, name);
  }
});
