// Node와 폰이 같이 쓰는 Store다. DB를 여는 일(파일, host driver)과 session은 entry가 맡는다
// (store.node.ts, store.phone.ts). schema 번호와 migration 이력은 data worker가 쓰는 같은 표
// (lophn_data_schema)를 쓴다.

import {
  MIGRATION_PRIMARY_KEY_REQUIRED,
  type Migration,
  tablesWithoutPrimaryKey,
} from "../../protocol/apps/activation/migration-sql.ts";
import { inSavepoint, type StoreDb } from "./db.ts";
import { CapabilityError } from "./errors.ts";
import type { StoreHost } from "./host.ts";

export type { Migration };

// data worker가 activation 때 같은 파일을 연다. 이름을 바꾸면 그쪽도 같이 바꾼다.
export const DEFAULT_DATABASE_FILE = "app.sqlite";
export const SCHEMA_TABLE = "lophn_data_schema";

const SCHEMA_SQL = [
  `create table if not exists ${SCHEMA_TABLE} (`,
  "  id integer primary key check (id = 1),",
  "  data_schema integer not null check (data_schema >= 0),",
  "  last_result text not null check (last_result in ('applied', 'none')),",
  "  script_hash text,",
  "  applied_at text,",
  "  check (data_schema = 0 or script_hash is not null)",
  ")",
].join("\n");

export type Store = {
  // 앱 자신의 DB다. 이 process의 연결 하나이고 SQL은 앱이 직접 쓴다. `node:sqlite`의 연결과 폰 driver가
  // 같이 채우는 `StoreDb`다. `BEGIN`·`COMMIT`을 SQL로 직접 쓰지 않는다(`transaction`을 쓴다).
  readonly db: StoreDb;
  // 지금 DB의 schema 번호다. migration을 한 번도 적용하지 않았으면 0이다.
  schema(): number;
  // 현재 schema에서 target까지 연속 경로를 순서대로 적용한다. steps를 주지 않으면 release의 migration(host가
  // 준 것, host가 없는 앱 test에서는 지금 폴더의 `migrations/*.sql`)을 쓴다. 단계마다 한 transaction이고
  // 실패한 단계는 rollback한다. 새로 만든 표에 PRIMARY KEY가 없으면 그 단계가 실패한다(changeset이
  // 그 표의 변경을 기록하지 못하기 때문이다). 운영(live) 앱은 schema를 바꾸지 못한다. 운영의 변경은
  // activation 때 data worker가 backup을 뜬 뒤 같은 단계로 한다. live에서 schema가 이미 target이면
  // 아무것도 하지 않는다.
  migrate(
    steps?: readonly Migration[],
    options?: { target?: number },
  ): Promise<number>;
  // 동기 작업 하나를 한 transaction으로 묶는다. 던지면 rollback한다. SAVEPOINT라 겹쳐도 된다.
  transaction<T>(work: (db: StoreDb) => T): T;
  close(): void;
};

export type OpenStoreOptions = {
  // 기본은 `<data 영역>/app.sqlite`다. ":memory:"는 그대로 연다. 폰 entry는 이것을 쓰지 않는다.
  path?: string;
  host?: StoreHost;
  now?: () => string;
};

export type StoreParts = {
  db: StoreDb;
  host: StoreHost | undefined;
  now: () => string;
  // migrate에 steps를 주지 않았고 host가 migrations를 주지 않았을 때 쓴다.
  fallbackMigrations: () => { target: number; steps: Migration[] };
  // migrate가 표를 만든 뒤 부른다(Node가 새 표에 session을 건다).
  tablesChanged?: () => void;
  close?: () => void;
};

export function invalid(message: string): CapabilityError {
  return new CapabilityError({ code: "invalid_input", message });
}

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function userTables(db: StoreDb): string[] {
  return db
    .prepare(
      `select name from sqlite_master
       where type = 'table' and name not like 'sqlite_%' and name != ?
         and sql not like 'CREATE VIRTUAL%'`,
    )
    .all(SCHEMA_TABLE)
    .map((row) => String(row["name"]));
}

