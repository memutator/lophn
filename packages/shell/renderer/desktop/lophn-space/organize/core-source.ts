// OrganizeSource를 main의 core 통로로 만든다. 읽기·command는 renderer core 통로로, 파일로 두기는
// main의 편집 통로(`lophnEditor.place`)로, 파일에서 빼기는 보호 창(`lophnShell.openConfirmation`)
// 으로 간다. 응답은 main의 contract client가 route output schema로 이미 검사했다. 아래 모양은 그
// schema(projects.list·update·archive, documents.list·get·rename·move·history·export)에서 이
// 화면이 읽는 field만 옮긴 것이다.
import type { EditorFilesApi } from "../../../../ipc/editor.ts";
import type { CoreSource } from "../../connection/connection.ts";
import type { PlaceRef, SourceResult } from "../source.ts";
import type {
  DocumentDetail,
  ExportResult,
  OrganizeSource,
  PlacedDocument,
  ProjectRow,
  VersionRow,
} from "./source.ts";

interface ProjectValue {
  id: string;
  name: string;
  title: string;
  purpose: string;
  revision: string;
  status: "active" | "archived";
  folders?: { path: string }[];
  tracking?: { enabled: boolean };
}

interface DocumentValue {
  id: string;
  title: string;
  place: PlaceRef | null;
  name: string | null;
  latest_version: string;
  revision: string;
  status: "active" | "archived";
  file_source?:
    | { kind: "project_file"; project: string; path: string }
    | { kind: "instruction_file" }
    | null;
}

interface VersionValue {
  id: string;
  number: number;
  files:
    | { path: string; media_type: string; bytes: number }[]
    | { hash: string };
}

/** 목록을 끝까지 모을 때 page 상한. 넘으면 모은 것까지만 보인다. */
const PAGE_LIMIT = 20;

// 보호 창의 부모. main은 이 값이 아니라 IPC를 보낸 창을 부모로 쓴다.
const PARENT_WINDOW = "requesting-window";

async function call<T>(
  core: CoreSource,
  kind: "read" | "command" | "worker",
  resource: string,
  method: string,
  body: unknown,
): Promise<SourceResult<T>> {
  const reply = await core.call({ kind, resource, method, body });
  if (!reply.ok) return { ok: false, code: reply.error?.code ?? "internal" };
  return { ok: true, value: reply.value as T };
}

function command<T>(
  core: CoreSource,
  resource: string,
  method: string,
  input: unknown,
  revision: string,
): Promise<SourceResult<T>> {
  return call<T>(core, "command", resource, method, {
    input,
    idempotency_key: `${resource}-${method}-${crypto.randomUUID()}`,
    compare: { base_revision: revision },
    prepared: [],
  });
}

function projectOf(value: ProjectValue): ProjectRow {
  return {
    id: value.id,
    name: value.name,
    title: value.title,
    purpose: value.purpose,
    revision: value.revision,
    archived: value.status === "archived",
    tracking: value.tracking?.enabled === true,
    folders: (value.folders ?? []).map((folder) => folder.path),
  };
}

function detailOf(
  document: DocumentValue,
  version: VersionValue | null,
): DocumentDetail {
  const source = document.file_source;
  const files = version?.files;
  return {
    id: document.id,
    title: document.title,
    name: document.name,
    place: document.place === null
      ? null
      : { kind: document.place.kind, id: document.place.id },
    revision: document.revision,
    latestVersion: document.latest_version,
    archived: document.status === "archived",
    file: source?.kind === "project_file"
      ? { project: source.project, path: source.path }
      : null,
    singleFile: Array.isArray(files) && files.length === 1
      ? files[0]!.path
      : null,
  };
}

/** 파일 지우기 결정 창 열기. contracts shell confirmation의 owner_decision intent다. */
export type OpenConfirmation = (intent: {
  request: {
    kind: "owner_decision";
    concern: string;
    decision: string;
    targets: string[];
  };
  parentWindow: string;
}) => Promise<unknown>;

/** preload의 보호 창 열기를 찾는다. 이 창에 없으면 undefined다. */
export function windowConfirmation(): OpenConfirmation | undefined {
  const shell = (globalThis as {
    lophnShell?: { openConfirmation?: OpenConfirmation };
  }).lophnShell;
  return typeof shell?.openConfirmation === "function"
    ? (intent) => shell.openConfirmation!(intent)
    : undefined;
}

/** preload의 편집 통로 중 파일로 두기를 찾는다. 이 창에 없으면 undefined다. */
export function windowPlacement(): Pick<EditorFilesApi, "place"> | undefined {
  const editor = (globalThis as { lophnEditor?: EditorFilesApi }).lophnEditor;
  return typeof editor?.place === "function" ? editor : undefined;
}

