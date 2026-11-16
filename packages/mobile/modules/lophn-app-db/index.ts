// The phone's SQLite for app data: one native library (android/src/main/jni) used by the app's host runtime and by
// each app screen's guest runtime, so host and guest share one lock implementation on one file.
//
// Values (the same rules as node:sqlite and the sync core, packages/protocol/apps/sync/db.ts):
// - params: number → REAL, bigint → INTEGER, string → TEXT, Uint8Array → BLOB (an empty one is X'', not NULL),
//   boolean → INTEGER 0/1, null/undefined → NULL.
// - rows: INTEGER → number, or bigint beyond ±(2^53 - 1); REAL → number; TEXT → string; BLOB → Uint8Array; NULL → null.
// Every connection is WAL with a 5 s busy timeout and foreign keys on.
import { TurboModuleRegistry } from "react-native";
import type { SqlParam, SyncDb } from "../../../protocol/apps/sync/db.ts";

export type AppDbParam = SqlParam | boolean | undefined;
export type AppDbRow = Record<string, unknown>;
export type RunResult = { changes: number; lastInsertRowid: number | bigint };

export type AppDbStatement = {
  all(params?: AppDbParam[]): AppDbRow[];
  get(params?: AppDbParam[]): AppDbRow | undefined;
  run(params?: AppDbParam[]): RunResult;
};

/** A session over every user table (not `sqlite_*`, not `lophn_*`). */
export type AppDbSession = { changeset(): Uint8Array; close(): void };

/** The host's connection. It also is the sync core's driver (`SyncDb`). */
export type AppDbConnection = SyncDb & {
  prepare(sql: string): AppDbStatement;
  close(): void;
};

/**
 * A guest's connection to the one file the host bound to its origin. A guest cannot open another path, ATTACH or
 * VACUUM INTO, load extensions, create triggers, touch `lophn_sync_*`, or end a call's transaction from SQL. A
 * statement that runs longer than 5 s is stopped, and a value is at most 64 MiB.
 */
export type GuestAppDb = {
  exec(sql: string): void;
  prepare(sql: string): AppDbStatement;
  /** `BEGIN IMMEDIATE` and a session over the user tables. */
  beginCall(): void;
  /**
   * Ends the call: when the call changed rows and the host bound the file with `record`, writes the changeset to
   * `lophn_sync_outbox` in the same transaction, then commits.
   */
  endCall(call: { id: string; operation: string; started_at: string }): { bytes: number };
  /** Rolls the call back. */
  abortCall(): void;
  randomBytes(n: number): Uint8Array;
};

type Native = {
  installHost(): boolean;
  bind(origin: string, path: string, record: boolean): boolean;
  unbind(origin: string): boolean;
  install(): boolean;
};

type NativeHost = { openHost(path: string): Omit<AppDbConnection, "all" | "run"> };

const NAME = "LophnAppDb";

function native(): Native {
  const m = TurboModuleRegistry.get(NAME) as unknown as Native | null;
  if (m === null) throw new Error(`unavailable: native module ${NAME} is not in this runtime`);
  return m;
}

// The native side hands its objects over on the global object; take them before any other code can see them.
function take<T>(key: string): T {
  const g = globalThis as Record<string, unknown>;
  const value = g[key] as T;
  delete g[key];
  return value;
}

let host: NativeHost | null = null;

/** Host only: opens (and creates) a database file. Fails in any runtime but the app's main one. */
export function openHost(path: string): AppDbConnection {
  if (host === null) {
    native().installHost();
    host = take<NativeHost>("__lophnAppDbHost");
  }
  const c = host.openHost(path);
  return {
    exec: c.exec,
    prepare: c.prepare,
    session: c.session,
    close: c.close,
    all: (sql, params) => c.prepare(sql).all(params),
    run: (sql, params) => {
      c.prepare(sql).run(params);
    },
  };
}

/**
 * Host only: the guest with this origin (the guest view's id) may open `path`. With `record`, each call's changes go
 * to the outbox. Bind before the guest mounts.
 */
export function bind(origin: string, path: string, options: { record: boolean }): void {
  native().bind(origin, path, options.record);
}

/** Host only: forgets the origin and closes its guest's connection; that guest's handle fails from then on. */
export function unbind(origin: string): void {
  native().unbind(origin);
}

/** Guest only, once per runtime: the connection to the file the host bound to this guest. */
export function installGuest(): GuestAppDb {
  native().install();
  return take<GuestAppDb>("__lophnAppDb");
}
