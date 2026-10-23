import { assert, assertEquals } from "@std/assert";
import type { BundleManifest } from "../../../../protocol/apps/mod.ts";
import { LINKS_PATH } from "./links.ts";
import { sealBundle } from "./seal.ts";
import { readVendorFiles } from "./vendor.ts";

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
  for await (const entry of Deno.readDir(`${root}/${base}`)) {
    const path = base ? `${base}/${entry.name}` : entry.name;
    found.push(path);
    if (entry.isDirectory) found.push(...await walk(root, path));
  }
  return found;
}

Deno.test("bundle에 같은 file이 두 번 들어가지 않고 사본에서 연결로 읽힌다", async () => {
  const work = await Deno.makeTempDir();
  try {
    const nm = `${work}/node_modules`;
    await Deno.mkdir(`${nm}/.deno/a@1.0.0/node_modules/a`, { recursive: true });
    await Deno.mkdir(`${nm}/.deno/b@2.0.0/node_modules/b`, { recursive: true });
    await Deno.mkdir(`${nm}/@s`, { recursive: true });
    await Deno.writeTextFile(
      `${nm}/.deno/a@1.0.0/node_modules/a/index.js`,
      "export const a = 1;",
    );
    await Deno.writeTextFile(
      `${nm}/.deno/b@2.0.0/node_modules/b/index.js`,
      "export const b = 2;",
    );
    await Deno.symlink(".deno/a@1.0.0/node_modules/a", `${nm}/a`);
    await Deno.symlink("../.deno/b@2.0.0/node_modules/b", `${nm}/@s/b`);
    await Deno.symlink(
      "../../b@2.0.0/node_modules/b",
      `${nm}/.deno/a@1.0.0/node_modules/b`,
    );

    const read = await readVendorFiles(work);
    assert(read.ok);
    assertEquals(read.value.map((file) => file.path), [
      "node_modules/.deno/a@1.0.0/node_modules/a/index.js",
      "node_modules/.deno/b@2.0.0/node_modules/b/index.js",
      LINKS_PATH,
    ]);

    const copy = `${work}/copy`;
    const sealed = await seal(copy, read.value);
    assert(sealed.ok);
    assertEquals(
      await Deno.readTextFile(`${copy}/node_modules/a/index.js`),
      "export const a = 1;",
    );
    assertEquals(
      await Deno.readTextFile(`${copy}/node_modules/@s/b/index.js`),
      "export const b = 2;",
    );
    assertEquals(
      await Deno.readTextFile(
        `${copy}/node_modules/.deno/a@1.0.0/node_modules/b/index.js`,
      ),
      "export const b = 2;",
    );
    for (const path of await walk(copy)) {
      const info = await Deno.lstat(`${copy}/${path}`);
      if (info.isSymlink) continue;
      assertEquals(
        info.mode! & 0o777,
        info.isDirectory ? 0o555 : 0o444,
        path,
      );
    }
  } finally {
    await Deno.chmod(`${work}/copy`, 0o755).catch(() => {});
    for await (const path of await walk(work).catch(() => [])) {
      await Deno.chmod(`${work}/${path}`, 0o755).catch(() => {});
    }
    await Deno.remove(work, { recursive: true });
  }
});

Deno.test("사본 밖을 가리키는 연결은 사본에 만들어지지 않는다", async () => {
  const work = await Deno.makeTempDir();
  try {
    const copy = `${work}/deep/copy`;
    for (
      const target of [
        "../../../outside",
        "/etc",
        "../x/../../../outside",
      ]
    ) {
      const links = [{ path: "node_modules/evil", target }];
      const sealed = await seal(copy, [{
        path: LINKS_PATH,
        bytes: encode(JSON.stringify(links)),
      }]);
      assert(!sealed.ok, target);
      assertEquals(sealed.error.code, "invalid_input");
    }
    assertEquals(await walk(work), []);
  } finally {
    await Deno.remove(work, { recursive: true });
  }
});
