// Document·Version ledger command.
// document.save는 신뢰한 준비 결과만 받는다. core는 파일을 다시 읽거나 hash하지 않는다.
// 확정 판의 원문·형식·주체·시각·출처는 바꾸는 경로가 없다.

import { err, ok, type Result } from "../../base/mod.ts";
import {
  type ContentFile,
  type Document,
  documentArchive,
  documentArchived,
  documentCreated,
  documentRestore,
  documentRestored,
  documentSave,
  documentSaved,
  documentUnarchive,
  documentUnarchived,
  documentUpdate,
  documentUpdated,
  type FileSource,
  type FormatRef,
  type PreparedFile,
  type PreparedVersion,
  type SaveResult,
  type Version,
} from "../../contracts/documents/mod.ts";
import {
  type BlobRefRegistration,
  type CommandDefinition,
  defineBlobField,
  parseActor,
  type PreparedBlob,
  type RequestContext,
  type Tx,
} from "../../contracts/platform/mod.ts";
import {
  createDocumentNameReservation,
  type PlaceRef,
  SLUG_MAX_LENGTH,
  slugSchema,
  suggestName,
} from "../addressing/mod.ts";
import { basisChanged } from "../file-tracking/mod.ts";
import { contentUnchanged, nextVersionNumber } from "./model.ts";
import {
  insertDocument,
  insertVersion,
  loadDocument,
  loadFiles,
  loadLatestVersion,
  loadVersion,
  maxVersionNumber,
  replaceDocument,
  type VersionRow,
} from "./store.ts";
import { authorizeDocument } from "./authorization.ts";
import { appOutputRejected, releaseClaimed } from "./app-output.ts";

// 판 원문 파일. owner_key는 `<version id>/<상대 경로>`다. 일반 읽기를 연다.
// save가 준비 결과의 파일별 준비 참조로 같은 tx에서 등록한다(Q16).
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
  // 앱이 판의 출처로 쓰는 release는 자격이 발급 때 고정한 release다.
  if (releaseClaimed(ctx, source)) return true;
  return false;
}

