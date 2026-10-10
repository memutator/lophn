// reader Worker가 올리는 문서 worker route의 handler. outline·단계적 읽기·search·
// view open·export는 ledger snapshot(문서·판 metadata, 권한)과 derived store(section·
// text·FTS)를 같이 읽는다. reader Worker의 snapshot은 요청마다 하나고 handler는
// 동기라서, core 흐름과 documents coordinator를 붙잡지 않는다.
// 이 모듈은 core가 정적으로 import하지 않는다(createReaderRegistration만 reader가 부른다).
// derived store는 node:sqlite를 쓰므로 core graph 밖에서만 열린다(core_imports_test).
import { createHash } from "node:crypto";
import { err, ok, type Result } from "../../packages/base/mod.ts";
import {
  contextExport,
  contextWatch,
  documentDiff,
  documentExport,
  documentRead,
  documentSectionHistory,
  FORMAT_CHECK_CONTENT_MAX_BYTES,
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
import {
  KNOWN_SECRETS,
  type ReaderRegistration,
} from "../../packages/platform/ledger/mod.ts";
import {
  derivedPath,
  type DerivedRead,
  openDerivedRead,
  openTransientDerived,
} from "../../packages/documents/outline-and-search/adapters/store.ts";
import {
  type ExtractionRecord,
  writeExtraction,
} from "../../packages/documents/outline-and-search/extraction.ts";
import {
  createOutlineHandlers,
  createSearchHandlers,
} from "../../packages/documents/outline-and-search/reads.ts";
import type { TermEvidence } from "../../packages/contracts/documents/mod.ts";
import type {
  ContextItemSource,
  SearchSnapshot,
} from "../../packages/documents/outline-and-search/types.ts";
import { createHistoryHandlers } from "../../packages/documents/outline-and-search/history-reads.ts";
import { createViewOpenHandler } from "../../packages/documents/outline-and-search/saved-views-open.ts";
import {
  listItems,
  loadContextRow,
} from "../../packages/documents/contexts/store.ts";
import {
  loadConfigEvents,
  pendingWatches,
} from "../../packages/documents/contexts/work.ts";
import {
  createContextOutlineSource,
  createContextReads,
} from "../../packages/documents/contexts/reads.ts";
import { sectionStatusOf } from "../../packages/documents/outline-and-search/context-outline.ts";
import { listWatchUnverified } from "../../packages/documents/outline-and-search/watch.ts";
import { createTermGlossarySource } from "../../packages/documents/terms/mod.ts";
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
import {
  exportDocument,
  storedFile,
} from "../../packages/documents/versions/reads.ts";
import {
  DIRECT_ANSWER_ROUTE,
  DIRECT_PLAN_ROUTE,
  FILE_PLACEMENT_ROUTE,
  internalRoute,
  OBSERVATION_BASIS_ROUTE,
  OBSERVATION_LINK_PAGE,
  PREPARE_BASE_ROUTE,
  SEARCH_VERSION_ROUTE,
  servedKey,
  STORED_FILE_ROUTE,
  TERM_OCCURRENCE_ROUTE,
  WATCH_INPUT_ROUTE,
  WORKING_COPY_ROUTE,
} from "./documents-served.ts";
import { workingCopyCheck } from "../../packages/documents/file-tracking/reads.ts";
import {
  placementRead,
  type PlacementReadInput,
} from "../../packages/documents/file-tracking/placement-read.ts";
import { loadProjects } from "../../packages/documents/projects/store.ts";
import { authorizeDocument } from "../../packages/documents/versions/authorization.ts";
import {
  loadDocument,
  loadFiles,
  loadInstructionDocuments,
  loadLinkedDocuments,
  loadVersion,
} from "../../packages/documents/versions/store.ts";
import { instructionRegistrations } from "../../packages/documents/file-tracking/instruction.ts";
import { loadTerm } from "../../packages/documents/terms/store.ts";
import {
  checkTermOccurrence,
  createDerivedEvidenceSource,
} from "../../packages/documents/terms/mod.ts";
import {
  termProposeInputSchema,
  termUpdateInputSchema,
} from "../../packages/contracts/documents/mod.ts";
import {
  createProductRedactor,
  type DocumentRedactor,
} from "./documents-redactor.ts";

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

// 이 요청의 redactor. 알려진 secret 값은 reader Worker의 registry가 쥐고 있고 handler는
// 일치 검사만 받는다. port가 없으면(reader Worker가 아닌 곳) 던져서 fail-closed다.
function redactorFor(snapshot: ReadSnapshot): DocumentRedactor {
  return createProductRedactor(snapshot.port(KNOWN_SECRETS));
}

type Prepared = {
  snapshot: ReadSnapshot;
  redactor: DocumentRedactor;
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
    redactor: redactorFor(snapshot),
  });
}

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
          redactor: redactorFor(snapshot),
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
    termGlossary: createTermGlossarySource(ready.snapshot.sql as never),
    redactor: ready.redactor,
  });
}

