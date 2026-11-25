import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import type { WorkspaceScope } from "../ports.ts";
import { resolveInWorkspace } from "./scope.ts";

// model이 준 pattern으로 만든 RegExp는 끝나지 않을 수 있다. search.ts가 이 module을 Worker로 띄워 기한에 끊는다.
// main thread에서 import하지 않는다(top-level이 돈다).

const MAX_FILES = 200;
const MAX_MATCHES = 100;
const MAX_SCANNED_BYTES = 2 * 1024 * 1024;
const MAX_LINE_CHARS = 300;
const SKIPPED_DIRS = new Set([
  ".git",
  "node_modules",
  ".ssh",
  ".aws",
  ".gnupg",
]);
const SAFE_ENV_NAMES = new Set([".env.example", ".env.sample"]);

function isSensitiveWalkFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (SAFE_ENV_NAMES.has(lower)) return false;
  return lower === ".env" || lower.startsWith(".env.");
}

function hasProtectedDirSegment(targetPath: string): boolean {
  return targetPath.split(/[\\/]+/).some((part) => {
    const lower = part.toLowerCase();
    return lower === ".ssh" || lower === ".aws" || lower === ".gnupg";
  });
}

type Roots = Pick<WorkspaceScope, "read" | "write" | "base" | "results">;
type Base = { dir: string; single: string | null };

export type SearchInput = {
  kind: "glob" | "grep";
  pattern: string;
  glob?: string;
  // 이보다 긴 줄은 검사하지 않는다(minified 한 줄에 RegExp를 돌리지 않는다).
  maxLine: number;
  base: Base;
  roots: Roots;
};

export type SearchOutput =
  | { ok: true; items: string[]; more: boolean; skipped: number }
  | { ok: false; message: string };

const input = workerData as SearchInput;

// `**`, `*`, `?`, `{a,b}`만 푼다. `/`가 없는 pattern은 이름에만 맞춘다.
function globMatcher(pattern: string): (path: string) => boolean {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]!;
    if (char === "*" && pattern[index + 1] === "*") {
      index += 1;
      if (pattern[index + 1] === "/") {
        index += 1;
        source += "(?:.*/)?";
      } else source += ".*";
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else if (char === "{") source += "(?:";
    else if (char === "}") source += ")";
    else if (char === ",") source += "|";
    else source += char.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  const regex = new RegExp(`^${source}$`);
  return pattern.includes("/")
    ? (path) => regex.test(path)
    : (path) => regex.test(path.slice(path.lastIndexOf("/") + 1));
}

// base 아래 파일을 훑는다. 허용 폴더 밖으로 나가는 symlink, symlink 폴더, 민감 파일(.env*)과 보호 폴더는 건너뛴다.
async function* walk(dir: string): AsyncGenerator<string> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name.toLowerCase())) yield* walk(path);
    } else if (entry.isFile()) {
      if (!isSensitiveWalkFile(entry.name)) yield path;
    } else if (entry.isSymbolicLink()) {
      if (isSensitiveWalkFile(entry.name)) continue;
      const at = await resolveInWorkspace(input.roots, path, "read");
      if (
        at.ok &&
        !isSensitiveWalkFile(basename(at.value.path)) &&
        !hasProtectedDirSegment(at.value.path) &&
        (await stat(at.value.path)).isFile()
      ) {
        yield path;
      }
    }
  }
}

async function* listed(): AsyncGenerator<string> {
  if (input.base.single === null) yield* walk(input.base.dir);
  else yield input.base.single;
}

function show(file: string): string {
  return relative(input.base.dir, file).split(sep).join("/");
}

async function glob(): Promise<SearchOutput> {
  let match: (path: string) => boolean;
  try {
    match = globMatcher(input.pattern);
  } catch {
    return { ok: false, message: "glob is not valid" };
  }
  const files: string[] = [];
  let more = false;
  for await (const file of listed()) {
    const name = show(file);
    if (!match(name)) continue;
    if (files.length === MAX_FILES) {
      more = true;
      break;
    }
    files.push(name);
  }
  return { ok: true, items: files, more, skipped: 0 };
}

async function grep(): Promise<SearchOutput> {
  let regex: RegExp;
  try {
    regex = new RegExp(input.pattern);
  } catch {
    return { ok: false, message: "pattern is not a valid regular expression" };
  }
  let match: ((path: string) => boolean) | null = null;
  try {
    if (input.glob !== undefined) match = globMatcher(input.glob);
  } catch {
    return { ok: false, message: "glob is not valid" };
  }
  const found: string[] = [];
  let more = false;
  let skipped = 0;
  scan: for await (const file of listed()) {
    const name = show(file);
    if (match !== null && !match(name)) continue;
    let text: string;
    try {
      const bytes = await readFile(file);
      if (bytes.length > MAX_SCANNED_BYTES || bytes.includes(0)) continue;
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      continue;
    }
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      if (line.length > input.maxLine) {
        skipped += 1;
        continue;
      }
      if (!regex.test(line)) continue;
      if (found.length === MAX_MATCHES) {
        more = true;
        break scan;
      }
      found.push(`${name}:${index + 1}:${line.slice(0, MAX_LINE_CHARS)}`);
    }
  }
  return { ok: true, items: found, more, skipped };
}

parentPort!.postMessage(await (input.kind === "glob" ? glob() : grep()));
