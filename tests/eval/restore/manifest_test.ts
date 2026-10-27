import assert from "node:assert/strict";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadMaterial, MATERIALS_ROOT, verifyMaterial } from "./manifest.ts";

// 한 byte라도 바뀐 재료가 조용히 되살아나면 모든 기준 run이 다른 world에서 돈 것이 된다.
test("재료 file이 한 byte라도 달라지면 hash 확인이 거절한다", async () => {
  const root = await mkdtemp(join(tmpdir(), "eval-material-"));
  try {
    await cp(`${MATERIALS_ROOT}/apps-home`, `${root}/apps-home`, {
      recursive: true,
    });
    assert.ok(
      (await verifyMaterial(await loadMaterial(root, "apps-home@1"))).ok,
    );

    await writeFile(`${root}/apps-home/1/files/apps.json`, "[]\n");
    const changed = await verifyMaterial(
      await loadMaterial(root, "apps-home@1"),
    );
    assert.ok(!changed.ok);
    assert.deepStrictEqual(changed.error.code, "conflict");
  } finally {
    await rm(root, { recursive: true });
  }
});
