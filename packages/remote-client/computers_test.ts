import assert from "node:assert/strict";
import { test } from "node:test";
import { cryptoRandom } from "../base/mod.ts";
import {
  generateKeyPair,
  remoteKeyText,
  type RosterEntryBody,
  type RosterSnapshot,
  type RosterStatement,
  signRoster,
} from "../protocol/remote/client.ts";
import {
  generateSigningKey,
  type RosterRemovalBody,
} from "../protocol/remote/roster.ts";
import {
  type Computer,
  type ComputersDeps,
  createComputers,
  type Link,
  sampleFor,
} from "./computers.ts";

type Machine = {
  id: string;
  host: string;
  signing: ReturnType<typeof generateSigningKey>;
  machine: `mch_${string}`;
  name: string;
};

function machine(n: number, name: string): Machine {
  return {
    id: `dev_01m7dp1jqw47d55vdyzxv5wd${n}0`,
    host: remoteKeyText(generateKeyPair(cryptoRandom).publicKey),
    signing: generateSigningKey(cryptoRandom),
    machine: `mch_01m7dp1jqw47d55vdyzxv5wd${n}0`,
    name,
  };
}

const signingOf = (m: Machine) => remoteKeyText(m.signing.publicKey);

const entryOf = (m: Machine): RosterEntryBody => ({
  type: "entry",
  id: m.id,
  kind: "computer",
  key: m.host,
  signing_key: signingOf(m),
  machine: m.machine,
  name: m.name,
  os: "linux",
  rev: 1,
  invite: null,
});

const signed = (
  body: RosterEntryBody | RosterRemovalBody,
  by: Machine,
): RosterStatement => ({
  body,
  by: by.id,
  signature: signRoster(body, by.signing.secretKey),
});

const reachOf = (m: Machine) => ({
  device: m.id,
  addresses: ["10.0.0.9"],
  port: 7432,
  relay: null,
});

const saved = (m: Machine, signing = true): Computer => ({
  addresses: ["10.0.0.1"],
  port: 7432,
  key: m.host,
  machine: m.machine,
  ...(signing ? { signing_key: signingOf(m) } : {}),
});

type On = Parameters<ComputersDeps<null>["open"]>[2];

function harness(start: {
  computers: Computer[];
  roster?: RosterSnapshot;
  phone?: ReturnType<typeof generateKeyPair>;
}) {
  const phone = start.phone ?? generateKeyPair(cryptoRandom);
  const opened: { key: string; closed: boolean; on: On }[] = [];
  const saves: { computers: Computer[]; roster: RosterSnapshot }[] = [];
  let forgotten = 0;
  const link = (record: { closed: boolean }): Link<null> => ({
    data: null,
    state: () => ({
      status: "connected",
      update: null,
      path: "direct",
      waiting: 0,
    }),
    subscribe: () => () => {},
    pause() {},
    resume() {},
    close() {
      record.closed = true;
    },
  });
  const deps: ComputersDeps<null> = {
    load: async () => ({
      key: phone,
      computers: start.computers,
      roster: start.roster ?? { statements: [], reach: [] },
      name: "Mina's phone",
    }),
    saveName: async (name) => name,
    save: async (next) => {
      saves.push(next);
    },
    forgetKey: async () => {
      forgotten += 1;
      return generateKeyPair(cryptoRandom);
    },
    now: () => Date.parse("2026-11-18T00:00:00.000Z"),
    open(one, _key, on) {
      const record = { key: one.key, closed: false, on };
      opened.push(record);
      return link(record);
    },
    join: async () => ({ ok: false, failure: { kind: "unreachable" } }),
  };
  return { deps, opened, saves, link, phone, forgotten: () => forgotten };
}

