// place가 file tool에 여는 폴더를 rewind의 쓰기 폴더에 잇는 glue다. 규칙은 agent-places의 place-folders가 갖고,
// 여기는 project·앱·feature module의 lookups로 사실을 모아 넘긴다.
import type { Sql } from "../../../protocol/server/mod.ts";
import { artifactsFolder } from "../../../protocol/projects/mod.ts";
import { workflowsFolder } from "../../../protocol/workflows/paths.ts";
import {
  type PlaceFacts,
  placeScope,
} from "../../agent-places/place/place-folders.ts";
import {
  placeDataFolder,
  placeDataSkillsFolder,
} from "../../agent-places/place/data-folder.ts";
import { appFolderPaths, appSourcePath } from "../../apps/lookups.ts";
import { projectFolderPaths } from "../../projects/lookups.ts";

type Lookup = { sql: Pick<Sql, "get" | "all"> };

// 그 session의 쓰기 폴더(절대 경로)다.
export function placeFoldersOf(
  lookup: Lookup,
  dataRoot: string,
  session: string,
): string[] {
  const found = lookup.sql.get(
    "select place_kind, place_id from sessions where id = ?",
    [session],
  );
  if (found === undefined) return [];
  const { sql } = lookup;
  const kind = found["place_kind"];
  const id = String(found["place_id"]);
  const place: PlaceFacts["place"] =
    kind === "project" || kind === "app" ? { kind, id } : null;
  const facts: PlaceFacts = {
    place,
    projectFolders:
      place?.kind === "project" ? projectFolderPaths(sql, place.id) : [],
    appSource: place?.kind === "app" ? appSourcePath(sql, place.id) : null,
    appFolders: place?.kind === "app" ? appFolderPaths(sql, place.id) : [],
    dataFolder:
      place === null
        ? null
        : placeDataFolder(dataRoot, { kind: place.kind, id } as never),
    allProjectFolders: [],
    workflowsFolder:
      place?.kind === "project" ? workflowsFolder(dataRoot, place.id) : null,
    skillsFolder:
      place === null ? null : placeDataSkillsFolder(dataRoot, place),
    artifactsFolder: place === null ? null : artifactsFolder(dataRoot, place),
  };
  return placeScope(facts).write;
}
