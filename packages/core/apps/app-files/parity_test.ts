import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { manualClock } from "../../../base/mod.ts";
import { createAppFileStore } from "./store.ts";
import {
  APP_FILE_HASH as SDK_APP_FILE_HASH,
  APP_FILE_MAX_BYTES as SDK_APP_FILE_MAX_BYTES,
} from "../../../sdk/cap-store/files.ts";
import {
  hasAppFile,
  putAppFile,
  readAppFile,
} from "../../../sdk/cap-store/files.node.ts";
import {
  APP_FILE_HASH,
  APP_FILE_MAX_BYTES,
  appFileHandleSchema,
} from "../../../protocol/apps/app-files.ts";

// The SDK cannot import protocol or core, so it keeps a hand copy of the layout and the handle. A layout that drifts would make
// a file one side wrote invisible to the other (a photo the phone uploaded that the backend cannot read).
test("a file put through the SDK is read by the core store and the reverse, and the limits agree", async () => {
  const area = await mkdtemp(join(tmpdir(), "lophn-app-files-parity-"));
  try {
    const store = createAppFileStore({ clock: manualClock(Date.now()) });

    const fromSdk = new TextEncoder().encode("written by the app process");
    const handle = await putAppFile(
      fromSdk,
      { type: "text/plain", name: "a.txt" },
      { dataPath: area },
    );
    assert.deepEqual(appFileHandleSchema.parse(handle), handle);
    const read = await store.read(area, handle.file, 0, 1024);
    assert.ok(read.ok);
    assert.equal(Buffer.compare(read.value.bytes, fromSdk), 0);
    assert.deepEqual(read.value.meta, {
      type: "text/plain",
      size: fromSdk.length,
      name: "a.txt",
    });

    const fromCore = new TextEncoder().encode("uploaded by the phone");
    const file = (
      await putAppFile(fromCore, { type: "x/y" }, { dataPath: area })
    ).file;
    // A file the core wrote, under a new area so only the core wrote it.
    const other = await mkdtemp(join(tmpdir(), "lophn-app-files-parity-"));
    try {
      const put = await store.put(other, {
        file,
        size: fromCore.length,
        type: "image/png",
        offset: 0,
        bytes: fromCore,
      });
      assert.deepEqual(put.ok && put.value, {
        status: "stored",
        received: fromCore.length,
      });
      assert.equal(
        Buffer.compare(await readAppFile(file, { dataPath: other }), fromCore),
        0,
      );
      assert.equal(await hasAppFile({ file }, { dataPath: other }), true);
      // The SDK sees an existing core file as present and does not rewrite it.
      assert.equal(
        (await putAppFile(fromCore, { type: "x/y" }, { dataPath: other })).file,
        file,
      );
    } finally {
      await rm(other, { recursive: true, force: true });
    }
    assert.equal(await hasAppFile("0".repeat(64), { dataPath: area }), false);
    await assert.rejects(readAppFile("0".repeat(64), { dataPath: area }), {
      code: "not_found",
    });

    assert.equal(SDK_APP_FILE_MAX_BYTES, APP_FILE_MAX_BYTES);
    assert.equal(SDK_APP_FILE_HASH.source, APP_FILE_HASH.source);
    await assert.rejects(
      putAppFile(
        new Uint8Array(APP_FILE_MAX_BYTES + 1),
        { type: "x/y" },
        { dataPath: area },
      ),
      { code: "invalid_input" },
    );
  } finally {
    await rm(area, { recursive: true, force: true });
  }
});
