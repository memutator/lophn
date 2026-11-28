import { appBundleCopy } from "../../protocol/apps/app-storage.ts";
import type { SkillDeployment } from "../../protocol/lophn-agent/mod.ts";
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

// 배포한 앱 skill(`{app: slug, skill}`)의 active release bundle 사본과 그 선언의 public skill 이름이다. 배포한 이름 가운데 지금 active release의
// public skill인 것만 싣고, 보관한 앱, 없는 slug, active release가 없는 앱, 사라졌거나 public이 아닌 skill은 말없이 뺀다.
// 동기 목록(`/` 메뉴, Agents 탭 개수)이 이것을 읽고, 본문은 `app.skills`가 준다.
export function sharedSkillFolders(
  sql: ReadSql,
  dataRoot: string,
  deployed: readonly SkillDeployment[],
): { app: string; slug: string; bundle: string; names: string[] }[] {
  const folders = [];
  for (const slug of [...new Set(deployed.map((one) => one.app))].sort()) {
    const row = sql.get(
      "select id from apps where slug = ? and status = 'active'",
      [slug],
    );
    if (row === undefined) continue;
    const app = String(row["id"]);
    const active = loadActiveDeclaration(sql, app);
    if (!active.ok || active.value === null) continue;
    const named = new Set(
      deployed.filter((one) => one.app === slug).map((one) => one.skill),
    );
    const names = publicSkillNames(
      active.value.declaration.skills ?? [],
    ).filter((name) => named.has(name));
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

// 앱 하나의 active 선언의 public skill 이름이다. 보관한 앱이나 active release가 없는 앱은 빈 목록이다. 배포는 이 이름만 받는다.
export function publicSkillsOf(sql: ReadSql, app: string): string[] {
  const row = sql.get(
    "select 1 as found from apps where id = ? and status = 'active'",
    [app],
  );
  if (row === undefined) return [];
  const active = loadActiveDeclaration(sql, app);
  if (!active.ok || active.value === null) return [];
  return publicSkillNames(active.value.declaration.skills ?? []);
}

// 선언의 command 가운데 public인 것의 이름이다. 명함의 차이가 읽는다.
export function publicCommandsOf(
  slug: string,
  commands: readonly { name: string; public: boolean }[],
): { slug: string; name: string }[] {
  return commands
    .filter((command) => command.public)
    .map((command) => ({ slug, name: command.name }));
}

// 배포로 닿은 앱(slug)의 active 선언의 public command다. 보관한 앱, 없는 slug, active release가 없는 앱은 뺀다.
export function sharedCommands(
  sql: ReadSql,
  slugs: readonly string[],
): { slug: string; name: string }[] {
  const found = [];
  for (const slug of [...new Set(slugs)].sort()) {
    const row = sql.get(
      "select id from apps where slug = ? and status = 'active'",
      [slug],
    );
    if (row === undefined) continue;
    const active = loadActiveDeclaration(sql, String(row["id"]));
    if (!active.ok || active.value === null) continue;
    found.push(
      ...publicCommandsOf(slug, active.value.declaration.commands ?? []),
    );
  }
  return found;
}
