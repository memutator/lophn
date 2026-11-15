import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { phoneBackendManifestSchema } from "../../../../protocol/apps/mod.ts";
import { installSdkCopies } from "../../packages/install.ts";
import { syncAppSdk } from "../../packages/sdk-sync.ts";
import { makeTreeWritable } from "../bundle/seal.ts";
import { buildPhoneBackend, type PhoneBackendDeclaration } from "./build.ts";
import { loadCheckPhoneBackend } from "./load-check.ts";

const PACKAGES = fileURLToPath(new URL("../../../../", import.meta.url));
const FIXTURE = fileURLToPath(
  new URL("../../../../../tests/support/app/local", import.meta.url),
);

let dataRoot: string;
before(async () => {
  dataRoot = await mkdtemp(`${tmpdir()}/`);
  const installed = await installSdkCopies({
    dataRoot,
    packagesRoot: PACKAGES,
  });
  assert.ok(installed.ok);
});
after(async () => {
  await makeTreeWritable(dataRoot);
  await rm(dataRoot, { recursive: true, force: true });
  await esbuild.stop();
});

// SDK 사본은 읽기 전용이라 권한을 돌려야 지워진다.
async function discard(dir: string) {
  await makeTreeWritable(dir);
  await rm(dir, { recursive: true, force: true });
}

// 준비가 하는 것과 같은 staging이다: fixture 앱 + `.lophn/sdk` 사본 + npm이 거는 node_modules 링크.
async function stage(handlers?: string) {
  const staging = await mkdtemp(`${tmpdir()}/`);
  // `.tmpl`은 저장소 도구가 fixture를 앱으로 읽지 않게 하는 표시다.
  for (const entry of await readdir(FIXTURE, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name).slice(FIXTURE.length + 1);
    await mkdir(dirname(join(staging, path)), { recursive: true });
    await writeFile(
      join(staging, path.replace(/\.tmpl$/, "")),
      await readFile(join(FIXTURE, path)),
    );
  }
  if (handlers !== undefined) {
    await writeFile(join(staging, "src/handlers.ts"), handlers);
  }
  const synced = await syncAppSdk(staging, dataRoot);
  assert.ok(synced.ok);
  for (const path of synced.value) {
    const [, part, version] = path.split("/");
    await mkdir(join(staging, "node_modules/@lophn"), { recursive: true });
    await symlink(
      join(staging, ".lophn/sdk", part, version),
      join(staging, "node_modules/@lophn", part),
    );
  }
  const loaded = await import(pathToFileURL(join(staging, "lophn.ts")).href);
  return { staging, declaration: loaded.default as PhoneBackendDeclaration };
}

test("폰 backend build는 Node 내장과 @lophn/cap-fs·@lophn/flow를 담지 않는다: 그런 import가 있으면 어느 file의 어느 import인지 말하며 실패하고, 성공한 backend.js에는 require(와 node:가 없다", async () => {
  const ok = await stage();
  try {
    const built = await buildPhoneBackend(ok.staging, ok.declaration);
    assert.ok(built.ok, built.ok ? "" : built.error.message);
    assert.ok(
      phoneBackendManifestSchema.safeParse(built.value.manifest).success,
    );
    assert.deepEqual(built.value.manifest.operations, {
      list_items: "read",
      add_item: "write",
      send_report: "external",
    });
    assert.equal(built.value.manifest.data_schema, 1);
    const js = await readFile(join(ok.staging, "phone/backend.js"), "utf8");
    assert.ok(!js.includes("require("));
    assert.ok(!js.includes("node:"));
    const loaded = await loadCheckPhoneBackend(ok.staging, ok.declaration);
    assert.ok(loaded.ok);
    assert.deepEqual(loaded.value.handlers.sort(), [
      "add_item",
      "list_items",
      "send_report",
    ]);
  } finally {
    await discard(ok.staging);
  }

  for (const specifier of ["node:fs", "fs", "@lophn/cap-fs", "@lophn/flow"]) {
    const bad = await stage(`import "${specifier}";\n`);
    try {
      const built = await buildPhoneBackend(bad.staging, bad.declaration);
      assert.ok(!built.ok);
      assert.equal(
        built.error.message,
        `a backend that runs on the phone cannot import ${specifier} (src/handlers.ts)`,
      );
    } finally {
      await discard(bad.staging);
    }
  }
});

test("load 검사는 선언과 등록한 handler가 다르면(빠지거나 남으면) 실패한다", async () => {
  const app = await stage();
  try {
    const built = await buildPhoneBackend(app.staging, app.declaration);
    assert.ok(built.ok);
    const missing = await loadCheckPhoneBackend(app.staging, {
      ...app.declaration,
      operations: [
        ...app.declaration.operations,
        { name: "delete_item", effect: "write" },
      ],
    });
    assert.ok(!missing.ok);
    assert.match(missing.error.message, /does not register delete_item/);
    const extra = await loadCheckPhoneBackend(app.staging, {
      ...app.declaration,
      operations: app.declaration.operations.filter(
        (operation) => operation.name !== "send_report",
      ),
    });
    assert.ok(!extra.ok);
    assert.match(extra.error.message, /registers send_report/);
  } finally {
    await discard(app.staging);
  }
});
