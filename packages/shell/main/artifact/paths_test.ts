import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { listDataEntries } from "./entries.ts";
import { resolveInsideRoot } from "./paths.ts";
import { createArtifactRoots } from "./roots.ts";
import { createArtifactServer } from "./serve.ts";

// 바깥 폴더 `out`과, root와 접두사만 같은 형제 `art-evil`을 root 옆에 둔다.
async function setup() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "lophn-artifact-")));
  const root = join(base, "art");
  await mkdir(join(root, "data", "sub"), { recursive: true });
  await mkdir(join(base, "out"));
  await mkdir(join(base, "art-evil"));
  await writeFile(join(root, "index.html"), "home");
  await writeFile(join(root, "data", "a.json"), "{}");
  await writeFile(join(root, "big.bin"), "x".repeat(100));
  await writeFile(join(base, "out", "secret.txt"), "secret");
  await writeFile(join(base, "art-evil", "secret.txt"), "secret");
  await symlink(join(base, "out", "secret.txt"), join(root, "out-file"));
  await symlink(join(base, "out"), join(root, "out-dir"));
  await symlink(join(base, "art-evil"), join(root, "evil-dir"));
  await symlink(join(root, "index.html"), join(root, "inner-link"));
  await symlink(join(base, "out", "secret.txt"), join(root, "data", "leak"));
  const roots = createArtifactRoots();
  const host = roots.register(root);
  const serve = createArtifactServer({
    rootOf: roots.rootOf,
    scopeOf: roots.scopeOf,
    readInstance: () => Promise.resolve(null),
    kit: () => Promise.resolve(null),
    maxBytes: 50,
  });
  const get = (path: string) =>
    serve(new Request(`lophn-artifact://${host}${path}`));
  return { base, root, get };
}

test("봉한 scheme은 root 밖을 가리키는 path와 일반 file이 아닌 것, 상한을 넘는 file을 거절한다", async () => {
  const { base, root, get } = await setup();
  try {
    const denied = [
      "/../out/secret.txt",
      "/%2e%2e/out/secret.txt",
      "/%2E%2E%2Fout/secret.txt",
      "/art/../out/secret.txt",
      "/..%5Cout%5Csecret.txt",
      "/index.html%00",
      "/%E0%A4%A",
      `/${join(base, "out", "secret.txt")}`,
      "/out-file",
      "/out-dir/secret.txt",
      "/evil-dir/secret.txt",
      "/data/",
      "/data",
      "/big.bin",
    ];
    for (const path of denied) {
      const response = await get(path);
      assert.equal(response.status, 404, path);
      assert.notEqual(await response.text(), "secret", path);
    }
    // URL 파서가 먼저 정리해 주는 `..`도 해석기 자체가 거절해야 한다.
    for (
      const path of [
        "../out/secret.txt",
        "%2e%2e/out/secret.txt",
        "a/../../out",
      ]
    ) {
      assert.equal(await resolveInsideRoot(root, path), null, path);
    }
    for (const path of ["/", "/index.html", "/inner-link"]) {
      const response = await get(path);
      assert.equal(response.status, 200, path);
      assert.equal(await response.text(), "home", path);
    }
  } finally {
    await rm(base, { recursive: true });
  }
});

test("_entries.json은 밖으로 가는 symlink와 하위 폴더를 싣지 않는다", async () => {
  const { base, root, get } = await setup();
  try {
    const names = (entries: string) =>
      JSON.parse(entries).map((e: { name: string }) => e.name);
    assert.deepEqual(names(await listDataEntries(root)), ["a.json"]);
    const served = await get("/data/_entries.json");
    assert.deepEqual(names(await served.text()), ["a.json"]);
    // data/ 자체가 밖으로 가는 symlink면 목록은 비어 있다.
    await rm(join(root, "data"), { recursive: true });
    await symlink(join(base, "out"), join(root, "data"));
    assert.deepEqual(names(await listDataEntries(root)), []);
  } finally {
    await rm(base, { recursive: true });
  }
});
