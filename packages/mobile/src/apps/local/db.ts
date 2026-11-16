import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { Result } from "../../../../base/result.ts";
import type { PhoneBackendManifest } from "../../../../protocol/apps/phone-backend.ts";
import { type MigrationStep, migrate } from "../../../../protocol/apps/sync/mod.ts";
import { releaseFiles } from "./folder.ts";
import type { HostDb, LocalDeps } from "./ports.ts";

/** Opens the database at a folder path, runs `work` and closes it. */
export async function withDb<T>(
  deps: LocalDeps,
  path: string,
  work: (db: HostDb) => T | Promise<T>,
): Promise<T> {
  const db = deps.open(deps.files.absolute(path));
  try {
    return await work(db);
  } finally {
    db.close();
  }
}

/**
 * One `BEGIN IMMEDIATE` transaction: committed when `work` gives ok, rolled back when it gives an error or throws.
 * A guest call waits for it (busy timeout), and it waits for a guest call.
 */
export function transaction<T>(db: HostDb, work: () => Result<T>): Result<T> {
  db.exec("begin immediate");
  let result: Result<T>;
  try {
    result = work();
  } catch (thrown) {
    db.exec("rollback");
    throw thrown;
  }
  db.exec(result.ok ? "commit" : "rollback");
  return result;
}

/**
 * Leaves WAL mode so the main file holds everything by itself; run before the file is copied or moved. Only when no
 * other connection is open (the guest is unbound).
 */
export function wholeFile(db: HostDb): void {
  db.exec("pragma wal_checkpoint(truncate)");
  db.exec("pragma journal_mode = delete");
}

export function outboxCount(db: HostDb): number {
  const row = db.all("select count(*) as n from lophn_sync_outbox")[0];
  return Number(row?.["n"] ?? 0);
}

const sha256Text = async (text: string) => bytesToHex(sha256(utf8ToBytes(text)));

/** Runs the release's migration files (from its folder) on `db` up to its data schema. */
export function migrateTo(
  deps: LocalDeps,
  db: HostDb,
  at: { computer: string; app: string; release: string },
  backend: PhoneBackendManifest,
): Promise<Result<number>> {
  const files = releaseFiles(at.computer, at.app, at.release);
  const steps: MigrationStep[] = backend.migrations.map((step) => ({
    from: step.from,
    to: step.to,
    sql: deps.files.readText(files.migration(step.file)) ?? "",
    sha256: step.sha256,
  }));
  return migrate(db, {
    steps,
    target: backend.data_schema,
    sha256: sha256Text,
    appliedAt: new Date(deps.now()).toISOString(),
  });
}
