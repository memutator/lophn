// 두기·빼기가 core 안에서 쓰는 ledger 읽기(내부 read). 문서·프로젝트·최신 판의 파일 목록·그
// 경로에 연결된 문서·쓸 수 있는 문서 이름을 한 snapshot에서 읽는다. 요청 자격으로 문서 접근을
// 판정하고, 범위 밖·없는 문서는 같은 null이다(존재를 새지 않는다). 디스크는 읽지 않는다.
import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  ContentFile,
  Document,
  PlaceRef,
  Project,
  Slug,
} from "../../../protocol/projects/mod.ts";
import type {
  ReadSnapshot,
  RequestContext,
  Sql,
} from "../../../protocol/server/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import {
  createDocumentNameReservation,
  SLUG_MAX_LENGTH,
  slugSchema,
  suggestName,
} from "../addressing/mod.ts";
import { loadProject } from "../registry/mod.ts";
import {
  authorizeDocument,
  loadDocument,
  loadFiles,
  loadLatestVersion,
} from "../versions/mod.ts";

export type PlacementReadInput = {
  document: string;
  // 사람이 부른 route 이름. 문서 접근은 그 route의 operation 범위로 판정한다.
  operation: string;
  project?: string;
  // 이 경로에 이미 연결된 문서와 새 문서 이름의 재료가 되는 파일 경로.
  path?: string;
  // 그 프로젝트 자리에서 쓸 수 있는 문서 이름을 함께 구한다.
  suggest_name?: boolean;
};

export type PlacementRead = {
  document: Document | null;
  project: Project | null;
  latest: { version: string; files: ContentFile[] } | null;
  linked: string | null;
  name: Slug | null;
};

const NAME_ATTEMPTS = 1000;
const EMPTY: PlacementRead = {
  document: null,
  project: null,
  latest: null,
  linked: null,
  name: null,
};

// 같은 자리의 문서 이름은 유일하고 옛 예약도 다른 대상이 쓰지 못한다.
// 제목(없으면 파일 이름)에서 정하고 쓰였으면 `-2`부터 붙인다. 정하지 못하면 null이다.
function freeName(
  sql: Sql,
  place: PlaceRef,
  title: string,
  path: string | undefined,
): Result<Slug | null> {
  const base = suggestName(title, path?.slice(path.lastIndexOf("/") + 1));
  const reservations = createDocumentNameReservation({ sql });
  for (let n = 1; n <= NAME_ATTEMPTS; n++) {
    const suffix = n === 1 ? "" : `-${n}`;
    const stem = base.slice(0, SLUG_MAX_LENGTH - suffix.length)
      .replace(/-+$/g, "");
    const name = slugSchema.parse(`${stem}${suffix}`);
    const reserved = reservations.get(place, name);
    if (!reserved.ok) return reserved;
    if (reserved.value !== null) continue;
    const used = sql.get(
      "SELECT id FROM documents WHERE place_kind = ? AND place_id = ? AND name = ?",
      [place.kind, place.id, name],
    );
    if (used === undefined) return ok(name);
  }
  return ok(null);
}

export function placementRead(
  snapshot: ReadSnapshot,
  ctx: RequestContext,
  input: PlacementReadInput,
): Result<PlacementRead> {
  if (parseActor(ctx.actor)?.kind !== "user") {
    return err({ code: "forbidden", message: "file access is user only" });
  }
  const sql = snapshot.sql as unknown as Sql;
  const document = loadDocument(sql, input.document);
  if (!document.ok) return document;
  if (document.value === null) return ok(EMPTY);
  const access = authorizeDocument(snapshot.port, ctx, input.operation, {
    kind: "document",
    document: document.value,
  });
  if (!access.ok) {
    return access.error.code === "unavailable" ? access : ok(EMPTY);
  }
  let project: Project | null = null;
  if (input.project !== undefined) {
    const loaded = loadProject(sql, input.project);
    if (!loaded.ok) return loaded;
    project = loaded.value;
  }
  const latest = loadLatestVersion(sql, input.document);
  if (!latest.ok) return latest;
  let files: { version: string; files: ContentFile[] } | null = null;
  if (latest.value !== null) {
    const listed = loadFiles(sql, latest.value.id);
    if (!listed.ok) return listed;
    files = { version: latest.value.id, files: listed.value };
  }
  let linked: string | null = null;
  if (input.path !== undefined) {
    const row = sql.get("SELECT id FROM documents WHERE source_path = ?", [
      input.path,
    ]);
    linked = typeof row?.id === "string" ? row.id : null;
  }
  let name: Slug | null = null;
  if (input.suggest_name === true && project !== null) {
    const chosen = freeName(
      sql,
      { kind: "project", id: project.id },
      document.value.title,
      input.path,
    );
    if (!chosen.ok) return chosen;
    name = chosen.value;
  }
  return ok({ document: document.value, project, latest: files, linked, name });
}
