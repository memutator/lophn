// FilesPort를 main의 core session으로 만든다. route 이름과 입력만 여기 있고 token·port는
// session closure에 있다. 응답은 session이 contract route schema로 이미 검사했다.
import type {
  DocumentRead,
  FileOperationResult,
  FilesPort,
  FileStatus,
  PortResult,
  PreparedBlob,
  ValidatePage,
} from "./file-adapter.ts";
import type {
  FixedRead,
  PreparedRestore,
  RestorePort,
  RestoreSaved,
} from "./restore.ts";
import type { CreatePort, PreparedNew } from "./create.ts";
import type { InstructionsPort, PlacelessDocument } from "./instructions.ts";

type Called<T = unknown> = { ok: true; value: T } | {
  ok: false;
  error: { code: string; message: string; details?: Record<string, unknown> };
};

/** desktop/core/client.ts의 CoreSession 중 이 port가 쓰는 것. */
export interface CoreCalls {
  internal(
    kind: string,
    resource: string,
    method: string,
    body: unknown,
  ): Promise<Called>;
  readStream(
    resource: string,
    method: string,
    body: unknown,
    limit: number,
  ): Promise<Called<Uint8Array>>;
  upload(
    resource: string,
    method: string,
    input: unknown,
    bytes: Uint8Array,
  ): Promise<Called>;
}

function as<T>(result: Called): PortResult<T> {
  return result.ok ? { ok: true, value: result.value as T } : result;
}

export function coreFilesPort(core: CoreCalls): FilesPort {
  return {
    async document(id) {
      return as<DocumentRead>(
        await core.internal("read", "documents", "get", { document: id }),
      );
    },
    read: (target, limit) =>
      core.readStream("files", "read", { target }, limit),
    versionFile: (version, path, limit) =>
      core.readStream("documents", "file", { version, path }, limit),
    async watch(target, cursor) {
      const result = await core.internal("worker", "files", "watch", {
        target,
        ...(cursor === undefined ? {} : { cursor }),
      });
      if (!result.ok) return result;
      const value = result.value as {
        status: FileStatus;
        next_cursor?: string | null;
      };
      return {
        ok: true,
        value: { status: value.status, next_cursor: value.next_cursor ?? "" },
      };
    },
    async upload(bytes, hash) {
      return as<PreparedBlob>(
        await core.upload(
          "documents",
          "upload",
          { blob_hash: hash, bytes: bytes.byteLength },
          bytes,
        ),
      );
    },
    async write(request) {
      return as<FileOperationResult>(
        await core.internal("worker", "files", "write", request),
      );
    },
    async validate(input) {
      return as<ValidatePage>(
        await core.internal("worker", "formats", "validate", input),
      );
    },
  };
}

/** [Instructions] 통로. 지침 자리(project 폴더)와 원본 연결 문서를 읽고 첫 저장을 쓴다. */
export function coreInstructionsPort(core: CoreCalls): InstructionsPort {
  const files = coreFilesPort(core);
  return {
    upload: files.upload,
    write: files.write,
    async project(id) {
      const result = await core.internal("read", "projects", "get", {
        project: id,
      });
      if (!result.ok) return result;
      const value = result.value as {
        project: { status: string; folders: { path: string }[] };
      };
      return {
        ok: true,
        value: {
          status: value.project.status,
          folders: value.project.folders,
        },
      };
    },
    // 지침 문서는 place가 없다. 목록 응답에는 원본(file_source)이 없어 문서마다 읽는다.
    async placeless() {
      const found: PlacelessDocument[] = [];
      let cursor: string | undefined;
      do {
        const page = await core.internal("read", "documents", "list", {
          place: null,
          ...(cursor === undefined ? {} : { cursor }),
        });
        if (!page.ok) return page;
        const value = page.value as {
          documents: { document: { id: string } }[];
          next_cursor?: string | null;
        };
        for (const entry of value.documents) {
          const read = await files.document(entry.document.id);
          if (!read.ok) return read;
          found.push({
            id: read.value.document.id,
            latest_version: read.value.document.latest_version,
            file_source: read.value.document.file_source,
          });
        }
        cursor = value.next_cursor ?? undefined;
      } while (cursor !== undefined);
      return { ok: true, value: found };
    },
  };
}

/** 새 문서 첫 판 통로. 업로드·준비·저장 명령을 같은 core session으로 부른다. */
export function coreCreatePort(core: CoreCalls): CreatePort {
  const files = coreFilesPort(core);
  return {
    upload: files.upload,
    async prepare(input) {
      return as<PreparedNew>(
        await core.internal("worker", "documents", "prepare", input),
      );
    },
    async save(request) {
      // 성공 응답은 route output(SaveResult) 그대로다(platform/api#R3).
      return as<{ version: string }>(
        await core.internal("command", "documents", "save", request),
      );
    },
    async latest(document) {
      const result = await files.document(document);
      return result.ok
        ? { ok: true, value: { version: result.value.document.latest_version } }
        : result;
    },
  };
}

/** 복원 통로. 판 읽기·준비·복원 명령을 같은 core session으로 부른다. */
export function coreRestorePort(core: CoreCalls): RestorePort {
  const files = coreFilesPort(core);
  return {
    read: files.read,
    versionFile: files.versionFile,
    upload: files.upload,
    write: files.write,
    watch: files.watch,
    async fixed(document, version) {
      return as<FixedRead>(
        await core.internal("read", "documents", "get", {
          document,
          ...(version === undefined ? {} : { version }),
        }),
      );
    },
    async project(id) {
      const result = await core.internal("read", "projects", "get", {
        project: id,
      });
      if (!result.ok) return result;
      const value = result.value as { project: { revision: string } };
      return { ok: true, value: { revision: value.project.revision } };
    },
    async prepare(input) {
      return as<PreparedRestore>(
        await core.internal("worker", "documents", "prepare", input),
      );
    },
    async restore(request) {
      // 성공 응답은 route output(SaveResult) 그대로다(platform/api#R3).
      return as<RestoreSaved>(
        await core.internal("command", "documents", "restore", request),
      );
    },
  };
}
