import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import type { CoreCall } from "../connection/connection.ts";
import { type BundleStore, currentBundle, syncBundle } from "./cache.ts";

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

// Files and folders as one map of path → bytes; a folder exists when some path is under it.
function memoryStore(): BundleStore & { paths(): string[] } {
  const files = new Map<string, Uint8Array>();
  const under = (dir: string) =>
    [...files.keys()].filter((p) => p === dir || p.startsWith(`${dir}/`));
  return {
    paths: () => [...files.keys()].sort(),
    exists: (p) => under(p).length > 0,
    readText: (p) =>
      files.has(p) ? Buffer.from(files.get(p)!).toString() : undefined,
    writeText: (p, text) => void files.set(p, Buffer.from(text)),
    writeBase64: async (p, base64) =>
      void files.set(p, Buffer.from(base64, "base64")),
    sha256: async (p) => sha256(files.get(p)!),
    move(from, to) {
      for (const p of under(from)) {
        files.set(to + p.slice(from.length), files.get(p)!);
        files.delete(p);
      }
    },
    remove: (p) => under(p).forEach((q) => files.delete(q)),
    list: () => [...new Set([...files.keys()].map((p) => p.split("/")[0]))],
  };
}

// A core serving `served`, whose manifest claims `claimed` hashes (defaults to the real ones).
function core(served: Record<string, string>, claimed: Record<string, string> = {}) {
  const files = Object.entries(served).map(([path, text]) => ({
    path,
    hash: claimed[path] ?? sha256(Buffer.from(text)),
    size: text.length,
  }));
  const hash = sha256(
    Buffer.from(files.map((f) => `${f.path} ${f.hash}\n`).join("")),
  );
  return {
    hash,
    call: async (input: CoreCall) =>
      input.method === "manifest"
        ? { ok: true, value: { hash, files } }
        : {
            ok: true,
            value: {
              content_type: "text/plain",
              base64: Buffer.from(
                served[(input.body as { path: string }).path]!,
              ).toString("base64"),
            },
          },
  };
}

test("a file whose hash does not match never enters the cache or the screen", async () => {
  const store = memoryStore();
  const good = core({ "index.html": "<p>1</p>", "app.js": "one" });
  assert.equal(await syncBundle(good.call, store), good.hash);
  assert.equal(currentBundle(store), good.hash);

  const bad = core(
    { "index.html": "<p>2</p>", "app.js": "tampered" },
    { "app.js": sha256(Buffer.from("two")) },
  );
  assert.equal(await syncBundle(bad.call, store), undefined);
  // The screen keeps the confirmed bundle, and nothing of the bad one is left on disk.
  assert.equal(currentBundle(store), good.hash);
  assert.deepEqual(store.paths(), [
    `${good.hash}/app.js`,
    `${good.hash}/index.html`,
    "current",
  ]);
});
