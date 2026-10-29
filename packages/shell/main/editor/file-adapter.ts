// 편집기·파일 tree의 파일 adapter. 경로 하나가 파일 하나이고, shell main이 디스크를 직접 읽고
// 쓴다(core를 거치지 않는다). project 폴더 안/밖 판정은 없다 — 사람이 연 파일은 어디든 된다.
// 거절하는 것은 데이터 root의 `secrets.json`뿐이고, 폴더 목록(list)만 연결 폴더 안으로 좁힌다.
// 충돌은 디스크 내용 hash 비교로만 안다(쓰기는 읽을 때 받은 hash를 기대값으로 보낸다).
import { createHash, randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

import {
  FILE_TEXT_MAX_BYTES,
  FILE_VIEW_MAX_BYTES,
  type FileBytes,
  type FileChanged,
  type FileEntry,
  type FileFailure,
  type FileList,
  type FileReply,
  type FileText,
  type FileWrite,
  type FileWritten,
} from "../../ipc/files.ts";

type Empty = Record<PropertyKey, never>;

/** 쓰기 때 갈아 끼울 수 있는 fs 동작. 테스트가 실패를 주입한다. */
interface FileSystemOps {
  /** 임시 파일을 만들어 내용을 쓰고 디스크에 닿게 한다. */
  writeTemp(path: string, bytes: Uint8Array, mode: number): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

export interface FileAdapterOptions {
  /** 데이터 root. 그 바로 아래 `secrets.json`은 거절한다. */
  dataRoot: string;
  /** 연결된(활성 project) 폴더들. core를 못 읽으면 null이다. */
  folders: () => Promise<readonly string[] | null>;
  /** 밖에서 바뀐 파일을 그 창에 알린다. */
  notify: (owner: number, change: FileChanged) => void;
  /**
   * OS 휴지통으로 보낸다(Electron `shell.trashItem`). 못 보내면 던진다. 지우기는 이것만 쓰고
   * 영구 삭제로 되돌아가지 않는다.
   */
  trash: (path: string) => Promise<void>;
  /** OS 파일 관리자에서 그 경로를 보인다(Electron `shell.showItemInFolder`). */
  reveal: (path: string) => void;
  fs?: Partial<FileSystemOps>;
  pollMs?: number;
}

export interface FileAdapter {
  list(path: string): Promise<FileReply<FileList>>;
  read(path: string): Promise<FileReply<FileText>>;
  readBytes(path: string): Promise<FileReply<FileBytes>>;
  write(owner: number, input: FileWrite): Promise<FileReply<FileWritten>>;
  create(input: {
    path: string;
    kind: "file" | "folder";
  }): Promise<FileReply<Empty>>;
  rename(input: { from: string; to: string }): Promise<FileReply<Empty>>;
  delete(input: { path: string }): Promise<FileReply<Empty>>;
  reveal(input: { path: string }): Promise<FileReply<Empty>>;
  /** 이 창이 보는 경로 전체를 통째로 바꾼다. 빈 목록이면 끈다. */
  watch(owner: number, paths: readonly string[]): Promise<FileReply<Empty>>;
  /** 창이 사라지면 그 창의 감시를 놓는다. */
  dropOwner(owner: number): void;
}

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
};

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const realOps: FileSystemOps = {
  async writeTemp(path, bytes, mode) {
    const handle = await open(path, "wx", mode);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
  rename,
};

function failureOf(error: unknown): FileFailure {
  switch ((error as NodeJS.ErrnoException)?.code) {
    case "ENOENT":
      return "not_found";
    case "EACCES":
    case "EPERM":
      return "forbidden";
    case "EISDIR":
    case "ENOTDIR":
      return "unsupported";
    case "EEXIST":
    case "ENOTEMPTY":
      return "conflict";
    default:
      return "unavailable";
  }
}

function fail<T>(code: FileFailure): FileReply<T> {
  return { ok: false, code };
}

const decoder = new TextDecoder("utf-8", { fatal: true });

function decode(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}

/** 파일이 없으면 null이다. 있는데 읽을 수 없으면 던진다. */
async function readOrNull(path: string): Promise<Uint8Array | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** symlink를 따라간 실제 경로. 없는 끝 조각은 있는 위쪽 폴더의 실제 경로에 붙인다. */
async function realPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) return path;
    return join(await realPath(parent), basename(path));
  }
}

function inside(path: string, folder: string): boolean {
  return (
    path === folder ||
    path.startsWith(folder.endsWith(sep) ? folder : folder + sep)
  );
}

