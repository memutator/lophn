// Document·Version ledger command.
// document.save는 신뢰한 준비 결과만 받는다. core는 파일을 다시 읽거나 hash하지 않는다.
// 확정 판의 원문·형식·주체·시각·출처는 바꾸는 경로가 없다.

import { err, ok, type Result } from "../../base/mod.ts";
import {
  type Document,
  documentArchive,
  documentArchived,
  documentCreated,
  documentSave,
  documentSaved,
  documentUnarchive,
  documentUnarchived,
  documentUpdate,
  documentUpdated,
  type FormatRef,
  type PreparedVersion,
  type SaveResult,
  type Version,
} from "../../contracts/documents/mod.ts";
import {
  type CommandDefinition,
  defineBlobField,
  parseActor,
  type PreparedBlob,
  type RequestContext,
  type Tx,
} from "../../contracts/platform/mod.ts";
import { createDocumentNameReservation } from "../addressing/mod.ts";
import { contentUnchanged, nextVersionNumber } from "./model.ts";
import {
  insertDocument,
  insertVersion,
  loadDocument,
  loadLatestVersion,
  maxVersionNumber,
  replaceDocument,
} from "./store.ts";
import { authorizeDocument } from "./authorization.ts";

// 판 원문 파일. owner_key는 version id와 상대 경로다. 일반 읽기를 연다.
// 경로별 원문 등록은 준비 worker가 파일 목록을 확정한 뒤 한다(documents T8).
export const versionFileField = defineBlobField({
  owner_kind: "document_version",
  field: "file",
  retention: { kind: "permanent" },
  general_read: true,
});

// 정규화 ContentFile 목록 blob. owner_key는 version id, files_hash가 그 hash다.
// 준비 결과가 준 preparation_ref·files_hash로만 등록하고 core는 다시 hash하지 않는다.
export const versionFilesField = defineBlobField({
  owner_kind: "document_version",
  field: "files",
  retention: { kind: "permanent" },
  general_read: false,
});

const SAVE_ACTORS = [
  "user",
  "coding_agent",
  "agent",
  "app",
  "machine",
] as const;

function rejected(code: string, message: string): Result<never> {
  return err({ code: code as "conflict", message });
}

function actorAllowed(
  ctx: RequestContext,
  allowed: readonly string[],
): boolean {
  const kind = parseActor(ctx.actor)?.kind;
  return kind !== undefined && allowed.includes(kind);
}

// 저장 주체는 인증된 자격이다. 주장한 이름·작업 디렉터리로 source를 만들지 않는다.
function claimedActor(ctx: RequestContext, prepared: PreparedVersion): boolean {
  const source = prepared.source;
  if (source?.kind === "app" && ctx.actor !== `app:${source.app}`) return true;
  return false;
}

// 원본 연결 문서는 현재 파일 관측의 준비 결과로만 새 판을 확정한다(versions#R13).
function directSaveOfLinked(
  document: Document | null,
  prepared: PreparedVersion,
): boolean {
  if (document === null || document.file_source === null) return false;
  const source = prepared.source;
  return source === null || source.kind === "app";
}

export function createVersionCommands(): {
  save: CommandDefinition<typeof documentSave>;
  update: CommandDefinition<typeof documentUpdate>;
  archive: CommandDefinition<typeof documentArchive>;
  unarchive: CommandDefinition<typeof documentUnarchive>;
} {
  return {
    save: {
      route: documentSave,
      handle(tx, ctx, input, compare) {
        if (!actorAllowed(ctx, SAVE_ACTORS)) {
          return rejected("forbidden", "actor cannot save documents");
        }
        if (input.base_version !== compare.base_version) {
          return rejected("conflict", "base version does not match");
        }
        if (claimedActor(ctx, input)) {
          return rejected("forbidden", "claimed actor is not the credential");
        }
        const existing = loadDocument(tx.sql, input.document);
        if (!existing.ok) return existing;
        if (existing.value === null) return createDocument(tx, ctx, input);
        return saveVersion(tx, ctx, existing.value, input);
      },
    },
    update: {
      route: documentUpdate,
      handle(tx, ctx, input, compare) {
        if (!actorAllowed(ctx, documentUpdate.actors)) {
          return rejected("forbidden", "actor cannot update documents");
        }
        const current = loadDocument(tx.sql, input.document);
        if (!current.ok) return current;
        if (current.value === null) {
          return rejected("not_found", "document not found");
        }
        const access = authorizeDocument(tx.port, ctx, documentUpdate.name, {
          kind: "document",
          document: current.value,
        });
        if (!access.ok) return access;
        if (current.value.revision !== compare.base_revision) {
          return rejected("conflict", "document revision changed");
        }
        if (current.value.title === input.title) {
          return rejected("invalid_input", "title does not change");
        }
        const seq = tx.emit(documentUpdated, current.value.id, {
          before_title: current.value.title,
          title: input.title,
          before_revision: current.value.revision,
        });
        const next: Document = {
          ...current.value,
          title: input.title,
          revision: seq,
        };
        replaceDocument(tx, next);
        return ok(next);
      },
    },
    archive: {
      route: documentArchive,
      handle: (tx, ctx, input, compare) =>
        transition(tx, ctx, input.document, compare.base_revision, "archive"),
    },
    unarchive: {
      route: documentUnarchive,
      handle: (tx, ctx, input, compare) =>
        transition(tx, ctx, input.document, compare.base_revision, "unarchive"),
    },
  };
}

