// reader Worker가 올리는 문서 worker route의 handler. outline·단계적 읽기·search·
// view open·export는 ledger snapshot(문서·판 metadata, 권한)과 derived store(section·
// text·FTS)를 같이 읽는다. reader Worker의 snapshot은 요청마다 하나고 handler는
// 동기라서, core 흐름과 documents coordinator를 붙잡지 않는다.
// 이 모듈은 core가 정적으로 import하지 않는다(createReaderRegistration만 reader가 부른다).
// derived store는 node:sqlite를 쓰므로 core graph 밖에서만 열린다(core_imports_test).
import { err, ok, type Result } from "../../packages/base/mod.ts";
import {
  documentExport,
  documentRead,
  guideGet,
  guideList,
  guideOutline,
  guideRead,
  outlineContext,
  outlineDocument,
  outlinePlace,
  outlineRoot,
  searchQuery,
  searchStatus,
  viewOpen,
} from "../../packages/contracts/documents/mod.ts";
import type {
  ReadDefinition,
  ReadRoute,
  ReadSnapshot,
  RequestContext,
  WorkerRoute,
} from "../../packages/contracts/platform/mod.ts";
import type { ReaderRegistration } from "../../packages/platform/ledger/mod.ts";
import {
  derivedPath,
  type DerivedRead,
  openDerivedRead,
} from "../../packages/documents/outline-and-search/adapters/store.ts";
import {
  createOutlineHandlers,
  createSearchHandlers,
} from "../../packages/documents/outline-and-search/reads.ts";
import type {
  ContextItemSource,
  SearchSnapshot,
} from "../../packages/documents/outline-and-search/types.ts";
import { createViewOpenHandler } from "../../packages/documents/outline-and-search/saved-views-open.ts";
import {
  listItems,
  loadContextRow,
} from "../../packages/documents/contexts/store.ts";
import { createContextOutlineSource } from "../../packages/documents/contexts/reads.ts";
import {
  createGuideHandlers,
  type GuideExtractor,
  type GuideHandlers,
} from "../../packages/documents/outline-and-search/guides.ts";
import {
  BUILTIN_MODULE_HASH,
  formatForMediaType,
} from "../../packages/documents/formats/mod.ts";
import { extractFormat } from "../../packages/documents/formats/guest.ts";
import {
  createGuideCatalog,
  type GuideFiles,
} from "../../packages/documents/versions/guides.ts";
import { exportDocument } from "../../packages/documents/versions/reads.ts";
import {
  internalRoute,
  OBSERVATION_BASIS_ROUTE,
  OBSERVATION_LINK_PAGE,
  PREPARE_BASE_ROUTE,
} from "./documents-served.ts";
import { loadProjects } from "../../packages/documents/projects/store.ts";
import { authorizeDocument } from "../../packages/documents/versions/authorization.ts";
import {
  loadDocument,
  loadLinkedDocuments,
  loadVersion,
} from "../../packages/documents/versions/store.ts";
import { createProductRedactor } from "./documents-redactor.ts";

// ledger 파일에서 data root를 찾는다. reader는 같은 파일을 연 snapshot만 갖는다.
function dataRootOf(snapshot: ReadSnapshot): Result<string> {
  const row = snapshot.sql.get(
    "SELECT file FROM pragma_database_list WHERE name = 'main'",
    [],
  );
  const file = row?.["file"];
  if (typeof file !== "string" || !file.includes("/")) {
    return err({ code: "unavailable", message: "ledger 위치를 알 수 없다" });
  }
  return ok(file.slice(0, file.lastIndexOf("/")));
}

// derived read 연결. coordinator가 유일한 writer고 이 연결은 query_only다. 파일이
// 교체되면(재생성) 새 파일을 다시 연다. 없으면 unavailable이다: 빈 결과로 꾸미지 않는다.
const connections = new Map<
  string,
  { identity: string; read: DerivedRead }
>();

