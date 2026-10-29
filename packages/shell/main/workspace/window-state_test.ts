import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createWindowStateStore } from "./window-state.ts";

test("창 자리는 다시 읽히고, 없거나 망가진 파일은 기본 창으로 열게 null이다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-window-state-"));
  const file = join(root, "shell", "window.json");
  try {
    const store = createWindowStateStore(root);
    assert.equal(await store.read(), null);

    const saved = {
      bounds: { x: -1200, y: 40, width: 1500, height: 900 },
      maximized: true,
    };
    await store.write(saved);
    assert.deepEqual(await store.read(), saved);
    assert.equal((await stat(file)).mode & 0o777, 0o600);

    for (const broken of [
      "{",
      JSON.stringify({
        bounds: { x: 0, y: 0, width: 0, height: 900 },
        maximized: false,
      }),
      JSON.stringify({ bounds: { x: 0, y: 0, width: 900, height: 900 } }),
      JSON.stringify({ ...saved, extra: 1 }),
    ]) {
      await writeFile(file, broken);
      assert.equal(await store.read(), null, broken);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
