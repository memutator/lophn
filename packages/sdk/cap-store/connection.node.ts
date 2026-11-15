// 앱 data는 앱 DB 하나라서 process 안의 연결도 하나다. runtime이 그 연결에 SQLite session을 걸어
// write 동안의 변경을 changeset으로 뜨고, 뒤집힌 changeset을 한 transaction으로 적용한다.
// SQLite session은 PRIMARY KEY 없는 표의 변경을 기록하지 못한다(migration이 막는다).

import { resolve } from "node:path";
import { DatabaseSync, type Session } from "node:sqlite";
import { DEFAULT_DATABASE_FILE, SCHEMA_TABLE } from "./store.ts";
import { inSavepoint, type StoreDb } from "./db.ts";
import { CapabilityError } from "./errors.ts";
import {
  type ApplyOutcome,
  readHost,
  STORE_HOOKS,
  type StoreHooks,
} from "./host.ts";

// host의 sync 표다. schema 표와 같이 앱 data가 아니므로 session이 변경을 담지 않는다(담으면 clock이 rewind와
// sync로 퍼진다).
const SYNC_TABLE_PREFIX = "lophn_sync_";

type Connection = { db: DatabaseSync; sessions: Map<string, Session> };

const connections = new Map<string, Connection>();
let recording = false;

export function defaultDatabaseFile(): string | undefined {
  const host = readHost();
  return host && resolve(host.dataPath, DEFAULT_DATABASE_FILE);
}

export function openConnection(file: string): DatabaseSync {
  const known = connections.get(file);
  if (known) return known.db;
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(file);
    db.exec("pragma journal_mode = wal");
    db.exec("pragma foreign_keys = on");
    db.exec("pragma busy_timeout = 5000");
  } catch {
    throw new CapabilityError({
      code: "unavailable",
      message: "app database cannot be opened",
    });
  }
  const connection = { db, sessions: new Map<string, Session>() };
  connections.set(file, connection);
  if (recording || readHost()?.store?.recording()) attach(connection);
  return db;
}

export function closeConnection(file: string): void {
  const connection = connections.get(file);
  if (!connection) return;
  connections.delete(file);
  closeSessions(connection);
  connection.db.close();
}

// 표마다 session을 건다. 이미 건 표는 건너뛴다.
function attach(connection: Connection): void {
  const rows = connection.db
    .prepare(
      "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name != ?",
    )
    .all(SCHEMA_TABLE);
  for (const row of rows) {
    const name = String(row["name"]);
    if (name.startsWith(SYNC_TABLE_PREFIX)) continue;
    if (connection.sessions.has(name)) continue;
    connection.sessions.set(name, connection.db.createSession({ table: name }));
  }
}

export function attachNewTables(db: StoreDb): void {
  if (!recording && !readHost()?.store?.recording()) return;
  for (const connection of connections.values()) {
    if (connection.db === db) attach(connection);
  }
}

function closeSessions(connection: Connection): Uint8Array[] {
  const changesets: Uint8Array[] = [];
  let failure: unknown;
  for (const session of connection.sessions.values()) {
    try {
      const changeset = session.changeset();
      if (changeset.byteLength > 0) changesets.push(changeset);
    } catch (error) {
      failure ??= error;
    } finally {
      session.close();
    }
  }
  connection.sessions.clear();
  if (failure !== undefined) throw failure;
  return changesets;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function current(): Connection | undefined {
  if (connections.size === 1) return connections.values().next().value;
  const file = defaultDatabaseFile();
  if (file === undefined) return;
  openConnection(file);
  return connections.get(file);
}

class Conflict extends Error {}

export const hooks: StoreHooks = {
  beginChangeset() {
    recording = true;
    for (const connection of connections.values()) attach(connection);
  },
  endChangeset() {
    recording = false;
    const changesets: Uint8Array[] = [];
    let failure: unknown;
    for (const connection of connections.values()) {
      try {
        changesets.push(...closeSessions(connection));
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure !== undefined) throw failure;
    return changesets.length === 0 ? null : concat(changesets);
  },
  applyChangesets(changesets): ApplyOutcome {
    const connection = current();
    if (!connection) {
      return changesets.length === 0
        ? { ok: true }
        : { ok: false, message: "app database is not available" };
    }
    const { db } = connection;
    try {
      // 바깥에 transaction이 열려 있어도 되도록 SAVEPOINT로 묶는다.
      inSavepoint(db, () => {
        for (const changeset of changesets) {
          // 충돌이면 false를 돌려주고 그 changeset은 적용되지 않는다.
          if (!db.applyChangeset(changeset)) throw new Conflict();
        }
      });
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Conflict
            ? "a changeset conflicts with the current data"
            : error instanceof Error
              ? error.message
              : "apply failed",
      };
    }
  },
  database() {
    return current()?.db ?? null;
  },
};

(globalThis as Record<symbol, unknown>)[STORE_HOOKS] = hooks;
