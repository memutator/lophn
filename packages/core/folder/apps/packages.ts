// 앱이 기대는 `@me/*` package를 기계 사이로 옮긴다. 내보내기는 앱이 활성 release의 commit에서 고정한 `@me/*` version(과 그
// package가 의존하는 것)을 `machines/<자기>/packages/<part>@<version>.json`으로 쓰고, take-in은 이 기계에 없는 version을
// 다른 기계의 그 file에서 받아 자기 catalog에 등록하고 설치 사본을 쓴다(release 준비가 그 사본을 쓴다).
// file은 앱 file과 같은 사슬(manifest 서명, 크기·sha256)로 오고, 받는 쪽은 안의 hash도 다시 맞춘다.
import { stat } from "node:fs/promises";
import { ok, type Result, sha256Hex } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import {
  decodeRecord,
  encodeRecord,
  FOLDER_FORMAT,
  PACKAGE_FILE_MAX_BYTES,
  packageFilePath,
  packageFileSchema,
} from "../../../protocol/folder/mod.ts";
import { createFolderReader } from "../fs.ts";
import type {
  CarriedPackage,
  FolderAppRecordCopy,
  FolderAppsDeps,
  FolderAppsHost,
} from "./deps.ts";
import { git } from "./git.ts";
import type { Target } from "./target.ts";

const SDK_FILE_DEP = /^file:(?:\.\/)?\.lophn\/sdk\/(.+)$/;

type Pin = { name: string; version: string };

/** commit의 `package.json`이 고정한 `@lophn/*`(sdk)와 `@me/*`(mine) 사본. 읽지 못하면 둘 다 빈 목록이다. */
export async function commitDependencies(
  repo: string,
  commit: string,
): Promise<{ sdk: Pin[]; mine: Pin[] }> {
  const out = { sdk: [] as Pin[], mine: [] as Pin[] };
  const shown = await git(repo, "show", `${commit}:package.json`);
  if (!shown.ok) return out;
  let manifest: {
    dependencies?: Record<string, unknown>;
    devDependencies?: Record<string, unknown>;
  };
  try {
    manifest = JSON.parse(shown.value);
  } catch {
    return out;
  }
  if (typeof manifest !== "object" || manifest === null) return out;
  const all = { ...manifest.devDependencies, ...manifest.dependencies };
  for (const name of Object.keys(all).sort()) {
    const value = all[name];
    if (typeof value !== "string") continue;
    const match = SDK_FILE_DEP.exec(value);
    if (match === null) continue;
    const rest = match[1]!;
    if (rest.startsWith("@me/")) {
      const parts = rest.slice("@me/".length).split("/");
      if (parts.length !== 2) continue;
      const [part, version] = parts as [string, string];
      if (name === `@me/${part}`) out.mine.push({ name, version });
    } else {
      const parts = rest.split("/");
      if (parts.length !== 2) continue;
      const [part, version] = parts as [string, string];
      if (name === `@lophn/${part}`) out.sdk.push({ name, version });
    }
  }
  return out;
}

export async function isInstalledPackage(path: string): Promise<boolean> {
  try {
    return (await stat(`${path}/package.json`)).isFile();
  } catch {
    return false;
  }
}

/** catalog에 등록되어 있고 설치 사본이 있다. */
export async function hasMePackage(
  host: FolderAppsHost,
  dataRoot: string,
  pin: Pin,
): Promise<boolean> {
  return (
    host.published(pin.name, pin.version) &&
    (await isInstalledPackage(
      `${dataRoot}/sdk/@me/${pin.name.slice("@me/".length)}/${pin.version}`,
    ))
  );
}

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/**
 * 이 앱의 활성 release가 고정한 `@me/*` version을 자기 하위 폴더 `packages/`에 쓴다. 이 기계 catalog에 없는 것(다른
 * 기계에서 받아 온 사본이 아니다)과 한도(`PACKAGE_FILE_MAX_BYTES`)를 넘는 것은 건너뛴다. file은 version마다 바뀌지
 * 않아 같은 bytes가 이미 있으면 다시 쓰지 않는다.
 */