// 관측 근거가 현재 연결과 다르면 그 제출은 늦다. core는 파일을 다시 읽지 않고
// conflict만 돌려 다시 관측하게 한다(file-tracking#R7, versions#R13).
// project_revision과 root 제거도 같은 비교다. 준비와 확정 사이에 규칙·연결·보관·
// root가 바뀌면 basisChanged가 참이고, 그 제출은 conflict다.
function observationBasisStale(
  document: Document,
  prepared: PreparedVersion,
): boolean {
  const basis = prepared.file_basis;
  if (basis === undefined) return false;
  const source = document.file_source;
  // 연결이 없는 문서의 제출은 경로로 비교하지 않는다. root 제거는 연결이 사라졌을 때다.
  const linked = source !== null && basis.file_source !== null;
  const currentPath = linked && basis.path === source.path &&
      basis.project === source.project && basis.kind === source.kind
    ? basis.path
    : linked
    ? source.path
    : basis.path;
  return basisChanged(
    {
      project: basis.project ?? "",
      projectRevision: basis.project_revision ?? "",
      path: basis.path,
      documentRevision: basis.document_revision ?? null,
      active: basis.document_status === "active",
      archived: false,
      rootPresent: basis.file_source !== null,
    },
    {
      project: basis.project ?? "",
      projectRevision: basis.project_revision ?? "",
      path: currentPath,
      documentRevision: basis.document_revision === undefined
        ? null
        : document.revision,
      active: document.status === "active",
      archived: document.status === "archived",
      rootPresent: source !== null,
    },
  );
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

// agent 출력은 일반 문서의 고정 판이다(versions#R14). 파일 관측 source를 주장하지 못하고,
// 원본 연결·지침 문서와 보관 문서는 출력 대상이 아니다. 범위 밖 대상의 답은 platform이
// 이미 정했고(authorizeDocument) 이 규칙은 그 범위 안에서도 쓰지 못하는 상태만 거절한다.
function agentOutputRejected(
  ctx: RequestContext,
  document: Document | null,
  source: PreparedVersion["source"],
): Result<never> | undefined {
  if (parseActor(ctx.actor)?.kind !== "agent") return undefined;
  if (source !== null) {
    return rejected("forbidden", "agent output has no file or app source");
  }
  if (document === null) return undefined;
  if (document.file_source !== null) {
    return rejected("forbidden", "linked document is not an agent output");
  }
  if (document.status !== "active") {
    return rejected("forbidden", "archived document is not an agent output");
  }
  return undefined;
}

// 요청된 revert의 machine이 하는 보관은 agent run이 만든 문서의 보상만이다
// (versions domain model, lophn-agent/revert). 모든 판을 agent가 남겼고 원본 연결이 없을 때만 한다.
// 첫 판이 agent가 아니면 보상 대상이 아니라 forbidden이고, 이후 다른 주체의 판이 있으면 그
// 변경 뒤라서 conflict다. 문서 revision의 이후 변경은 base_revision 비교가 conflict로 막는다.
function revertArchiveRejected(
  tx: Tx,
  document: Document,
): Result<never> | undefined {
  const versions = tx.sql.all(
    "SELECT number, saved_by FROM versions WHERE document = ? ORDER BY number",
    [document.id],
  );
  const byAgent = (row: { [key: string]: unknown }) =>
    typeof row["saved_by"] === "string" &&
    parseActor(row["saved_by"])?.kind === "agent";
  if (
    document.file_source !== null || versions.length === 0 ||
    !byAgent(versions[0])
  ) {
    return rejected(
      "forbidden",
      "revert archives only agent-created documents",
    );
  }
  if (!versions.every(byAgent)) {
    return rejected("conflict", "document changed after the agent run");
  }
  return undefined;
}

// 첫 저장이 같은 tx 안에서 가족 가입을 부르는 seam. 구현은 documents/series가 갖고
// core 등록이 주입한다(versions는 series를 import하지 않는다). 거절은 저장 전체의 거절이다.
export type SeriesJoin = (
  tx: Tx,
  ctx: RequestContext,
  document: Document,
) => Result<void>;

export function createVersionCommands(
  options: { joinSeries?: SeriesJoin } = {},
): {
  save: CommandDefinition<typeof documentSave>;
  restore: CommandDefinition<typeof documentRestore>;
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
        const claimed = agentOutputRejected(ctx, null, input.source);
        if (claimed !== undefined) return claimed;
        const existing = loadDocument(tx.sql, input.document);
        if (!existing.ok) return existing;
        // 앱 자격은 자기 앱 place의 출력만 쓴다(versions#R14). 다른 place의 기존 문서는 없는
        // 문서와 같은 답이다.
        const appOutput = appOutputRejected(tx, ctx, existing.value, input);
        if (appOutput !== undefined) return appOutput;
        if (existing.value === null) {
          return createDocument(tx, ctx, input, options.joinSeries);
        }
        return saveVersion(tx, ctx, existing.value, input);
      },
    },
    restore: {
      route: documentRestore,
      handle: (tx, ctx, input, compare) =>
        restoreVersion(tx, ctx, input, compare),
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
        const output = agentOutputRejected(ctx, current.value, null);
        if (output !== undefined) return output;
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
  joinSeries: SeriesJoin | undefined,
): Result<SaveResult> {
  if (prepared.base_version !== null || prepared.metadata === undefined) {
    return rejected("invalid_input", "new document needs metadata");
  }
  const metadata = prepared.metadata;
  // 파일 관측이 만드는 첫 문서는 그 파일에 연결된다(versions#R13). 연결이 이미 있거나
  // 같은 경로에 연결된 문서가 있으면 그 제출은 늦다. 새 문서를 두 번째로 만들지 않는다.
  const linked = newFileSource(tx, prepared);
  if (!linked.ok) return linked;
  // 프로젝트 폴더에서 관측한 새 문서는 그 프로젝트에 둔다(documents Q31).
  const placed = observedPlacement(tx, metadata, linked.value);
  const candidate: Document = {
    id: prepared.document,
    place: placed.place,
    name: placed.name,
    title: metadata.title,
    file_source: linked.value,
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
    place: placed.place,
    name: placed.name,
    title: metadata.title,
    file_source: candidate.file_source,
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
  if (joinSeries !== undefined) {
    const joined = joinSeries(tx, ctx, document);
    if (!joined.ok) return joined;
  }
  return ok(saveResult(document, version.value, savedSeq, prepared));
}

// 이름을 찾으려고 붙여 보는 숫자의 한도.
const NAME_ATTEMPTS = 1000;

// 프로젝트 폴더의 파일을 관측해 만든 첫 문서가 자리 없이 왔으면 그 프로젝트를 자리로 하고
// 이름은 제목(없으면 파일 이름)에서 정한다. 같은 자리의 이름이 이미 쓰이면 `-2`부터 붙인다
// (이름은 같은 자리에서 유일하고 옛 예약도 다른 대상이 쓸 수 없다, addressing#R2). 호출자가
// 자리나 이름을 정해 보냈으면 그대로 둔다. 파일이 없는 저장(upload·agent)은 자리를 정하지 않는다
// (addressing#R3). 지침 파일 문서는 프로젝트 문서가 아니라 그대로 둔다.
function observedPlacement(
  tx: Tx,
  metadata: { place: PlaceRef | null; name: string | null; title: string },
  linked: FileSource | null,
): { place: PlaceRef | null; name: string | null } {
  if (
    linked === null || linked.kind !== "project_file" ||
    metadata.place !== null || metadata.name !== null
  ) return { place: metadata.place, name: metadata.name };
  const place: PlaceRef = { kind: "project", id: linked.project };
  const base = suggestName(metadata.title, linked.path);
  const reservations = createDocumentNameReservation(tx);
  // 이름이 쓰였는지: 예약 표와 documents 표를 모두 본다. 읽지 못하면 null이다.
  const taken = (name: string): boolean | null => {
    const reserved = reservations.get(place, name);
    if (!reserved.ok) return null;
    if (reserved.value !== null) return true;
    return tx.sql.get(
      "SELECT id FROM documents WHERE place_kind = ? AND place_id = ? AND name = ?",
      [place.kind, place.id, name],
    ) !== undefined;
  };
  for (let n = 1; n <= NAME_ATTEMPTS; n++) {
    const suffix = n === 1 ? "" : `-${n}`;
    const stem = base.slice(0, SLUG_MAX_LENGTH - suffix.length)
      .replace(/-+$/g, "");
    const name = slugSchema.parse(`${stem}${suffix}`);
    const used = taken(name);
    if (used === null) break;
    if (!used) return { place, name };
  }
  // 이름을 정하지 못하면 자리 없이 둔다. 사람이 나중에 옮긴다.
  return { place: null, name: null };
}

// 첫 문서 저장이 파일 관측이면 연결할 FileSource. 관측이 아니면 연결 없음(null)이다.
function newFileSource(
  tx: Tx,
  prepared: PreparedVersion,
): Result<FileSource | null> {
  const source = prepared.source;
  if (source === null || source.kind === "app") return ok(null);
  const basis = prepared.file_basis;
  if (basis === undefined || basis.file_source !== null) {
    return rejected("conflict", "observation basis changed");
  }
  const existing = tx.sql.get(
    "SELECT id FROM documents WHERE source_path = ?",
    [source.path],
  );
  if (existing !== undefined) {
    return rejected("conflict", "file is already linked to a document");
  }
  if (source.kind === "file") {
    return ok({
      kind: "project_file",
      project: source.project,
      path: source.path,
    });
  }
  return ok({
    kind: "instruction_file",
    instruction_target: source.instruction_target,
    project: source.project,
    path: source.path,
  });
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
  const output = agentOutputRejected(ctx, document, prepared.source);
  if (output !== undefined) return output;
  if (prepared.base_version === null) {
    return rejected("conflict", "document already exists");
  }
  if (document.latest_version !== prepared.base_version) {
    return rejected("conflict", "latest version changed");
  }
  if (directSaveOfLinked(document, prepared)) {
    return rejected("conflict", "linked document needs file observation");
  }
  if (observationBasisStale(document, prepared)) {
    return rejected("conflict", "observation basis changed");
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
  return ok(saveResult(next, version.value, seq, prepared));
}

type RestoreHandle = CommandDefinition<typeof documentRestore>["handle"];

function sameFormat(left: FormatRef, right: FormatRef): boolean {
  return left.name === right.name && left.module_hash === right.module_hash &&
    left.explicit === right.explicit;
}

// 준비 결과가 선택한 옛 판의 바이트와 정확한 FormatRef 그대로인지 본다. core는 파일을
// 다시 읽지 않는다: 준비가 낸 hash·목록이 선택 판의 행과 같은지만 비교한다. 새로 만든
// 판은 이 확인을 지난 값으로만 선다(versions#R10).
function restoresSelected(
  tx: Tx,
  selected: VersionRow,
  prepared: PreparedVersion,
): Result<void> {
  const stale = () =>
    rejected("invalid_input", "prepared result is not the selected version");
  if (
    prepared.content_hash !== selected.content_hash ||
    prepared.files_hash !== selected.files_hash ||
    prepared.file_count !== selected.file_count ||
    prepared.primary_path !== selected.primary_path ||
    !sameFormat(prepared.format, selected.format)
  ) return stale();
  const rows = loadFiles(tx.sql, selected.id);
  if (!rows.ok) return rows;
  // 판의 경로별 행이 있으면 준비한 파일 목록이 그 행과 한 줄씩 같아야 한다. 행이 없는
  // 판(옛 저장)은 정규화 목록 hash가 같다는 것까지만 확인한다.
  if (rows.value.length > 0) {
    if (rows.value.length !== prepared.files.length) return stale();
    for (const file of prepared.files) {
      const row = rows.value.find((item) => item.path === file.path);
      if (
        row === undefined || row.blob_hash !== file.blob_hash ||
        row.bytes !== file.bytes || row.media_type !== file.media_type ||
        row.primary !== file.primary
      ) return stale();
    }
  }
  for (const file of prepared.files) {
    if (!("existing" in file)) continue;
    const source = existingFileSource(file.existing);
    if (
      source === undefined || source.version !== selected.id ||
      source.path !== file.path
    ) return stale();
  }
  return ok(undefined);
}

// 원본 연결 문서의 restore는 선택 판의 바이트를 사람이 파일에 쓴 뒤 그 파일의 관측 근거로만
// 선다(versions#R13). 연결과 다른 source·근거 없는 직접 restore는 늦은 요청이다.
function restoreSourceAllowed(
  document: Document,
  selected: VersionRow,
  tx: Tx,
  prepared: PreparedVersion,
): Result<void> {
  const linked = document.file_source;
  const source = prepared.source;
  if (linked === null) {
    if (source !== null || prepared.file_basis !== undefined) {
      return rejected(
        "invalid_input",
        "unlinked document restore has no file source",
      );
    }
    return ok(undefined);
  }
  const needs = () =>
    rejected("conflict", "linked document needs file write and observation");
  if (
    source === null || source.kind === "app" ||
    prepared.file_basis === undefined
  ) return needs();
  const matches = source.kind === "file"
    ? linked.kind === "project_file" && linked.project === source.project
    : linked.kind === "instruction_file" &&
      linked.instruction_target === source.instruction_target &&
      linked.project === source.project;
  if (!matches || linked.path !== source.path) return needs();
  if (observationBasisStale(document, prepared)) {
    return rejected("conflict", "observation basis changed");
  }
  // 관측한 파일 바이트가 선택 판의 대표 파일이어야 restore다.
  const rows = loadFiles(tx.sql, selected.id);
  if (!rows.ok) return rows;
  const primary = rows.value.find((file) => file.primary);
  if (primary !== undefined && source.original_hash !== primary.blob_hash) {
    return rejected(
      "invalid_input",
      "observed file is not the selected version",
    );
  }
  return ok(undefined);
}

// 선택한 옛 판의 내용과 정확한 FormatRef로 새 판을 만든다(versions#R10). 최신 판·문서
// revision이 읽은 그대로일 때만 하고, 최신과 같은 내용·형식이면 새 판도 event도 없다.
// 옛 판과 그 event는 그대로 남는다. 제목 보상 값은 요청된 revert(machine)만 보낸다.
function restoreVersion(
  tx: Tx,
  ctx: RequestContext,
  input: Parameters<RestoreHandle>[2],
  compare: Parameters<RestoreHandle>[3],
): Result<SaveResult> {
  if (!actorAllowed(ctx, documentRestore.actors)) {
    return rejected("forbidden", "actor cannot restore documents");
  }
  const prepared = input.prepared;
  const kind = parseActor(ctx.actor)?.kind;
  if (input.title !== undefined && kind !== "machine") {
    return rejected("invalid_input", "only a requested revert sets the title");
  }
  const loaded = loadDocument(tx.sql, input.document);
  if (!loaded.ok) return loaded;
  const absent = () => rejected("not_found", "document not found");
  if (loaded.value === null) return absent();
  const document = loaded.value;
  // 권한 밖은 없는 문서와 같은 답이다(존재를 새지 않는다).
  const access = authorizeDocument(tx.port, ctx, documentRestore.name, {
    kind: "document",
    document,
  });
  if (!access.ok) {
    return access.error.code === "unavailable" ? access : absent();
  }
  const selected = loadVersion(tx.sql, input.restore_version);
  if (!selected.ok) return selected;
  if (selected.value === null || selected.value.document !== document.id) {
    return rejected("not_found", "version not found");
  }
  if (
    document.latest_version !== compare.base_version ||
    prepared.base_version !== compare.base_version
  ) return rejected("conflict", "latest version changed");
  if (document.revision !== compare.base_revision) {
    return rejected("conflict", "document revision changed");
  }
  if (document.status !== "active") {
    return rejected("conflict", "document is archived");
  }
  const matches = restoresSelected(tx, selected.value, prepared);
  if (!matches.ok) return matches;
  const sourced = restoreSourceAllowed(document, selected.value, tx, prepared);
  if (!sourced.ok) return sourced;
  const latest = loadLatestVersion(tx.sql, document.id);
  if (!latest.ok) return latest;
  if (latest.value === null || latest.value.id !== compare.base_version) {
    return rejected("conflict", "latest version changed");
  }
  const retitle = input.title !== undefined && input.title !== document.title;
  if (
    contentUnchanged(
      { content_hash: latest.value.content_hash, format: latest.value.format },
      { content_hash: prepared.content_hash, format: prepared.format },
    )
  ) {
    if (retitle) retitled(tx, document, input.title as string);
    return ok(unchangedResult(document, latest.value));
  }
  const current = maxVersionNumber(tx.sql, document.id);
  const version = mintVersion(tx, ctx, prepared, nextVersionNumber(current));
  if (!version.ok) return version;
  tx.emit(documentSaved, document.id, {
    version: version.value.id,
    previous_version: latest.value.id,
    content_hash: prepared.content_hash,
    format: prepared.format,
    source: prepared.source,
  });
  const restoredSeq = tx.emit(documentRestored, document.id, {
    restore_version: selected.value.id,
    previous_version: latest.value.id,
    version: version.value.id,
  });
  const next: Document = { ...document, latest_version: version.value.id };
  replaceDocument(tx, next);
  const stored = storeVersion(tx, ctx, version.value, prepared);
  if (!stored.ok) return stored;
  const seq = retitle ? retitled(tx, next, input.title as string) : restoredSeq;
  return ok(saveResult(next, version.value, seq, prepared));
}

// revert가 보낸 제목으로 되돌린다. document.update와 같은 event와 revision 규칙이다.
function retitled(tx: Tx, document: Document, title: string): string {
  const seq = tx.emit(documentUpdated, document.id, {
    before_title: document.title,
    title,
    before_revision: document.revision,
  });
  replaceDocument(tx, { ...document, title, revision: seq });
  return seq;
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
    // 파일 목록 행(version_files)은 storeVersion이 같은 tx에서 남긴다.
    files: prepared.files.map(contentFileOf),
    content_hash: prepared.content_hash,
    format: prepared.format,
    saved_by: ctx.actor,
    saved_at: tx.now(),
    run,
    source: prepared.source,
  };
  return ok(version);
}

// 정규화 목록 blob과 경로별 원문 blob을 판에 묶는다. 등록 실패는 저장 실패다(versions#R5).
// 원문 blob은 파일별 준비 참조로 등록한다. 등록하지 않으면 준비 참조 수명이 지나 사라진다.
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
  for (const file of prepared.files) {
    let source: BlobRefRegistration["source"];
    if ("preparation_ref" in file) {
      source = { kind: "prepared", blob: fileBlob(ctx, file) };
    } else {
      const allowed = existingFileAllowed(tx, ctx, file);
      if (!allowed.ok) return allowed;
      source = { kind: "existing", reference: file.existing };
    }
    const original = tx.registerBlobRef({
      owner_kind: versionFileField.owner_kind,
      owner_key: `${version.id}/${file.path}`,
      field: versionFileField.field,
      registered_seq: "1",
      source,
    });
    if (!original.ok) return original;
  }
  insertVersion(tx, version, {
    files_hash: prepared.files_hash,
    primary_path: prepared.primary_path,
    file_count: prepared.file_count,
  });
  return ok(undefined);
}

