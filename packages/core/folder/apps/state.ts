// 이 module이 folder 표(schema.ts)에 두는 상태. 행의 machine은 지금 기계 id다.
// - folder_streams: stream `app`(next_n = 다음 revision), `source`(next_n = 다음 bundle 번호). error는 FolderError JSON.
// - folder_written: 쓴 `app.json`(n = revision, written_at = updated_at), release 폴더(path는 그 `release.json`, stream
//   `release`), source file(stream `source`).
// - folder_reads: 다른 기계 source의 받은 번호(stream `source`).
import type { Id } from "../../../protocol/base/ids.ts";
import type { FolderError } from "../../../protocol/folder/mod.ts";
import type { Sql } from "../../../protocol/server/mod.ts";

export type Written = {
  path: string;
  n: number | null;
  sha256: string;
  written_at: string;
};

export function written(
  sql: Sql,
  machine: Id<"mch">,
  destination: string,
  path: string,
): Written | null {
  const row = sql.get(
    `SELECT path, n, sha256, written_at FROM folder_written
      WHERE machine = ? AND destination = ? AND path = ? AND deleted_at IS NULL`,
    [machine, destination, path],
  );
  return row === undefined
    ? null
    : {
        path: String(row.path),
        n: row.n === null ? null : Number(row.n),
        sha256: String(row.sha256),
        written_at: String(row.written_at),
      };
}

export function recordWritten(
  sql: Sql,
  row: {
    machine: Id<"mch">;
    destination: string;
    path: string;
    app: Id<"app">;
    stream: "app" | "release" | "source";
    n: number | null;
    sha256: string;
    size: number;
    at: string;
  },
): void {
  sql.run(
    `INSERT INTO folder_written
       (machine, destination, path, app, stream, n, sha256, size, written_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT (machine, destination, path) DO UPDATE SET
       app = excluded.app, stream = excluded.stream, n = excluded.n, sha256 = excluded.sha256,
       size = excluded.size, written_at = excluded.written_at, deleted_at = NULL`,
    [
      row.machine,
      row.destination,
      row.path,
      row.app,
      row.stream,
      row.n,
      row.sha256,
      row.size,
      row.at,
    ],
  );
}

/** 이 기계가 쓴 release 폴더(지우지 않은 것)의 `release.json` path와 쓴 때. */
export function writtenReleases(
  sql: Sql,
  machine: Id<"mch">,
  destination: string,
  app: Id<"app">,
): { path: string; written_at: string }[] {
  return sql
    .all(
      `SELECT path, written_at FROM folder_written
        WHERE machine = ? AND destination = ? AND app = ? AND stream = 'release' AND deleted_at IS NULL
        ORDER BY written_at DESC, path`,
      [machine, destination, app],
    )
    .map((row) => ({
      path: String(row.path),
      written_at: String(row.written_at),
    }));
}

export function markDeleted(
  sql: Sql,
  machine: Id<"mch">,
  destination: string,
  path: string,
  at: string,
): void {
  sql.run(
    `UPDATE folder_written SET deleted_at = ? WHERE machine = ? AND destination = ? AND path = ?`,
    [at, machine, destination, path],
  );
}

export type StreamName = "data" | "source" | "app";

export function streamOf(
  sql: Sql,
  machine: Id<"mch">,
  app: Id<"app">,
  destination: string,
  stream: StreamName,
): { next_n: number; last_snapshot_n: number | null } | null {
  const row = sql.get(
    `SELECT next_n, last_snapshot_n FROM folder_streams
      WHERE machine = ? AND app = ? AND destination = ? AND stream = ?`,
    [machine, app, destination, stream],
  );
  return row === undefined
    ? null
    : {
        next_n: Number(row.next_n),
        last_snapshot_n:
          row.last_snapshot_n === null ? null : Number(row.last_snapshot_n),
      };
}

export function setStream(
  sql: Sql,
  key: {
    machine: Id<"mch">;
    app: Id<"app">;
    destination: string;
    stream: "source" | "app";
  },
  value: { next_n: number; written_at: string },
): void {
  sql.run(
    `INSERT INTO folder_streams (machine, app, destination, stream, next_n, written_at, error)
     VALUES (?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT (machine, app, destination, stream) DO UPDATE SET
       next_n = excluded.next_n, written_at = excluded.written_at, error = NULL`,
    [
      key.machine,
      key.app,
      key.destination,
      key.stream,
      value.next_n,
      value.written_at,
    ],
  );
}

export function setStreamError(
  sql: Sql,
  key: {
    machine: Id<"mch">;
    app: Id<"app">;
    destination: string;
    stream: "source" | "app";
  },
  error: FolderError,
): void {
  sql.run(
    `INSERT INTO folder_streams (machine, app, destination, stream, next_n, error)
     VALUES (?, ?, ?, ?, 1, ?)
     ON CONFLICT (machine, app, destination, stream) DO UPDATE SET error = excluded.error`,
    [key.machine, key.app, key.destination, key.stream, JSON.stringify(error)],
  );
}

export function clearStreamError(
  sql: Sql,
  key: {
    machine: Id<"mch">;
    app: Id<"app">;
    destination: string;
    stream: "source" | "app";
  },
): void {
  sql.run(
    `UPDATE folder_streams SET error = NULL
      WHERE machine = ? AND app = ? AND destination = ? AND stream = ?`,
    [key.machine, key.app, key.destination, key.stream],
  );
}

export function sourceCursor(
  sql: Sql,
  machine: Id<"mch">,
  app: Id<"app">,
  origin: Id<"mch">,
): number {
  const row = sql.get(
    `SELECT cursor FROM folder_reads WHERE machine = ? AND app = ? AND origin = ? AND stream = 'source'`,
    [machine, app, origin],
  );
  return row === undefined ? 0 : Number(row.cursor);
}

// 받은 번호를 올리거나(cursor), 기다리는 번호(waiting_for)나 오류를 남긴다. 넘긴 칸만 바꾼다.
export function setSourceRead(
  sql: Sql,
  key: { machine: Id<"mch">; app: Id<"app">; origin: Id<"mch"> },
  value:
    | { cursor: number; at: string }
    | { waiting_for: number }
    | { error: FolderError },
): void {
  sql.run(
    `INSERT INTO folder_reads (machine, app, origin, stream) VALUES (?, ?, ?, 'source')
     ON CONFLICT (machine, app, origin, stream) DO NOTHING`,
    [key.machine, key.app, key.origin],
  );
  const where = `WHERE machine = ? AND app = ? AND origin = ? AND stream = 'source'`;
  const ids = [key.machine, key.app, key.origin];
  if ("cursor" in value) {
    sql.run(
      `UPDATE folder_reads SET cursor = ?, read_at = ?, waiting_for = NULL, error = NULL ${where}`,
      [value.cursor, value.at, ...ids],
    );
  } else if ("waiting_for" in value) {
    sql.run(`UPDATE folder_reads SET waiting_for = ?, error = NULL ${where}`, [
      value.waiting_for,
      ...ids,
    ]);
  } else {
    sql.run(`UPDATE folder_reads SET error = ? ${where}`, [
      JSON.stringify(value.error),
      ...ids,
    ]);
  }
}
