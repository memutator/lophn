import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createGlobalFloatsStore } from "./global-floats.ts";

const APP = "app_00000000000000000000000000";
const RECT = { x: 10, y: 20, width: 400, height: 300 };

async function withRoot(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "lophn-global-floats-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("쓴 전역 float 목록이 그대로 읽히고, 틀린 파일이나 다른 schema_version은 빈 목록으로 읽힌다", async () => {
  await withRoot(async (root) => {
    const store = createGlobalFloatsStore(root);
    assert.deepEqual(await store.read(), []);
    const floats = [
      { app: APP, screen: "main", rect: RECT, minimized: false },
      { app: APP, screen: "side", rect: RECT, minimized: true, pinned: true },
    ];
    assert.deepEqual(await store.write(floats), { ok: true, value: null });
    assert.deepEqual(await store.read(), floats);

    // 모양이 틀린 값은 쓰지 않고 파일을 그대로 둔다.
    const bad = await store.write([{ app: "x", screen: "", rect: RECT }]);
    assert.equal(bad.ok, false);
    assert.deepEqual(await store.read(), floats);

    const file = join(root, "shell", "global-floats.json");
    await writeFile(file, "{not json");
    assert.deepEqual(await store.read(), []);
    await writeFile(file, JSON.stringify({ schema_version: 2, floats }));
    assert.deepEqual(await store.read(), []);
  });
});
