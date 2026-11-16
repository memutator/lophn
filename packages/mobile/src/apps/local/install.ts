// First install of an app that runs on the phone. A sync app starts from a snapshot of the computer's database (cursor
// at the snapshot's seq); a standalone app from an empty database migrated by its own migration files.
import { err, ok, type Result } from "../../../../base/result.ts";
import { adoptSnapshot, ensureSyncTables } from "../../../../protocol/apps/sync/mod.ts";
import type { PhoneScreen } from "../../data/apps.ts";
import { migrateTo, transaction, withDb } from "./db.ts";
import { type Installed, kindOf, paths, readInstalled, removeDb, writeInstalled } from "./folder.ts";
import type { LocalDeps, Remote } from "./ports.ts";
import { fetchRelease, fetchSnapshot } from "./transfer.ts";

export type Ctx = { deps: LocalDeps; remote: Remote; computer: string; node: string };

/** The release on the computer moved while the phone took it: read the list again. */
export const staleList = (): Result<never> =>
  err({ code: "conflict", message: "the release changed while the phone took it" });

/**
 * Installs the app from its entries in `apps/phone_screens` (one release). An install that stopped half way is thrown
 * away first; an installed app is left as it is.
 */
export async function install(
  ctx: Ctx,
  screens: readonly [PhoneScreen, ...PhoneScreen[]],
): Promise<Result<Installed>> {
  const { files } = ctx.deps;
  const first = screens[0];
  const at = paths(ctx.computer, first.app);
  const known = readInstalled(files, ctx.computer, first.app);
  if (known !== null) return ok(known);
  files.remove(at.dir);
  const done = await put(ctx, screens);
  if (!done.ok) {
    files.remove(at.dir);
    return done;
  }
  writeInstalled(files, ctx.computer, done.value);
  return done;
}

async function put(
  ctx: Ctx,
  screens: readonly [PhoneScreen, ...PhoneScreen[]],
): Promise<Result<Installed>> {
  const { deps } = ctx;
  const first = screens[0];
  const backend = first.backend!;
  const at = paths(ctx.computer, first.app);
  const fetched = await fetchRelease({ files: deps.files, remote: ctx.remote, computer: ctx.computer }, screens);
  if (!fetched.ok) return fetched;
  const kind = kindOf(first);
  if (kind === "sync") {
    const snapshot = `${at.work}/snapshot.sqlite`;
    const taken = await fetchSnapshot({ files: deps.files, remote: ctx.remote }, first.app, snapshot);
    if (!taken.ok) return taken;
    if (taken.value.release !== first.release) return staleList();
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
        return ok(undefined);
      }),
    );
  } else {
    const migrated = await withDb(deps, at.db, (db) => {
      ensureSyncTables(db, ctx.node);
      return migrateTo(deps, db, { computer: ctx.computer, app: first.app, release: first.release }, backend);
    });
    if (!migrated.ok) return migrated;
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
  });
}
