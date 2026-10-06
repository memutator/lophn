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
    async status(target) {
      const result = await core.internal("read", "files", "status", {
        target,
      });
      return result.ok
        ? {
          ok: true,
          value: (result.value as { status: FileStatus }).status,
        }
        : result;
    },
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
