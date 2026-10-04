import { DatabaseSync, type StatementSync } from "node:sqlite";
import { err, ok, type Result } from "../../base/mod.ts";
import type { Sql, SqlParam, SqlRow } from "../../contracts/platform/mod.ts";

// handler SQL이 transaction·연결 상태를 바꾸면 실행기의 commit 경계가 깨진다.
// 열 이름 release나 trigger 본문의 begin은 첫 keyword가 아니므로 통과한다.
const FORBIDDEN_FIRST = new Set([
  "begin",
  "commit",
  "end",
  "rollback",
  "savepoint",
  "release",
  "attach",
  "detach",
  "pragma",
  "vacuum",
]);

function firstKeyword(sql: string): string {
  const stripped = sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .trim();
  const match = /^[A-Za-z]+/.exec(stripped);
  return match ? match[0].toLowerCase() : "";
}

// node:sqlite prepare는 여러 문장 중 첫 문장만 실행하고 나머지를 버린다.
function hasAnotherStatement(sql: string): boolean {
  const stripped = sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .trim()
    .replace(/;+\s*$/, "");
  return stripped.includes(";");
}

function rejects(sql: string): boolean {
  return FORBIDDEN_FIRST.has(firstKeyword(sql)) || hasAnotherStatement(sql);
}

export type LedgerConnection = {
  readonly sql: Sql;
  exec(sql: string): void;
  inTransaction(): boolean;
  // handler SQL은 pragma를 못 쓰므로 무결성 검사는 연결이 직접 한다.
  integrityOk(): boolean;
  // rollback이 실패하면 연결을 다시 쓰지 않는다.
  fault(): void;
  failed(): boolean;
  close(): void;
};

class SqlRejected extends Error {}

// handler SQL이 transaction을 끝내면 실행기의 commit과 어긋난다.
class TransactionLost extends Error {}

// fault·close 뒤의 연결이다. native close가 실패해 handle이 남아도 다시 쓰지 않는다.
class ConnectionUnavailable extends Error {
  constructor() {
    super("ledger connection unusable");
  }
}

function cell(value: unknown): SqlParam {
  if (
    value === null || typeof value === "number" || typeof value === "bigint" ||
    typeof value === "string" || value instanceof Uint8Array
  ) {
    return value;
  }
  throw new Error("SQLite 값이 지원하지 않는 타입이다");
}

function row(record: Record<string, unknown>): SqlRow {
  const out: Record<string, SqlParam> = {};
  for (const [key, value] of Object.entries(record)) out[key] = cell(value);
  return out;
}

function statement(db: DatabaseSync, sql: string): StatementSync {
  const prepared = db.prepare(sql);
  // seq는 JS 안전 정수를 넘는다(platform/ledger#R9).
  prepared.setReadBigInts(true);
  return prepared;
}

function checked<T>(
  db: DatabaseSync,
  alive: () => boolean,
  sql: string,
  fn: () => T,
): T {
  if (!alive()) throw new ConnectionUnavailable();
  if (rejects(sql)) throw new SqlRejected();
  const wasOpen = db.isTransaction;
  const result = fn();
  // transaction 안에서 연 SQL이 transaction을 끝내면 실행기의 commit과 어긋난다.
  if (wasOpen && !db.isTransaction) throw new TransactionLost();
  return result;
}

// 같은 leaf의 reader·writer 모두 owner가 가진 연결 수명 guard를 반드시 넘긴다.
export function createSql(db: DatabaseSync, alive: () => boolean): Sql {
  return {
    run(sql, params) {
      return checked(db, alive, sql, () => {
        const result = statement(db, sql).run(...params);
        return {
          changes: result.changes,
          lastInsertRowid: result.lastInsertRowid,
        };
      });
    },
    get(sql, params) {
      return checked(db, alive, sql, () => {
        const found = statement(db, sql).get(...params);
        return found === undefined ? undefined : row(found);
      });
    },
    all(sql, params) {
      return checked(
        db,
        alive,
        sql,
        () => statement(db, sql).all(...params).map(row),
      );
    },
  };
}

export type PragmaCheck = {
  journalMode: string;
  synchronous: bigint;
  foreignKeys: bigint;
  recursiveTriggers: bigint;
  busyTimeout: bigint;
};

function pragmaValue(db: DatabaseSync, sql: string): bigint | string {
  const found = db.prepare(sql).get();
  if (found === undefined) {
    throw new Error("pragma 반환이 없다");
  }
  const value = Object.values(found)[0];
  if (typeof value === "bigint" || typeof value === "string") return value;
  if (typeof value === "number") return BigInt(value);
  throw new Error("pragma 반환을 읽을 수 없다");
}

// synchronous=FULL은 SQLite가 2로 돌려준다. REPLACE의 delete도 trigger를 거쳐야 한다.
const SYNCHRONOUS_FULL = 2n;
const BUSY_TIMEOUT_MS = 5000n;

