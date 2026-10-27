import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Dirent } from "node:fs";
import { ok, type Result } from "../../../base/mod.ts";
import {
  type ProjectSearchMatch,
  relativePathSchema,
} from "../../../protocol/projects/mod.ts";
import {
  gitignoreExcludes,
  type GitignoreRule,
  symlinkEscapesRoot,
} from "../registry/mod.ts";
import {
  type Cursor,
  decodeText,
  isSkippedName,
  MAX_FILE_BYTES,
  normalizeQuery,
  searchText,
  sortKey,
} from "./model.ts";

type SearchScope = readonly { folder_path: string; start: string }[];

type ScanInput = {
  scope: SearchScope;
  query: string;
  cursor: Cursor | undefined;
  limit: number;
};

export type ScanDeps = {
  // 등록 폴더가 디스크에 있는지. 없으면 그 폴더만 건너뛴다.
  exists(folderPath: string): boolean;
};

type Walk = {
  root: string; // 등록 폴더의 realpath
  after: string | undefined; // 이 경로 앞은 이미 냈다
};

// 등록 폴더를 순서대로 걸으며 파일을 읽어 일치를 모은다. limit보다 하나 더 찾으면 멈추고 다음 cursor를 낸다.
export async function scan(
  input: ScanInput,
  deps: ScanDeps,
): Promise<Result<{ matches: ProjectSearchMatch[]; next: Cursor | null }>> {
  const needle = normalizeQuery(input.query);
  const matches: ProjectSearchMatch[] = [];
  const from = input.cursor?.folder ?? 0;
  for (let index = from; index < input.scope.length; index++) {
    const { folder_path, start } = input.scope[index]!;
    if (!deps.exists(folder_path)) continue;
    let root: string;
    try {
      root = await realpath(folder_path);
    } catch {
      continue;
    }
    const resume = index === input.cursor?.folder ? input.cursor : undefined;
    const walk: Walk = { root, after: resume?.path };
    // 시작 폴더 위쪽 .gitignore도 적용된다.
    const segments = relative(folder_path, start)
      .split(/[\\/]/)
      .filter((part) => part !== "");
    let dir = folder_path;
    let rel = "";
    const rules: GitignoreRule[] = [];
    for (const segment of segments) {
      const rule = await gitignoreOf(dir, rel);
      if (rule !== null) rules.push(rule);
      dir = join(dir, segment);
      rel = rel === "" ? segment : `${rel}/${segment}`;
    }
    for await (const file of files(walk, dir, rel, rules)) {
      const read = await readMatches(file.abs, needle);
      for (const found of read) {
        if (
          resume !== undefined &&
          file.rel === resume.path &&
          found.line <= resume.line
        )
          continue;
        matches.push({ folder_path, path: file.rel, ...found });
        if (matches.length > input.limit) {
          const last = matches[input.limit - 1]!;
          return ok({
            matches: matches.slice(0, input.limit),
            next: { folder: index, path: last.path, line: last.line },
          });
        }
      }
    }
  }
  return ok({ matches, next: null });
}

async function readMatches(abs: string, needle: string) {
  let bytes: Uint8Array;
  try {
    if ((await stat(abs)).size > MAX_FILE_BYTES) return [];
    bytes = await readFile(abs);
  } catch {
    return []; // 도는 동안 사라진 파일 등
  }
  const text = decodeText(bytes);
  return text === null ? [] : searchText(text, needle);
}

async function gitignoreOf(
  dir: string,
  rel: string,
): Promise<GitignoreRule | null> {
  try {
    return {
      directory: rel,
      text: await readFile(join(dir, ".gitignore"), "utf8"),
    };
  } catch {
    return null;
  }
}

// 파일을 경로 순서로 낸다. .git, .gitignore가 뺀 경로, 연결 폴더 밖을 가리키는 symlink,
// symlink 디렉터리는 훑지 않는다.
async function* files(
  walk: Walk,
  dir: string,
  rel: string,
  inherited: readonly GitignoreRule[],
): AsyncGenerator<{ abs: string; rel: string }> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const own = await gitignoreOf(dir, rel);
  const rules = own === null ? inherited : [...inherited, own];
  const keyed = entries
    .filter((entry) => !isSkippedName(entry.name))
    .map((entry) => ({
      entry,
      key: sortKey(entry.name, entry.isDirectory()),
    }));
  keyed.sort((left, right) => (left.key < right.key ? -1 : 1));
  for (const { entry } of keyed) {
    const abs = join(dir, entry.name);
    const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      const prefix = `${path}/`;
      if (
        walk.after !== undefined &&
        prefix < walk.after &&
        !walk.after.startsWith(prefix)
      )
        continue;
      if (gitignoreExcludes(prefix, rules)) continue;
      yield* files(walk, abs, path, rules);
      continue;
    }
    if (walk.after !== undefined && path < walk.after) continue;
    if (entry.isSymbolicLink()) {
      try {
        const real = await realpath(abs);
        const escapes = symlinkEscapesRoot(walk.root, real);
        if (!escapes.ok || escapes.value) continue;
        if (!(await stat(real)).isFile()) continue;
      } catch {
        continue;
      }
    } else if (!entry.isFile()) continue;
    if (gitignoreExcludes(path, rules)) continue;
    if (!relativePathSchema.safeParse(path).success) continue;
    yield { abs, rel: path };
  }
}
