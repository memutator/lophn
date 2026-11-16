// compaction은 주인만 한다: 새 snapshot을 쓴 뒤 그 앞 snapshot보다 작은 번호의 자기 file 가운데 오래된 것만 지운다.
// 그보다 늦은 기계는 남은 snapshot으로 따라온다. 지우는 것은 writer가 자기 하위 폴더 안으로 막고, 행은 남겨 deleted_at만 적는다
// (번호를 다시 쓰지 않고, 다시 나타난 file을 남의 writer로 보지 않기 위해).
import { formatAt, ok, type Result } from "../../../base/mod.ts";
import { COMPACTION_KEEP_MS } from "../../../protocol/folder/mod.ts";
import type { Sql, Tx } from "../../../protocol/server/mod.ts";
import type { FolderWriter } from "../fs.ts";
import { type StreamKey, writtenRows } from "./status.ts";

export async function compact(input: {
  sql: Pick<Sql, "all">;
  transaction<T>(fn: (tx: Pick<Tx, "sql">) => Result<T>): Result<T>;
  writer: FolderWriter;
  key: StreamKey;
  /** 그 앞 snapshot의 번호. 이보다 작은 번호만 지운다. */
  before: number;
  nowMs: number;
}): Promise<Result<number>> {
  const olderThan = formatAt(input.nowMs - COMPACTION_KEEP_MS);
  const now = formatAt(input.nowMs);
  const doomed = writtenRows(input.sql, input.key).filter(
    (row) =>
      row.deleted_at === null &&
      row.n < input.before &&
      row.written_at < olderThan,
  );
  for (const row of doomed) {
    const removed = await input.writer.remove(row.path);
    if (!removed.ok) return removed;
    const marked = input.transaction((tx) => {
      tx.sql.run(
        "UPDATE folder_written SET deleted_at = ? WHERE machine = ? AND destination = ? AND path = ?",
        [now, input.key.machine, input.key.destination, row.path],
      );
      return ok(undefined);
    });
    if (!marked.ok) return marked;
  }
  return ok(doomed.length);
}
