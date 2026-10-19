import type { Tx } from "../../protocol/server/mod.ts";

// 다른 concern(lophn-agent의 agent 정의 저장소 등)이 project 표를 읽을 때 쓰는 읽기 함수다. 표는 이 module이
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

// active project의 등록 폴더 경로. 없거나 보관된 project는 null이다.
export function projectRootsOf(sql: ReadSql, project: string): string[] | null {
  const row = sql.get("select status from projects where id = ?", [project]);
  if (row === undefined || row["status"] !== "active") return null;
  return projectFolderPaths(sql, project);
}

// project의 보관 여부. 없으면 null이다.
export function projectStatusOf(
  sql: ReadSql,
  id: string,
): "active" | "archived" | null {
  const row = sql.get("select status from projects where id = ?", [id]);
  return row === undefined
    ? null
    : row["status"] === "archived"
    ? "archived"
    : "active";
}
