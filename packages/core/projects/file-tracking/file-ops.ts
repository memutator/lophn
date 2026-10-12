// 사람 파일 쓰기가 쓰는 port와 공용 부품. 알고리즘은 files.ts가 하고, 실제 OS 호출은
// adapters/file-ops.ts가 한다. 시각·난수·파일 시스템은 모두 인자로 받는다.
import { createHash } from "node:crypto";
import { err, ok, type Result } from "../../../base/mod.ts";
import { hardExclusion, WRITE_TEMP_PREFIX } from "../registry/mod.ts";

export type FileStat = {
  kind: "file" | "directory" | "symlink" | "other";
  device: number;
  inode: number;
  size: number;
  mtimeMs: number;
  mode: number | null;
};

// OS 오류를 알고리즘이 가를 수 있는 종류로만 줄인다. OS 문구는 남기지 않는다.
export type FaultKind =
  | "exists"
  | "missing"
  | "denied"
  | "read_only"
  | "no_space"
  | "unsupported"
  | "other";

export class FileOpFault extends Error {
  kind: FaultKind;
  code: string | undefined;
  constructor(kind: FaultKind, code?: string) {
    super(`file operation failed: ${kind}${code ? ` (${code})` : ""}`);
    this.kind = kind;
    this.code = code;
  }
}

export type TempFile = {
  readonly path: string;
  write(chunk: Uint8Array): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
};

export interface FileOps {
  // 링크를 따라가지 않는다. 없으면 undefined다.
  lstat(path: string): Promise<FileStat | undefined>;
  realPath(path: string): Promise<string | undefined>;
  read(path: string): AsyncIterable<Uint8Array>;
  // offset부터 최대 length 바이트. 파일이 끝나면 더 적게 돌려준다(없는 범위는 빈 값).
  readRange(path: string, offset: number, length: number): Promise<Uint8Array>;
  // 같은 이름이 있으면 "exists" fault다(exclusive create).
  createTemp(path: string, mode: number | null): Promise<TempFile>;
  // 같은 파일 시스템 안의 원자 교체. 교체 불가면 fault다. 복사로 대체하지 않는다.
  replace(temp: string, target: string): Promise<void>;
  // 대상이 없을 때만 설치한다. 있으면 "exists", 지원하지 않으면 "unsupported" fault다.
  install(temp: string, target: string): Promise<void>;
  remove(path: string): Promise<void>;
  // 가능한 OS에서만 한다. 못 하면 던지지 않는다.
  syncDirectory(path: string): Promise<void>;
  // 이미 있어도 된다. 부모는 만들지 않는다(working copy 폴더의 부모는 미리 있다).
  makeDirectory(path: string): Promise<void>;
}

export type FileClock = { nowIso(): string };

// 한 canonical 목표의 lophn 내부 작업은 줄을 선다. 서로 다른 목표는 기다리지 않는다.
export type FileSerializer = {
  run<T>(key: string, work: () => Promise<T>): Promise<T>;
};

export function createFileSerializer(): FileSerializer {
  const tails = new Map<string, Promise<unknown>>();
  return {
    run(key, work) {
      const before = tails.get(key) ?? Promise.resolve();
      const result = before.then(work, work);
      const tail = result.then(() => {}, () => {});
      tails.set(key, tail);
      void tail.then(() => {
        if (tails.get(key) === tail) tails.delete(key);
      });
      return result;
    },
  };
}

// 알고리즘이 호출자에게 주는 실패. code는 경계의 공통 오류 코드 중 이 작업이 쓰는 것이다.
export type FileFailure = {
  code: "invalid_input" | "conflict" | "unavailable";
  message: string;
};

export function fail(
  code: FileFailure["code"],
  message: string,
): Result<never, FileFailure> {
  return err({ code, message });
}

// 디스크가 바이트를 받지 못한 것(권한·읽기 전용·용량·원자 교체 불가)은 503이다.
// message에는 종류와 OS 코드만 있다. 경로와 본문은 넣지 않는다.
export function diskFailure(error: unknown): FileFailure {
  if (error instanceof FileOpFault) {
    if (error.kind === "exists" || error.kind === "missing") {
      return { code: "conflict", message: "the file changed" };
    }
    return { code: "unavailable", message: error.message };
  }
  return { code: "unavailable", message: "file operation failed" };
}

export function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash <= 0 ? "/" : path.slice(0, slash);
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function tempNameFor(directory: string, token: string): string {
  return `${
    directory === "/" ? "" : directory
  }/${WRITE_TEMP_PREFIX}${token}.tmp`;
}

// 등록 root 안의 실제 목표. parent는 root 안에 있어야 하고 목표는 일반 파일이거나 없어야 한다.
export type ResolvedTarget = {
  // 심볼릭 링크를 푼 parent와 파일 이름으로 만든 경로. 같은 목표의 직렬화 key다.
  path: string;
  parent: string;
  stat: FileStat | undefined;
};

function invalid(): Result<never, FileFailure> {
  return fail("invalid_input", "target is not available");
}

// root와 path는 호출자가 등록 root에서 정한 문자열이다. 여기서는 그 문자열이 정말 root 안의
// 일반 파일 하나를 가리키는지를 실제 파일 시스템에서 다시 본다(교체 직전에도 부른다).
// 범위 밖·없는 parent·링크·일반 파일 아닌 것은 모두 같은 invalid_input이다.
export async function resolveTarget(
  ops: Pick<FileOps, "lstat" | "realPath">,
  root: string,
  path: string,
): Promise<Result<ResolvedTarget, FileFailure>> {
  if (!path.startsWith("/") || !root.startsWith("/")) return invalid();
  const prefix = root === "/" ? "/" : `${root}/`;
  if (!path.startsWith(prefix)) return invalid();
  const relative = path.slice(prefix.length);
  const parts = relative.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    return invalid();
  }
  if (hardExclusion(relative) !== null) return invalid();
  const realRoot = await ops.realPath(root);
  const realParent = await ops.realPath(dirname(path));
  if (realRoot === undefined || realParent === undefined) return invalid();
  const realPrefix = realRoot === "/" ? "/" : `${realRoot}/`;
  if (realParent !== realRoot && !realParent.startsWith(realPrefix)) {
    return invalid();
  }
  const resolved = `${realParent === "/" ? "" : realParent}/${basename(path)}`;
  let stat: FileStat | undefined;
  try {
    stat = await ops.lstat(resolved);
  } catch (error) {
    return err(diskFailure(error));
  }
  if (stat !== undefined && stat.kind !== "file") return invalid();
  return ok({ path: resolved, parent: realParent, stat });
}

export function sameFileIdentity(a: FileStat, b: FileStat): boolean {
  return a.device === b.device && a.inode === b.inode && a.size === b.size &&
    a.mtimeMs === b.mtimeMs;
}

export async function hashFile(
  ops: Pick<FileOps, "read">,
  path: string,
): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of ops.read(path)) hash.update(chunk);
  return hash.digest("hex");
}
