import { assert, assertEquals } from "@std/assert";
import type { MaterialManifest } from "../types.ts";
import { loadMaterial, verifyMaterial, writeMaterial } from "./manifest.ts";

// 한 byte라도 바뀐 재료가 조용히 되살아나면 모든 기준 run이 다른 world에서 돈 것이 된다.
Deno.test("재료 file이 한 byte라도 달라지면 hash 확인이 거절하고 이미 있는 재료에는 새로 쓰지 않는다", async () => {
  const root = await Deno.makeTempDir({ prefix: "eval-material-" });
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
    assert((await writeMaterial(root, "m", 1, manifest, files)).ok);
    assert((await verifyMaterial(await loadMaterial(root, "m@1"))).ok);

    await Deno.writeTextFile(`${root}/m/1/files/apps.json`, "[ ]\n");
    const changed = await verifyMaterial(await loadMaterial(root, "m@1"));
    assert(!changed.ok);
    assertEquals(changed.error.code, "conflict");

    const again = await writeMaterial(root, "m", 1, manifest, files);
    assert(!again.ok);
    assertEquals(again.error.code, "conflict");
    // 거절된 쓰기가 file을 덮지 않았다.
    assertEquals(
      await Deno.readTextFile(`${root}/m/1/files/apps.json`),
      "[ ]\n",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
