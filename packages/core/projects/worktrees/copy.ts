// spec 3.3.2: gitignored 파일 복사(.env 등) 및 `.worktreeinclude` 읽기 전용 감지.
// 절대 경로, `..`, `.git` 내부를 거절하고 `git check-ignore --stdin -z`로 git이 무시하는 파일만 허용한다.
// 목적지 덮어쓰기 금지, CoW(COPYFILE_FICLONE) 우선 후 일반 복사 + 임시 파일 원자 rename, 2 GiB / 50,000 엔트리 상한.
import { constants as fsConstants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import type { WorktreeIncludeCandidate } from "../../../protocol/projects/worktrees.ts";
import { type GitRunner, runGit } from "./git.ts";
import { isStrictlyInside, safeRealpath } from "./paths.ts";

export const COPY_MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB
export const COPY_MAX_ENTRIES = 50_000;

export type IncludeDetectFs = {
  readText(path: string): Promise<string | null>;
};

export function isSafeRelativePattern(pattern: string): boolean {
  const trimmed = pattern.trim();
  if (trimmed === "" || trimmed.startsWith("#")) return false;
  if (
    isAbsolute(trimmed) ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("\\") ||
    /^[A-Za-z]:/.test(trimmed)
  ) {
    return false;
  }
  const normalized = trimmed.replace(/\\/g, "/").replace(/^\.\//, "");
  const segments = normalized.split("/");
  if (segments.some((seg) => seg === ".." || seg === ".git")) {
    return false;
  }
  return true;
}

// 등록 폴더의 `.worktreeinclude`를 읽기만 해서 복사 규칙 후보를 뽑는다. 저절로 쓰지 않는다.
export async function detectWorktreeInclude(input: {
  folders: readonly string[];
  fs: IncludeDetectFs;
}): Promise<WorktreeIncludeCandidate[]> {
  const out: WorktreeIncludeCandidate[] = [];
  const seen = new Set<string>();
  for (const folder of input.folders) {
    const file = join(folder, ".worktreeinclude");
    const content = await input.fs.readText(file);
    if (content === null) continue;
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line === "" || line.startsWith("#")) continue;
      if (!isSafeRelativePattern(line)) continue;
      const key = `${folder}\0${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        pattern: line,
        source: ".worktreeinclude",
        folder,
      });
    }
  }
  return out;
}

function globToRegex(pattern: string): RegExp {
  const normalized = pattern
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
  let rx = "^";
  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i]!;
    if (ch === "*") {
      if (normalized[i + 1] === "*") {
        i += 1;
        if (normalized[i + 1] === "/") {
          i += 1;
          rx += "(?:.*/)?";
        } else {
          rx += ".*";
        }
      } else {
        rx += "[^/]*";
      }
    } else if (ch === "?") {
      rx += "[^/]";
    } else if (/[.+^${}()|[\]\\]/.test(ch)) {
      rx += `\\${ch}`;
    } else {
      rx += ch;
    }
  }
  rx += "$";
  return new RegExp(rx);
}

async function collectMatchingRelPaths(
  repoRoot: string,
  patterns: readonly string[],
  warnings: string[],
): Promise<string[]> {
  const safePatterns: string[] = [];
  for (const pattern of patterns) {
    if (!isSafeRelativePattern(pattern)) {
      warnings.push(`skipped unsafe copy pattern "${pattern}"`);
      continue;
    }
    safePatterns.push(
      pattern
        .trim()
        .replace(/\\/g, "/")
        .replace(/^\.\//, "")
        .replace(/\/+$/, ""),
    );
  }
  if (safePatterns.length === 0) return [];

  const literalPaths: string[] = [];
  const globRegexes: RegExp[] = [];
  for (const p of safePatterns) {
    if (/[*?]/.test(p)) {
      globRegexes.push(globToRegex(p));
    } else {
      literalPaths.push(p);
    }
  }

  const candidates = new Set<string>();
  const realRoot = safeRealpath(repoRoot);

  // 리터럴 경로는 직접 확인한다(전체 트리 순회를 피한다).
  for (const rel of literalPaths) {
    const abs = join(repoRoot, rel);
    try {
      const st = await lstat(abs);
      if (st.isSymbolicLink()) continue;
      if (!isStrictlyInside(safeRealpath(abs), realRoot)) continue;
      candidates.add(rel);
    } catch {
      // 존재하지 않는 패턴은 조용히 건너뛴다.
    }
  }

  // glob 패턴이 있으면 repo를 얕게 순회하되 `.git`은 건너뛰고 엔트리 예산 안에서 모은다.
  if (globRegexes.length > 0) {
    let visited = 0;
    const walk = async (dir: string) => {
      if (visited >= COPY_MAX_ENTRIES) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (visited >= COPY_MAX_ENTRIES) return;
        if (entry.name === ".git") continue;
        visited += 1;
        const abs = join(dir, entry.name);
        if (entry.isSymbolicLink()) continue;
        const rel = relative(repoRoot, abs).split(sep).join("/");
        if (globRegexes.some((rx) => rx.test(rel))) {
          candidates.add(rel);
          continue;
        }
        if (entry.isDirectory()) {
          await walk(abs);
        }
      }
    };
    await walk(repoRoot);
  }

  return [...candidates].sort();
}

async function expandFilesUnder(
  repoRoot: string,
  relPaths: readonly string[],
  budget: { entries: number; exceeded: boolean },
): Promise<string[]> {
  const files: string[] = [];
  const seen = new Set<string>();

  const walk = async (rel: string) => {
    if (budget.exceeded) return;
    if (seen.has(rel)) return;
    const abs = join(repoRoot, rel);
    let st;
    try {
      st = await lstat(abs);
    } catch {
      return;
    }
    if (st.isSymbolicLink()) return;
    if (st.isFile()) {
      budget.entries += 1;
      if (budget.entries > COPY_MAX_ENTRIES) {
        budget.exceeded = true;
        return;
      }
      seen.add(rel);
      files.push(rel);
      return;
    }
    if (st.isDirectory()) {
      let children;
      try {
        children = await readdir(abs, { withFileTypes: true });
      } catch {
        return;
      }
      for (const child of children) {
        if (budget.exceeded) return;
        if (child.name === ".git") continue;
        await walk(`${rel}/${child.name}`);
      }
    }
  };

  for (const rel of relPaths) {
    await walk(rel);
  }
  return files;
}

async function copyFileCowAtomic(src: string, dest: string): Promise<void> {
  await mkdir(dirname(dest), { recursive: true });
  const tmp = `${dest}.lophn-copy-${process.pid}-${Date.now()}`;
  try {
    try {
      await copyFile(src, tmp, fsConstants.COPYFILE_FICLONE);
    } catch {
      await copyFile(src, tmp);
    }
    await rename(tmp, dest);
  } catch (cause) {
    await unlink(tmp).catch(() => undefined);
    throw cause;
  }
}

export async function copyGitignoredFiles(input: {
  repoRoot: string;
  worktreePath: string;
  patterns: readonly string[];
  git?: GitRunner;
  maxBytes?: number;
  maxEntries?: number;
}): Promise<{ copied: number; warnings: string[] }> {
  const warnings: string[] = [];
  if (input.patterns.length === 0) {
    return { copied: 0, warnings };
  }
  const git = input.git ?? runGit;
  const maxBytes = input.maxBytes ?? COPY_MAX_BYTES;
  const maxEntries = input.maxEntries ?? COPY_MAX_ENTRIES;

  const matched = await collectMatchingRelPaths(
    input.repoRoot,
    input.patterns,
    warnings,
  );
  if (matched.length === 0) {
    return { copied: 0, warnings };
  }

  // `git check-ignore --stdin -z`로 git이 무시하는 경로만 남긴다(tracked / 비무시 파일 절대 미접촉).
  const check = await git(input.repoRoot, ["check-ignore", "--stdin", "-z"], {
    stdin: `${matched.join("\0")}\0`,
  });
  if (check.code !== 0 && check.code !== 1) {
    warnings.push("git check-ignore failed; skipped copying ignored files");
    return { copied: 0, warnings };
  }
  const ignoredTop = check.stdout
    .split("\0")
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && isSafeRelativePattern(p));

  if (ignoredTop.length === 0) {
    return { copied: 0, warnings };
  }

  const budget = { entries: 0, exceeded: false };
  const files = await expandFilesUnder(input.repoRoot, ignoredTop, budget);
  if (budget.exceeded || files.length > maxEntries) {
    warnings.push(
      `worktree copy exceeded entry budget (${maxEntries}); remaining files were skipped`,
    );
  }

  const realRoot = safeRealpath(input.repoRoot);
  const realWt = safeRealpath(input.worktreePath);
  let copied = 0;
  let totalBytes = 0;

  for (const rel of files.slice(0, maxEntries)) {
    if (!isSafeRelativePattern(rel)) continue;
    const src = join(input.repoRoot, rel);
    const dest = join(input.worktreePath, rel);
    if (!isStrictlyInside(safeRealpath(src), realRoot)) continue;

    // 목적지에 이미 파일이 있으면 절대 덮어쓰지 않는다.
    try {
      await lstat(dest);
      continue;
    } catch {
      // ENOENT -> 복사 가능
    }

    let size = 0;
    try {
      const st = await lstat(src);
      if (!st.isFile()) continue;
      size = st.size;
    } catch {
      continue;
    }
    if (totalBytes + size > maxBytes) {
      warnings.push(
        `worktree copy exceeded size budget (${Math.round(maxBytes / (1024 * 1024))} MiB); remaining files were skipped`,
      );
      break;
    }

    // 부모 경로가 worktree 밖으로 탈출하지 않는지 다시 확인한다.
    await mkdir(dirname(dest), { recursive: true });
    if (
      !isStrictlyInside(safeRealpath(dirname(dest)), realWt) &&
      safeRealpath(dirname(dest)) !== realWt
    ) {
      warnings.push(`skipped escaping destination path "${rel}"`);
      continue;
    }

    try {
      await copyFileCowAtomic(src, dest);
      totalBytes += size;
      copied += 1;
    } catch (cause) {
      warnings.push(
        `failed to copy "${rel}": ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }

  return { copied, warnings };
}

export const nodeIncludeDetectFs: IncludeDetectFs = {
  async readText(path) {
    try {
      return await readFile(path, "utf8");
    } catch {
      return null;
    }
  },
};