export async function exportPackages(
  target: Target,
  host: FolderAppsHost,
): Promise<Result<void>> {
  const { app } = target;
  if (app.source_path === null || app.release === null) return ok(undefined);
  const queue = (
    await commitDependencies(app.source_path, app.release.code_commit)
  ).mine;
  const seen = new Set<string>();
  for (let pin = queue.shift(); pin !== undefined; pin = queue.shift()) {
    const key = `${pin.name}@${pin.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const found = await host.carriedPackage(pin.name, pin.version);
    if (!found.ok) return found;
    const pkg = found.value;
    if (pkg === null) continue;
    queue.push(...pkg.requires);
    const bytes = encodeRecord(packageFileSchema, {
      format: FOLDER_FORMAT.version,
      machine: target.me,
      name: pkg.name,
      version: pkg.version,
      description: pkg.description,
      owner_app: pkg.owner_app,
      permissions: pkg.permissions,
      requires: pkg.requires,
      bundle_hash: await sha256Hex(pkg.bundle),
      guide_hash: await sha256Hex(pkg.guide),
      bundle: base64(pkg.bundle),
      guide: base64(pkg.guide),
    });
    if (bytes.byteLength > PACKAGE_FILE_MAX_BYTES) continue;
    const path = packageFilePath(target.me, pkg.name, pkg.version);
    const held = await target.reader.read(path, PACKAGE_FILE_MAX_BYTES);
    if (
      held.ok &&
      held.value.byteLength === bytes.byteLength &&
      held.value.every((byte, i) => byte === bytes[i])
    ) {
      continue;
    }
    const written = await target.writer.writeFile(path, bytes);
    if (!written.ok) return written;
  }
  return ok(undefined);
}

// 받은 file 하나를 검사한다. 난 기계·이름·version이 path와 같고 안의 hash가 bytes와 맞아야 한다.
async function readPackageFile(
  bytes: Uint8Array,
  origin: Id<"mch">,
  pin: Pin,
): Promise<CarriedPackage | null> {
  const decoded = decodeRecord(
    packageFileSchema,
    bytes,
    PACKAGE_FILE_MAX_BYTES,
  );
  if (!decoded.ok) return null;
  const file = decoded.value;
  if (
    file.machine !== origin ||
    file.name !== pin.name ||
    file.version !== pin.version
  ) {
    return null;
  }
  const bundle = Buffer.from(file.bundle, "base64");
  const guide = Buffer.from(file.guide, "base64");
  if (
    (await sha256Hex(bundle)) !== file.bundle_hash ||
    (await sha256Hex(guide)) !== file.guide_hash
  ) {
    return null;
  }
  return {
    name: file.name,
    version: file.version,
    description: file.description,
    owner_app: file.owner_app as Id<"app">,
    permissions: file.permissions,
    requires: file.requires,
    bundle,
    guide,
  };
}

/**
 * 이 기계에 없는 `@me/*` version을 다른 기계들의 `packages/`에서 받아 들인다. 이 앱을 내놓은 기계(`preferredOrigin`
 * 우선)를 먼저 보고, 없으면 다른 알려진 기계도 본다. 의존하는 package를 먼저 들인다.
 * 어느 기계에도 없거나 검사에 걸리면 들이지 않고 지나간다(부르는 쪽이 아직 빠진 것을 `dependency_missing`으로 알린다).
 */
export async function takeInPackages(
  deps: FolderAppsDeps,
  host: FolderAppsHost,
  copies: readonly FolderAppRecordCopy[],
  app: Id<"app">,
  wanted: readonly Pin[],
  preferredOrigin?: Id<"mch">,
): Promise<Result<void>> {
  const seenPeers = new Set<string>();
  const ordered = [
    ...copies
      .filter((copy) => copy.record.app === app)
      .sort((a, b) => {
        if (preferredOrigin !== undefined) {
          if (a.origin === preferredOrigin && b.origin !== preferredOrigin) {
            return -1;
          }
          if (b.origin === preferredOrigin && a.origin !== preferredOrigin) {
            return 1;
          }
        }
        return a.origin < b.origin ? -1 : a.origin > b.origin ? 1 : 0;
      }),
    ...copies
      .filter((copy) => copy.record.app !== app)
      .sort((a, b) => (a.origin < b.origin ? -1 : a.origin > b.origin ? 1 : 0)),
  ];
  const peers = ordered.flatMap((copy) => {
    const key = `${copy.destination}\0${copy.origin}`;
    if (seenPeers.has(key)) return [];
    seenPeers.add(key);
    const destination = deps.destinations.resolve(copy.destination);
    return destination === null || destination.state === "missing"
      ? []
      : [{ origin: copy.origin, reader: createFolderReader(destination.path) }];
  });

  const visiting = new Set<string>();
  // true면 이 기계에 있다(이미 있었거나 방금 들였다).
  async function install(pin: Pin): Promise<Result<boolean>> {
    if (await hasMePackage(host, deps.dataRoot, pin)) return ok(true);
    const key = `${pin.name}@${pin.version}`;
    if (visiting.has(key)) return ok(false);
    visiting.add(key);
    for (const peer of peers) {
      const read = await peer.reader.read(
        packageFilePath(peer.origin, pin.name, pin.version),
        PACKAGE_FILE_MAX_BYTES,
      );
      if (!read.ok) continue;
      const pkg = await readPackageFile(read.value, peer.origin, pin);
      if (pkg === null) continue;
      let depsReady = true;
      for (const need of pkg.requires) {
        const done = await install(need);
        if (!done.ok) return done;
        if (!done.value) {
          depsReady = false;
          break;
        }
      }
      if (!depsReady) continue;
      const installed = await host.installPackage(pkg);
      if (installed.ok) return ok(true);
      // 한 기계의 package file이 깨지거나 위조됐으면 다음 기계를 본다.
      if (installed.error.code === "invalid_input") continue;
      return installed;
    }
    return ok(false);
  }

  for (const pin of wanted) {
    const done = await install(pin);
    if (!done.ok) return done;
  }
  return ok(undefined);
}
