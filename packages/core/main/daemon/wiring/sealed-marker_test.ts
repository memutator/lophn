import assert from "node:assert/strict";
import { access, chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { sealedMarkerStep } from "./sealed-marker.ts";

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

// 옛 core가 봉인한 사본은 표지가 없다. 표지를 안 써 주면 새 core가 봉인 안 된 사본으로 보고 지운다.
test("옛 봉인 사본에는 표지를 쓰고 쓰기 가능한 사본에는 쓰지 않으며 두 번 돌아도 같다", {
  skip: process.platform === "win32",
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-sealed-marker-"));
  const bundles = join(root, "apps/app_1/bundles");
  const old = join(bundles, "old");
  const open = join(bundles, "open");
  try {
    for (const copy of [old, open]) {
      await mkdir(copy, { recursive: true });
      await writeFile(`${copy}/main.js`, "1");
    }
    await chmod(`${old}/main.js`, 0o444);
    await chmod(old, 0o555);
    for (let round = 0; round < 2; round += 1) {
      assert.ok((await sealedMarkerStep.run(root)).ok);
      assert.ok(await exists(`${old}.sealed`));
      assert.equal(await exists(`${open}.sealed`), false);
    }
  } finally {
    await chmod(old, 0o755).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});
