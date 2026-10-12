// derived store. coordinator가 유일한 writer이고 read는 별도 연결이다.
// WAL과 synchronous=FULL로 한 event의 결과·FTS 교체·cursor를 한 transaction에 쓴다.
// read 연결은 query_only로 열어 쓰기가 없다.
import { DatabaseSync } from "node:sqlite";
import { err, ok, type Result } from "../../../../base/mod.ts";
import type {
  SchemaStep,
  SqlParams,
} from "../../../../protocol/platform/mod.ts";
import { outlineAndSearchSchemaSteps } from "../schema.ts";

export type DerivedStoreWrite = {
  transaction<T>(handle: (tx: DerivedTx) => Result<T>): Result<T>;
  // 재생성 중 교체 전까지 살아 있는 파일의 read.없으면 rebuilding 후보다.
  readonly read: DerivedRead;
  close(): void;
};

export type DerivedTx = {
  sql: DerivedSql;
};

export type DerivedRead = {
  sql: DerivedSql;
};

export type DerivedSql = {
  run(sql: string, params: SqlParams): {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  };
  get(sql: string, params: SqlParams): Record<string, unknown> | undefined;
  all(sql: string, params: SqlParams): Record<string, unknown>[];
};

export type DerivedOpen = Result<DerivedStore>;

export type DerivedStore = DerivedStoreWrite & {
  closeWriter(): void;
  // writer 연결을 닫고 교체한다. restory·재생성이 쓴다.
  swap(path: string): Result<void>;
};

function cursorCell(value: unknown): unknown {
  if (
    value === null || typeof value === "number" || typeof value === "bigint" ||
    typeof value === "string" || value instanceof Uint8Array
  ) {
    return value;
  }
  throw new Error("SQLite 값이 지원하지 않는 타입이다");
}

function sqlOf(db: DatabaseSync): DerivedSql {
  return {
    run(sql, params) {
      const result = db.prepare(sql).run(...params);
      return {
        changes: result.changes,
        lastInsertRowid: result.lastInsertRowid,
      };
    },
    get(sql, params) {
      const found = db.prepare(sql).get(...params);
      if (found === undefined) return undefined;
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(found)) {
        out[key] = cursorCell(value);
      }
      return out;
    },
    all(sql, params) {
      return db.prepare(sql).all(...params).map((row) => {
        const out: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(row)) {
          out[key] = cursorCell(value);
        }
        return out;
      });
    },
  };
}

export const DERIVED_SEARCH_DB = "documents.sqlite";
export const DERIVED_REBUILD_DB = "documents.rebuild.sqlite";

export function derivedPath(root: string): string {
  return `${root}/${DERIVED_SEARCH_DB}`;
}

export function rebuildPath(root: string): string {
  return `${root}/${DERIVED_REBUILD_DB}`;
}