function derivedRead(root: string): Result<DerivedRead> {
  const path = derivedPath(`${root}/derived`);
  let identity: string;
  try {
    const stat = Deno.statSync(path);
    identity = `${stat.dev}:${stat.ino}`;
  } catch {
    return err({
      code: "unavailable",
      message: "derived store가 아직 없다",
    });
  }
  const held = connections.get(path);
  if (held && held.identity === identity) return ok(held.read);
  const opened = openDerivedRead(path);
  if (!opened.ok) return opened;
  connections.set(path, { identity, read: opened.value });
  return opened;
}

// context filter의 근원. ledger snapshot의 contexts·context_items다.
// 없는 context는 not_found라 후보를 전부 비운다(documents/contexts, R12).
function contextItems(snapshot: ReadSnapshot): ContextItemSource {
  return {
    items(contextId) {
      const row = loadContextRow(snapshot.sql as never, contextId);
      if (!row.ok) return row;
      if (row.value === null) {
        return err({ code: "not_found", message: "context not found" });
      }
      const items = listItems(snapshot.sql as never, contextId);
      if (!items.ok) return items;
      return ok(
        items.value.flatMap((item) =>
          item.target.kind === "document"
            ? [{ kind: "document" as const, document: item.target.document }]
            : []
        ),
      );
    },
  };
}

type Prepared = {
  snapshot: ReadSnapshot;
  search: SearchSnapshot;
  read: DerivedRead;
  contexts: ContextItemSource;
};

function prepared(snapshot: ReadSnapshot): Result<Prepared> {
  const root = dataRootOf(snapshot);
  if (!root.ok) return root;
  const read = derivedRead(root.value);
  if (!read.ok) return read;
  return ok({
    snapshot,
    search: {
      as_of_seq: snapshot.as_of_seq,
      sql: snapshot.sql as unknown as SearchSnapshot["sql"],
    },
    read: read.value,
    contexts: contextItems(snapshot),
  });
}

const redactor = createProductRedactor();

// 공개 worker route의 출력에 맞춘다. 내부 read는 next_cursor를 요구하므로 없으면 null이다.
function paged(value: unknown): Result<unknown> {
  const body = value as Record<string, unknown>;
  return ok({ ...body, next_cursor: body["next_cursor"] ?? null });
}

function worker<I>(
  route: WorkerRoute,
  run: (
    prepared: Prepared,
    ctx: RequestContext,
    input: I,
  ) => Result<unknown>,
): ReadDefinition {
  return {
    route: internalRoute(route),
    handle(snapshot, ctx, input) {
      const ready = prepared(snapshot);
      if (!ready.ok) return ready;
      const ran = run(ready.value, ctx, input as I);
      if (!ran.ok) return ran;
      return paged(ran.value);
    },
  };
}

// 설치 묶음의 안내 폴더. 설치 root(LOPHN_INSTALL_ROOT, 없으면 /opt/lophn)의 `guides/`다.
// 설치 위치는 사람 데이터 root와 다르다: 안내는 읽기 전용이고 data root에 쓰지 않는다.
function guidesRoot(): string {
  let install: string | undefined;
  try {
    install = Deno.env.get("LOPHN_INSTALL_ROOT");
  } catch { /* env 권한이 없으면 기본 설치 위치다 */ }
  return `${
    install !== undefined && install.length > 0 ? install : "/opt/lophn"
  }/guides`;
}

// 설치 안내 폴더의 읽기 전용 port. 폴더 밖으로 나가는 경로(symlink 포함)는 읽지 않는다.
export function installedGuideFiles(root: string): GuideFiles {
  return {
    read(path) {
      try {
        const base = Deno.realPathSync(root);
        const file = Deno.realPathSync(`${base}/${path}`);
        if (!file.startsWith(`${base}/`)) {
          return err({ code: "not_found", message: "guide file not found" });
        }
        return ok(Deno.readFileSync(file));
      } catch {
        return err({
          code: "unavailable",
          message: "설치 안내 파일을 읽을 수 없다",
        });
      }
    },
  };
}

