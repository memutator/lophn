import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { markSpawnHelpers } from "./spawn-helper.ts";

// 이것이 빠지면 mac 설치본에서 터미널과 coding session이 하나도 열리지 않는다.
test("darwin prebuild의 spawn-helper만 실행 권한을 받는다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-spawn-helper-"));
  try {
    const prebuilds = join(root, "node-pty", "prebuilds");
    const files = [
      "darwin-arm64/spawn-helper",
      "darwin-arm64/pty.node",
      "darwin-x64/spawn-helper",
      "win32-x64/spawn-helper",
    ];
    for (const file of files) {
      await mkdir(dirname(join(prebuilds, file)), { recursive: true });
      await writeFile(join(prebuilds, file), "");
      await chmod(join(prebuilds, file), 0o644);
    }

    const marked = await markSpawnHelpers(root);

    assert.deepEqual(marked.sort(), [
      join(prebuilds, "darwin-arm64/spawn-helper"),
      join(prebuilds, "darwin-x64/spawn-helper"),
    ]);
    const mode = async (file: string) =>
      (await stat(join(prebuilds, file))).mode & 0o777;
    if (process.platform !== "win32") {
      assert.equal(await mode("darwin-arm64/spawn-helper"), 0o755);
      assert.equal(await mode("darwin-x64/spawn-helper"), 0o755);
      assert.equal(await mode("darwin-arm64/pty.node"), 0o644);
      assert.equal(await mode("win32-x64/spawn-helper"), 0o644);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
