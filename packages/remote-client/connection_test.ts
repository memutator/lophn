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
import { generateSigningKey } from "../protocol/remote/roster.ts";
import { createConnection, openFirst } from "./connection.ts";

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

// A computer's core tells the other computer who asked by the `by` of the call frame, and whether a failed call left the link decides
// if it may have run there: a call that left and lost its answer is not known, one that never left did not run.
test("a call carries its requester on the frame, and a failure of the link says whether the call left", async () => {
  const core = generateKeyPair(cryptoRandom);
  const frames: RemoteClientFrame[] = [];
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
      channels.push(opened.value);
      opened.value.onFrame((frame) => {
        frames.push(frame);
        if (frame.type === "watch") opened.value.send({ type: "ready" });
      });
    });
    return clientSide;
  };
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
    wait: () => () => {},
    onRevoked: () => {},
  });
  await settle();
  assert.equal(connection.current().state, "ready");

  const lost = connection.call({
    resource: "apps",
    method: "remote_call",
    body: {},
    by: { kind: "terminal" },
  });
  await settle();
  const call = frames.find((frame) => frame.type === "call");
  assert.deepEqual(call?.type === "call" && call.by, { kind: "terminal" });
  channels[0].close();
  const afterSend = await lost;
  assert.equal(afterSend.ok, false);
  assert.equal(afterSend.sent, true);

  await settle();
  const never = await connection.call({
    resource: "apps",
    method: "remote_call",
    body: {},
  });
  assert.equal(never.ok, false);
  assert.equal(never.sent, false);
  connection.close();
});

// Whether a failed call left decides whether it may have run on the other computer. A write that left and timed out must not read as
// never sent: the agent or app would retry it.
test("the sent flag is true for a call that timed out after leaving, false for one that waited in the queue or was refused by the channel", async () => {
  const core = generateKeyPair(cryptoRandom);
  const channels: RemoteServerChannel[] = [];
  const waits: { ms: number; fn: () => void }[] = [];
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
      channels.push(opened.value);
      opened.value.onFrame((frame) => {
        if (frame.type === "watch") opened.value.send({ type: "ready" });
      });
    });
    return clientSide;
  };
  const make = () =>
    createConnection({
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
      wait: (ms, fn) => {
        waits.push({ ms, fn });
        return () => {};
      },
      onRevoked: () => {},
    });
  const call = (connection: ReturnType<typeof make>, body: unknown = {}) =>
    connection.call({ resource: "apps", method: "remote_call", body });

  // Sent, then no answer in time.
  const timed = make();
  await settle();
  const waiting = call(timed);
  await settle();
  const deadline = waits.filter((one) => one.ms === 120_000).at(-1);
  assert.ok(deadline);
  deadline.fn();
  const late = await waiting;
  assert.equal(late.ok, false);
  assert.equal(late.sent, true);

  // The channel refuses the frame (too large): nothing left.
  const refused = await call(timed, { text: "x".repeat(17 * 1024 * 1024) });
  assert.equal(refused.ok, false);
  assert.equal(refused.sent, false);
  timed.close();

  // Eight calls fill the link; the ninth waits in the queue. When the link drops the eight may have run, the ninth never left.
  const crowded = make();
  await settle();
  const eight = Array.from({ length: 8 }, () => call(crowded));
  const ninth = call(crowded);
  await settle();
  channels.at(-1)?.close();
  assert.deepEqual(
    (await Promise.all(eight)).map((one) => one.sent),
    Array(8).fill(true),
  );
  assert.equal((await ninth).sent, false);
  crowded.close();
});

// Slow app commands (4 places, their own deadline) must not hold the screen's reads and the carry on the same link.
test("app commands wait in their own lane, so a full command lane leaves the screen's places free, and a call can set its own deadline", async () => {
  const core = generateKeyPair(cryptoRandom);
  const frames: RemoteClientFrame[] = [];
  const waits: { ms: number; fn: () => void }[] = [];
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
      opened.value.onFrame((frame) => {
        frames.push(frame);
        if (frame.type === "watch") opened.value.send({ type: "ready" });
      });
    });
    return clientSide;
  };
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
    wait: (ms, fn) => {
      waits.push({ ms, fn });
      return () => {};
    },
    onRevoked: () => {},
  });
  await settle();
  const sentCalls = () =>
    frames.filter((frame) => frame.type === "call").length;

  for (let i = 0; i < 5; i++) {
    void connection.call({
      resource: "apps",
      method: "remote_call",
      body: {},
      lane: "command",
      deadlineMs: 600_000,
    });
  }
  await settle();
  // The fifth command waits; the screen still sends all eight of its own.
  assert.equal(sentCalls(), 4);
  for (let i = 0; i < 8; i++) {
    void connection.call({ resource: "machines", method: "list", body: {} });
  }
  await settle();
  assert.equal(sentCalls(), 12);
  assert.equal(waits.filter((one) => one.ms === 600_000).length, 4);
  assert.equal(waits.filter((one) => one.ms === 120_000).length, 8);

  // Even when all 8 screen slots are full, terminals/input leaves immediately on the interactive lane.
  void connection.call({
    resource: "terminals",
    method: "input",
    body: { terminal: "trm_1", text: "a" },
  });
  await settle();
  assert.equal(sentCalls(), 13);
  connection.close();
});

