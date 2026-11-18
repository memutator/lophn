import { relative } from "node:path";

import {
  PROJECT_IDENTITY_FILE,
  remoteKeyOf,
} from "../../../protocol/projects/mod.ts";
import type { IdentityFs } from "./file.ts";
import type { GitReader } from "./git.ts";

export type FolderFileState =
  | "none"
  | "committed"
  | "uncommitted"
  | "ignored"
  | "conflict"
  | "unreadable";

// 폴더 하나를 읽은 값. 쓰지 않는다. found가 false면 나머지는 비어 있다.
export type FolderIdentity = {
  found: boolean;
  repo: "git" | "none" | null;
  remote: { key: string; url: string } | null;
  file: FolderFileState;
  // file이 말하는 id. 충돌이면 가장 작은 것, 없거나 못 읽으면 null이다.
  file_identity: string | null;
};

const NOT_FOUND: FolderIdentity = {
  found: false,
  repo: null,
  remote: null,
  file: "none",
  file_identity: null,
};

// git이 아닌 폴더는 기계를 넘지 않으므로 file을 보지 않는다. 위로 올라가 다른 폴더의 file을 찾지 않는다(monorepo는
// project 폴더마다 자기 file).
// git이 답하지 않았는데 `.git`이 있으면(git이 PATH에 없다, dubious ownership, 깨진 저장소) 던진다: "git이 아니다"로
// 적으면 git project가 ledger에서 id를 얻는다. 부르는 쪽은 timeout처럼 unavailable로 보고 아무것도 쓰지 않는다.
export async function inspectFolder(
  folder: string,
  deps: {
    git: GitReader;
    fs: Pick<IdentityFs, "isFolder" | "realpath" | "read" | "hasGit">;
  },
): Promise<FolderIdentity> {
  if (!(await deps.fs.isFolder(folder))) return NOT_FOUND;
  const top = await deps.git.topLevel(folder);
  if (top === null) {
    if (await deps.fs.hasGit(folder)) {
      throw new Error(
        `git could not read ${folder}, which is inside a git repository; check that git is installed and trusts this folder`,
      );
    }
    return {
      found: true,
      repo: "none",
      remote: null,
      file: "none",
      file_identity: null,
    };
  }
  // git은 symlink를 푼 맨 위를 내므로 양쪽을 다 풀어 견준다.
  const inside = relative(
    await deps.fs.realpath(top),
    await deps.fs.realpath(folder),
  ).replace(/\\/g, "/");
  const subpath = inside.startsWith("..") ? "" : inside;
  const remote = remoteKeyOf(await deps.git.remotes(folder), subpath);
  const read = await deps.fs.read(folder);
  const base = { found: true, repo: "git" as const, remote };
  if (read === "absent") return { ...base, file: "none", file_identity: null };
  if (read.kind === "unreadable") {
    return { ...base, file: "unreadable", file_identity: null };
  }
  if (read.kind === "conflict") {
    return { ...base, file: "conflict", file_identity: read.id };
  }
  const state = await deps.git.fileState(folder, PROJECT_IDENTITY_FILE);
  const file: FolderFileState =
    state === "tracked"
      ? "committed"
      : state === "ignored"
        ? "ignored"
        : "uncommitted";
  return { ...base, file, file_identity: read.id };
}
