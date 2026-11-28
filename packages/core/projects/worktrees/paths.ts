import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { err, ok, type RandomSource, type Result } from "../../../base/mod.ts";

const WINDOWS_RESERVED_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

const ADJECTIVES = [
  "amber",
  "brisk",
  "calm",
  "clear",
  "crisp",
  "eager",
  "fresh",
  "keen",
  "light",
  "mint",
  "neat",
  "plain",
  "quick",
  "quiet",
  "sharp",
  "sleek",
  "solid",
  "swift",
  "tidy",
  "vivid",
  "warm",
  "wise",
] as const;

const NOUNS = [
  "anvil",
  "brook",
  "cedar",
  "cliff",
  "comet",
  "coral",
  "crest",
  "drift",
  "ember",
  "finch",
  "flint",
  "grove",
  "haven",
  "heron",
  "larch",
  "maple",
  "orbit",
  "pebble",
  "pine",
  "ridge",
  "river",
  "spark",
  "stone",
  "trail",
] as const;

const encoder = new TextEncoder();

export const WINDOWS_PATH_BUDGET = 220;
const REPO_SLUG_MAX = 32;
const BRANCH_PREFIX_MAX_BYTES = 23;

export function safeRealpath(target: string): string {
  const abs = resolve(target);
  try {
    return realpathSync(abs);
  } catch {
    // 아직 생성되지 않은 경로라도 가장 가까운 존재하는 조상의 symlink를 풀어 realpath 기준을 맞춘다.
    const suffix: string[] = [];
    let cur = abs;
    while (true) {
      const parent = dirname(cur);
      if (parent === cur) {
        return abs;
      }
      suffix.unshift(basename(cur));
      cur = parent;
      try {
        return join(realpathSync(cur), ...suffix);
      } catch {
        // 더 상위 조상을 찾는다.
      }
    }
  }
}

export function isSameOrInside(
  candidate: string,
  container: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const normCandidate =
    platform === "win32" ? candidate.toLowerCase() : candidate;
  const normContainer =
    platform === "win32" ? container.toLowerCase() : container;
  const rel = relative(normContainer, normCandidate);
  return (
    rel === "" ||
    (rel !== ".." &&
      !rel.startsWith(`..${sep}`) &&
      !rel.startsWith("../") &&
      !isAbsolute(rel))
  );
}

export function isStrictlyInside(
  candidate: string,
  container: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const normCandidate =
    platform === "win32" ? candidate.toLowerCase() : candidate;
  const normContainer =
    platform === "win32" ? container.toLowerCase() : container;
  const rel = relative(normContainer, normCandidate);
  return (
    rel !== "" &&
    rel !== ".." &&
    !rel.startsWith(`..${sep}`) &&
    !rel.startsWith("../") &&
    !isAbsolute(rel)
  );
}

export function isFilesystemRoot(target: string): boolean {
  const resolved = resolve(target);
  return dirname(resolved) === resolved;
}

// 관리 루트 검증(spec 3.2.2): 파일시스템 루트, 홈 디렉터리(및 상위), repo 내부 또는 repo 상위는 금지한다.
export function validateWorktreesRoot(
  rootPath: string,
  options: {
    homeDir?: string | null;
    repoRoots?: readonly string[];
    platform?: NodeJS.Platform;
  } = {},
): Result<string> {
  const platform = options.platform ?? process.platform;
  if (!isAbsolute(rootPath)) {
    return err({
      code: "invalid_input",
      message: "worktrees root must be an absolute path",
      details: { reason: "unsafe_worktrees_root" },
    });
  }
  const normalized = safeRealpath(rootPath);
  if (isFilesystemRoot(normalized)) {
    return err({
      code: "invalid_input",
      message: "worktrees root cannot be the filesystem root",
      details: { reason: "unsafe_worktrees_root" },
    });
  }
  if (options.homeDir) {
    const home = safeRealpath(options.homeDir);
    if (isSameOrInside(home, normalized, platform)) {
      return err({
        code: "invalid_input",
        message:
          "worktrees root cannot be the home directory or an ancestor of it",
        details: { reason: "unsafe_worktrees_root" },
      });
    }
  }
  for (const repoRoot of options.repoRoots ?? []) {
    const repo = safeRealpath(repoRoot);
    if (
      isSameOrInside(normalized, repo, platform) ||
      isSameOrInside(repo, normalized, platform)
    ) {
      return err({
        code: "invalid_input",
        message:
          "worktrees root cannot be inside or an ancestor of a git repository",
        details: { reason: "unsafe_worktrees_root" },
      });
    }
  }
  return ok(normalized);
}

