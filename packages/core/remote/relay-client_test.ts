import assert from "node:assert/strict";
import { test } from "node:test";
import { seededRandom } from "../../base/mod.ts";
import {
  generateKeyPair,
  relayDataUrl,
  relayHostUrl,
  relayProof,
  remoteKeyText,
} from "../../protocol/remote/mod.ts";
import type { RemoteSocket } from "./host.ts";
import { type RelaySocket, startRelayClient } from "./relay-client.ts";

type MemorySocket = RelaySocket & {
  url: string;
  sent: (string | Uint8Array)[];
  closed: boolean;
  text(value: unknown): void;
  binary(bytes: Uint8Array): void;
  drop(): void;
};

function memorySocket(url: string): MemorySocket {
  const texts: ((text: string) => void)[] = [];
  const binaries: ((bytes: Uint8Array) => void)[] = [];
  const closes: (() => void)[] = [];
  const socket: MemorySocket = {
    url,
    sent: [],
    closed: false,
    send: (data) => void socket.sent.push(data),
    close: () => socket.drop(),
    onText: (handler) => void texts.push(handler),
    onBinary: (handler) => void binaries.push(handler),
    onClose: (handler) => void closes.push(handler),
    bufferedAmount: () => 0,
    text: (value) => {
      for (const each of texts) each(JSON.stringify(value));
    },
    binary: (bytes) => {
      for (const each of binaries) each(bytes);
    },
    drop() {
      if (socket.closed) return;
      socket.closed = true;
      for (const each of closes) each();
    },
  };
  return socket;
}

function manualTimers() {
  const pending = new Map<number, { run: () => void; ms: number }>();
  let next = 0;
  return {
    pending,
    set(run: () => void, ms: number) {
      next += 1;
      pending.set(next, { run, ms });
      return next;
    },
    clear(handle: unknown) {
      pending.delete(handle as number);
    },
    fire() {
      const [[id, timer]] = [...pending];
      pending.delete(id);
      timer.run();
      return timer.ms;
    },
  };
}

test("relay client proves the core key, hands each phone connection to the host and reconnects", () => {
  const random = seededRandom(7);
  const core = generateKeyPair(random);
  const relayKey = generateKeyPair(random);
  const coreKey = remoteKeyText(core.publicKey);
  const opened: MemorySocket[] = [];
  const accepted: RemoteSocket[] = [];
  const timers = manualTimers();
  const relay = "ws://relay.test";
  const client = startRelayClient({
    url: relay,
    staticKey: core,
    open(url) {
      const socket = memorySocket(url);
      opened.push(socket);
      return socket;
    },
    timers,
    accept: (socket) => void accepted.push(socket),
  });

  const control = opened[0];
  assert.equal(control.url, relayHostUrl(relay, coreKey));
  assert.equal(client.state(), "connecting");
  const nonce = remoteKeyText(new Uint8Array(32).fill(9));
  control.text({
    type: "challenge",
    relay_key: remoteKeyText(relayKey.publicKey),
    nonce,
  });
  // relay는 자기 임시 secret과 core 공개 key로 같은 mac을 얻는다.
  assert.deepEqual(JSON.parse(String(control.sent[0])), {
    type: "proof",
    mac: relayProof(relayKey.secretKey, coreKey, nonce),
  });
  control.text({ type: "ready" });
  assert.equal(client.state(), "connected");

  const conn = "a".repeat(22);
  control.text({ type: "connected", conn });
  const data = opened[1];
  assert.equal(data.url, relayDataUrl(relay, conn));
  const received: Uint8Array[] = [];
  accepted[0].onMessage((bytes) => received.push(bytes));
  data.binary(Uint8Array.of(1, 2));
  accepted[0].send(Uint8Array.of(3));
  assert.deepEqual(received, [Uint8Array.of(1, 2)]);
  assert.deepEqual(data.sent, [Uint8Array.of(3)]);

  // 끊기면 1초, 2초… 뒤 다시 건다.
  control.drop();
  assert.equal(client.state(), "connecting");
  assert.equal(timers.fire(), 1_000);
  assert.equal(opened[2].url, relayHostUrl(relay, coreKey));
  opened[2].drop();
  assert.equal(timers.fire(), 2_000);

  client.close();
  assert.equal(opened[3].closed, true);
  assert.equal(data.closed, true);
  assert.equal(timers.pending.size, 0);
});
