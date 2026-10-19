import type { Tx } from "../../protocol/server/mod.ts";

// 다른 concern(lophn-agent의 agent 정의 저장소 등)이 project·context 표를 읽을 때 쓰는 읽기 함수다. 표는 이 module이
// 갖는다. 조립(core/main)이 port로 꽂으므로 다른 module은 SQL을 직접 쓰지 않는다.
type ReadSql = Pick<Tx["sql"], "get" | "all">;

export function projectExists(sql: ReadSql, id: string): boolean {
  return sql.get("select 1 as found from projects where id = ?", [id]) !==
    undefined;
}

export function projectIds(sql: ReadSql): string[] {
  return sql.all("select id from projects order by id", []).map((row) =>
    String(row["id"])
  );
}

// context가 속한 project. 없으면 null이다.
export function contextProjectOf(sql: ReadSql, id: string): string | null {
  const row = sql.get("select project from contexts where id = ?", [id]);
  return row === undefined ? null : String(row["project"]);
}

export function activeContextIds(sql: ReadSql, project: string): string[] {
  return sql.all(
    "select id from contexts where project = ? and status = 'active' order by id",
    [project],
  ).map((row) => String(row["id"]));
}

// project의 등록 폴더 경로(position 순).
export function projectFolderPaths(sql: ReadSql, project: string): string[] {
  return sql.all(
    "select path from project_folders where project = ? order by position",
    [project],
  ).map((row) => String(row["path"]));
}

// path가 들어 있는 active project. 여럿이면 가장 안쪽 폴더를 가진 project다.
export function innermostProjectOfPath(
  sql: ReadSql,
  path: string,
): string | null {
  let best: { project: string; length: number } | null = null;
  for (
    const row of sql.all(
      `select f.project as project, f.path as path from project_folders f
       join projects p on p.id = f.project where p.status = 'active'`,
      [],
    )
  ) {
    const folder = String(row["path"]).replace(/\/+$/, "");
    const inside = path === folder || path.startsWith(`${folder}/`);
    if (inside && (best === null || folder.length > best.length)) {
      best = { project: String(row["project"]), length: folder.length };
    }
  }
  return best === null ? null : best.project;
}

// active project 전체의 등록 폴더 경로.
export function activeProjectFolderPaths(sql: ReadSql): string[] {
  return sql.all(
    `select f.path as path from project_folders f
       join projects p on p.id = f.project
      where p.status = 'active' order by f.project, f.position`,
    [],
  ).map((row) => String(row["path"]));
}

// project의 열린 초안 판. context마다 draft 판은 많아야 하나다.
export function draftBundles(
  sql: ReadSql,
  project: string,
): { context: string; bundle: string }[] {
  return sql.all(
    `select c.id as context, b.id as bundle from contexts c
       join context_bundles b on b.context = c.id
      where c.project = ? and b.status = 'draft' order by c.id`,
    [project],
  ).map((row) => ({
    context: String(row["context"]),
    bundle: String(row["bundle"]),
  }));
}

// active project마다 등록 폴더 경로(position 순). kinds worker가 훑을 root다.
export function activeProjectRoots(
  sql: ReadSql,
): { project: string; roots: string[] }[] {
  const byProject = new Map<string, string[]>();
  for (
    const row of sql.all(
      `select p.id as project, f.path as path from projects p
         left join project_folders f on f.project = p.id
        where p.status = 'active' order by p.id, f.position`,
      [],
    )
  ) {
    const roots = byProject.get(String(row["project"])) ?? [];
    if (row["path"] !== null) roots.push(String(row["path"]));
    byProject.set(String(row["project"]), roots);
  }
  return [...byProject].map(([project, roots]) => ({ project, roots }));
}

// active project의 등록 폴더 경로. 없거나 보관된 project는 null이다.
export function projectRootsOf(sql: ReadSql, project: string): string[] | null {
  const row = sql.get("select status from projects where id = ?", [project]);
  if (row === undefined || row["status"] !== "active") return null;
  return projectFolderPaths(sql, project);
}
