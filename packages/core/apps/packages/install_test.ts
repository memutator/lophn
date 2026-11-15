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
import { join, resolve, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sha256Hex } from "../../../base/mod.ts";
import {
  installSdkCopies,
  prepareCopyFiles,
  removeInstallCopy,
} from "./install.ts";

const REPO_PACKAGES = fileURLToPath(
  new URL("../../../", import.meta.url),
).replace(/[\\/]$/, "");

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
  // 폰 kit 사본이 vendor/로 담는 design file도 있어야 한다.
  await put(
    "design/native/package.json",
    '{"name":"@lophn/ui-native","version":"1.0.0"}',
  );
  await put("design/native/mod.ts", "export {};\n");
  await put("design/tokens.ts", "export {};\n");
  for (const file of ["model", "stream", "parse", "cache", "text", "url"]) {
    await put(`design/components/reading/markdown/${file}.ts`, "export {};\n");
  }
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
      ["@lophn/demo", "@lophn/ui", "@lophn/i18n", "@lophn/ui-native"],
    );
    // 판 폴더(`sdk/<이름>/<판>`)부터 아래가 사본이다. 위 두 단은 새 판을 놓으려고 쓸 수 있다.
    const copies = first.value.map((item) => item.install_path);
    const snapshotAll = async () =>
      (await Promise.all(copies.map(snapshot))).flat();
    const before = await snapshotAll();
    // Windows stat mode는 쓰기 비트만 비춘다.
    const posix = process.platform !== "win32";
    assert.ok(!posix || before.every((line) => /\/ 555$| 444 /.test(line)));
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
      !posix ||
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

test("깐 declaration·cap-store·cap-problem·agent 사본이 repo 없이 import된다", async () => {
  await withTemp(async (dataRoot) => {
    const installed = await installSdkCopies({
      dataRoot,
      packagesRoot: REPO_PACKAGES,
    });
    assert.ok(installed.ok);
    // agent의 mod.ts는 react를 import해 repo 밖에서 읽을 수 없다. react 없는 session.ts가 vendor한 reduce.ts까지 닿는다.
    const entries = {
      declaration: "mod.ts",
      "cap-store": "mod.ts",
      "cap-problem": "mod.ts",
      agent: "session.ts",
    };
    for (const [name, entry] of Object.entries(entries)) {
      const installedCopy = installed.value.find(
        (item) => item.name === `@lophn/${name}`,
      );
      assert.ok(installedCopy, name);
      const copy = await import(
        pathToFileURL(join(installedCopy.install_path, entry)).href
      );
      assert.ok(Object.keys(copy).length > 0, name);
    }
  });
});

// 사본 안 상대 import(`./`·`../`)가 사본 밖을 가리키면 앱 build가 사본만 가지고는 풀지 못한다.
async function danglingImports(copy: string): Promise<string[]> {
  const dangling: string[] = [];
  const specifier =
    /^\s*(?:import|export)\b[^"';]*?from\s*"(\.{1,2}\/[^"]+)"/gm;
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!/\.(?:ts|tsx)$/.test(entry.name)) continue;
      for (const match of (await readFile(path, "utf8")).matchAll(specifier)) {
        const target = resolve(directory, match[1] as string);
        const inside = target.startsWith(`${copy}${sep}`);
        if (!inside || !(await stat(target).catch(() => null))?.isFile()) {
          dangling.push(`${path.slice(copy.length + 1)} -> ${match[1]}`);
        }
      }
    }
  }
  await visit(copy);
  return dangling;
}

test("모든 SDK 사본은 자기 완결이고 @lophn/ui 사본에는 폰 kit이 들지 않는다", async () => {
  await withTemp(async (dataRoot) => {
    const installed = await installSdkCopies({
      dataRoot,
      packagesRoot: REPO_PACKAGES,
    });
    assert.ok(installed.ok);
    for (const item of installed.value) {
      assert.deepStrictEqual(
        await danglingImports(item.install_path),
        [],
        item.name,
      );
    }
    const names = installed.value.map((item) => item.name);
    assert.ok(names.includes("@lophn/ui-native"));
    const ui = installed.value.find((item) => item.name === "@lophn/ui");
    assert.ok(ui);
    assert.ok(!(await stat(join(ui.install_path, "native")).catch(() => null)));
  });
});

test("폴더 package.json의 name이나 version이 입력과 다르면 사본을 만들지 않는다", () => {
  const files = (manifest: object) => [
    {
      path: "package.json",
      bytes: new TextEncoder().encode(JSON.stringify(manifest)),
    },
  ];
  const code = (manifest: object) => {
    const result = prepareCopyFiles("@me/foo", "1.0.0", files(manifest));
    return result.ok ? "ok" : result.error.code;
  };
  assert.deepStrictEqual(code({ name: "@me/foo", version: "1.0.0" }), "ok");
  assert.deepStrictEqual(
    code({ name: "@me/other", version: "1.0.0" }),
    "invalid_input",
  );
  assert.deepStrictEqual(
    code({ name: "@me/foo", version: "1.0.1" }),
    "invalid_input",
  );
  assert.deepStrictEqual(code({ name: "@me/foo" }), "invalid_input");
});
