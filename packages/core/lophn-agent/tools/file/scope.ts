import { lstat, realpath, stat } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  sep,
} from "node:path";
import { err, errorCode, ok, type Result } from "../../../../base/mod.ts";
import type { WorkspaceScope } from "../ports.ts";

// file tool이 만지는 경로를 workspace 폴더 안으로 가둔다. 상대 경로는 범위의 base, 없으면 workspace의 첫 폴더 기준이다.
// `..`로 나가는 경로, 폴더 밖 절대 경로, 밖으로 나가는 symlink는 forbidden이다.
// 허용 entry는 폴더이거나 파일 하나다(kinds 파일). 파일 entry는 아직 없어도 그 경로 하나만 연다.
// 실제 경로(realpath)로 판정한다. 새 파일이면 가장 가까운 있는 상위 폴더의 실제 경로에 남은 이름을 붙인다.

export type Mode = "read" | "write";

type Resolved = {
  // 실제 경로. 이 경로로 읽고 쓴다.
  path: string;
  // 허용 폴더(실제 경로)와 그 안의 상대 경로. rewind 기록이 쓴다.
  root: string;
  relative: string;
};

function forbidden(): Result<never> {
  return err({ code: "forbidden", message: "path is outside the workspace" });
}

async function real(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch {
    return null;
  }
}

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

// 있는 가장 가까운 상위 폴더까지 올라가 실제 경로를 구하고 남은 이름을 붙인다. 끊어진 symlink는 따라 쓰면 밖에 쓰게 되어 null이다.
async function planned(candidate: string): Promise<string | null> {
  let probe = candidate;
  const rest: string[] = [];
  for (;;) {
    const resolved = await real(probe);
    if (resolved !== null)
      return rest.length === 0 ? resolved : join(resolved, ...rest);
    const probeStat = await lstat(probe).catch(() => null);
    if (probeStat?.isSymbolicLink()) return null;
    const parent = dirname(probe);
    if (parent === probe) return null;
    rest.unshift(basename(probe));
    probe = parent;
  }
}

// entry의 실제 경로와 파일인지 여부. 없는 entry는 부모 폴더가 있으면 파일 하나로 본다.
async function entryOf(
  entry: string,
): Promise<{ path: string; file: boolean } | null> {
  // 끝이 /인 entry는 아직 없어도 폴더다(session의 tool-results 폴더는 첫 spill 때 생긴다).
  if (entry.endsWith(sep)) {
    const folder = await planned(entry.slice(0, -1));
    return folder === null ? null : { path: folder, file: false };
  }
  const actual = await real(entry);
  if (actual !== null) {
    const actualStat = await stat(actual).catch(() => null);
    return actualStat === null
      ? null
      : { path: actual, file: !actualStat.isDirectory() };
  }
  const parent = await real(dirname(entry));
  return parent === null
    ? null
    : { path: join(parent, basename(entry)), file: true };
}

export async function resolveInWorkspace(
  roots: Pick<WorkspaceScope, "read" | "write" | "base" | "results">,
  path: string,
  mode: Mode,
): Promise<Result<Resolved>> {
  const base = roots.base ?? roots.read[0] ?? roots[mode][0];
  // 결과 폴더는 읽기에만 더한다. base와 cwd 대신 쓰는 read[0]에는 끼지 않는다. 끝의 /는 폴더가 아직 없어도 폴더라는 표시다.
  const allowed =
    mode === "read" && roots.results !== undefined
      ? [...roots.read, `${roots.results}${sep}`]
      : roots[mode];
  if (allowed.length === 0) return forbidden();
  if (base === undefined && !isAbsolute(path)) return forbidden();
  const candidate = normalize(
    isAbsolute(path) ? path : join(base as string, path),
  );

  const actual = await planned(candidate);
  if (actual === null) return forbidden();

  for (const entry of allowed) {
    const found = await entryOf(entry);
    if (found === null) continue;
    if (found.file) {
      // 같은 폴더의 다른 파일은 거절한다. rewind 기록은 root가 폴더여야 하므로 부모 폴더를 root로 한다.
      if (actual === found.path) {
        return ok({
          path: actual,
          root: dirname(found.path),
          relative: basename(found.path),
        });
      }
    } else if (inside(found.path, actual)) {
      return ok({
        path: actual,
        root: found.path,
        relative: relative(found.path, actual),
      });
    }
  }
  return forbidden();
}

export function fail(
  code: "invalid_input" | "not_found" | "unavailable",
  message: string,
): Result<never> {
  return err({ code, message });
}

// model이 원인(권한, disk, 폴더 여부)을 알아야 다음 수를 고르므로 errno마다 문장을 나눈다. 모두 invalid_input이다:
// executeToolCall은 invalid_input일 때만 이 문장을 model에 보인다.
const FS_MESSAGES: Record<string, string> = {
  EACCES: "permission denied",
  EPERM: "permission denied",
  EISDIR: "the path is a directory",
  ENOTDIR: "a parent of the path is not a directory",
  ENOSPC: "no space left on the disk",
  EDQUOT: "no space left on the disk",
  EROFS: "the file system is read-only",
  EBUSY: "the file is in use by another program",
};

// 파일을 읽거나 쓰다 난 오류를 tool 오류 코드로 옮긴다.
export function fsFail(error: unknown): Result<never> {
  const code = errorCode(error);
  if (code === "ENOENT") return fail("not_found", "file not found");
  return fail(
    "invalid_input",
    (code !== undefined && FS_MESSAGES[code]) || "cannot access this path",
  );
}
