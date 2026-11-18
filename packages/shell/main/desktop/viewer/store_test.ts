import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { seededRandom } from "../../../../base/mod.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import { remoteKeyText } from "../../../../protocol/remote/client.ts";
import { createViewerStore, type Opened } from "./store.ts";

const HERE = "mch_01hzzzzzzzzzzzzzzzzzzzzzzz" as Id<"mch">;
const COPY = "mch_01jzzzzzzzzzzzzzzzzzzzzzzz" as Id<"mch">;
const HOST = "mch_01kzzzzzzzzzzzzzzzzzzzzzzz" as Id<"mch">;

const secretOf = (opened: Opened) => {
  assert.ok(opened.ok);
  return remoteKeyText(opened.key.secretKey);
};

test("the device key is made once (0600) and kept; a copied data root starts over; a broken list is never overwritten", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-viewer-"));
  const dir = join(root, "shell", "viewer");
  const open = (machine: Id<"mch">, seed: number) =>
    createViewerStore({
      dataRoot: root,
      machine,
      random: seededRandom(seed),
      log: () => {},
    });
  try {
    const first = open(HERE, 1);
    const made = await first.open();
    const secret = secretOf(made);
    if (process.platform !== "win32") {
      assert.equal((await stat(join(dir, "key.json"))).mode & 0o777, 0o600);
      assert.equal((await stat(dir)).mode & 0o777, 0o700);
    }
    await first.save({
      computers: [
        {
          addresses: ["192.168.0.2"],
          port: 47432,
          key: "k".repeat(43),
          machine: HOST,
        },
      ],
      start: { mode: "machine", machine: HOST },
      last: HOST,
      seen: { [HOST]: "2026-11-16T00:00:00.000Z" },
    });
    if (process.platform !== "win32") {
      assert.equal(
        (await stat(join(dir, "machines.json"))).mode & 0o777,
        0o600,
      );
    }

    // Opened again on the same machine: the same key and the saved list.
    const again = await open(HERE, 2).open();
    assert.equal(secretOf(again), secret);
    assert.ok(again.ok);
    assert.equal(again.saved.computers.length, 1);
    assert.deepEqual(again.saved.start, { mode: "machine", machine: HOST });

    // A broken list is left as it is and the key is not made again meanwhile.
    await writeFile(join(dir, "machines.json"), "{ half");
    assert.deepEqual(await open(HERE, 3).open(), { ok: false });
    assert.equal(await readFile(join(dir, "machines.json"), "utf8"), "{ half");
    assert.equal(
      (
        JSON.parse(await readFile(join(dir, "key.json"), "utf8")) as {
          secret_key: string;
        }
      ).secret_key,
      secret,
    );

    // The same files on another machine (a copied data root): both go, a new key and an empty list.
    await writeFile(
      join(dir, "machines.json"),
      JSON.stringify({
        machine: HERE,
        computers: [],
        start: { mode: "last" },
        last: null,
        seen: {},
      }),
    );
    const copied = await open(COPY, 4).open();
    assert.notEqual(secretOf(copied), secret);
    assert.ok(copied.ok);
    assert.deepEqual(copied.saved.computers, []);
    assert.equal(
      (
        JSON.parse(await readFile(join(dir, "key.json"), "utf8")) as {
          machine: string;
        }
      ).machine,
      COPY,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
