// One sync app's push and pull. Each runs in the host's own transactions on the app's file; a guest call waits for
// them and they wait for a guest call (busy timeout), so incoming changes land only between guest calls.
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { canonicalize } from "../../../../base/mod.ts";
import { err, ok, type Result } from "../../../../base/result.ts";
import {
  APP_SYNC_CHANGE_MAX_BYTES,
  APP_SYNC_PUSH_MAX_BYTES,
  APP_SYNC_PUSH_MAX_CHANGES,
  appSyncCustodyPush,
  appSyncPull,
  appSyncPush,
  CUSTODY_SIGN_CONTEXT,
  type CustodyEnvelopeBody,
} from "../../../../protocol/apps/app-sync.ts";
import type { SyncDb } from "../../../../protocol/apps/sync/db.ts";
import {
  type ApplyOptions,
  applyRemote,
  getState,
  type IncomingChange,
  type OutboxRow,
  openClock,
  readOutbox,
  stampOutbox,
} from "../../../../protocol/apps/sync/mod.ts";
import { type KeyPair, signDetached } from "../../../../protocol/remote/client.ts";
import { handleOf, uploadFile } from "../files/place.ts";
import { outboxCount, transaction, withDb } from "./db.ts";
import { type Installed, paths, removeDb, writeInstalled } from "./folder.ts";
import type { HostDb, LocalDeps, Remote } from "./ports.ts";
import { ackFile, missingFor, refuseFile } from "./held.ts";
import { ask, failed, fromBase64, toBase64 } from "./transfer.ts";

type Ctx = { deps: LocalDeps; remote: Remote; computer: string };

export type Pushed = { pushed: number; left: number };

export type CustodyCtx = {
  deps: LocalDeps;
  hub: Remote;
  targetComputer: string;
  targetMachine: string;
  device: string;
  signingKey: KeyPair;
  newCustodyId: () => string;
  alreadyHeld?: ReadonlySet<string>;
};

export type CustodyPushed = {
  held: string[];
  left: number;
  state: "held" | "duplicate" | "applied" | null;
};

const encoder = new TextEncoder();

/** Per-computer pull cursor key in `lophn_sync_state`. */
export const cursorKey = (computer: string) => `cursor:${computer}`;

export function writeCursor(db: SyncDb, computer: string, seq: number): void {
  db.run(
    "insert into lophn_sync_state (key, value) values (?, ?) on conflict (key) do update set value = excluded.value",
    [cursorKey(computer), String(seq)],
  );
}

/**
 * Reads the pull cursor for `computer`, falling back from the legacy single `cursor` key only for the computer whose
 * legacy `<computer>/<app>` folder was migrated into the shared folder.
 */
export function readCursor(
  db: SyncDb,
  computer: string,
  migratedFrom?: string,
): number {
  const row = db.all("select value from lophn_sync_state where key = ?", [
    cursorKey(computer),
  ])[0];
  if (row !== undefined) return Number(row["value"]);
  if (migratedFrom === computer) {
    const legacy = getState(db, "cursor");
    if (legacy !== null) return Number(legacy);
  }
  return 0;
}

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
 * Sends the computer the app's files it does not hold: a look at the folder minus the computer's record, a put for each (it
 * asks first, so a file the computer has costs no bytes), an acknowledgement written for each `stored` or `have`, and another
 * look, until a fresh look finds nothing missing (a file added meanwhile is included). A file the computer refuses for good
 * (the bytes are not their name, a value it can never accept) is remembered as refused for that computer and skipped from then
 * on; it blocks nothing and is counted as pending nowhere. A transient failure ends the pass with the error (the link
 * dropped); the app being absent on that computer ends only the files (`blocked`).
 */
