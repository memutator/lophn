// A new release (or a new snapshot of the same one) replaces what the phone has. The guest is down first (the caller
// waits for it). app.sqlite is backed up and is not touched until the new file is whole: every step works on copies in
// work/, and a failure leaves app.sqlite and its outbox as they were.
//   sync, outbox empty:   the new release's snapshot becomes app.sqlite.
//   sync, outbox pending: a copy is migrated by the new release's migrations, the snapshot is adopted, and the pending
//                         changes are re-expressed by name on top of it (they are pushed next). The backup stays
//                         until the first push on the new release succeeds.
//   standalone:           a copy is migrated; no snapshot.
import { ok, type Result } from "../../../../base/result.ts";
import { adoptSnapshot, reexpress } from "../../../../protocol/apps/sync/mod.ts";
import type { PhoneScreen } from "../../data/apps.ts";
import { migrateTo, outboxCount, transaction, wholeFile, withDb } from "./db.ts";
import { type Installed, paths, removeDb, writeInstalled } from "./folder.ts";
import { type Ctx, staleList } from "./install.ts";
import { stamp } from "./sync.ts";
import { fetchRelease, fetchSnapshot } from "./transfer.ts";

export async function switchRelease(
  ctx: Ctx,
  installed: Installed,
  screens: readonly [PhoneScreen, ...PhoneScreen[]],
): Promise<Result<Installed>> {
  const { deps } = ctx;
  const { files } = deps;
  const at = paths(ctx.computer, installed.app);
  const next = screens[0];
  const fetched = await fetchRelease({ files, remote: ctx.remote, computer: ctx.computer }, screens);
  if (!fetched.ok) return fetched;

  // The outbox is stamped before the backup: re-expression reads each change's clock from it.
  const pending = await withDb(deps, at.db, (db) => {
    const stamped = installed.kind === "sync" ? stamp(deps, db) : ok(0);
    if (!stamped.ok) return stamped;
    wholeFile(db);
    return ok(installed.kind === "sync" ? outboxCount(db) : 0);
  });
  if (!pending.ok) return pending;
  const backup = at.backup(next.release);
  removeDb(files, backup);
  files.copy(at.db, backup);

  files.remove(at.work);
  const built = await build(ctx, installed, next, backup, pending.value);
  if (!built.ok) {
    files.remove(at.work);
    removeDb(files, backup);
    if (next.release !== installed.release) files.remove(at.release(next.release));
    return built;
  }
  removeDb(files, at.db);
  files.move(built.value, at.db);
  files.remove(at.work);

  const keep = installed.kind === "sync" && pending.value > 0;
  const switched: Installed = {
    ...installed,
    name: next.app_name,
    icon: next.icon,
    release: next.release,
    screens,
    backend: next.backend!,
    backup: keep ? next.release : null,
  };
  writeInstalled(files, ctx.computer, switched);
  for (const name of files.list(at.dir)) {
    const path = `${at.dir}/${name}`;
    if (name.startsWith("app.before-") && !(keep && path === backup)) files.remove(path);
  }
  for (const release of files.list(at.releases)) {
    if (release !== next.release) files.remove(at.release(release));
  }
  return ok(switched);
}

/** Puts the new app.sqlite together in work/ and gives its path. */
async function build(
  ctx: Ctx,
  installed: Installed,
  next: PhoneScreen,
  backup: string,
  pending: number,
): Promise<Result<string>> {
  const { deps } = ctx;
  const at = paths(ctx.computer, installed.app);
  const where = { computer: ctx.computer, app: installed.app, release: next.release };
  const migrated = `${at.work}/migrated.sqlite`;
  const migrate = async (): Promise<Result<number>> => {
    deps.files.copy(backup, migrated);
    return withDb(deps, migrated, async (db) => {
      const done = await migrateTo(deps, db, where, next.backend!);
      if (done.ok) wholeFile(db);
      return done;
    });
  };

  if (installed.kind === "standalone") {
    const done = await migrate();
    return done.ok ? ok(migrated) : done;
  }

  if (pending > 0) {
    const done = await migrate();
    if (!done.ok) return done;
  }
  const snapshot = `${at.work}/snapshot.sqlite`;
  const taken = await fetchSnapshot({ files: deps.files, remote: ctx.remote }, installed.app, snapshot);
  if (!taken.ok) return taken;
  if (taken.value.release !== next.release) return staleList();
  return withDb(deps, snapshot, async (db) => {
    const adopted = transaction(db, () => {
      adoptSnapshot(db, { node: ctx.node, cursor: String(taken.value.seq), release: next.release });
      return ok(undefined);
    });
    if (!adopted.ok) return adopted;
    if (pending > 0) {
      const again = await withDb(deps, backup, (old) =>
        withDb(deps, migrated, (into) => reexpress({ old, migrated: into, snapshot: db })),
      );
      if (!again.ok) return again;
    }
    wholeFile(db);
    return ok(snapshot);
  });
}
