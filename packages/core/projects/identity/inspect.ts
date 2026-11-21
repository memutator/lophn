import { existsSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import { errorCode } from "../../../base/mod.ts";
import { remoteKeyOf } from "../../../protocol/projects/mod.ts";
import type { GitReader } from "./git.ts";

// 폴더 읽기에 쓰는 file system. 읽기만 한다.
export type FolderProbe = {
  isFolder(path: string): Promise<boolean>;
  hasGit(folder: string): Promise<boolean>;
  realpath(path: string): Promise<string>;
};

// 폴더 하나를 읽은 값. 쓰지 않는다. found가 false면 나머지는 비어 있다.
export type FolderIdentity = {
  found: boolean;
  repo: "git" | "none" | null;
  remote: { key: string; url: string } | null;
};

const NOT_FOUND: FolderIdentity = { found: false, repo: null, remote: null };

// 폴더나 그 위 폴더에 `.git`(폴더든 worktree·submodule의 file이든)이 있나. git이 저장소를 찾는 길과 같아서 위로
// 올라간다(monorepo의 project 폴더에는 `.git`이 없다). git이 답하지 않을 때 "git이 아니다"와 "git을 읽지 못했다"를 가른다.
function hasGitAbove(folder: string): boolean {
  for (let dir = resolve(folder); ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return true;
    if (dirname(dir) === dir) return false;
  }
}

export const nodeFolderProbe: FolderProbe = {
  async isFolder(path) {
    try {
      return (await stat(path)).isDirectory();
    } catch (thrown) {
      if (errorCode(thrown) === "ENOENT" || errorCode(thrown) === "ENOTDIR")
        return false;
      throw thrown;
    }
  },
  realpath: (path) => realpath(path),
  hasGit: (folder) => Promise.resolve(hasGitAbove(folder)),
};

// git이 답하지 않았는데 `.git`이 있으면(git이 PATH에 없다, dubious ownership, 깨진 저장소) 던진다: "git이 아니다"로
// 적으면 자동 match에서 빠진다. 부르는 쪽은 timeout처럼 unavailable로 보고 아무것도 쓰지 않는다.
export async function inspectFolder(
  folder: string,
  deps: { git: GitReader; fs: FolderProbe },
): Promise<FolderIdentity> {
  if (!(await deps.fs.isFolder(folder))) return NOT_FOUND;
  const top = await deps.git.topLevel(folder);
  if (top === null) {
    if (await deps.fs.hasGit(folder)) {
      throw new Error(
        `git could not read ${folder}, which is inside a git repository; check that git is installed and trusts this folder`,
      );
    }
    return { found: true, repo: "none", remote: null };
  }
  // git은 symlink를 푼 맨 위를 내므로 양쪽을 다 풀어 견준다.
  const inside = relative(
    await deps.fs.realpath(top),
    await deps.fs.realpath(folder),
  ).replace(/\\/g, "/");
  const subpath = inside.startsWith("..") ? "" : inside;
  return {
    found: true,
    repo: "git",
    remote: remoteKeyOf(await deps.git.remotes(folder), subpath),
  };
}
