// 기계를 건너는 event file `machines/<자기 id>/apps/<app>/events/<id>.json`. 그 앱의 `sync_to` 폴더에 쓰고 `folder_written`에
// 적어(stream `event`) 앱 목록이 싣는다. `CROSS_EVENT_MAX_AGE_MS`가 지난 자기 file은 지운다(읽는 쪽도 내지 않는다).
import {
  type Clock,
  err,
  formatAt,
  ok,
  type RandomSource,
  type Result,
  sha256Hex,
} from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { JsonValue } from "../../../protocol/base/json-values.ts";
import {
  CROSS_EVENT_MAX_AGE_MS,
  EVENT_FILE_MAX_BYTES,
  eventFilePath,
  eventFileSchema,
} from "../../../protocol/remote/carry.ts";
import { encodeRecord } from "../../../protocol/folder/records.ts";
import type { Sql, Tx } from "../../../protocol/server/mod.ts";
import type { DestinationsView } from "../destinations.ts";
import { createFolderWriter } from "../fs.ts";

type Transaction = <T>(fn: (tx: Pick<Tx, "sql">) => Result<T>) => Result<T>;

export async function writeEventFile(input: {
  me: Id<"mch">;
  destination: { name: string; path: string };
  app: Id<"app">;
  code_commit: string;
  event: { id: string; name: string; payload: JsonValue; at: string };
  transaction: Transaction;
  clock: Clock;
  random: RandomSource;
}): Promise<Result<void>> {
  const { me, app } = input;
  // path가 id다.
  const { id } = input.event;
  let bytes: Uint8Array;
  try {
    bytes = encodeRecord(eventFileSchema, {
      format: 2,
      machine: me,
      app,
      id,
      code_commit: input.code_commit,
      name: input.event.name,
      payload: input.event.payload,
      at: input.event.at,
    });
  } catch {
    return err({
      code: "invalid_input",
      message: "the event cannot be written as an event file",
    });
  }
  if (bytes.byteLength > EVENT_FILE_MAX_BYTES) {
    return err({
      code: "invalid_input",
      message: `the event is over ${EVENT_FILE_MAX_BYTES} bytes and cannot go to other computers`,
    });
  }
  const path = eventFilePath(me, app, id);
  const written = await createFolderWriter({
    root: input.destination.path,
    machine: me,
    random: input.random,
  }).writeFile(path, bytes);
  if (!written.ok) return written;
  const sha256 = await sha256Hex(bytes);
  return input.transaction((tx) => {
    tx.sql.run(
      `INSERT INTO folder_written (machine, destination, path, app, stream, n, sha256, size, written_at)
       VALUES (?, ?, ?, ?, 'event', NULL, ?, ?, ?)`,
      [
        me,
        input.destination.name,
        path,
        app,
        sha256,
        bytes.byteLength,
        input.clock.now(),
      ],
    );
    return ok(undefined);
  });
}

/** 나이 한도가 지난 자기 event file을 지운다. id가 다시 쓰이지 않아 행도 지운다. 지운 수. */
export async function pruneEventFiles(input: {
  me: Id<"mch">;
  destinations: DestinationsView;
  sql: Pick<Sql, "all">;
  transaction: Transaction;
  clock: Clock;
  random: RandomSource;
}): Promise<Result<number>> {
  const { me } = input;
  const cutoff = formatAt(input.clock.nowMs() - CROSS_EVENT_MAX_AGE_MS);
  const rows = input.sql.all(
    `SELECT destination, path FROM folder_written
      WHERE machine = ? AND stream = 'event' AND written_at < ?`,
    [me, cutoff],
  );
  let removed = 0;
  for (const row of rows) {
    const destination = input.destinations.resolve(String(row.destination));
    if (destination !== null) {
      const done = await createFolderWriter({
        root: destination.path,
        machine: me,
        random: input.random,
      }).remove(String(row.path));
      if (!done.ok) return done;
    }
    const dropped = input.transaction((tx) => {
      tx.sql.run(
        "DELETE FROM folder_written WHERE machine = ? AND destination = ? AND path = ?",
        [me, row.destination, row.path],
      );
      return ok(undefined);
    });
    if (!dropped.ok) return dropped;
    removed += 1;
  }
  return ok(removed);
}
