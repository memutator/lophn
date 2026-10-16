import { join, relative, sep } from "node:path";
import { ok, type Result } from "../../../../base/mod.ts";
import type { ToolResult } from "../../../../protocol/lophn-agent/mod.ts";
import { continuation } from "../bundles/paging.ts";
import { fitJson } from "../result.ts";
import type { ToolContext } from "../tool-context.ts";
import { fail, fsFail, resolveInPlace } from "./scope.ts";

const MAX_FILES = 200;
const MAX_MATCHES = 100;
const MAX_SCANNED_BYTES = 2 * 1024 * 1024;
const MAX_LINE_CHARS = 300;
const SKIPPED = new Set([".git", "node_modules"]);

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

// base 아래 파일을 훑는다. 허용 폴더 밖으로 나가는 symlink와 symlink 폴더는 넣지 않는다.
async function* walk(
  ctx: ToolContext,
  dir: string,
): AsyncGenerator<string> {
  let entries: Deno.DirEntry[];
  try {
    entries = [];
    for await (const entry of Deno.readDir(dir)) entries.push(entry);
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory) {
      if (!SKIPPED.has(entry.name)) yield* walk(ctx, path);
    } else if (entry.isFile) {
      yield path;
    } else if (entry.isSymlink) {
      const at = await resolveInPlace(ctx.scope, path, "read");
      if (at.ok && (await Deno.stat(at.value.path)).isFile) yield path;
    }
  }
}

type Base = { dir: string; single: string | null };

async function baseOf(
  ctx: ToolContext,
  path: string | undefined,
): Promise<Result<Base>> {
  const at = await resolveInPlace(ctx.scope, path ?? ".", "read");
  if (!at.ok) return at;
  try {
    const stat = await Deno.stat(at.value.path);
    return ok(
      stat.isDirectory
        ? { dir: at.value.path, single: null }
        : { dir: join(at.value.path, ".."), single: at.value.path },
    );
  } catch (error) {
    return fsFail(error);
  }
}

async function* listed(
  ctx: ToolContext,
  base: Base,
): AsyncGenerator<string> {
  if (base.single === null) yield* walk(ctx, base.dir);
  else yield base.single;
}

function show(base: Base, file: string): string {
  return relative(base.dir, file).split(sep).join("/");
}

function resultOf(
  summary: string,
  key: string,
  items: string[],
  more: boolean,
): ToolResult {
  const fitted = fitJson({ [key]: items }, [key]);
  const cut = fitted.content === null ? items.length : fitted.omittedCount;
  return {
    status: "success",
    summary,
    content: fitted.content as ToolResult["content"],
    complete: !more && cut === 0,
    source: null,
    continuation: continuation(
      more || cut > 0 ? "narrow pattern or path to see the rest" : null,
    ),
    pending: [],
  };
}

export async function globFiles(
  input: { pattern: string; path?: string },
  ctx: ToolContext,
): Promise<Result<ToolResult>> {
  const base = await baseOf(ctx, input.path);
  if (!base.ok) return base;
  const match = globMatcher(input.pattern);
  const files: string[] = [];
  let more = false;
  for await (const file of listed(ctx, base.value)) {
    const name = show(base.value, file);
    if (!match(name)) continue;
    if (files.length === MAX_FILES) {
      more = true;
      break;
    }
    files.push(name);
  }
  return ok(resultOf(`${files.length} files match`, "files", files, more));
}

export async function grepFiles(
  input: { pattern: string; path?: string; glob?: string },
  ctx: ToolContext,
): Promise<Result<ToolResult>> {
  let regex: RegExp;
  try {
    regex = new RegExp(input.pattern);
  } catch {
    return fail("invalid_input", "pattern is not a valid regular expression");
  }
  const base = await baseOf(ctx, input.path);
  if (!base.ok) return base;
  const match = input.glob === undefined ? null : globMatcher(input.glob);
  const found: string[] = [];
  let more = false;
  scan:
  for await (const file of listed(ctx, base.value)) {
    const name = show(base.value, file);
    if (match !== null && !match(name)) continue;
    let text: string;
    try {
      const bytes = await Deno.readFile(file);
      if (bytes.length > MAX_SCANNED_BYTES || bytes.includes(0)) continue;
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      continue;
    }
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      if (!regex.test(lines[index]!)) continue;
      if (found.length === MAX_MATCHES) {
        more = true;
        break scan;
      }
      found.push(
        `${name}:${index + 1}:${lines[index]!.slice(0, MAX_LINE_CHARS)}`,
      );
    }
  }
  return ok(resultOf(`${found.length} lines match`, "matches", found, more));
}
