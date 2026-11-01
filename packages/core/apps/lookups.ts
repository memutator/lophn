import { appBundleCopy } from "../../protocol/apps/app-storage.ts";
import type { Tx } from "../../protocol/server/mod.ts";
import { publicSkillNames } from "../lophn-agent/extensions/skills.ts";
import { loadActiveDeclaration } from "./releases/store.ts";

// 다른 concern(lophn-agent의 agent 정의 저장소 등)이 apps 표를 읽을 때 쓰는 읽기 함수다. 표는 이 module이 갖는다.
// 조립(core/main)이 port로 꽂으므로 다른 module은 SQL을 직접 쓰지 않는다.
type ReadSql = Pick<Tx["sql"], "get" | "all">;

export function appExists(sql: ReadSql, id: string): boolean {
  return (
    sql.get("select 1 as found from apps where id = ?", [id]) !== undefined
  );
}

export function appIds(sql: ReadSql): string[] {
  return sql
    .all("select id from apps order by id", [])
    .map((row) => String(row["id"]));
}

// 앱 하나의 source 폴더. 앱이 없거나 source가 없으면 null이다.
export function appSourcePath(sql: ReadSql, id: string): string | null {
  const row = sql.get("select source_path from apps where id = ?", [id]);
  return row === undefined || row["source_path"] === null
    ? null
    : String(row["source_path"]);
}

// 앱에 source 밖으로 더 이은 폴더 경로(position 순).
export function appFolderPaths(sql: ReadSql, id: string): string[] {
  return sql
    .all("select path from app_folders where app = ? order by position", [id])
    .map((row) => String(row["path"]));
}

// active 앱 전체의 source 폴더(source가 없는 앱은 뺀다).
export function activeAppSourcePaths(sql: ReadSql): string[] {
  return sql
    .all(
      `select source_path from apps
      where status = 'active' and source_path is not null order by id`,
      [],
    )
    .map((row) => String(row["source_path"]));
}

// 앱의 보관 여부. 없으면 null이다.
export function appStatusOf(
  sql: ReadSql,
  id: string,
): "active" | "archived" | null {
  const row = sql.get("select status from apps where id = ?", [id]);
  return row === undefined
    ? null
    : row["status"] === "archived"
      ? "archived"
      : "active";
}

// 할당한 앱(slug)의 active release bundle 사본과 그 선언의 public skill 이름이다. 보관한 앱, 없는 slug, active release가
// 없는 앱, public skill이 없는 앱은 뺀다. 동기 목록(`/` 메뉴, Agents 탭 개수)이 이것을 읽고, 본문은 `app.skills`가 준다.
export function sharedSkillFolders(
  sql: ReadSql,
  dataRoot: string,
  slugs: readonly string[],
): { app: string; slug: string; bundle: string; names: string[] }[] {
  const folders = [];
  for (const slug of [...new Set(slugs)].sort()) {
    const row = sql.get(
      "select id from apps where slug = ? and status = 'active'",
      [slug],
    );
    if (row === undefined) continue;
    const app = String(row["id"]);
    const active = loadActiveDeclaration(sql, app);
    if (!active.ok || active.value === null) continue;
    const names = publicSkillNames(active.value.declaration.skills ?? []);
    if (names.length === 0) continue;
    folders.push({
      app,
      slug,
      bundle: appBundleCopy(dataRoot, app, active.value.release.bundle_hash),
      names,
    });
  }
  return folders;
}
