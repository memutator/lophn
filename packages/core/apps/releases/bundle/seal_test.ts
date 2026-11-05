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
    assert.equal(await clearUnsealedCopy(sealed), false);
    assert.ok(await exists(`${sealed}/main.js`));

    // 쓰기만 하고 봉인을 못 마친 사본(표지 없음).
    const partial = join(work, "partial");
    await mkdir(partial);
    await writeFile(`${partial}/main.js`, "1");
    assert.equal(await clearUnsealedCopy(partial), true);
    assert.equal(await exists(partial), false);
  } finally {
    // 봉인된 폴더는 쓰기를 돌려줘야 지울 수 있다.
    await chmod(`${work}/sealed`, 0o755).catch(() => {});
    await rm(work, { recursive: true, force: true });
  }
});
