// What leaves the phone when an app leaves its computer's list. Data the computer does not have yet is never removed:
// a sync app's folder goes only when its outbox is empty and no computer it is installed with lacks one of its files, and a
// standalone app's data is never removed by itself (it stays in the phone's list and still opens).
import { outboxCount, withDb } from "./db.ts";
import { paths, readInstalled } from "./folder.ts";
import { missingFor } from "./held.ts";
import type { LocalDeps } from "./ports.ts";

/** The app left every paired computer's list: removes its folder when that loses nothing. Says whether it did. */
export async function pruneApp(deps: LocalDeps, app: string): Promise<boolean> {
  const installed = readInstalled(deps.files, app);
  if (installed === null || installed.kind !== "sync") return false;
  const at = paths(app);
  const left = await withDb(deps, at.db, (db) => outboxCount(db));
  if (left > 0) return false;
  if (installed.computers.some((computer) => missingFor(deps.files, app, computer).length > 0)) return false;
  deps.files.remove(at.dir);
  return true;
}
