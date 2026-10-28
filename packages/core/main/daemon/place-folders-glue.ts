// place가 file tool에 여는 폴더를 rewind의 쓰기 폴더에 잇는 glue다. 규칙은 agent-places의 place-folders가 갖고,
// 여기는 project·앱·feature module의 lookups로 사실을 모아 넘긴다.
import type { Sql } from "../../../protocol/server/mod.ts";
import { domainFolder } from "../../../protocol/domains/paths.ts";
import { workflowsFolder } from "../../../protocol/workflows/paths.ts";
import {
  type PlaceFacts,
  placeScope,
} from "../../agent-places/place/place-folders.ts";
import { placeDataFolder } from "../../agent-places/place/data-folder.ts";
import { appSourcePath } from "../../apps/lookups.ts";
import { domainsOfOwner } from "../../domains/lookups.ts";
import { projectFolderPaths } from "../../projects/lookups.ts";

type Lookup = { sql: Pick<Sql, "get" | "all"> };

// 그 session의 쓰기 폴더(절대 경로)다. rewind는 그릇의 domain 폴더 전부를 넉넉히 쓰고, turn 중 file tool은
// 받은 domain의 폴더로 좁힌다.
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
    domains:
      place === null
        ? []
        : domainsOfOwner(sql, { kind: place.kind, id } as never, "active").map(
            (d) => ({ id: d.id, folder: domainFolder(dataRoot, d.id) }),
          ),
    dataFolder:
      place === null
        ? null
        : placeDataFolder(dataRoot, { kind: place.kind, id } as never),
    allProjectFolders: [],
    workflowsFolder:
      place?.kind === "project" ? workflowsFolder(dataRoot, place.id) : null,
  };
  return placeScope(facts).write;
}
