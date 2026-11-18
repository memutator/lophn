import { err, type IdSource, ok, type Result } from "../../../base/mod.ts";
import type { IconImage } from "../../../protocol/base/icon.ts";
import {
  PROJECT_FORMER_IDENTITIES_MAX,
  type ProjectFolder,
} from "../../../protocol/projects/mod.ts";
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

// identity·repo·remote는 폴더를 읽은 뒤 recordIdentity가 적는다. 새 project는 모두 null이고 옛 identity는 없다.
export function insertProject(tx: Pick<Tx, "sql">, project: Project): void {
  tx.sql.run(
    `INSERT INTO projects (id, name, title, purpose, revision, status, identity, repo, remote_key, remote_url)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)`,
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

// identity·repo·remote만 바꾸고 바뀐 project를 낸다. revision은 올리지 않는다(열린 편집 form의 CAS와 부딪치지 않게).
// identity가 다른 값으로 바뀌는 모든 길(잇기, renew 뒤 다시 읽기, id file이 ledger에서 난 id를 대신함)이 여기를 지나므로
// 옛 identity를 남기는 곳은 여기 하나다. null로 비울 때는 남기지 않는다: 그 id는 같은 기계의 다른 project로 갔다.
export function storeIdentity(
  tx: Pick<Tx, "sql">,
  before: Project,
  value: Pick<Project, "identity" | "repo" | "remote">,
): Project {
  const kept =
    before.identity !== null &&
    value.identity !== null &&
    before.identity !== value.identity
      ? [
          ...before.former_identities.filter((id) => id !== before.identity),
          before.identity,
        ]
      : before.former_identities;
  const project: Project = {
    ...before,
    ...value,
    former_identities: kept
      .filter((id) => id !== value.identity)
      .slice(-PROJECT_FORMER_IDENTITIES_MAX),
  };
  tx.sql.run(
    "UPDATE projects SET identity = ?, former_identities = ?, repo = ?, remote_key = ?, remote_url = ? WHERE id = ?",
    [
      project.identity,
      JSON.stringify(project.former_identities),
      project.repo,
      project.remote?.key ?? null,
      project.remote?.url ?? null,
      project.id,
    ],
  );
  return project;
}

// 이 기계에서 지금이나 옛 identity로 그 id를 가진 다른 project(보관 포함)가 있는가.
export function identityHeldElsewhere(
  sql: Query,
  identity: string,
  project: string,
): boolean {
  return (
    sql.get(
      `SELECT 1 AS held FROM projects
       WHERE id <> ?
         AND (identity = ?
           OR EXISTS (SELECT 1 FROM json_each(former_identities) WHERE value = ?))`,
      [project, identity, identity],
    ) !== undefined
  );
}

export function clearIdentity(tx: Pick<Tx, "sql">, project: string): void {
  tx.sql.run("UPDATE projects SET identity = NULL WHERE id = ?", [project]);
}

// git이 아닌 것으로 읽은 project와 폴더가 없는 project 가운데 id가 없는 것에 ledger에서 난 id를 준다. git project는
// file에서만 id를 얻으므로 건드리지 않는다. 아직 폴더를 읽지 않은 project(repo NULL, 폴더 있음)는 다음 읽기가 준다.
// `repo = 'none'`은 "git이 아니다"와 "git이 답하지 않았다"(이 고침 전의 읽기)를 가르지 못해 폴더에 `.git`이 있으면 두고
// 다음 읽기에 맡긴다. 이미 준 것은 다시 고르지 않아 끊겨 다시 돌아도 같다.
export function assignBornIdentities(
  sql: Pick<Sql, "all" | "run">,
  ids: IdSource,
  hasGit: (folder: string) => boolean,
): number {
  const rows = sql.all(
    `SELECT id FROM projects
     WHERE identity IS NULL
       AND (repo = 'none'
         OR NOT EXISTS (SELECT 1 FROM project_folders WHERE project = projects.id))
     ORDER BY id`,
    [],
  );
  let given = 0;
  for (const row of rows) {
    const folders = sql.all(
      "SELECT path FROM project_folders WHERE project = ?",
      [row.id],
    );
    if (folders.some((folder) => hasGit(String(folder.path)))) continue;
    sql.run("UPDATE projects SET identity = ? WHERE id = ?", [
      ids.newId("pri"),
      row.id,
    ]);
    given += 1;
  }
  return given;
}
