// place가 file tool에 여는 폴더를 core의 두 자리에 잇는 glue다: rewind의 쓰기 폴더와 agent runtime child의 Deno
// 권한. 규칙은 agent-roles의 place-folders가 갖고, 여기는 project·앱 module의 lookups로 사실을 모아 넘긴다.
import type { Sql } from "../../../protocol/server/mod.ts";
import { ROLES } from "../../../protocol/lophn-agent/mod.ts";
import {
  type PlaceFacts,
  placeScope,
  runtimeFolders,
} from "../../agent-roles/place/place-folders.ts";
import { activeAppSourcePaths, appSourcePath } from "../../apps/lookups.ts";
import {
  activeProjectFolderPaths,
  draftBundles,
  projectFolderPaths,
} from "../../projects/lookups.ts";
import {
  createContextFolders,
  projectsRoot,
} from "../../projects/contexts/mod.ts";

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
  const place: PlaceFacts["place"] = kind === "project" || kind === "app"
    ? { kind, id }
    : null;
  const folders = createContextFolders(dataRoot);
  const facts: PlaceFacts = {
    role,
    place,
    projectFolders: place?.kind === "project"
      ? projectFolderPaths(sql, id)
      : [],
    draftFolders: place?.kind === "project"
      ? draftBundles(sql, id).map((draft) =>
        folders.draftFolder(id, draft.context, draft.bundle)
      )
      : [],
    appSource: place?.kind === "app" ? appSourcePath(sql, id) : null,
    allProjectFolders: [],
  };
  return placeScope(facts).write;
}

// agent runtime child의 Deno 권한용 폴더: 열린 project와 앱 source 전체의 합에 초안 상위를 더한 것이다.
export function runtimeFoldersOf(
  lookup: Lookup,
  dataRoot: string,
): { read: string[]; write: string[] } {
  return runtimeFolders({
    draftRoot: projectsRoot(dataRoot),
    projectFolders: activeProjectFolderPaths(lookup.sql),
    appSources: activeAppSourcePaths(lookup.sql),
  });
}