function contentFileOf(file: PreparedFile): ContentFile {
  return {
    path: file.path,
    blob_hash: file.blob_hash,
    bytes: file.bytes,
    media_type: file.media_type,
    primary: file.primary,
  };
}

// `existing` 원본 참조가 가리키는 판 파일(`document_version/file`, owner_key `<판>/<경로>`).
// 판 파일 참조가 아니거나 owner_key가 그 모양이 아니면 undefined다. 판정(그 판의 행과
// 문서 접근)은 부르는 쪽이 같은 규칙으로 한다: 저장(existingFileAllowed)과 파일 쓰기의
// 옛 판 복원이 이 함수 하나로 참조를 푼다.
export function existingFileSource(
  reference: { owner_kind: string; owner_key: string; field: string },
): { version: string; path: string } | undefined {
  if (
    reference.owner_kind !== versionFileField.owner_kind ||
    reference.field !== versionFileField.field
  ) return undefined;
  const slash = reference.owner_key.indexOf("/");
  if (slash <= 0 || slash === reference.owner_key.length - 1) return undefined;
  return {
    version: reference.owner_key.slice(0, slash),
    path: reference.owner_key.slice(slash + 1),
  };
}

// 이미 등록된 원문 blob을 새 판의 파일로 다시 묶을 수 있는지. 그 blob은 documents의 판 파일
// 참조여야 하고, 그 판의 문서를 이 자격이 읽을 수 있어야 한다. 없는 참조와 권한 밖은 같은
// 답이다(존재를 새지 않는다).
function existingFileAllowed(
  tx: Tx,
  ctx: RequestContext,
  file: Extract<PreparedFile, { existing: unknown }>,
): Result<void> {
  const absent = rejected(
    "forbidden",
    "existing blob reference is not allowed",
  );
  const source = existingFileSource(file.existing);
  if (source === undefined) return absent;
  const sourceVersion = source.version;
  const sourcePath = source.path;
  const row = tx.sql.get(
    `SELECT v.document AS document FROM versions v
     JOIN version_files f ON f.version = v.id
     WHERE v.id = ? AND f.path = ? AND f.blob_hash = ? AND f.bytes = ?`,
    [sourceVersion, sourcePath, file.blob_hash, file.bytes],
  );
  const owner = row?.["document"];
  if (typeof owner !== "string") return absent;
  const document = loadDocument(tx.sql, owner);
  if (!document.ok || document.value === null) return absent;
  const access = authorizeDocument(tx.port, ctx, "document.file", {
    kind: "document",
    document: document.value,
  });
  return access.ok ? ok(undefined) : absent;
}

