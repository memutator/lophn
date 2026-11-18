// `computers` 폴더의 자기 하위 폴더에 서명한 file 목록을 쓴다: 앱마다 `apps/<app>/files.json`, 그 위에 `manifest.json`.
// 목록은 내보내기가 쓴 file의 기록(`folder_written`)과 자기 기록 file(`record.json`, `roster.json`)로 만들고 폴더를 훑지
// 않는다: 쓰는 중에 훑은 목록은 서명된 채 빠진 file이 있어 받는 쪽이 멀쩡한 사본을 지운다. 목록이 같으면 다시 쓰지 않는다.
import {
  canonicalize,
  type Clock,
  ok,
  type RandomSource,
  type Result,
  sha256Hex,
} from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import {
  APP_FILES_MAX_BYTES,
  appFilesPath,
  appFilesSchema,
  type CarryFileEntry,
  COMPUTERS_DESTINATION,
  MANIFEST_MAX_BYTES,
  type ManifestBody,
  manifestPath,
  nextManifestRevision,
  ROSTER_FILE_MAX_BYTES,
  rosterFilePath,
} from "../../../protocol/folder/carry.ts";
import {
  decodeRecord,
  encodeRecord,
  RECORD_MAX_BYTES,
  recordPath,
} from "../../../protocol/folder/mod.ts";
import type { Sql, Tx } from "../../../protocol/server/mod.ts";
import { createFolderReader, createFolderWriter } from "../fs.ts";
import { parseManifestText } from "../replica.ts";
import { updateStream } from "./status.ts";

export type ManifestDeps = {
  me: Id<"mch">;
  /** `computers` 폴더 경로. */
  root: string;
  sql: Pick<Sql, "get" | "all">;
  transaction<T>(fn: (tx: Pick<Tx, "sql">) => Result<T>): Result<T>;
  clock: Clock;
  random: RandomSource;
  /** 이 컴퓨터의 명단 서명 key로 만든 manifest 글. key가 없으면(remote를 켠 적이 없다) null. */
  sign(body: ManifestBody): string | null;
};

const encoder = new TextEncoder();

/** 이 컴퓨터가 마지막으로 쓴 앞 판들의 표시(다른 기계가 되돌려 준 자기 manifest의 revision) 가운데 큰 것. */
function ownMark(sql: Pick<Sql, "get">, me: Id<"mch">): number | null {
  const row = sql.get(
    "SELECT MAX(revision) AS revision FROM folder_carry_marks WHERE machine = ? AND origin = ?",
    [me, me],
  );
  return row?.revision == null ? null : Number(row.revision);
}

type WrittenFile = {
  path: string;
  app: string;
  stream: string;
  n: number | null;
  sha256: string;
  size: number;
};

// 앱 하나의 목록: `app.json`, data(마지막 snapshot과 그 뒤 번호, 끝난 것만), `source/<n>.json`, `release.json`, event file.
function appEntries(
  sql: Pick<Sql, "get">,
  me: Id<"mch">,
  app: string,
  rows: WrittenFile[],
): CarryFileEntry[] {
  const stream = sql.get(
    `SELECT next_n, last_snapshot_n FROM folder_streams
      WHERE machine = ? AND app = ? AND destination = ? AND stream = 'data'`,
    [me, app, COMPUTERS_DESTINATION],
  );
  const nextN = stream === undefined ? 1 : Number(stream.next_n);
  const snapshot =
    stream?.last_snapshot_n == null ? null : Number(stream.last_snapshot_n);
  return rows
    .filter((row) => {
      switch (row.stream) {
        case "data":
          return (
            row.n !== null &&
            snapshot !== null &&
            row.n >= snapshot &&
            row.n < nextN
          );
        case "source":
          return row.path.endsWith(".json");
        case "app":
        case "release":
        case "event":
          return true;
        default:
          return false;
      }
    })
    .map(({ path, size, sha256 }) => ({ path, size, sha256 }));
}

async function entryOf(
  path: string,
  bytes: Uint8Array,
): Promise<CarryFileEntry> {
  return { path, size: bytes.byteLength, sha256: await sha256Hex(bytes) };
}

/**
 * 앱 목록과 manifest를 지금 기록에 맞춘다. manifest를 새로 썼으면 true. 서명 key가 없으면 쓰지 않는다. 앱 목록이 한도를
 * 넘으면 지난 목록을 두고 그 앱 stream에 `too_large`를 남긴다(받는 쪽은 지난 목록으로 계속 받는다).
 */