// section 이력·diff. 같은 ledger snapshot과 derived store를 읽고 계산은 reader Worker에서 한다.
function history(ready: Prepared) {
  return createHistoryHandlers({
    read: ready.read,
    snapshot: ready.search,
    ports: ready.snapshot,
    redactor: ready.redactor,
  });
}

// context export. 공개 read route(`/v1/contexts/export`)를 reader Worker가 서빙한다.
// 외부 출력이라 제품 redactor를 붙이고(없으면 내보내지 않는다), glossary는 같은 ledger
// snapshot의 terms에서, section 상태는 derived store에서 읽는다. derived가 아직 없으면
// section 항목은 unverified다(전체 문서 항목은 derived를 읽지 않는다).
function contextExportRead(): ReadDefinition {
  return {
    route: contextExport,
    handle(snapshot, ctx, input) {
      const root = dataRootOf(snapshot);
      const derived = root.ok ? derivedRead(root.value) : root;
      const glossary = createTermGlossarySource(snapshot.sql as never);
      const reads = createContextReads({
        redactor: redactorFor(snapshot),
        glossary(contextId) {
          const loaded = glossary.get(contextId, Number.MAX_SAFE_INTEGER);
          return loaded.ok ? ok(loaded.value.definitions) : loaded;
        },
        ...(derived.ok
          ? {
            sectionStatus: (
              document: string,
              version: string,
              section: string,
            ) =>
              sectionStatusOf(
                { read: derived.value },
                document,
                version,
                section,
              ),
          }
          : {}),
      });
      return reads.export.handle(snapshot, ctx, input as never);
    },
  };
}

// context watch 결과(`/v1/contexts/watch`). 확인된 변화는 ledger snapshot에서, 미확인은 derived
// store의 `watch_unverified`에서 읽는다. derived가 아직 없으면 미확인을 읽지 못한 것이라
// unavailable이다(빈 미확인으로 꾸미지 않는다).
function contextWatchRead(): ReadDefinition {
  return {
    route: contextWatch,
    handle(snapshot, ctx, input) {
      const root = dataRootOf(snapshot);
      const derived = root.ok ? derivedRead(root.value) : root;
      const reads = createContextReads(
        derived.ok
          ? {
            unverified: (contextId) =>
              ok(
                listWatchUnverified(derived.value).filter((row) =>
                  row.context === contextId
                ),
              ),
          }
          : {},
      );
      return reads.watch.handle(snapshot, ctx, input as never);
    },
  };
}

const UNREADABLE_EVIDENCE = {
  code: "invalid_input" as const,
  message: "evidence cannot be read in the fixed version",
};

