import assert from "node:assert/strict";
import { access, chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { BundleManifest } from "../../../../protocol/apps/mod.ts";
import { clearUnsealedCopy, sealBundle, sealMarkerPath } from "./seal.ts";

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

// 봉인 판정이 표지 하나다. 틀리면 끝난 앱 사본을 지우거나(Windows는 mode로 봉인을 못 가려 매번 지운다), 끊긴 사본을 쓴다.
test("봉인 표지가 있는 사본은 준비가 지우지 않고 표지 없는 사본은 끊긴 것으로 지운다", async () => {
  const work = await mkdtemp(join(tmpdir(), "lophn-seal-"));
  try {
    const sealed = join(work, "sealed");
    const done = await sealBundle({
      copyPath: sealed,
      manifest: { files: [] } as unknown as BundleManifest,
      declarationJson: new TextEncoder().encode("{}"),
      bundleFiles: [{ path: "main.js", bytes: new TextEncoder().encode("1") }],
    });
    assert.ok(done.ok);
    assert.ok(await exists(sealMarkerPath(sealed)));
    assert.deepStrictEqual(await clearUnsealedCopy(sealed), {
      ok: true,
      value: false,
    });
    assert.ok(await exists(`${sealed}/main.js`));

    // 쓰기만 하고 봉인을 못 마친 사본(표지 없음).
    const partial = join(work, "partial");
    await mkdir(partial);
    await writeFile(`${partial}/main.js`, "1");
    assert.deepStrictEqual(await clearUnsealedCopy(partial), {
      ok: true,
      value: true,
    });
    assert.equal(await exists(partial), false);

    // 없는 사본은 지울 것이 없다.
    assert.ok((await clearUnsealedCopy(partial)).ok);

    // 옛 core가 봉인했지만 아직 표지를 못 받은 읽기 전용 사본도 지우고 다시 쓸 수 있어야 한다.
    if (process.platform !== "win32") {
      const readonly = join(work, "readonly");
      await mkdir(`${readonly}/deep`, { recursive: true });
      await writeFile(`${readonly}/deep/main.js`, "1");
      await chmod(`${readonly}/deep/main.js`, 0o444);
      await chmod(`${readonly}/deep`, 0o555);
      await chmod(readonly, 0o555);
      assert.deepStrictEqual(await clearUnsealedCopy(readonly), {
        ok: true,
        value: true,
      });
      assert.equal(await exists(readonly), false);
    }
  } finally {
    // 봉인된 폴더는 쓰기를 돌려줘야 지울 수 있다.
    await chmod(`${work}/sealed`, 0o755).catch(() => {});
    await rm(work, { recursive: true, force: true });
  }
});
