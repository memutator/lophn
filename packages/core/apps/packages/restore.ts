// @me 설치 사본을 catalog와 bundle blob에 맞춘다. core가 뜰 때 한 번 돈다.
// 정본은 ledger의 `package_version/bundle` blob이고 사본은 파생이다. 사본이 없거나 다르면 blob에서 다시 쓴다.
// 옛 판(blob 등록 전에 publish한 판)은 사본의 byte가 bundle_hash와 맞을 때만 그 byte로 blob을 붙인다.

import { readdir, readFile } from "node:fs/promises";
import { posix } from "node:path";

import { err, ok, type Result, sha256Hex } from "../../../base/mod.ts";
import {
  bundleBytes,
  bundleFiles,
  packageInstallPath,
  prepareCopyFiles,
  removeInstallCopy,
  sameInstallCopy,
  writeInstallCopy,
} from "./install.ts";
import type { SourceFile } from "./vendor.ts";

// 되살릴 @me version 하나. 읽은 catalog 행이다.
export type MeVersion = {
  name: string;
  description: string;
  version: string;
  ownerApp: string | null;
  permissions: string[];
  bundleHash: string;
  guideHash: string;
  hasBundleBlob: boolean;
};

type ReadWindow = (
  hash: string,
  offset: number,
  length: number,
) => Promise<Result<{ sizeBytes: number; bytes: Uint8Array }>>;

const WINDOW = 256 * 1024;

// blob 전체를 창 단위로 읽는다.
export async function readWholeBlob(
  read: ReadWindow,
  hash: string,
): Promise<Result<Uint8Array>> {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  let size = Number.POSITIVE_INFINITY;
  while (offset < size) {
    const window = await read(hash, offset, WINDOW);
    if (!window.ok) return window;
    if (window.value.bytes.length === 0) {
      return err({ code: "unavailable", message: "blob ended early" });
    }
    size = window.value.sizeBytes;
    chunks.push(window.value.bytes);
    offset += window.value.bytes.length;
  }
  const out = new Uint8Array(offset);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return ok(out);
}

async function readCopyFiles(target: string): Promise<SourceFile[] | null> {
  const files: SourceFile[] = [];
  async function visit(directory: string, prefix: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(`${directory}/${entry.name}`, path);
      else
        files.push({
          path,
          bytes: await readFile(`${directory}/${entry.name}`),
        });
    }
  }
  try {
    await visit(target, "");
  } catch {
    return null;
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// 사본의 package.json이 바꿔 쓴 `file:` 의존을 정확한 version으로 되돌린다. 원문과 글자 하나라도 다르면
// 호출한 쪽의 hash 비교가 걸러내므로 되돌린 결과를 믿지 않고 비교만 한다.
function sourceFilesOfCopy(
  installPath: string,
  files: readonly SourceFile[],
): SourceFile[] {
  return files.map((file) => {
    if (file.path !== "package.json") return file;
    try {
      const manifest = JSON.parse(new TextDecoder().decode(file.bytes));
      for (const field of ["dependencies", "devDependencies"]) {
        const dependencies = manifest[field];
        if (typeof dependencies !== "object" || dependencies === null) continue;
        for (const [name, value] of Object.entries(dependencies)) {
          if (typeof value !== "string" || !value.startsWith("file:")) continue;
          const target = posix.join(installPath, value.slice("file:".length));
          const found =
            /^sdk\/@me\/([^/]+)\/([^/]+)$/.exec(target) ??
            /^sdk\/([^/]+)\/([^/]+)$/.exec(target);
          if (found?.[2] !== undefined) dependencies[name] = found[2];
        }
      }
      return {
        path: file.path,
        bytes: new TextEncoder().encode(
          `${JSON.stringify(manifest, null, 2)}\n`,
        ),
      };
    } catch {
      return file;
    }
  });
}

export type ReconcileResult = {
  restored: string[];
  attached: string[];
  skipped: { version: string; reason: string }[];
};

// 한 version이 실패해도 다음 version을 계속한다. 사본 하나 때문에 core 기동을 막지 않는다.
export async function reconcileMeCopies(deps: {
  dataRoot: string;
  versions: readonly MeVersion[];
  read: ReadWindow;
  // 사본 byte로 만든 bundle을 blob으로 준비해 register_version으로 붙인다.
  attachBundle(version: MeVersion, bundle: Uint8Array): Promise<Result<void>>;
}): Promise<ReconcileResult> {
  const result: ReconcileResult = { restored: [], attached: [], skipped: [] };
  for (const version of deps.versions) {
    const id = `${version.name}@${version.version}`;
    const skip = (reason: string) =>
      result.skipped.push({ version: id, reason });
    const path = packageInstallPath(version.name, version.version);
    if (!path.ok) {
      skip(path.error.message);
      continue;
    }
    const target = `${deps.dataRoot}/${path.value}`;
    if (!version.hasBundleBlob) {
      const copy = await readCopyFiles(target);
      if (copy === null) {
        skip("no bundle blob and no install copy");
        continue;
      }
      const bundle = bundleBytes(sourceFilesOfCopy(path.value, copy));
      if ((await sha256Hex(bundle)) !== version.bundleHash) {
        skip("no bundle blob and the install copy does not match bundle_hash");
        continue;
      }
      const attached = await deps.attachBundle(version, bundle);
      if (attached.ok) result.attached.push(id);
      else skip(`bundle blob attach failed: ${attached.error.message}`);
      continue;
    }
    const bytes = await readWholeBlob(deps.read, version.bundleHash);
    if (!bytes.ok) {
      skip(`bundle blob unreadable: ${bytes.error.message}`);
      continue;
    }
    if ((await sha256Hex(bytes.value)) !== version.bundleHash) {
      skip("bundle blob does not match bundle_hash");
      continue;
    }
    const files = bundleFiles(bytes.value);
    if (!files.ok) {
      skip(files.error.message);
      continue;
    }
    const copy = prepareCopyFiles(version.name, version.version, files.value);
    if (!copy.ok) {
      skip(copy.error.message);
      continue;
    }
    if (await sameInstallCopy(target, copy.value)) continue;
    await removeInstallCopy(target);
    const written = await writeInstallCopy(target, copy.value);
    if (written.ok) result.restored.push(id);
    else skip(written.error.message);
  }
  return result;
}
