import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { LocalFiles, Remote } from "../local/ports.ts";
import { toBase64 } from "../local/transfer.ts";
import { fakeFiles } from "./fake-computer.ts";
import { COMPUTER_WAIT_MS, createFilePlace, FILE_PIECE_BYTES, type Keeping, type Link } from "./place.ts";

const APP = "app_files";
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

function nodeFiles(root: string): LocalFiles {
  const at = (path: string) => join(root, path);
  const made = (path: string) => {
    mkdirSync(dirname(at(path)), { recursive: true });
    return at(path);
  };
  return {
    exists: (path) => existsSync(at(path)),
    readText: (path) => (existsSync(at(path)) ? readFileSync(at(path), "utf8") : null),
    write: (path, content) => writeFileSync(made(path), content),
    append: (path, bytes) => writeFileSync(made(path), bytes, { flag: "a" }),
    remove: (path) => rmSync(at(path), { recursive: true, force: true }),
    list: (path) => (existsSync(at(path)) ? readdirSync(at(path)) : []),
    copy: (from, to) => copyFileSync(at(from), made(to)),
    move: (from, to) => renameSync(at(from), made(to)),
    async digest(path) {
      if (!existsSync(at(path))) return null;
      const bytes = readFileSync(at(path));
      return { size: bytes.byteLength, sha256: sha(bytes) };
    },
    absolute: at,
    readRange: (path, offset, length) =>
      new Uint8Array(readFileSync(at(path)).subarray(offset, offset + length)),
    async copyIn(source, path) {
      copyFileSync(source, made(path));
    },
    uri: (path) => `file://${at(path)}`,
  };
}

// Everything left in a place's folder, so a test can say "nothing was kept".
function leftIn(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
      else out.push(join(dir, entry.name));
    }
  };
  walk(root);
  return out;
}

// Time is passed in: `sleep` moves the clock, so the wait for a computer costs no real time.
function setup(keeping: Keeping, links: () => readonly Link[], clock = { t: 1_700_000_000_000 }) {
  const root = mkdtempSync(join(tmpdir(), "lophn-place-"));
  const files = nodeFiles(root);
  let n = 0;
  const place = createFilePlace({
    files,
    dir: "place",
    app: APP,
    keeping: () => keeping,
    links,
    target: () => ({ mode: "live", app: APP, release: null }),
    newName: () => `n${++n}`,
    now: () => clock.t,
    sleep: async (ms) => {
      clock.t += ms;
    },
  });
  return { root, files, place, clock };
}
const linkTo = (remote: Remote | null) => () => (remote === null ? [] : [{ computer: "c1", remote }]);
const upload: Keeping = { kind: "upload" };

// A computer that answers `app_files/read` with `bytes` whatever the file asked for, as a wrong or damaged computer would.
const readsAs = (bytes: Uint8Array, size = bytes.byteLength): Remote => ({
  call: async (input) => {
    const { offset, length } = input.body as { offset: number; length: number };
    return {
      ok: true,
      value: { type: "text/plain", size, bytes_base64: toBase64(bytes.subarray(offset, offset + length)) },
    };
  },
});

// A file a place keeps is a file its guest may draw and share, and one the app's rows may name. Bytes that are not the
// file their name says must never become visible.
test("a downloaded file is visible only when its sha256 and size are the name's", async () => {
  const wanted = new TextEncoder().encode("the real bytes");
  const name = sha(wanted);
  for (const sent of [
    readsAs(new TextEncoder().encode("other bytes!!!")),
    readsAs(wanted, wanted.byteLength + 1),
    readsAs(wanted.subarray(0, 5), wanted.byteLength),
  ]) {
    const damaged = setup(upload, linkTo(sent));
    assert.equal((await damaged.place.ensure(name)).ok, false);
    assert.deepEqual(leftIn(damaged.root), []);
    rmSync(damaged.root, { recursive: true, force: true });
  }
  const good = setup(upload, linkTo(readsAs(wanted)));
  const located = await good.place.ensure(name);
  assert.ok(located.ok);
  assert.equal(readFileSync(located.value.uri.replace("file://", "")).toString(), "the real bytes");
  rmSync(good.root, { recursive: true, force: true });

  // Not on the computer: not_found. A phone-run app with no computer reachable does not wait: unavailable.
  const none = setup(upload, linkTo({ call: async () => ({ ok: false, error: { code: "not_found", message: "x" } }) }));
  const absent = await none.place.ensure(name);
  assert.ok(!absent.ok && absent.error.code === "not_found");
  const away = setup({ kind: "local" }, linkTo(null));
  const lost = await away.place.ensure(name);
  assert.ok(!lost.ok && lost.error.code === "unavailable");
  assert.equal(away.clock.t, 1_700_000_000_000);
});

