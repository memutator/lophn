import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { sha256Hex } from "../../../base/mod.ts";
import { installSdkCopies, removeInstallCopy } from "./install.ts";

const REPO_PACKAGES = new URL("../../../", import.meta.url).pathname.replace(
  /\/$/,
  "",
);

async function withTemp(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "install-test-"));
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
      `${prefix || "."}/ ${((await stat(directory)).mode & 0o777).toString(8)}`,
    );
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      const label = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(path, label);
      else {
        const mode = (await stat(path)).mode & 0o777;
        out.push(
          `${label} ${mode.toString(8)} ${await sha256Hex(
            await readFile(path),
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
    mkdir(`${dir}/${path.split("/").slice(0, -1).join("/")}`, {
      recursive: true,
    }).then(() => writeFile(`${dir}/${path}`, text));
  await put(
    "sdk/demo/package.json",
    '{"name":"@lophn/demo","version":"1.0.0"}',
  );
  await put("sdk/demo/mod.ts", "export const a = 1;\n");
  await put("sdk/demo/mod_test.ts", "export const test = 1;\n");
  await put("design/package.json", '{"name":"@lophn/ui","version":"1.0.0"}');
  await put("design/mod.ts", "export {};\n");
  await put(
    "design/i18n/package.json",
    '{"name":"@lophn/i18n","version":"1.0.0"}',
  );
  await put("design/i18n/mod.ts", "export {};\n");
}

test("설치 사본은 읽기 전용이고 다시 깔면 같고 소스가 바뀌면 새 byte로 바뀐다", async () => {
  await withTemp(async (temp) => {
    const packagesRoot = `${temp}/packages`;
    const dataRoot = `${temp}/data`;
    await tinyPackages(packagesRoot);

    const first = await installSdkCopies({ dataRoot, packagesRoot });
    assert.ok(first.ok);
    assert.deepStrictEqual(
      first.value.map((item) => item.name),
      ["@lophn/demo", "@lophn/ui", "@lophn/i18n"],
    );
    // 판 폴더(`sdk/<이름>/<판>`)부터 아래가 사본이다. 위 두 단은 새 판을 놓으려고 쓸 수 있다.
    const copies = first.value.map((item) => item.install_path);
    const snapshotAll = async () =>
      (await Promise.all(copies.map(snapshot))).flat();
    const before = await snapshotAll();
    assert.ok(before.every((line) => /\/ 555$| 444 /.test(line)));
    assert.ok(!before.some((line) => line.includes("_test.ts")));

    assert.ok((await installSdkCopies({ dataRoot, packagesRoot })).ok);
    assert.deepStrictEqual(await snapshotAll(), before);

    await writeFile(`${packagesRoot}/sdk/demo/mod.ts`, "export const a = 2;\n");
    assert.ok((await installSdkCopies({ dataRoot, packagesRoot })).ok);
    assert.deepStrictEqual(
      await readFile(`${dataRoot}/sdk/demo/1.0.0/mod.ts`, "utf8"),
      "export const a = 2;\n",
    );
    assert.ok(
      (await snapshotAll()).every((line) => /\/ 555$| 444 /.test(line)),
    );
  });
});

test("사본은 package.json을 갖고 SDK 사본 의존을 상대 file: 경로로 바꾼다", async () => {
  await withTemp(async (temp) => {
    const packagesRoot = `${temp}/packages`;
    const dataRoot = `${temp}/data`;
    await tinyPackages(packagesRoot);
    const uiManifest = (demo: string) =>
      JSON.stringify({
        name: "@lophn/ui",
        version: "1.0.0",
        dependencies: { "@lophn/demo": demo, react: "19.3.0" },
      });
    await writeFile(`${packagesRoot}/design/package.json`, uiManifest("1.0.0"));

    assert.ok((await installSdkCopies({ dataRoot, packagesRoot })).ok);
    const manifest = JSON.parse(
      await readFile(`${dataRoot}/sdk/ui/1.0.0/package.json`, "utf8"),
    );
    assert.deepStrictEqual(manifest.dependencies, {
      "@lophn/demo": "file:../../demo/1.0.0",
      react: "19.3.0",
    });

    // 사본의 의존은 정확한 판만 된다. 범위는 install path를 만들 수 없다.
    await writeFile(
      `${packagesRoot}/design/package.json`,
      uiManifest("^1.0.0"),
    );
    const failed = await installSdkCopies({ dataRoot, packagesRoot });
    assert.deepStrictEqual(failed.ok, false);
    assert.deepStrictEqual(
      failed.ok ? undefined : failed.error.code,
      "invalid_input",
    );
  });
});

test("깐 declaration·cap-store·cap-problem 사본이 repo 없이 import된다", async () => {
  await withTemp(async (dataRoot) => {
    const installed = await installSdkCopies({
      dataRoot,
      packagesRoot: REPO_PACKAGES,
    });
    assert.ok(installed.ok);
    for (const name of ["declaration", "cap-store", "cap-problem"]) {
      const copy = await import(`file://${dataRoot}/sdk/${name}/1.0.0/mod.ts`);
      assert.ok(Object.keys(copy).length > 0, name);
    }
  });
});