export async function sendFiles(ctx: Ctx, app: string): Promise<Result<{ blocked: boolean }>> {
  const { files } = ctx.deps;
  const dir = paths(app).files;
  for (;;) {
    const missing = missingFor(files, app, ctx.computer);
    if (missing.length === 0) return ok({ blocked: false });
    for (const file of missing) {
      const handle = await handleOf(files, dir, file);
      if (handle === null) {
        console.warn(`sync: ${file} is in the folder listing but not readable; skipped`);
        refuseFile(files, app, ctx.computer, file);
        continue;
      }
      const done = await uploadFile({ files, dir, remote: ctx.remote, app }, handle);
      if (done.ok) {
        ackFile(files, app, ctx.computer, file);
        continue;
      }
      const { code, details } = done.error;
      if (code === "not_found" && details?.["reason"] === "local_missing") {
        console.warn(`sync: ${file} is in the folder listing but gone from the phone; skipped`);
        refuseFile(files, app, ctx.computer, file);
        continue;
      }
      if (code === "not_found") {
        // The app is not active on that computer (or the file vanished from the phone): no more files this pass.
        console.warn(`sync: ${ctx.computer} does not take files of ${app}: ${done.error.message}`);
        return ok({ blocked: true });
      }
      if (code === "invalid_input" && (details?.["reason"] === "mismatch" || details?.["received"] === undefined)) {
        console.warn(`sync: ${ctx.computer} refuses ${file} for good (${done.error.message}); it is skipped from now on`);
        refuseFile(files, app, ctx.computer, file);
        continue;
      }
      return done;
    }
  }
}

/**
 * Sends the files the computer lacks, then stamps the outbox and sends it in commit order. A row leaves the outbox only once the computer answered for it
 * (applied, duplicate or skipped); on an error the rows the computer already took (its `details.results`) leave and
 * the rest stay. A `conflict` carries the computer's `active_release`.
 */
