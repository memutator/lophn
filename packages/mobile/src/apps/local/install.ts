// First install of an app that runs on the phone. A sync app starts from a snapshot of the computer's database (cursor
// at the snapshot's seq); a standalone app from an empty database migrated by its own migration files.
import type { LophnError } from "../../../../base/errors.ts";
import { err, ok, type Result } from "../../../../base/result.ts";
import { adoptSnapshot, ensureSyncTables } from "../../../../protocol/apps/sync/mod.ts";
import type { PhoneScreen } from "../../data/apps.ts";
import { migrateTo, transaction, withDb } from "./db.ts";
import {
  type Installed,
  kindOf,
  paths,
  readInstalled,
  removeDb,
  withComputer,
  writeInstalled,
} from "./folder.ts";
import type { LocalDeps, Remote } from "./ports.ts";
import { writeCursor } from "./sync.ts";
import { fetchRelease, fetchSnapshot } from "./transfer.ts";

export type Ctx = { deps: LocalDeps; remote: Remote; computer: string; node: string };

/** Where an install stopped: taking the release's files, taking the computer's data, or setting the data up here. */
export type InstallStep = "files" | "snapshot" | "data";
export type InstallError = LophnError & { readonly step: InstallStep };

const stoppedAt = (step: InstallStep, error: LophnError): Result<never, InstallError> =>
  err({ ...error, step });

const STALE: LophnError = { code: "conflict", message: "the release changed while the phone took it" };
/** The release on the computer moved while the phone took it: read the list again. */
export const staleList = (): Result<never> => err(STALE);

/**
 * Installs the app from its entries in `apps/phone_screens` (one release). An install that stopped half way is thrown
 * away first; an installed app is left as it is.
 */
export async function install(
  ctx: Ctx,
  screens: readonly [PhoneScreen, ...PhoneScreen[]],
): Promise<Result<Installed, InstallError>> {
  const { files } = ctx.deps;
  const first = screens[0];
  const at = paths(first.app);
  const known = readInstalled(files, first.app);
  if (known !== null) {
    const computers = withComputer(known.computers, ctx.computer);
    if (computers === known.computers) return ok(known);
    const updated = { ...known, computers };
    writeInstalled(files, updated);
    return ok(updated);
  }
  files.remove(at.dir);
  const done = await put(ctx, screens);
  if (!done.ok) {
    files.remove(at.dir);
    return done;
  }
  writeInstalled(files, done.value);
  return done;
}

async function put(
  ctx: Ctx,
  screens: readonly [PhoneScreen, ...PhoneScreen[]],
): Promise<Result<Installed, InstallError>> {
  const { deps } = ctx;
  const first = screens[0];
  const backend = first.backend!;
  const at = paths(first.app);
  const fetched = await fetchRelease({ files: deps.files, remote: ctx.remote }, screens);
  if (!fetched.ok) return stoppedAt("files", fetched.error);
  const kind = kindOf(first);
  if (kind === "sync") {
    const snapshot = `${at.work}/snapshot.sqlite`;
    const taken = await fetchSnapshot({ files: deps.files, remote: ctx.remote }, first.app, snapshot);
    if (!taken.ok) return stoppedAt("snapshot", taken.error);
    if (taken.value.release !== first.release) return stoppedAt("snapshot", STALE);
    removeDb(deps.files, at.db);
    deps.files.move(snapshot, at.db);
    deps.files.remove(at.work);
    await withDb(deps, at.db, (db) =>
      transaction(db, () => {
        adoptSnapshot(db, {
          node: ctx.node,
          cursor: String(taken.value.seq),
          release: first.release,
        });
        writeCursor(db, ctx.computer, taken.value.seq);
        return ok(undefined);
      }),
    );
  } else {
    const migrated = await withDb(deps, at.db, (db) => {
      ensureSyncTables(db, ctx.node);
      return migrateTo(deps, db, { app: first.app, release: first.release }, backend);
    });
    if (!migrated.ok) return stoppedAt("data", migrated.error);
  }
  return ok({
    app: first.app,
    name: first.app_name,
    icon: first.icon,
    kind,
    release: first.release,
    screens,
    backend,
    last_synced_at: kind === "sync" ? new Date(deps.now()).toISOString() : null,
    backup: null,
    computers: [ctx.computer],
  });
}