export function applySchema(
  db: DatabaseSync,
  steps: readonly SchemaStep[],
): Result<void> {
  try {
    // 이미 만든 파일을 다시 열면(core 재시작) 이미 올린 step은 건너뛴다. 올린 step 수는
    // user_version에 남고, 각 step은 그 기록과 같은 transaction에서 올라간다.
    const row = db.prepare("pragma user_version").get() as
      | Record<string, unknown>
      | undefined;
    const done = Number(row?.["user_version"] ?? 0);
    for (let index = done; index < steps.length; index++) {
      db.exec("BEGIN IMMEDIATE");
      try {
        db.exec(steps[index].sql);
        db.exec(`pragma user_version = ${index + 1}`);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
    return ok(undefined);
  } catch (error) {
    return err({
      code: "unavailable",
      message: error instanceof Error ? error.message : "derived schema failed",
    });
  }
}

export function openDerived(
  path: string,
  steps: readonly SchemaStep[] = outlineAndSearchSchemaSteps,
): DerivedOpen {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path);
  } catch {
    return err({ code: "unavailable", message: "derived 파일을 열 수 없다" });
  }
  const configured = configureDerived(db);
  if (!configured.ok) {
    db.close();
    return configured;
  }
  const applied = applySchema(db, steps);
  if (!applied.ok) {
    db.close();
    return applied;
  }
  let writerDead = false;
  let dbLive = db;
  return ok({
    transaction<T>(handle: (tx: DerivedTx) => Result<T>): Result<T> {
      if (writerDead) {
        return err({ code: "unavailable", message: "derived writer가 끝났다" });
      }
      try {
        dbLive.exec("BEGIN IMMEDIATE");
      } catch {
        return err({
          code: "unavailable",
          message: "derived transaction을 여지 못했다",
        });
      }
      try {
        const result = handle({ sql: sqlOf(dbLive) });
        dbLive.exec(result.ok ? "COMMIT" : "ROLLBACK");
        return result;
      } catch (error) {
        try {
          dbLive.exec("ROLLBACK");
        } catch {
          writerDead = true;
        }
        return err({
          code: "unavailable",
          message: error instanceof Error
            ? error.message
            : "derived write failed",
        });
      }
    },
    get read(): DerivedRead {
      return { sql: sqlOf(dbLive) };
    },
    closeWriter() {
      writerDead = true;
    },
    swap(path: string): Result<void> {
      try {
        dbLive.close();
      } catch {
        writerDead = true;
      }
      const next = new DatabaseSync(path);
      const configured = configureDerived(next);
      if (!configured.ok) {
        next.close();
        return configured;
      }
      const applied = applySchema(next, steps);
      if (!applied.ok) {
        next.close();
        return applied;
      }
      dbLive = next;
      writerDead = false;
      return ok(undefined);
    },
    close() {
      try {
        dbLive.close();
      } catch {
        // 이미 끝난 연결.
      }
      writerDead = true;
    },
  });
}

export function configureDerived(db: DatabaseSync): Result<void> {
  try {
    const journal = db.prepare("pragma journal_mode=WAL").get() as
      | Record<string, unknown>
      | undefined;
    if (journal === undefined || String(Object.values(journal)[0]) !== "wal") {
      return err({ code: "unavailable", message: "WAL journal을 쓸 수 없다" });
    }
    db.prepare("pragma synchronous=FULL").run();
    db.prepare("pragma foreign_keys=ON").run();
    db.prepare("pragma recursive_triggers=ON").run();
    db.prepare("pragma busy_timeout=5000").run();
    return ok(undefined);
  } catch (error) {
    return err({
      code: "unavailable",
      message: error instanceof Error ? error.message : "derived pragma failed",
    });
  }
}

// 요청 하나의 직접 추출(R15)을 담는 메모리 derived. 파일에 쓰지 않고 요청이 끝나면 닫는다.
// 같은 schema·같은 read 모양이라 읽기 handler는 파일 derived와 똑같이 읽는다.
export type TransientDerived = {
  readonly read: DerivedRead;
  write(handle: (tx: DerivedTx) => void): void;
  close(): void;
};

export function openTransientDerived(): Result<TransientDerived> {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(":memory:");
  } catch {
    return err({ code: "unavailable", message: "임시 derived를 열 수 없다" });
  }
  const applied = applySchema(db, outlineAndSearchSchemaSteps);
  if (!applied.ok) {
    db.close();
    return applied;
  }
  return ok({
    read: { sql: sqlOf(db) },
    write(handle) {
      handle({ sql: sqlOf(db) });
    },
    close() {
      db.close();
    },
  });
}

export function openDerivedRead(path: string): Result<DerivedRead> {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path, { readOnly: true });
  } catch {
    return err({ code: "unavailable", message: "derived read를 열 수 없다" });
  }
  try {
    db.prepare("pragma query_only=ON").run();
  } catch {
    db.close();
    return err({ code: "unavailable", message: "derived read를 열 수 없다" });
  }
  return ok({ sql: sqlOf(db) });
}
