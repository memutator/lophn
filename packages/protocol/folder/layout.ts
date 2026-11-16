// destination 아래의 배치. 모든 path는 destination 기준 상대 path(`/` 구분)이고 core가 OS path로 바꾼다.
// 읽는 쪽은 이 꼴과 정확히 맞는 이름만 본다: 충돌 사본(`… (1).changes`, `.sync-conflict-…`), temp, OS file은 없는 것이다.
import type { Id } from "../base/ids.ts";
import { idSchema } from "../base/ids.ts";

export type DataKind = "changes" | "snapshot";
export type SourceKind = "bundle" | "json";

export const MACHINES_DIR = "machines";
const NUMBER_DIGITS = 12;
const NUMBER_MAX = 10 ** NUMBER_DIGITS - 1;
const machineIdSchema = idSchema("mch");
const appIdSchema = idSchema("app");
const BUNDLE_HASH = /^[0-9a-f]{64}$/;
const DATA_ENTRY = /^([0-9]{12})\.(changes|snapshot)$/;
const SOURCE_ENTRY = /^([0-9]{12})\.(bundle|json)$/;
const TEMP_RANDOM = /^[0-9a-f]{16}$/;

// 번호는 stream마다 1부터 빈틈없이 는다.
export function entryNumber(n: number): string {
  if (!Number.isSafeInteger(n) || n < 1 || n > NUMBER_MAX) {
    throw new Error(`folder entry number out of range: ${n}`);
  }
  return String(n).padStart(NUMBER_DIGITS, "0");
}

function parseNumber(digits: string): number | null {
  const n = Number(digits);
  return n >= 1 ? n : null;
}

export const machineDir = (machine: Id<"mch">) => `${MACHINES_DIR}/${machine}`;
export const recordPath = (machine: Id<"mch">) =>
  `${machineDir(machine)}/record.json`;
export const appDir = (machine: Id<"mch">, app: Id<"app">) =>
  `${machineDir(machine)}/apps/${app}`;
export const appRecordPath = (machine: Id<"mch">, app: Id<"app">) =>
  `${appDir(machine, app)}/app.json`;
export const dataDir = (machine: Id<"mch">, app: Id<"app">) =>
  `${appDir(machine, app)}/data`;
export const dataEntryPath = (
  machine: Id<"mch">,
  app: Id<"app">,
  n: number,
  kind: DataKind,
) => `${dataDir(machine, app)}/${entryNumber(n)}.${kind}`;
export const releasesDir = (machine: Id<"mch">, app: Id<"app">) =>
  `${appDir(machine, app)}/releases`;
export const releaseDir = (
  machine: Id<"mch">,
  app: Id<"app">,
  bundleHash: string,
) => `${releasesDir(machine, app)}/${bundleHash}`;
export const releaseRecordPath = (
  machine: Id<"mch">,
  app: Id<"app">,
  bundleHash: string,
) => `${releaseDir(machine, app, bundleHash)}/release.json`;
// bundle 안 path(`release.json`의 files[].path)를 그대로 잇는다.
export const releaseFilePath = (
  machine: Id<"mch">,
  app: Id<"app">,
  bundleHash: string,
  path: string,
) => `${releaseDir(machine, app, bundleHash)}/files/${path}`;
export const sourceDir = (machine: Id<"mch">, app: Id<"app">) =>
  `${appDir(machine, app)}/source`;
export const sourcePath = (
  machine: Id<"mch">,
  app: Id<"app">,
  n: number,
  kind: SourceKind,
) => `${sourceDir(machine, app)}/${entryNumber(n)}.${kind}`;

// 같은 폴더의 temp. 앞에 점을 붙이지 않는다(sync 도구가 점 file을 빼거나 따로 다루는 일이 있다).
export function tempName(name: string, random: string): string {
  if (!TEMP_RANDOM.test(random)) {
    throw new Error("temp name random must be 16 lowercase hex");
  }
  return `${name}.tmp-${random}`;
}

export function parseDataEntry(
  name: string,
): { n: number; kind: DataKind } | null {
  const match = DATA_ENTRY.exec(name);
  if (match === null) return null;
  const n = parseNumber(match[1]!);
  return n === null ? null : { n, kind: match[2] as DataKind };
}

export function parseSourceEntry(
  name: string,
): { n: number; kind: SourceKind } | null {
  const match = SOURCE_ENTRY.exec(name);
  if (match === null) return null;
  const n = parseNumber(match[1]!);
  return n === null ? null : { n, kind: match[2] as SourceKind };
}

export const isMachineDirName = (name: string): name is Id<"mch"> =>
  machineIdSchema.safeParse(name).success;
export const isAppDirName = (name: string): name is Id<"app"> =>
  appIdSchema.safeParse(name).success;
export const isBundleHashName = (name: string) => BUNDLE_HASH.test(name);

// 변경·snapshot file의 path가 가리키는 주인, 앱, 번호, 꼴.
export function parseDataPath(rel: string): {
  machine: Id<"mch">;
  app: Id<"app">;
  n: number;
  kind: DataKind;
} | null {
  const parts = rel.split("/");
  if (
    parts.length !== 6 ||
    parts[0] !== MACHINES_DIR ||
    parts[2] !== "apps" ||
    parts[4] !== "data"
  ) {
    return null;
  }
  const [, machine, , app, , name] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const entry = parseDataEntry(name);
  if (!isMachineDirName(machine) || !isAppDirName(app) || entry === null) {
    return null;
  }
  return { machine, app, ...entry };
}

/**
 * 폴더 안 목록을 읽을 때 돌려줄 이름. 이름 꼴과 그 이름이 폴더인지 file인지를 정한다. 이 배치에서 목록을 읽지
 * 않는 폴더(release의 files 등. 목록 file이 싣는다)는 null이다.
 */
export function listingOf(
  dir: string,
): { accepts(name: string): boolean; directories: boolean } | null {
  const parts = dir.split("/");
  if (parts[0] !== MACHINES_DIR) return null;
  if (parts.length === 1)
    return { accepts: isMachineDirName, directories: true };
  if (!isMachineDirName(parts[1]!)) return null;
  if (parts.length === 3 && parts[2] === "apps") {
    return { accepts: isAppDirName, directories: true };
  }
  if (parts.length !== 5 || parts[2] !== "apps" || !isAppDirName(parts[3]!)) {
    return null;
  }
  switch (parts[4]) {
    case "data":
      return {
        accepts: (name) => parseDataEntry(name) !== null,
        directories: false,
      };
    case "source":
      return {
        accepts: (name) => parseSourceEntry(name) !== null,
        directories: false,
      };
    case "releases":
      return { accepts: isBundleHashName, directories: true };
    default:
      return null;
  }
}

// release의 files[].path처럼 기록이 싣는 상대 path. 폴더 밖이나 위를 가리키지 못한다.
const SEGMENT = /^[^/\\\0]+$/;
export function isSafeRelativePath(path: string): boolean {
  if (path.length === 0 || path.length > 1024) return false;
  if (/^[A-Za-z]:/.test(path)) return false;
  return path
    .split("/")
    .every(
      (segment) => SEGMENT.test(segment) && segment !== "." && segment !== "..",
    );
}