function createDocument(
  tx: Tx,
  ctx: RequestContext,
  prepared: PreparedVersion,
): Result<SaveResult> {
  if (prepared.base_version !== null || prepared.metadata === undefined) {
    return rejected("invalid_input", "new document needs metadata");
  }
  const metadata = prepared.metadata;
  const candidate: Document = {
    id: prepared.document,
    place: metadata.place,
    name: metadata.name,
    title: metadata.title,
    file_source: null,
    latest_version: prepared.document,
    revision: "1",
    status: "active",
  };
  const access = authorizeDocument(tx.port, ctx, documentSave.name, {
    kind: "create",
    document: candidate,
  });
  if (!access.ok) return access;
  const version = mintVersion(tx, ctx, prepared, 1);
  if (!version.ok) return version;
  const createdSeq = tx.emit(documentCreated, prepared.document, {
    place: metadata.place,
    name: metadata.name,
    title: metadata.title,
    file_source: null,
    version: version.value.id,
  });
  const savedSeq = tx.emit(documentSaved, prepared.document, {
    version: version.value.id,
    previous_version: null,
    content_hash: prepared.content_hash,
    format: prepared.format,
    source: prepared.source,
  });
  const document: Document = {
    ...candidate,
    latest_version: version.value.id,
    revision: createdSeq,
  };
  if (document.place !== null && document.name !== null) {
    const reserved = createDocumentNameReservation(tx).reserve(
      document.place,
      document.name,
      document.id,
      createdSeq,
    );
    if (!reserved.ok) return reserved;
  }
  insertDocument(tx, document);
  const stored = storeVersion(tx, ctx, version.value, prepared);
  if (!stored.ok) return stored;
  return ok(saveResult(document, version.value, savedSeq));
}

function saveVersion(
  tx: Tx,
  ctx: RequestContext,
  document: Document,
  prepared: PreparedVersion,
): Result<SaveResult> {
  const access = authorizeDocument(tx.port, ctx, documentSave.name, {
    kind: "document",
    document,
  });
  if (!access.ok) return access;
  if (prepared.base_version === null) {
    return rejected("conflict", "document already exists");
  }
  if (document.latest_version !== prepared.base_version) {
    return rejected("conflict", "latest version changed");
  }
  if (directSaveOfLinked(document, prepared)) {
    return rejected("conflict", "linked document needs file observation");
  }
  const latest = loadLatestVersion(tx.sql, document.id);
  if (!latest.ok) return latest;
  if (latest.value === null || latest.value.id !== prepared.base_version) {
    return rejected("conflict", "latest version changed");
  }
  if (
    contentUnchanged(
      { content_hash: latest.value.content_hash, format: latest.value.format },
      { content_hash: prepared.content_hash, format: prepared.format },
    )
  ) {
    return ok(unchangedResult(document, latest.value));
  }
  const current = maxVersionNumber(tx.sql, document.id);
  const version = mintVersion(tx, ctx, prepared, nextVersionNumber(current));
  if (!version.ok) return version;
  const seq = tx.emit(documentSaved, document.id, {
    version: version.value.id,
    previous_version: latest.value.id,
    content_hash: prepared.content_hash,
    format: prepared.format,
    source: prepared.source,
  });
  // 내용 저장은 latest_version만 옮긴다. revision은 메타데이터·연결·보관 seq로 남긴다.
  const next: Document = { ...document, latest_version: version.value.id };
  replaceDocument(tx, next);
  const stored = storeVersion(tx, ctx, version.value, prepared);
  if (!stored.ok) return stored;
  return ok(saveResult(next, version.value, seq));
}

