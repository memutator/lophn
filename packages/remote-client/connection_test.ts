import assert from "node:assert/strict";
import { test } from "node:test";
import { cryptoRandom } from "../base/mod.ts";
import type { Id } from "../protocol/base/ids.ts";
import {
  acceptRemote,
  type RemoteServerChannel,
} from "../protocol/remote/channel.ts";
import type { RemoteClientFrame } from "../protocol/remote/frames.ts";
import {
  generateKeyPair,
  type RemoteTransport,
  remoteKeyText,
} from "../protocol/remote/client.ts";
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

const MACHINE = {
  id: "mch_01m7dp1jqw47d55vdyzxv5wd0x" as const,
  name: "mina-desktop",
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test("after a drop or a dead resume the connection reconnects and sends the last watch again", async () => {
  const core = generateKeyPair(cryptoRandom);
  const servers: {
    channel: RemoteServerChannel;
    frames: RemoteClientFrame[];
    answer: boolean;
  }[] = [];
  // The relay is down here: the direct address alone must keep the connection going.
  const dial = async (url: string) => {
    if (url.startsWith("wss://")) throw new Error("relay unreachable");
    const [clientSide, coreSide] = pipe();
    void acceptRemote({
      transport: coreSide,
      staticKey: core,
      capabilities: [],
      machine: MACHINE,
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
    return clientSide;
  };
  const retries: (() => void)[] = [];
  const connection = createConnection({
    endpoint: {
      addresses: ["10.0.0.1"],
      port: 7432,
      key: remoteKeyText(core.publicKey),
      relay: "wss://relay.test",
    },
    key: generateKeyPair(cryptoRandom),
    capabilities: [],
    dial,
    random: cryptoRandom,
    now: () => 1,
    wait: (_ms, fn) => {
      retries.push(fn);
      return () => {};
    },
    onRevoked: () => {},
    onPeer: () => {},
    name: "Mina's phone",
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

test("a watch with a session id the core would reject sends no such condition, and the connection comes back after the core closes it", async () => {
  const core = generateKeyPair(cryptoRandom);
  const servers: {
    channel: RemoteServerChannel;
    frames: RemoteClientFrame[];
  }[] = [];
  const dial = async () => {
    const [clientSide, coreSide] = pipe();
    void acceptRemote({
      transport: coreSide,
      staticKey: core,
      capabilities: [],
      machine: MACHINE,
      random: cryptoRandom,
    }).then((opened) => {
      assert.ok(opened.ok);
      const server = {
        channel: opened.value,
        frames: [] as RemoteClientFrame[],
      };
      servers.push(server);
      opened.value.onFrame((frame) => {
        server.frames.push(frame);
        if (frame.type === "watch") opened.value.send({ type: "ready" });
      });
    });
    return clientSide;
  };
  const retries: (() => void)[] = [];
  const connection = createConnection({
    endpoint: {
      addresses: ["10.0.0.1"],
      port: 7432,
      key: remoteKeyText(core.publicKey),
    },
    key: generateKeyPair(cryptoRandom),
    capabilities: [],
    dial,
    random: cryptoRandom,
    now: () => 1,
    wait: (_ms, fn) => {
      retries.push(fn);
      return () => {};
    },
    onRevoked: () => {},
    onPeer: () => {},
    name: "Mina's phone",
  });
  await settle();
  const good = { session: "ses_01m7dp1jqw47d55vdyzxv5wd0x" };
  await connection.watch([good, { session: "" }]);
  await settle();
  // The core parses every frame with this schema and closes the channel on one it cannot read.
  assert.deepEqual(servers[0]?.frames.at(-1), {
    type: "watch",
    conditions: [good],
  });
  assert.equal(connection.current().state, "ready");

  servers[0]?.channel.close();
  await settle();
  retries.at(-1)?.();
  await settle();
  assert.equal(servers.length, 2);
  assert.deepEqual(servers[1]?.frames, [{ type: "watch", conditions: [good] }]);
  assert.equal(connection.current().state, "ready");
  connection.close();
});

test("a computer is known by the machine id in its hello: the first one is reported, another machine behind the same key gets no frame", async () => {
  const core = generateKeyPair(cryptoRandom);
  const frames: RemoteClientFrame[] = [];
  const hellos: string[] = [];
  const channels: RemoteServerChannel[] = [];
  let answering: { id: `mch_${string}`; name: string } = MACHINE;
  const dial = async () => {
    const [clientSide, coreSide] = pipe();
    void acceptRemote({
      transport: coreSide,
      staticKey: core,
      capabilities: [],
      machine: answering,
      random: cryptoRandom,
    }).then((opened) => {
      assert.ok(opened.ok);
      hellos.push(opened.value.peer.name);
      channels.push(opened.value);
      opened.value.onFrame((frame) => {
        frames.push(frame);
        if (frame.type === "watch") opened.value.send({ type: "ready" });
      });
    });
    return clientSide;
  };
  const retries: (() => void)[] = [];
  const met: string[] = [];
  const connection = createConnection({
    // No id saved: an entry paired before computers announced one.
    endpoint: {
      addresses: ["10.0.0.1"],
      port: 7432,
      key: remoteKeyText(core.publicKey),
    },
    key: generateKeyPair(cryptoRandom),
    capabilities: [],
    dial,
    random: cryptoRandom,
    name: "Mina's phone",
    now: () => 1,
    wait: (_ms, fn) => {
      retries.push(fn);
      return () => {};
    },
    onRevoked: () => {},
    onPeer: (machine) => met.push(`${machine.id} ${machine.name}`),
  });
  await settle();
  assert.equal(connection.current().state, "ready");
  assert.deepEqual(met, [`${MACHINE.id} ${MACHINE.name}`]);
  assert.deepEqual(hellos, ["Mina's phone"]);
  assert.equal(frames.length, 1);

  // The data root was copied: the same key now answers as another machine.
  answering = { id: "mch_01m7dp1jqw47d55vdyzxv5wd0y", name: "copy" };
  channels[0]?.close();
  await settle();
  retries.at(-1)?.();
  await settle();
  assert.equal(hellos.length, 2);
  assert.equal(connection.current().state, "stale");
  assert.equal(met.length, 1);
  assert.equal(frames.length, 1);
  connection.close();
});

test("a saved machine id is checked before anything is sent: another machine behind the key gets no watch and no call, the saved one gets the watch", async () => {
  const core = generateKeyPair(cryptoRandom);
  const frames: RemoteClientFrame[] = [];
  const channels: RemoteServerChannel[] = [];
  let answering: { id: Id<"mch">; name: string } = {
    id: "mch_01m7dp1jqw47d55vdyzxv5wd0y",
    name: "copy",
  };
  const dial = async () => {
    const [clientSide, coreSide] = pipe();
    void acceptRemote({
      transport: coreSide,
      staticKey: core,
      capabilities: [],
      machine: answering,
      random: cryptoRandom,
    }).then((opened) => {
      assert.ok(opened.ok);
      channels.push(opened.value);
      opened.value.onFrame((frame) => {
        frames.push(frame);
        if (frame.type === "watch") opened.value.send({ type: "ready" });
      });
    });
    return clientSide;
  };
  const retries: (() => void)[] = [];
  const met: string[] = [];
  const connection = createConnection({
    endpoint: {
      addresses: ["10.0.0.1"],
      port: 7432,
      key: remoteKeyText(core.publicKey),
      machine: MACHINE.id,
    },
    key: generateKeyPair(cryptoRandom),
    capabilities: [],
    dial,
    random: cryptoRandom,
    name: "Mina's laptop",
    now: () => 1,
    wait: (_ms, fn) => {
      retries.push(fn);
      return () => {};
    },
    onRevoked: () => {},
    onPeer: (machine) => met.push(machine.id),
  });
  await settle();
  // The copy finished the handshake and its hello, and heard nothing after it.
  assert.equal(channels.length, 1);
  assert.equal(connection.current().state, "stale");
  const reply = await connection.call({
    resource: "sessions",
    method: "list",
    body: {},
  });
  assert.equal(reply.ok, false);
  await settle();
  assert.deepEqual(frames, []);
  assert.deepEqual(met, []);

  answering = MACHINE;
  retries.at(-1)?.();
  await settle();
  assert.equal(channels.length, 2);
  assert.deepEqual(frames, [{ type: "watch", conditions: [] }]);
  assert.deepEqual(met, [MACHINE.id]);
  assert.equal(connection.current().state, "ready");
  connection.close();
});

test("the addresses a device dials change only through a channel that checked the saved machine id", async () => {
  const core = generateKeyPair(cryptoRandom);
  const channels: RemoteServerChannel[] = [];
  let answering: {
    id: Id<"mch">;
    name: string;
    addresses: string[];
  } = { ...MACHINE, addresses: ["100.64.0.5"] };
  let unreachable = new Set<string>();
  const rounds: string[][] = [];
  const dial = async (url: string) => {
    const host = new URL(url).hostname;
    rounds.at(-1)?.push(host);
    if (unreachable.has(host)) throw new Error("unreachable");
    const [clientSide, coreSide] = pipe();
    void acceptRemote({
      transport: coreSide,
      staticKey: core,
      capabilities: [],
      machine: answering,
      random: cryptoRandom,
    }).then((opened) => {
      assert.ok(opened.ok);
      channels.push(opened.value);
      opened.value.onFrame((frame) => {
        if (frame.type === "watch") opened.value.send({ type: "ready" });
      });
    });
    return clientSide;
  };
  const retries: (() => void)[] = [];
  const met: (string[] | undefined)[] = [];
  const again = async () => {
    for (const channel of channels.splice(0)) channel.close();
    await settle();
    rounds.push([]);
    retries.at(-1)?.();
    await settle();
  };
  rounds.push([]);
  const connection = createConnection({
    // No id saved yet: the first channel has nothing to check its hello against.
    endpoint: {
      addresses: ["10.0.0.1"],
      port: 7432,
      key: remoteKeyText(core.publicKey),
    },
    key: generateKeyPair(cryptoRandom),
    capabilities: [],
    dial,
    random: cryptoRandom,
    name: "Mina's phone",
    now: () => 1,
    wait: (_ms, fn) => {
      retries.push(fn);
      return () => {};
    },
    onRevoked: () => {},
    onPeer: (machine) => met.push(machine.addresses),
  });
  await settle();
  assert.equal(connection.current().state, "ready");
  assert.deepEqual(met, [undefined]);

  // The id is known now: this channel checks it and takes the computer's list, keeping the address it opened on.
  await again();
  assert.deepEqual(rounds.at(-1), ["10.0.0.1"]);
  assert.deepEqual(met.at(-1), ["10.0.0.1", "100.64.0.5"]);

  // A copied data root answers with the same key and another machine id: its addresses are not taken.
  answering = {
    id: "mch_01m7dp1jqw47d55vdyzxv5wd0y",
    name: "copy",
    addresses: ["203.0.113.9"],
  };
  await again();
  assert.equal(connection.current().state, "stale");
  assert.equal(met.length, 2);

  // The computer moved: only its new address answers, and its list replaces the old one.
  answering = { ...MACHINE, addresses: ["100.64.0.5"] };
  unreachable = new Set(["10.0.0.1"]);
  rounds.push([]);
  retries.at(-1)?.();
  await settle();
  assert.deepEqual(rounds.at(-1), ["10.0.0.1", "100.64.0.5"]);
  assert.equal(connection.current().state, "ready");
  assert.deepEqual(met.at(-1), ["100.64.0.5"]);
  await again();
  assert.deepEqual(rounds.at(-1), ["100.64.0.5"]);
  connection.close();
});

test("with join every channel opens with it and the watch follows its answer; a refused join stops the link and hands over the removal", async () => {
  const core = generateKeyPair(cryptoRandom);
  const frames: RemoteClientFrame[][] = [];
  const signing = remoteKeyText(generateKeyPair(cryptoRandom).publicKey);
  const removal = {
    body: {
      type: "removal" as const,
      id: "dev_01m7dp1jqw47d55vdyzxv5wd90",
      key: signing,
      signing_key: null,
      at: "2026-11-18T00:00:00.000Z",
    },
    by: "dev_01m7dp1jqw47d55vdyzxv5wd10",
    signature: `${"A".repeat(85)}A`,
  };
  let refuse = false;
  const channels: RemoteServerChannel[] = [];
  const dial = async () => {
    const [clientSide, coreSide] = pipe();
    void acceptRemote({
      transport: coreSide,
      staticKey: core,
      capabilities: [],
      machine: MACHINE,
      random: cryptoRandom,
    }).then((opened) => {
      assert.ok(opened.ok);
      const mine: RemoteClientFrame[] = [];
      frames.push(mine);
      channels.push(opened.value);
      opened.value.onFrame((frame) => {
        mine.push(frame);
        if (frame.type === "join") {
          opened.value.send(
            refuse
              ? {
                  type: "result",
                  id: frame.id,
                  ok: false,
                  error: {
                    code: "unauthorized",
                    message: "removed",
                    details: { reason: "removed", removal },
                  },
                }
              : {
                  type: "result",
                  id: frame.id,
                  ok: true,
                  value: {
                    device: "dev_01m7dp1jqw47d55vdyzxv5wd90",
                    computer: {
                      id: "dev_01m7dp1jqw47d55vdyzxv5wd10",
                      signing_key: signing,
                    },
                    roster: { statements: [], reach: [] },
                  },
                },
          );
        }
        if (frame.type === "watch") opened.value.send({ type: "ready" });
      });
    });
    return clientSide;
  };
  const retries: (() => void)[] = [];
  const rosters: unknown[] = [];
  const revoked: unknown[] = [];
  const connection = createConnection({
    endpoint: {
      addresses: ["10.0.0.1"],
      port: 7432,
      key: remoteKeyText(core.publicKey),
    },
    key: generateKeyPair(cryptoRandom),
    capabilities: [],
    dial,
    random: cryptoRandom,
    name: "Mina's phone",
    now: () => 1,
    wait: (_ms, fn) => {
      retries.push(fn);
      return () => {};
    },
    onRevoked: (one) => revoked.push(one),
    join: () => [],
    onRoster: (_roster, joined) => rosters.push(joined?.computer.signing_key),
  });
  await settle();
  assert.deepEqual(
    frames[0]?.map((frame) => frame.type),
    ["join", "watch"],
  );
  assert.deepEqual(rosters, [signing]);
  assert.equal(connection.current().state, "ready");

  // The phone was taken off the roster while the channel was down.
  refuse = true;
  channels[0]?.close();
  await settle();
  const scheduled = retries.length;
  retries.at(-1)?.();
  await settle();
  assert.deepEqual(
    frames[1]?.map((frame) => frame.type),
    ["join"],
  );
  assert.deepEqual(revoked, [removal]);
  assert.equal(connection.current().state, "stale");
  assert.equal(retries.length, scheduled);
  connection.close();
});
