import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { err, ok, sha256Hex } from "../../../base/mod.ts";
import {
  bundleBytes,
  packageInstallPath,
  prepareCopyFiles,
  removeInstallCopy,
  writeInstallCopy,
} from "./install.ts";
import { type MeVersion, reconcileMeCopies } from "./restore.ts";

const enc = new TextEncoder();
const FILES = [
  {
    path: "package.json",
    // 사본이 바꿔 쓴 file: 의존도 정확한 version으로 되돌려야 hash가 맞는다.
    bytes: enc.encode(
      '{\n  "name": "@me/lib",\n  "version": "1.0.0",\n  "dependencies": {\n    "@lophn/ui": "1.2.3",\n    "@me/base": "0.1.0"\n  }\n}\n',
    ),
  },
  { path: "src/index.ts", bytes: enc.encode("export const x = 1;\n") },
];

async function setup() {
  const dataRoot = await mkdtemp(join(tmpdir(), "restore-test-"));
  const bundle = bundleBytes(FILES);
  const version: MeVersion = {
    name: "@me/lib",
    description: "Lib.",
    version: "1.0.0",
    ownerApp: "app_x",
    permissions: [],
    bundleHash: await sha256Hex(bundle),
    guideHash: "a".repeat(64),
    hasBundleBlob: true,
  };
  const path = packageInstallPath("@me/lib", "1.0.0");
  assert.ok(path.ok);
  const target = `${dataRoot}/${path.value}`;
  // blob 읽기: hash가 맞는 byte만 있는 저장소.
  const blobs = new Map([[version.bundleHash, bundle]]);
  const read = (hash: string, offset: number, length: number) => {
    const bytes = blobs.get(hash);
    return Promise.resolve(
      bytes === undefined
        ? err({ code: "not_found" as const, message: "no blob" })
        : ok({
            sizeBytes: bytes.length,
            bytes: bytes.slice(offset, offset + length),
          }),
    );
  };
  const attached: string[] = [];
  const deps = {
    dataRoot,
    read,
    attachBundle: (v: MeVersion) => {
      attached.push(v.version);
      return Promise.resolve(ok(undefined));
    },
  };
  return { dataRoot, target, version, blobs, deps, attached };
}

test("설치 사본을 잃어도 bundle blob에서 같은 byte로 되살리고, hash가 다른 blob은 쓰지 않는다", async () => {
  const { dataRoot, target, version, blobs, deps } = await setup();
  try {
    const copy = prepareCopyFiles("@me/lib", "1.0.0", FILES);
    assert.ok(copy.ok);
    await writeInstallCopy(target, copy.value);
    await removeInstallCopy(target);

    const restored = await reconcileMeCopies({ ...deps, versions: [version] });
    assert.deepStrictEqual(restored.restored, ["@me/lib@1.0.0"]);
    for (const file of copy.value) {
      assert.deepStrictEqual(
        new Uint8Array(await readFile(`${target}/${file.path}`)),
        file.bytes,
      );
    }
    // 이미 같은 사본이면 건드리지 않는다.
    const again = await reconcileMeCopies({ ...deps, versions: [version] });
    assert.deepStrictEqual(again.restored, []);

    // blob의 byte가 bundle_hash와 다르면 사본을 쓰지 않고 건너뛴다.
    await removeInstallCopy(target);
    blobs.set(version.bundleHash, enc.encode("tampered"));
    const bad = await reconcileMeCopies({ ...deps, versions: [version] });
    assert.deepStrictEqual(bad.restored, []);
    assert.deepStrictEqual(bad.skipped.length, 1);
    await assert.rejects(readFile(`${target}/package.json`));
  } finally {
    await removeInstallCopy(dataRoot);
  }
});

test("blob이 없는 옛 판은 사본의 byte가 bundle_hash와 맞을 때만 blob을 붙인다", async () => {
  const { dataRoot, target, version, deps, attached } = await setup();
  try {
    const old = { ...version, hasBundleBlob: false };
    // 사본이 없으면 붙일 것이 없다.
    const none = await reconcileMeCopies({ ...deps, versions: [old] });
    assert.deepStrictEqual(none.attached, []);
    const copy = prepareCopyFiles("@me/lib", "1.0.0", FILES);
    assert.ok(copy.ok);
    await writeInstallCopy(target, copy.value);
    const done = await reconcileMeCopies({ ...deps, versions: [old] });
    assert.deepStrictEqual(done.attached, ["@me/lib@1.0.0"]);
    // 다른 byte를 가리키는 hash면 붙이지 않는다.
    const other = await reconcileMeCopies({
      ...deps,
      versions: [{ ...old, bundleHash: "c".repeat(64) }],
    });
    assert.deepStrictEqual(other.attached, []);
    assert.deepStrictEqual(attached, ["1.0.0"]);
  } finally {
    await removeInstallCopy(dataRoot);
  }
});
