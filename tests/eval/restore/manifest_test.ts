import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { MaterialManifest } from "../types.ts";
import { loadMaterial, verifyMaterial, writeMaterial } from "./manifest.ts";

// 한 byte라도 바뀐 재료가 조용히 되살아나면 모든 기준 run이 다른 world에서 돈 것이 된다.
test("재료 file이 한 byte라도 달라지면 hash 확인이 거절하고 이미 있는 재료에는 새로 쓰지 않는다", async () => {
  const root = await mkdtemp(join(tmpdir(), "eval-material-"));
  try {
    const manifest: Omit<MaterialManifest, "content_hash"> = {
      kind: "app",
      ids: {},
      needs: [],
      parent: null,
      produced_by: null,
    };
    const files = [{
      path: "apps.json",
      bytes: new TextEncoder().encode("[]\n"),
    }];
    assert.ok((await writeMaterial(root, "m", 1, manifest, files)).ok);
    assert.ok((await verifyMaterial(await loadMaterial(root, "m@1"))).ok);

    await writeFile(`${root}/m/1/files/apps.json`, "[ ]\n");
    const changed = await verifyMaterial(await loadMaterial(root, "m@1"));
    assert.ok(!changed.ok);
    assert.deepStrictEqual(changed.error.code, "conflict");

    const again = await writeMaterial(root, "m", 1, manifest, files);
    assert.ok(!again.ok);
    assert.deepStrictEqual(again.error.code, "conflict");
    // 거절된 쓰기가 file을 덮지 않았다.
    assert.deepStrictEqual(
      await readFile(`${root}/m/1/files/apps.json`, "utf8"),
      "[ ]\n",
    );
  } finally {
    await rm(root, { recursive: true });
  }
});