// The capture of a computer-run app is kept only once the computer holds it: a multi-piece upload ends when the computer says
// `stored` (not at the first `partial`), a drop in the middle resumes from the bytes the computer already has, and when the
// computer is not there within the bound nothing stays and the reason says it was the connection.
test("a computer-run app's file reaches the computer piece by piece, resumes after a drop, and is given up only after the wait", async () => {
  const bytes = new Uint8Array(FILE_PIECE_BYTES * 2 + 100).map((_, at) => at % 251);
  const name = sha(bytes);
  const computer = fakeFiles();
  computer.breaks = 1;
  const kept = setup(upload, linkTo(computer.remote));
  kept.files.write("picked/p.jpg", bytes);
  const added = await kept.place.add({ uri: kept.files.absolute("picked/p.jpg"), type: "image/jpeg" });
  assert.ok(added.ok, added.ok ? "" : added.error.message);
  assert.deepEqual(computer.files.get(name), bytes);
  // The first piece broke; the retry asked and went on from offset 0 (the computer held nothing), then every piece followed.
  assert.deepEqual(
    computer.puts.filter(([, size]) => size > 0).map(([offset]) => offset),
    [0, 0, FILE_PIECE_BYTES, FILE_PIECE_BYTES * 2],
  );

  // The computer holds the first piece already (an earlier try): only the rest is sent.
  const held = fakeFiles();
  held.parts.set(name, [...bytes.subarray(0, FILE_PIECE_BYTES)]);
  const resumed = setup(upload, linkTo(held.remote));
  resumed.files.write("picked/p.jpg", bytes);
  assert.ok((await resumed.place.add({ uri: resumed.files.absolute("picked/p.jpg") })).ok);
  assert.deepEqual(
    held.puts.filter(([, size]) => size > 0).map(([offset]) => offset),
    [FILE_PIECE_BYTES, FILE_PIECE_BYTES * 2],
  );
  assert.deepEqual(held.files.get(name), bytes);

  // The computer comes back just inside the wait: kept. Just outside: unavailable with the connection as the reason, no bytes left.
  const small = new TextEncoder().encode("a small photo");
  for (const [appearsAfter, expect] of [
    [COMPUTER_WAIT_MS - 1_000, "kept"],
    [COMPUTER_WAIT_MS + 5_000, "no_connection"],
  ] as const) {
    const late = fakeFiles();
    const clock = { t: 0 };
    const waiting = setup(upload, () => (clock.t >= appearsAfter ? [{ computer: "c1", remote: late.remote }] : []), clock);
    waiting.files.write("picked/p.jpg", small);
    const done = await waiting.place.add({ uri: waiting.files.absolute("picked/p.jpg") });
    if (expect === "kept") {
      assert.ok(done.ok);
      assert.ok(late.files.has(sha(small)));
    } else {
      assert.ok(!done.ok && done.error.code === "unavailable");
      assert.equal(done.error.details?.["reason"], "no_connection");
      assert.deepEqual(leftIn(join(waiting.root, "place")), []);
    }
  }

  // The computer answers and refuses: no handle, no bytes, the computer's words in the text.
  const refusing = fakeFiles();
  refusing.refuse.add(sha(small));
  const refused = setup(upload, linkTo(refusing.remote));
  refused.files.write("picked/p.jpg", small);
  const no = await refused.place.add({ uri: refused.files.absolute("picked/p.jpg") });
  assert.ok(!no.ok && no.error.details?.["reason"] === "refused" && no.error.message.includes("sha256"));
  assert.deepEqual(leftIn(join(refused.root, "place")), []);
});
