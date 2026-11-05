import assert from "node:assert/strict";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { BundleManifest } from "../../../../protocol/apps/mod.ts";
import { LINKS_PATH } from "./links.ts";
import { readModules } from "./modules.ts";
import { sealBundle } from "./seal.ts";

const manifest = { files: [] } as unknown as BundleManifest;
const encode = (text: string) => new TextEncoder().encode(text);

async function seal(
  copyPath: string,
  bundleFiles: { path: string; bytes: Uint8Array }[],
) {
  return await sealBundle({
    copyPath,
    manifest,
    declarationJson: encode("{}"),
    bundleFiles,
  });
}

async function walk(root: string, base = ""): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(`${root}/${base}`, {
    withFileTypes: true,
  })) {
    const path = base ? `${base}/${entry.name}` : entry.name;
    found.push(path);
    if (entry.isDirectory()) found.push(...(await walk(root, path)));
  }
  return found;
}

test("node_modules의 정규 file과 연결이 bundle 사본에서 그대로 읽히고 도구 file은 빠진다", async () => {
  const work = await mkdtemp(join(tmpdir(), "lophn-modules-"));
  try {
    const nm = `${work}/node_modules`;
    await mkdir(`${nm}/pkg`, { recursive: true });
    await mkdir(`${nm}/@scope`, { recursive: true });
    await mkdir(`${nm}/.bin`, { recursive: true });
    await writeFile(`${nm}/pkg/index.js`, "export const pkg = 1;");
    await writeFile(`${nm}/.package-lock.json`, "{}");
    await symlink("../pkg", `${nm}/@scope/pkg`);
    await symlink("../pkg/index.js", `${nm}/.bin/pkg`);

    const read = await readModules(work);
    assert.ok(read.ok);
    assert.deepStrictEqual(
      read.value.map((file) => file.path),
      ["node_modules/.lophn-links.json", "node_modules/pkg/index.js"],
    );

    const copy = `${work}/copy`;
    const sealed = await seal(copy, read.value);
    assert.ok(sealed.ok);
    assert.deepStrictEqual(
      await readFile(`${copy}/node_modules/pkg/index.js`, "utf8"),
      "export const pkg = 1;",
    );
    assert.deepStrictEqual(
      await readFile(`${copy}/node_modules/@scope/pkg/index.js`, "utf8"),
      "export const pkg = 1;",
    );
    for (const path of await walk(copy)) {
      const info = await lstat(`${copy}/${path}`);
      if (info.isSymbolicLink()) continue;
      if (process.platform === "win32") continue;
      assert.deepStrictEqual(
        info.mode & 0o777,
        info.isDirectory() ? 0o555 : 0o444,
        path,
      );
    }
  } finally {
    await chmod(`${work}/copy`, 0o755).catch(() => {});
    for await (const path of await walk(work).catch(() => [])) {
      await chmod(`${work}/${path}`, 0o755).catch(() => {});
    }
    await rm(work, { recursive: true });
  }
});

test("사본 밖을 가리키는 연결은 사본에 만들어지지 않는다", async () => {
  const work = await mkdtemp(join(tmpdir(), "lophn-modules-"));
  try {
    const copy = `${work}/deep/copy`;
    for (const target of [
      "../../../outside",
      "/etc",
      "../x/../../../outside",
    ]) {
      const links = [{ path: "node_modules/evil", target }];
      const sealed = await seal(copy, [
        {
          path: LINKS_PATH,
          bytes: encode(JSON.stringify(links)),
        },
      ]);
      assert.ok(!sealed.ok, target);
      assert.deepStrictEqual(sealed.error.code, "invalid_input");
    }
    assert.deepStrictEqual(await walk(work), []);
  } finally {
    await rm(work, { recursive: true });
  }
});
