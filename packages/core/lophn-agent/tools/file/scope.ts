import { lstat, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  sep,
} from "node:path";
import process from "node:process";
import { err, errorCode, ok, type Result } from "../../../../base/mod.ts";
import type { WorkspaceScope } from "../ports.ts";

// file tool이 만지는 경로를 workspace 폴더 안으로 가둔다. 상대 경로는 범위의 base, 없으면 workspace의 첫 폴더 기준이다.
// `..`로 나가는 경로, 폴더 밖 절대 경로, 밖으로 나가는 symlink는 forbidden이다.
// 허용 entry는 폴더이거나 파일 하나다(kinds 파일). 파일 entry는 아직 없어도 그 경로 하나만 연다.
// 실제 경로(realpath)로 판정한다. 새 파일이면 가장 가까운 있는 상위 폴더의 실제 경로에 남은 이름을 붙인다.

export type Mode = "read" | "write";

export type Resolved = {
  // 실제 경로. 이 경로로 읽고 쓴다.
  path: string;
  // 허용 폴더(실제 경로)와 그 안의 상대 경로. rewind 기록이 쓴다.
  root: string;
  relative: string;
};

export type ClassifiedFilePath = {
  // 실제 경로(계획된 경로). 끊어진 symlink 등으로 풀 수 없으면 null.
  path: string | null;
  // 승인 카드와 session 폴더 열기에 쓰는 폴더(파일이면 부모 폴더, 폴더면 자신).
  folder: string;
  outsideWorkspace: boolean;
  sensitive: boolean;
  selfProtection: boolean;
  resolved: Resolved | null;
};

export type ClassifyOptions = {
  dataRoot?: string | null;
  homeDir?: string;
};

const HOME_SENSITIVE_DIRS = [".ssh", ".aws", ".gnupg"] as const;
const SAFE_ENV_BASENAMES = new Set([".env.example", ".env.sample"]);

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

function pathSegments(target: string): string[] {
  return target.split(/[\\/]+/).filter((part) => part.length > 0);
}

function isSensitiveWorkspacePath(target: string, mode: Mode): boolean {
  const segments = pathSegments(target).map((part) => part.toLowerCase());
  if (mode === "write") {
    for (let i = 0; i < segments.length - 1; i++) {
      const curr = segments[i];
      const next = segments[i + 1];
      if (curr === ".git" && (next === "hooks" || next === "config")) {
        return true;
      }
      if (curr === ".lophn" && next === "tools") {
        return true;
      }
    }
    return false;
  }
  const name = basename(target).toLowerCase();
  if (SAFE_ENV_BASENAMES.has(name)) return false;
  return /^\.env($|\.)/.test(name);
}

// gate/paths.ts와 같은 기준: secrets*는 읽기·쓰기 모두 보호하고, settings·permissions·agents는 쓰기만 자기 보호다.
function isProtectedDataRootPath(
  dataRoot: string,
  target: string,
  mode: Mode,
): boolean {
  if (!inside(dataRoot, target)) return false;
  const rel = relative(dataRoot, target).replace(/\\/g, "/").toLowerCase();
  if (rel === "") return false;
  if (
    rel === "secrets" ||
    rel.startsWith("secrets.") ||
    rel.startsWith("secrets/")
  ) {
    return true;
  }
  if (mode !== "write") return false;
  return (
    rel === "settings.json" ||
    rel.startsWith("settings.") ||
    rel === "permissions" ||
    rel.startsWith("permissions.") ||
    rel.startsWith("permissions/") ||
    rel === "agents" ||
    rel.startsWith("agents/")
  );
}

