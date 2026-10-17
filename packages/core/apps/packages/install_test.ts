import { assert, assertEquals } from "@std/assert";
import { sha256Hex } from "../../../base/mod.ts";
import { installSdkCopies, removeInstallCopy } from "./install.ts";

const REPO_PACKAGES = new URL("../../../", import.meta.url).pathname
  .replace(/\/$/, "");

async function withTemp(run: (dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir();
  try {
    await run(dir);
  } finally {
    await removeInstallCopy(dir);
  }
}

// 모든 file의 hash와 mode, 모든 폴더의 mode를 상대 경로 순으로 모은다.
async function snapshot(root: string): Promise<string[]> {
  const out: string[] = [];
  async function visit(directory: string, prefix: string) {
    out.push(
      `${prefix || "."}/ ${
        ((await Deno.stat(directory)).mode! & 0o777).toString(8)
      }`,
    );
    for await (const entry of Deno.readDir(directory)) {
      const path = `${directory}/${entry.name}`;
      const label = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory) await visit(path, label);
      else {
        const mode = (await Deno.stat(path)).mode! & 0o777;
        out.push(
          `${label} ${mode.toString(8)} ${await sha256Hex(
            await Deno.readFile(path),
          )}`,
        );
      }
    }
  }
  await visit(root, "");
  return out.sort();
}

async function tinyPackages(dir: string) {
  const put = (path: string, text: string) =>
    Deno.mkdir(`${dir}/${path.split("/").slice(0, -1).join("/")}`, {
      recursive: true,
    }).then(() => Deno.writeTextFile(`${dir}/${path}`, text));
  await put("sdk/demo/deno.json", '{"name":"@lophn/demo","version":"1.0.0"}');
  await put("sdk/demo/mod.ts", "export const a = 1;\n");
  await put("sdk/demo/mod_test.ts", "export const test = 1;\n");
  await put("design/deno.json", '{"name":"@lophn/ui","version":"1.0.0"}');
  await put("design/mod.ts", "export {};\n");
  await put(
    "design/wording/deno.json",
    '{"name":"@lophn/wording","version":"1.0.0"}',
  );
  await put("design/wording/mod.ts", "export {};\n");
}

Deno.test("설치 사본은 읽기 전용이고 다시 깔면 같고 소스가 바뀌면 새 byte로 바뀐다", async () => {
  await withTemp(async (temp) => {
    const packagesRoot = `${temp}/packages`;
    const dataRoot = `${temp}/data`;
    await tinyPackages(packagesRoot);

    const first = await installSdkCopies({ dataRoot, packagesRoot });
    assert(first.ok);
    assertEquals(first.value.map((item) => item.name), [
      "@lophn/demo",
      "@lophn/ui",
      "@lophn/wording",
    ]);
    // 판 폴더(`sdk/<이름>/<판>`)부터 아래가 사본이다. 위 두 단은 새 판을 놓으려고 쓸 수 있다.
    const copies = first.value.map((item) => item.install_path);
    const snapshotAll = async () =>
      (await Promise.all(copies.map(snapshot))).flat();
    const before = await snapshotAll();
    assert(before.every((line) => /\/ 555$| 444 /.test(line)));
    assert(!before.some((line) => line.includes("_test.ts")));

    assert((await installSdkCopies({ dataRoot, packagesRoot })).ok);
    assertEquals(await snapshotAll(), before);

    await Deno.writeTextFile(
      `${packagesRoot}/sdk/demo/mod.ts`,
      "export const a = 2;\n",
    );
    assert((await installSdkCopies({ dataRoot, packagesRoot })).ok);
    assertEquals(
      await Deno.readTextFile(`${dataRoot}/sdk/demo/1.0.0/mod.ts`),
      "export const a = 2;\n",
    );
    assert(
      (await snapshotAll()).every((line) => /\/ 555$| 444 /.test(line)),
    );
  });
});

Deno.test("깐 blueprint·cap-store·cap-problem 사본이 repo 없이 import된다", async () => {
  await withTemp(async (dataRoot) => {
    const installed = await installSdkCopies({
      dataRoot,
      packagesRoot: REPO_PACKAGES,
    });
    assert(installed.ok);
    for (const name of ["blueprint", "cap-store", "cap-problem"]) {
      const copy = await import(`file://${dataRoot}/sdk/${name}/1.0.0/mod.ts`);
      assert(Object.keys(copy).length > 0, name);
    }
  });
});
