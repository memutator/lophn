// <home>/shell/layout.json은 main만 쓴다. 원자 교체 temp 파일 뒤 rename이고,
// 폴더 0700·파일 0600(Windows는 mode bit가 없어 기본 ACL이 사용자 limit이다)을
// 유지한다. 본문·결정·token은 여기 남지 않는다.
import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import { type LayoutResult, parseLayoutFile } from "./layout.ts";

export type StoreError =
  | { code: "not_a_directory"; message: string }
  | { code: "unreadable"; message: string }
  | { code: "unwritable"; message: string }
  | { code: "internal"; message: string };

export type StoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: StoreError };

/** layout.json 파일 자리. `<root>/shell/layout.json` 고정이다. */
export function layoutPath(dataRoot: string): string {
  return join(dataRoot, "shell", "layout.json");
}

export interface LayoutStore {
  /** 현재 layout. 파일이 없으면 null이고 손상은 안전한 오류다. */
  read(): Promise<StoreResult<LayoutResult | null>>;
  /** 원자 교체로 쓴다. 실패하면 기존 파일을 그대로 둔다. */
  write(content: string): Promise<StoreResult<null>>;
}

/** chmod까지 store가 쓰는 최소 fs 폭. 테스트가 가짜를 끼운다. */
export interface StoreDeps {
  chmod(path: string, mode: number): Promise<void>;
  mkdir(
    path: string,
    options: { recursive: true; mode: number },
  ): Promise<string | undefined>;
  open(path: string, flags: string, mode: number): Promise<FileHandleLike>;
  readFile(path: string): Promise<Uint8Array>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

/** open이 돌려주는 최소 handle 폭. */
export interface FileHandleLike {
  writeFile(data: string, options: { encoding: "utf8" }): Promise<void>;
  chmod(mode: number): Promise<void>;
  close(): Promise<void>;
}

/** Linux·macOS 0700 폴더·0600 파일. Windows는 동등 ACL이 사용자 limit이다. */
export const DIR_MODE = 0o700;
export const FILE_MODE = 0o600;

const INTERNAL = "layout storage is not accessible";

function fsError(code: StoreError["code"]): StoreError {
  return { code, message: INTERNAL };
}

export function createLayoutStore(
  dataRoot: string,
  deps: Partial<StoreDeps> = {},
): LayoutStore {
  const impl: StoreDeps = {
    chmod,
    mkdir,
    open,
    readFile,
    rename,
    unlink,
    ...deps,
  };
  const file = layoutPath(dataRoot);
  const dir = dirname(file);
  return {
    async read(): Promise<StoreResult<LayoutResult | null>> {
      let raw: Uint8Array;
      try {
        raw = await impl.readFile(file);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") return { ok: true, value: null };
        return {
          ok: false,
          error: fsError(code === "EISDIR" ? "not_a_directory" : "unreadable"),
        };
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(raw));
      } catch {
        // 손상 파일은 도메인 데이터를 바꾸지 않고 안전한 오류로 둔다.
        return { ok: true, value: { ok: false, reason: "corrupt" as const } };
      }
      return { ok: true, value: parseLayoutFile(parsed) };
    },
    async write(content: string): Promise<StoreResult<null>> {
      const temp = `${file}.tmp`;
      try {
        await impl.mkdir(dir, { recursive: true, mode: DIR_MODE });
        // 같은 폴더 안 temp 파일 뒤 rename이 원자 교체다. 남은 temp는 먼저 뺀다.
        await impl.unlink(temp).catch(() => {});
        const handle = await impl.open(temp, "w", FILE_MODE);
        try {
          await handle.writeFile(content, { encoding: "utf8" });
          await handle.chmod(FILE_MODE);
        } finally {
          await handle.close();
        }
        await impl.rename(temp, file);
        // umask가 mode를 좁혔을 수 있다. rename 뒤 파일 mode를 고정한다.
        await impl.chmod(file, FILE_MODE).catch(() => {});
        return { ok: true, value: null };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        // 직전 파일을 그대로 둔다. temp만 뺀다.
        await impl.unlink(temp).catch(() => {});
        if (code === "ENOTDIR" || code === "EEXIST" || code === "EISDIR") {
          return { ok: false, error: fsError("not_a_directory") };
        }
        if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
          return { ok: false, error: fsError("unwritable") };
        }
        return { ok: false, error: fsError("internal") };
      }
    },
  };
}
