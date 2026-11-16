import assert from "node:assert/strict";
import { test } from "node:test";
import { cryptoRandom } from "../base/mod.ts";
import { generateKeyPair } from "../protocol/remote/client.ts";
import {
  type Computer,
  type ComputersDeps,
  createComputers,
  type Link,
  type PairResult,
  sampleFor,
} from "./computers.ts";

const computer = (key: string): Computer => ({
  addresses: ["10.0.0.1"],
  port: 7432,
  key,
  device: `dev_${key}`,
  revoked: false,
});

function harness(saved: Computer[]) {
  const opened: {
    key: string;
    closed: boolean;
    revoke: () => void;
    peer: (machine: { id: `mch_${string}`; name: string }) => void;
  }[] = [];
  const pairing: { result: PairResult } = {
    result: { ok: false, failure: { kind: "unreachable" } },
  };
  const saves: Computer[][] = [];
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
      key: generateKeyPair(cryptoRandom),
      computers: saved,
      name: "Mina's phone",
    }),
    saveName: async (name) => name,
    save: async (next) => {
      saves.push(next);
    },
    open(one, _key, on) {
      const record = {
        key: one.key,
        closed: false,
        revoke: on.onRevoked,
        peer: on.onPeer,
      };
      opened.push(record);
      return link(record);
    },
    pair: async () => pairing.result,
  };
  return { deps, opened, saves, link, pairing };
}

test("a removed computer has its connection closed and leaves the saved list", async () => {
  const { deps, opened, saves } = harness([computer("a"), computer("b")]);
  const store = createComputers(deps);
  await store.start();
  assert.deepEqual(
    opened.map((one) => one.key),
    ["a", "b"],
  );

  store.remove("a");
  assert.equal(opened[0]?.closed, true);
  assert.equal(opened[1]?.closed, false);
  assert.deepEqual(
    saves.at(-1)?.map((one) => one.key),
    ["b"],
  );
  assert.deepEqual(
    store.get().computers.map((one) => one.key),
    ["b"],
  );
});

test("a revoked computer is closed, saved as revoked and never connected again", async () => {
  const { deps, opened, saves } = harness([computer("a")]);
  const store = createComputers(deps);
  await store.start();
  opened[0]?.revoke();

  assert.equal(opened[0]?.closed, true);
  assert.equal(saves.at(-1)?.[0]?.revoked, true);
  assert.equal(store.get().computers[0]?.status, "revoked");
  store.resume();
  assert.equal(opened.length, 1);

  // Next start of the app reads it back revoked and does not dial it.
  const again = harness(saves.at(-1) ?? []);
  await createComputers(again.deps).start();
  assert.equal(again.opened.length, 0);
});

test("the sample computer is listed first in a dev build with the flag, and nowhere else", async () => {
  const { deps, link } = harness([computer("a")]);
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
  assert.deepEqual(await listed({ dev: true, flag: "1" }), ["sample", "a"]);
  assert.deepEqual(await listed({ dev: false, flag: "1" }), ["a"]);
  assert.deepEqual(await listed({ dev: true, flag: undefined }), ["a"]);
});

test("an entry paired before computers announced themselves keeps its alias, learns the id and name on connecting, and pairing again by machine id leaves one entry", async () => {
  // The old stored shape: an alias and nothing else new.
  const old: Computer = { ...computer("a"), name: "My Galaxy" };
  const { deps, opened, saves, pairing } = harness([old]);
  const store = createComputers(deps);
  await store.start();
  const machine = {
    id: "mch_01m7dp1jqw47d55vdyzxv5wd0x" as const,
    name: "mina-desktop",
  };
  opened[0]?.peer(machine);

  assert.deepEqual(saves.at(-1), [
    { ...old, machine: machine.id, announced: "mina-desktop" },
  ]);
  assert.equal(store.get().computers[0]?.name, "My Galaxy");
  assert.equal(store.get().computers[0]?.announced, "mina-desktop");

  // The computer is renamed: the alias stays, the announced name follows.
  opened[0]?.peer({ ...machine, name: "mina-pc" });
  assert.equal(store.get().computers[0]?.name, "My Galaxy");
  assert.equal(store.get().computers[0]?.announced, "mina-pc");

  // Its key changed (a data root of its own), so only the machine id says it is the same computer.
  pairing.result = {
    ok: true,
    computer: { ...computer("b"), machine: machine.id, announced: "mina-pc" },
  };
  const failure = await store.add({
    addresses: [],
    port: 1,
    key: "b",
    code: "x",
  });
  assert.equal(failure, undefined);
  assert.deepEqual(
    store.get().computers.map((one) => [one.key, one.name]),
    [["b", "My Galaxy"]],
  );
  assert.equal(opened[0]?.closed, true);
  assert.equal(store.get().current, "b");

  // Clearing the alias brings the announced name back.
  store.rename("b", null);
  assert.equal(store.get().computers[0]?.name, "mina-pc");
});
