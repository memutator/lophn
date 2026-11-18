// destination 폴더의 쓰기와 읽기. 이름 붙인 폴더는 바깥 도구가, `computers` 폴더는 받는 자리가 다른 기계의 file을 두는 폴더라
// 다른 기계와 사람의 file이 같이 있다.
// - writer는 `machines/<자기 id>/` 아래에만 쓰고 지우고 rename한다. 그 밖(`..`, 절대 path, 다른 기계 폴더, 자기 폴더
//   안에서 밖을 가리키는 symlink)은 아무것도 하지 않고 오류다. 그래서 lock이 없고 같은 file을 둘이 고치지 않는다.
// - 쓰기는 같은 폴더의 `<이름>.tmp-<16 hex>`(앞에 점이 없다)에 쓰고 fsync 뒤 rename한다. 읽는 쪽은 temp 이름을
//   없는 것으로 본다.
// - reader는 layout의 이름 꼴을 통과한 이름만 돌려주고, 없는 file은 `not_found`다(아직 안 옴).
import { createReadStream, type Stats } from "node:fs";
import {
  type FileHandle,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { join, sep } from "node:path";
import {
  err,
  errorCode,
  ok,
  type RandomSource,
  type Result,
} from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import {
  isMachineDirName,
  listingOf,
  MACHINES_DIR,
  tempName,
} from "../../protocol/folder/mod.ts";

const FILE_MODE = 0o600;

export type FolderWriter = {
  readonly machine: Id<"mch">;
  writeFile(rel: string, bytes: Uint8Array): Promise<Result<void>>;
  /** 큰 file(snapshot, git bundle). chunks를 다 쓴 뒤에만 이름이 보인다. */
  writeStream(
    rel: string,
    chunks: AsyncIterable<Uint8Array>,
  ): Promise<Result<{ size: number }>>;
  rename(from: string, to: string): Promise<Result<void>>;
  /** file이나 폴더(안의 것 모두). 없으면 지울 것이 없다. */
  remove(rel: string): Promise<Result<void>>;
};

export type FolderReadError = {
  code:
    | "not_found"
    | "too_large"
    | "invalid_input"
    | "forbidden"
    | "unavailable";
  message: string;
};

export type FolderReader = {
  listMachines(): Promise<Result<Id<"mch">[], FolderReadError>>;
  /** layout이 정한 폴더의 이름 가운데 꼴이 맞는 것만(이름 순). 폴더가 없으면 빈 목록이다. */
  list(dir: string): Promise<Result<string[], FolderReadError>>;
  /** 크기가 `maxBytes`를 넘으면 읽지 않는다(`too_large`). */
  read(
    rel: string,
    maxBytes: number,
  ): Promise<Result<Uint8Array, FolderReadError>>;
  /** 앞 `maxBytes`까지와 file 전체 크기. 큰 변경 file의 1·2행을 읽는다. */
  readHead(
    rel: string,
    maxBytes: number,
  ): Promise<Result<{ bytes: Uint8Array; size: number }, FolderReadError>>;
  /** `start`부터 끝까지. 큰 payload를 hash하거나 복사한다. */
  readStream(
    rel: string,
    start: number,
  ): Promise<
    Result<{ size: number; chunks: AsyncIterable<Uint8Array> }, FolderReadError>
  >;
};

// destination 기준 상대 path(`/` 구분)의 구간. 빈 구간, `.`, `..`, `\`, 절대 path는 받지 않는다.
function segmentsOf(rel: string): string[] | null {
  if (rel === "" || rel.startsWith("/") || /^[A-Za-z]:/.test(rel)) return null;
  const parts = rel.split("/");
  return parts.every(
    (part) =>
      part !== "" &&
      part !== "." &&
      part !== ".." &&
      !part.includes("\\") &&
      !part.includes("\0"),
  )
    ? parts
    : null;
}

const forbidden = (message: string): Result<never> =>
  err({ code: "forbidden", message });
const unavailable = (message: string): Result<never> =>
  err({ code: "unavailable", message });

function hex16(random: RandomSource): string {
  const bytes = new Uint8Array(8);
  random.fill(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function lstatOrNull(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch (thrown) {
    if (errorCode(thrown) === "ENOENT") return null;
    throw thrown;
  }
}

export function createFolderWriter(deps: {
  /** destination 경로. */
  root: string;
  machine: Id<"mch">;
  random: RandomSource;
}): FolderWriter {
  const { machine, random } = deps;

  // 자기 폴더 아래의 구간인지 보고, 그 위 폴더를 구간마다 lstat으로 따라가며 symlink가 하나도 없음을 본다.
  // create면 없는 폴더를 만든다. 없는 폴더를 만들지 않으면 null(지울 것이 없다).
  const ownParent = async (
    rel: string,
    create: boolean,
  ): Promise<Result<{ dir: string; name: string } | null>> => {
    const parts = segmentsOf(rel);
    if (parts === null) {
      return err({
        code: "invalid_input",
        message: `not a folder path: ${rel}`,
      });
    }
    if (parts.length < 3 || parts[0] !== MACHINES_DIR || parts[1] !== machine) {
      return forbidden(`outside this machine's folder: ${rel}`);
    }
    let dir: string;
    try {
      dir = await realpath(deps.root);
    } catch {
      return unavailable("the destination folder is missing");
    }
    try {
      for (const part of parts.slice(0, -1)) {
        dir = join(dir, part);
        let stat = await lstatOrNull(dir);
        if (stat === null) {
          if (!create) return ok(null);
          try {
            await mkdir(dir);
          } catch (thrown) {
            if (errorCode(thrown) !== "EEXIST") throw thrown;
          }
          stat = await lstat(dir);
        }
        if (stat.isSymbolicLink()) {
          return forbidden(`a symlink is in the way: ${rel}`);
        }
        if (!stat.isDirectory()) return unavailable(`not a folder: ${rel}`);
      }
    } catch {
      return unavailable(`could not reach ${rel}`);
    }
    return ok({ dir, name: parts.at(-1)! });
  };

  const writeVia = async (
    rel: string,
    fill: (file: FileHandle) => Promise<number>,
  ): Promise<Result<{ size: number }>> => {
    const parent = await ownParent(rel, true);
    if (!parent.ok) return parent;
    const { dir, name } = parent.value!;
    const temp = join(dir, tempName(name, hex16(random)));
    try {
      const file = await open(temp, "wx", FILE_MODE);
      let size: number;
      try {
        size = await fill(file);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temp, join(dir, name));
      return ok({ size });
    } catch {
      await rm(temp, { force: true }).catch(() => undefined);
      return unavailable(`could not write ${rel}`);
    }
  };

  return {
    machine,
    async writeFile(rel, bytes) {
      const written = await writeVia(rel, async (file) => {
        await file.writeFile(bytes);
        return bytes.byteLength;
      });
      return written.ok ? ok(undefined) : written;
    },
    writeStream: (rel, chunks) =>
      writeVia(rel, async (file) => {
        let size = 0;
        for await (const chunk of chunks) {
          await file.write(chunk);
          size += chunk.byteLength;
        }
        return size;
      }),
    async rename(from, to) {
      const source = await ownParent(from, false);
      if (!source.ok) return source;
      if (source.value === null) {
        return err({ code: "not_found", message: `${from} does not exist` });
      }
      const target = await ownParent(to, true);
      if (!target.ok) return target;
      try {
        await rename(
          join(source.value.dir, source.value.name),
          join(target.value!.dir, target.value!.name),
        );
        return ok(undefined);
      } catch (thrown) {
        return errorCode(thrown) === "ENOENT"
          ? err({ code: "not_found", message: `${from} does not exist` })
          : unavailable(`could not rename ${from}`);
      }
    },
    async remove(rel) {
      const parent = await ownParent(rel, false);
      if (!parent.ok) return parent;
      if (parent.value === null) return ok(undefined);
      // rm은 symlink를 따라가지 않고 link 자체를 지운다.
      try {
        await rm(join(parent.value.dir, parent.value.name), {
          recursive: true,
          force: true,
        });
        return ok(undefined);
      } catch {
        return unavailable(`could not remove ${rel}`);
      }
    },
  };
}

export function createFolderReader(root: string): FolderReader {
  const readError = (
    code: FolderReadError["code"],
    message: string,
  ): Result<never, FolderReadError> => err({ code, message });

  // symlink를 따라간 결과도 destination 안이어야 한다.
  const locate = async (
    rel: string,
  ): Promise<Result<string, FolderReadError>> => {
    const parts = segmentsOf(rel);
    if (parts === null) {
      return readError("invalid_input", `not a folder path: ${rel}`);
    }
    let base: string;
    try {
      base = await realpath(root);
    } catch {
      return readError("unavailable", "the destination folder is missing");
    }
    let real: string;
    try {
      real = await realpath(join(base, ...parts));
    } catch (thrown) {
      return errorCode(thrown) === "ENOENT" || errorCode(thrown) === "ENOTDIR"
        ? readError("not_found", `${rel} does not exist`)
        : readError("unavailable", `could not reach ${rel}`);
    }
    if (real !== base && !real.startsWith(`${base}${sep}`)) {
      return readError("forbidden", `${rel} points outside the destination`);
    }
    return ok(real);
  };

  const list = async (
    dir: string,
  ): Promise<Result<string[], FolderReadError>> => {
    const listing = listingOf(dir);
    if (listing === null) {
      return readError("invalid_input", `not a listed folder: ${dir}`);
    }
    const path = await locate(dir);
    if (!path.ok) return path.error.code === "not_found" ? ok([]) : path;
    try {
      const entries = await readdir(path.value, { withFileTypes: true });
      return ok(
        entries
          .filter(
            (entry) =>
              listing.accepts(entry.name) &&
              (listing.directories ? entry.isDirectory() : entry.isFile()),
          )
          .map((entry) => entry.name)
          .sort(),
      );
    } catch (thrown) {
      return errorCode(thrown) === "ENOTDIR"
        ? ok([])
        : readError("unavailable", `could not list ${dir}`);
    }
  };

  const readPrefix = async (
    rel: string,
    maxBytes: number,
    refuseLarger: boolean,
  ): Promise<Result<{ bytes: Uint8Array; size: number }, FolderReadError>> => {
    const path = await locate(rel);
    if (!path.ok) return path;
    try {
      const file = await open(path.value, "r");
      try {
        const stat = await file.stat();
        if (!stat.isFile())
          return readError("not_found", `${rel} is not a file`);
        if (refuseLarger && stat.size > maxBytes) {
          return readError("too_large", `${rel} is over ${maxBytes} bytes`);
        }
        const bytes = new Uint8Array(Math.min(stat.size, maxBytes));
        let filled = 0;
        while (filled < bytes.byteLength) {
          const { bytesRead } = await file.read(
            bytes,
            filled,
            bytes.byteLength - filled,
            filled,
          );
          if (bytesRead === 0) break;
          filled += bytesRead;
        }
        return ok({ bytes: bytes.subarray(0, filled), size: stat.size });
      } finally {
        await file.close();
      }
    } catch {
      return readError("unavailable", `could not read ${rel}`);
    }
  };

  return {
    async listMachines() {
      const names = await list(MACHINES_DIR);
      return names.ok ? ok(names.value.filter(isMachineDirName)) : names;
    },
    list,
    async read(rel, maxBytes) {
      const read = await readPrefix(rel, maxBytes, true);
      return read.ok ? ok(read.value.bytes) : read;
    },
    readHead: (rel, maxBytes) => readPrefix(rel, maxBytes, false),
    async readStream(rel, start) {
      const path = await locate(rel);
      if (!path.ok) return path;
      try {
        const stat = await lstat(path.value);
        if (!stat.isFile())
          return readError("not_found", `${rel} is not a file`);
        return ok({
          size: stat.size,
          chunks: createReadStream(path.value, { start }),
        });
      } catch {
        return readError("unavailable", `could not read ${rel}`);
      }
    },
  };
}