// 후보·근거 변경 command 앞의 출현 확인. 입력이 command 계약에 맞지 않으면 여기서 판단하지
// 않고 command가 자기 오류로 거절하게 둔다. 근거를 바꾸지 않는 update도 지나간다.
function termOccurrence(
  snapshot: ReadSnapshot,
  ctx: RequestContext,
  command: "term.propose" | "term.update",
  body: unknown,
): Result<unknown> {
  let name: string | undefined;
  let evidence: readonly TermEvidence[] | undefined;
  if (command === "term.propose") {
    const parsed = termProposeInputSchema.safeParse(body);
    if (!parsed.success) return ok({ checked: false, next_cursor: null });
    name = parsed.data.name;
    evidence = parsed.data.evidence;
  } else {
    const parsed = termUpdateInputSchema.safeParse(body);
    if (!parsed.success || parsed.data.evidence === undefined) {
      return ok({ checked: false, next_cursor: null });
    }
    evidence = parsed.data.evidence;
    name = parsed.data.name;
    if (name === undefined) {
      const term = loadTerm(snapshot.sql as never, parsed.data.term);
      if (!term.ok) return term;
      // 없는 용어는 command가 자기 오류로 거절한다.
      if (term.value === null) return ok({ checked: false, next_cursor: null });
      name = term.value.name;
    }
  }
  for (const item of evidence) {
    const version = loadVersion(snapshot.sql as never, item.version);
    if (!version.ok) return version;
    if (version.value === null || version.value.document !== item.document) {
      return err(UNREADABLE_EVIDENCE);
    }
    const document = loadDocument(snapshot.sql as never, item.document);
    if (!document.ok) return document;
    if (document.value === null) return err(UNREADABLE_EVIDENCE);
    const access = authorizeDocument(snapshot.port, ctx, command, {
      kind: "document",
      document: document.value,
    });
    if (!access.ok) {
      return access.error.code === "unavailable"
        ? access
        : err(UNREADABLE_EVIDENCE);
    }
  }
  const root = dataRootOf(snapshot);
  if (!root.ok) return root;
  const read = derivedRead(root.value);
  if (!read.ok) return read;
  const checked = checkTermOccurrence(
    createDerivedEvidenceSource(read.value.sql),
    name,
    evidence,
  );
  if (!checked.ok) return checked;
  return ok({ checked: true, next_cursor: null });
}

// 읽기 handler 하나를 돌리는 함수. 공개 worker route와 직접 추출이 같은 함수를 쓴다.
type WorkerRun = (
  prepared: Prepared,
  ctx: RequestContext,
  input: unknown,
) => Result<unknown>;

const runOutlineDocument: WorkerRun = (ready, ctx, input) =>
  outline(ready).document(ctx, input as never);
const runDocumentRead: WorkerRun = (ready, ctx, input) =>
  outline(ready).read(ctx, input as never);

const DIRECT_RUNS = new Map<string, WorkerRun>([
  [servedKey(outlineDocument), runOutlineDocument],
  [servedKey(documentRead), runDocumentRead],
]);

type DirectTarget = {
  document: string;
  version: string;
  content_hash: string;
  file: { path: string; blob_hash: string; bytes: number; media_type: string };
};

