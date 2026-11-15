import assert from "node:assert/strict";
import { test } from "node:test";
import { cryptoRandom } from "../../../packages/base/mod.ts";
import type { Computer } from "../pairing/store.ts";
import { generateKeyPair } from "../remote.ts";
import {
  type ComputersDeps,
  createComputers,
  type Link,
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
  const opened: { key: string; closed: boolean; revoke: () => void }[] = [];
  const saves: Computer[][] = [];
  const link = (record: { closed: boolean }): Link<null> => ({
    data: null,
    state: () => ({ status: "connected", path: "direct", waiting: 0 }),
    subscribe: () => () => {},
    pause() {},
    resume() {},
    close() {
      record.closed = true;
    },
  });
  const deps: ComputersDeps<null> = {
    load: async () => ({
      phone: generateKeyPair(cryptoRandom),
      computers: saved,
    }),
    save: async (next) => {
      saves.push(next);
    },
    open(one, _phone, onRevoked) {
      const record = { key: one.key, closed: false, revoke: onRevoked };
      opened.push(record);
      return link(record);
    },
    pair: async () => ({ ok: false, failure: { kind: "unreachable" } }),
  };
  return { deps, opened, saves, link };
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