function primaryKeyColumns(db: StoreDb, table: string): number {
  const columns = db
    .prepare(`pragma table_info("${table.replaceAll('"', '""')}")`)
    .all();
  return columns.filter((column) => Number(column["pk"]) > 0).length;
}

export function makeStore(parts: StoreParts): Store {
  const { db, host, now } = parts;
  const mode = host?.mode ?? "preview";
  const store: Store = {
    db,
    schema() {
      const table = db
        .prepare(
          "select name from sqlite_master where type = 'table' and name = ?",
        )
        .get(SCHEMA_TABLE);
      if (!table) return 0;
      const row = db
        .prepare(`select data_schema from ${SCHEMA_TABLE} where id = 1`)
        .get();
      return row ? Number(row["data_schema"]) : 0;
    },
    async migrate(given, migrateOptions = {}) {
      const current = store.schema();
      const release =
        given !== undefined
          ? undefined
          : host?.store?.migrations
            ? host.store.migrations()
            : parts.fallbackMigrations();
      const steps = given ?? release!.steps;
      const target =
        migrateOptions.target ??
        release?.target ??
        steps.reduce((high, step) => Math.max(high, step.to), current);
      if (target === current) return current;
      if (mode === "live") {
        throw new CapabilityError({
          code: "forbidden",
          message:
            "a running app does not change its schema; activation applies migrations with a backup",
        });
      }
      if (target < current) throw invalid("schema does not move backward");
      const byFrom = new Map<number, Migration>();
      for (const step of steps) {
        if (!Number.isInteger(step.from) || !Number.isInteger(step.to)) {
          throw invalid("migration step numbers must be integers");
        }
        if (step.to <= step.from) throw invalid("migration must move forward");
        if (byFrom.has(step.from)) throw invalid("migration path branches");
        byFrom.set(step.from, step);
      }
      const path: Migration[] = [];
      for (let cursor = current; cursor < target; ) {
        const step = byFrom.get(cursor);
        if (!step || step.to > target) {
          throw invalid("migration path is not continuous");
        }
        path.push(step);
        cursor = step.to;
      }
      db.exec(SCHEMA_SQL);
      for (const step of path) {
        const hash = `sha256:${await sha256(step.sql)}`;
        try {
          inSavepoint(db, () => {
            const before = new Set(userTables(db));
            db.exec(step.sql);
            const missing = tablesWithoutPrimaryKey(
              userTables(db)
                .filter((name) => !before.has(name))
                .map((name) => ({
                  name,
                  primary_key_columns: primaryKeyColumns(db, name),
                })),
            );
            if (missing.length > 0) {
              throw invalid(
                `${MIGRATION_PRIMARY_KEY_REQUIRED}: ${missing.join(", ")}`,
              );
            }
            db.prepare(
              `insert into ${SCHEMA_TABLE}
                 (id, data_schema, last_result, script_hash, applied_at)
               values (1, ?, 'applied', ?, ?)
               on conflict (id) do update set
                 data_schema = excluded.data_schema,
                 last_result = excluded.last_result,
                 script_hash = excluded.script_hash,
                 applied_at = excluded.applied_at`,
            ).run(step.to, hash, now());
          });
        } catch (error) {
          if (error instanceof CapabilityError) throw error;
          throw invalid(
            `migration ${step.from} to ${step.to} failed and was rolled back`,
          );
        }
      }
      parts.tablesChanged?.();
      return store.schema();
    },
    transaction(work) {
      return inSavepoint(db, () => {
        const result = work(db);
        if (result instanceof Promise) {
          throw invalid("transaction work must be synchronous");
        }
        return result;
      });
    },
    close() {
      parts.close?.();
    },
  };
  return store;
}
