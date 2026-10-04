// Document·Version read. list·get·history는 ledger metadata, file은 저장 바이트다.
// agent·coding_agent·app read는 현재 디스크 source를 빼서 돌려준다.

import { err, ok, type Result } from "../../base/mod.ts";
import {
  type Document,
  documentGet,
  documentHistory,
  documentList,
  type Version,
} from "../../contracts/documents/mod.ts";
import {
  parseActor,
  type ReadDefinition,
  type ReadSnapshot,
  type RequestContext,
} from "../../contracts/platform/mod.ts";
import { authorizeDocument } from "./authorization.ts";
import {
  assembleVersion,
  listDocuments,
  listVersions,
  loadDocument,
  loadFiles,
  loadVersion,
  loadVersionByNumber,
} from "./store.ts";

const PAGE = 50;

function notFound(message: string): Result<never> {
  return err({ code: "not_found", message });
}

function isUser(ctx: RequestContext): boolean {
  return parseActor(ctx.actor)?.kind === "user";
}

// agent metadata read에는 현재 디스크 source를 섞지 않는다.
function visibleDocument(ctx: RequestContext, document: Document): unknown {
  if (isUser(ctx)) return document;
  const { file_source: _source, ...rest } = document;
  return rest;
}

// place slug는 문서가 보관하지 않는다. 고정 참조는 문서 ID와 판 ID로 돌려준다.
function referenceOf(
  document: Document,
  version: { id: string; number: number },
) {
  return { document: document.id, version: version.id, section: null };
}

function allowed(
  snapshot: ReadSnapshot,
  ctx: RequestContext,
  operation: string,
  document: Document,
): Result<Document | null> {
  const decision = authorizeDocument(snapshot.port, ctx, operation, {
    kind: "document",
    document,
  });
  if (!decision.ok) {
    return decision.error.code === "forbidden" ||
        decision.error.code === "not_found"
      ? ok(null)
      : decision;
  }
  return ok(document);
}

export function createVersionReads(): {
  list: ReadDefinition<typeof documentList>;
  get: ReadDefinition<typeof documentGet>;
  history: ReadDefinition<typeof documentHistory>;
} {
  return {
    list: {
      route: documentList,
      handle(snapshot, ctx, input) {
        const limit = input.limit ?? PAGE;
        const offset = offsetOf(input.cursor);
        if (!offset.ok) return offset;
        const documents = listDocuments(snapshot.sql as never, {
          place: input.place,
          status: input.status,
          limit: limit + 1,
          offset: offset.value,
        });
        if (!documents.ok) return documents;
        const visible = [];
        for (const document of documents.value.slice(0, limit)) {
          const decision = allowed(
            snapshot,
            ctx,
            documentList.name,
            document,
          );
          if (!decision.ok) return decision;
          if (decision.value === null) continue;
          const version = loadVersion(
            snapshot.sql as never,
            document.latest_version,
          );
          if (!version.ok) return version;
          if (version.value === null) {
            return err({ code: "internal", message: "latest version missing" });
          }
          const { source: _source, ...summary } = version.value;
          visible.push({
            document: visibleDocument(ctx, document),
            latest_version: summary,
          });
        }
        const more = documents.value.length > limit;
        return ok({
          documents: visible,
          complete: !more,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: more ? String(offset.value + limit) : null,
        } as never);
      },
    },
    get: {
      route: documentGet,
      handle(snapshot, ctx, input) {
        const loaded = loadDocument(snapshot.sql as never, input.document);
        if (!loaded.ok) return loaded;
        if (loaded.value === null) return notFound("document not found");
        const decision = allowed(snapshot, ctx, documentGet.name, loaded.value);
        if (!decision.ok) return decision;
        if (decision.value === null) return notFound("document not found");
        const versionId = input.version ?? loaded.value.latest_version;
        const row = loadVersion(snapshot.sql as never, versionId);
        if (!row.ok) return row;
        if (row.value === null || row.value.document !== loaded.value.id) {
          return notFound("version not found");
        }
        const full = assembleVersion(snapshot.sql as never, row.value);
        if (!full.ok) return full;
        return ok({
          document: visibleDocument(ctx, loaded.value),
          version: full.value,
          reference: referenceOf(loaded.value, row.value),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        } as never);
      },
    },
    history: {
      route: documentHistory,
      handle(snapshot, ctx, input) {
        const loaded = loadDocument(snapshot.sql as never, input.document);
        if (!loaded.ok) return loaded;
        if (loaded.value === null) return notFound("document not found");
        const decision = allowed(
          snapshot,
          ctx,
          documentHistory.name,
          loaded.value,
        );
        if (!decision.ok) return decision;
        if (decision.value === null) return notFound("document not found");
        const bounds = versionBounds(snapshot, input);
        if (!bounds.ok) return bounds;
        const offset = offsetOf(input.cursor);
        if (!offset.ok) return offset;
        const rows = listVersions(snapshot.sql as never, loaded.value.id, {
          from: bounds.value.from,
          to: bounds.value.to,
          limit: PAGE + 1,
          offset: offset.value,
        });
        if (!rows.ok) return rows;
        const versions: Version[] = [];
        for (const row of rows.value.slice(0, PAGE)) {
          const full = assembleVersion(snapshot.sql as never, row);
          if (!full.ok) return full;
          versions.push(
            isUser(ctx) ? full.value : hideSource(full.value),
          );
        }
        const more = rows.value.length > PAGE;
        return ok({
          document: loaded.value.id,
          versions,
          complete: !more,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: more ? String(offset.value + PAGE) : null,
        } as never);
      },
    },
  };
}