export function slugifyRepoName(repoRoot: string): string {
  const raw = basename(repoRoot)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+/, "")
    .replace(/[._-]+$/, "");
  const slug = (raw === "" ? "repo" : raw).slice(0, REPO_SLUG_MAX);
  return avoidWindowsReserved(slug);
}

function truncateUtf8Bytes(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  let out = "";
  let used = 0;
  for (const ch of text) {
    const size = encoder.encode(ch).length;
    if (used + size > maxBytes) break;
    out += ch;
    used += size;
  }
  return out;
}

function avoidWindowsReserved(segment: string): string {
  const base = segment.split(".")[0]?.toUpperCase() ?? "";
  if (WINDOWS_RESERVED_NAMES.has(base)) {
    return `wt-${segment}`;
  }
  return segment;
}

export function slugifyBranchPrefix(
  branch: string,
  maxBytes = BRANCH_PREFIX_MAX_BYTES,
): string {
  const cleaned = branch
    .toLowerCase()
    .replace(/[/\\]+/g, "-")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[._-]+/, "")
    .replace(/[._-]+$/, "");
  const fallback = cleaned === "" ? "wt" : cleaned;
  const trimmed = truncateUtf8Bytes(fallback, maxBytes).replace(/[._-]+$/, "");
  const safe = avoidWindowsReserved(trimmed === "" ? "wt" : trimmed);
  return truncateUtf8Bytes(safe, maxBytes) || "w";
}

export function shortCommonDirHash(gitCommonDir: string): string {
  return createHash("sha256").update(gitCommonDir).digest("hex").slice(0, 8);
}

export function computeWorktreePath(input: {
  worktreesRoot: string;
  repoRoot: string;
  gitCommonDir: string;
  branch: string;
  id: string;
  platform?: NodeJS.Platform;
}): Result<string> {
  const platform = input.platform ?? process.platform;
  const repoDir = `${slugifyRepoName(input.repoRoot)}-${shortCommonDirHash(input.gitCommonDir)}`;
  const idSuffix = input.id.slice(-8).toLowerCase();
  const buildPath = (prefixMaxBytes: number) => {
    const prefix = slugifyBranchPrefix(input.branch, prefixMaxBytes);
    return join(input.worktreesRoot, repoDir, `${prefix}-${idSuffix}`);
  };
  let candidate = buildPath(BRANCH_PREFIX_MAX_BYTES);
  if (platform === "win32" && candidate.length > WINDOWS_PATH_BUDGET) {
    const overflow = candidate.length - WINDOWS_PATH_BUDGET;
    const reduced = BRANCH_PREFIX_MAX_BYTES - overflow;
    if (reduced >= 1) {
      candidate = buildPath(reduced);
    }
    if (candidate.length > WINDOWS_PATH_BUDGET) {
      return err({
        code: "invalid_input",
        message: `worktree path exceeds Windows ${WINDOWS_PATH_BUDGET}-character budget; configure a shorter projects.worktrees_folder`,
        details: { reason: "path_too_long" },
      });
    }
  }
  return ok(candidate);
}

function randomHex(random: RandomSource, bytes: number): string {
  const raw = new Uint8Array(bytes);
  random.fill(raw);
  let out = "";
  for (const byte of raw) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

export function slugifySeed(seed: string): string {
  return seed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, 32);
}

// spec 3.2.2: `wt/<adj>-<noun>-<4hex>` 또는 seed가 있으면 `wt/<seed>-<4hex>`.
export function generateAutoBranchName(
  random: RandomSource,
  seed?: string,
): string {
  const hex = randomHex(random, 2);
  if (seed !== undefined) {
    const slug = slugifySeed(seed);
    if (slug.length > 0) {
      return `wt/${slug}-${hex}`;
    }
  }
  const r = new Uint8Array(2);
  random.fill(r);
  const adj = ADJECTIVES[r[0]! % ADJECTIVES.length]!;
  const noun = NOUNS[r[1]! % NOUNS.length]!;
  return `wt/${adj}-${noun}-${hex}`;
}

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function assertSafeRefName(
  ref: string,
  field = "branch",
): Result<string> {
  const trimmed = ref.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > 200 ||
    trimmed.startsWith("-") ||
    trimmed.includes("\0") ||
    trimmed.includes("..") ||
    trimmed.includes("@{") ||
    trimmed.includes("\\") ||
    hasControlChar(trimmed) ||
    /[~^:?*[\]\s]/.test(trimmed) ||
    trimmed.endsWith(".") ||
    trimmed.endsWith(".lock") ||
    trimmed.startsWith("/") ||
    trimmed.endsWith("/") ||
    trimmed.includes("//")
  ) {
    return err({
      code: "invalid_input",
      message: `invalid ${field} name "${ref}"`,
      details: { reason: "invalid_ref" },
    });
  }
  return ok(trimmed);
}