test("a refusal this phone's roots cannot check leaves its computers and key; a removal they trust forgets both", async () => {
  const a = machine(1, "mina-desktop");
  const stranger = machine(2, "elsewhere");
  const phone = generateKeyPair(cryptoRandom);
  const phoneEntry: RosterEntryBody = {
    type: "entry",
    id: "dev_01m7dp1jqw47d55vdyzxv5wd90",
    kind: "phone",
    key: remoteKeyText(phone.publicKey),
    signing_key: null,
    machine: null,
    name: "Mina's phone",
    os: "android",
    rev: 1,
    invite: null,
  };
  const roster: RosterSnapshot = {
    statements: [signed(entryOf(a), a), signed(phoneEntry, a)],
    reach: [],
  };
  const removal: RosterRemovalBody = {
    type: "removal",
    id: phoneEntry.id,
    key: phoneEntry.key,
    signing_key: null,
    at: "2026-11-18T00:00:00.000Z",
  };
  const cases: {
    name: string;
    refuse: (on: On) => void;
    forgets: boolean;
  }[] = [
    { name: "no removal", refuse: (on) => on.onRevoked(), forgets: false },
    {
      name: "a removal signed by a computer no root trusts",
      refuse: (on) => on.onRevoked(signed(removal, stranger)),
      forgets: false,
    },
    {
      name: "a removal signed by the computer it saved",
      refuse: (on) => on.onRevoked(signed(removal, a)),
      forgets: true,
    },
    {
      name: "the same removal in a roster the computer pushed",
      refuse: (on) =>
        on.onRoster({ statements: [signed(removal, a)], reach: [] }),
      forgets: true,
    },
  ];
  for (const one of cases) {
    const { deps, opened, saves, forgotten } = harness({
      computers: [saved(a)],
      roster,
      phone,
    });
    const store = createComputers(deps);
    await store.start();
    assert.equal(store.get().device, phoneEntry.id, one.name);
    const on = opened[0]?.on;
    assert.ok(on, one.name);
    one.refuse(on);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(opened[0]?.closed, true, one.name);
    assert.equal(forgotten(), one.forgets ? 1 : 0, one.name);
    assert.deepEqual(
      store.get().computers.map((c) => [c.key, c.status]),
      one.forgets ? [] : [[a.host, "revoked"]],
      one.name,
    );
    assert.deepEqual(
      saves.at(-1)?.computers.map((c) => c.key),
      one.forgets ? [] : [a.host],
      one.name,
    );
    assert.equal(
      saves.at(-1)?.roster.statements.length === 0,
      one.forgets,
      one.name,
    );
  }
});

test("a computer paired before the roster learns its signing key only from its join answer, then the other computers it lists appear and leave with the roster", async () => {
  const a = machine(1, "mina-desktop");
  const b = machine(2, "mina-laptop");
  const { deps, opened, saves } = harness({ computers: [saved(a, false)] });
  const store = createComputers(deps);
  await store.start();
  const fromA = opened[0]?.on;
  assert.ok(fromA);
  const roster: RosterSnapshot = {
    statements: [
      signed(entryOf(a), a),
      signed(entryOf(b), a),
      signed(entryOf(b), b),
    ],
    reach: [reachOf(b)],
  };

  // A roster that only claims A's host key is not a root.
  fromA.onRoster(roster);
  assert.deepEqual(
    store.get().computers.map((c) => c.key),
    [a.host],
  );

  fromA.onRoster(roster, {
    device: "dev_01m7dp1jqw47d55vdyzxv5wd90",
    computer: { id: a.id, signing_key: signingOf(a) },
  });
  assert.deepEqual(
    store.get().computers.map((c) => [c.key, c.name]),
    [
      [a.host, "mina-desktop"],
      [b.host, "mina-laptop"],
    ],
  );
  assert.deepEqual(
    opened.map((one) => one.key),
    [a.host, b.host],
  );
  assert.deepEqual(saves.at(-1)?.computers[1], {
    addresses: ["10.0.0.9"],
    port: 7432,
    key: b.host,
    machine: b.machine,
    signing_key: signingOf(b),
    announced: "mina-laptop",
  });

  const removal: RosterRemovalBody = {
    type: "removal",
    id: b.id,
    key: b.host,
    signing_key: signingOf(b),
    at: "2026-11-18T00:00:00.000Z",
  };
  fromA.onRoster({ statements: [signed(removal, a)], reach: [] });
  assert.deepEqual(
    store.get().computers.map((c) => c.key),
    [a.host],
  );
  assert.equal(opened[1]?.closed, true);
});