// documents/outline-and-search#R15의 대상. 요청 자격으로 같은 읽기를 다시 돌려 권한을 판정하고
// (거절·없음은 그 오류 그대로다), 그 판이 추출 안 됨(derived에 행이 없거나 미확인)이며, 내장
// document module로 읽을 수 있는 한도 안의 대표 파일을 가질 때만 대상이다. 이미 실패·미지원으로 기록된 판과 다른 module로 저장된 판은
// 대상이 아니다(최신 module로 대신하지 않는다).
function directTarget(
  snapshot: ReadSnapshot,
  ready: Prepared,
  ctx: RequestContext,
  route: string,
  request: unknown,
): Result<DirectTarget | null> {
  const run = DIRECT_RUNS.get(route);
  if (run === undefined) {
    return err({ code: "invalid_input", message: "route cannot extract" });
  }
  const first = run(ready, ctx, request);
  if (!first.ok) return first;
  const answer = first.value as Record<string, unknown>;
  const document = answer["document"];
  const version = answer["version"];
  if (typeof document !== "string" || typeof version !== "string") {
    return ok(null);
  }
  const recorded = ready.read.sql.get(
    "SELECT extraction_status FROM derived_versions WHERE version = ?",
    [version],
  );
  if (
    recorded !== undefined && recorded["extraction_status"] !== "unverified"
  ) {
    return ok(null);
  }
  const row = loadVersion(snapshot.sql as never, version);
  if (!row.ok) return row;
  if (
    row.value === null || row.value.document !== document ||
    row.value.format.name !== "document" ||
    row.value.format.module_hash !== BUILTIN_MODULE_HASH
  ) return ok(null);
  const files = loadFiles(snapshot.sql as never, version);
  if (!files.ok) return files;
  const primary = files.value.find((file) => file.primary);
  if (primary === undefined || primary.bytes > FORMAT_CHECK_CONTENT_MAX_BYTES) {
    return ok(null);
  }
  return ok({
    document,
    version,
    content_hash: row.value.content_hash,
    file: {
      path: primary.path,
      blob_hash: primary.blob_hash,
      bytes: primary.bytes,
      media_type: primary.media_type,
    },
  });
}

// 대표 파일 바이트를 내장 document module로 추출한다(순수 계산).
function extractDirect(
  target: DirectTarget,
  content: Uint8Array,
): ExtractionRecord["extraction"] {
  const result = extractFormat("document", {
    input_hash: target.file.blob_hash,
    module_hash: BUILTIN_MODULE_HASH,
    files: [{
      path: target.file.path,
      media_type: target.file.media_type,
      primary: true,
      content: Array.from(content),
    }],
  });
  if (result.status === "ready") {
    return {
      status: "ready",
      title: result.title,
      text: result.text,
      text_hash: result.text_hash,
      sections: result.sections,
    };
  }
  return result.status === "failed"
    ? { status: "failed", failure_reason: result.failure_reason }
    : { status: "unsupported" };
}

