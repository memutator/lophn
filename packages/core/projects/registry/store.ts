import { err, ok, type Result } from "../../../base/mod.ts";
import type { IconImage } from "../../../protocol/base/icon.ts";
import type { ProjectFolder } from "../../../protocol/projects/mod.ts";
import type { Sql, Tx } from "../../../protocol/server/mod.ts";
import type { Project } from "./model.ts";
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
  const project = projectFromRows(row, folders);
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

export function loadProjectByName(
  sql: Query,
  name: string,
): Result<Project | null> {
  const row = sql.get("SELECT id FROM projects WHERE name = ?", [name]);
  if (row === undefined) return ok(null);
  return typeof row.id === "string"
    ? loadProject(sql, row.id)
    : invalidStored();
}

export function insertProject(tx: Pick<Tx, "sql">, project: Project): void {
  tx.sql.run(
    `INSERT INTO projects (id, name, title, purpose, revision, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      project.id,
      project.name,
      project.title,
      project.purpose,
      project.revision,
      project.status,
    ],
  );
  replaceChildren(tx, project.id, project.folders);
}

export function replaceMetadata(
  tx: Pick<Tx, "sql">,
  project: Project,
): Result<void> {
  const changed = tx.sql.run(
    `UPDATE projects
     SET name = ?, title = ?, purpose = ?, revision = ?, status = ?
     WHERE id = ?`,
    [
      project.name,
      project.title,
      project.purpose,
      project.revision,
      project.status,
      project.id,
    ],
  );
  return Number(changed.changes) === 1 ? ok(undefined) : invalidStored();
}

// 폴더를 통째로 바꾼다.
export function replaceChildren(
  tx: Pick<Tx, "sql">,
  project: string,
  folders: readonly ProjectFolder[],
): void {
  tx.sql.run("DELETE FROM project_folders WHERE project = ?", [project]);
  folders.forEach((folder, position) => {
    tx.sql.run(
      "INSERT INTO project_folders (project, position, path, description) VALUES (?, ?, ?, ?)",
      [project, position, folder.path, folder.description],
    );
  });
}

export function loadProjectIcon(sql: Query, project: string): IconImage | null {
  const row = sql.get(
    "SELECT content_type, data FROM project_icons WHERE project = ?",
    [project],
  );
  return row === undefined
    ? null
    : ({ content_type: row.content_type, data: row.data } as IconImage);
}

// icon이 null이면 올린 것을 지운다.
export function storeProjectIcon(
  tx: Pick<Tx, "sql">,
  project: string,
  icon: IconImage | null,
): void {
  tx.sql.run("DELETE FROM project_icons WHERE project = ?", [project]);
  if (icon === null) return;
  tx.sql.run(
    "INSERT INTO project_icons (project, content_type, data) VALUES (?, ?, ?)",
    [project, icon.content_type, icon.data],
  );
}