export function createFileAdapter(options: FileAdapterOptions): FileAdapter {
  const ops: FileSystemOps = { ...realOps, ...options.fs };
  const secrets = join(options.dataRoot, "secrets.json");
  // 같은 경로의 쓰기는 한 줄로 선다. 기대 hash 비교와 교체 사이에 다른 쓰기가 끼지 않게 한다.
  const queues = new Map<string, Promise<unknown>>();
  // 같은 순간의 list들은 연결 폴더 읽기 하나를 나눠 쓴다. Explorer는 펼친 폴더마다 list를 한꺼번에 보내는데
  // list마다 core를 부르면 core의 principal당 HTTP 동시 한도(16)를 넘어 list와 renderer의 core 호출이 unavailable로 진다.
  let foldersRead: Promise<readonly string[] | null> | null = null;
  const connectedFolders = () => {
    foldersRead ??= options.folders().finally(() => {
      foldersRead = null;
    });
    return foldersRead;
  };

  /** 정규화한 경로. 절대 경로가 아니거나 secret 파일이면 거절이다. */
  async function accept(
    path: string,
  ): Promise<{ ok: true; path: string } | { ok: false; code: FileFailure }> {
    if (!isAbsolute(path)) return { ok: false, code: "invalid_input" };
    const clean = resolve(path);
    try {
      if ((await realPath(clean)) === (await realPath(secrets))) {
        return { ok: false, code: "forbidden" };
      }
    } catch {
      return { ok: false, code: "unavailable" };
    }
    return { ok: true, path: clean };
  }

  async function guarded<T>(
    path: string,
    run: (clean: string) => Promise<FileReply<T>>,
  ): Promise<FileReply<T>> {
    const accepted = await accept(path);
    if (!accepted.ok) return fail(accepted.code);
    try {
      return await run(accepted.path);
    } catch (error) {
      return fail(failureOf(error));
    }
  }

  function serial<T>(path: string, run: () => Promise<T>): Promise<T> {
    const result = (queues.get(path) ?? Promise.resolve()).then(run, run);
    const tail = result.catch(() => {});
    queues.set(path, tail);
    void tail.then(() => {
      if (queues.get(path) === tail) queues.delete(path);
    });
    return result;
  }

  // 감시는 폴링이다. 창마다 경로의 마지막 stat과 hash를 기억하고, stat이 바뀐 것만 다시 읽어
  // hash를 비교한다(fs.watch는 편집기·git이 임시 파일로 바꿔치는 쓰기를 놓친다).
  type Seen = { stamp: string; hash: string | null };
  const watched = new Map<number, Map<string, Seen>>();
  let timer: ReturnType<typeof setInterval> | null = null;

  async function stamp(path: string): Promise<string> {
    try {
      const info = await stat(path);
      return `${info.mtimeMs}:${info.size}`;
    } catch {
      return "";
    }
  }

  async function look(path: string): Promise<Seen> {
    const before = await stamp(path);
    try {
      return { stamp: before, hash: sha256(await readFile(path)) };
    } catch {
      return { stamp: before, hash: null };
    }
  }

  async function poll() {
    for (const [owner, seen] of watched) {
      for (const [path, before] of seen) {
        if ((await stamp(path)) === before.stamp) continue;
        const now = await look(path);
        // 기다리는 사이 watch 목록이 바뀌었으면 이 판정은 버린다.
        if (seen.get(path) !== before) continue;
        seen.set(path, now);
        if (now.hash !== before.hash) {
          options.notify(owner, { path, hash: now.hash });
        }
      }
    }
  }

  function arm() {
    const any = watched.size > 0;
    if (any && timer === null) {
      timer = setInterval(() => void poll(), options.pollMs ?? 1000);
    } else if (!any && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  return {
    async list(path) {
      return await guarded(path, async (clean) => {
        const folders = await connectedFolders();
        if (folders === null) return fail("unavailable");
        // 실제 경로로 비교해 연결 폴더 밖으로 나가는 symlink를 거절한다.
        const real = await realPath(clean);
        let allowed = false;
        for (const folder of folders) {
          if (inside(real, await realPath(resolve(folder)))) {
            allowed = true;
            break;
          }
        }
        if (!allowed) return fail("forbidden");
        const entries: FileEntry[] = [];
        for (const item of await readdir(clean, { withFileTypes: true })) {
          let kind: FileEntry["kind"] | null = null;
          if (item.isDirectory()) kind = "folder";
          else if (item.isFile()) kind = "file";
          else if (item.isSymbolicLink()) {
            try {
              const target = await stat(join(clean, item.name));
              kind = target.isDirectory()
                ? "folder"
                : target.isFile()
                  ? "file"
                  : null;
            } catch {
              /* 끊긴 link는 보이지 않는다 */
            }
          }
          if (kind !== null) entries.push({ name: item.name, kind });
        }
        // 폴더 먼저, 그다음 이름순.
        entries.sort((a, b) =>
          a.kind !== b.kind
            ? a.kind === "folder"
              ? -1
              : 1
            : a.name < b.name
              ? -1
              : a.name > b.name
                ? 1
                : 0,
        );
        return { ok: true, value: { entries } };
      });
    },

    async read(path) {
      return await guarded(path, async (clean) => {
        const info = await stat(clean);
        if (!info.isFile()) return fail("unsupported");
        if (info.size > FILE_TEXT_MAX_BYTES) return fail("too_large");
        const bytes = await readFile(clean);
        const text = decode(bytes);
        if (text === null) return fail("unsupported");
        return {
          ok: true,
          value: {
            text,
            hash: sha256(bytes),
            modified_at: Math.floor(info.mtimeMs),
          },
        };
      });
    },

    async readBytes(path) {
      return await guarded(path, async (clean) => {
        const dot = clean.lastIndexOf(".");
        const type =
          dot < 0 ? undefined : CONTENT_TYPES[clean.slice(dot).toLowerCase()];
        if (type === undefined) return fail("unsupported");
        const info = await stat(clean);
        if (!info.isFile()) return fail("unsupported");
        if (info.size > FILE_VIEW_MAX_BYTES) return fail("too_large");
        return {
          ok: true,
          value: {
            bytes: new Uint8Array(await readFile(clean)),
            content_type: type,
            modified_at: Math.floor(info.mtimeMs),
          },
        };
      });
    },

    async write(owner, input) {
      return await guarded(input.path, (clean) =>
        serial(clean, async () => {
          const bytes = new TextEncoder().encode(input.text);
          if (bytes.byteLength > FILE_TEXT_MAX_BYTES) return fail("too_large");
          // 기대 hash가 디스크 내용과 같을 때만 쓴다. 없는 파일은 기대 hash가 null일 때만 만든다.
          const current = await readOrNull(clean);
          if ((current === null ? null : sha256(current)) !== input.base_hash) {
            return fail("conflict");
          }
          const mode =
            current === null ? 0o644 : (await stat(clean)).mode & 0o777;
          // 같은 폴더의 임시 파일에 쓰고 rename으로 바꾼다. 중간에 끊겨도 원본이 남는다.
          const temp = join(
            dirname(clean),
            `.${basename(clean)}.lophn-${randomBytes(6).toString("hex")}.tmp`,
          );
          try {
            await ops.writeTemp(temp, bytes, mode);
            await ops.rename(temp, clean);
          } catch (error) {
            await rm(temp, { force: true }).catch(() => {});
            return fail(failureOf(error));
          }
          // 이 창이 쓴 것은 밖에서 바뀐 것이 아니다.
          const own = watched.get(owner);
          if (own?.has(clean)) own.set(clean, await look(clean));
          return { ok: true, value: { hash: sha256(bytes) } };
        }),
      );
    },

    // 없을 때만 만든다. 파일은 `wx`로 열어 이미 있으면 EEXIST(conflict)이고, 폴더는 끝 조각을
    // recursive 없이 만든다. 위쪽 폴더만 recursive로 채운다.
    async create(input) {
      return await guarded(input.path, async (clean) => {
        await mkdir(dirname(clean), { recursive: true });
        if (input.kind === "folder") await mkdir(clean);
        else await (await open(clean, "wx", 0o644)).close();
        return { ok: true, value: {} };
      });
    },

    async rename(input) {
      const to = await accept(input.to);
      if (!to.ok) return fail(to.code);
      return await guarded(input.from, async (from) => {
        await lstat(from);
        if (from === to.path) return { ok: true, value: {} };
        // 폴더를 자기 안으로 옮길 수 없다.
        const realFrom = await realPath(from);
        if (inside(await realPath(to.path), realFrom)) {
          return fail("invalid_input");
        }
        // 대문자만 바꾸는 이름 바꾸기는 대소문자를 가리지 않는 디스크에서 자기 자신과 부딪힌다.
        const caseOnly =
          dirname(from) === dirname(to.path) &&
          basename(from).toLowerCase() === basename(to.path).toLowerCase();
        const taken = await lstat(to.path).then(
          () => true,
          () => false,
        );
        if (taken && !caseOnly) return fail("conflict");
        await ops.rename(from, to.path);
        return { ok: true, value: {} };
      });
    },

    // 휴지통으로만 보낸다. 휴지통을 못 쓰면 아무것도 지우지 않고 unavailable이다.
    async delete(input) {
      return await guarded(input.path, async (clean) => {
        await lstat(clean);
        try {
          await options.trash(clean);
        } catch {
          return fail("unavailable");
        }
        return { ok: true, value: {} };
      });
    },

    async reveal(input) {
      return await guarded(input.path, async (clean) => {
        await lstat(clean);
        options.reveal(clean);
        return { ok: true, value: {} };
      });
    },

    async watch(owner, paths) {
      const next = new Map<string, Seen>();
      for (const path of paths) {
        const accepted = await accept(path);
        if (!accepted.ok) return fail(accepted.code);
        next.set(
          accepted.path,
          watched.get(owner)?.get(accepted.path) ?? (await look(accepted.path)),
        );
      }
      if (next.size === 0) watched.delete(owner);
      else watched.set(owner, next);
      arm();
      return { ok: true, value: {} };
    },

    dropOwner(owner) {
      watched.delete(owner);
      arm();
    },
  };
}