// 직접 추출의 두 route. 계획은 읽을 파일을 알리고, 답은 core가 읽어 온 그 파일의 바이트로 이번
// 응답에만 추출해 같은 읽기 handler로 답한다. derived에는 쓰지 않는다(메모리 derived가
// 요청과 함께 닫힌다). 바이트가 판의 행(크기·hash)과 다르면 답하지 않는다.
function directReads(): ReadDefinition[] {
  return [
    {
      route: DIRECT_PLAN_ROUTE,
      handle(snapshot, ctx, input) {
        const { route, request } = input as { route: string; request: unknown };
        const ready = prepared(snapshot);
        if (!ready.ok) return ready;
        const target = directTarget(snapshot, ready.value, ctx, route, request);
        if (!target.ok) return target;
        return ok({
          file: target.value === null ? null : {
            path: target.value.file.path,
            blob_hash: target.value.file.blob_hash,
            bytes: target.value.file.bytes,
          },
          next_cursor: null,
        });
      },
    },
    {
      route: DIRECT_ANSWER_ROUTE,
      handle(snapshot, ctx, input) {
        const { route, request, path, content } = input as {
          route: string;
          request: unknown;
          path: string;
          content: Uint8Array;
        };
        const ready = prepared(snapshot);
        if (!ready.ok) return ready;
        const target = directTarget(snapshot, ready.value, ctx, route, request);
        if (!target.ok) return target;
        if (target.value === null) {
          return err({ code: "unavailable", message: "nothing to extract" });
        }
        const file = target.value.file;
        if (
          file.path !== path || content.length !== file.bytes ||
          createHash("sha256").update(content).digest("hex") !== file.blob_hash
        ) {
          return err({
            code: "unavailable",
            message: "file bytes do not match the version",
          });
        }
        const transient = openTransientDerived();
        if (!transient.ok) return transient;
        try {
          transient.value.write((tx) =>
            writeExtraction(tx, {
              document: target.value!.document,
              version: target.value!.version,
              content_hash: target.value!.content_hash,
              module_hash: BUILTIN_MODULE_HASH,
              extraction: extractDirect(target.value!, content),
            }, snapshot.as_of_seq)
          );
          const run = DIRECT_RUNS.get(route)!;
          const answered = run(
            { ...ready.value, read: transient.value.read },
            ctx,
            request,
          );
          return answered.ok ? paged(answered.value) : answered;
        } finally {
          transient.value.close();
        }
      },
    },
  ];
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
      contextExportRead(),
      contextWatchRead(),
      worker(
        outlinePlace,
        (ready, ctx, input) => outline(ready).place(ctx, input as never),
      ),
      worker(
        outlineContext,
        (ready, ctx, input) => outline(ready).context(ctx, input as never),
      ),
      worker(outlineDocument, runOutlineDocument),
      worker(documentRead, runDocumentRead),
      ...directReads(),
      worker(
        documentSectionHistory,
        (ready, ctx, input) =>
          history(ready).sectionHistory(ctx, input as never),
      ),
      worker(
        documentDiff,
        (ready, ctx, input) => history(ready).diff(ctx, input as never),
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
      // 고정 판의 경로별 파일 판정(`documents/file`). derived를 읽지 않고 ledger snapshot만 쓴다.
      {
        route: STORED_FILE_ROUTE,
        handle(snapshot, ctx, input) {
          const stored = storedFile(snapshot, ctx, input as never);
          return stored.ok ? paged(stored.value) : stored;
        },
      },
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
      // working copy 근거. 요청 자격으로 원본 없는 활성 문서와 연 판의 대표 파일을 읽는다.
      {
        route: WORKING_COPY_ROUTE,
        handle(snapshot, ctx, input) {
          const checked = workingCopyCheck(
            snapshot,
            ctx,
            (input as { operation: string }).operation,
            input as { document: string; base_version: string | null },
          );
          return checked.ok
            ? ok({ ...checked.value, next_cursor: null })
            : checked;
        },
      },
      // 두기·빼기 근거. 요청 자격으로 문서와 프로젝트·최신 판 파일·연결된 경로·쓸 이름을 읽는다.
      {
        route: FILE_PLACEMENT_ROUTE,
        handle(snapshot, ctx, input) {
          const read = placementRead(
            snapshot,
            ctx,
            input as PlacementReadInput,
          );
          return read.ok ? ok({ ...read.value, next_cursor: null }) : read;
        },
      },
      // coordinator가 파일을 관측할 근거(Q15). core만 부르는 내부 read다. 활성이고 tracking이
      // 켜진 project의 root·규칙(roots), 활성 project의 모든 등록 폴더(folders: 파일 쓰기의
      // root 권한 집합이고 tracking을 껐어도 들어간다), 그 project 파일에 연결된 문서(links,
      // 경로 page)다. roots와 folders는 같은 snapshot의 한 응답이다.
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
            // 등록된 지침 파일(전역·project)과 그 파일에 이미 연결된 문서. 일반 tracking 규칙과 따로
            // 있고 tracking을 껐어도 들어간다(file-tracking#R19). 파일은 보지 않는다.
            const dataRoot = dataRootOf(snapshot);
            if (!dataRoot.ok) return dataRoot;
            const documents = loadInstructionDocuments(snapshot.sql);
            if (!documents.ok) return documents;
            const instructions = instructionRegistrations(
              dataRoot.value,
              projects.value,
            ).map((registration) => {
              const found = documents.value.find((linked) =>
                linked.document.file_source?.path === registration.path
              );
              return {
                ...registration,
                link: found === undefined ? null : {
                  document: found.document.id,
                  document_revision: found.document.revision,
                  status: found.document.status,
                  latest_version: found.document.latest_version,
                  latest_hash: found.latestOriginalHash,
                  title: found.document.title,
                },
              };
            });
            return ok({
              instructions,
              folders: projects.value.flatMap((project) =>
                project.status === "active"
                  ? project.folders.map((folder) => ({
                    project: project.id,
                    path: folder.path,
                  }))
                  : []
              ),
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
      // search consumer가 저장 판을 추출하려고 묻는 판 정보(판 행과 파일 목록). core만 부른다.
      {
        route: SEARCH_VERSION_ROUTE,
        handle(snapshot, _ctx, input) {
          const { version } = input as { version: string };
          const row = loadVersion(snapshot.sql as never, version);
          if (!row.ok) return row;
          if (row.value === null) {
            return ok({ version: null, next_cursor: null });
          }
          const files = loadFiles(snapshot.sql as never, version);
          if (!files.ok) return files;
          return ok({
            version: {
              document: row.value.document,
              content_hash: row.value.content_hash,
              format: row.value.format,
              files: files.value,
            },
            next_cursor: null,
          });
        },
      },
      // context watch consumer가 저장 event 하나를 확인하는 근거(documents#T24). 저장 판과 직전
      // 판의 hash, source_seq 당시 watch였고 그 뒤 바뀌지 않은 문서 항목이다. core만 부른다.
      {
        route: WATCH_INPUT_ROUTE,
        handle(snapshot, _ctx, input) {
          const request = input as {
            document: string;
            version: string;
            previous_version: string | null;
            source_seq: string;
          };
          const versionInfo = (id: string) => {
            const row = loadVersion(snapshot.sql as never, id);
            if (!row.ok) return row;
            if (row.value === null || row.value.document !== request.document) {
              return ok(null);
            }
            return ok({
              version: id,
              content_hash: row.value.content_hash,
              module_hash: row.value.format.module_hash,
            });
          };
          const after = versionInfo(request.version);
          if (!after.ok) return after;
          if (after.value === null) {
            return ok({
              before: null,
              after: null,
              targets: [],
              next_cursor: null,
            });
          }
          let before = null;
          if (request.previous_version !== null) {
            const previous = versionInfo(request.previous_version);
            if (!previous.ok) return previous;
            // 판은 지워지지 않는다. 직전 판이 없으면 비교할 수 없다.
            if (previous.value === null) {
              return err({
                code: "internal",
                message: "the previous version is missing",
              });
            }
            before = previous.value;
          }
          const events = loadConfigEvents(snapshot.sql);
          if (!events.ok) return events;
          const pending = pendingWatches(
            events.value,
            request.document,
            request.source_seq,
          );
          if (!pending.ok) return pending;
          return ok({
            before,
            next_cursor: null,
            after: after.value,
            targets: pending.value.map((watch) => ({
              context: watch.context,
              context_revision: watch.context_revision,
              section: watch.target.section,
            })),
          });
        },
      },
      // route 앞단의 용어 출현 확인(질문 Q8). 요청 자격이 읽을 수 있는 고정 판의 section 또는
      // 줄 범위만 읽는다. 권한 밖·없는 판은 읽을 수 없는 근거와 같은 거절이다(존재를 새지 않는다).
      {
        route: TERM_OCCURRENCE_ROUTE,
        handle(snapshot, ctx, input) {
          const { command, input: body } = input as {
            command: "term.propose" | "term.update";
            input: unknown;
          };
          return termOccurrence(snapshot, ctx, command, body);
        },
      },
      // export는 derived를 읽지 않는다. ledger snapshot과 redactor만 쓴다.
      {
        route: internalRoute(documentExport),
        handle(snapshot, ctx, input) {
          const exported = exportDocument(snapshot, ctx, input as never, {
            redactor: redactorFor(snapshot),
          });
          if (!exported.ok) return exported;
          return paged(exported.value);
        },
      },
    ],
    ports: new Map(),
  };
}
