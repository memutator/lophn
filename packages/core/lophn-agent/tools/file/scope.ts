import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  sep,
} from "node:path";
import { err, ok, type Result } from "../../../../base/mod.ts";
import type { PlaceScope } from "../ports.ts";

// file tool이 만지는 경로를 place 폴더 안으로 가둔다. 상대 경로는 place의 첫 폴더 기준이다.
// `..`로 나가는 경로, 폴더 밖 절대 경로, 밖으로 나가는 symlink는 forbidden이다.
// 실제 경로(realPath)로 판정한다. 새 파일이면 가장 가까운 있는 상위 폴더의 실제 경로에 남은 이름을 붙인다.

export type Mode = "read" | "write";

export type Resolved = {
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
    return await Deno.realPath(path);
  } catch {
    return null;
  }
}

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export async function resolveInPlace(
  roots: PlaceScope,
  path: string,
  mode: Mode,
): Promise<Result<Resolved>> {
  const allowed = roots[mode];
  const base = roots.read[0] ?? allowed[0];
  if (allowed.length === 0 || base === undefined) return forbidden();
  const candidate = normalize(isAbsolute(path) ? path : join(base, path));

  // 있는 가장 가까운 상위 폴더까지 올라가 실제 경로를 구한다. 끊어진 symlink는 따라 쓰면 밖에 쓰게 되어 거절한다.
  let probe = candidate;
  const rest: string[] = [];
  let resolved: string | null = null;
  for (;;) {
    resolved = await real(probe);
    if (resolved !== null) break;
    const stat = await Deno.lstat(probe).catch(() => null);
    if (stat?.isSymlink) return forbidden();
    const parent = dirname(probe);
    if (parent === probe) return forbidden();
    rest.unshift(basename(probe));
    probe = parent;
  }
  const actual = rest.length === 0 ? resolved : join(resolved, ...rest);

  for (const folder of allowed) {
    const root = await real(folder);
    if (root !== null && inside(root, actual)) {
      return ok({ path: actual, root, relative: relative(root, actual) });
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
  if (error instanceof Deno.errors.NotFound) {
    return fail("not_found", "file not found");
  }
  return fail("invalid_input", "cannot access this path");
}
