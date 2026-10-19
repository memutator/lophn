// place가 file tool에 여는 폴더를 core의 두 자리에 잇는 glue다: rewind의 쓰기 폴더와 agent runtime child의 Deno
// 권한. 규칙은 agent-roles의 place-folders가 갖고, 여기는 project·앱 module의 lookups로 사실을 모아 넘긴다.
import { dirname } from "node:path";
import type { Sql } from "../../../protocol/server/mod.ts";
import { ROLES } from "../../../protocol/lophn-agent/mod.ts";
import {
  type PlaceFacts,
  placeScope,
  runtimeFolders,
} from "../../agent-roles/place/place-folders.ts";
import {
  artifactsFolder,
  placeDataFolder,
} from "../../agent-roles/place/data-folder.ts";
import { PROJECT_LAYER } from "../../agent-roles/place/project-layer.ts";
import {
  activeAppSourcePaths,
  appOfProject,
  appSourcePath,
} from "../../apps/lookups.ts";
import { kindsFilePath } from "../../../protocol/projects/kinds-file.ts";
import {
  activeProjectFolderPaths,
  projectFolderPaths,
  projectIds,
} from "../../projects/lookups.ts";

type Lookup = { sql: Pick<Sql, "get" | "all"> };

// 그 session의 쓰기 폴더(절대 경로)다. 모르는 role이면 없다.
export function placeFoldersOf(
  lookup: Lookup,
  dataRoot: string,
  session: string,
): string[] {
  const found = lookup.sql.get(
    "select role, place_kind, place_id from sessions where id = ?",
    [session],
  );
  const role = ROLES.find((candidate) => candidate === found?.["role"]);
  if (found === undefined || role === undefined) return [];
  const { sql } = lookup;
  const kind = found["place_kind"];
  const id = String(found["place_id"]);
  const place: PlaceFacts["place"] = kind === null
    ? null
    : { kind: "project", id };
  const app = place === null ? null : appOfProject(sql, id);
  const facts: PlaceFacts = {
    role,
    place,
    projectFolders: place === null ? [] : projectFolderPaths(sql, id),
    artifactsFolder: place === null ? null : artifactsFolder(dataRoot, id),
    kindsFile: place === null ? null : kindsFilePath(dataRoot, id),
    appSource: app === null ? null : appSourcePath(sql, app),
    skillsFolder: place === null
      ? null
      : PROJECT_LAYER.skillsFolder(dataRoot, id),
    dataFolder: place === null
      ? null
      : placeDataFolder(dataRoot, { kind: "project", id: id as never }),
    allProjectFolders: [],
  };
  // 쓰기 허용은 file tool의 resolveInPlace가 kinds 파일 하나로 좁힌다. rewind는 root를 폴더 목록과 비교하므로
  // 파일 entry는 부모 폴더로 바꿔 준다(그 폴더의 pre-image만 읽는다).
  return placeScope(facts).write.map((entry) =>
    entry === facts.kindsFile ? dirname(entry) : entry
  );
}

// agent runtime child의 Deno 권한용 폴더: 열린 project와 앱 source 전체, 모든 project의 artifacts·skill 폴더의 합에
// project마다 kinds 파일을 쓰기로 더한 것이다.
export function runtimeFoldersOf(
  lookup: Lookup,
  dataRoot: string,
): { read: string[]; write: string[] } {
  return runtimeFolders({
    kindsFiles: projectIds(lookup.sql).map((id) => kindsFilePath(dataRoot, id)),
    projectFolders: activeProjectFolderPaths(lookup.sql),
    artifactFolders: projectIds(lookup.sql).map((id) =>
      artifactsFolder(dataRoot, id)
    ),
    skillFolders: projectIds(lookup.sql).map((id) =>
      PROJECT_LAYER.skillsFolder(dataRoot, id)
    ),
    appSources: activeAppSourcePaths(lookup.sql),
  });
}
