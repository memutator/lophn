import { err, ok, type Result } from "../../../base/mod.ts";
import type { IconImage } from "../../../protocol/base/icon.ts";
import type { App } from "../../../protocol/apps/mod.ts";
import type { Sql, SqlRow, Tx } from "../../../protocol/server/mod.ts";
import { appFromRow } from "./rows.ts";

type Query = Pick<Sql, "get" | "all">;

function invalidStored(): Result<never> {
  return err({ code: "internal", message: "invalid stored app" });
}

const FOLDER_ROWS =
  "SELECT path, description FROM app_folders WHERE app = ? ORDER BY position";

export function loadApp(sql: Query, id: string): Result<App | null> {
  const row = sql.get("SELECT * FROM apps WHERE id = ?", [id]);
  if (row === undefined) return ok(null);
  const app = appFromRow(row as SqlRow, sql.all(FOLDER_ROWS, [id]));
  if (!app.ok) return app;
  if (app.value.id !== id) return invalidStored();
  return app;
}

export function loadApps(
  sql: Query,
  status: "active" | "archived" | undefined,
): Result<App[]> {
  const rows =
    status === undefined
      ? sql.all("SELECT * FROM apps ORDER BY id", [])
      : sql.all("SELECT * FROM apps WHERE status = ? ORDER BY id", [status]);
  const apps: App[] = [];
  for (const row of rows) {
    const app = appFromRow(row, sql.all(FOLDER_ROWS, [String(row.id)]));
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

// 폴더 행은 replaceApp이 건드리지 않는다. 폴더를 바꾸는 command만 replaceFolders를 부른다.
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
  return Number(changed.changes) === 1 ? ok(undefined) : invalidStored();
}

export function replaceFolders(tx: Pick<Tx, "sql">, app: App): void {
  tx.sql.run("DELETE FROM app_folders WHERE app = ?", [app.id]);
  app.folders.forEach((folder, position) => {
    tx.sql.run(
      "INSERT INTO app_folders (app, position, path, description) VALUES (?, ?, ?, ?)",
      [app.id, position, folder.path, folder.description],
    );
  });
}

export function loadAppIcon(sql: Query, app: string): IconImage | null {
  const row = sql.get(
    "SELECT content_type, data FROM app_icons WHERE app = ?",
    [app],
  );
  return row === undefined
    ? null
    : ({ content_type: row.content_type, data: row.data } as IconImage);
}

// icon이 null이면 올린 것을 지운다.
export function storeAppIcon(
  tx: Pick<Tx, "sql">,
  app: string,
  icon: IconImage | null,
): void {
  tx.sql.run("DELETE FROM app_icons WHERE app = ?", [app]);
  if (icon === null) return;
  tx.sql.run(
    "INSERT INTO app_icons (app, content_type, data) VALUES (?, ?, ?)",
    [app, icon.content_type, icon.data],
  );
}
