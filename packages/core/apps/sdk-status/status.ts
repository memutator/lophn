// 앱이 고정한 SDK 판과 설치 사본(`<data>/sdk/<part>/<version>`)의 지금 판을 견준다. 고정 판은 앱의 켜진 release에 봉인된
// 선언의 sdk_dependencies(정확한 판)다. 보관한 앱은 앞에서 거른다(agent에게 없는 앱이고 감지에서도 뺀다).
import { readdir, readFile } from "node:fs/promises";
import { errorCode, ok, type Result } from "../../../base/mod.ts";
import type {
  AppSdkStatus,
  SdkLevel,
  SdkStatusEntry,
} from "../../../protocol/apps/sdk-status.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import { loadActiveDeclaration } from "../releases/store.ts";
import { loadApps } from "../registration/store.ts";

const NOTE_FILE = /^(.+)-(\d+\.\d+\.\d+)\.md$/;
const SDK_PREFIX = "@lophn/";

export function compareVersion(a: string, b: string): number {
  const left = a.split(/[.+-]/).map(Number);
  const right = b.split(/[.+-]/).map(Number);
  for (let at = 0; at < 3; at += 1) {
    const diff = (left[at] ?? 0) - (right[at] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export type Installed = { current: string; supportedFrom: string | null };

async function dirNames(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (cause) {
    if (errorCode(cause) === "ENOENT") return [];
    throw cause;
  }
}

// part마다 설치된 가장 높은 판과 그 판의 지원 하한이다.
async function readInstalled(
  dataRoot: string,
): Promise<Map<string, Installed>> {
  const installed = new Map<string, Installed>();
  for (const part of await dirNames(`${dataRoot}/sdk`)) {
    if (part.startsWith("@")) continue;
    const newest = (await dirNames(`${dataRoot}/sdk/${part}`))
      .sort(compareVersion)
      .at(-1);
    if (newest === undefined) continue;
    let supportedFrom: string | null = null;
    try {
      const manifest = JSON.parse(
        await readFile(
          `${dataRoot}/sdk/${part}/${newest}/package.json`,
          "utf8",
        ),
      );
      const floor = manifest?.lophn?.supported_from;
      if (typeof floor === "string") supportedFrom = floor;
    } catch (cause) {
      if (errorCode(cause) !== "ENOENT" && !(cause instanceof SyntaxError))
        throw cause;
    }
    installed.set(part, { current: newest, supportedFrom });
  }
  return installed;
}

// `<part>-<version>.md` 메모의 part별 판 목록이다.
async function readNotes(notesRoot: string): Promise<Map<string, string[]>> {
  const notes = new Map<string, string[]>();
  for (const file of await readdir(notesRoot)) {
    const found = NOTE_FILE.exec(file);
    if (found === null) continue;
    notes.set(found[1], [...(notes.get(found[1]) ?? []), found[2]]);
  }
  return notes;
}

// 고정 판 하나의 단계와 읽을 메모다. 지원 하한보다 옛 판은 required, 그 위에서 지금 판보다 옛 판은 available이다.
export function sdkEntry(
  pin: { name: string; version: string },
  installed: Installed,
  noteVersions: readonly string[],
  part: string,
): SdkStatusEntry {
  const level: SdkLevel =
    installed.supportedFrom !== null &&
    compareVersion(pin.version, installed.supportedFrom) < 0
      ? "required"
      : compareVersion(pin.version, installed.current) < 0
        ? "available"
        : "current";
  return {
    sdk: pin.name,
    pinned: pin.version,
    current: installed.current,
    supported_from: installed.supportedFrom,
    level,
    notes:
      level === "current"
        ? []
        : noteVersions
            .filter(
              (version) =>
                compareVersion(version, pin.version) > 0 &&
                compareVersion(version, installed.current) <= 0,
            )
            .sort(compareVersion)
            .map((version) => `${part}-${version}.md`),
  };
}

export type SdkStatusDeps = {
  dataRoot: string;
  // `migrate-sdk` skill 폴더(메모 file이 있는 곳).
  notesRoot: string;
  sql: Pick<Sql, "get" | "all">;
};

// allow가 false를 내는 앱은 뺀다(agent가 자기 범위 밖 앱을 못 보게).
export async function readSdkStatus(
  deps: SdkStatusDeps,
  filter: { app?: string; allow?: (app: string) => boolean } = {},
): Promise<Result<AppSdkStatus[]>> {
  const apps = loadApps(deps.sql, "active");
  if (!apps.ok) return apps;
  const installed = await readInstalled(deps.dataRoot);
  const notes = await readNotes(deps.notesRoot);
  const statuses: AppSdkStatus[] = [];
  for (const app of apps.value) {
    if (filter.app !== undefined && app.id !== filter.app) continue;
    if (filter.allow !== undefined && !filter.allow(app.id)) continue;
    const active = loadActiveDeclaration(deps.sql, app.id);
    if (!active.ok) return active;
    if (active.value === null) continue;
    const sdks: SdkStatusEntry[] = [];
    for (const pin of active.value.declaration.sdk_dependencies) {
      if (!pin.name.startsWith(SDK_PREFIX)) continue;
      const part = pin.name.slice(SDK_PREFIX.length);
      const now = installed.get(part);
      if (now === undefined) continue;
      sdks.push(sdkEntry(pin, now, notes.get(part) ?? [], part));
    }
    sdks.sort((a, b) => (a.sdk < b.sdk ? -1 : 1));
    statuses.push({
      app: app.id,
      name: app.name,
      release: active.value.release.id,
      sdks,
    });
  }
  return ok(statuses);
}
