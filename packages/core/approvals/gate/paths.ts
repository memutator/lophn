import { posix } from "node:path";
import type { GateCall } from "../../../protocol/approvals/mod.ts";

function toPosix(rawPath: string): string {
  return rawPath.replace(/\\/g, "/");
}

// 경로 비교 전에 `~`·`$HOME`·중복 슬래시·`..`을 정규화한다.
export function normalizePath(rawPath: string, homeDir?: string): string {
  let value = toPosix(rawPath.trim());
  const normalizedHome = homeDir
    ? posix.normalize(toPosix(homeDir)).replace(/\/+$/, "")
    : undefined;

  if (normalizedHome) {
    if (value === "~" || value === "$HOME" || value === "${HOME}") {
      return normalizedHome;
    }
    if (value.startsWith("~/")) {
      value = `${normalizedHome}/${value.slice(2)}`;
    } else if (value.startsWith("$HOME/")) {
      value = `${normalizedHome}/${value.slice("$HOME/".length)}`;
    } else if (value.startsWith("${HOME}/")) {
      value = `${normalizedHome}/${value.slice("${HOME}/".length)}`;
    }
  }

  return posix.normalize(value);
}

export function isPathInside(
  targetPath: string,
  folderPath: string,
  homeDir?: string,
): boolean {
  const target = normalizePath(targetPath, homeDir).replace(/\/+$/, "");
  const folder = normalizePath(folderPath, homeDir).replace(/\/+$/, "");
  if (folder === "" || folder === "/") return target.startsWith("/");
  return target === folder || target.startsWith(`${folder}/`);
}

function matchesHomeSubdir(
  rawPath: string,
  subdir: string,
  homeDir?: string,
): boolean {
  const posixRaw = toPosix(rawPath.trim()).toLowerCase();
  const sub = subdir.toLowerCase();
  if (
    posixRaw === `~/${sub}` ||
    posixRaw.startsWith(`~/${sub}/`) ||
    posixRaw === `$home/${sub}` ||
    posixRaw.startsWith(`$home/${sub}/`) ||
    posixRaw === `\${home}/${sub}` ||
    posixRaw.startsWith(`\${home}/${sub}/`)
  ) {
    return true;
  }
  if (homeDir) {
    const absTarget = normalizePath(rawPath, homeDir).toLowerCase();
    const absSubdir = normalizePath(`~/${subdir}`, homeDir).toLowerCase();
    if (absTarget === absSubdir || absTarget.startsWith(`${absSubdir}/`)) {
      return true;
    }
  }
  return false;
}

function isDataRootSecretPath(
  rawPath: string,
  dataRoot?: string,
  homeDir?: string,
): boolean {
  if (!dataRoot) return false;
  const target = normalizePath(rawPath, homeDir).toLowerCase();
  const root = normalizePath(dataRoot, homeDir)
    .replace(/\/+$/, "")
    .toLowerCase();
  if (!target.startsWith(`${root}/`)) return false;
  const rel = target.slice(root.length + 1);
  return (
    rel === "secrets" ||
    rel.startsWith("secrets.") ||
    rel.startsWith("secrets/")
  );
}

function isDataRootSelfProtectedWrite(
  rawPath: string,
  dataRoot?: string,
  homeDir?: string,
): boolean {
  if (!dataRoot) return false;
  const target = normalizePath(rawPath, homeDir).toLowerCase();
  const root = normalizePath(dataRoot, homeDir)
    .replace(/\/+$/, "")
    .toLowerCase();
  if (!target.startsWith(`${root}/`)) return false;
  const rel = target.slice(root.length + 1);
  return (
    rel === "settings.json" ||
    rel.startsWith("settings.") ||
    rel === "permissions" ||
    rel.startsWith("permissions.") ||
    rel.startsWith("permissions/") ||
    rel === "agents" ||
    rel.startsWith("agents/") ||
    rel === "secrets" ||
    rel.startsWith("secrets.") ||
    rel.startsWith("secrets/")
  );
}

export type SelfProtectionHit = {
  readonly message: string;
};

// floor·자기 보호 경로. 어느 단계·규칙·session grant로도 열리지 않는다.
export function checkFileSelfProtection(
  call: Extract<GateCall, { kind: "file_read" | "file_write" }>,
  options: { homeDir?: string; dataRoot?: string },
): SelfProtectionHit | null {
  for (const dir of [".ssh", ".aws", ".gnupg"]) {
    if (matchesHomeSubdir(call.path, dir, options.homeDir)) {
      return {
        message: `Access to protected credential directory ~/${dir} is blocked.`,
      };
    }
  }
  if (isDataRootSecretPath(call.path, options.dataRoot, options.homeDir)) {
    return {
      message: "Access to lophn secrets in the data root is blocked.",
    };
  }
  if (
    call.kind === "file_write" &&
    isDataRootSelfProtectedWrite(call.path, options.dataRoot, options.homeDir)
  ) {
    return {
      message:
        "Writing lophn settings, permissions, agent definitions, or secrets directly via file tools is blocked.",
    };
  }
  return null;
}

// `.git/hooks/*`, `.git/config`, `.lophn/tools/*` 쓰기와 `.env*` 읽기(`.env.example`, `.env.sample` 제외).
export function isSensitiveWorkspaceFile(
  call: Extract<GateCall, { kind: "file_read" | "file_write" }>,
  homeDir?: string,
): boolean {
  if (call.sensitive) return true;
  const lower = normalizePath(call.path, homeDir).toLowerCase();
  if (call.kind === "file_write") {
    return (
      /(?:^|\/)\.git\/hooks(?:\/|$)/.test(lower) ||
      /(?:^|\/)\.git\/config$/.test(lower) ||
      /(?:^|\/)\.lophn\/tools(?:\/|$)/.test(lower)
    );
  }
  const base = posix.basename(lower);
  if (base === ".env.example" || base === ".env.sample") return false;
  return base === ".env" || base.startsWith(".env.");
}
