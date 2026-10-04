import { err, ok, type Result } from "../../base/mod.ts";
import type { App } from "../../contracts/apps/mod.ts";
import type { Sql, SqlRow, Tx } from "../../contracts/platform/mod.ts";
import { appFromRow } from "./rows.ts";

type Query = Pick<Sql, "get" | "all">;

function invalidStored(): Result<never> {
  return err({ code: "internal", message: "invalid stored app" });
}

export function loadApp(sql: Query, id: string): Result<App | null> {
  const row = sql.get("SELECT * FROM apps WHERE id = ?", [id]);
  if (row === undefined) return ok(null);
  const app = appFromRow(row as SqlRow);
  if (!app.ok) return app;
  if (app.value.id !== id) return invalidStored();
  return app;
}

export function loadApps(
  sql: Query,
  status: "active" | "archived" | undefined,
): Result<App[]> {
  const rows = status === undefined
    ? sql.all("SELECT * FROM apps ORDER BY id", [])
    : sql.all("SELECT * FROM apps WHERE status = ? ORDER BY id", [status]);
  const apps: App[] = [];
  for (const row of rows) {
    const app = appFromRow(row);
    if (!app.ok) return app;
    apps.push(app.value);
  }
  return ok(apps);
}

export function insertApp(tx: Pick<Tx, "sql">, app: App): void {
  tx.sql.run(
    `INSERT INTO apps
      (id, slug, name, description, planning_version, source_path,
       active_release, run_enabled, revision, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      app.id,
      app.slug,
      app.name,
      app.description,
      app.planning_version,
      app.source_path,
      app.active_release,
      app.run_enabled ? 1 : 0,
      app.revision,
      app.status,
    ],
  );
}

export function replaceApp(tx: Pick<Tx, "sql">, app: App): Result<void> {
  const changed = tx.sql.run(
    `UPDATE apps
     SET name = ?, description = ?, planning_version = ?, source_path = ?,
         active_release = ?, run_enabled = ?, revision = ?, status = ?
     WHERE id = ?`,
    [
      app.name,
      app.description,
      app.planning_version,
      app.source_path,
      app.active_release,
      app.run_enabled ? 1 : 0,
      app.revision,
      app.status,
      app.id,
    ],
  );
  return Number(changed.changes) === 1
    ? ok(undefined)
    : invalidStored();
}