function fileBlob(
  ctx: RequestContext,
  file: Extract<PreparedFile, { preparation_ref: string }>,
): PreparedBlob {
  return {
    preparation: file.preparation_ref,
    hash: file.blob_hash,
    size_bytes: file.bytes,
    principal: ctx.principal,
    purpose: "document_file",
  };
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
  if (action === "archive" && parseActor(ctx.actor)?.kind === "machine") {
    const compensable = revertArchiveRejected(tx, current.value);
    if (compensable !== undefined) return compensable;
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

// 저장 결과의 경고는 준비 결과의 validation 진단 가운데 warning severity만 남긴다(R4).
// 진단이 blob 참조에 보류된 경우에는 응답 경고가 없다. 진단 위치는 형식을 유지한다.
function preparedWarnings(prepared: PreparedVersion): SaveResult["warnings"] {
  const { diagnostics } = prepared.validation;
  if (!Array.isArray(diagnostics)) return [];
  return diagnostics
    .filter((diagnostic) => diagnostic.severity === "warning")
    .map((diagnostic) => ({
      severity: diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.message,
      file: diagnostic.file,
      start_line: diagnostic.start_line,
      end_line: diagnostic.end_line,
      column: diagnostic.column,
    }));
}

function saveResult(
  document: Document,
  version: Version,
  seq: string,
  prepared: PreparedVersion,
): SaveResult {
  return {
    status: "saved",
    document: document.id,
    version: version.id,
    reference: referenceOf(document, version),
    event_seq: seq,
    warnings: preparedWarnings(prepared),
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