export async function publishManifest(
  deps: ManifestDeps,
): Promise<Result<boolean>> {
  const { me, sql } = deps;
  const reader = createFolderReader(deps.root);
  const writer = createFolderWriter({
    root: deps.root,
    machine: me,
    random: deps.random,
  });
  const now = deps.clock.now();
  const top: CarryFileEntry[] = [];

  for (const [path, max] of [
    [recordPath(me), RECORD_MAX_BYTES],
    [rosterFilePath(me), ROSTER_FILE_MAX_BYTES],
  ] as const) {
    const read = await reader.read(path, max);
    if (read.ok) top.push(await entryOf(path, read.value));
  }

  const rows = sql
    .all(
      `SELECT path, app, stream, n, sha256, size FROM folder_written
        WHERE machine = ? AND destination = ? AND app != '' AND deleted_at IS NULL ORDER BY path`,
      [me, COMPUTERS_DESTINATION],
    )
    .map(
      (row): WrittenFile => ({
        path: String(row.path),
        app: String(row.app),
        stream: String(row.stream),
        n: row.n === null ? null : Number(row.n),
        sha256: String(row.sha256),
        size: Number(row.size),
      }),
    );
  const byApp = new Map<string, WrittenFile[]>();
  for (const row of rows) {
    byApp.set(row.app, [...(byApp.get(row.app) ?? []), row]);
  }
  for (const [app, appRows] of byApp) {
    const files = appEntries(sql, me, app, appRows);
    if (files.length === 0) continue;
    const path = appFilesPath(me, app as Id<"app">);
    const read = await reader.read(path, APP_FILES_MAX_BYTES);
    const held = read.ok
      ? decodeRecord(appFilesSchema, read.value, APP_FILES_MAX_BYTES)
      : null;
    if (held?.ok && canonicalize(held.value.files) === canonicalize(files)) {
      top.push(await entryOf(path, read.ok ? read.value : new Uint8Array()));
      continue;
    }
    const bytes = encodeRecord(appFilesSchema, {
      format: 1,
      machine: me,
      app,
      written_at: now,
      files,
    });
    if (bytes.byteLength > APP_FILES_MAX_BYTES) {
      const saved = deps.transaction((tx) => {
        updateStream(
          tx.sql,
          {
            machine: me,
            app,
            destination: COMPUTERS_DESTINATION,
            stream: "data",
          },
          {
            error: {
              code: "too_large",
              message: "too many files to carry",
              at: now,
            },
          },
        );
        return ok(undefined);
      });
      if (!saved.ok) return saved;
      if (held?.ok && read.ok) top.push(await entryOf(path, read.value));
      continue;
    }
    const written = await writer.writeFile(path, bytes);
    if (!written.ok) return written;
    top.push(await entryOf(path, bytes));
  }

  top.sort((a, b) => (a.path < b.path ? -1 : 1));
  const current = await reader.read(manifestPath(me), MANIFEST_MAX_BYTES);
  const before = current.ok
    ? parseManifestText(new TextDecoder().decode(current.value))
    : null;
  const mark = ownMark(sql, me) ?? 0;
  // 목록이 같아도 다른 기계가 되돌려 준 자기 manifest가 이 file보다 새면(data root를 되살렸다) 다시 낸다: 받는 쪽은 그보다
  // 크지 않은 revision을 받지 않는다.
  if (
    before !== null &&
    canonicalize(before.files) === canonicalize(top) &&
    mark <= before.revision
  ) {
    return ok(false);
  }
  const previous = Math.max(before?.revision ?? 0, mark);
  const text = deps.sign({
    format: 1,
    machine: me,
    revision: nextManifestRevision(
      previous === 0 ? null : previous,
      deps.clock.nowMs(),
    ),
    written_at: now,
    files: top,
  });
  if (text === null) return ok(false);
  const bytes = encoder.encode(text);
  // 기록 file과 앱마다 한 줄이라 닿을 일이 없다. 닿으면 지난 것을 둔다.
  if (bytes.byteLength > MANIFEST_MAX_BYTES) return ok(false);
  const written = await writer.writeFile(manifestPath(me), bytes);
  return written.ok ? ok(true) : written;
}
