import assert from "node:assert/strict";
import { chmod, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { BundleManifest } from "../../../../protocol/apps/mod.ts";
import { clearUnsealedCopy, sealCopy, writeBundle } from "./seal.ts";
import { sweepBundleFiles } from "./share.ts";

const text = (value: string) => new TextEncoder().encode(value);

async function write(copyPath: string, files: Record<string, string>) {
  const written = await writeBundle({
    copyPath,
    manifest: { files: [] } as unknown as BundleManifest,
    declarationJson: text("{}"),
    bundleFiles: Object.entries(files).map(([path, value]) => ({
      path,
      bytes: text(value),
    })),
  });
  assert.ok(written.ok);
}

// 앱 지우기처럼 폴더만 열고 지운다.
async function removeTree(path: string): Promise<void> {
  const open = async (dir: string): Promise<void> => {
    await chmod(dir, 0o755);
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) await open(join(dir, entry.name));
    }
  };
  await open(path).catch(() => {});
  await rm(path, { recursive: true, force: true });
}

// 봉인된 사본끼리 inode를 같이 쓴다. 틀리면 한 release의 file이 다른 release를 바꾸거나, 지우기가 다른 사본을 망친다.
test("봉인한 사본은 같은 내용의 file을 store와 나눠 쓰고, 다른 사본을 지우거나 store를 쓸어도 byte와 읽기 전용이 남는다", async () => {
  const work = await mkdtemp(join(tmpdir(), "lophn-share-"));
  const store = join(work, "store");
  try {
    const first = join(work, "first");
    const second = join(work, "second");
    await write(first, { "node_modules/a.js": "same", "main.js": "one" });
    await write(second, { "node_modules/a.js": "same", "main.js": "two" });
    assert.ok((await sealCopy(first, store)).ok);
    assert.ok((await sealCopy(second, store)).ok);

    const a1 = await stat(`${first}/node_modules/a.js`);
    const a2 = await stat(`${second}/node_modules/a.js`);
    assert.equal(a1.ino, a2.ino);
    assert.equal(await readFile(`${first}/main.js`, "utf8"), "one");
    assert.equal(await readFile(`${second}/main.js`, "utf8"), "two");

    // 봉인을 못 마친 사본이 store와 이어진 채 남았다가 지워지는 경우.
    const partial = join(work, "partial");
    await write(partial, { "node_modules/a.js": "same" });
    assert.ok((await sealCopy(partial, store)).ok);
    await rm(`${partial}.sealed`);
    assert.deepStrictEqual(await clearUnsealedCopy(partial), {
      ok: true,
      value: true,
    });
    // Windows는 지우며 나눠 쓰는 file의 읽기 전용이 풀린다. 다음 봉인이 store를 쓸며 다시 잠근다.
    const third = join(work, "third");
    await write(third, { "main.js": "three" });
    assert.ok((await sealCopy(third, store)).ok);
    const after = await stat(`${first}/node_modules/a.js`);
    assert.equal(after.mode & 0o777, 0o444);
    assert.equal(await readFile(`${first}/node_modules/a.js`, "utf8"), "same");

    // 쓰는 사본이 남은 file은 store에 남고, 아무도 안 쓰는 file만 지운다.
    const before = (await readdir(store)).length;
    await sweepBundleFiles(store);
    assert.equal((await readdir(store)).length, before);
    await removeTree(second);
    await sweepBundleFiles(store);
    assert.equal((await readdir(store)).length, before - 1);
    assert.equal(await readFile(`${first}/node_modules/a.js`, "utf8"), "same");
  } finally {
    await removeTree(work);
  }
});
