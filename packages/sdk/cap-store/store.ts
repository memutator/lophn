// 앱이 자기 data 영역의 SQLite DB를 여는 얇은 client다. 추가 permission은 없다.
// 앱 프로세스는 자기 data 영역에만 읽기·쓰기 flag가 있고 다른 앱 DB·플랫폼 파일은 flag가 없다.
// schema 번호와 migration 이력은 data worker가 쓰는 같은 표(lophn_data_schema)를 쓴다.
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { CapabilityError } from "./errors.ts";
import { readHost, type StoreHost } from "./host.ts";

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

export type Migration = {
  from: number;
  to: number;
  // 한 단계의 SQL이다. 공개한 단계는 고치지 않고 새 단계를 더한다.
  sql: string;
};

export type Store = {
  // 앱 자신의 DB다. SQL은 앱이 직접 쓴다.
  readonly db: DatabaseSync;
  // 지금 DB의 schema 번호다. migration을 한 번도 적용하지 않았으면 0이다.
  schema(): number;
  // 현재 schema에서 target까지 연속 경로를 순서대로 적용한다. 단계마다 한 transaction이고
  // 실패한 단계는 rollback한다. 운영(live) 앱은 schema를 바꾸지 못한다. 운영의 변경은
  // activation 때 data worker가 backup을 뜬 뒤 같은 단계로 한다.
  migrate(
    steps: readonly Migration[],
    options?: { target?: number },
  ): Promise<number>;
  // 동기 작업 하나를 한 transaction으로 묶는다. 던지면 rollback한다.
  transaction<T>(work: (db: DatabaseSync) => T): T;
  close(): void;
};

export type OpenStoreOptions = {
  // 기본은 `<data 영역>/app.sqlite`다.
  path?: string;
  host?: StoreHost;
  now?: () => string;
};

function invalid(message: string): CapabilityError {
  return new CapabilityError({ code: "invalid_input", message });
}

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function path(options: OpenStoreOptions): string {
  if (options.path !== undefined) return resolve(options.path);
  const host = options.host ?? readHost();
  if (!host) {
    throw new CapabilityError({
      code: "unavailable",
      message: "this code is not running inside a lophn app process",
    });
  }
  return resolve(host.dataPath, DEFAULT_DATABASE_FILE);
}

export function openStore(options: OpenStoreOptions = {}): Store {
  const file = path(options);
  const mode = options.host?.mode ?? readHost()?.mode ?? "preview";
  const now = options.now ?? (() => new Date().toISOString());
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(file);
    db.exec("pragma journal_mode = wal");
    db.exec("pragma foreign_keys = on");
    db.exec("pragma busy_timeout = 5000");
  } catch (error) {
    if (error instanceof Deno.errors.NotCapable) {
      throw new CapabilityError({
        code: "forbidden",
        message:
          `fs.write {"path":"${file}"} is outside the app data area. Keep the database in the app data path.`,
        permission: "fs.write",
        scope: { path: file, recursive: false },
      });
    }
    throw new CapabilityError({
      code: "unavailable",
      message: "app database cannot be opened",
    });
  }
  const store: Store = {
    db,
    schema() {
      const table = db.prepare(
        "select name from sqlite_master where type = 'table' and name = ?",
      ).get(SCHEMA_TABLE);
      if (!table) return 0;
      const row = db.prepare(
        `select data_schema from ${SCHEMA_TABLE} where id = 1`,
      ).get();
      return row ? Number(row["data_schema"]) : 0;
    },
    async migrate(steps, migrateOptions = {}) {
      const current = store.schema();
      const target = migrateOptions.target ??
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
      for (let cursor = current; cursor < target;) {
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
          db.exec("begin immediate");
          db.exec(step.sql);
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
          db.exec("commit");
        } catch {
          try {
            db.exec("rollback");
          } catch {
            // rollback 실패도 단계를 적용된 것으로 보지 않는다.
          }
          throw invalid(
            `migration ${step.from} to ${step.to} failed and was rolled back`,
          );
        }
      }
      return store.schema();
    },
    transaction(work) {
      db.exec("begin immediate");
      try {
        const result = work(db);
        if (result instanceof Promise) {
          throw invalid("transaction work must be synchronous");
        }
        db.exec("commit");
        return result;
      } catch (error) {
        try {
          db.exec("rollback");
        } catch {
          // 이미 끝난 transaction이다.
        }
        throw error;
      }
    },
    close() {
      db.close();
    },
  };
  return store;
}