function mintVersion(
  tx: Tx,
  ctx: RequestContext,
  prepared: PreparedVersion,
  number: number,
): Result<Version> {
  const run = ctx.run ?? null;
  if (ctx.actor.startsWith("agent:") && run === null) {
    return rejected("invalid_input", "agent save needs its run");
  }
  if (ctx.actor.startsWith("app:") && prepared.source?.kind !== "app") {
    return rejected("invalid_input", "app save needs its app source");
  }
  const version: Version = {
    id: tx.newId("ver"),
    document: prepared.document,
    number,
    // 파일 목록 행은 준비 worker가 같은 transaction에 남긴다(documents T8).
    files: { hash: prepared.files_hash, size_bytes: 0 },
    content_hash: prepared.content_hash,
    format: prepared.format,
    saved_by: ctx.actor,
    saved_at: tx.now(),
    run,
    source: prepared.source,
  };
  return ok(version);
}

// 정규화 목록 blob을 판에 묶는다. 등록 실패는 저장 실패다(versions#R5).
// 경로별 원문 blob은 준비 worker가 파일 목록을 확정하며 등록한다(documents T8).
function storeVersion(
  tx: Tx,
  ctx: RequestContext,
  version: Version,
  prepared: PreparedVersion,
): Result<void> {
  const listed = tx.registerBlobRef({
    owner_kind: versionFilesField.owner_kind,
    owner_key: version.id,
    field: versionFilesField.field,
    registered_seq: "1",
    source: { kind: "prepared", blob: filesBlob(ctx, prepared) },
  });
  if (!listed.ok) return listed;
  insertVersion(tx, version, {
    files_hash: prepared.files_hash,
    primary_path: prepared.primary_path,
    file_count: prepared.file_count,
  });
  return ok(undefined);
}

function filesBlob(
  ctx: RequestContext,
  prepared: PreparedVersion,
): PreparedBlob {
  return {
    preparation: prepared.preparation_ref,
    hash: prepared.files_hash,
    size_bytes: 0,
    principal: ctx.principal,
    purpose: "document_files",
  };
}

function transition(
  tx: Tx,
  ctx: RequestContext,
  id: string,
  base: string,
  action: "archive" | "unarchive",
): Result<Document> {
  const route = action === "archive" ? documentArchive : documentUnarchive;
  if (!actorAllowed(ctx, route.actors)) {
    return rejected("forbidden", "actor cannot change archive state");
  }
  const current = loadDocument(tx.sql, id);
  if (!current.ok) return current;
  if (current.value === null) {
    return rejected("not_found", "document not found");
  }
  const access = authorizeDocument(tx.port, ctx, route.name, {
    kind: "document",
    document: current.value,
  });
  if (!access.ok) return access;
  if (current.value.revision !== base) {
    return rejected("conflict", "document revision changed");
  }
  const expected = action === "archive" ? "active" : "archived";
  if (current.value.status !== expected) {
    return rejected("conflict", "document status changed");
  }
  const seq = tx.emit(
    action === "archive" ? documentArchived : documentUnarchived,
    current.value.id,
    { before_revision: current.value.revision },
  );
  const next: Document = {
    ...current.value,
    status: action === "archive" ? "archived" : "active",
    revision: seq,
  };
  replaceDocument(tx, next);
  return ok(next);
}

// place slug는 문서가 보관하지 않는다. 고정 참조는 문서 ID와 판 ID로 돌려준다.
function referenceOf(
  document: Document,
  version: { id: string; number: number },
) {
  return { document: document.id, version: version.id, section: null };
}

function saveResult(
  document: Document,
  version: Version,
  seq: string,
): SaveResult {
  return {
    status: "saved",
    document: document.id,
    version: version.id,
    reference: referenceOf(document, version),
    event_seq: seq,
    warnings: [],
  };
}

function unchangedResult(
  document: Document,
  version: { id: string; number: number },
): SaveResult {
  return {
    status: "unchanged",
    document: document.id,
    version: version.id,
    reference: referenceOf(document, version),
    event_seq: null,
    warnings: [],
  };
}

export type { FormatRef };