export function configure(db: DatabaseSync): Result<void> {
  const journalMode = pragmaValue(db, "pragma journal_mode=WAL");
  if (journalMode !== "wal") {
    return err({
      code: "unavailable",
      message: "WAL journal을 쓸 수 없어 기동을 거절한다",
    });
  }
  db.prepare("pragma synchronous=FULL").run();
  db.prepare("pragma foreign_keys=ON").run();
  db.prepare("pragma recursive_triggers=ON").run();
  db.prepare("pragma busy_timeout=5000").run();
  const applied: PragmaCheck = {
    journalMode: String(pragmaValue(db, "pragma journal_mode")),
    synchronous: BigInt(pragmaValue(db, "pragma synchronous")),
    foreignKeys: BigInt(pragmaValue(db, "pragma foreign_keys")),
    recursiveTriggers: BigInt(pragmaValue(db, "pragma recursive_triggers")),
    busyTimeout: BigInt(pragmaValue(db, "pragma busy_timeout")),
  };
  if (
    applied.journalMode !== "wal" ||
    applied.synchronous !== SYNCHRONOUS_FULL ||
    applied.foreignKeys !== 1n ||
    applied.recursiveTriggers !== 1n ||
    applied.busyTimeout !== BUSY_TIMEOUT_MS
  ) {
    return err({
      code: "unavailable",
      message: "SQLite 내구성 설정이 요구와 달라 기동을 거절한다",
    });
  }
  return ok(undefined);
}

export function openConnection(path: string): Result<LedgerConnection> {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path);
  } catch {
    return err({
      code: "unavailable",
      message: "ledger 파일을 열 수 없다",
    });
  }
  let configured: Result<void>;
  try {
    configured = configure(db);
  } catch {
    // 읽기 전용 위치는 WAL pragma 자체가 실패한다. 다른 journal로 넘어가지 않는다.
    db.close();
    return err({
      code: "unavailable",
      message: "WAL journal을 쓸 수 없어 기동을 거절한다",
    });
  }
  if (!configured.ok) {
    db.close();
    return configured;
  }
  // fault·close가 먼저 dead를 세운다. 그 뒤 native close가 실패해도 모든 입구가 닫힌다.
  let dead = false;
  const alive = () => !dead;
  return ok({
    sql: createSql(db, alive),
    exec(sql: string) {
      if (dead) throw new ConnectionUnavailable();
      db.exec(sql);
    },
    inTransaction() {
      return !dead && db.isTransaction;
    },
    integrityOk() {
      if (dead) return false;
      const rows = db.prepare("pragma integrity_check").all();
      return rows.length === 1 && rows[0]?.["integrity_check"] === "ok";
    },
    fault() {
      if (dead) return;
      dead = true;
      try {
        db.close();
      } catch {
        // 닫기 실패도 재사용하지 않는다. 다시 닫으려 하지 않는다.
      }
    },
    failed() {
      return dead;
    },
    close() {
      // fault()가 이미 poison·close를 시도했으면 다시 닫지 않는다.
      if (dead) return;
      dead = true;
      db.close();
    },
  });
}

export function isSqlRejected(thrown: unknown): boolean {
  return thrown instanceof SqlRejected;
}

export function isTransactionLost(thrown: unknown): boolean {
  return thrown instanceof TransactionLost;
}

// disk·I/O·잠금 대기는 입력을 소비하지 않는 unavailable이다(platform/ledger#R6).
// 제약 위반·거절 SQL은 여기 넣지 않는다. 그건 handler 결과로 rollback된다.
// primary code의 낮은 8bit와 SQLITE_* 이름. reader 분류와 같다.
const STORAGE_CODES = new Set([5, 6, 8, 10, 11, 13, 14, 15, 26]);
const STORAGE_NAMES =
  /^SQLITE_(BUSY|LOCKED|READONLY|IOERR|CORRUPT|FULL|CANTOPEN|PROTOCOL|NOTADB)(_|$)/;
const STORAGE_MARKERS = [
  "disk i/o",
  "database or disk is full",
  "database is locked",
  "unable to open",
  "disk image is malformed",
  "readonly database",
];

export function isStorageUnavailable(thrown: unknown): boolean {
  if (thrown instanceof ConnectionUnavailable) return true;
  if (thrown instanceof SqlRejected || thrown instanceof TransactionLost) {
    return false;
  }
  if (thrown !== null && typeof thrown === "object") {
    const { errcode, code } = thrown as { errcode?: unknown; code?: unknown };
    if (typeof errcode === "number" && STORAGE_CODES.has(errcode & 255)) {
      return true;
    }
    if (typeof code === "string" && STORAGE_NAMES.test(code)) return true;
  }
  if (!(thrown instanceof Error)) return false;
  const message = thrown.message.toLowerCase();
  return STORAGE_MARKERS.some((marker) => message.includes(marker));
}
