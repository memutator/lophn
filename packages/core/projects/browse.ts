// 다른 기기가 이 기계의 폴더를 고를 때 읽는 폴더 목록. 사람의 home 아래만 읽는다.
// 판정은 realpath로 한다(agent-definition의 workspace 판정과 같은 방법): symlink나 `..`로 home 밖을 읽지 못한다.
import type { Dirent } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { err, errorCode, ok, type Result } from "../../base/mod.ts";

const ENTRY_LIMIT = 500;

export type BrowseFs = {
  realpath(path: string): Promise<string>;
  stat(path: string): Promise<{ isDirectory(): boolean }>;
  readdir(path: string, options: { withFileTypes: true }): Promise<Dirent[]>;
};

export type BrowseOutput = {
  home: string;
  path: string;
  parent: string | null;
  entries: { name: string; path: string }[];
  truncated: boolean;
};

// home은 realpath여야 한다(wiring이 한 번 풀어 준다).
function inside(home: string, target: string): boolean {
  const rel = relative(home, target);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

async function realDir(fs: BrowseFs, path: string): Promise<string | null> {
  try {
    const real = await fs.realpath(path);
    return (await fs.stat(real)).isDirectory() ? real : null;
  } catch {
    return null;
  }
}

export async function browseFolders(
  input: { path?: string },
  deps: { home: string | null; fs: BrowseFs },
): Promise<Result<BrowseOutput>> {
  const { home, fs } = deps;
  if (home === null) {
    return err({
      code: "unavailable",
      message: "this computer has no home folder to browse",
    });
  }
  let target: string;
  try {
    target = await fs.realpath(input.path ?? home);
  } catch (thrown) {
    const code = errorCode(thrown);
    if (code === "ENOENT" || code === "ENOTDIR") {
      return err({ code: "not_found", message: "folder not found" });
    }
    return err({ code: "unavailable", message: "folder could not be read" });
  }
  if (!inside(home, target)) {
    return err({
      code: "forbidden",
      message: "only folders inside the home folder can be browsed",
    });
  }
  let listed: Dirent[];
  try {
    if (!(await fs.stat(target)).isDirectory()) {
      return err({ code: "invalid_input", message: "not a folder" });
    }
    listed = await fs.readdir(target, { withFileTypes: true });
  } catch {
    return err({ code: "unavailable", message: "folder could not be read" });
  }
  const entries: { name: string; path: string }[] = [];
  for (const entry of listed) {
    const path = join(target, entry.name);
    if (entry.isDirectory()) {
      entries.push({ name: entry.name, path });
    } else if (entry.isSymbolicLink()) {
      const real = await realDir(fs, path);
      if (real !== null && inside(home, real)) {
        entries.push({ name: entry.name, path: real });
      }
    }
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return ok({
    home,
    path: target,
    parent: target === home ? null : dirname(target),
    entries: entries.slice(0, ENTRY_LIMIT),
    truncated: entries.length > ENTRY_LIMIT,
  });
}