// 설치 안내의 section 추출. runner 없이 format 정본의 같은 추출을 직접 부른다:
// 안내는 신뢰한 설치 bytes고 내장 document format module만 쓴다.
const extractGuide: GuideExtractor = (file, contentHash) => {
  const name = formatForMediaType(file.media_type);
  const format = { name, module_hash: BUILTIN_MODULE_HASH, explicit: false };
  const result = extractFormat(name, {
    input_hash: contentHash,
    module_hash: BUILTIN_MODULE_HASH,
    files: [{
      path: file.path,
      media_type: file.media_type,
      primary: true,
      content: Array.from(file.bytes),
    }],
  });
  if (result.status === "ready") {
    return {
      format,
      extraction: {
        status: "ready",
        text: result.text,
        text_hash: result.text_hash,
        sections: result.sections,
      },
    };
  }
  return {
    format,
    extraction: result.status === "failed"
      ? { status: "failed", failure_reason: result.failure_reason }
      : { status: "unsupported" },
  };
};

// 안내 읽기는 ledger 표도 derived store도 읽지 않는다: 설치 manifest와 파일만이다.
// derived가 아직 없어도 offline으로 읽힌다.
function guide<I>(
  route: WorkerRoute,
  run: (
    handlers: GuideHandlers,
    ctx: RequestContext,
    input: I,
  ) => Result<unknown>,
): ReadDefinition {
  return {
    route: internalRoute(route),
    handle(snapshot, ctx, input) {
      const ran = run(
        createGuideHandlers({
          catalog: createGuideCatalog(installedGuideFiles(guidesRoot())),
          extract: extractGuide,
          asOfSeq: snapshot.as_of_seq,
          redactor,
        }),
        ctx,
        input as I,
      );
      if (!ran.ok) return ran;
      return paged(ran.value);
    },
  };
}

function outline(ready: Prepared) {
  return createOutlineHandlers({
    read: ready.read,
    snapshot: ready.search,
    ports: ready.snapshot,
    contexts: ready.contexts,
    contextOutline: createContextOutlineSource(ready.snapshot.sql as never),
    redactor,
  });
}