export async function push(
  ctx: Ctx,
  installed: Installed,
  release: string = installed.release,
): Promise<Result<Pushed>> {
  const { deps } = ctx;
  // Before any row: a row may hold the handle of a file the computer must have by the time it reads the row. When the app is
  // not taken there, the rows wait too and the pull still runs.
  const sentFiles = await sendFiles(ctx, installed.app);
  if (!sentFiles.ok) return sentFiles;
  if (sentFiles.value.blocked) {
    return withDb(deps, paths(installed.app).db, (db) => ok({ pushed: 0, left: outboxCount(db) }));
  }
  return withDb(deps, paths(installed.app).db, async (db) => {
    const stamped = stamp(deps, db);
    if (!stamped.ok) return stamped;
    const planned = batches(readOutbox(db));
    if (!planned.ok) return planned;
    let pushed = 0;
    for (const batch of planned.value) {
      const reply = await ask(ctx.remote, appSyncPush, {
        app: installed.app,
        release,
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
    // The backup of a release change is kept until the changes re-expressed on the new release reached a computer.
    if (left === 0 && installed.backup !== null) {
      removeDb(deps.files, paths(installed.app).backup(installed.backup));
      writeInstalled(deps.files, { ...installed, backup: null });
    }
    return ok({ pushed, left });
  });
}

function encodePushPayload(
  app: string,
  release: string,
  batch: readonly OutboxRow[],
): Uint8Array {
  return encoder.encode(
    JSON.stringify({
      app,
      release,
      changes: batch.map((row) => ({
        id: row.id,
        operation: row.operation,
        started_at: row.started_at,
        hlc: String(row.hlc),
        changeset: toBase64(row.changeset),
      })),
    }),
  );
}

function custodyBatches(
  app: string,
  release: string,
  rows: readonly OutboxRow[],
): Result<{ rows: OutboxRow[]; payload: Uint8Array }[]> {
  const out: { rows: OutboxRow[]; payload: Uint8Array }[] = [];
  let batch: OutboxRow[] = [];
  let payload: Uint8Array | null = null;
  for (const row of rows) {
    const candidate = [...batch, row];
    const encoded = encodePushPayload(app, release, candidate);
    if (
      batch.length > 0 &&
      (candidate.length > APP_SYNC_PUSH_MAX_CHANGES ||
        encoded.byteLength > APP_SYNC_PUSH_MAX_BYTES)
    ) {
      out.push({ rows: batch, payload: payload! });
      batch = [row];
      payload = encodePushPayload(app, release, batch);
    } else {
      batch = candidate;
      payload = encoded;
    }
    if (payload.byteLength > APP_SYNC_PUSH_MAX_BYTES) {
      return err({
        code: "invalid_input",
        message: `a change of ${row.operation} is too large to send via hub custody`,
      });
    }
  }
  if (batch.length > 0 && payload !== null) out.push({ rows: batch, payload });
  return ok(out);
}

/**
 * Signs pending outbox changes with the phone's Ed25519 custody key and hands them to an online hub computer when the
 * target computer is offline. Rows stay in the local outbox so direct push still reconciles cleanly when the target
 * returns; `alreadyHeld` avoids re-sending rows the hub already accepted.
 */
export async function custodyPush(
  ctx: CustodyCtx,
  installed: Installed,
  release: string = installed.release,
): Promise<Result<CustodyPushed>> {
  const { deps } = ctx;
  return withDb(deps, paths(installed.app).db, async (db) => {
    const stamped = stamp(deps, db);
    if (!stamped.ok) return stamped;
    const all = readOutbox(db);
    const unsent =
      ctx.alreadyHeld === undefined || ctx.alreadyHeld.size === 0
        ? all
        : all.filter((row) => !ctx.alreadyHeld!.has(row.id));
    if (unsent.length === 0) {
      return ok({ held: [], left: all.length, state: null });
    }
    const planned = custodyBatches(installed.app, release, unsent);
    if (!planned.ok) return planned;
    const base_seq = readCursor(db, ctx.targetComputer, installed.migrated_from);
    const held: string[] = [];
    let state: CustodyPushed["state"] = null;
    for (const batch of planned.value) {
      const body: CustodyEnvelopeBody = {
        format: 1,
        custody: ctx.newCustodyId(),
        app: installed.app,
        target: ctx.targetMachine,
        device: ctx.device,
        base_seq,
        written_at: new Date(deps.now()).toISOString(),
        payload: toBase64(batch.payload),
        sha256: bytesToHex(sha256(batch.payload)),
        size: batch.payload.byteLength,
      };
      const signature = signDetached(
        CUSTODY_SIGN_CONTEXT,
        canonicalize(body),
        ctx.signingKey.secretKey,
      );
      const reply = await ask(ctx.hub, appSyncCustodyPush, { body, signature });
      if (!reply.ok) return failed(reply);
      state = (reply.value as { state: "held" | "duplicate" | "applied" }).state;
      for (const row of batch.rows) held.push(row.id);
    }
    return ok({ held, left: outboxCount(db), state });
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
  computer: string,
  options?: ApplyOptions,
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
          one = applyRemote(db, [change], clock, options);
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
      writeCursor(db, computer, next);
      return ok({ applied, refused });
    });
  } finally {
    db.exec("pragma foreign_keys = on");
  }
}

/** Pulls after the computer's cursor until it has no more. `snapshot_needed` means: take a new snapshot. */
export async function pull(
  ctx: Ctx,
  installed: Installed,
  release: string = installed.release,
  options?: ApplyOptions,
): Promise<Result<{ applied: number; snapshot_needed: boolean }>> {
  const { deps } = ctx;
  return withDb(deps, paths(installed.app).db, async (db) => {
    let applied = 0;
    for (;;) {
      const after = readCursor(db, ctx.computer, installed.migrated_from);
      const reply = await ask(ctx.remote, appSyncPull, {
        app: installed.app,
        release,
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
          ctx.computer,
          options,
        );
        if (!done.ok) return done;
        applied += done.value.applied;
      }
      if (!got.more) return ok({ applied, snapshot_needed: false });
    }
  });
}
