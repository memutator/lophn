// One sync app's push and pull. Each runs in the host's own transactions on the app's file; a guest call waits for
// them and they wait for a guest call (busy timeout), so incoming changes land only between guest calls.
import { err, ok, type Result } from "../../../../base/result.ts";
import {
  APP_SYNC_CHANGE_MAX_BYTES,
  APP_SYNC_PUSH_MAX_BYTES,
  APP_SYNC_PUSH_MAX_CHANGES,
  appSyncPull,
  appSyncPush,
} from "../../../../protocol/apps/app-sync.ts";
import {
  applyRemote,
  getState,
  type IncomingChange,
  type OutboxRow,
  openClock,
  readOutbox,
  setState,
  stampOutbox,
} from "../../../../protocol/apps/sync/mod.ts";
import { outboxCount, transaction, withDb } from "./db.ts";
import { type Installed, paths, removeDb, writeInstalled } from "./folder.ts";
import type { HostDb, LocalDeps, Remote } from "./ports.ts";
import { ask, failed, fromBase64, toBase64 } from "./transfer.ts";

type Ctx = { deps: LocalDeps; remote: Remote; computer: string };

export type Pushed = { pushed: number; left: number };

/** Gives the outbox rows that have no clock yet their clocks, in commit order. */
export function stamp(deps: LocalDeps, db: HostDb): Result<number> {
  return transaction(db, () => stampOutbox(db, openClock(db), deps.now()));
}

function batches(rows: readonly OutboxRow[]): Result<OutboxRow[][]> {
  const out: OutboxRow[][] = [];
  let batch: OutboxRow[] = [];
  let bytes = 0;
  for (const row of rows) {
    if (row.changeset.byteLength > APP_SYNC_CHANGE_MAX_BYTES) {
      return err({
        code: "invalid_input",
        message: `a change of ${row.operation} is too large to send to the computer`,
      });
    }
    if (
      batch.length === APP_SYNC_PUSH_MAX_CHANGES ||
      (batch.length > 0 && bytes + row.changeset.byteLength > APP_SYNC_PUSH_MAX_BYTES)
    ) {
      out.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(row);
    bytes += row.changeset.byteLength;
  }
  if (batch.length > 0) out.push(batch);
  return ok(out);
}

function drop(db: HostDb, ids: readonly string[]): void {
  if (ids.length === 0) return;
  transaction(db, () => {
    for (const id of ids) db.run("delete from lophn_sync_outbox where id = ?", [id]);
    return ok(undefined);
  });
}

const answered = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((one) => String((one as { id: unknown }).id)) : [];

/**
 * Stamps the outbox and sends it in commit order. A row leaves the outbox only once the computer answered for it
 * (applied, duplicate or skipped); on an error the rows the computer already took (its `details.results`) leave and
 * the rest stay. A `conflict` carries the computer's `active_release`.
 */
export async function push(ctx: Ctx, installed: Installed): Promise<Result<Pushed>> {
  const { deps } = ctx;
  return withDb(deps, paths(ctx.computer, installed.app).db, async (db) => {
    const stamped = stamp(deps, db);
    if (!stamped.ok) return stamped;
    const planned = batches(readOutbox(db));
    if (!planned.ok) return planned;
    let pushed = 0;
    for (const batch of planned.value) {
      const reply = await ask(ctx.remote, appSyncPush, {
        app: installed.app,
        release: installed.release,
        changes: batch.map((row) => ({
          id: row.id,
          operation: row.operation,
          started_at: row.started_at,
          hlc: String(row.hlc),
          changeset: toBase64(row.changeset),
        })),
      });
      if (!reply.ok) {
        const took = answered(reply.error.details?.["results"]);
        drop(db, took);
        return failed(reply);
      }
      const took = answered((reply.value as { results: unknown }).results);
      drop(db, took);
      pushed += took.length;
    }
    const left = outboxCount(db);
    // The backup of a release change is kept until the changes re-expressed on the new release reached the computer.
    if (left === 0 && installed.backup !== null) {
      removeDb(deps.files, paths(ctx.computer, installed.app).backup(installed.backup));
      writeInstalled(deps.files, ctx.computer, { ...installed, backup: null });
    }
    return ok({ pushed, left });
  });
}

type Pulled = {
  changes: { seq: number; hlc: string; changeset: string }[];
  next: number;
  more: boolean;
  snapshot_needed: boolean;
};

/**
 * One pulled batch in one transaction: the outbox is stamped first, then the changes are applied, then the cursor
 * moves. Any error rolls all of it back and the cursor stays. A change the database refuses (a constraint) is skipped
 * alone, so one bad change does not stop the app from syncing for good.
 */
export function applyBatch(
  deps: LocalDeps,
  db: HostDb,
  changes: readonly IncomingChange[],
  next: number,
): Result<{ applied: number; refused: number }> {
  db.exec("pragma foreign_keys = off");
  try {
    return transaction(db, () => {
      const clock = openClock(db);
      const stamped = stampOutbox(db, clock, deps.now());
      if (!stamped.ok) return stamped;
      let applied = 0;
      let refused = 0;
      for (const change of changes) {
        db.exec("savepoint lophn_change");
        let one: ReturnType<typeof applyRemote>;
        try {
          one = applyRemote(db, [change], clock);
        } catch (thrown) {
          db.exec("rollback to lophn_change");
          db.exec("release lophn_change");
          console.warn(`sync: skipped a change the database refused: ${String(thrown)}`);
          refused++;
          continue;
        }
        db.exec("release lophn_change");
        if (!one.ok) return one;
        applied += one.value.applied;
      }
      setState(db, "cursor", String(next));
      return ok({ applied, refused });
    });
  } finally {
    db.exec("pragma foreign_keys = on");
  }
}

/** Pulls after the cursor until the computer has no more. `snapshot_needed` means: take a new snapshot. */
export async function pull(
  ctx: Ctx,
  installed: Installed,
): Promise<Result<{ applied: number; snapshot_needed: boolean }>> {
  const { deps } = ctx;
  return withDb(deps, paths(ctx.computer, installed.app).db, async (db) => {
    let applied = 0;
    for (;;) {
      const after = Number(getState(db, "cursor") ?? "0");
      const reply = await ask(ctx.remote, appSyncPull, {
        app: installed.app,
        release: installed.release,
        after,
      });
      if (!reply.ok) return failed(reply);
      const got = reply.value as Pulled;
      if (got.snapshot_needed) return ok({ applied, snapshot_needed: true });
      if (got.next !== after || got.changes.length > 0) {
        const done = applyBatch(
          deps,
          db,
          got.changes.map((one) => ({ hlc: BigInt(one.hlc), changeset: fromBase64(one.changeset) })),
          got.next,
        );
        if (!done.ok) return done;
        applied += done.value.applied;
      }
      if (!got.more) return ok({ applied, snapshot_needed: false });
    }
  });
}