test("the sample computer is listed first in a dev build with the flag, and nowhere else", async () => {
  const a = machine(1, "mina-desktop");
  const { deps, link } = harness({ computers: [saved(a)] });
  const make = () => ({
    key: "sample",
    name: "mina-desktop",
    link: link({ closed: false }),
  });
  const listed = async (env: { dev: boolean; flag: string | undefined }) => {
    const store = createComputers({ ...deps, sample: sampleFor(env, make) });
    await store.start();
    return store.get().computers.map((one) => one.key);
  };
  assert.deepEqual(await listed({ dev: true, flag: "1" }), ["sample", a.host]);
  assert.deepEqual(await listed({ dev: false, flag: "1" }), [a.host]);
  assert.deepEqual(await listed({ dev: true, flag: undefined }), [a.host]);
});

test("already-paired computers learn hub and ordered relays from serverHello and roster reach without re-pairing", async () => {
  const hub = machine(1, "vm-hub");
  const desktop = machine(2, "mina-desktop");
  const opened: {
    computer: Computer;
    status: "connected" | "offline";
    closed: boolean;
    on: On;
  }[] = [];
  const saves: { computers: Computer[]; roster: RosterSnapshot }[] = [];
  const phone = generateKeyPair(cryptoRandom);
  const phoneSigning = generateSigningKey(cryptoRandom);
  const passedSigningKeys: (string | undefined)[] = [];

  const deps: ComputersDeps<null> = {
    load: async () => ({
      key: phone,
      signingKey: phoneSigning,
      computers: [
        { ...saved(hub), relay: "wss://fly.test" },
        { ...saved(desktop), relay: "wss://fly.test" },
      ],
      roster: {
        statements: [signed(entryOf(hub), hub), signed(entryOf(desktop), hub)],
        reach: [],
      },
      name: "Mina's phone",
    }),
    saveName: async (name) => name,
    save: async (next) => {
      saves.push(next);
    },
    forgetKey: async () => generateKeyPair(cryptoRandom),
    forgetSigningKey: async () => generateSigningKey(cryptoRandom),
    now: () => Date.parse("2026-11-26T00:00:00.000Z"),
    open(one, _key, on) {
      passedSigningKeys.push(
        on.signingKey ? remoteKeyText(on.signingKey.publicKey) : undefined,
      );
      const record = {
        computer: one,
        status: (one.key === hub.host ? "connected" : "offline") as
          | "connected"
          | "offline",
        closed: false,
        on,
      };
      opened.push(record);
      return {
        data: null,
        state: () => ({
          status: record.status,
          update: null,
          path: record.status === "connected" ? "direct" : null,
          waiting: 0,
        }),
        subscribe: () => () => {},
        pause() {},
        resume() {},
        close() {
          record.closed = true;
        },
      };
    },
    join: async () => ({ ok: false, failure: { kind: "unreachable" } }),
  };

  const store = createComputers(deps);
  await store.start();
  assert.deepEqual(passedSigningKeys, [
    remoteKeyText(phoneSigning.publicKey),
    remoteKeyText(phoneSigning.publicKey),
  ]);

  // Hub announces itself via serverHello.
  opened[0]?.on.onPeer({
    id: hub.machine,
    name: hub.name,
    addresses: ["198.51.100.10"],
    hub: true,
    relays: ["ws://198.51.100.10:7432", "wss://fly.test"],
  });
  assert.equal(
    store.get().computers.find((c) => c.key === hub.host)?.hub,
    true,
  );
  assert.deepEqual(saves.at(-1)?.computers[0]?.relays, [
    "ws://198.51.100.10:7432",
    "wss://fly.test",
  ]);

  // Hub sends roster reach with the hub relay for the offline desktop; its offline link reopens with the new relays.
  opened[0]?.on.onRoster({
    statements: [],
    reach: [
      {
        device: desktop.id,
        addresses: ["10.0.0.2"],
        port: 7432,
        relay: "ws://198.51.100.10:7432",
        hub: false,
        relays: ["ws://198.51.100.10:7432", "wss://fly.test"],
      },
    ],
  });
  assert.equal(opened[1]?.closed, true);
  assert.equal(opened.length, 3);
  assert.deepEqual(opened[2]?.computer.relays, [
    "ws://198.51.100.10:7432",
    "wss://fly.test",
  ]);
  assert.deepEqual(saves.at(-1)?.computers[1]?.relays, [
    "ws://198.51.100.10:7432",
    "wss://fly.test",
  ]);
});
