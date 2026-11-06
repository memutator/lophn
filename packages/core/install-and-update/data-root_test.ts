import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resolveDataRoot } from "./data-root.ts";

async function withRoot(run: (root: string) => Promise<void>) {
  const parent = await realpath(await mkdtemp(join(tmpdir(), "lophn-root-")));
  try {
    const root = join(parent, "data");
    await mkdir(root, { mode: 0o700 });
    await run(root);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

// 사람의 data root가 다른 사용자에게 열려 있으면 기동하지 않는다. Windows는 mode가 ACL을 나타내지 못해 보지 않는다.
test("POSIX는 group·other 권한이 있는 data root를 거절하고 win32는 mode를 보지 않는다", {
  skip: process.platform === "win32",
}, async () => {
  await withRoot(async (root) => {
    assert.ok((await resolveDataRoot({ lophnHome: root }, "linux")).ok);
    await chmod(root, 0o750);
    const refused = await resolveDataRoot({ lophnHome: root }, "linux");
    assert.ok(!refused.ok);
    assert.equal(refused.error.code, "unavailable");
    assert.ok((await resolveDataRoot({ lophnHome: root }, "win32")).ok);
  });
});