test("openFirst tries direct addresses first, then hub relay before Fly fallback, and advertises signing_key in clientHello", async () => {
  const core = generateKeyPair(cryptoRandom);
  const phone = generateKeyPair(cryptoRandom);
  const phoneSigning = generateSigningKey(cryptoRandom);
  const signingText = remoteKeyText(phoneSigning.publicKey);
  const dialed: string[] = [];
  const seenSigningKeys: (string | undefined)[] = [];
  let hubUp = true;

  const dial = async (url: string) => {
    dialed.push(url);
    if (url.startsWith("ws://10.0.0.1:")) throw new Error("lan unreachable");
    if (url.includes("hub.test") && !hubUp) throw new Error("hub unreachable");
    const [clientSide, coreSide] = pipe();
    void acceptRemote({
      transport: coreSide,
      staticKey: core,
      capabilities: [],
      machine: MACHINE,
      random: cryptoRandom,
    }).then((opened) => {
      assert.ok(opened.ok);
      seenSigningKeys.push(opened.value.peer.signing_key);
    });
    return clientSide;
  };

  const endpoint = {
    addresses: ["10.0.0.1"],
    port: 7432,
    key: remoteKeyText(core.publicKey),
    relays: ["ws://hub.test:7432", "wss://fly.test"],
    machine: MACHINE.id,
  };
  const first = await openFirst(endpoint, {
    key: phone,
    dial,
    random: cryptoRandom,
    name: "Mina's phone",
    capabilities: [],
    signing_key: signingText,
  });
  assert.ok(first && "channel" in first);
  assert.equal(first.path, "relay");
  // Hub succeeded, so Fly fallback was never dialed.
  assert.deepEqual(
    dialed.map((u) => new URL(u).host),
    ["10.0.0.1:7432", "hub.test:7432"],
  );
  assert.deepEqual(seenSigningKeys, [signingText]);
  first.channel.close();

  // When hub is unreachable, openFirst falls back to Fly in order.
  dialed.length = 0;
  hubUp = false;
  const fallback = await openFirst(endpoint, {
    key: phone,
    dial,
    random: cryptoRandom,
    name: "Mina's phone",
    capabilities: [],
    signing_key: signingText,
  });
  assert.ok(fallback && "channel" in fallback);
  assert.equal(fallback.path, "relay");
  assert.deepEqual(
    dialed.map((u) => new URL(u).host),
    ["10.0.0.1:7432", "hub.test:7432", "fly.test"],
  );
  fallback.channel.close();
});

test("serverHello.machine.relays and hub are learnt automatically without re-pairing and used hub-first on reconnect", async () => {
  const core = generateKeyPair(cryptoRandom);
  const channels: RemoteServerChannel[] = [];
  const rounds: string[][] = [];
  let lanUp = true;

  const dial = async (url: string) => {
    rounds.at(-1)?.push(new URL(url).host);
    if (url.startsWith("ws://10.0.0.1:") && !lanUp) {
      throw new Error("lan unreachable");
    }
    const [clientSide, coreSide] = pipe();
    void acceptRemote({
      transport: coreSide,
      staticKey: core,
      capabilities: [],
      machine: {
        ...MACHINE,
        addresses: ["10.0.0.1"],
        hub: true,
        relays: ["ws://hub.test:7432", "wss://fly.test"],
      },
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
  const learnt: { hub?: boolean; relays?: string[] }[] = [];
  rounds.push([]);
  const connection = createConnection({
    // Already paired with only Fly relay before hub was enabled.
    endpoint: {
      addresses: ["10.0.0.1"],
      port: 7432,
      key: remoteKeyText(core.publicKey),
      relay: "wss://fly.test",
      machine: MACHINE.id,
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
    onPeer: (peer) => learnt.push({ hub: peer.hub, relays: peer.relays }),
  });

  await settle();
  assert.equal(connection.current().state, "ready");
  assert.deepEqual(learnt, [
    { hub: true, relays: ["ws://hub.test:7432", "wss://fly.test"] },
  ]);

  // Move off LAN: next reconnect automatically dials the learnt hub relay first without touching Fly.
  lanUp = false;
  channels[0]?.close();
  await settle();
  rounds.push([]);
  retries.at(-1)?.();
  await settle();
  assert.equal(connection.current().state, "ready");
  assert.equal(connection.path(), "relay");
  assert.deepEqual(rounds.at(-1), ["10.0.0.1:7432", "hub.test:7432"]);
  connection.close();
});