async function isSelfProtectionPath(
  target: string,
  mode: Mode,
  options?: ClassifyOptions,
): Promise<boolean> {
  const home = options?.homeDir ?? homedir();
  if (home !== "") {
    const homeVariants = new Set<string>([normalize(home)]);
    const realHome = await real(home);
    if (realHome !== null) homeVariants.add(realHome);
    for (const homeBase of homeVariants) {
      for (const dir of HOME_SENSITIVE_DIRS) {
        const protectedDir = join(homeBase, dir);
        if (inside(protectedDir, target)) return true;
        const realProtected = await real(protectedDir);
        if (realProtected !== null && inside(realProtected, target)) {
          return true;
        }
      }
    }
  }
  const rawDataRoot =
    options?.dataRoot !== undefined ? options.dataRoot : process.env.LOPHN_HOME;
  if (
    rawDataRoot !== null &&
    rawDataRoot !== undefined &&
    isAbsolute(rawDataRoot)
  ) {
    const rootVariants = new Set<string>([normalize(rawDataRoot)]);
    const realRoot = await real(rawDataRoot);
    if (realRoot !== null) rootVariants.add(realRoot);
    for (const root of rootVariants) {
      if (isProtectedDataRootPath(root, target, mode)) return true;
    }
  }
  return false;
}

export async function classifyFilePath(
  roots: Pick<
    WorkspaceScope,
    "read" | "write" | "base" | "results" | "onceTarget"
  >,
  path: string,
  mode: Mode,
  options?: ClassifyOptions,
): Promise<ClassifiedFilePath> {
  const base = roots.base ?? roots.read[0] ?? roots[mode][0];
  if (base === undefined && !isAbsolute(path)) {
    return {
      path: null,
      folder: ".",
      outsideWorkspace: true,
      sensitive: false,
      selfProtection: false,
      resolved: null,
    };
  }
  const candidate = normalize(
    isAbsolute(path) ? path : join(base as string, path),
  );
  const actual = await planned(candidate);
  const checkTarget = actual ?? candidate;
  const resolved = await resolveInWorkspace(roots, path, mode);
  const outsideWorkspace = !resolved.ok;
  const selfProtection =
    (await isSelfProtectionPath(checkTarget, mode, options)) ||
    (actual !== null &&
      checkTarget !== candidate &&
      (await isSelfProtectionPath(candidate, mode, options)));
  const sensitiveWorkspace =
    isSensitiveWorkspacePath(checkTarget, mode) ||
    isSensitiveWorkspacePath(candidate, mode);
  let folder = dirname(checkTarget);
  if (actual !== null) {
    const info = await stat(actual).catch(() => null);
    if (info?.isDirectory()) folder = actual;
  }
  return {
    path: actual,
    folder,
    outsideWorkspace,
    sensitive: selfProtection || sensitiveWorkspace,
    selfProtection,
    resolved: resolved.ok ? resolved.value : null,
  };
}

export async function resolveInWorkspace(
  roots: Pick<
    WorkspaceScope,
    "read" | "write" | "base" | "results" | "onceTarget"
  >,
  path: string,
  mode: Mode,
): Promise<Result<Resolved>> {
  const base = roots.base ?? roots.read[0] ?? roots[mode][0];
  // 결과 폴더는 읽기에만 더한다. base와 cwd 대신 쓰는 read[0]에는 끼지 않는다. 끝의 /는 폴더가 아직 없어도 폴더라는 표시다.
  const allowed =
    mode === "read" && roots.results !== undefined
      ? [...roots.read, `${roots.results}${sep}`]
      : roots[mode];
  if (allowed.length === 0 && roots.onceTarget === undefined)
    return forbidden();
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
  const once = roots.onceTarget;
  if (once !== undefined && (mode === "read" || once.mode === "write")) {
    const oncePath = (await planned(once.path)) ?? normalize(once.path);
    const onceFolder = (await planned(once.folder)) ?? normalize(once.folder);
    if (actual === oncePath) {
      return ok({
        path: actual,
        root: onceFolder,
        relative:
          onceFolder === actual
            ? ""
            : relative(onceFolder, actual) || basename(actual),
      });
    }
    if (mode === "read" && inside(oncePath, actual)) {
      return ok({
        path: actual,
        root: oncePath,
        relative: relative(oncePath, actual),
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
