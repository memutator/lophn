import { err, ok, type Result } from "../../base/mod.ts";
import type {
  Folder,
  Project,
  TrackingPattern,
} from "../../protocol/projects/mod.ts";
import type { Sql, SqlRow, Tx } from "../../protocol/platform/mod.ts";
import { projectFromRows } from "./rows.ts";

type Query = Pick<Sql, "get" | "all">;

function invalidStored(): Result<never> {
  return err({ code: "internal", message: "invalid stored project" });
}

export function loadProject(sql: Query, id: string): Result<Project | null> {
  const row = sql.get("SELECT * FROM projects WHERE id = ?", [id]);
  if (row === undefined) return ok(null);
  const folders = sql.all(
    "SELECT position, path, description FROM project_folders WHERE project = ? ORDER BY position",
    [id],
  );
  const patterns = sql.all(
    "SELECT position, effect, glob FROM project_tracking_patterns WHERE project = ? ORDER BY position",
    [id],
  );
  const project = projectFromRows(row, folders, patterns);
  if (!project.ok) return project;
  if (project.value.id !== id) return invalidStored();
  return project;
}

export function loadProjects(sql: Query): Result<Project[]> {
  const rows = sql.all("SELECT id FROM projects ORDER BY id", []);
  const projects: Project[] = [];
  for (const row of rows) {
    if (typeof row.id !== "string") return invalidStored();
    const project = loadProject(sql, row.id);
    if (!project.ok) return project;
    if (project.value === null) return invalidStored();
    projects.push(project.value);
  }
  return ok(projects);
}

export function enabledRoots(projects: readonly Project[]) {
  return projects.flatMap((project) =>
    project.status === "active" && project.tracking.enabled
      ? project.folders.map((folder) => ({
        project: project.id,
        path: folder.path,
        enabled: true,
      }))
      : []
  );
}

export function insertProject(
  tx: Pick<Tx, "sql">,
  project: Project,
): void {
  tx.sql.run(
    `INSERT INTO projects
      (id, name, title, purpose, tracking_enabled, use_gitignore, revision, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      project.id,
      project.name,
      project.title,
      project.purpose,
      project.tracking.enabled ? 1 : 0,
      project.tracking.use_gitignore ? 1 : 0,
      project.revision,
      project.status,
    ],
  );
  replaceChildren(tx, project.id, project.folders, project.tracking.patterns);
}

export function replaceMetadata(
  tx: Pick<Tx, "sql">,
  project: Project,
): Result<void> {
  const changed = tx.sql.run(
    `UPDATE projects
     SET name = ?, title = ?, purpose = ?, tracking_enabled = ?, use_gitignore = ?,
         revision = ?, status = ?
     WHERE id = ?`,
    [
      project.name,
      project.title,
      project.purpose,
      project.tracking.enabled ? 1 : 0,
      project.tracking.use_gitignore ? 1 : 0,
      project.revision,
      project.status,
      project.id,
    ],
  );
  return Number(changed.changes) === 1 ? ok(undefined) : invalidStored();
}

export function replaceChildren(
  tx: Pick<Tx, "sql">,
  project: string,
  folders: readonly Folder[],
  patterns: readonly TrackingPattern[],
): void {
  tx.sql.run("DELETE FROM project_folders WHERE project = ?", [project]);
  tx.sql.run("DELETE FROM project_tracking_patterns WHERE project = ?", [
    project,
  ]);
  folders.forEach((folder, position) => {
    tx.sql.run(
      "INSERT INTO project_folders (project, position, path, description) VALUES (?, ?, ?, ?)",
      [project, position, folder.path, folder.description],
    );
  });
  patterns.forEach((pattern, position) => {
    tx.sql.run(
      "INSERT INTO project_tracking_patterns (project, position, effect, glob) VALUES (?, ?, ?, ?)",
      [project, position, pattern.effect, pattern.glob],
    );
  });
}

export function rowCount(row: SqlRow | undefined): Result<number> {
  const value = row?.count;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return ok(value);
  }
  if (
    typeof value === "bigint" && value >= 0n &&
    value <= BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    return ok(Number(value));
  }
  return invalidStored();
}