export function createReaderRegistration(): ReaderRegistration {
  const root: ReadDefinition<ReadRoute> = {
    route: outlineRoot,
    handle(snapshot, ctx, input) {
      const ready = prepared(snapshot);
      if (!ready.ok) return ready;
      return outline(ready.value).root(ctx, input as never) as Result<never>;
    },
  };
  return {
    reads: [
      root,
      worker(
        outlinePlace,
        (ready, ctx, input) => outline(ready).place(ctx, input as never),
      ),
      worker(
        outlineContext,
        (ready, ctx, input) => outline(ready).context(ctx, input as never),
      ),
      worker(
        outlineDocument,
        (ready, ctx, input) => outline(ready).document(ctx, input as never),
      ),
      worker(
        documentRead,
        (ready, ctx, input) => outline(ready).read(ctx, input as never),
      ),
      worker(searchQuery, (ready, ctx, input) =>
        createSearchHandlers({
          read: ready.read,
          snapshot: ready.search,
          ports: ready.snapshot,
          contexts: ready.contexts,
        }).query(ctx, input as never)),
      worker(searchStatus, (ready, ctx, input) =>
        createSearchHandlers({
          read: ready.read,
          snapshot: ready.search,
          ports: ready.snapshot,
          contexts: ready.contexts,
        }).status(ctx, input as never)),
      worker(viewOpen, (ready, ctx, input) =>
        createViewOpenHandler({
          read: ready.read,
          snapshot: ready.search,
          ports: ready.snapshot,
          contexts: ready.contexts,
          nowMs: () => Date.now(),
        }).open(ctx, input as never)),
      guide(
        guideList,
        (handlers, ctx, input) => handlers.list(ctx, input as never),
      ),
      guide(
        guideGet,
        (handlers, ctx, input) => handlers.get(ctx, input as never),
      ),
      guide(
        guideOutline,
        (handlers, ctx, input) => handlers.outline(ctx, input as never),
      ),
      guide(
        guideRead,
        (handlers, ctx, input) => handlers.read(ctx, input as never),
      ),
      // 준비 route의 기준 판. derived를 읽지 않고 ledger snapshot만 쓴다.
      {
        route: PREPARE_BASE_ROUTE,
        handle(snapshot, ctx, input) {
          const { document, version } = input as {
            document: string;
            version: string;
          };
          const loaded = loadDocument(snapshot.sql as never, document);
          if (!loaded.ok) return loaded;
          if (loaded.value === null) {
            return ok({ version: null, next_cursor: null });
          }
          const access = authorizeDocument(
            snapshot.port,
            ctx,
            PREPARE_BASE_ROUTE.name,
            { kind: "document", document: loaded.value },
          );
          // 권한 밖은 없는 문서와 같다. 판정을 못한 경우(unavailable)만 그대로 낸다.
          if (!access.ok) {
            return access.error.code === "unavailable"
              ? access
              : ok({ version: null, next_cursor: null });
          }
          const row = loadVersion(snapshot.sql as never, version);
          if (!row.ok) return row;
          return ok({
            version: row.value !== null && row.value.document === document
              ? row.value
              : null,
            next_cursor: null,
          });
        },
      },
      // coordinator가 파일을 관측할 근거(Q15). core만 부르는 내부 read다. 활성이고 tracking이
      // 켜진 project의 root·규칙(roots)과 그 project 파일에 연결된 문서(links, 경로 page)다.
      {
        route: OBSERVATION_BASIS_ROUTE,
        handle(snapshot, _ctx, input) {
          const { part, after } = input as {
            part: "roots" | "links";
            after?: string;
          };
          const projects = loadProjects(snapshot.sql);
          if (!projects.ok) return projects;
          const tracked = projects.value.filter((project) =>
            project.status === "active" && project.tracking.enabled
          );
          if (part === "roots") {
            return ok({
              roots: tracked.flatMap((project) =>
                project.folders.map((folder) => ({
                  root: folder.path,
                  project: project.id,
                  project_revision: project.revision,
                  patterns: project.tracking.patterns,
                  use_gitignore: project.tracking.use_gitignore,
                }))
              ),
              next_cursor: null,
            });
          }
          const ids = new Set(tracked.map((project) => project.id));
          const page = loadLinkedDocuments(snapshot.sql, {
            ...(after === undefined ? {} : { after }),
            limit: OBSERVATION_LINK_PAGE,
          });
          if (!page.ok) return page;
          const links = page.value.flatMap((linked) => {
            const source = linked.document.file_source;
            if (source === null || source.kind !== "project_file") return [];
            if (!ids.has(source.project)) return [];
            return [{
              project: source.project,
              path: source.path,
              document: linked.document.id,
              document_revision: linked.document.revision,
              status: linked.document.status,
              latest_version: linked.document.latest_version,
              latest_hash: linked.latestOriginalHash,
              title: linked.document.title,
            }];
          });
          const last = page.value.at(-1)?.document.file_source;
          return ok({
            links,
            next_cursor: page.value.length === OBSERVATION_LINK_PAGE &&
                last !== null && last !== undefined
              ? last.path
              : null,
          });
        },
      },
      // export는 derived를 읽지 않는다. ledger snapshot과 redactor만 쓴다.
      {
        route: internalRoute(documentExport),
        handle(snapshot, ctx, input) {
          const exported = exportDocument(snapshot, ctx, input as never, {
            redactor,
          });
          if (!exported.ok) return exported;
          return paged(exported.value);
        },
      },
    ],
    ports: new Map(),
  };
}