export function coreOrganizeSource(
  core: CoreSource,
  files: Pick<EditorFilesApi, "place"> | undefined = windowPlacement(),
  openConfirmation: OpenConfirmation | undefined = windowConfirmation(),
): OrganizeSource {
  async function project(id: string): Promise<SourceResult<ProjectRow>> {
    const read = await call<{ project: ProjectValue }>(
      core,
      "read",
      "projects",
      "get",
      { project: id },
    );
    return read.ok ? { ok: true, value: projectOf(read.value.project) } : read;
  }

  async function detail(id: string): Promise<SourceResult<DocumentDetail>> {
    const read = await call<{ document: DocumentValue; version: VersionValue }>(
      core,
      "read",
      "documents",
      "get",
      { document: id },
    );
    return read.ok
      ? { ok: true, value: detailOf(read.value.document, read.value.version) }
      : read;
  }

  return {
    async projects() {
      const rows: ProjectRow[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < PAGE_LIMIT; page += 1) {
        const read: SourceResult<
          { projects: ProjectValue[]; next_cursor: string | null }
        > = await call(core, "read", "projects", "list", {
          ...(cursor === undefined ? {} : { cursor }),
        });
        if (!read.ok) return read;
        rows.push(...read.value.projects.map(projectOf));
        if (read.value.next_cursor === null) break;
        cursor = read.value.next_cursor;
      }
      return { ok: true, value: rows };
    },

    async updateProject(row, change) {
      const result = await command<ProjectValue>(
        core,
        "projects",
        "update",
        { project: row.id, ...change },
        row.revision,
      );
      return result.ok ? await project(row.id) : result;
    },

    async setProjectArchived(row, archived) {
      const result = await command<ProjectValue>(
        core,
        "projects",
        archived ? "archive" : "unarchive",
        { project: row.id },
        row.revision,
      );
      return result.ok ? await project(row.id) : result;
    },

    async placeDocuments(place) {
      const rows: PlacedDocument[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < PAGE_LIMIT; page += 1) {
        const read: SourceResult<
          {
            documents: { document: DocumentValue }[];
            next_cursor: string | null;
          }
        > = await call(core, "read", "documents", "list", {
          place,
          ...(cursor === undefined ? {} : { cursor }),
        });
        if (!read.ok) return read;
        for (const entry of read.value.documents) {
          rows.push({
            id: entry.document.id,
            title: entry.document.title,
            name: entry.document.name,
            latestVersion: entry.document.latest_version,
            archived: entry.document.status === "archived",
          });
        }
        if (read.value.next_cursor === null) break;
        cursor = read.value.next_cursor;
      }
      return { ok: true, value: rows };
    },

    document: detail,

    async renameDocument(document, name) {
      const result = await command<DocumentValue>(
        core,
        "documents",
        "rename",
        { document: document.id, name },
        document.revision,
      );
      return result.ok ? await detail(document.id) : result;
    },

    async moveDocument(document, place, name) {
      const result = await command<DocumentValue>(
        core,
        "documents",
        "move",
        { document: document.id, place, name },
        document.revision,
      );
      return result.ok ? await detail(document.id) : result;
    },

    async versions(document) {
      const rows: VersionRow[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < PAGE_LIMIT; page += 1) {
        const read: SourceResult<
          { versions: VersionValue[]; next_cursor: string | null }
        > = await call(core, "read", "documents", "history", {
          document,
          ...(cursor === undefined ? {} : { cursor }),
        });
        if (!read.ok) return read;
        rows.push(
          ...read.value.versions.map((item) => ({
            id: item.id,
            number: item.number,
          })),
        );
        if (read.value.next_cursor === null) break;
        cursor = read.value.next_cursor;
      }
      rows.sort((left, right) => right.number - left.number);
      return { ok: true, value: rows };
    },

    async exportDocuments(place, picks, format) {
      const read = await call<{
        format: ExportResult["format"];
        documents: { document: DocumentValue; version: VersionValue }[];
      }>(core, "worker", "documents", "export", {
        place,
        documents: picks.map((pick) => ({
          document: pick.document,
          version: pick.version,
        })),
        format,
      });
      if (!read.ok) return read;
      return {
        ok: true,
        value: {
          format: read.value.format,
          documents: read.value.documents.map((item) => ({
            document: item.document.id,
            title: item.document.title,
            version: item.version.id,
            number: item.version.number,
            files: Array.isArray(item.version.files)
              ? item.version.files.map((file) => ({
                path: file.path,
                mediaType: file.media_type,
                bytes: file.bytes,
              }))
              : null,
          })),
        },
      };
    },

    async placeFile(document, projectId, path) {
      if (files === undefined) return { ok: false, code: "unavailable" };
      const reply = await files.place({
        document: document.id,
        version: document.latestVersion,
        project: projectId,
        path,
        request_key: `place-${crypto.randomUUID()}`,
      });
      if (!reply.ok) return { ok: false, code: reply.code };
      const value = reply.value;
      return {
        ok: true,
        value: { file: value.file, path: value.path, steps: value.steps },
      };
    },

    async removeFile(document) {
      if (openConfirmation === undefined) {
        return { ok: false, code: "unavailable" };
      }
      try {
        // 지우기는 사람의 결정이다. 대상 문서만 보내고 main이 정본(원본 파일·디스크 hash)을
        // 따로 읽어 `files.delete`+`unlink` 요청을 고정한다.
        const opened = await openConfirmation({
          request: {
            kind: "owner_decision",
            concern: "documents/file-tracking",
            decision: "delete_file",
            targets: [document.id],
          },
          parentWindow: PARENT_WINDOW,
        }) as { windowId?: string; code?: string };
        return typeof opened?.windowId === "string"
          ? { ok: true, value: { kind: "review" } }
          : { ok: false, code: opened?.code ?? "unavailable" };
      } catch {
        return { ok: false, code: "unavailable" };
      }
    },
  };
}
