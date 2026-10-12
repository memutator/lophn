// 사람 파일 통로의 ledger read. `files.list`는 사람이 편집할 수 있는 목표(원본에 연결된
// project 파일과 원본 없는 문서의 working copy)를 ledger에서 계산하고, working copy 근거는
// core가 쓰기·읽기 전에 요청 자격으로 확인한다. 디스크는 읽지 않는다.
import { err, ok, type Result } from "../../../base/mod.ts";
import { filesList, type FileTarget } from "../../../protocol/projects/mod.ts";
import {
  parseActor,
  type ReadDefinition,
  type ReadSnapshot,
  type RequestContext,
  type Sql,
} from "../../../protocol/platform/mod.ts";
import {
  authorizeDocument,
  loadDocument,
  loadFiles,
  loadLatestVersion,
  loadLinkedDocuments,
  loadSourcelessDocuments,
  loadVersion,
} from "../versions/mod.ts";

const PAGE = 200;
const LOAD_PAGE = 500;

function userOnly(ctx: RequestContext): Result<void> {
  return parseActor(ctx.actor)?.kind === "user"
    ? ok(undefined)
    : err({ code: "forbidden", message: "file access is user only" });
}

type Listed = { key: string; target: FileTarget };

// 목표의 정렬 key. project 파일은 경로 순서, 사본은 문서 id 순서이며 파일이 먼저다.
function listAll(
  snapshot: ReadSnapshot,
  ctx: RequestContext,
  project: string | undefined,
): Result<Listed[]> {
  const sql = snapshot.sql as unknown as Sql;
  const listed: Listed[] = [];
  const projects = new Set(
    sql.all("SELECT id FROM projects WHERE status = 'active'", []).map((row) =>
      String(row.id)
    ),
  );
  if (project !== undefined && !projects.has(project)) return ok([]);
  let after: string | undefined;
  while (true) {
    const page = loadLinkedDocuments(sql, { after, limit: LOAD_PAGE });
    if (!page.ok) return page;
    for (const linked of page.value) {
      const source = linked.document.file_source;
      if (source?.kind === "project_file") {
        if (
          linked.document.status === "active" && projects.has(source.project) &&
          (project === undefined || source.project === project)
        ) {
          listed.push({
            key: `0:${source.path}`,
            target: {
              kind: "project_file",
              project: source.project,
              path: source.path,
            },
          });
        }
        after = source.path;
      }
    }
    if (page.value.length < LOAD_PAGE) break;
  }
  // project를 정하지 않으면 원본 없는 문서의 사본도 함께 보인다.
  if (project === undefined) {
    let cursor: string | undefined;
    while (true) {
      const page = loadSourcelessDocuments(sql, {
        after: cursor,
        limit: LOAD_PAGE,
      });
      if (!page.ok) return page;
      for (const document of page.value) {
        if (document.status !== "active") continue;
        const access = authorizeDocument(
          snapshot.port,
          ctx,
          filesList.name,
          { kind: "document", document },
        );
        if (!access.ok) {
          if (access.error.code === "unavailable") return access;
          continue;
        }
        listed.push({
          key: `1:${document.id}`,
          target: { kind: "working_copy", document: document.id },
        });
      }
      if (page.value.length < LOAD_PAGE) break;
      cursor = page.value[page.value.length - 1]!.id;
    }
  }
  listed.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  return ok(listed);
}

export function createFileReads(): {
  list: ReadDefinition<typeof filesList>;
} {
  return {
    list: {
      route: filesList,
      handle(snapshot, ctx, input) {
        const allowed = userOnly(ctx);
        if (!allowed.ok) return allowed;
        const all = listAll(snapshot, ctx, input.project);
        if (!all.ok) return all;
        // cursor는 마지막으로 돌려준 key다. 목록이 바뀌어도 그 다음부터 이어 읽는다.
        const rest = input.cursor === undefined
          ? all.value
          : all.value.filter((item) => item.key > input.cursor!);
        const page = rest.slice(0, PAGE);
        return ok({
          targets: page.map((item) => item.target),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: rest.length > PAGE ? page[page.length - 1]!.key : null,
        });
      },
    },
  };
}

// core가 working copy를 읽거나 쓰기 전에 확인하는 근거(내부 read). 원본 없는 활성 문서만
// 사본을 가진다. 범위 밖·없는 문서는 같은 `eligible: false`다. base는 요청한 판(없으면
// 최신 판)의 대표 파일이다.
export type WorkingCopyCheck = {
  eligible: boolean;
  latest_version: string | null;
  base: {
    version: string;
    primary_path: string;
    media_type: string;
    confirmed_hash: string;
  } | null;
};

const NOT_ELIGIBLE: WorkingCopyCheck = {
  eligible: false,
  latest_version: null,
  base: null,
};

export function workingCopyCheck(
  snapshot: ReadSnapshot,
  ctx: RequestContext,
  operation: string,
  input: { document: string; base_version: string | null },
): Result<WorkingCopyCheck> {
  const allowed = userOnly(ctx);
  if (!allowed.ok) return allowed;
  const sql = snapshot.sql as unknown as Sql;
  const document = loadDocument(sql, input.document);
  if (!document.ok) return document;
  if (
    document.value === null || document.value.status !== "active" ||
    document.value.file_source !== null
  ) return ok(NOT_ELIGIBLE);
  const access = authorizeDocument(snapshot.port, ctx, operation, {
    kind: "document",
    document: document.value,
  });
  if (!access.ok) {
    return access.error.code === "unavailable" ? access : ok(NOT_ELIGIBLE);
  }
  const latest = loadLatestVersion(sql, input.document);
  if (!latest.ok) return latest;
  let base = latest.value;
  if (input.base_version !== null) {
    const found = loadVersion(sql, input.base_version);
    if (!found.ok) return found;
    base = found.value !== null && found.value.document === input.document
      ? found.value
      : null;
  }
  if (base === null || latest.value === null) return ok(NOT_ELIGIBLE);
  const files = loadFiles(sql, base.id);
  if (!files.ok) return files;
  const primary = files.value.find((file) => file.primary);
  if (primary === undefined) return ok(NOT_ELIGIBLE);
  return ok({
    eligible: true,
    latest_version: latest.value.id,
    base: {
      version: base.id,
      primary_path: primary.path,
      media_type: primary.media_type,
      confirmed_hash: primary.blob_hash,
    },
  });
}
