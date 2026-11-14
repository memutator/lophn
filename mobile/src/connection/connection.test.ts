import assert from "node:assert/strict";
import { test } from "node:test";
import { cryptoRandom } from "../../../packages/base/mod.ts";
import {
  acceptRemote,
  type RemoteServerChannel,
} from "../../../packages/protocol/remote/channel.ts";
import type { RemoteClientFrame } from "../../../packages/protocol/remote/frames.ts";
import {
  generateKeyPair,
  type RemoteTransport,
  remoteKeyText,
} from "../remote.ts";
import { createConnection } from "./connection.ts";

// Two in-memory transports wired to each other. Delivery is async like a socket.
function pipe(): [RemoteTransport, RemoteTransport] {
  const make = () => ({
    message: (_: Uint8Array) => {},
    close: () => {},
    closed: false,
  });
  const a = make();
  const b = make();
  const side = (self: typeof a, other: typeof a): RemoteTransport => ({
    send: (bytes) =>
      queueMicrotask(() => {
        if (!other.closed) other.message(bytes);
      }),
    close: () => {
      if (self.closed) return;
      self.closed = true;
      other.closed = true;
      queueMicrotask(() => {
        self.close();
        other.close();
      });
    },
    onMessage: (fn) => {
      self.message = fn;
    },
    onClose: (fn) => {
      self.close = fn;
    },
  });
  return [side(a, b), side(b, a)];
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test("after a drop or a dead resume the connection reconnects and sends the last watch again", async () => {
  const core = generateKeyPair(cryptoRandom);
  const servers: {
    channel: RemoteServerChannel;
    frames: RemoteClientFrame[];
    answer: boolean;
  }[] = [];
  const dial = async () => {
    const [phoneSide, coreSide] = pipe();
    void acceptRemote({
      transport: coreSide,
      staticKey: core,
      capabilities: [],
      random: cryptoRandom,
    }).then((opened) => {
      assert.ok(opened.ok);
      const server = {
        channel: opened.value,
        frames: [] as RemoteClientFrame[],
        answer: true,
      };
      servers.push(server);
      opened.value.onFrame((frame) => {
        server.frames.push(frame);
        if (frame.type === "watch" && server.answer) {
          opened.value.send({ type: "ready" });
        }
      });
    });
    return phoneSide;
  };
  const retries: (() => void)[] = [];
  const connection = createConnection({
    endpoint: {
      addresses: ["10.0.0.1"],
      port: 7432,
      key: remoteKeyText(core.publicKey),
    },
    phone: generateKeyPair(cryptoRandom),
    dial,
    random: cryptoRandom,
    now: () => 1,
    wait: (_ms, fn) => {
      retries.push(fn);
      return () => {};
    },
    onRevoked: () => {},
  });
  const conditions = [{ session: "ses_01m7dp1jqw47d55vdyzxv5wd0x" }];
  await settle();
  assert.equal(connection.current().state, "ready");
  await connection.watch(conditions);
  await settle();

  servers[0]?.channel.close();
  await settle();
  assert.equal(connection.current().state, "stale");
  assert.equal(retries.length, 1);
  retries[0]?.();
  await settle();

  assert.equal(servers.length, 2);
  assert.deepEqual(servers[1]?.frames, [{ type: "watch", conditions }]);
  assert.equal(connection.current().state, "ready");

  // Back from the background on a socket that no longer answers: connect again without a backoff.
  if (servers[1]) servers[1].answer = false;
  connection.resume();
  await settle();
  retries.at(-1)?.();
  await settle();
  assert.equal(servers.length, 3);
  assert.deepEqual(servers[2]?.frames, [{ type: "watch", conditions }]);
  assert.equal(connection.current().state, "ready");
  connection.close();
});
