// 사람 파일 쓰기의 실제 OS 호출. 준비 worker가 쓴다(apps/worker가 import한다). core의
// module graph에는 들어오지 않는다. 비동기 API만 쓰고, 오류는 FileOpFault 종류로만 줄여
// 던진다(OS 문구·경로·본문은 남기지 않는다).
import {
  type FaultKind,
  FileOpFault,
  type FileOps,
  type FileStat,
  type TempFile,
} from "../file-ops.ts";

const READ_CHUNK = 64 * 1024;

// Deno 오류를 종류로 줄인다. errno 이름은 OS가 준 code만 본다.
export function faultOf(error: unknown): FileOpFault {
  if (error instanceof FileOpFault) return error;
  if (error instanceof Deno.errors.AlreadyExists) {
    return new FileOpFault("exists", "EEXIST");
  }
  if (error instanceof Deno.errors.NotFound) {
    return new FileOpFault("missing", "ENOENT");
  }
  if (
    error instanceof Deno.errors.PermissionDenied ||
    error instanceof Deno.errors.NotCapable
  ) {
    return new FileOpFault("denied", "EACCES");
  }
  const code = (error as { code?: unknown } | null)?.code;
  const named = typeof code === "string" ? code : undefined;
  const kind: FaultKind = named === "EROFS"
    ? "read_only"
    : named === "ENOSPC" || named === "EDQUOT"
    ? "no_space"
    : named === "EACCES" || named === "EPERM"
    ? "denied"
    : named === "ENOTSUP" || named === "EOPNOTSUPP" || named === "EXDEV" ||
        named === "ENOSYS"
    ? "unsupported"
    : "other";
  return new FileOpFault(kind, named);
}

function statOf(info: Deno.FileInfo): FileStat {
  return {
    kind: info.isSymlink
      ? "symlink"
      : info.isFile
      ? "file"
      : info.isDirectory
      ? "directory"
      : "other",
    device: Number(info.dev),
    inode: Number(info.ino),
    size: info.size,
    mtimeMs: info.mtime?.getTime() ?? 0,
    mode: info.mode,
  };
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw faultOf(error);
  }
}

export function denoFileOps(): FileOps {
  return {
    async lstat(path) {
      try {
        return statOf(await Deno.lstat(path));
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) return undefined;
        throw faultOf(error);
      }
    },
    async realPath(path) {
      try {
        return await Deno.realPath(path);
      } catch {
        return undefined;
      }
    },
    async *read(path) {
      const file = await guarded(() => Deno.open(path, { read: true }));
      try {
        const buffer = new Uint8Array(READ_CHUNK);
        while (true) {
          const read = await guarded(() => file.read(buffer));
          if (read === null) return;
          yield buffer.slice(0, read);
        }
      } finally {
        file.close();
      }
    },
    async readRange(path, offset, length) {
      const file = await guarded(() => Deno.open(path, { read: true }));
      try {
        await guarded(() => file.seek(offset, Deno.SeekMode.Start));
        const out = new Uint8Array(length);
        let filled = 0;
        while (filled < length) {
          const read = await guarded(() => file.read(out.subarray(filled)));
          if (read === null) break;
          filled += read;
        }
        return out.subarray(0, filled);
      } finally {
        file.close();
      }
    },
    async createTemp(path, mode): Promise<TempFile> {
      const file = await guarded(() =>
        Deno.open(path, {
          write: true,
          createNew: true,
          mode: mode ?? 0o666,
        })
      );
      let closed = false;
      return {
        path,
        async write(chunk) {
          await guarded(async () => {
            let written = 0;
            while (written < chunk.length) {
              written += await file.write(chunk.subarray(written));
            }
          });
        },
        sync: () => guarded(() => file.sync()),
        close() {
          if (!closed) {
            closed = true;
            file.close();
          }
          return Promise.resolve();
        },
      };
    },
    replace: (temp, target) => guarded(() => Deno.rename(temp, target)),
    // hard link는 대상이 있으면 실패하는 no-replace 설치다. 지원하지 않는 파일 시스템은
    // 실패하고, 복사로 바꾸지 않는다.
    install: (temp, target) => guarded(() => Deno.link(temp, target)),
    remove: (path) => guarded(() => Deno.remove(path)),
    async makeDirectory(path) {
      try {
        await Deno.mkdir(path, { mode: 0o700 });
      } catch (error) {
        if (error instanceof Deno.errors.AlreadyExists) return;
        throw faultOf(error);
      }
    },
    async syncDirectory(path) {
      try {
        const directory = await Deno.open(path, { read: true });
        try {
          await directory.sync();
        } finally {
          directory.close();
        }
      } catch {
        // 디렉터리 sync를 못 하는 OS·파일 시스템이 있다. 파일은 이미 sync했다.
      }
    },
  };
}
