// 이 기계가 쓰는 stream의 local 상태(`folder_streams`, `folder_written`)를 읽고 고친다. 모든 행은 이 기계 id로 거른다:
// 다른 id의 행은 복제된 data root에서 온 것이라 없는 것이다.
import type { Id } from "../../../protocol/base/ids.ts";
import type { FolderError } from "../../../protocol/folder/mod.ts";
import type { Sql, SqlRow } from "../../../protocol/server/mod.ts";

export type StreamKind = "data" | "record";

export type StreamKey = {
  machine: Id<"mch">;
  // 기계 기록은 앱이 ''다.
  app: string;
  destination: string;
  stream: StreamKind;
};

export type StreamRow = {
  next_n: number;
  last_seq: number;
  bundle_hash: string | null;
  last_snapshot_n: number | null;
  written_at: string | null;
  settled: string | null;
  away_since: string | null;
  // 떨어져 있음 알림에 마지막으로 쓴 held 수. 알린 적이 없거나 다 따라잡았으면 null.
  away_notified: number | null;
  error: FolderError | null;
};

export type WrittenRow = {
  path: string;
  n: number;
  sha256: string;
  size: number;
  written_at: string;
  deleted_at: string | null;
};

const text = (value: SqlRow[string] | undefined) =>
  value === null || value === undefined ? null : String(value);
const num = (value: SqlRow[string] | undefined) =>
  value === null || value === undefined ? null : Number(value);

const KEY_WHERE = "machine = ? AND app = ? AND destination = ? AND stream = ?";
const keyParams = (key: StreamKey) => [
  key.machine,
  key.app,
  key.destination,
  key.stream,
];

export function readStream(
  sql: Pick<Sql, "get">,
  key: StreamKey,
): StreamRow | null {
  const row = sql.get(
    `SELECT * FROM folder_streams WHERE ${KEY_WHERE}`,
    keyParams(key),
  );
  if (row === undefined) return null;
  const error = text(row["error"]);
  return {
    next_n: Number(row["next_n"]),
    last_seq: Number(row["last_seq"]),
    bundle_hash: text(row["bundle_hash"]),
    last_snapshot_n: num(row["last_snapshot_n"]),
    written_at: text(row["written_at"]),
    settled: text(row["settled"]),
    away_since: text(row["away_since"]),
    away_notified: num(row["away_notified"]),
    error: error === null ? null : (JSON.parse(error) as FolderError),
  };
}

/** 행이 없으면 번호 1로 만든다. */
export function ensureStream(sql: Pick<Sql, "run">, key: StreamKey): void {
  sql.run(
    `INSERT INTO folder_streams (machine, app, destination, stream, next_n) VALUES (?, ?, ?, ?, 1)
     ON CONFLICT DO NOTHING`,
    keyParams(key),
  );
}

export function updateStream(
  sql: Pick<Sql, "run">,
  key: StreamKey,
  fields: Partial<Omit<StreamRow, "error">> & { error?: FolderError | null },
): void {
  ensureStream(sql, key);
  const names = Object.keys(fields) as (keyof typeof fields)[];
  if (names.length === 0) return;
  sql.run(
    `UPDATE folder_streams SET ${names.map((name) => `${name} = ?`).join(", ")} WHERE ${KEY_WHERE}`,
    [
      ...names.map((name) => {
        const value = fields[name];
        if (name === "error")
          return value === null ? null : JSON.stringify(value);
        return (value ?? null) as string | number | null;
      }),
      ...keyParams(key),
    ],
  );
}

export function writtenRows(
  sql: Pick<Sql, "all">,
  key: StreamKey,
): WrittenRow[] {
  return sql
    .all(
      `SELECT path, n, sha256, size, written_at, deleted_at FROM folder_written
       WHERE ${KEY_WHERE} ORDER BY n`,
      keyParams(key),
    )
    .map((row) => ({
      path: String(row["path"]),
      n: Number(row["n"]),
      sha256: String(row["sha256"]),
      size: Number(row["size"]),
      written_at: String(row["written_at"]),
      deleted_at: text(row["deleted_at"]),
    }));
}
