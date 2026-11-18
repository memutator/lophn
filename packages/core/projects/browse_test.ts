import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { browseFolders } from "./browse.ts";

test("폴더 목록 읽기는 home 밖을 읽지 못한다", async () => {
  const base = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "lophn-browse-")),
  );
  try {
    const home = join(base, "home");
    const outside = join(base, "outside");
    await fs.mkdir(join(home, "code"), { recursive: true });
    await fs.mkdir(outside);
    await fs.writeFile(join(home, "notes.txt"), "n");
    await fs.symlink(outside, join(home, "escape"));
    await fs.symlink(join(home, "code"), join(home, "shortcut"));
    const deps = { home, fs };

    for (const path of [join(home, ".."), outside, join(home, "escape")]) {
      const read = await browseFolders({ path }, deps);
      assert.equal(read.ok ? "ok" : read.error.code, "forbidden", path);
    }

    const listed = await browseFolders({}, deps);
    assert.ok(listed.ok);
    assert.deepEqual(listed.value.entries, [
      { name: "code", path: join(home, "code") },
      { name: "shortcut", path: join(home, "code") },
    ]);
    assert.equal(listed.value.parent, null);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});