// agent history는 file·instruction source의 경로를 빼서 null로 둔다.
function hideSource(version: Version): Version {
  if (version.source === null || version.source.kind === "app") return version;
  return { ...version, source: null };
}

function versionBounds(
  snapshot: ReadSnapshot,
  input: { document: string; from?: string; to?: string },
): Result<{ from?: number; to?: number }> {
  const from = bound(snapshot, input.document, input.from);
  if (!from.ok) return from;
  const to = bound(snapshot, input.document, input.to);
  if (!to.ok) return to;
  return ok({ from: from.value, to: to.value });
}

function bound(
  snapshot: ReadSnapshot,
  document: string,
  version: string | undefined,
): Result<number | undefined> {
  if (version === undefined) return ok(undefined);
  const row = loadVersion(snapshot.sql as never, version);
  if (!row.ok) return row;
  if (row.value === null || row.value.document !== document) {
    return notFound("version not found");
  }
  return ok(row.value.number);
}

function offsetOf(cursor: string | undefined): Result<number> {
  if (cursor === undefined) return ok(0);
  if (!/^[0-9]+$/.test(cursor)) {
    return err({ code: "invalid_input", message: "cursor is invalid" });
  }
  const value = Number(cursor);
  if (!Number.isSafeInteger(value)) {
    return err({ code: "invalid_input", message: "cursor is invalid" });
  }
  return ok(value);
}

// documents/file 응답. 고정 판의 ContentFile 상대 경로를 저장 바이트와 MIME으로 연다.
export function storedFile(
  snapshot: ReadSnapshot,
  ctx: RequestContext,
  input: { version: string; path: string },
): Result<{ hash: string; bytes: number; media_type: string }> {
  const row = loadVersion(snapshot.sql as never, input.version);
  if (!row.ok) return row;
  if (row.value === null) return notFound("version not found");
  const document = loadDocument(snapshot.sql as never, row.value.document);
  if (!document.ok) return document;
  if (document.value === null) return notFound("document not found");
  const decision = allowed(snapshot, ctx, "document.file", document.value);
  if (!decision.ok) return decision;
  if (decision.value === null) return notFound("version not found");
  const files = loadFiles(snapshot.sql as never, input.version);
  if (!files.ok) return files;
  const file = files.value.find((item) => item.path === input.path);
  if (file === undefined) return notFound("file not found");
  return ok({
    hash: file.blob_hash,
    bytes: file.bytes,
    media_type: file.media_type,
  });
}

export { loadVersionByNumber };
