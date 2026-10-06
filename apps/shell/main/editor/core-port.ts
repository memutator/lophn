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
import type { PlacedResult, PlacePort } from "./place.ts";

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

/** 파일로 두기 통로. 고정 판 읽기와 파일 쓰기만 부른다. */
export function corePlacePort(core: CoreCalls): PlacePort {
  return {
    async fixed(document, version) {
      return as<FixedRead>(
        await core.internal("read", "documents", "get", {
          document,
          ...(version === undefined ? {} : { version }),
        }),
      );
    },
    async write(request) {
      return as<PlacedResult>(
        await core.internal("worker", "files", "write", request),
      );
    },
  };
}
