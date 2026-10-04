import { DatabaseSync } from "node:sqlite";
import { err, ok, type Result } from "../../base/mod.ts";
import type { ReadSnapshot } from "../../contracts/platform/mod.ts";
import { createSql, isStorageUnavailable } from "./sqlite.ts";
import {
  READ_MAX_ROWS,
  ReaderStorageError,
  ReadLimitExceeded,
} from "./reads.ts";

export function readerStorage<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (isStorageUnavailable(error)) {
      throw new ReaderStorageError("reader storage unavailable");
    }
    throw error;
  }
}

function closeFailedSnapshot(close: () => void): never {
  try {
    close();
  } catch {
    throw new ReaderStorageError(
      "reader snapshot and connection could not close",
    );
  }
  throw new ReaderStorageError("reader snapshot could not close");
}

export type ReaderConnection = {
  readonly sql: ReadSnapshot["sql"];
  begin(): string;
  end(): void;
  close(): void;
};

export function openReaderConnection(path: string): Result<ReaderConnection> {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    db.exec("pragma query_only=ON; pragma busy_timeout=0");
    const queryOnly = db.prepare("pragma query_only").get()?.query_only;
    const journal = db.prepare("pragma journal_mode").get()?.journal_mode;
    if (queryOnly !== 1 || journal !== "wal") {
      throw new Error("reader settings differ");
    }
    return ok(createReaderConnection(db));
  } catch {
    try {
      db?.close();
    } catch {
      return err({
        code: "unavailable",
        message: "reader 연결을 닫을 수 없다",
      });
    }
    return err({ code: "unavailable", message: "reader 연결을 열 수 없다" });
  }
}

export function createReaderConnection(
  connection: DatabaseSync,
): ReaderConnection {
  let usable = true;
  const sql = createSql(connection, () => usable);
  const close = () => {
    if (!usable) return;
    // native close가 실패해도 같은 handle로 다음 snapshot을 열지 않는다.
    usable = false;
    connection.close();
  };
  const requireUsable = () => {
    if (!usable) throw new ReaderStorageError("reader connection unusable");
  };
  const countRows = (count: number) => {
    if (count > READ_MAX_ROWS) throw new ReadLimitExceeded();
  };
  return {
    sql: {
      get(query, params) {
        requireUsable();
        const row = readerStorage(() => sql.get(query, params));
        countRows(row === undefined ? 0 : 1);
        return row;
      },
      all(query, params) {
        // SQL을 감싸 LIMIT을 걸어 native 결과를 무제한으로 materialize하지 않는다.
        requireUsable();
        const rows = readerStorage(() =>
          sql.all(
            `select * from (${query.trim().replace(/;+\s*$/, "")}\n) limit 501`,
            params,
          )
        );
        countRows(rows.length);
        return rows;
      },
    },
    begin() {
      requireUsable();
      return readerStorage(() => {
        connection.exec("begin");
        const head = sql.get(
          "select coalesce(max(seq), 0) as seq from events",
          [],
        );
        return String(head?.seq ?? 0);
      });
    },
    end() {
      if (!usable) return;
      try {
        if (connection.isTransaction) connection.exec("rollback");
      } catch {
        // rollback 실패 뒤 같은 connection에서 다음 snapshot을 시작하지 않는다.
        closeFailedSnapshot(close);
      }
    },
    close,
  };
}
