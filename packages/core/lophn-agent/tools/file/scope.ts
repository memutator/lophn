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
import type { PlaceScope } from "../ports.ts";

// file tool이 만지는 경로를 place 폴더 안으로 가둔다. 상대 경로는 범위의 base, 없으면 place의 첫 폴더 기준이다.
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
  return err({ code: "forbidden", message: "path is outside the place" });
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

// entry의 실제 경로와 파일인지 여부. 없는 entry는 부모 폴더가 있으면 파일 하나로 본다.
async function entryOf(
  entry: string,
): Promise<{ path: string; file: boolean } | null> {
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

export async function resolveInPlace(
  roots: Pick<PlaceScope, "read" | "write" | "base">,
  path: string,
  mode: Mode,
): Promise<Result<Resolved>> {
  const allowed = roots[mode];
  const base = roots.base ?? roots.read[0] ?? allowed[0];
  if (allowed.length === 0 || base === undefined) return forbidden();
  const candidate = normalize(isAbsolute(path) ? path : join(base, path));

  // 있는 가장 가까운 상위 폴더까지 올라가 실제 경로를 구한다. 끊어진 symlink는 따라 쓰면 밖에 쓰게 되어 거절한다.
  let probe = candidate;
  const rest: string[] = [];
  let resolved: string | null = null;
  for (;;) {
    resolved = await real(probe);
    if (resolved !== null) break;
    const probeStat = await lstat(probe).catch(() => null);
    if (probeStat?.isSymbolicLink()) return forbidden();
    const parent = dirname(probe);
    if (parent === probe) return forbidden();
    rest.unshift(basename(probe));
    probe = parent;
  }
  const actual = rest.length === 0 ? resolved : join(resolved, ...rest);

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

// 파일을 읽다 난 오류를 tool 오류 코드로 옮긴다.
export function fsFail(error: unknown): Result<never> {
  if (errorCode(error) === "ENOENT") {
    return fail("not_found", "file not found");
  }
  return fail("invalid_input", "cannot access this path");
}
