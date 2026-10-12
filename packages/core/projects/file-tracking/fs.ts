// 준비 worker가 쓰는 실제 파일 port. 비동기 API만 쓴다. core module graph에는
// 들어오지 않는다(apps/worker가 import한다).
import { createHash } from "node:crypto";
import { err, ok, type Result } from "../../../base/mod.ts";
import type { FileIdentity, ObservationFact } from "./observation.ts";
import type {
  ScanEntry,
  ScanPort,
  StableReadPort,
  WatchPort,
  WatchSignal,
} from "./work.ts";

function join(root: string, directory: string): string {
  return directory === "" ? root : `${root}/${directory}`;
}

async function realOf(path: string): Promise<string | undefined> {
  try {
    return await Deno.realPath(path);
  } catch {
    return undefined;
  }
}

export function fileScanPort(): ScanPort {
  return {
    async list(root, directory) {
      const path = join(root, directory);
      const entries: ScanEntry[] = [];
      try {
        for await (const entry of Deno.readDir(path)) {
          if (entry.isSymlink) {
            const link = `${path}/${entry.name}`;
            const real = await realOf(link);
            let targetKind: "file" | "directory" = "file";
            if (real !== undefined) {
              try {
                const info = await Deno.stat(real);
                if (info.isDirectory) targetKind = "directory";
              } catch {
                targetKind = "file";
              }
            }
            entries.push({
              name: entry.name,
              kind: "symlink",
              realPath: real,
              targetKind,
            });
            continue;
          }
          entries.push({
            name: entry.name,
            kind: entry.isDirectory
              ? "directory"
              : entry.isFile
              ? "file"
              : "other",
          });
        }
      } catch {
        return err({
          code: "unavailable",
          message: "directory cannot be listed",
        });
      }
      return ok(entries);
    },
    async gitignore(root, directory) {
      const path = `${join(root, directory)}/.gitignore`;
      try {
        const info = await Deno.lstat(path);
        if (info.isSymlink) {
          const real = await realOf(path);
          if (real === undefined || !real.startsWith(`${root}/`)) {
            return ok(null);
          }
        }
        return ok(await Deno.readTextFile(path));
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) return ok(null);
        return err({
          code: "unavailable",
          message: "gitignore cannot be read",
        });
      }
    },
  };
}

async function identityOf(path: string): Promise<Result<FileIdentity>> {
  try {
    const [real, info] = await Promise.all([
      Deno.realPath(path),
      Deno.stat(path),
    ]);
    const mtime = info.mtime;
    if (mtime === null) {
      return err({ code: "unavailable", message: "file has no mtime" });
    }
    return ok({
      realPath: real,
      device: Number(info.dev),
      inode: Number(info.ino),
      size: info.size,
      mtimeMs: mtime.getTime(),
    });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return err({ code: "not_found", message: "file is missing" });
    }
    return err({ code: "unavailable", message: "file cannot be read" });
  }
}

function factOf(kind: string): ObservationFact {
  if (kind === "remove") return "deleted";
  if (kind === "rename") return "renamed";
  return "modified";
}

// Deno.watchFs 신호를 힌트로 바꾼다. watch가 끊기면 closed를 보내 전체 대조를 예약한다.
// 신호는 힌트일 뿐이라 이벤트 종류를 사실로만 옮기고 내용은 읽지 않는다.
export function fileWatchPort(): WatchPort {
  return {
    watch(root, signal) {
      return {
        async *[Symbol.asyncIterator](): AsyncIterator<WatchSignal> {
          let watcher: Deno.FsWatcher;
          try {
            watcher = Deno.watchFs(root, { recursive: true });
          } catch {
            yield { kind: "closed" };
            return;
          }
          // 관측 loop가 멈추면 watcher를 닫는다. 기다리던 for-await가 끝난다.
          const close = () => {
            try {
              watcher.close();
            } catch {
              // 이미 닫힌 watcher.
            }
          };
          if (signal?.aborted) close();
          else signal?.addEventListener("abort", close, { once: true });
          try {
            for await (const event of watcher) {
              for (const path of event.paths) {
                if (!path.startsWith(`${root}/`)) continue;
                yield {
                  kind: "changed",
                  canonical: path,
                  relative: path.slice(root.length + 1),
                  fact: factOf(event.kind),
                };
              }
            }
          } catch {
            yield { kind: "overflow" };
          } finally {
            signal?.removeEventListener("abort", close);
            close();
          }
          yield { kind: "closed" };
        },
      };
    },
  };
}

export function fileReadPort(): StableReadPort {
  return {
    async open(path) {
      const before = await identityOf(path);
      if (!before.ok) return before;
      return ok({
        before: before.value,
        async read() {
          try {
            const file = await Deno.open(path, { read: true });
            try {
              const chunks: Uint8Array[] = [];
              const buffer = new Uint8Array(64 * 1024);
              while (true) {
                const read = await file.read(buffer);
                if (read === null) break;
                chunks.push(buffer.slice(0, read));
              }
              const total = chunks.reduce(
                (sum, chunk) => sum + chunk.length,
                0,
              );
              const bytes = new Uint8Array(total);
              let offset = 0;
              for (const chunk of chunks) {
                bytes.set(chunk, offset);
                offset += chunk.length;
              }
              return ok(bytes);
            } finally {
              file.close();
            }
          } catch {
            return err({ code: "unavailable", message: "file cannot be read" });
          }
        },
      });
    },
    identity: identityOf,
    hash(bytes) {
      return Promise.resolve(createHash("sha256").update(bytes).digest("hex"));
    },
  };
}

// 등록된 지침 파일을 읽는 port(file-tracking#R19). 일반 읽기에 더해 열기 전에 exact 경로가
// symlink가 아니고(상위 폴더 symlink 포함, canonical과 같아야 한다) 일반 파일이며 data root와 같은
// 소유자인지 본다. data root의 소유자는 시작할 때 platform이 이미 확인했다. 검사에 걸리면
// invalid_input이고 없는 파일은 not_found다.
export function instructionReadPort(dataRoot: string): StableReadPort {
  const base = fileReadPort();
  let owner: Promise<number | null> | undefined;
  const ownerOf = () =>
    owner ??= Deno.stat(dataRoot).then((info) => info.uid, () => null);
  const refused = (message: string) =>
    err({ code: "invalid_input" as const, message });
  return {
    ...base,
    async open(path) {
      let info: Deno.FileInfo;
      try {
        info = await Deno.lstat(path);
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
          return err({ code: "not_found", message: "file is missing" });
        }
        return err({ code: "unavailable", message: "file cannot be read" });
      }
      if (info.isSymlink) return refused("instruction file is a symlink");
      if (!info.isFile) return refused("instruction file is not a file");
      if ((await realOf(path)) !== path) {
        return refused("instruction file path is not canonical");
      }
      const uid = await ownerOf();
      if (uid !== null && info.uid !== null && info.uid !== uid) {
        return refused("instruction file owner differs");
      }
      return await base.open(path);
    },
  };
}
